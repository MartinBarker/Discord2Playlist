const { SlashCommandBuilder, ChannelType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const { CronExpressionParser } = require('cron-parser');

function getNextCronRunTime(expression) {
    try {
        const interval = CronExpressionParser.parse(expression);
        return interval.next().toDate();
    } catch {
        return null;
    }
}

// Plain-English description of a 5-field cron expression. Falls back to
// computing the gap between two upcoming runs via cron-parser.
function describeCron(expression) {
    const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const parts = String(expression || '').trim().split(/\s+/);
    const fields = parts.length === 6 ? parts.slice(1) : parts; // strip optional seconds field
    if (fields.length !== 5) return 'custom schedule (unrecognized cron format)';

    const [minute, hour, dom, month, dow] = fields;
    const isAny = (f) => f === '*';
    const isZero = (f) => f === '0';
    const isStep = (f) => /^\*\/\d+$/.test(f);
    const stepOf = (f) => parseInt(f.split('/')[1], 10);
    const isInt = (f) => /^\d+$/.test(f);

    let phrase = null;
    if (isAny(minute) && isAny(hour) && isAny(dom) && isAny(month) && isAny(dow)) {
        phrase = 'every minute';
    } else if (isStep(minute) && isAny(hour) && isAny(dom) && isAny(month) && isAny(dow)) {
        phrase = `every ${stepOf(minute)} minute(s)`;
    } else if (isZero(minute) && isAny(hour) && isAny(dom) && isAny(month) && isAny(dow)) {
        phrase = 'every hour, at minute :00';
    } else if (isZero(minute) && isStep(hour) && isAny(dom) && isAny(month) && isAny(dow)) {
        phrase = `every ${stepOf(hour)} hour(s), at minute :00`;
    } else if (isZero(minute) && isZero(hour) && isAny(dom) && isAny(month) && isAny(dow)) {
        phrase = 'every day at 00:00 UTC';
    } else if (isZero(minute) && isInt(hour) && isAny(dom) && isAny(month) && isAny(dow)) {
        phrase = `every day at ${hour.padStart(2, '0')}:00 UTC`;
    } else if (isZero(minute) && isZero(hour) && isStep(dom) && isAny(month) && isAny(dow)) {
        phrase = `every ${stepOf(dom)} day(s) at 00:00 UTC`;
    } else if (isZero(minute) && isZero(hour) && isAny(dom) && isAny(month) && isInt(dow)) {
        const d = parseInt(dow, 10) % 7;
        phrase = `every week on ${DOW[d]} at 00:00 UTC`;
    } else if (isZero(minute) && isZero(hour) && isInt(dom) && isAny(month) && isAny(dow)) {
        phrase = `on day ${dom} of every month at 00:00 UTC`;
    }

    // Always append the actual interval between consecutive runs as a sanity check.
    try {
        const it = CronExpressionParser.parse(expression);
        const a = it.next().toDate().getTime();
        const b = it.next().toDate().getTime();
        const interval = humanizeMs(b - a);
        return phrase ? `${phrase} (approx. every ${interval})` : `runs approx. every ${interval}`;
    } catch {
        return phrase || 'custom schedule (could not parse)';
    }
}

// Render a non-negative millisecond gap as a short human string.
function humanizeMs(ms) {
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s} second${s === 1 ? '' : 's'}`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} hour${h === 1 ? '' : 's'}`;
    const d = Math.round(h / 24);
    return `${d} day${d === 1 ? '' : 's'}`;
}

// Render a future Date as "in N minutes/hours/days".
function humanizeUntil(date) {
    if (!date) return 'unknown';
    const ms = date.getTime() - Date.now();
    if (ms <= 0) return 'now';
    return `in ${humanizeMs(ms)}`;
}

const OUTPUT_FILENAME_FORMAT = '{sanitized_channel_name}.json';
const repeatJobs = new Map();

// Find the most recent JSON file for a channel to get last processed message ID
function getLastProcessedMessageId(channelId, channelName) {
    try {
        const botDirectory = path.join(__dirname, '..');
        const safeChannelName = (channelName || 'channel').replace(/[^a-z0-9_-]+/gi, '-');
        
        // Get all JSON files for this channel
        const files = fs.readdirSync(botDirectory)
            .filter(file => file.startsWith(safeChannelName) && file.endsWith('.json'))
            .map(file => ({
                name: file,
                path: path.join(botDirectory, file),
                time: fs.statSync(path.join(botDirectory, file)).mtime.getTime()
            }))
            .sort((a, b) => b.time - a.time); // Sort by newest first
        
        // Read the most recent file and get lastProcessedMessageId
        if (files.length > 0) {
            const mostRecentFile = files[0];
            const data = JSON.parse(fs.readFileSync(mostRecentFile.path, 'utf8'));
            
            // Verify this file is for the correct channel
            if (data.channelId === channelId && data.lastProcessedMessageId) {
                console.log(`📋 Found previous run data in: ${mostRecentFile.name}`);
                return data.lastProcessedMessageId;
            }
        }
    } catch (error) {
        console.error('Error reading previous JSON files:', error);
    }
    return null;
}

// Extract clean URL from message content (removes text before/after URL)
function extractCleanUrl(content, regex) {
    const urls = [];
    let match;
    while ((match = regex.exec(content)) !== null) {
        urls.push(match[0]);
    }
    return urls;
}

// Helper functions to extract IDs from different platforms
function extractYouTubeId(url) {
    const match = url.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\/(?:watch\?v=)?(?:embed\/)?(?:v\/)?(?:shorts\/)?([a-zA-Z0-9_-]+)/);
    return match && match[1];
}

function extractSpotifyId(url) {
    // Handle both URLs and URIs (spotify:track:...)
    const match = url.match(/(?:https?:\/\/)?(?:open\.)?spotify\.com\/(track|album|playlist|artist)\/([a-zA-Z0-9]+)/) ||
                  url.match(/spotify:(track|album|playlist|artist):([a-zA-Z0-9]+)/);
    return match && `${match[1]}_${match[2]}`;
}

function extractSoundCloudId(url) {
    const match = url.match(/(?:https?:\/\/)?(?:www\.)?soundcloud\.com\/([^\/\s]+)\/([^\/\s\?]+)/);
    return match && `${match[1]}_${match[2]}`;
}

function extractBandcampId(url) {
    const match = url.match(/(?:https?:\/\/)?([^\.]+)\.bandcamp\.com\/(?:track|album)\/([^\/\s\?]+)/);
    return match && `${match[1]}_${match[2]}`;
}

// Function to chunk array into groups of specified size
function chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
}

function getChannelJsonPath(channelName) {
    const botDirectory = path.join(__dirname, '..');
    const safeChannelName = (channelName || 'channel').replace(/[^a-z0-9_-]+/gi, '-');
    const filename = OUTPUT_FILENAME_FORMAT.replace('{sanitized_channel_name}', safeChannelName);
    return {
        botDirectory,
        filename,
        filepath: path.join(botDirectory, filename)
    };
}

function loadExistingJson(filepath, channelId) {
    try {
        if (fs.existsSync(filepath)) {
            const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
            if (!channelId || data.channelId === channelId) {
                return data;
            }
        }
    } catch (error) {
        console.error('❌ Error reading existing JSON file:', error);
    }
    return null;
}

function mergeMediaArrays(existingArray, incomingArray) {
    const merged = Array.isArray(existingArray) ? [...existingArray] : [];
    const seen = new Set(merged.map(item => `${item.id || ''}::${item.messageId || ''}`));

    if (Array.isArray(incomingArray)) {
        incomingArray.forEach(item => {
            const key = `${item.id || ''}::${item.messageId || ''}`;
            if (!seen.has(key)) {
                seen.add(key);
                merged.push(item);
            }
        });
    }

    return merged;
}

function getRepeatJobKey(guildId, inputChannelId, outputChannelId) {
    return `${guildId || 'noguild'}:${inputChannelId}:${outputChannelId}`;
}

function snowflakeToDate(snowflake) {
    try {
        const ms = Number(BigInt(snowflake) >> 22n) + 1420070400000;
        return new Date(ms).toLocaleString();
    } catch {
        return 'unknown';
    }
}

function createScheduledInteraction({ client, inputChannel, outputChannel, embeddYoutubeLinks, outputYoutubeLinks, saveJson, repeat, youtubePlaylistId }) {
    return {
        client,
        guildId: inputChannel.guildId,
        channel: inputChannel,
        options: {
            getChannel(name) {
                if (name === 'input_channel') return inputChannel;
                if (name === 'output_channel') return outputChannel;
                return null;
            },
            getBoolean(name) {
                if (name === 'embedd_youtube_links') return embeddYoutubeLinks;
                if (name === 'output_youtube_links') return outputYoutubeLinks;
                if (name === 'save_json') return saveJson;
                return null;
            },
            getString(name) {
                if (name === 'repeat') return repeat || null;
                if (name === 'youtube_playlist_id') return youtubePlaylistId || null;
                return null;
            }
        },
        async deferReply() {
            return;
        },
        async editReply(message) {
            const text = typeof message === 'string' ? message : JSON.stringify(message);
            console.log(`[Scheduled /makeplaylists] ${text}`);
        }
    };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('makeplaylists')
        .setDescription('Fetch all media links and create YouTube playlist URLs (50 videos each)')
        .addChannelOption(option =>
            option
                .setName('input_channel')
                .setDescription('Channel to fetch messages from (optional, defaults to current channel)')
                .setRequired(false))
        .addChannelOption(option =>
            option
                .setName('output_channel')
                .setDescription('Channel to send output messages to (optional, defaults to input channel)')
                .setRequired(false))
        .addBooleanOption(option =>
            option
                .setName('embedd_youtube_links')
                .setDescription('true = let YouTube links embed previews; false = wrap URLs in <> to suppress embeds (default: false)')
                .setRequired(false))
        .addBooleanOption(option =>
            option
                .setName('output_youtube_links')
                .setDescription('If true, include YouTube playlist links in the output message (default: false)')
                .setRequired(false))
        .addBooleanOption(option =>
            option
                .setName('save_json')
                .setDescription('If true, saves all links organized by media source to a JSON file (default: true)')
                .setRequired(false))
        .addStringOption(option =>
            option
                .setName('youtube_playlist_id')
                .setDescription('Your YouTube playlist ID — saved to JSON, reused on re-runs, linked in output')
                .setRequired(false))
        .addStringOption(option =>
            option
                .setName('repeat')
                .setDescription('Optional cron expression to repeat this command automatically (e.g. 0 0 */3 * *)')
                .setRequired(false)),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const inputChannel = interaction.options.getChannel('input_channel') || interaction.channel;
        const outputChannel = interaction.options.getChannel('output_channel') || inputChannel;
        const embeddYoutubeLinks = interaction.options.getBoolean('embedd_youtube_links') || false;
        const outputYoutubeLinks = interaction.options.getBoolean('output_youtube_links') ?? true;
        const saveJson = interaction.options.getBoolean('save_json') ?? true;
        const userProvidedPlaylistId = interaction.options.getString('youtube_playlist_id')?.trim() || null;
        const repeat = interaction.options.getString('repeat')?.trim();

        if (repeat && !cron.validate(repeat)) {
            await interaction.editReply('Invalid cron expression for `repeat`. Example: `0 0 */3 * *`');
            return;
        }

        // Check if input channel exists and is accessible
        if (!inputChannel) {
            await interaction.editReply('Input channel must be specified or command must be used in a text channel.');
            return;
        }

        // Check if input channel is a text channel
        if (inputChannel.type !== ChannelType.GuildText) {
            await interaction.editReply('Input channel must be a text channel.');
            return;
        }

        // Check if output channel is a text channel
        if (!outputChannel || outputChannel.type !== ChannelType.GuildText) {
            await interaction.editReply('Output channel must be a text channel.');
            return;
        }

        // Check if bot has permission to view and read messages in input channel
        const inputPerms = inputChannel.permissionsFor(interaction.client.user);
        if (!inputPerms || !inputPerms.has('ViewChannel')) {
            await interaction.editReply('I do not have permission to view the specified input channel. Please ensure the bot has "View Channel" permission.');
            return;
        }
        if (!inputPerms.has('ReadMessageHistory')) {
            await interaction.editReply('I do not have permission to read messages in the specified input channel.');
            return;
        }

        // Check if bot has permission to view and send messages in output channel
        const outputPerms = outputChannel.permissionsFor(interaction.client.user);
        if (!outputPerms || !outputPerms.has('ViewChannel')) {
            await interaction.editReply('I do not have permission to view the specified output channel. Please ensure the bot has "View Channel" permission.');
            return;
        }
        if (!outputPerms.has('SendMessages')) {
            await interaction.editReply('I do not have permission to send messages in the specified output channel.');
            return;
        }

        // Print command + every flag as the user passed it (or its resolved default).
        console.log(`\n📝 Command: /makeplaylists`);
        console.log(`   Invoked by: ${interaction.user?.tag || interaction.user?.username || 'unknown'} (ID: ${interaction.user?.id || '?'})`);
        console.log(`   Guild: ${interaction.guild?.name || 'unknown'} (ID: ${interaction.guildId || '?'})`);
        console.log(`   Flags:`);
        console.log(`     - input_channel:        #${inputChannel.name} (ID: ${inputChannel.id})`);
        console.log(`     - output_channel:       #${outputChannel.name} (ID: ${outputChannel.id})${outputChannel.id === inputChannel.id ? '  [defaulted to input_channel]' : ''}`);
        console.log(`     - embedd_youtube_links: ${embeddYoutubeLinks}`);
        console.log(`     - output_youtube_links: ${outputYoutubeLinks}`);
        console.log(`     - save_json:            ${saveJson}`);
        console.log(`     - youtube_playlist_id:  ${userProvidedPlaylistId || 'not set (will reuse from JSON if present)'}`);
        if (repeat) {
            const nextRun = getNextCronRunTime(repeat);
            console.log(`     - repeat:               ${repeat}`);
            console.log(`         meaning:            ${describeCron(repeat)}`);
            console.log(`         next run:           ${nextRun ? nextRun.toLocaleString() : 'unknown'} (${humanizeUntil(nextRun)})`);
        } else {
            console.log(`     - repeat:               not set — this command will not auto-repeat`);
        }
        console.log(``);

        try {
            let allMessages = [];
            let lastId; // for backward pagination (full mode)
            let newestFetchedId = null; // for forward pagination (incremental mode)

            // Get last processed message ID from the most recent JSON file for this channel
            const lastProcessedMessageId = getLastProcessedMessageId(inputChannel.id, inputChannel.name);

            // Regular expressions for different music platforms
            const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\/(?:watch\?v=)?(?:embed\/)?(?:v\/)?(?:shorts\/)?[a-zA-Z0-9_-]+/g;
            const youtubeIdRegex = /\b[a-zA-Z0-9_-]{11}\b/g; // Standalone YouTube IDs (11 characters)
            const spotifyRegex = /(?:https?:\/\/)?(?:open\.)?spotify\.com\/(track|album|playlist|artist)\/[a-zA-Z0-9]+/g;
            const spotifyUriRegex = /spotify:(track|album|playlist|artist):[a-zA-Z0-9]+/g; // Spotify URIs
            const soundcloudRegex = /(?:https?:\/\/)?(?:www\.)?soundcloud\.com\/[^\/\s]+\/[^\/\s\?]+/g;
            const bandcampRegex = /(?:https?:\/\/)?[^\.]+\.bandcamp\.com\/(?:track|album)\/[^\/\s\?]+/g;

            const channelName = inputChannel.name || 'Unknown Channel';

            if (lastProcessedMessageId) {
                const lastMsgDate = snowflakeToDate(lastProcessedMessageId);
                console.log(`Fetching NEW messages from channel: ${channelName} (ID: ${inputChannel.id})`);
                console.log(`   Last processed message: ID ${lastProcessedMessageId} (sent ~${lastMsgDate})`);
                console.log(`   Fetching messages newer than that...`);
            } else {
                console.log(`Fetching ALL messages from channel: ${channelName} (ID: ${inputChannel.id}) [First run]`);
            }

            while (true) {
                const options = { limit: 100 };
                if (lastProcessedMessageId) {
                    // Incremental mode: always paginate forward using 'after'
                    options.after = newestFetchedId || lastProcessedMessageId;
                } else if (lastId) {
                    // Full mode: paginate backward
                    options.before = lastId;
                }

                const messages = await inputChannel.messages.fetch(options);

                const messageArray = Array.from(messages.values());

                if (lastProcessedMessageId) {
                    // 'after' returns ascending order (oldest→newest); track newest for next page
                    if (messages.size > 0) {
                        newestFetchedId = messages.last()?.id;
                    }
                    // Reverse so newest is first (consistent with full mode processing)
                    messageArray.reverse();
                } else {
                    lastId = messages.last()?.id;
                }

                allMessages = allMessages.concat(messageArray);

                // Progress log every 500 messages collected
                if (allMessages.length > 0 && allMessages.length % 500 === 0) {
                    console.log(`   Progress: collected ${allMessages.length} messages so far...`);
                }

                if (messages.size < 100) break;
                if (!lastProcessedMessageId && !lastId) break;
            }

            if (lastProcessedMessageId) {
                if (allMessages.length === 0) {
                    console.log(`   No new messages found since last run.`);
                } else {
                    const newestDate = snowflakeToDate(newestFetchedId);
                    console.log(`   Found ${allMessages.length} new messages since last run (newest: ~${newestDate})`);
                }
            }
            console.log(`Received ${allMessages.length} messages`);

            // Process each message to find music platform links
            const mediaLinks = {
                youtube: new Set(),
                spotify: new Set(),
                soundcloud: new Set(),
                bandcamp: new Set()
            };
            
            // For save_json: store full message data objects
            const mediaData = {
                youtube: [],
                spotify: [],
                soundcloud: [],
                bandcamp: []
            };

            allMessages.forEach((message) => {
                if (message.content) {
                    // Check for YouTube links
                    const youtubeLinks = extractCleanUrl(message.content, youtubeRegex);
                    if (youtubeLinks) {
                        youtubeLinks.forEach(link => {
                            const linkId = extractYouTubeId(link);
                            if (linkId) {
                                mediaLinks.youtube.add(linkId);
                                if (saveJson) {
                                    mediaData.youtube.push({
                                        id: linkId,
                                        url: link.replace(/^https?:\/\//, ''),
                                        message: message.content,
                                        author: {
                                            id: message.author.id,
                                            username: message.author.username,
                                            tag: message.author.tag
                                        },
                                        timestamp: message.createdAt.toISOString(),
                                        messageId: message.id
                                    });
                                }
                            }
                        });
                    }
                    
                    // Check for standalone YouTube IDs (11 characters, not part of a URL)
                    if (saveJson) {
                        const youtubeIds = message.content.match(youtubeIdRegex);
                        if (youtubeIds) {
                            youtubeIds.forEach(id => {
                                // Only add if it's not already part of a YouTube URL and contains at least one digit (to avoid plain words)
                                const isPartOfUrl = message.content.match(new RegExp(`https?://[^\\s]*${id}`, 'g'));
                                const looksLikeId = /[0-9]/.test(id);
                                if (!isPartOfUrl && looksLikeId && id.length === 11 && !mediaLinks.youtube.has(id)) {
                                    mediaLinks.youtube.add(id);
                                    mediaData.youtube.push({
                                        id: id,
                                        url: `youtube.com/watch?v=${id}`,
                                        message: message.content,
                                        author: {
                                            id: message.author.id,
                                            username: message.author.username,
                                            tag: message.author.tag
                                        },
                                        timestamp: message.createdAt.toISOString(),
                                        messageId: message.id
                                    });
                                }
                            });
                        }
                    }

                    // Check for Spotify links
                    const spotifyLinks = extractCleanUrl(message.content, spotifyRegex);
                    if (spotifyLinks) {
                        spotifyLinks.forEach(link => {
                            const linkId = extractSpotifyId(link);
                            if (linkId) {
                                mediaLinks.spotify.add(linkId);
                                if (saveJson) {
                                    const normalized = link.replace(/^https?:\/\//, '');
                                    mediaData.spotify.push({
                                        id: linkId,
                                        url: normalized,
                                        message: message.content,
                                        author: {
                                            id: message.author.id,
                                            username: message.author.username,
                                            tag: message.author.tag
                                        },
                                        timestamp: message.createdAt.toISOString(),
                                        messageId: message.id
                                    });
                                }
                            }
                        });
                    }
                    
                    // Check for Spotify URIs (spotify:track:...)
                    const spotifyUris = extractCleanUrl(message.content, spotifyUriRegex);
                    if (spotifyUris) {
                        spotifyUris.forEach(uri => {
                            const linkId = extractSpotifyId(uri);
                            if (linkId) {
                                mediaLinks.spotify.add(linkId);
                                if (saveJson) {
                                    mediaData.spotify.push({
                                        id: linkId,
                                        url: uri,
                                        message: message.content,
                                        author: {
                                            id: message.author.id,
                                            username: message.author.username,
                                            tag: message.author.tag
                                        },
                                        timestamp: message.createdAt.toISOString(),
                                        messageId: message.id
                                    });
                                }
                            }
                        });
                    }

                    // Check for SoundCloud links
                    const soundcloudLinks = extractCleanUrl(message.content, soundcloudRegex);
                    if (soundcloudLinks) {
                        soundcloudLinks.forEach(link => {
                            const linkId = extractSoundCloudId(link);
                            if (linkId) {
                                mediaLinks.soundcloud.add(linkId);
                                if (saveJson) {
                                    const normalized = link.replace(/^https?:\/\//, '');
                                    mediaData.soundcloud.push({
                                        id: linkId,
                                        url: normalized,
                                        message: message.content,
                                        author: {
                                            id: message.author.id,
                                            username: message.author.username,
                                            tag: message.author.tag
                                        },
                                        timestamp: message.createdAt.toISOString(),
                                        messageId: message.id
                                    });
                                }
                            }
                        });
                    }

                    // Check for Bandcamp links
                    const bandcampLinks = extractCleanUrl(message.content, bandcampRegex);
                    if (bandcampLinks) {
                        bandcampLinks.forEach(link => {
                            const linkId = extractBandcampId(link);
                            if (linkId) {
                                mediaLinks.bandcamp.add(linkId);
                                if (saveJson) {
                                    const normalized = link.replace(/^https?:\/\//, '');
                                    mediaData.bandcamp.push({
                                        id: linkId,
                                        url: normalized,
                                        message: message.content,
                                        author: {
                                            id: message.author.id,
                                            username: message.author.username,
                                            tag: message.author.tag
                                        },
                                        timestamp: message.createdAt.toISOString(),
                                        messageId: message.id
                                    });
                                }
                            }
                        });
                    }
                }

                // Check for music links in embeds
                message.embeds.forEach(embed => {
                    if (embed.url) {
                        if (embed.url.match(youtubeRegex)) {
                            const linkId = extractYouTubeId(embed.url);
                            if (linkId) {
                                mediaLinks.youtube.add(linkId);
                                if (saveJson) {
                                    const normalized = embed.url.replace(/^https?:\/\//, '');
                                    mediaData.youtube.push({
                                        id: linkId,
                                        url: normalized,
                                        message: message.content || '[Embed]',
                                        author: {
                                            id: message.author.id,
                                            username: message.author.username,
                                            tag: message.author.tag
                                        },
                                        timestamp: message.createdAt.toISOString(),
                                        messageId: message.id
                                    });
                                }
                            }
                        }
                        // Check for Spotify in embeds
                        if (embed.url.match(spotifyRegex)) {
                            const linkId = extractSpotifyId(embed.url);
                            if (linkId) {
                                mediaLinks.spotify.add(linkId);
                                if (saveJson) {
                                    const normalized = embed.url.replace(/^https?:\/\//, '');
                                    mediaData.spotify.push({
                                        id: linkId,
                                        url: normalized,
                                        message: message.content || '[Embed]',
                                        author: {
                                            id: message.author.id,
                                            username: message.author.username,
                                            tag: message.author.tag
                                        },
                                        timestamp: message.createdAt.toISOString(),
                                        messageId: message.id
                                    });
                                }
                            }
                        }
                        // Check for SoundCloud in embeds
                        if (embed.url.match(soundcloudRegex)) {
                            const linkId = extractSoundCloudId(embed.url);
                            if (linkId) {
                                mediaLinks.soundcloud.add(linkId);
                                if (saveJson) {
                                    const normalized = embed.url.replace(/^https?:\/\//, '');
                                    mediaData.soundcloud.push({
                                        id: linkId,
                                        url: normalized,
                                        message: message.content || '[Embed]',
                                        author: {
                                            id: message.author.id,
                                            username: message.author.username,
                                            tag: message.author.tag
                                        },
                                        timestamp: message.createdAt.toISOString(),
                                        messageId: message.id
                                    });
                                }
                            }
                        }
                        // Check for Bandcamp in embeds
                        if (embed.url.match(bandcampRegex)) {
                            const linkId = extractBandcampId(embed.url);
                            if (linkId) {
                                mediaLinks.bandcamp.add(linkId);
                                if (saveJson) {
                                    const normalized = embed.url.replace(/^https?:\/\//, '');
                                    mediaData.bandcamp.push({
                                        id: linkId,
                                        url: normalized,
                                        message: message.content || '[Embed]',
                                        author: {
                                            id: message.author.id,
                                            username: message.author.username,
                                            tag: message.author.tag
                                        },
                                        timestamp: message.createdAt.toISOString(),
                                        messageId: message.id
                                    });
                                }
                            }
                        }
                    }
                });
            });

            // Determine the last processed message ID to save in JSON
            // Incremental: use newestFetchedId (highest snowflake seen); Full: allMessages[0] is newest
            const newLastProcessedMessageId = lastProcessedMessageId
                ? (newestFetchedId || lastProcessedMessageId)
                : (allMessages.length > 0 ? allMessages[0].id : null);

            // Load any existing file for this channel so we can detect new-vs-update, merge,
            // and carry forward the user's youtube_playlist_id across runs.
            const { botDirectory, filename, filepath } = getChannelJsonPath(inputChannel.name);
            const existingData = loadExistingJson(filepath, inputChannel.id);
            const wasUpdating = !!existingData;

            const mergedYoutube = mergeMediaArrays(existingData?.youtube, mediaData.youtube);
            const mergedSpotify = mergeMediaArrays(existingData?.spotify, mediaData.spotify);
            const mergedSoundCloud = mergeMediaArrays(existingData?.soundcloud, mediaData.soundcloud);
            const mergedBandcamp = mergeMediaArrays(existingData?.bandcamp, mediaData.bandcamp);

            const newYoutubeCount = mergedYoutube.length - (existingData?.youtube?.length || 0);
            const newSpotifyCount = mergedSpotify.length - (existingData?.spotify?.length || 0);
            const newSoundCloudCount = mergedSoundCloud.length - (existingData?.soundcloud?.length || 0);
            const newBandcampCount = mergedBandcamp.length - (existingData?.bandcamp?.length || 0);
            const newTotalCount = newYoutubeCount + newSpotifyCount + newSoundCloudCount + newBandcampCount;
            const totalInFile = mergedYoutube.length + mergedSpotify.length + mergedSoundCloud.length + mergedBandcamp.length;

            // The playlist ID this run uses: explicit option wins, otherwise reuse whatever's already in the file.
            const effectiveYoutubePlaylistId = userProvidedPlaylistId || existingData?.youtubePlaylistId || null;

            // Save the JSON file silently (no Discord attachment).
            if (saveJson) {
                try {
                    const jsonData = {
                        channelName: inputChannel.name || 'Unknown Channel',
                        channelId: inputChannel.id,
                        youtubePlaylistId: effectiveYoutubePlaylistId,
                        dateRan: new Date().toISOString(),
                        lastProcessedMessageId: newLastProcessedMessageId,
                        totalTracks: totalInFile,
                        youtube: mergedYoutube,
                        spotify: mergedSpotify,
                        soundcloud: mergedSoundCloud,
                        bandcamp: mergedBandcamp
                    };

                    console.log(`💾 ${wasUpdating ? 'Updating' : 'Creating'} JSON file: ${filepath}`);
                    console.log(`   New this run: ${newTotalCount} (YT ${newYoutubeCount} / SP ${newSpotifyCount} / SC ${newSoundCloudCount} / BC ${newBandcampCount})`);
                    console.log(`   Total in file: ${totalInFile} (YT ${mergedYoutube.length} / SP ${mergedSpotify.length} / SC ${mergedSoundCloud.length} / BC ${mergedBandcamp.length})`);
                    if (effectiveYoutubePlaylistId) {
                        console.log(`   youtubePlaylistId: ${effectiveYoutubePlaylistId}`);
                    }

                    fs.writeFileSync(filepath, JSON.stringify(jsonData, null, 2), 'utf8');
                    console.log(`✅ ${wasUpdating ? 'Updated' : 'Created'} ${filename}`);
                } catch (error) {
                    console.error('❌ Error saving JSON file:', error);
                    try {
                        await outputChannel.send(`❌ **Error saving JSON file:** ${error.message}`);
                    } catch (sendError) {
                        console.error('❌ Error sending error message to Discord:', sendError);
                    }
                }
            }

            // Build YouTube playlists from EVERY unique video ID in the file (not just this run's),
            // so the user always sees the full library of 50-video chunks.
            const allYouTubeIdsInFile = Array.from(new Set(mergedYoutube.map(item => item.id).filter(Boolean)));
            const playlistChunks = chunkArray(allYouTubeIdsInFile, 50);
            const playlistUrls = playlistChunks.map(chunk =>
                `http://www.youtube.com/watch_videos?video_ids=${chunk.join(',')}`
            );

            // ── Build the summary message ────────────────────────────────────────────
            let summary = wasUpdating
                ? `🔄 **Updated existing file** \`${filename}\`\n\n`
                : `🆕 **Created new file** \`${filename}\`\n\n`;

            if (newTotalCount > 0) {
                summary += `**🆕 New links this run: ${newTotalCount}**\n`;
                if (newYoutubeCount    > 0) summary += `   📺 YouTube: ${newYoutubeCount}\n`;
                if (newSpotifyCount    > 0) summary += `   🎵 Spotify: ${newSpotifyCount}\n`;
                if (newSoundCloudCount > 0) summary += `   🎧 SoundCloud: ${newSoundCloudCount}\n`;
                if (newBandcampCount   > 0) summary += `   💿 Bandcamp: ${newBandcampCount}\n`;
                summary += `\n`;
            }

            summary += `**📊 Total in file: ${totalInFile}**\n`;
            summary += `   📺 YouTube: ${mergedYoutube.length}\n`;
            summary += `   🎵 Spotify: ${mergedSpotify.length}\n`;
            summary += `   🎧 SoundCloud: ${mergedSoundCloud.length}\n`;
            summary += `   💿 Bandcamp: ${mergedBandcamp.length}\n\n`;

            if (effectiveYoutubePlaylistId) {
                // Always naked URL so Discord renders the playlist preview card.
                // (The embedd_youtube_links flag only suppresses the 50-video chunk URLs.)
                summary += `🎵 **Your YouTube Playlist:** https://www.youtube.com/playlist?list=${effectiveYoutubePlaylistId}\n\n`;
            }

            if (repeat) {
                const nextRun = getNextCronRunTime(repeat);
                summary += `🔁 **Auto-repeat:** \`${repeat}\`\n`;
                summary += `⏰ **Next run:** ${nextRun ? `<t:${Math.floor(nextRun.getTime() / 1000)}:F> (<t:${Math.floor(nextRun.getTime() / 1000)}:R>)` : 'unknown'}\n\n`;
            }

            if (allYouTubeIdsInFile.length === 0) {
                summary += `_No YouTube links in this channel yet._`;
            } else if (!outputYoutubeLinks) {
                summary += `_${playlistUrls.length} YouTube playlist link${playlistUrls.length === 1 ? '' : 's'} generated but not posted (\`output_youtube_links\`=false)._`;
            }

            await outputChannel.send(summary.trim());

            // ── Post inline numbered playlist links: [1](url), [2](url), [3](url), … ──
            // Each link renders as just the number; whole list flows like "1, 2, 3, 4, …"
            // with no newlines between links. The header gets its own message so the
            // link list stays on a single flowing line (modulo Discord's 2000-char split).
            if (outputYoutubeLinks && playlistUrls.length > 0) {
                await outputChannel.send(`**📺 YouTube playlists (${playlistUrls.length} × up to 50 videos):**`);

                const SEP = ', ';
                const chunks = [];
                let current = '';
                for (let i = 0; i < playlistUrls.length; i++) {
                    // [N](<url>) form suppresses Discord's link-preview embed; [N](url) allows it.
                    const url = embeddYoutubeLinks ? playlistUrls[i] : `<${playlistUrls[i]}>`;
                    const link = `[${i + 1}](${url})`;
                    const addition = current.length === 0 ? link : SEP + link;
                    if (current.length + addition.length > 1950) {
                        chunks.push(current);
                        current = link;
                    } else {
                        current += addition;
                    }
                }
                if (current.length > 0) chunks.push(current);

                for (const chunk of chunks) {
                    await outputChannel.send(chunk);
                }
            }

            // ── Confirm back to the invoker ─────────────────────────────────────────
            let confirmMessage =
                `✅ ${wasUpdating ? 'Updated' : 'Created'} \`${filename}\`. ` +
                `${newTotalCount} new link${newTotalCount === 1 ? '' : 's'} added, ` +
                `${totalInFile} total in file. ` +
                `${playlistUrls.length} YouTube playlist link${playlistUrls.length === 1 ? '' : 's'} ` +
                `${outputYoutubeLinks ? 'posted' : 'generated (not posted)'}.` +
                `${outputChannel.id !== inputChannel.id ? ` Sent to ${outputChannel}.` : ''}`;

            if (repeat) {
                const repeatKey = getRepeatJobKey(interaction.guildId, inputChannel.id, outputChannel.id);
                const existingJob = repeatJobs.get(repeatKey);
                if (existingJob) {
                    // node-cron v3 only exposes .stop() — .destroy() was removed.
                    existingJob.task.stop();
                    repeatJobs.delete(repeatKey);
                }

                let isRunning = false;
                const task = cron.schedule(repeat, async () => {
                    if (isRunning) {
                        console.log(`[Repeat /makeplaylists] Previous run still active for ${repeatKey}, skipping this tick.`);
                        return;
                    }

                    isRunning = true;
                    try {
                        const resolvedInput = await interaction.client.channels.fetch(inputChannel.id);
                        const resolvedOutput = await interaction.client.channels.fetch(outputChannel.id);

                        if (!resolvedInput || resolvedInput.type !== ChannelType.GuildText) {
                            console.error(`[Repeat /makeplaylists] Input channel unavailable or not text for ${repeatKey}`);
                            return;
                        }

                        if (!resolvedOutput || resolvedOutput.type !== ChannelType.GuildText) {
                            console.error(`[Repeat /makeplaylists] Output channel unavailable or not text for ${repeatKey}`);
                            return;
                        }

                        const scheduledInteraction = createScheduledInteraction({
                            client: interaction.client,
                            inputChannel: resolvedInput,
                            outputChannel: resolvedOutput,
                            embeddYoutubeLinks,
                            outputYoutubeLinks,
                            saveJson,
                            repeat,
                            youtubePlaylistId: effectiveYoutubePlaylistId
                        });

                        await module.exports.execute(scheduledInteraction);
                    } catch (scheduledError) {
                        console.error(`[Repeat /makeplaylists] Scheduled run failed for ${repeatKey}:`, scheduledError);
                    } finally {
                        isRunning = false;
                    }
                });

                repeatJobs.set(repeatKey, { task, repeat });
                const nextRunTime = getNextCronRunTime(repeat);
                const nextRunStr = nextRunTime ? nextRunTime.toLocaleString() : 'unknown';
                confirmMessage += ` Repeat scheduled with cron: \`${repeat}\`. Next run: ${nextRunStr}.`;
                console.log(`🔁 Repeat scheduled: ${repeat}`);
                console.log(`⏰ Next run: ${nextRunStr}`);
            }
            
            await interaction.editReply(confirmMessage);

            console.log(`${wasUpdating ? 'Updated' : 'Created'} ${filename}: +${newTotalCount} new, ${totalInFile} total, ${playlistUrls.length} playlist link(s) over ${allYouTubeIdsInFile.length} unique YouTube videos`);
            if (!repeat) {
                console.log(`🔁 Repeat: not set — this command will not auto-repeat`);
            }

        } catch (error) {
            // Errors stay in the bot console — never surfaced to Discord as user-visible text.
            console.error('❌ /makeplaylists failed:', error);
            if (error.code === 50001) {
                console.error(`   → Missing Access on output channel #${outputChannel?.name}. Bot needs View Channel + Send Messages.`);
            } else if (error.code === 50013) {
                console.error('   → Missing Permissions. Bot needs View Channel + Send Messages + Read Message History.');
            }

            // Discord still requires a reply after deferReply(); use a neutral ack so no error text leaks.
            try {
                await interaction.editReply('Done.');
            } catch (replyErr) {
                console.error('   → Could not edit reply:', replyErr.message);
            }
        }
    },
    repeatJobs,
    getRepeatJobKey,
};