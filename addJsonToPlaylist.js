const { google } = require('googleapis');
const fs = require('fs');
const readline = require('readline');
require('dotenv').config();

const TOKEN_PATH = 'tokens.json';
const LINKS_JSON_PATH = 'youtube_links.json';

var GCP_CLIENT_ID = process.env.GCP_CLIENT_ID;
var GCP_CLIENT_SECRET = process.env.GCP_CLIENT_SECRET;

const oauth2Client = new google.auth.OAuth2(
    GCP_CLIENT_ID,
    GCP_CLIENT_SECRET,
    'http://localhost:3000/oauth2callback'
);

const youtube = google.youtube({
    version: 'v3',
    auth: oauth2Client
});

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
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

// Load YouTube links from JSON file
function loadYouTubeLinks() {
    if (fs.existsSync(LINKS_JSON_PATH)) {
        const data = fs.readFileSync(LINKS_JSON_PATH, 'utf-8');
        return JSON.parse(data);
    }
    return [];
}

// Save updated YouTube links to JSON file
function saveYouTubeLinks(links) {
    fs.writeFileSync(LINKS_JSON_PATH, JSON.stringify(links, null, 2), 'utf-8');
    console.log('YouTube links saved to', LINKS_JSON_PATH);
}

// Function to add video to YouTube playlist
async function addVideoToPlaylist(playlistId, videoId) {
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
        console.log(`Video ${videoId} added to playlist successfully!`);
        return true;
    } catch (error) {
        console.error(`Error adding video ${videoId}:`, error.message);
        return false;
    }
}

// OAuth2 callback route
function startOAuthFlow() {
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline', // Ensures we get a refresh token
        scope: ['https://www.googleapis.com/auth/youtube.force-ssl']
    });

    console.log('Please open the following URL in your browser to authenticate:');
    console.log(authUrl);

    // Use dynamic import for the `open` module
    (async () => {
        const open = (await import('open')).default;
        open(authUrl);
    })();
}

// Prompt user to enter playlist ID and begin processing
function promptForPlaylistId() {
    rl.question('Enter the YouTube playlist ID: ', async (playlistId) => {
        if (!playlistId) {
            console.log('Invalid playlist ID. Please try again.');
            return promptForPlaylistId();
        }

        const youtubeLinks = loadYouTubeLinks();
        if (youtubeLinks.length === 0) {
            console.log('No YouTube links found in the JSON file.');
            rl.close();
            return;
        }

        // Process each video in the JSON file
        for (let video of youtubeLinks) {
            if (!video.added) {
                const success = await addVideoToPlaylist(playlistId, video.url);
                if (success) {
                    video.added = true; // Mark as added if successful
                    saveYouTubeLinks(youtubeLinks); // Update the JSON file
                }
            } else {
                console.log(`Video ${video.url} already added to the playlist.`);
            }
        }

        rl.close();
    });
}

// Handle the OAuth2 callback
function handleOAuthCallback(req, res) {
    const { code } = req.query;
    if (code) {
        oauth2Client.getToken(code, (err, tokens) => {
            if (err) {
                console.error('Error getting tokens:', err.message);
                res.status(500).send('Authentication failed.');
                return;
            }

            oauth2Client.setCredentials(tokens);
            saveTokens(tokens); // Save tokens after successful authentication
            res.send('Authentication successful! You can close this window and return to the console.');
            promptForPlaylistId();
        });
    } else {
        res.status(400).send('No code found in the request.');
    }
}

// Start the OAuth flow or use existing tokens
if (loadTokens()) {
    // If tokens are loaded, prompt for the playlist ID
    promptForPlaylistId();
} else {
    startOAuthFlow();
}
