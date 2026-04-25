// Ledger writes against cm_prl_sftp_runs.
//
// Every pull or push tick that processes an endpoint writes one row:
//   1. startRun() inserts a Running row, returns the run_id
//   2. work happens
//   3. completeRun() or failRun() updates that same row to its final state
//
// If the worker crashes between steps 1 and 3, the row stays at status='Running'.
// A daily janitor (not built yet) could sweep stale Running rows.

const { admin } = require('./supabase');

async function startRun({ practiceId, endpointId, runType, triggeredBy }) {
  const { data, error } = await admin
    .from('cm_prl_sftp_runs')
    .insert({
      practice_id: practiceId,
      endpoint_id: endpointId,
      run_type: runType,         // 'pull' | 'push'
      triggered_by: triggeredBy, // 'cron' | 'manual'
      status: 'Running',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error) {
    throw new Error('cm_prl_sftp_runs insert failed: ' + error.message);
  }
  return data.id;
}

async function completeRun(runId, { status, stats, errorMessage, details }) {
  const { error } = await admin
    .from('cm_prl_sftp_runs')
    .update({
      status: status, // 'Success' | 'Partial' | 'Failed' | 'TestMode'
      completed_at: new Date().toISOString(),
      files_seen:                   stats?.files_seen ?? null,
      files_downloaded:             stats?.files_downloaded ?? null,
      files_skipped_already_seen:   stats?.files_skipped_already_seen ?? null,
      imports_created:              stats?.imports_created ?? null,
      exports_seen:                 stats?.exports_seen ?? null,
      exports_uploaded:             stats?.exports_uploaded ?? null,
      exports_skipped_already_uploaded: stats?.exports_skipped_already_uploaded ?? null,
      error_message: errorMessage || null,
      details: details || null,
    })
    .eq('id', runId);
  if (error) {
    // Don't throw - completing the run is best-effort. Log it.
    console.error('[runs.completeRun] update failed:', error.message);
  }
}

// Update endpoint health metadata after a run.
async function updateEndpointHealth(endpointId, runType, success) {
  if (!endpointId) return;
  const patch = { updated_at: new Date().toISOString() };
  const nowIso = new Date().toISOString();
  if (runType === 'pull') {
    patch.last_pull_at = nowIso;
    patch.last_pull_success = success;
  } else {
    patch.last_push_at = nowIso;
    patch.last_push_success = success;
  }
  if (success) {
    patch.consecutive_failures = 0;
  } else {
    // Increment via RPC would be cleaner, but a simple read-then-write is fine
    const { data: cur } = await admin
      .from('cm_sftp_endpoints')
      .select('consecutive_failures')
      .eq('id', endpointId)
      .single();
    patch.consecutive_failures = (cur?.consecutive_failures || 0) + 1;
  }
  const { error } = await admin
    .from('cm_sftp_endpoints')
    .update(patch)
    .eq('id', endpointId);
  if (error) {
    console.error('[runs.updateEndpointHealth] failed:', error.message);
  }
}

module.exports = { startRun, completeRun, updateEndpointHealth };
