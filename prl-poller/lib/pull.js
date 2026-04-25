// Per-endpoint pull tick.
//
// Steps:
//   1. Open SFTP connection
//   2. List files in inbound_remote_path matching inbound_filename_pattern
//   3. For each file:
//      a. Skip if already ingested (idempotency check via cm_prl_imports.file_name)
//      b. Download
//      c. POST to prl-ingest-from-sftp Edge Function (which uploads to Storage,
//         creates cm_prl_imports, calls prl-parse, writes audit log)
//      d. Optionally move the processed file to inbound_archive_path
//   4. Update cm_prl_sftp_runs ledger with stats
//
// In test_mode=true, we still LIST and check idempotency, but skip download
// and webhook calls. Status is recorded as 'TestMode'.

const { admin, SUPABASE_URL } = require('./supabase');
const credentials = require('./credentials');
const { startRun, completeRun, updateEndpointHealth } = require('./runs');
const sftp = require('./sftp');

const POLLER_SHARED_SECRET = process.env.POLLER_SHARED_SECRET;

if (!POLLER_SHARED_SECRET) {
  console.warn('[pull] POLLER_SHARED_SECRET not set - webhook calls will fail.');
}

// Check whether a file has already been ingested for this practice.
// Idempotency by file_name is good enough for v1: NC DHHS filenames embed
// timestamps so re-deliveries should have unique names. If a plan ever
// re-delivers with the same name (rare), the operator can rename.
async function alreadyIngested(practiceId, fileName) {
  const { data, error } = await admin
    .from('cm_prl_imports')
    .select('id')
    .eq('practice_id', practiceId)
    .eq('file_name', fileName)
    .maybeSingle();
  if (error) {
    console.error('[pull.alreadyIngested] query failed:', error.message);
    return false;
  }
  return !!data;
}

async function postToWebhook(payload) {
  const url = SUPABASE_URL.replace(/\/+$/, '') + '/functions/v1/prl-ingest-from-sftp';
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + POLLER_SHARED_SECRET,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  let body = null;
  try { body = await resp.json(); } catch (e) { body = { error: 'Non-JSON response: ' + resp.status }; }
  return { status: resp.status, body };
}

async function runPullForEndpoint(endpoint, triggeredBy) {
  const log = (...args) => console.log('[pull][' + endpoint.plan_short_code + ']', ...args);

  const runId = await startRun({
    practiceId: endpoint.practice_id,
    endpointId: endpoint.id,
    runType: 'pull',
    triggeredBy: triggeredBy,
  });

  const stats = {
    files_seen: 0,
    files_downloaded: 0,
    files_skipped_already_seen: 0,
    imports_created: 0,
  };
  const fileOutcomes = [];

  try {
    if (!endpoint.inbound_remote_path) {
      throw new Error('inbound_remote_path is not set on endpoint');
    }

    const credOpts = credentials.lookup(endpoint.credential_ref);

    await sftp.withConnection(endpoint, credOpts, async (client) => {
      log('connected; listing', endpoint.inbound_remote_path);
      const files = await sftp.listMatchingFiles(
        client,
        endpoint.inbound_remote_path,
        endpoint.inbound_filename_pattern || null
      );
      stats.files_seen = files.length;
      log('found', files.length, 'matching files');

      for (const f of files) {
        const seen = await alreadyIngested(endpoint.practice_id, f.name);
        if (seen) {
          stats.files_skipped_already_seen++;
          fileOutcomes.push({ file: f.name, action: 'skipped_already_seen' });
          continue;
        }

        if (endpoint.test_mode) {
          fileOutcomes.push({ file: f.name, action: 'test_mode_would_download', size: f.size });
          continue;
        }

        // Download
        log('downloading', f.fullPath);
        const buffer = await sftp.downloadFile(client, f.fullPath);
        stats.files_downloaded++;

        // POST to webhook
        const payload = {
          practice_id: endpoint.practice_id,
          plan_short_code: endpoint.plan_short_code,
          endpoint_id: endpoint.id,
          sftp_run_id: runId,
          file_name: f.name,
          file_content_base64: buffer.toString('base64'),
          remote_source_path: f.fullPath,
        };
        const { status, body } = await postToWebhook(payload);

        if (status >= 200 && status < 300 && body?.ok) {
          stats.imports_created++;
          fileOutcomes.push({
            file: f.name,
            action: body.already_ingested ? 'already_ingested_via_webhook' : 'ingested',
            import_id: body.import_id,
          });

          // Optionally archive
          if (endpoint.inbound_archive_path) {
            const archivePath = endpoint.inbound_archive_path.replace(/\/+$/, '') + '/' + f.name;
            try {
              await sftp.moveFile(client, f.fullPath, archivePath);
              fileOutcomes[fileOutcomes.length - 1].archived_to = archivePath;
            } catch (e) {
              fileOutcomes[fileOutcomes.length - 1].archive_error = e.message;
            }
          }
        } else {
          fileOutcomes.push({
            file: f.name,
            action: 'webhook_failed',
            status,
            error: body?.error || 'unknown',
          });
        }
      }
    });

    const finalStatus = endpoint.test_mode
      ? 'TestMode'
      : (fileOutcomes.some(o => o.action === 'webhook_failed') ? 'Partial' : 'Success');

    await completeRun(runId, {
      status: finalStatus,
      stats,
      details: { file_outcomes: fileOutcomes },
    });
    await updateEndpointHealth(endpoint.id, 'pull', finalStatus !== 'Failed');
    log('done.', finalStatus, JSON.stringify(stats));
    return { runId, status: finalStatus, stats };
  } catch (err) {
    console.error('[pull][' + endpoint.plan_short_code + '] FAILED:', err.message);
    await completeRun(runId, {
      status: 'Failed',
      stats,
      errorMessage: err.message,
      details: { file_outcomes: fileOutcomes },
    });
    await updateEndpointHealth(endpoint.id, 'pull', false);
    return { runId, status: 'Failed', error: err.message };
  }
}

module.exports = { runPullForEndpoint };
