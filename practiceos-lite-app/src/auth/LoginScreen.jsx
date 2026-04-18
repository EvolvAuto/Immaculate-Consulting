// ═══════════════════════════════════════════════════════════════════════════════
// src/auth/LoginScreen.jsx
// Email + password sign-in for PracticeOS Lite.
// Visual language matches the brand: teal accents, soft shadows, no Tailwind.
// ═══════════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import { useAuth } from "./AuthProvider";
import { C } from "../lib/tokens";

export default function LoginScreen() {
  const { signIn, error } = useAuth();
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [busy,     setBusy]     = useState(false);
  const [localErr, setLocalErr] = useState("");

  async function handleSubmit() {
    if (!email || !password) { setLocalErr("Enter email and password."); return; }
    setBusy(true);
    setLocalErr("");
    try {
      await signIn(email, password);
      // AuthProvider will flip isAuthenticated and the app will render.
    } catch (e) {
      setLocalErr(e.message || "Sign in failed.");
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === "Enter") handleSubmit();
  }

  const message = localErr || error;

  return (
    <div style={{
      minHeight: "100vh",
      background: `linear-gradient(180deg, ${C.bgPrimary} 0%, ${C.bgSecondary} 100%)`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
      fontFamily: "'DM Sans', system-ui, -apple-system, sans-serif",
    }}>
      <div style={{
        width: "100%",
        maxWidth: 420,
        background: C.bgPrimary,
        border: `0.5px solid ${C.borderLight}`,
        borderRadius: 16,
        boxShadow: "0 8px 32px rgba(10,34,24,0.08)",
        padding: 36,
      }}>
        {/* Logo area */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{
            width: 52, height: 52,
            margin: "0 auto 14px",
            background: C.tealBg,
            border: `0.5px solid ${C.tealBorder}`,
            borderRadius: 14,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: C.teal, fontSize: 22, fontWeight: 800,
          }}>PL</div>
          <div style={{
            fontFamily: "'Inter', system-ui, sans-serif",
            fontSize: 18, fontWeight: 700, color: C.textPrimary, letterSpacing: "-0.01em",
          }}>PracticeOS Lite</div>
          <div style={{ fontSize: 12, color: C.textTertiary, marginTop: 4 }}>
            Sign in to your practice
          </div>
        </div>

        {/* Form */}
        <div onKeyDown={onKeyDown}>
          <label style={labelStyle}>Email</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            style={inputStyle}
            autoComplete="email"
            autoFocus
          />

          <label style={{ ...labelStyle, marginTop: 14 }}>Password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            style={inputStyle}
            autoComplete="current-password"
          />

          {message && (
            <div style={{
              marginTop: 14,
              padding: "10px 12px",
              background: C.redBg,
              border: `0.5px solid ${C.redBorder}`,
              borderRadius: 8,
              color: C.red,
              fontSize: 12,
            }}>{message}</div>
          )}

          <button
            onClick={handleSubmit}
            disabled={busy}
            style={{
              width: "100%",
              marginTop: 20,
              padding: "12px 16px",
              background: busy ? C.tealMid : C.teal,
              color: "#fff",
              border: "none",
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 600,
              cursor: busy ? "default" : "pointer",
              transition: "background 0.15s",
            }}
          >
            {busy ? "Signing in..." : "Sign in"}
          </button>
        </div>

        <div style={{ marginTop: 20, textAlign: "center", fontSize: 11, color: C.textTertiary }}>
          Need access? Contact your practice administrator.
        </div>
      </div>
    </div>
  );
}

const labelStyle = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  color: C.textSecondary,
  marginBottom: 6,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const inputStyle = {
  width: "100%",
  padding: "11px 12px",
  fontSize: 14,
  border: `0.5px solid ${C.borderMid}`,
  borderRadius: 8,
  background: C.bgPrimary,
  color: C.textPrimary,
  outline: "none",
  fontFamily: "inherit",
  boxSizing: "border-box",
};
