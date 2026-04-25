PRL Poller
External SFTP poller for NC Medicaid PRL (Patient Risk List) bidirectional exchange. Runs on Leonard's DigitalOcean droplet under PM2. Pulls inbound files from health plan / NC DHHS SFTP servers and POSTs them to PracticeOS prl-ingest-from-sftp webhook; pushes outbound generated files from cm_prl_exports to plan SFTP servers.
Architecture
Flow: Health plan SFTP → poller (DigitalOcean droplet, Node.js + PM2) → PracticeOS Supabase Edge Functions (prl-ingest-from-sftp → prl-parse).
The poller has three internal pieces:

A daily cron pull tick that walks active inbound endpoints and downloads new files
A daily cron push tick that walks active outbound endpoints and uploads generated files
A tiny Express admin server on port 3001 for manual triggering and status checks

One-time droplet setup
1. Install Node.js >=18 if not present.
node -v   # confirm >=18
2. Drop this repo at /opt/prl-poller.
sudo mkdir -p /opt/prl-poller
sudo chown $USER /opt/prl-poller
cd /opt/prl-poller
# then either: git clone https://github.com/EvolvAuto/prl-poller.git .
# or: copy files in via scp/rsync
3. Install dependencies.
cd /opt/prl-poller
npm install
4. Create logs directory.
mkdir -p /opt/prl-poller/logs
5. Create .env from example.
cp .env.example .env
nano .env
Fill in:

SUPABASE_URL — PracticeOS project URL (https://wlkwmfxmrnjqvcsbwksk.supabase.co)
SUPABASE_SERVICE_ROLE_KEY — from Supabase dashboard → Project Settings → API → service_role
POLLER_SHARED_SECRET — generate with openssl rand -hex 32
POLLER_ADMIN_SECRET — generate with openssl rand -hex 32, distinct from POLLER_SHARED_SECRET

Then lock it down:
chmod 600 .env
6. Create config.json from example.
cp config.example.json config.json
nano config.json
Add one entry per credential_ref you'll use in cm_sftp_endpoints.credential_ref. Each entry gets a password OR privateKey/privateKeyPath. See config.example.json for shape.
chmod 600 config.json
7. Set the same POLLER_SHARED_SECRET in Supabase project secrets.
In the Supabase dashboard: Project Settings → Edge Functions → Secrets → Add. Name it POLLER_SHARED_SECRET, value the same string you put in .env. Save.
This is what authenticates the poller's calls to prl-ingest-from-sftp.
8. Sanity boot once in foreground.
cd /opt/prl-poller
node index.js
You should see something like:
Loaded N credential refs from config.json: [...]
PRL Poller starting...
  SUPABASE_URL = https://...
  CRON_TIMEZONE = America/New_York
Cron registered: PULL=0 6 * * *, PUSH=15 6 * * * (TZ=America/New_York)
Admin server listening on 127.0.0.1:3001
Ctrl-C to stop.
9. Start under PM2.
pm2 start ecosystem.config.js
pm2 save
pm2 startup    # one-time, follow printed instructions for systemd persistence
10. Verify.
pm2 logs prl-poller --lines 50
pm2 status
Configuring your first endpoint
Run this in Supabase SQL Editor (replace UUIDs and values for your test case):
INSERT INTO cm_sftp_endpoints (
  practice_id, plan_short_code, direction,
  host, port, username, credential_ref,
  inbound_remote_path, outbound_remote_path, inbound_archive_path,
  inbound_filename_pattern,
  pull_schedule, push_schedule,
  is_active, test_mode, notes
) VALUES (
  'bf50934d-0bc2-454e-8177-6c9f749eefe4',
  'TRIB',
  'bidirectional',
  'sftp.trillium-example.org',
  22,
  'pilot_practice_user',
  'pilot_trib_bidirectional',
  '/inbound',
  '/outbound',
  '/inbound/processed',
  '^NCMT_TCM_PatientRiskList_.*\.TXT$',
  'weekly_sunday',
  'monthly_7th',
  true,
  true,
  'Initial pilot endpoint, test mode active'
);
After insert, get the endpoint ID:
SELECT id, plan_short_code, test_mode FROM cm_sftp_endpoints
WHERE practice_id = 'bf50934d-0bc2-454e-8177-6c9f749eefe4';
Manual testing without waiting for cron
From the droplet (or any host that can reach the admin port):
# Status
curl -s http://127.0.0.1:3001/status \
  -H "Authorization: Bearer $POLLER_ADMIN_SECRET" | jq

# Force a pull tick across all due endpoints
curl -sX POST http://127.0.0.1:3001/trigger/all/pull \
  -H "Authorization: Bearer $POLLER_ADMIN_SECRET" | jq

# Force pull for a single endpoint (regardless of schedule)
curl -sX POST http://127.0.0.1:3001/trigger/pull/<endpoint_uuid> \
  -H "Authorization: Bearer $POLLER_ADMIN_SECRET" | jq

# Force push tick
curl -sX POST http://127.0.0.1:3001/trigger/all/push \
  -H "Authorization: Bearer $POLLER_ADMIN_SECRET" | jq
In test_mode=true the poller lists inbound files and reports what it WOULD do, but won't download or call the webhook. Run status will be 'TestMode' in cm_prl_sftp_runs. Flip the endpoint to test_mode=false only after the test mode run looks correct.
Going live for an endpoint
UPDATE cm_sftp_endpoints
SET test_mode = false
WHERE id = '<endpoint_uuid>';
Then trigger a manual pull again to confirm a real ingest works end-to-end:
curl -sX POST http://127.0.0.1:3001/trigger/pull/<endpoint_uuid> \
  -H "Authorization: Bearer $POLLER_ADMIN_SECRET" | jq
Verify by querying:
-- The poller's run record
SELECT * FROM cm_prl_sftp_runs WHERE endpoint_id = '<endpoint_uuid>'
ORDER BY started_at DESC LIMIT 5;

-- The imports created from that run
SELECT i.* FROM cm_prl_imports i
JOIN cm_prl_sftp_runs r ON r.id = i.sftp_run_id
WHERE r.endpoint_id = '<endpoint_uuid>'
ORDER BY i.created_at DESC LIMIT 5;

-- Audit trail
SELECT created_at, action, success, details->>'function' AS fn, details
FROM audit_log
WHERE entity_type IN ('cm_prl_imports', 'cm_prl_exports')
ORDER BY created_at DESC LIMIT 10;
Operational runbook
Endpoint hasn't pulled in a long time. Check cm_sftp_endpoints.last_pull_at and consecutive_failures. Look at recent cm_prl_sftp_runs for that endpoint. If they're all Failed with the same error, common causes: credential_ref no longer in config.json (poller restart needed after edit), SFTP host/port changed, plan rotated credentials.
Webhook call failing with 401. POLLER_SHARED_SECRET mismatch. The .env value on the droplet must match the value set in Supabase project secrets. After rotating, restart the poller (pm2 restart prl-poller) AND re-deploy prl-ingest-from-sftp (Supabase reads secrets at function boot).
File downloaded but parse failed. Check cm_prl_imports for the row. status will be Failed with status_reason populated. The audit_log row from prl-ingest-from-sftp will also have parse_error in details. Most common: filename doesn't match expected NCMT_AMH_* or NCMT_TCM_* patterns, or PSV is malformed.
Outbound transmitted but plan claims they didn't receive it. Check cm_prl_exports.transmission_recipient for the exact remote path written. SSH to that path on the plan SFTP and verify the file is there. Some plans archive immediately on receipt — that's normal.
Stopping / restarting
pm2 restart prl-poller    # after config.json edits or env changes
pm2 stop prl-poller       # pause cron
pm2 start prl-poller      # resume cron
pm2 delete prl-poller     # remove entirely
