const { SlashCommandBuilder, IntentsBitField } = require('discord.js');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Update the TOKEN_PATH to reference the root directory
const TOKEN_PATH = path.join(__dirname, '../../tokens.json');
const PLAYLIST_ID = process.env.PLAYLIST_ID;

// OAuth2 client
const oauth2Client = new google.auth.OAuth2(
    process.env.GCP_CLIENT_ID,
    process.env.GCP_CLIENT_SECRET,
    'http://localhost:3000/oauth2callback'
);

// Load the YouTube OAuth2 tokens from the JSON file
function loadTokens() {
    try {
        const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH));
        oauth2Client.setCredentials(tokens);
        console.log('Tokens loaded from file.');

        // Check if the access token is expired and refresh if necessary
        if (oauth2Client.isTokenExpiring()) {
            return refreshAccessToken();
        }

        return true;
    } catch (error) {
        console.error('No valid tokens found, please authenticate:', error.message);
        return false;
    }
}

// Refresh the access token using the refresh token
function refreshAccessToken() {
    return new Promise((resolve, reject) => {
        oauth2Client.refreshAccessToken((err, tokens) => {
            if (err) {
                console.error('Error refreshing access token:', err.message);
                return reject(err);
            }
            // Save the refreshed tokens back to the file
            fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
            console.log('Access token refreshed and saved.');
            oauth2Client.setCredentials(tokens);
            resolve(true);
        });
    });
}

// Add video to YouTube playlist
async function addVideoToPlaylist(playlistId, videoId) {
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    try {
        await youtube.playlistItems.insert({
            part: 'snippet',
            requestBody: {
                snippet: {
                    playlistId: playlistId,
                    resourceId: {
                        kind: 'youtube#video',
                        videoId: videoId
                    }
                }
            }
        });
        console.log(`Added video ${videoId} to playlist.`);
    } catch (error) {
        console.error(`Error adding video ${videoId} to playlist: ${error.message}`);
    }
}

// Check if video already exists in playlist
async function isVideoInPlaylist(playlistId, videoId) {
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    try {
        const response = await youtube.playlistItems.list({
            part: 'snippet',
            playlistId: playlistId,
            maxResults: 50
        });
        const items = response.data.items;
        return items.some(item => item.snippet.resourceId.videoId === videoId);
    } catch (error) {
        console.error(`Error checking playlist for video ${videoId}: ${error.message}`);
        return false;
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('getallchannelmessages')
        .setDescription('v1.1 Fetch all messages, YouTube links, and add them to a playlist'),
    async execute(interaction) {
        await interaction.deferReply();
        const channel = interaction.channel;

        try {
            let allMessages = [];
            let lastId;
            let youtubeLinks = [];

            // Regular expression to match YouTube links
            const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\/(?:watch\?v=)?(?:embed\/)?(?:v\/)?(?:shorts\/)?([a-zA-Z0-9_-]+)/g;

            console.log(`Fetching messages from channel: ${channel.name} (ID: ${channel.id})`);

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

            console.log(`Received ${allMessages.length} messages`);

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
                const alreadyInPlaylist = await isVideoInPlaylist(PLAYLIST_ID, videoId);
                if (!alreadyInPlaylist) {
                    await addVideoToPlaylist(PLAYLIST_ID, videoId);
                    addedCount++;
                } else {
                    console.log(`Video ${videoId} is already in the playlist.`);
                }
            }

            // Respond to the interaction
            await interaction.editReply(`Processed ${allMessages.length} messages from channel #${channel.name}. Added ${addedCount} new YouTube links to the playlist.`);

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
