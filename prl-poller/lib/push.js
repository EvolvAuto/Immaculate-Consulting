// Per-endpoint push tick.
//
// Steps:
//   1. Read cm_prl_exports rows for this practice with status='Generated' AND
//      file_path NOT NULL AND not yet transmitted (transmitted_at IS NULL)
//      AND target_plan_short_name matches the endpoint's plan_short_code
//   2. For each export:
//      a. Download the PSV from prl-exports Storage bucket
//      b. SFTP upload to outbound_remote_path/<file_name>
//      c. Update cm_prl_exports: status='Transmitted', transmitted_at=now,
//         transmission_method='SFTP', sftp_run_id linked
//      d. Audit log entry (Update on cm_prl_exports)
//   3. Update cm_prl_sftp_runs ledger with stats
//
// In test_mode=true, skip the actual upload but still log what would happen.
// cm_prl_exports.status remains 'Generated' (not Transmitted) so test runs
// don't pollute the production state.

const { admin } = require('./supabase');
const credentials = require('./credentials');
const { startRun, completeRun, updateEndpointHealth } = require('./runs');
const sftp = require('./sftp');

async function loadPendingExports(practiceId, planShortCode) {
  const { data, error } = await admin
    .from('cm_prl_exports')
    .select('id, practice_id, target_plan_short_name, file_name, file_path, file_size_bytes, status, generated_at, transmitted_at')
    .eq('practice_id', practiceId)
    .eq('target_plan_short_name', planShortCode)
    .eq('status', 'Generated')
    .is('transmitted_at', null)
    .not('file_path', 'is', null)
    .order('generated_at', { ascending: true });
  if (error) {
    throw new Error('cm_prl_exports query failed: ' + error.message);
  }
  return data || [];
}

async function downloadFromStorage(filePath) {
  const { data, error } = await admin.storage.from('prl-exports').download(filePath);
  if (error) {
    throw new Error('Storage download failed (' + filePath + '): ' + error.message);
  }
  // data is a Blob in supabase-js v2; convert to Buffer
  const arrayBuf = await data.arrayBuffer();
  return Buffer.from(arrayBuf);
}

async function markTransmitted(exportId, runId, remotePath, exportPracticeId) {
  const nowIso = new Date().toISOString();
  const { error } = await admin
    .from('cm_prl_exports')
    .update({
      status: 'Transmitted',
      transmitted_at: nowIso,
      transmission_method: 'SFTP',
      transmission_recipient: remotePath,
      sftp_run_id: runId,
    })
    .eq('id', exportId);
  if (error) {
    console.error('[push.markTransmitted] update failed:', error.message);
    return false;
  }

  // Audit log: Update on cm_prl_exports (the export's lifecycle advanced)
  try {
    await admin.from('audit_log').insert({
      practice_id: exportPracticeId,
      user_id: null,
      action: 'Update',
      entity_type: 'cm_prl_exports',
      entity_id: exportId,
      details: {
        function: 'prl-poller-push',
        version: 'v1',
        action_detail: 'transmitted_via_sftp',
        sftp_run_id: runId,
        remote_path: remotePath,
        transmitted_at: nowIso,
      },
      success: true,
    });
  } catch (e) {
    console.error('[push.markTransmitted] audit log failed:', e?.message || e);
  }

  return true;
}

async function runPushForEndpoint(endpoint, triggeredBy) {
  const log = (...args) => console.log('[push][' + endpoint.plan_short_code + ']', ...args);

  const runId = await startRun({
    practiceId: endpoint.practice_id,
    endpointId: endpoint.id,
    runType: 'push',
    triggeredBy: triggeredBy,
  });

  const stats = {
    exports_seen: 0,
    exports_uploaded: 0,
    exports_skipped_already_uploaded: 0,
  };
  const fileOutcomes = [];

  try {
    if (!endpoint.outbound_remote_path) {
      throw new Error('outbound_remote_path is not set on endpoint');
    }

    const pending = await loadPendingExports(endpoint.practice_id, endpoint.plan_short_code);
    stats.exports_seen = pending.length;
    log('found', pending.length, 'pending exports for', endpoint.plan_short_code);

    if (pending.length === 0) {
      await completeRun(runId, { status: 'Success', stats, details: { file_outcomes: [] } });
      await updateEndpointHealth(endpoint.id, 'push', true);
      return { runId, status: 'Success', stats };
    }

    if (endpoint.test_mode) {
      for (const exp of pending) {
        fileOutcomes.push({
          export_id: exp.id,
          file: exp.file_name,
          action: 'test_mode_would_upload',
          size: exp.file_size_bytes,
        });
      }
      await completeRun(runId, { status: 'TestMode', stats, details: { file_outcomes: fileOutcomes } });
      await updateEndpointHealth(endpoint.id, 'push', true);
      log('done. TestMode (no actual upload)', JSON.stringify(stats));
      return { runId, status: 'TestMode', stats };
    }

    const credOpts = credentials.lookup(endpoint.credential_ref);

    await sftp.withConnection(endpoint, credOpts, async (client) => {
      for (const exp of pending) {
        try {
          log('downloading from storage:', exp.file_path);
          const buffer = await downloadFromStorage(exp.file_path);

          const remotePath = endpoint.outbound_remote_path.replace(/\/+$/, '') + '/' + exp.file_name;
          log('uploading to', remotePath, '(', buffer.length, 'bytes)');
          await sftp.uploadFile(client, remotePath, buffer);

          const ok = await markTransmitted(exp.id, runId, remotePath, exp.practice_id);
          if (ok) {
            stats.exports_uploaded++;
            fileOutcomes.push({
              export_id: exp.id,
              file: exp.file_name,
              action: 'uploaded',
              remote_path: remotePath,
              size: buffer.length,
            });
          } else {
            fileOutcomes.push({
              export_id: exp.id,
              file: exp.file_name,
              action: 'uploaded_but_db_update_failed',
              remote_path: remotePath,
            });
          }
        } catch (perFileErr) {
          fileOutcomes.push({
            export_id: exp.id,
            file: exp.file_name,
            action: 'upload_failed',
            error: perFileErr.message,
          });
        }
      }
    });

    const anyFailures = fileOutcomes.some(o => o.action === 'upload_failed' || o.action === 'uploaded_but_db_update_failed');
    const finalStatus = anyFailures ? 'Partial' : 'Success';

    await completeRun(runId, {
      status: finalStatus,
      stats,
      details: { file_outcomes: fileOutcomes },
    });
    await updateEndpointHealth(endpoint.id, 'push', finalStatus !== 'Failed');
    log('done.', finalStatus, JSON.stringify(stats));
    return { runId, status: finalStatus, stats };
  } catch (err) {
    console.error('[push][' + endpoint.plan_short_code + '] FAILED:', err.message);
    await completeRun(runId, {
      status: 'Failed',
      stats,
      errorMessage: err.message,
      details: { file_outcomes: fileOutcomes },
    });
    await updateEndpointHealth(endpoint.id, 'push', false);
    return { runId, status: 'Failed', error: err.message };
  }
}

module.exports = { runPushForEndpoint };
