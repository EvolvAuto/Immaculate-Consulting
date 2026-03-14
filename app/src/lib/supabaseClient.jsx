/**
 * supabaseClient.js
 * ─────────────────────────────────────────────────────────────────────────────
 * IC-BOS | Immaculate Consulting Business Operating System
 * Supabase client singleton — import this everywhere you need DB access.
 *
 * SECURITY NOTES:
 *  - The anon key is safe to expose in client-side code; Supabase RLS restricts
 *    what an authenticated user can actually read/write.
 *  - The anon role has ZERO table access (see ic_bos_migration.sql SECTION 9).
 *    All queries require a valid Supabase Auth session (authenticated role).
 *  - Store these values in .env.local; never commit secrets to git.
 *
 * HIPAA POSTURE:
 *  - RLS is enabled on all tables — unauthorized reads return 0 rows, not 403s.
 *  - The `principal` JWT role claim bypasses row filters for Leonard.
 *  - Consultants see only clients where assigned_to = their auth.uid().
 *  - Viewers get SELECT-only access with no INSERT/UPDATE/DELETE.
 *
 * Usage:
 *   import { supabase } from './lib/supabaseClient';
 *   const { data, error } = await supabase.from('clients').select('*');
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createClient } from '@supabase/supabase-js';

// ─── Environment Variables ────────────────────────────────────────────────────
// Prefer env vars in production; fall back to direct values for local dev only.
// In Create React App: REACT_APP_SUPABASE_URL / REACT_APP_SUPABASE_ANON_KEY
// In Vite:            VITE_SUPABASE_URL       / VITE_SUPABASE_ANON_KEY

const SUPABASE_URL =
  process.env.REACT_APP_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://cofhgphltpykchidshds.supabase.co';

const SUPABASE_ANON_KEY =
  process.env.REACT_APP_SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  'sb_publishable_EfCowkWITuK-2l_exTDBdQ_Kp78yVIj';

// ─── Client Options ───────────────────────────────────────────────────────────
const supabaseOptions = {
  auth: {
    // Persist the auth session across page reloads via localStorage.
    persistSession: true,
    // Auto-refresh the JWT before it expires — prevents silent logouts.
    autoRefreshToken: true,
    // Detect session from URL hash (needed for magic link / OAuth flows).
    detectSessionInUrl: true,
    // Storage key prefix to avoid collisions if multiple Supabase apps run
    // on the same domain.
    storageKey: 'ic-bos-auth',
  },
  // Realtime settings — used for live dashboard updates on Automations tab.
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
  // Global fetch options (e.g., add custom headers for audit logging).
  global: {
    headers: {
      'x-application-name': 'IC-BOS',
    },
  },
};

// ─── Singleton Export ─────────────────────────────────────────────────────────
// createClient is safe to call once at module level — all imports share the
// same instance, which manages its own connection pool.

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, supabaseOptions);


// ─── Auth Helpers ─────────────────────────────────────────────────────────────

/**
 * Sign in with email + password.
 * On success, Supabase stores the session and RLS picks up auth.uid().
 *
 * @param {string} email
 * @param {string} password
 * @returns {{ data: Session|null, error: Error|null }}
 */
export const signIn = async (email, password) => {
  return supabase.auth.signInWithPassword({ email, password });
};

/**
 * Sign out and clear the local session.
 */
export const signOut = async () => {
  return supabase.auth.signOut();
};

/**
 * Get the currently authenticated user.
 * Returns null if not signed in.
 *
 * @returns {User|null}
 */
export const getCurrentUser = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
};

/**
 * Get the role claim from the current JWT app_metadata.
 * Returns 'viewer' as a safe default if no session or no claim.
 *
 * Roles: 'principal' | 'consultant' | 'viewer'
 *
 * @returns {'principal'|'consultant'|'viewer'}
 */
export const getCurrentRole = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return 'viewer';
  return session.user?.app_metadata?.role ?? 'viewer';
};


// ─── Query Helpers ────────────────────────────────────────────────────────────

/**
 * Standardized error logger — keeps error handling consistent across hooks.
 * Replace with Sentry/LogRocket in production.
 *
 * @param {string} context  - e.g. 'fetchClients'
 * @param {Error}  error    - Supabase error object
 */
export const logQueryError = (context, error) => {
  if (process.env.NODE_ENV !== 'production') {
    console.error(`[IC-BOS Supabase] ${context}:`, error?.message ?? error);
  }
  // TODO: send to error tracking (e.g. Sentry.captureException(error))
};
