const { SlashCommandBuilder, ChannelType, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

const OUTPUT_FILENAME_FORMAT = '{sanitized_channel_name}.json';

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
                .setDescription('If true, prevents video embedding by wrapping URLs in angle brackets (default: false)')
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
                .setRequired(false)),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const inputChannel = interaction.options.getChannel('input_channel') || interaction.channel;
        const outputChannel = interaction.options.getChannel('output_channel') || inputChannel;
        const embeddYoutubeLinks = interaction.options.getBoolean('embedd_youtube_links') || false;
        const outputYoutubeLinks = interaction.options.getBoolean('output_youtube_links') || false;
        const saveJson = interaction.options.getBoolean('save_json') ?? true;

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

        // Print command and flag information
        console.log(`\n📝 Command: /makeplaylists`);
        console.log(`   Input Channel: ${inputChannel.name} (ID: ${inputChannel.id})`);
        if (outputChannel.id !== inputChannel.id) {
            console.log(`   Output Channel: ${outputChannel.name} (ID: ${outputChannel.id})`);
        } else {
            console.log(`   Output Channel: ${outputChannel.name} (ID: ${outputChannel.id}) [same as input]`);
        }
        console.log(`   Flags:`);
        console.log(`     - embedd_youtube_links: ${embeddYoutubeLinks}`);
        console.log(`     - output_youtube_links: ${outputYoutubeLinks}`);
        console.log(`     - save_json: ${saveJson}`);
        console.log(``);

        try {
            let allMessages = [];
            let lastId;
            
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
                console.log(`Fetching NEW messages from channel: ${channelName} (ID: ${inputChannel.id})`);
                console.log(`   Last processed message ID: ${lastProcessedMessageId}`);
            } else {
                console.log(`Fetching ALL messages from channel: ${channelName} (ID: ${inputChannel.id}) [First run]`);
            }

            while (true) {
                const options = { limit: 100 };
                if (lastId) {
                    options.before = lastId;
                } else if (lastProcessedMessageId) {
                    // If we have a last processed message, only fetch messages after it
                    options.after = lastProcessedMessageId;
                }

                const messages = await inputChannel.messages.fetch(options);
                
                // If using 'after', messages are in ascending order, so reverse to match descending order
                const messageArray = Array.from(messages.values());
                if (lastProcessedMessageId && !lastId) {
                    messageArray.reverse();
                }
                
                allMessages = allMessages.concat(messageArray);
                
                lastId = messages.last()?.id;

                // Progress log every 500 messages collected
                if (allMessages.length > 0 && allMessages.length % 500 === 0) {
                    console.log(`   Progress: collected ${allMessages.length} messages so far...`);
                }

                // If fetching after a specific message (incremental), stop when we've got all new messages
                if (lastProcessedMessageId && !lastId && messages.size < 100) {
                    break;
                }

                if (messages.size != 100 || !lastId) {
                    break;
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

            // Convert YouTube Set to array and create playlists
            const youtubeIds = Array.from(mediaLinks.youtube);
            
            // Determine the last processed message ID to save in JSON
            const newLastProcessedMessageId = allMessages.length > 0 ? allMessages[0].id : lastProcessedMessageId;
            
            // Save JSON file with organized media sources if save_json flag is enabled
            if (saveJson) {
                console.log('💾 save_json flag is enabled - preparing to save organized JSON file...');
                try {
                    const { botDirectory, filename, filepath } = getChannelJsonPath(inputChannel.name);
                    const existingData = loadExistingJson(filepath, inputChannel.id);

                    const mergedYoutube = mergeMediaArrays(existingData?.youtube, mediaData.youtube);
                    const mergedSpotify = mergeMediaArrays(existingData?.spotify, mediaData.spotify);
                    const mergedSoundCloud = mergeMediaArrays(existingData?.soundcloud, mediaData.soundcloud);
                    const mergedBandcamp = mergeMediaArrays(existingData?.bandcamp, mediaData.bandcamp);

                    // Build the JSON structure with message objects
                    const jsonData = {
                        channelName: inputChannel.name || 'Unknown Channel',
                        channelId: inputChannel.id,
                        dateRan: new Date().toISOString(),
                        lastProcessedMessageId: newLastProcessedMessageId,
                        totalTracks: mergedYoutube.length + mergedSpotify.length + mergedSoundCloud.length + mergedBandcamp.length,
                        youtube: mergedYoutube,
                        spotify: mergedSpotify,
                        soundcloud: mergedSoundCloud,
                        bandcamp: mergedBandcamp
                    };

                    console.log(`📁 Saving organized JSON file...`);
                    console.log(`   📄 Filename: ${filename}`);
                    console.log(`   📂 Directory: ${botDirectory}`);
                    console.log(`   🔗 Full Path: ${filepath}`);
                    console.log(`   📊 Data: ${jsonData.totalTracks} total tracks from channel "${inputChannel.name}"`);
                    console.log(`   📺 YouTube: ${mergedYoutube.length}`);
                    console.log(`   🎵 Spotify: ${mergedSpotify.length}`);
                    console.log(`   🎧 SoundCloud: ${mergedSoundCloud.length}`);
                    console.log(`   💿 Bandcamp: ${mergedBandcamp.length}`);

                    fs.writeFileSync(filepath, JSON.stringify(jsonData, null, 2), 'utf8');

                    console.log(`✅ Successfully saved organized JSON file`);
                    console.log(`   📄 File: ${filename}`);
                    console.log(`   📂 Location: ${filepath}`);

                    // Send message to Discord about saved JSON file
                    try {
                        const jsonAttachment = new AttachmentBuilder(filepath, {
                            name: filename,
                            description: `Organized media links from ${inputChannel.name}`
                        });

                        await outputChannel.send({
                            content: `💾 **JSON file saved successfully!**\n` +
                                   `📄 **File:** ${filename}\n` +
                                   `📊 **Total tracks:** ${jsonData.totalTracks}\n` +
                                   `   📺 YouTube: ${mergedYoutube.length}\n` +
                                   `   🎵 Spotify: ${mergedSpotify.length}\n` +
                                   `   🎧 SoundCloud: ${mergedSoundCloud.length}\n` +
                                   `   💿 Bandcamp: ${mergedBandcamp.length}`,
                            files: [jsonAttachment]
                        });

                        console.log(`✅ Sent JSON file message to ${outputChannel.name}`);
                    } catch (error) {
                        console.error('❌ Error sending JSON file message to Discord:', error);
                        // Don't fail the whole command if message sending fails
                    }
                } catch (error) {
                    console.error('❌ Error saving organized JSON file:');
                    console.error(`   Error: ${error.message}`);
                    console.error(`   Stack: ${error.stack}`);

                    // Send error message to Discord
                    try {
                        await outputChannel.send(`❌ **Error saving JSON file:** ${error.message}`);
                    } catch (sendError) {
                        console.error('❌ Error sending error message to Discord:', sendError);
                    }
                }
            }
            
            const playlistChunks = chunkArray(youtubeIds, 50);
            const playlistUrls = playlistChunks.map(chunk => {
                const idsString = chunk.join(',');
                return `http://www.youtube.com/watch_videos?video_ids=${idsString}`;
            });

            // Build response message with plain URLs (no markdown links)
            let response = `**Media Links Found:**\n`;
            response += `📺 YouTube: ${mediaLinks.youtube.size}\n`;
            response += `🎵 Spotify: ${mediaLinks.spotify.size}\n`;
            response += `🎧 SoundCloud: ${mediaLinks.soundcloud.size}\n`;
            response += `💿 Bandcamp: ${mediaLinks.bandcamp.size}\n\n`;

            if (youtubeIds.length === 0) {
                response += `No YouTube links found to create playlists.`;
            } else if (outputYoutubeLinks) {
                response += `**YouTube Playlists (${playlistUrls.length} playlist${playlistUrls.length > 1 ? 's' : ''}):**\n\n`;
                playlistUrls.forEach((url, index) => {
                    const urlFormat = embeddYoutubeLinks ? url : `<${url}>`;
                    response += `[YouTube Playlist ${index + 1} (${playlistChunks[index].length} videos)](${urlFormat})\n`;
                });
            } else {
                response += `YouTube playlists generated but not posted (output_youtube_links=false).`;
            }

            // Discord has a 2000 character limit for messages
            // If message is too long, we'll need to split it intelligently
            if (outputYoutubeLinks && response.length > 2000) {
                const parts = [];
                const header = `**Media Links Found:**\n`;
                const headerContent = `📺 YouTube: ${mediaLinks.youtube.size}\n`;
                const headerContent2 = `🎵 Spotify: ${mediaLinks.spotify.size}\n`;
                const headerContent3 = `🎧 SoundCloud: ${mediaLinks.soundcloud.size}\n`;
                const headerContent4 = `💿 Bandcamp: ${mediaLinks.bandcamp.size}\n\n`;
                const playlistHeader = `**YouTube Playlists (${playlistUrls.length} playlist${playlistUrls.length > 1 ? 's' : ''}):**\n\n`;
                
                // Start with header in first message
                let currentPart = header + headerContent + headerContent2 + headerContent3 + headerContent4 + playlistHeader;

                // Add playlist URLs, splitting when needed
                playlistUrls.forEach((url, index) => {
                    const urlFormat = embeddYoutubeLinks ? url : `<${url}>`;
                    const playlistLine = `[YouTube Playlist ${index + 1} (${playlistChunks[index].length} videos)](${urlFormat})\n`;
                    // Check if adding this line would exceed limit (leave some buffer)
                    if (currentPart.length + playlistLine.length > 1950) {
                        parts.push(currentPart.trim());
                        currentPart = playlistLine;
                    } else {
                        currentPart += playlistLine;
                    }
                });
                
                // Add remaining content
                if (currentPart.length > 0) {
                    parts.push(currentPart.trim());
                }

                // Send all parts to output channel
                for (const part of parts) {
                    await outputChannel.send(part);
                }
            } else {
                await outputChannel.send(response);
            }

            // Confirm to user
            let confirmMessage = `✅ Successfully created ${playlistUrls.length} YouTube playlist(s) with ${youtubeIds.length} total videos. ${outputChannel.id !== inputChannel.id ? `Sent to ${outputChannel}.` : ''}`;
            
            await interaction.editReply(confirmMessage);

            console.log(`Created ${playlistUrls.length} YouTube playlist(s) with ${youtubeIds.length} total videos`);

        } catch (error) {
            console.error('Error fetching messages:', error);
            let errorMessage = `An error occurred while fetching messages and creating playlists: ${error.message}`;
            
            // Provide more helpful error messages for common permission issues
            if (error.code === 50001) {
                errorMessage = `Missing Access: The bot does not have permission to access the output channel (${outputChannel.name}). Please ensure the bot has "View Channel" and "Send Messages" permissions in that channel.`;
            } else if (error.code === 50013) {
                errorMessage = `Missing Permissions: The bot is missing required permissions. Please check that the bot has "View Channel", "Send Messages", and "Read Message History" permissions.`;
            }
            
            await interaction.editReply(errorMessage);
        }
    },
};