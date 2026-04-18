// ═══════════════════════════════════════════════════════════════════════════════
// src/lib/supabaseClient.js
// Singleton Supabase client for PracticeOS Lite.
// ═══════════════════════════════════════════════════════════════════════════════
//
// Environment variables (set in .env.local and Vercel):
//   VITE_SUPABASE_URL       = https://wlkwmfxmrnjqvcsbwksk.supabase.co
//   VITE_SUPABASE_ANON_KEY  = <your anon public key>
//
// Never expose the service_role key in client code — it bypasses RLS.
// ═══════════════════════════════════════════════════════════════════════════════

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // eslint-disable-next-line no-console
  console.error(
    "[PracticeOS] Missing Supabase env vars. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local"
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
    storageKey: "practiceos.auth",
    // Disable navigator.locks-based cross-tab sync. It is the documented cause
    // of "Lock 'lock:...' was released because another request stole it" errors
    // during React StrictMode double-mounts and rapid auth events. PracticeOS
    // is a single-tab workflow; we don't need cross-tab session coordination.
    lock: async (_name, _acquireTimeout, fn) => await fn(),
  },
  global: {
    headers: { "x-application-name": "practiceos-lite" },
  },
});

// Convenience helpers -----------------------------------------------------------

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function getCurrentUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return data.user;
}

export function onAuthChange(cb) {
  const { data } = supabase.auth.onAuthStateChange((event, session) => cb(event, session));
  return () => data.subscription.unsubscribe();
}

export async function signInWithEmail(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// Append a row to audit_log via the server-side function ------------------------
// Use this for any PHI read/write the app performs. Fires server-side so role
// + user_id + practice_id are pulled from the JWT, not the client.
export async function logAudit({ action, entityType, entityId, patientId = null, details = {}, success = true, error = null }) {
  const { data, error: rpcError } = await supabase.rpc("log_audit", {
    p_action:      action,
    p_entity_type: entityType,
    p_entity_id:   entityId,
    p_patient_id:  patientId,
    p_details:     details,
    p_success:     success,
    p_error:       error,
  });
  if (rpcError) {
    // Never break the user flow because of an audit-log failure
    // eslint-disable-next-line no-console
    console.warn("[PracticeOS] audit log failed:", rpcError);
    return null;
  }
  return data;
}
