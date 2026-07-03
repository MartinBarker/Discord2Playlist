// Shared pg connection pool. Every module imports this instead of creating
// its own Pool, so the bot, API, and scheduler share one set of connections.
const { Pool } = require('pg');

// Warn (don't exit) at load time so DB-free scripts like deploy_discord_commands.js
// can still require command modules. Queries will fail loudly if the URL is truly
// missing when the bot actually runs.
if (!process.env.DATABASE_URL) {
  console.warn('[db] DATABASE_URL is not set — database queries will fail until it is configured.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  // RDS terminates TLS with a cert chain the container doesn't bundle; in
  // production we still want TLS, just without local CA verification.
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

pool.on('error', err => console.error('db pool error:', err));

module.exports = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(),
  pool,
};
