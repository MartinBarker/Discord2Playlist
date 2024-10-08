const express = require('express');
const { google } = require('googleapis');
const readline = require('readline');
require('dotenv').config()

var GCP_CLIENT_ID = process.env.GCP_CLIENT_ID;
var GCP_CLIENT_SECRET = process.env.GCP_CLIENT_SECRET;

const app = express();
const PORT = 3000;

// Replace these with your own OAuth 2.0 credentials
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

app.get('/oauth2callback', async (req, res) => {
    const { code } = req.query;
    if (code) {
        try {
            const { tokens } = await oauth2Client.getToken(code);
            oauth2Client.setCredentials(tokens);
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

function extractPlaylistId(url) {
    const match = url.match(/[?&]list=([^#\&\?]+)/);
    return match && match[1];
}

function extractVideoId(url) {
    const match = url.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\/(?:watch\?v=)?(?:embed\/)?(?:v\/)?(?:shorts\/)?([a-zA-Z0-9_-]+)/);
    return match && match[1];
}

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

const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes
});

console.log('Please open the following URL in your browser to authenticate:');
console.log(authUrl);

// Use dynamic import for the `open` module
(async () => {
    const open = (await import('open')).default;
    open(authUrl);
})();

const server = app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
