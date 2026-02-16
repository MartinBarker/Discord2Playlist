// youtube-playlist-sync.js
require('dotenv').config();
const fs = require('fs').promises;
const { google } = require('googleapis');
const http = require('http');

function getTimestamp() {
  return new Date().toISOString();
}

function withTimestamp(args) {
  const prefix = `[${getTimestamp()}]`;
  return [prefix, ...args];
}

const originalConsoleLog = console.log.bind(console);
const originalConsoleWarn = console.warn.bind(console);
const originalConsoleError = console.error.bind(console);

console.log = (...args) => originalConsoleLog(...withTimestamp(args));
console.warn = (...args) => originalConsoleWarn(...withTimestamp(args));
console.error = (...args) => originalConsoleError(...withTimestamp(args));

// Hardcoded playlist ID
const YOUTUBE_PLAYLIST_ID = "PLpQuORMLvnZYNvmEiFPLxpjAKv9UDSQaN";

// Hardcoded input JSON filename
const INPUT_JSON_FILE = 'music-share.json';

// Token storage file
const TOKEN_FILE = 'youtube-tokens.json';

// OAuth callback URL
const OAUTH_CALLBACK_URL = 'http://localhost:3029/oauth2callback';

// Configuration
const CONFIG = {
  INITIAL_BACKOFF_MS: 1000,
  MAX_BACKOFF_MS: 300000, // 5 minutes
  BACKOFF_MULTIPLIER: 2,
};

// Scopes for YouTube Data API
const SCOPES = ['https://www.googleapis.com/auth/youtube'];

/**
 * Start a local web server to capture OAuth callback
 */
function getAuthorizationCode(authUrl) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.url.startsWith('/oauth2callback')) {
        const url = new URL(req.url, OAUTH_CALLBACK_URL);
        const code = url.searchParams.get('code');
        
        if (code) {
          // Send success response
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head><title>Authentication Success</title></head>
            <body style="font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background-color: #f0f0f0;">
              <div style="text-align: center; background: white; padding: 40px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                <h1 style="color: #4CAF50; margin: 0 0 20px 0;">Signed in successfully!</h1>
                <p style="color: #666; margin: 0;">You can close this window and return to the terminal.</p>
              </div>
            </body>
            </html>
          `);
          
          // Close the server and resolve with the code
          server.close();
          resolve(code);
        } else {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Error: No authorization code found');
          server.close();
          reject(new Error('No authorization code in callback'));
        }
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
      }
    });

    server.listen(3029, () => {
      console.log('\n🔐 YouTube API Authentication Required\n');
      console.log('=' .repeat(60));
      console.log('\n📋 STEP 1: Authorize this app');
      console.log('\nA local web server is running on port 3029...');
      console.log('\nOpen this URL in your browser:\n');
      console.log(authUrl);
      console.log('\n' + '=' .repeat(60));
      console.log('\n📋 STEP 2: After authorizing:');
      console.log('   - You will be automatically redirected back');
      console.log('   - A success message will appear in your browser');
      console.log('   - The script will continue automatically');
      console.log('\n' + '=' .repeat(60) + '\n');
      console.log('⏳ Waiting for authorization...\n');
    });

    server.on('error', (err) => {
      reject(new Error(`Server error: ${err.message}`));
    });
  });
}

/**
 * Load tokens from file
 */
async function loadTokens() {
  try {
    const data = await fs.readFile(TOKEN_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return null;
  }
}

/**
 * Save tokens to file
 */
async function saveTokens(tokens) {
  await fs.writeFile(TOKEN_FILE, JSON.stringify(tokens, null, 2), 'utf8');
}

/**
 * Check if tokens are expired or about to expire
 */
function areTokensExpired(tokens) {
  if (!tokens || !tokens.expiry_date) {
    return true;
  }
  
  // Consider expired if less than 5 minutes remaining
  const expiryBuffer = 5 * 60 * 1000;
  return Date.now() >= (tokens.expiry_date - expiryBuffer);
}

/**
 * Get or refresh OAuth2 tokens
 */
async function getValidTokens(oauth2Client) {
  // Try to load existing tokens
  let tokens = await loadTokens();
  
  if (tokens) {
    oauth2Client.setCredentials(tokens);
    
    // Check if tokens are expired
    if (areTokensExpired(tokens)) {
      console.log('🔄 Tokens expired, refreshing...\n');
      
      try {
        // Try to refresh the token
        const { credentials } = await oauth2Client.refreshAccessToken();
        oauth2Client.setCredentials(credentials);
        await saveTokens(credentials);
        console.log('✓ Tokens refreshed successfully\n');
        return credentials;
      } catch (error) {
        console.log('⚠ Could not refresh tokens, need new authorization\n');
        tokens = null; // Force re-authorization
      }
    } else {
      console.log('✓ Using existing valid tokens\n');
      return tokens;
    }
  }
  
  // Need to get new tokens through authorization flow
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
  });
  
  const code = await getAuthorizationCode(authUrl);
  
  try {
    const { tokens: newTokens } = await oauth2Client.getToken(code);
    
    if (!newTokens.refresh_token) {
      console.log('\n⚠️  WARNING: No refresh token received!');
      console.log('   Revoke access at: https://myaccount.google.com/permissions');
      console.log('   Then run this script again.\n');
    }
    
    // IMPORTANT: Set credentials immediately after getting them
    oauth2Client.setCredentials(newTokens);
    await saveTokens(newTokens);
    console.log('\n✓ Authorization successful! Tokens saved.\n');
    return newTokens;
    
  } catch (error) {
    throw new Error(`Failed to get tokens: ${error.message}`);
  }
}

/**
 * Initialize YouTube API client with OAuth2
 */
async function getYouTubeClient() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GCP_CLIENT_ID,
    process.env.GCP_CLIENT_SECRET,
    OAUTH_CALLBACK_URL
  );

  // Get valid tokens (will prompt if needed)
  await getValidTokens(oauth2Client);

  return google.youtube({
    version: 'v3',
    auth: oauth2Client
  });
}

/**
 * Sleep function for backoff delays
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Detect quota/rate limit errors from Google APIs
 */
function isQuotaOrRateLimitError(error) {
  const reason =
    error?.errors?.[0]?.reason ||
    error?.response?.data?.error?.errors?.[0]?.reason ||
    error?.response?.data?.error?.status ||
    '';

  const reasonLower = String(reason).toLowerCase();

  return (
    error?.code === 403 || error?.status === 403 ||
    reasonLower.includes('quota') ||
    reasonLower.includes('ratelimit') ||
    reasonLower.includes('userratelimit') ||
    reasonLower.includes('dailylimit')
  );
}

/**
 * Retry forever with exponential backoff on quota/rate limit errors
 */
async function retryForeverOnQuota(fn, label) {
  let backoffMs = CONFIG.INITIAL_BACKOFF_MS;

  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (isQuotaOrRateLimitError(error)) {
        console.log(`⚠ Quota/rate limit hit${label ? ` (${label})` : ''}. Backing off for ${backoffMs}ms...`);
        await sleep(backoffMs);
        backoffMs = Math.min(backoffMs * CONFIG.BACKOFF_MULTIPLIER, CONFIG.MAX_BACKOFF_MS);
        continue;
      }
      throw error;
    }
  }
}

/**
 * Fetch all video IDs from the playlist with pagination
 */
async function getAllPlaylistVideoIds(youtube, playlistId) {
  const videoIds = new Set();
  let nextPageToken = null;

  do {
    try {
      const response = await retryForeverOnQuota(
        () => youtube.playlistItems.list({
          part: 'contentDetails',
          playlistId: playlistId,
          maxResults: 50,
          pageToken: nextPageToken
        }),
        'fetching playlist items'
      );

      response.data.items.forEach(item => {
        videoIds.add(item.contentDetails.videoId);
      });

      nextPageToken = response.data.nextPageToken;
    } catch (error) {
      console.error('Error fetching playlist items:', error.message);
      throw error;
    }
  } while (nextPageToken);

  return videoIds;
}

/**
 * Add a video to the playlist with exponential backoff on rate limits
 * Returns { success: boolean, error?: string }
 */
async function addVideoToPlaylist(youtube, playlistId, videoId) {
  let backoffMs = CONFIG.INITIAL_BACKOFF_MS;
  let transientRetryCount = 0;
  const maxTransientRetries = 3;

  while (true) {
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

      console.log(`✓ Added video ${videoId} to playlist`);
      return { success: true };

    } catch (error) {
      // Handle quota/rate limit errors with exponential backoff
      if (isQuotaOrRateLimitError(error)) {
        console.log(`⚠ Rate limit hit for video ${videoId}. Backing off for ${backoffMs}ms...`);
        await sleep(backoffMs);
        
        // Increase backoff exponentially, cap at max
        backoffMs = Math.min(backoffMs * CONFIG.BACKOFF_MULTIPLIER, CONFIG.MAX_BACKOFF_MS);
        continue; // Retry
      }

      // For 400 and 404 errors (video not found, invalid video, etc.), mark in JSON and skip
      if (error.code === 400 || error.status === 400 || error.code === 404 || error.status === 404) {
        const errorMsg = `error_${error.code || error.status}`;
        console.error(`✗ Error adding video [ID: ${videoId}]:`, error.message);
        console.error(`   This video will be marked as error and skipped in future runs`);
        return { success: false, error: errorMsg };
      }

      // Retry transient DNS/network errors up to 3 times
      if (error?.code === 'EAI_AGAIN' || error?.code === 'ENOTFOUND' || error?.code === 'ETIMEDOUT' || error?.code === 'ECONNRESET') {
        transientRetryCount += 1;
        if (transientRetryCount <= maxTransientRetries) {
          console.log(`⚠ Transient network error (${error.code}). Retry ${transientRetryCount}/${maxTransientRetries} in ${backoffMs}ms...`);
          await sleep(backoffMs);
          backoffMs = Math.min(backoffMs * CONFIG.BACKOFF_MULTIPLIER, CONFIG.MAX_BACKOFF_MS);
          continue;
        }
      }

      // For any other error, stop the script
      const errorDetails = {
        videoId: videoId,
        message: error.message,
        code: error.code,
        status: error.status
      };
      console.error(`✗ Error adding video [ID: ${videoId}]:`, error.message);
      console.error(`   Details:`, JSON.stringify(errorDetails, null, 2));
      throw error;
    }
  }
}

/**
 * Extract unique video IDs from the JSON data that haven't been added yet
 */
function extractUniqueVideoIds(data) {
  const uniqueIds = new Set();
  
  if (data.youtube && Array.isArray(data.youtube)) {
    data.youtube.forEach(item => {
      // Skip if already added, skip invalid IDs, skip error statuses
      if (item.id && !item.added_to_playlist && item.id !== 'playlist' && item.id !== 'watch_videos') {
        // Also skip if marked with an error status (e.g., "error_400")
        if (typeof item.added_to_playlist === 'string' && item.added_to_playlist.startsWith('error_')) {
          return;
        }
        uniqueIds.add(item.id);
      }
    });
  }

  return Array.from(uniqueIds);
}

/**
 * Update JSON file to mark videos as added to playlist
 */
async function updateJsonFile(data, videoIds, status = true) {
  const videoIdSet = new Set(videoIds);
  
  if (data.youtube && Array.isArray(data.youtube)) {
    data.youtube.forEach(item => {
      if (item.id && videoIdSet.has(item.id)) {
        item.added_to_playlist = status;
      }
    });
  }

  // Write updated data back to file
  await fs.writeFile(
    INPUT_JSON_FILE,
    JSON.stringify(data, null, 2),
    'utf8'
  );
}

/**
 * Main function
 */
async function main() {
  try {
    console.log('🚀 Starting YouTube Playlist Sync...\n');

    // Validate environment variables
    if (!process.env.GCP_CLIENT_ID || !process.env.GCP_CLIENT_SECRET) {
      throw new Error('Missing required environment variables: GCP_CLIENT_ID, GCP_CLIENT_SECRET');
    }

    // Initialize YouTube client (handles token generation/refresh automatically)
    const youtube = await getYouTubeClient();
    console.log('✓ YouTube API client initialized\n');

    // Read and parse JSON file
    console.log(`📖 Reading file: ${INPUT_JSON_FILE}`);
    const fileContent = await fs.readFile(INPUT_JSON_FILE, 'utf8');
    const musicData = JSON.parse(fileContent);
    console.log(`✓ File loaded. Total tracks: ${musicData.totalTracks}\n`);

    // Extract unique video IDs that haven't been added yet
    const videoIds = extractUniqueVideoIds(musicData);
    console.log(`📊 Found ${videoIds.length} unique video IDs not yet added\n`);

    if (videoIds.length === 0) {
      console.log('✓ All videos have already been processed!');
      return;
    }

    // Fetch all existing playlist video IDs
    console.log('🔍 Fetching existing playlist videos...');
    const existingVideoIds = await getAllPlaylistVideoIds(youtube, YOUTUBE_PLAYLIST_ID);
    console.log(`✓ Playlist contains ${existingVideoIds.size} videos\n`);

    // Separate videos into those already in playlist vs those to add
    const alreadyInPlaylist = videoIds.filter(id => existingVideoIds.has(id));
    const videosToAdd = videoIds.filter(id => !existingVideoIds.has(id));

    // Mark videos already in playlist as added
    if (alreadyInPlaylist.length > 0) {
      console.log(`📝 Marking ${alreadyInPlaylist.length} videos as already in playlist...`);
      await updateJsonFile(musicData, alreadyInPlaylist, true);
      console.log('✓ JSON file updated\n');
    }

    console.log(`➕ ${videosToAdd.length} videos need to be added\n`);

    if (videosToAdd.length === 0) {
      console.log('✓ All videos are already in the playlist!');
      return;
    }

    // Add missing videos to playlist
    console.log('📤 Adding videos to playlist...\n');
    const successfullyAdded = [];
    const failedWithError = [];

    for (let i = 0; i < videosToAdd.length; i++) {
      const videoId = videosToAdd[i];
      console.log(`[${i + 1}/${videosToAdd.length}] Processing ${videoId}...`);
      
      const result = await addVideoToPlaylist(youtube, YOUTUBE_PLAYLIST_ID, videoId);
      
      if (result.success) {
        successfullyAdded.push(videoId);
        
        // Update JSON file after each successful addition
        await updateJsonFile(musicData, [videoId], true);
        console.log(`  ↳ JSON updated for ${videoId}\n`);
      } else if (result.error) {
        // Mark video with error status in JSON (e.g., "error_400")
        failedWithError.push(videoId);
        await updateJsonFile(musicData, [videoId], result.error);
        console.log(`  ↳ JSON marked as ${result.error} for ${videoId}\n`);
      }
    }

    console.log('\n✨ Sync completed!');
    console.log(`📊 Added ${successfullyAdded.length} videos to the playlist.`);
    if (failedWithError.length > 0) {
      console.log(`⚠️  ${failedWithError.length} videos failed with errors and were marked to skip:`);
      failedWithError.forEach(id => console.log(`   - ${id}`));
    }
    console.log(`📝 JSON file updated with added_to_playlist status.`);

  } catch (error) {
    console.error('\n❌ Fatal error occurred:');
    console.error(`   Message: ${error.message}`);
    if (error.videoId) {
      console.error(`   Video ID: ${error.videoId}`);
    }
    console.error('Script stopped.');
    console.error('Progress has been saved to JSON file.');
    process.exit(1);
  }
}

// Run the script
main();