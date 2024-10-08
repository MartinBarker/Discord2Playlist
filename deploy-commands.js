const { SlashCommandBuilder } = require('discord.js');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const TOKEN_PATH = path.join(__dirname, '../../tokens.json');
const PLAYLIST_ID = process.env.PLAYLIST_ID;

const oauth2Client = new google.auth.OAuth2(
    process.env.GCP_CLIENT_ID,
    process.env.GCP_CLIENT_SECRET,
    'http://localhost:3000/oauth2callback'
);

const MAX_RETRIES = 5;
const INITIAL_DELAY = 1000; // 1 second

// Load YouTube OAuth2 tokens
function loadTokens() {
    try {
        const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH));
        oauth2Client.setCredentials(tokens);
        return true;
    } catch (error) {
        console.error('No valid tokens found, please authenticate.');
        return false;
    }
}

// Add video to YouTube playlist with exponential backoff
async function addVideoToPlaylist(playlistId, videoId) {
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    let retries = 0;
    let delay = INITIAL_DELAY;

    while (retries < MAX_RETRIES) {
        try {
            await youtube.playlistItems.insert({
                part: 'snippet',
                requestBody: {
                    snippet: {
                        playlistId: playlistId,
                        resourceId: {
                            kind: 'youtube#video',
                            videoId: videoId,
                        },
                    },
                },
            });
            console.log(`Added video ${videoId} to playlist.`);
            break; // Success, break the loop
        } catch (error) {
            if (error.errors && error.errors[0].reason === 'quotaExceeded') {
                retries++;
                console.error(`Quota exceeded. Retrying in ${delay / 1000} seconds...`);
                await sleep(delay); // Wait for the delay before retrying
                delay *= 2; // Exponential backoff: double the delay
            } else {
                console.error(`Error adding video ${videoId} to playlist: ${error.message}`);
                break; // Break on non-quota errors
            }
        }
    }

    if (retries === MAX_RETRIES) {
        console.error(`Failed to add video ${videoId} after ${MAX_RETRIES} retries.`);
    }
}

// Sleep function to introduce a delay
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('getallchannelmessages')
        .setDescription('Fetch all messages, YouTube links, and add them to a playlist'),
    async execute(interaction) {
        await interaction.deferReply();
        const channel = interaction.channel;

        try {
            let allMessages = [];
            let lastId;
            let youtubeLinks = [];

            // Regular expression to match YouTube links
            const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\/(?:watch\?v=)?(?:embed\/)?(?:v\/)?(?:shorts\/)?([a-zA-Z0-9_-]+)/g;

            while (true) {
                const options = { limit: 100 };
                if (lastId) {
                    options.before = lastId;
                }

                const messages = await channel.messages.fetch(options);
                allMessages = allMessages.concat(Array.from(messages.values()));
                lastId = messages.last()?.id;

                if (messages.size != 100 || !lastId) {
                    break;
                }
            }

            // Process each message to find YouTube links
            allMessages.forEach((message) => {
                if (message.content) {
                    const links = message.content.match(youtubeRegex);
                    if (links) {
                        youtubeLinks = youtubeLinks.concat(links);
                    }
                }

                // Check for YouTube links in embeds
                message.embeds.forEach(embed => {
                    if (embed.url && embed.url.match(youtubeRegex)) {
                        youtubeLinks.push(embed.url);
                    }
                });
            });

            // Remove duplicates from YouTube links
            youtubeLinks = [...new Set(youtubeLinks.map(link => extractVideoId(link)))];

            console.log(`Total YouTube links found: ${youtubeLinks.length}`);
            youtubeLinks.forEach((link, index) => {
                console.log(`${index + 1}. ${link}`);
            });

            if (!loadTokens()) {
                await interaction.editReply('OAuth2 tokens not found. Please authenticate first.');
                return;
            }

            // Add YouTube links to playlist
            let addedCount = 0;
            for (const videoId of youtubeLinks) {
                await addVideoToPlaylist(PLAYLIST_ID, videoId);
                addedCount++;
            }

            await interaction.editReply(`Processed ${allMessages.length} messages from channel #${channel.name}. Added ${addedCount} YouTube links to the playlist.`);
        } catch (error) {
            console.error('Error fetching messages:', error);
            await interaction.editReply('An error occurred while fetching messages or adding videos to the playlist.');
        }
    },
};

// Helper function to extract YouTube video ID from a URL
function extractVideoId(url) {
    const match = url.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\/(?:watch\?v=)?(?:embed\/)?(?:v\/)?(?:shorts\/)?([a-zA-Z0-9_-]+)/);
    return match && match[1];
}
