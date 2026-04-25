// PRL Poller - main entry.
//
// Two responsibilities:
//   1. Run two daily cron ticks (pull + push) that walk active cm_sftp_endpoints
//      and, for each, decide whether today matches its schedule.
//   2. Run a tiny Express admin server (POLLER_ADMIN_SECRET-auth) so you can
//      curl POST /trigger/pull/:endpoint_id from your Chromebook to test
//      without waiting for cron.
//
// Lifecycle:
//   - dotenv.config() loads .env
//   - sanity-checks required env vars; exits if anything missing
//   - registers cron jobs in CRON_TIMEZONE
//   - boots Express on ADMIN_BIND:ADMIN_PORT (defaults 127.0.0.1:3001)
//   - PM2 restarts on crash, autorestart true, max_restarts 10
//   - SIGTERM/SIGINT: stops cron, closes server, exits cleanly
//
// Manual trigger flow on Chromebook:
//   curl -sX POST http://YOUR-DROPLET:3001/trigger/pull/<endpoint_uuid> \
//        -H "Authorization: Bearer $POLLER_ADMIN_SECRET"
// (or via SSH on the droplet itself: -H ... http://127.0.0.1:3001/...)

require('dotenv').config();

const express = require('express');
const cron = require('node-cron');

const { admin } = require('./lib/supabase');
const credentials = require('./lib/credentials');
const schedule = require('./lib/schedule');
const { runPullForEndpoint } = require('./lib/pull');
const { runPushForEndpoint } = require('./lib/push');

// -----------------------------------------------------------------------------
// Env validation
// -----------------------------------------------------------------------------
const REQUIRED_ENV = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'POLLER_SHARED_SECRET',
  'POLLER_ADMIN_SECRET',
];

const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error('FATAL: missing required env vars: ' + missing.join(', '));
  console.error('Copy .env.example -> .env and fill in real values.');
  process.exit(1);
}

const PULL_TICK_CRON = process.env.PULL_TICK_CRON || '0 6 * * *';
const PUSH_TICK_CRON = process.env.PUSH_TICK_CRON || '15 6 * * *';
const CRON_TIMEZONE  = process.env.CRON_TIMEZONE || 'America/New_York';
const ADMIN_PORT     = parseInt(process.env.ADMIN_PORT || '3001', 10);
const ADMIN_BIND     = process.env.ADMIN_BIND || '127.0.0.1';
const POLLER_ADMIN_SECRET = process.env.POLLER_ADMIN_SECRET;

// Eagerly load credentials.json so we fail fast if it's missing/malformed.
try {
  const refs = credentials.listRefs();
  console.log('Loaded ' + refs.length + ' credential refs from config.json: [' + refs.join(', ') + ']');
} catch (e) {
  console.error('FATAL: ' + e.message);
  process.exit(1);
}

// -----------------------------------------------------------------------------
// Endpoint loading
// -----------------------------------------------------------------------------
async function loadActiveEndpoints(direction) {
  // direction: 'pull' or 'push'. Filter accordingly.
  const directionFilter = direction === 'pull'
    ? ['inbound', 'bidirectional']
    : ['outbound', 'bidirectional'];

  const { data, error } = await admin
    .from('cm_sftp_endpoints')
    .select('*')
    .eq('is_active', true)
    .in('direction', directionFilter);
  if (error) {
    throw new Error('cm_sftp_endpoints query failed: ' + error.message);
  }
  return data || [];
}

async function loadEndpointById(endpointId) {
  const { data, error } = await admin
    .from('cm_sftp_endpoints')
    .select('*')
    .eq('id', endpointId)
    .single();
  if (error) {
    throw new Error('Endpoint not found: ' + endpointId + ' (' + error.message + ')');
  }
  return data;
}

// -----------------------------------------------------------------------------
// Tick handlers
// -----------------------------------------------------------------------------
async function runPullTick(triggeredBy) {
  triggeredBy = triggeredBy || 'cron';
  console.log('[' + new Date().toISOString() + '] PULL TICK starting (trigger=' + triggeredBy + ')');
  let endpoints;
  try {
    endpoints = await loadActiveEndpoints('pull');
  } catch (e) {
    console.error('[pull-tick] failed to load endpoints:', e.message);
    return { ok: false, error: e.message };
  }

  const results = [];
  for (const ep of endpoints) {
    const matches = triggeredBy === 'manual' || schedule.todayMatches(ep.pull_schedule);
    if (!matches) {
      console.log('[pull-tick] skipping ' + ep.plan_short_code +
                  ' (schedule=' + (ep.pull_schedule || 'none') + ', today does not match)');
      continue;
    }
    try {
      const r = await runPullForEndpoint(ep, triggeredBy);
      results.push({ endpoint_id: ep.id, plan: ep.plan_short_code, ...r });
    } catch (e) {
      console.error('[pull-tick] runPullForEndpoint threw:', e.message);
      results.push({ endpoint_id: ep.id, plan: ep.plan_short_code, status: 'Failed', error: e.message });
    }
  }
  console.log('[' + new Date().toISOString() + '] PULL TICK complete. ' +
              results.length + ' endpoint(s) processed.');
  return { ok: true, results };
}

async function runPushTick(triggeredBy) {
  triggeredBy = triggeredBy || 'cron';
  console.log('[' + new Date().toISOString() + '] PUSH TICK starting (trigger=' + triggeredBy + ')');
  let endpoints;
  try {
    endpoints = await loadActiveEndpoints('push');
  } catch (e) {
    console.error('[push-tick] failed to load endpoints:', e.message);
    return { ok: false, error: e.message };
  }

  const results = [];
  for (const ep of endpoints) {
    const matches = triggeredBy === 'manual' || schedule.todayMatches(ep.push_schedule);
    if (!matches) {
      console.log('[push-tick] skipping ' + ep.plan_short_code +
                  ' (schedule=' + (ep.push_schedule || 'none') + ', today does not match)');
      continue;
    }
    try {
      const r = await runPushForEndpoint(ep, triggeredBy);
      results.push({ endpoint_id: ep.id, plan: ep.plan_short_code, ...r });
    } catch (e) {
      console.error('[push-tick] runPushForEndpoint threw:', e.message);
      results.push({ endpoint_id: ep.id, plan: ep.plan_short_code, status: 'Failed', error: e.message });
    }
  }
  console.log('[' + new Date().toISOString() + '] PUSH TICK complete. ' +
              results.length + ' endpoint(s) processed.');
  return { ok: true, results };
}

// -----------------------------------------------------------------------------
// Cron registration
// -----------------------------------------------------------------------------
const cronJobs = [];

function registerCron() {
  if (!cron.validate(PULL_TICK_CRON)) {
    throw new Error('Invalid PULL_TICK_CRON: ' + PULL_TICK_CRON);
  }
  if (!cron.validate(PUSH_TICK_CRON)) {
    throw new Error('Invalid PUSH_TICK_CRON: ' + PUSH_TICK_CRON);
  }

  const pullJob = cron.schedule(PULL_TICK_CRON, () => {
    runPullTick('cron').catch(e => console.error('pull tick uncaught:', e));
  }, { timezone: CRON_TIMEZONE });

  const pushJob = cron.schedule(PUSH_TICK_CRON, () => {
    runPushTick('cron').catch(e => console.error('push tick uncaught:', e));
  }, { timezone: CRON_TIMEZONE });

  cronJobs.push(pullJob, pushJob);
  console.log('Cron registered: PULL=' + PULL_TICK_CRON + ', PUSH=' + PUSH_TICK_CRON +
              ' (TZ=' + CRON_TIMEZONE + ')');
}

// -----------------------------------------------------------------------------
// Admin server
// -----------------------------------------------------------------------------
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m || m[1].trim() !== POLLER_ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function buildAdminApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Health check (no auth) - for uptime monitors
  app.get('/healthz', (req, res) => {
    res.json({ ok: true, ts: new Date().toISOString() });
  });

  // All admin routes below require POLLER_ADMIN_SECRET
  app.use('/trigger', authMiddleware);
  app.use('/status', authMiddleware);

  app.get('/status', async (req, res) => {
    try {
      const [pullEps, pushEps] = await Promise.all([
        loadActiveEndpoints('pull'),
        loadActiveEndpoints('push'),
      ]);
      const epsById = new Map();
      for (const e of pullEps) epsById.set(e.id, e);
      for (const e of pushEps) epsById.set(e.id, e);

      const summary = Array.from(epsById.values()).map(e => ({
        id: e.id,
        practice_id: e.practice_id,
        plan_short_code: e.plan_short_code,
        direction: e.direction,
        host: e.host,
        port: e.port,
        username: e.username,
        credential_ref: e.credential_ref,
        is_active: e.is_active,
        test_mode: e.test_mode,
        pull_schedule: e.pull_schedule,
        pull_schedule_human: schedule.describe(e.pull_schedule),
        pull_due_today: schedule.todayMatches(e.pull_schedule),
        push_schedule: e.push_schedule,
        push_schedule_human: schedule.describe(e.push_schedule),
        push_due_today: schedule.todayMatches(e.push_schedule),
        last_pull_at: e.last_pull_at,
        last_pull_success: e.last_pull_success,
        last_push_at: e.last_push_at,
        last_push_success: e.last_push_success,
        consecutive_failures: e.consecutive_failures,
      }));

      res.json({
        ok: true,
        now: new Date().toISOString(),
        cron_timezone: CRON_TIMEZONE,
        pull_tick_cron: PULL_TICK_CRON,
        push_tick_cron: PUSH_TICK_CRON,
        registered_credential_refs: credentials.listRefs(),
        endpoints: summary,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Manual trigger: pull a single endpoint regardless of schedule
  app.post('/trigger/pull/:endpoint_id', async (req, res) => {
    try {
      const ep = await loadEndpointById(req.params.endpoint_id);
      if (!['inbound', 'bidirectional'].includes(ep.direction)) {
        return res.status(400).json({ error: 'Endpoint direction is ' + ep.direction + '; cannot pull.' });
      }
      const result = await runPullForEndpoint(ep, 'manual');
      res.json({ ok: true, result });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Manual trigger: push a single endpoint regardless of schedule
  app.post('/trigger/push/:endpoint_id', async (req, res) => {
    try {
      const ep = await loadEndpointById(req.params.endpoint_id);
      if (!['outbound', 'bidirectional'].includes(ep.direction)) {
        return res.status(400).json({ error: 'Endpoint direction is ' + ep.direction + '; cannot push.' });
      }
      const result = await runPushForEndpoint(ep, 'manual');
      res.json({ ok: true, result });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Manual trigger: run pull tick across ALL active endpoints (ignores schedule)
  app.post('/trigger/all/pull', async (req, res) => {
    try {
      const result = await runPullTick('manual');
      res.json({ ok: true, result });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Manual trigger: run push tick across ALL active endpoints (ignores schedule)
  app.post('/trigger/all/push', async (req, res) => {
    try {
      const result = await runPushTick('manual');
      res.json({ ok: true, result });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 404 for everything else
  app.use((req, res) => res.status(404).json({ error: 'Not found' }));

  return app;
}

// -----------------------------------------------------------------------------
// Boot
// -----------------------------------------------------------------------------
let server = null;

async function main() {
  console.log('PRL Poller starting...');
  console.log('  SUPABASE_URL = ' + process.env.SUPABASE_URL);
  console.log('  CRON_TIMEZONE = ' + CRON_TIMEZONE);

  registerCron();

  const app = buildAdminApp();
  server = app.listen(ADMIN_PORT, ADMIN_BIND, () => {
    console.log('Admin server listening on ' + ADMIN_BIND + ':' + ADMIN_PORT);
  });
}

function shutdown(signal) {
  console.log('Received ' + signal + ', shutting down...');
  for (const job of cronJobs) {
    try { job.stop(); } catch (e) { /* ignore */ }
  }
  if (server) {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000); // hard exit if close hangs
  } else {
    process.exit(0);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
  // Let PM2 restart us
  process.exit(2);
});

main().catch(err => {
  console.error('FATAL during boot:', err);
  process.exit(1);
});
