// ═══════════════════════════════════════════════════════════════════════════════
// src/auth/AuthProvider.jsx
// React context for Supabase Auth. Wraps <App /> and exposes:
//   { user, profile, practiceId, role, loading, error, signIn, signOut }
// via the useAuth() hook.
//
// Reads role + practice_id from auth.user.app_metadata (set server-side via
// admin API). Falls back to the public.users row if app_metadata is missing.
// ═══════════════════════════════════════════════════════════════════════════════

import { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import { supabase, signInWithEmail, signOut as sbSignOut, logAudit } from "../lib/supabaseClient";

const AuthCtx = createContext(null);

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

export function AuthProvider({ children }) {
  const [session,   setSession]   = useState(null);
  const [profile,   setProfile]   = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);

  // Load the public.users row that matches auth.user.id
  const loadProfile = useCallback(async (userId) => {
    if (!userId) { setProfile(null); return; }
    const { data, error: pErr } = await supabase
      .from("users")
      .select("id, practice_id, email, full_name, role, provider_id, patient_id, avatar_url, is_active")
      .eq("id", userId)
      .single();
    if (pErr) {
      console.warn("[PracticeOS] profile load failed:", pErr.message);
      setProfile(null);
    } else {
      setProfile(data);
    }
  }, []);

  // Initial session + subscribe to future changes ------------------------------
  useEffect(() => {
    let active = true;

    (async () => {
      const { data: { session: initial } } = await supabase.auth.getSession();
      if (!active) return;
      setSession(initial);
      if (initial?.user) await loadProfile(initial.user.id);
      setLoading(false);
    })();

    const { data: listener } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (!active) return;
      setSession(newSession);
      if (newSession?.user) {
        await loadProfile(newSession.user.id);
        if (event === "SIGNED_IN") {
          logAudit({ action: "Login", entityType: "session", entityId: newSession.user.id });
        }
      } else {
        setProfile(null);
      }
    });

    return () => { active = false; listener.subscription.unsubscribe(); };
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
      });
      throw e;
    }
  }, []);

  const signOut = useCallback(async () => {
    if (session?.user) {
      await logAudit({ action: "Logout", entityType: "session", entityId: session.user.id });
    }
    await sbSignOut();
    setProfile(null);
    setSession(null);
  }, [session]);

  // Derived values --------------------------------------------------------------
  const value = useMemo(() => {
    const md = session?.user?.app_metadata || {};
    return {
      user:        session?.user || null,
      session,
      profile,
      role:        md.role       || profile?.role       || null,
      practiceId:  md.practice_id || profile?.practice_id || null,
      patientId:   md.patient_id  || profile?.patient_id  || null,
      providerId:  md.provider_id || profile?.provider_id || null,
      loading,
      error,
      isAuthenticated: !!session,
      signIn,
      signOut,
    };
  }, [session, profile, loading, error, signIn, signOut]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
