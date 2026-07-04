// Self-contained signed `state` for the YouTube OAuth round-trip. Carries the
// scan + user through Google and back without a DB lookup, signed with
// SCAN_SECRET so the callback can trust it. Format: base64url(JSON).sig
const crypto = require('node:crypto');

const STATE_TTL_SECONDS = 15 * 60; // OAuth round-trip should take seconds

function sign(payloadB64) {
  return crypto
    .createHmac('sha256', process.env.SCAN_SECRET)
    .update(payloadB64)
    .digest('base64url');
}

function encodeState(scanJobId, discordUserId) {
  const payload = {
    s: String(scanJobId),
    u: String(discordUserId),
    n: crypto.randomBytes(6).toString('base64url'),
    exp: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${payloadB64}.${sign(payloadB64)}`;
}

// Returns { scanJobId, discordUserId } or throws on tamper/expiry.
function decodeState(state) {
  if (!state || typeof state !== 'string' || !state.includes('.')) {
    throw new Error('missing state');
  }
  const [payloadB64, sig] = state.split('.');
  const expected = sign(payloadB64);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('bad state signature');
  }
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error('state expired');
  return { scanJobId: payload.s, discordUserId: payload.u };
}

module.exports = { encodeState, decodeState, STATE_TTL_SECONDS };
