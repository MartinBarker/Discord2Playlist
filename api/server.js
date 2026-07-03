// HTTP API the website calls. Runs in the same process as the Discord client
// (started from start_discord_bot.js). Auth model:
//   • Browser-facing endpoints (SSE push, OAuth) are gated by the magic token.
//   • The site's server-side fetch of GET /api/scans/:id additionally presents
//     SITE_SHARED_SECRET via the x-site-secret header.
const express = require('express');
const db = require('../db');
const { verifyMagicToken } = require('../lib/magicToken');
const { buildAuthUrl, exchangeCodeAndStore, hasYouTubeTokens, pushPendingToPlaylist } = require('../lib/youtube');
const { encodeState, decodeState } = require('../lib/oauthState');

function createApiServer() {
  const app = express();
  app.use(express.json());

  // Permissive CORS: browsers on https://martinbarker.me open SSE/OAuth here.
  // The real auth is the signed magic token, not the origin.
  app.use((req, res, next) => {
    const origin = process.env.SITE_ORIGIN || '*';
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Headers', 'Content-Type, x-site-secret');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // Liveness probe for ALB / UptimeRobot.
  app.get('/healthz', (req, res) => res.json({ ok: true }));

  // Optional shared-secret gate for server-to-server calls. The browser can't
  // send the header, so we only enforce it when the header is present at all
  // OR when explicitly required for this route.
  function requireSiteSecret(req, res, next) {
    const expected = process.env.SITE_SHARED_SECRET;
    if (!expected) return next(); // not configured → skip (dev)
    if (req.get('x-site-secret') !== expected) {
      return res.status(401).json({ error: 'bad site secret' });
    }
    next();
  }

  // Scan results for the website results page (server-side render).
  app.get('/api/scans/:id', requireSiteSecret, verifyMagicToken, async (req, res) => {
    try {
      const { rows: jobRows } = await db.query(
        `SELECT id, guild_id, input_channel_id, output_channel_id, initiated_by_user_id,
                cron_expression, is_active, last_run_at, created_at
         FROM scan_jobs WHERE id = $1`,
        [req.scanJobId]
      );
      const scanJob = jobRows[0];
      if (!scanJob) return res.status(404).json({ error: 'scan not found' });

      const { rows: tracks } = await db.query(
        `SELECT platform, media_id, media_url, author_username, source_message_id, extracted_at
         FROM extracted_links
         WHERE scan_job_id = $1
         ORDER BY id ASC`,
        [req.scanJobId]
      );

      const alreadyConnected = await hasYouTubeTokens(req.discordUserId);
      res.json({ tracks, alreadyConnected, scanJob });
    } catch (err) {
      console.error('GET /api/scans/:id failed:', err);
      res.status(500).json({ error: 'internal error' });
    }
  });

  // SSE stream that pushes pending YouTube videos to the user's playlist.
  // EventSource is GET-only, so this is GET (not POST as some docs show).
  app.get('/api/scans/:id/push', verifyMagicToken, async (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const emit = (event, data) =>
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    try {
      await pushPendingToPlaylist(req.scanJobId, req.discordUserId, emit);
    } catch (err) {
      console.error('push failed:', err);
      emit('error', { code: 'push_failed', message: err.message });
    } finally {
      res.end();
    }
  });

  // Begin YouTube OAuth. Nested under /scans/:id so verifyMagicToken can match
  // the token against the scan. Redirects to Google with a signed state
  // carrying (scanJobId, discordUserId).
  app.get('/api/scans/:id/youtube/oauth/start', verifyMagicToken, (req, res) => {
    const state = encodeState(req.scanJobId, req.discordUserId);
    res.redirect(buildAuthUrl(state));
  });

  // Google redirects here after consent. Verify state, exchange the code, store
  // the encrypted refresh token, and render a self-closing confirmation page.
  app.get('/api/youtube/oauth/callback', async (req, res) => {
    try {
      const { code, state, error } = req.query;
      if (error) throw new Error(`Google returned error: ${error}`);
      const { discordUserId } = decodeState(state);
      await exchangeCodeAndStore(code, discordUserId);
      res.set('Content-Type', 'text/html').send(`<!doctype html>
<html><head><meta charset="utf-8"><title>YouTube connected</title></head>
<body style="font-family:sans-serif;text-align:center;padding:60px;">
  <h2>✅ YouTube connected</h2>
  <p>You can close this window and return to the results page.</p>
  <script>
    try { if (window.opener) { window.opener.postMessage({ type: 'youtube-connected' }, '*'); } } catch (e) {}
    setTimeout(function(){ try { window.close(); } catch (e) {} }, 1500);
  </script>
</body></html>`);
    } catch (err) {
      console.error('OAuth callback failed:', err);
      res.status(400).set('Content-Type', 'text/html').send(
        `<!doctype html><body style="font-family:sans-serif;text-align:center;padding:60px;">
         <h2>❌ Couldn't connect YouTube</h2><p>${err.message}</p></body>`
      );
    }
  });

  return app;
}

module.exports = { createApiServer };
