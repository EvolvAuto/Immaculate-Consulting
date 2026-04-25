// Service-role Supabase client.
//
// Bypasses RLS. Used to:
//   - Read cm_sftp_endpoints (the poller's source of truth for what to do)
//   - Write cm_prl_sftp_runs (the run ledger)
//   - Read/update cm_prl_exports for outbound transmission tracking
//   - Look up practices.id when needed
//
// The service-role key never leaves this process. The poller never exposes
// it to inbound HTTP requests.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) {
  throw new Error('SUPABASE_URL not set in environment');
}
if (!SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY not set in environment');
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

module.exports = {
  admin,
  SUPABASE_URL,
  SERVICE_ROLE_KEY,
};
