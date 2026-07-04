// Applies db/schema.sql against DATABASE_URL. Idempotent — run it on every
// deploy or as a one-off ECS task (see deploy guide §4.3).
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const db = require('./index');

async function migrate() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  console.log('Applying schema from', schemaPath);
  await db.query(sql);
  console.log('Schema applied successfully');
}

migrate()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Schema migration failed:', err);
    process.exit(1);
  });
