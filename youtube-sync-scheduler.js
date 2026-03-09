const cron = require('node-cron');
const { execSync } = require('child_process');
const path = require('path');

const DEFAULT_CRON = '0 * * * *'; // every hour on the hour
const CRON_EXPRESSION = process.argv[2] || DEFAULT_CRON;

if (!cron.validate(CRON_EXPRESSION)) {
    console.error(`Invalid cron expression: ${CRON_EXPRESSION}`);
    process.exit(1);
}

function runSync() {
    console.log(`\n[${new Date().toLocaleString()}] ▶ Running YouTube sync...`);
    try {
        execSync('node add_to_youtube_playlist.js', {
            stdio: 'inherit',
            cwd: path.join(__dirname)
        });
    } catch (e) {
        console.error(`[${new Date().toLocaleString()}] ❌ Sync run failed (see above).`);
    }
}

// Run immediately on start, then repeat on schedule
runSync();

cron.schedule(CRON_EXPRESSION, () => {
    console.log(`\n[${new Date().toLocaleString()}] ⏰ Scheduled tick — starting sync...`);
    runSync();
});

console.log(`\n[${new Date().toLocaleString()}] 🕐 Scheduler active (cron: ${CRON_EXPRESSION})`);
console.log('   Press Ctrl+C to stop.\n');
