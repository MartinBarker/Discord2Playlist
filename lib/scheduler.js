// DB-persisted scheduler. Keeps an in-memory Map<scanJobId, cronTask> in sync
// with scan_jobs.cron_expression, and rehydrates from Postgres on boot so
// schedules survive deploys/restarts (the old in-memory repeatJobs Map did not).
const cron = require('node-cron');
const db = require('../db');
const { scanChannel } = require('./scan');
const { hasYouTubeTokens, pushPendingToPlaylist } = require('./youtube');
const { issueMagicToken } = require('./magicToken');

const jobs = new Map();
let discordClient = null;

// The scheduler needs a Discord client to fetch channels/DM users.
function setClient(client) {
  discordClient = client;
}

async function rescheduleJob(scanJobId, cronExpression) {
  const existing = jobs.get(scanJobId);
  if (existing) {
    existing.stop();
    if (typeof existing.destroy === 'function') existing.destroy();
    jobs.delete(scanJobId);
  }
  if (!cronExpression) return;

  const task = cron.schedule(cronExpression, () =>
    runScheduled(scanJobId).catch(err =>
      console.error(`scheduled scan ${scanJobId} failed:`, err)
    )
  );
  jobs.set(scanJobId, task);
}

async function runScheduled(scanJobId) {
  if (!discordClient) {
    console.error('runScheduled called before Discord client was set');
    return;
  }
  const { rows } = await db.query(
    'SELECT * FROM scan_jobs WHERE id = $1 AND is_active',
    [scanJobId]
  );
  const job = rows[0];
  if (!job) return;

  const inputChannel = await discordClient.channels.fetch(job.input_channel_id).catch(() => null);
  const outputChannel = await discordClient.channels.fetch(job.output_channel_id).catch(() => null);
  if (!inputChannel) {
    console.error(`scheduled scan ${scanJobId}: input channel ${job.input_channel_id} unavailable`);
    return;
  }
  const guild = inputChannel.guild;

  const { newCount } = await scanChannel({
    inputChannel,
    outputChannel: outputChannel || inputChannel,
    guild,
    initiatedByUserId: job.initiated_by_user_id,
  });

  if (newCount > 0) {
    if (await hasYouTubeTokens(job.initiated_by_user_id)) {
      // Auto-push silently — resumable, so a mid-run failure self-heals next tick.
      await pushPendingToPlaylist(scanJobId, job.initiated_by_user_id);
    } else {
      // No YouTube connection yet — DM the user a fresh magic link.
      const token = await issueMagicToken(scanJobId, job.initiated_by_user_id);
      const url = `${process.env.SITE_ORIGIN}/trawl/results/${scanJobId}?t=${token}`;
      try {
        const user = await discordClient.users.fetch(job.initiated_by_user_id);
        await user.send(
          `Found ${newCount} new track${newCount === 1 ? '' : 's'} in <#${job.input_channel_id}>. ` +
          `Connect YouTube to push them → ${url}`
        );
      } catch (e) {
        console.warn(`could not DM user ${job.initiated_by_user_id}:`, e.message);
      }
    }
  }
}

// Load all active scheduled jobs from the DB and start them. Call once on boot.
async function rehydrateAll() {
  const { rows } = await db.query(
    `SELECT id, cron_expression FROM scan_jobs
     WHERE is_active = true AND cron_expression IS NOT NULL`
  );
  for (const r of rows) await rescheduleJob(r.id, r.cron_expression);
  console.log(`Rehydrated ${rows.length} scheduled scan(s).`);
}

module.exports = { setClient, rescheduleJob, runScheduled, rehydrateAll, jobs };
