const cron = require('node-cron');
const { spawnSync } = require('child_process');
const path = require('path');

// Usage:
//   node youtube-sync-scheduler.js [cronExpression] [...extraArgs]
//
// Examples:
//   node youtube-sync-scheduler.js                                  # every hour, no extra args
//   node youtube-sync-scheduler.js "*/30 * * * *"                   # every 30 minutes
//   node youtube-sync-scheduler.js "*/30 * * * *" --skip-prefetch   # every 30 min, skip playlist prefetch
//
// Any args after the cron expression are forwarded verbatim to
// add_to_youtube_playlist.js on every tick.

const DEFAULT_CRON = '0 * * * *'; // every hour on the hour
const CRON_EXPRESSION = process.argv[2] || DEFAULT_CRON;
const EXTRA_ARGS = process.argv.slice(3); // forwarded to the child script

if (!cron.validate(CRON_EXPRESSION)) {
    console.error(`Invalid cron expression: ${CRON_EXPRESSION}`);
    process.exit(1);
}

let running = false;

function runSync() {
    if (running) {
        console.log(`[${new Date().toLocaleString()}] ⏭  Previous sync still in flight — skipping this tick.`);
        return;
    }
    running = true;
    console.log(`\n[${new Date().toLocaleString()}] ▶ Running YouTube sync... (args: ${EXTRA_ARGS.join(' ') || '(none)'})`);
    try {
        const result = spawnSync(
            process.execPath,
            ['add_to_youtube_playlist.js', ...EXTRA_ARGS],
            { stdio: 'inherit', cwd: path.join(__dirname) }
        );
        if (result.status !== 0) {
            console.error(`[${new Date().toLocaleString()}] ❌ Sync run exited with code ${result.status} (see above).`);
        }
    } catch (e) {
        console.error(`[${new Date().toLocaleString()}] ❌ Sync run failed: ${e.message}`);
    } finally {
        running = false;
    }
}

// Run immediately on start, then repeat on schedule
runSync();

cron.schedule(CRON_EXPRESSION, () => {
    console.log(`\n[${new Date().toLocaleString()}] ⏰ Scheduled tick — starting sync...`);
    runSync();
});

console.log(`\n[${new Date().toLocaleString()}] 🕐 Scheduler active`);
console.log(`   cron:       ${CRON_EXPRESSION}`);
console.log(`   forwarding: ${EXTRA_ARGS.join(' ') || '(no extra args)'}`);
console.log('   Press Ctrl+C to stop.\n');
