// ═══════════════════════════════════════════════════════════════════════════════
// src/auth/SetPassword.jsx
// Public route that handles Supabase invite + password recovery callbacks.
//
// FLOW:
//   1. Supabase sends an invite or recovery email containing a magic link
//   2. The link points to https://practiceos.immaculate-consulting.org/set-password
//      with auth tokens in the URL hash (e.g. #access_token=...&type=invite&...)
//   3. supabase-js client auto-detects the hash and sets a session
//   4. We render a "Set your password" form
//   5. On submit, call supabase.auth.updateUser({ password })
//   6. Redirect to /dashboard
//
// AUTHENTICATION NOTE:
// The link delivers a temporary session that's only good for password updates.
// Until updateUser({ password }) succeeds, the session may not have the full
// app_metadata RLS expects. We don't try to render any practice content
// here - just the password form and post-success redirect.
//
// Runs OUTSIDE ProtectedRoute (see App.jsx) since the user has a token but
// hasn't completed their first-time setup yet.
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { C } from "../lib/tokens";

export default function SetPassword() {
  const navigate = useNavigate();

  // Linked-flow state machine
  //   detecting   = we're parsing the URL hash on mount
  //   ready       = we have a session, show the password form
  //   no-link     = page hit directly with no auth token in URL
  //   submitting  = updateUser is in flight
  //   success     = password set, about to redirect
  //   error       = something went wrong (token expired, network, etc.)
  const [phase, setPhase] = useState("detecting");
  const [linkType, setLinkType] = useState(null); // 'invite' | 'recovery' | null
  const [email, setEmail] = useState(null);
  const [error, setError] = useState(null);

  const [password, setPassword]   = useState("");
  const [password2, setPassword2] = useState("");

  // ── On mount: parse hash, detect link type, confirm session exists ────────
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // supabase-js auto-parses the URL hash on page load and writes a
        // session if one is present. Wait a tick for that to happen, then
        // check what we've got.
        await new Promise(r => setTimeout(r, 100));

        // Read the hash to extract the link type (invite vs recovery)
        const hash = window.location.hash.startsWith("#")
          ? window.location.hash.slice(1)
          : window.location.hash;
        const params = new URLSearchParams(hash);
        const type = params.get("type");
        if (type === "invite" || type === "recovery") setLinkType(type);

        // Did supabase-js give us a session?
        const { data, error } = await supabase.auth.getSession();
        if (cancelled) return;

        if (error) throw error;
        if (!data?.session) {
          // No session and no auth tokens in the URL = direct hit on this page
          setPhase("no-link");
          return;
        }

        setEmail(data.session.user?.email || null);
        setPhase("ready");

        // Clean the hash from the URL bar (the tokens are sensitive)
        if (window.history.replaceState) {
          window.history.replaceState(null, "", window.location.pathname);
        }
      } catch (e) {
        if (cancelled) return;
        setError(e.message || "Could not verify your invite link.");
        setPhase("error");
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const submit = async () => {
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== password2) {
      setError("Passwords don't match.");
      return;
    }

    setPhase("submitting");
    try {
      const { error: upErr } = await supabase.auth.updateUser({ password });
      if (upErr) throw upErr;

      setPhase("success");
      // Brief pause so the success state is visible, then redirect
      setTimeout(() => navigate("/dashboard"), 800);
    } catch (e) {
      setError(e.message || "Could not set your password.");
      setPhase("ready");
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: "100vh",
      background: C.bgSecondary,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
      fontFamily: "'DM Sans', system-ui, sans-serif",
    }}>
      <div style={{
        width: "100%",
        maxWidth: 440,
        background: C.bgPrimary,
        border: "0.5px solid " + C.borderLight,
        borderRadius: 14,
        padding: "32px 28px",
        boxShadow: "0 4px 16px rgba(15, 30, 24, 0.06)",
      }}>
        {/* Brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 9,
            background: C.teal, color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 13, fontWeight: 800,
          }}>PL</div>
          <div>
            <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 16, fontWeight: 700, color: C.textPrimary, letterSpacing: "-0.01em" }}>PracticeOS</div>
            <div style={{ fontSize: 11, color: C.textTertiary }}>by Immaculate Consulting</div>
          </div>
        </div>

        {phase === "detecting" && (
          <div style={{ padding: "24px 0", textAlign: "center" }}>
            <div style={{ fontSize: 14, color: C.textSecondary }}>Verifying your link…</div>
          </div>
        )}

        {phase === "no-link" && (
          <>
            <h1 style={{ fontFamily: "'Inter', sans-serif", fontSize: 22, fontWeight: 700, color: C.textPrimary, marginBottom: 8, letterSpacing: "-0.01em" }}>
              No active invite
            </h1>
            <p style={{ fontSize: 13, color: C.textSecondary, lineHeight: 1.6, marginBottom: 20 }}>
              This page handles password setup from invite or recovery emails. If you arrived here directly without clicking an email link, you'll need to either request a new invite from your practice administrator or click "Forgot password" on the sign-in page.
            </p>
            <button onClick={() => navigate("/")}
              style={{
                width: "100%",
                padding: "10px 14px",
                background: C.teal, color: "#fff",
                border: "none", borderRadius: 8,
                fontSize: 13, fontWeight: 600, fontFamily: "inherit",
                cursor: "pointer",
              }}>
              Go to sign in
            </button>
          </>
        )}

        {phase === "error" && (
          <>
            <h1 style={{ fontFamily: "'Inter', sans-serif", fontSize: 22, fontWeight: 700, color: C.textPrimary, marginBottom: 8, letterSpacing: "-0.01em" }}>
              Link issue
            </h1>
            <p style={{ fontSize: 13, color: C.textSecondary, lineHeight: 1.6, marginBottom: 14 }}>
              {error || "We couldn't verify your invite link. It may have expired."}
            </p>
            <p style={{ fontSize: 12, color: C.textTertiary, lineHeight: 1.6, marginBottom: 20 }}>
              Invite and recovery links expire after 24 hours. Ask your practice administrator to resend, or click "Forgot password" on the sign-in screen.
            </p>
            <button onClick={() => navigate("/")}
              style={{
                width: "100%",
                padding: "10px 14px",
                background: C.bgPrimary, color: C.textPrimary,
                border: "0.5px solid " + C.borderMid, borderRadius: 8,
                fontSize: 13, fontWeight: 600, fontFamily: "inherit",
                cursor: "pointer",
              }}>
              Go to sign in
            </button>
          </>
        )}

        {(phase === "ready" || phase === "submitting" || phase === "success") && (
          <>
            <h1 style={{ fontFamily: "'Inter', sans-serif", fontSize: 22, fontWeight: 700, color: C.textPrimary, marginBottom: 8, letterSpacing: "-0.01em" }}>
              {linkType === "recovery" ? "Reset your password" : "Welcome to PracticeOS"}
            </h1>
            <p style={{ fontSize: 13, color: C.textSecondary, lineHeight: 1.6, marginBottom: 20 }}>
              {linkType === "recovery"
                ? "Choose a new password to finish resetting your account."
                : "Set a password to finish setting up your account."}
              {email && <> Signed in as <b style={{ color: C.textPrimary }}>{email}</b>.</>}
            </p>

            <FormField label="New password">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={phase !== "ready"}
                autoFocus
                placeholder="At least 8 characters"
              />
            </FormField>
            <FormField label="Confirm password">
              <input
                type="password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                disabled={phase !== "ready"}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && phase === "ready") submit();
                }}
                placeholder="Re-enter your password"
              />
            </FormField>

            {error && (
              <div style={{
                padding: 10,
                background: "#fef2f2",
                border: "0.5px solid " + C.red,
                borderRadius: 6,
                color: C.red,
                fontSize: 12,
                marginBottom: 12,
              }}>{error}</div>
            )}

            {phase === "success" && (
              <div style={{
                padding: 10,
                background: C.tealBg,
                border: "0.5px solid " + C.tealBorder,
                borderRadius: 6,
                color: C.teal,
                fontSize: 13, fontWeight: 600,
                marginBottom: 12,
                textAlign: "center",
              }}>
                ✓ Password set · taking you to your dashboard…
              </div>
            )}

            <button onClick={submit}
              disabled={phase === "submitting" || phase === "success"}
              style={{
                width: "100%",
                padding: "11px 14px",
                background: phase === "submitting" || phase === "success" ? C.borderMid : C.teal,
                color: "#fff",
                border: "none", borderRadius: 8,
                fontSize: 13, fontWeight: 600, fontFamily: "inherit",
                cursor: phase === "ready" ? "pointer" : "default",
              }}>
              {phase === "submitting" ? "Setting password…" : phase === "success" ? "Redirecting…" : (linkType === "recovery" ? "Reset password" : "Set password")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Small input wrapper for consistent styling ─────────────────────────────
function FormField({ label, children }) {
  // Clone the input to inject the consistent style
  const styled = (
    <div>
      <label style={{
        display: "block",
        fontSize: 11, fontWeight: 600,
        color: C.textSecondary,
        marginBottom: 5,
        textTransform: "uppercase", letterSpacing: "0.06em",
      }}>{label}</label>
      <div style={{
        marginBottom: 14,
      }}>
        {wrapInput(children)}
      </div>
    </div>
  );
  return styled;
}

function wrapInput(child) {
  // Inject our default styles onto the <input/> element
  if (!child || child.type !== "input") return child;
  const style = {
    width: "100%",
    padding: "10px 12px",
    border: "0.5px solid " + C.borderMid,
    borderRadius: 7,
    fontSize: 14,
    fontFamily: "inherit",
    color: C.textPrimary,
    outline: "none",
    background: child.props.disabled ? C.bgSecondary : C.bgPrimary,
    ...child.props.style,
  };
  return { ...child, props: { ...child.props, style } };
}
