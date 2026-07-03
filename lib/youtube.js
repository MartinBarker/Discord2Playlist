// Per-user YouTube OAuth + playlist pushing. Unlike the legacy
// add_to_youtube_playlist.js (single shared account in youtube-tokens.json),
// this keys an encrypted refresh token per Discord user in the youtube_tokens
// table, so every user pushes to their OWN YouTube account.
const { google } = require('googleapis');
const db = require('../db');
const { encrypt, decrypt } = require('./crypto');

const SCOPES = ['https://www.googleapis.com/auth/youtube'];

// The OAuth redirect must exactly match what's registered in the Google Cloud
// console. It points at the bot's own public callback (see api/server.js).
function redirectUri() {
  return (
    process.env.OAUTH_REDIRECT_URL ||
    `${process.env.BOT_PUBLIC_URL || 'http://localhost:3000'}/api/youtube/oauth/callback`
  );
}

function newOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GCP_CLIENT_ID,
    process.env.GCP_CLIENT_SECRET,
    redirectUri()
  );
}

// Build the Google consent URL. `state` is an opaque HMAC the caller verifies on
// callback (see api/server.js). access_type=offline + prompt=consent are what
// make Google return a refresh_token.
function buildAuthUrl(state) {
  return newOAuthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state,
    include_granted_scopes: true,
  });
}

// Exchange an OAuth code, capture the refresh token, look up the channel, and
// persist (encrypted) keyed by Discord user id.
async function exchangeCodeAndStore(code, discordUserId) {
  const client = newOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error('Google did not return a refresh_token (re-consent required).');
  }
  client.setCredentials(tokens);

  let channelId = null;
  let channelName = null;
  try {
    const yt = google.youtube({ version: 'v3', auth: client });
    const me = await yt.channels.list({ part: ['snippet'], mine: true });
    const ch = me.data.items?.[0];
    if (ch) {
      channelId = ch.id;
      channelName = ch.snippet?.title || null;
    }
  } catch (e) {
    console.warn('[youtube] could not fetch channel info:', e.message);
  }

  await db.query(
    `INSERT INTO youtube_tokens (discord_user_id, refresh_token, youtube_channel_id, youtube_channel_name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (discord_user_id) DO UPDATE
     SET refresh_token = $2, youtube_channel_id = $3, youtube_channel_name = $4`,
    [discordUserId, encrypt(tokens.refresh_token), channelId, channelName]
  );

  return { channelId, channelName };
}

// Returns true if the user has a stored YouTube connection.
async function hasYouTubeTokens(discordUserId) {
  const { rows } = await db.query(
    'SELECT 1 FROM youtube_tokens WHERE discord_user_id = $1',
    [discordUserId]
  );
  return rows.length > 0;
}

// Build an authenticated YouTube client for a user from their stored refresh
// token. Returns null if the user hasn't connected.
async function youtubeClientFor(discordUserId) {
  const { rows } = await db.query(
    'SELECT refresh_token FROM youtube_tokens WHERE discord_user_id = $1',
    [discordUserId]
  );
  if (!rows[0]) return null;
  const refreshToken = decrypt(rows[0].refresh_token);
  const client = newOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });
  return google.youtube({ version: 'v3', auth: client });
}

// Find the playlist we've already created for this (scan, user), or create one.
async function getOrCreatePlaylistId(scanJobId, discordUserId, youtube) {
  const { rows } = await db.query(
    'SELECT youtube_playlist_id FROM scan_playlists WHERE scan_job_id = $1 AND discord_user_id = $2',
    [scanJobId, discordUserId]
  );
  if (rows[0]) return rows[0].youtube_playlist_id;

  const created = await youtube.playlists.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: `Discord2Playlist — scan ${scanJobId}`,
        description: 'Created by discord2playlist (https://martinbarker.me/discord2playlist).',
      },
      status: { privacyStatus: 'private' },
    },
  });
  const playlistId = created.data.id;
  await db.query(
    `INSERT INTO scan_playlists (scan_job_id, discord_user_id, youtube_playlist_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (scan_job_id, discord_user_id) DO UPDATE SET youtube_playlist_id = $3`,
    [scanJobId, discordUserId, playlistId]
  );
  return playlistId;
}

// Insert one video with exponential backoff on transient errors. Permanent
// errors throw; videoAlreadyInPlaylist is treated as success.
async function insertWithRetry(youtube, playlistId, videoId, attempt = 0) {
  try {
    await youtube.playlistItems.insert({
      part: ['snippet'],
      requestBody: {
        snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId } },
      },
    });
  } catch (err) {
    const code = err.code || err.response?.status;
    const reason =
      err.errors?.[0]?.reason || err.response?.data?.error?.errors?.[0]?.reason;

    if (reason === 'videoNotFound') throw new Error('video unavailable');
    if (reason === 'videoAlreadyInPlaylist') return; // treat as success
    if (reason === 'forbidden') throw new Error('access denied to video');
    if (reason === 'quotaExceeded') throw new Error('YouTube daily quota hit — try tomorrow');

    const transient =
      code >= 500 || code === 429 || reason === 'rateLimitExceeded' || reason === 'backendError';
    if (transient && attempt < 5) {
      const delay = Math.min(2 ** attempt * 1000 + Math.random() * 500, 30000);
      await new Promise(r => setTimeout(r, delay));
      return insertWithRetry(youtube, playlistId, videoId, attempt + 1);
    }
    throw err;
  }
}

// Resumable push of every not-yet-inserted YouTube link for a scan to the user's
// playlist. `emit(event, data)` streams progress (used by the SSE endpoint); for
// internal/scheduled use pass a no-op. Returns { playlistId, inserted, failed }.
async function pushPendingToPlaylist(scanJobId, discordUserId, emit = () => {}) {
  const youtube = await youtubeClientFor(discordUserId);
  if (!youtube) {
    emit('error', { code: 'no_youtube' });
    return { error: 'no_youtube' };
  }

  const playlistId = await getOrCreatePlaylistId(scanJobId, discordUserId, youtube);

  const { rows: todo } = await db.query(
    `SELECT el.media_id
     FROM extracted_links el
     LEFT JOIN playlist_items pi
       ON pi.scan_job_id = el.scan_job_id
      AND pi.media_id = el.media_id
      AND pi.discord_user_id = $1
      AND pi.status = 'inserted'
     WHERE el.scan_job_id = $2 AND el.platform = 'youtube' AND pi.id IS NULL
     ORDER BY el.id ASC`,
    [discordUserId, scanJobId]
  );

  emit('start', { total: todo.length, playlistId });
  let inserted = 0;
  let failed = 0;

  for (const { media_id } of todo) {
    try {
      await insertWithRetry(youtube, playlistId, media_id);
      await db.query(
        `INSERT INTO playlist_items (scan_job_id, discord_user_id, media_id, youtube_playlist_id, status)
         VALUES ($1, $2, $3, $4, 'inserted')
         ON CONFLICT (scan_job_id, discord_user_id, media_id) DO UPDATE
         SET status = 'inserted', error = NULL`,
        [scanJobId, discordUserId, media_id, playlistId]
      );
      inserted++;
      emit('progress', { mediaId: media_id, status: 'inserted' });
    } catch (err) {
      await db.query(
        `INSERT INTO playlist_items (scan_job_id, discord_user_id, media_id, youtube_playlist_id, status, error)
         VALUES ($1, $2, $3, $4, 'failed', $5)
         ON CONFLICT (scan_job_id, discord_user_id, media_id) DO UPDATE
         SET status = 'failed', error = $5`,
        [scanJobId, discordUserId, media_id, playlistId, err.message]
      );
      failed++;
      emit('progress', { mediaId: media_id, status: 'failed', error: err.message });
    }
  }

  emit('done', { playlistId, inserted, failed });
  return { playlistId, inserted, failed };
}

module.exports = {
  SCOPES,
  buildAuthUrl,
  exchangeCodeAndStore,
  hasYouTubeTokens,
  youtubeClientFor,
  getOrCreatePlaylistId,
  insertWithRetry,
  pushPendingToPlaylist,
};
