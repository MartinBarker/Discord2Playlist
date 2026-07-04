// AES-256-GCM encryption for YouTube refresh tokens at rest.
// The key is derived from TOKEN_ENCRYPTION_KEY (preferred) or SCAN_SECRET via
// scrypt, so a 32-byte key is produced regardless of the secret's length.
const crypto = require('node:crypto');

const SECRET = process.env.TOKEN_ENCRYPTION_KEY || process.env.SCAN_SECRET;
if (!SECRET) {
  // Defer hard failure to call time so non-crypto code paths still load,
  // but make the misconfiguration obvious.
  console.warn('[crypto] Neither TOKEN_ENCRYPTION_KEY nor SCAN_SECRET set — token encryption will fail.');
}

// Static salt is fine here: the secret is high-entropy and we want a stable
// key across restarts so previously-encrypted tokens stay decryptable.
const KEY = SECRET
  ? crypto.scryptSync(SECRET, 'discord2playlist:token', 32)
  : null;

// Returns a Buffer: [12-byte IV][16-byte auth tag][ciphertext]. Store as BYTEA.
function encrypt(plaintext) {
  if (!KEY) throw new Error('token encryption key not configured');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

// Accepts the Buffer produced by encrypt() (or a pg BYTEA value) and returns the
// original string.
function decrypt(buf) {
  if (!KEY) throw new Error('token encryption key not configured');
  const data = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const iv = data.subarray(0, 12);
  const tag = data.subarray(12, 28);
  const enc = data.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
