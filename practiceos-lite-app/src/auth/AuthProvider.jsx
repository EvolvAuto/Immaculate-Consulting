// ═══════════════════════════════════════════════════════════════════════════════
// src/auth/AuthProvider.jsx
// React context for Supabase Auth. Wraps <App /> and exposes:
//   { user, profile, practiceId, role, loading, error, signIn, signOut }
// via the useAuth() hook.
//
// Reads role + practice_id from auth.user.app_metadata (set server-side via
// admin API). Falls back to the public.users row if app_metadata is missing.
//
// HANG-RESISTANT BOOTSTRAP: every async branch is wrapped in try/finally so
// setLoading(false) always runs, plus a 6-second hard timeout fallback. Audit
// log calls are fire-and-forget so they cannot block the auth flow.
// ═══════════════════════════════════════════════════════════════════════════════

import { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import { supabase, signInWithEmail, signOut as sbSignOut, logAudit } from "../lib/supabaseClient";

const AuthCtx = createContext(null);
const BOOTSTRAP_TIMEOUT_MS = 6000;

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  // Resolved super admin status + capability map. Loaded alongside profile.
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [capabilities, setCapabilities] = useState(null);

  // Load public.users row matching auth.user.id. Never throws.
  const loadProfile = useCallback(async (userId) => {
    if (!userId) { setProfile(null); return; }
    try {
      const { data, error: pErr } = await supabase
        .from("users")
       .select("id, practice_id, email, full_name, role, provider_id, patient_id, avatar_url, is_active, practices(subscription_tier)")
        .eq("id", userId)
        .maybeSingle();
      if (pErr) {
        console.warn("[PracticeOS] profile load failed:", pErr.message);
        setProfile(null);
      } else {
        setProfile(data);
      }
    } catch (e) {
      console.warn("[PracticeOS] profile load threw:", e?.message || e);
      setProfile(null);
    }

    // Resolve super admin status and capabilities in parallel.
    // Both are non-blocking: failures default to safe values (no admin, no caps).
    try {
      const { data: saRows } = await supabase
        .from("super_admins")
        .select("id")
        .eq("user_id", userId)
        .is("revoked_at", null)
        .limit(1);
      setIsSuperAdmin(!!(saRows && saRows.length > 0));
    } catch (e) {
      console.warn("[PracticeOS] super_admin check failed:", e?.message || e);
      setIsSuperAdmin(false);
    }
  }, []);

  // Initial session + subscribe to future changes ------------------------------
  useEffect(() => {
    let active = true;

    // Safety net: if anything hangs, force loading off after 6s so the UI
    // can at least render the login screen instead of a forever spinner.
    const failSafe = setTimeout(() => {
      if (active) {
        console.warn("[PracticeOS] bootstrap timeout - forcing loading=false");
        setLoading(false);
      }
    }, BOOTSTRAP_TIMEOUT_MS);

    (async () => {
      try {
        const { data, error: sErr } = await supabase.auth.getSession();
        if (!active) return;
        if (sErr) console.warn("[PracticeOS] getSession error:", sErr.message);
        const initial = data?.session || null;
        setSession(initial);
        if (initial?.user) {
          await loadProfile(initial.user.id);
        }
      } catch (e) {
        if (!active) return;
        console.error("[PracticeOS] bootstrap failed:", e?.message || e);
        setError(e?.message || "Auth bootstrap failed");
      } finally {
        if (active) {
          clearTimeout(failSafe);
          setLoading(false);
        }
      }
    })();

   const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!active) return;
      // Only react to meaningful auth transitions. Ignore TOKEN_REFRESHED and
      // USER_UPDATED which fire every ~50 min and don't require a profile reload.
      setSession(newSession);
      if (event === "SIGNED_OUT" || !newSession?.user) {
        setProfile(null);
        return;
      }
      if (event === "SIGNED_IN" || event === "INITIAL_SESSION") {
        // Background: don't block UI
        loadProfile(newSession.user.id).catch((e) =>
          console.warn("[PracticeOS] profile load failed:", e?.message)
        );
        if (event === "SIGNED_IN") {
          logAudit({
            action: "Login",
            entityType: "session",
            entityId: newSession.user.id,
          }).catch(() => {});
        }
      }
    });

    return () => {
      active = false;
      clearTimeout(failSafe);
      listener.subscription.unsubscribe();
    };
  }, [loadProfile]);

  // Actions --------------------------------------------------------------------
  const signIn = useCallback(async (email, password) => {
    setError(null);
    try {
      await signInWithEmail(email, password);
    } catch (e) {
      setError(e.message || "Sign in failed");
      logAudit({
        action: "Failed Login",
        entityType: "session",
        entityId: null,
        details: { email },
        success: false,
        error: e.message,
      }).catch(() => {});
      throw e;
    }
  }, []);

  const signOut = useCallback(async () => {
    if (session?.user) {
      logAudit({
        action: "Logout",
        entityType: "session",
        entityId: session.user.id,
      }).catch(() => {});
    }
    try { await sbSignOut(); } catch (e) { console.warn("[PracticeOS] signOut error:", e?.message); }
    setProfile(null);
    setSession(null);
    setIsSuperAdmin(false);
    setCapabilities(null);
  }, [session]);

  // Load capabilities whenever practice changes (resolved server-side via RPC).
  useEffect(() => {
    const pid = session?.user?.app_metadata?.practice_id || profile?.practice_id;
    if (!pid) { setCapabilities(null); return; }
    let cancelled = false;
    supabase.rpc("get_effective_capabilities", { p_practice_id: pid })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { console.warn("[PracticeOS] capabilities load failed:", error.message); setCapabilities(null); }
        else setCapabilities(data);
      });
    return () => { cancelled = true; };
  }, [session, profile]);

  // Derived values --------------------------------------------------------------
  const value = useMemo(() => {
    const md = session?.user?.app_metadata || {};
    return {
      user:            session?.user || null,
      session,
      profile,
   role:            md.role        || profile?.role        || null,
      practiceId:      md.practice_id || profile?.practice_id || null,
      patientId:       md.patient_id  || profile?.patient_id  || null,
      providerId:      md.provider_id || profile?.provider_id || null,
      tier:            profile?.practices?.subscription_tier || "Lite",
      capabilities,
      isSuperAdmin,
      loading,
      error,
      isAuthenticated: !!session,
      signIn,
      signOut,
    };
  }, [session, profile, capabilities, isSuperAdmin, loading, error, signIn, signOut]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
