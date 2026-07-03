// Signed, single-purpose magic links for unauthenticated web access.
// Format:  <tokenId>.<sig>   where
//   tokenId = short random id (also the magic_tokens PK)
//   sig     = base64url(HMAC_SHA256(SCAN_SECRET, tokenId:scanJobId:discordUserId:exp))
// The HMAC is a tamper-check; the row in magic_tokens is the source of truth.
const crypto = require('node:crypto');
const db = require('../db');

const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

function sign(tokenId, scanJobId, discordUserId, exp) {
  return crypto
    .createHmac('sha256', process.env.SCAN_SECRET)
    .update(`${tokenId}:${scanJobId}:${discordUserId}:${exp}`)
    .digest('base64url');
}

// Issue a fresh magic token for (scanJobId, discordUserId), persist it, and
// return the `<tokenId>.<sig>` string to embed in a results URL.
async function issueMagicToken(scanJobId, discordUserId) {
  const tokenId = crypto.randomBytes(9).toString('base64url'); // ~12 chars
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const sig = sign(tokenId, scanJobId, discordUserId, exp);

  await db.query(
    `INSERT INTO magic_tokens (token_id, scan_job_id, discord_user_id, expires_at)
     VALUES ($1, $2, $3, to_timestamp($4))`,
    [tokenId, scanJobId, discordUserId, exp]
  );

  return `${tokenId}.${sig}`;
}

// Express middleware: validates ?t=<token> against the magic_tokens row and the
// :id route param. On success, sets req.discordUserId and req.scanJobId.
async function verifyMagicToken(req, res, next) {
  try {
    const token = req.query.t;
    if (!token || typeof token !== 'string' || !token.includes('.')) {
      return res.status(401).json({ error: 'missing token' });
    }
    const [tokenId, sig] = token.split('.');

    const { rows } = await db.query(
      `SELECT discord_user_id, expires_at, scan_job_id, revoked
       FROM magic_tokens WHERE token_id = $1`,
      [tokenId]
    );
    const row = rows[0];
    if (!row || row.revoked) return res.status(403).json({ error: 'invalid token' });
    if (new Date(row.expires_at) < new Date()) return res.status(410).json({ error: 'expired' });
    if (String(row.scan_job_id) !== String(req.params.id)) {
      return res.status(403).json({ error: 'wrong scan' });
    }

    const exp = Math.floor(new Date(row.expires_at).getTime() / 1000);
    const expected = sign(tokenId, row.scan_job_id, row.discord_user_id, exp);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(403).json({ error: 'bad signature' });
    }

    req.discordUserId = row.discord_user_id;
    req.scanJobId = row.scan_job_id;
    next();
  } catch (err) {
    console.error('verifyMagicToken error:', err);
    res.status(500).json({ error: 'token verification failed' });
  }
}

module.exports = { issueMagicToken, verifyMagicToken, TOKEN_TTL_SECONDS };
