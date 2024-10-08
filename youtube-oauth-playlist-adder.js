const express = require('express');
const { google } = require('googleapis');
const fs = require('fs');
const readline = require('readline');
require('dotenv').config();

const TOKEN_PATH = 'tokens.json';

var GCP_CLIENT_ID = process.env.GCP_CLIENT_ID;
var GCP_CLIENT_SECRET = process.env.GCP_CLIENT_SECRET;

const app = express();
const PORT = 3000;

// OAuth2 client
const oauth2Client = new google.auth.OAuth2(
    GCP_CLIENT_ID,
    GCP_CLIENT_SECRET,
    'http://localhost:3000/oauth2callback'
);

const scopes = [
    'https://www.googleapis.com/auth/youtube.force-ssl'
];

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const youtube = google.youtube({
    version: 'v3',
    auth: oauth2Client
});

// Function to load tokens from the JSON file
function loadTokens() {
    try {
        const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH));
        oauth2Client.setCredentials(tokens);
        console.log('Tokens loaded from file.');
        return true;
    } catch (error) {
        console.log('No tokens found, starting OAuth flow...');
        return false;
    }
}

// Function to save tokens to the JSON file
function saveTokens(tokens) {
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
    console.log('Tokens saved to', TOKEN_PATH);
}

// OAuth2 callback route
app.get('/oauth2callback', async (req, res) => {
    const { code } = req.query;
    if (code) {
        try {
            const { tokens } = await oauth2Client.getToken(code);
            oauth2Client.setCredentials(tokens);
            saveTokens(tokens); // Save tokens after successful authentication
            res.send('Authentication successful! You can close this window and return to the console.');
            server.close(() => {
                console.log('OAuth flow completed. Server closed.');
                promptForPlaylist();
            });
        } catch (error) {
            console.error('Error getting tokens:', error);
            res.status(500).send('Authentication failed.');
        }
    } else {
        res.status(400).send('No code found in the request.');
    }
});

// Prompt the user to enter playlist and video URLs
function promptForPlaylist() {
    rl.question('Enter the YouTube playlist URL: ', (playlistUrl) => {
        const playlistId = extractPlaylistId(playlistUrl);
        if (playlistId) {
            rl.question('Enter the YouTube video URL to add: ', (videoUrl) => {
                const videoId = extractVideoId(videoUrl);
                if (videoId) {
                    addVideoToPlaylist(playlistId, videoId);
                } else {
                    console.log('Invalid video URL. Please try again.');
                    promptForPlaylist();
                }
            });
        } else {
            console.log('Invalid playlist URL. Please try again.');
            promptForPlaylist();
        }
    });
}

// Extract YouTube playlist ID from URL
function extractPlaylistId(url) {
    const match = url.match(/[?&]list=([^#\&\?]+)/);
    return match && match[1];
}

// Extract YouTube video ID from URL
function extractVideoId(url) {
    const match = url.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\/(?:watch\?v=)?(?:embed\/)?(?:v\/)?(?:shorts\/)?([a-zA-Z0-9_-]+)/);
    return match && match[1];
}

// Add video to YouTube playlist
async function addVideoToPlaylist(playlistId, videoId) {
    try {
        const response = await youtube.playlistItems.insert({
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
        console.log('Video added to playlist successfully!');
        rl.close();
    } catch (error) {
        console.error('Error adding video to playlist:', error.message);
        rl.close();
    }
}

// Start the OAuth flow or use existing tokens
if (loadTokens()) {
    // If tokens are loaded, start the video adding process
    promptForPlaylist();
} else {
    // If no tokens are found, start OAuth flow
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline', // Ensures we get a refresh token
        scope: scopes
    });

    console.log('Please open the following URL in your browser to authenticate:');
    console.log(authUrl);

    // Use dynamic import for the `open` module
    (async () => {
        const open = (await import('open')).default;
        open(authUrl);
    })();
}

const server = app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
