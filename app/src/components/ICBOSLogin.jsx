import { useState } from "react";
import { supabase } from "./lib/supabaseClient";

// ── Brand tokens ─────────────────────────────────────────────────────────────
const BRAND = {
  cyan:       "#2ab6d7",
  cyanHover:  "#3fcbec",
  cyanActive: "#1fa0c0",
  navyDark:   "#0d2b4e",
  navyDeep:   "#0a2240",
  textPrimary:   "#f0f8ff",
  textSecondary: "#a8c8e8",
  textMuted:     "#7aaacb",
  green:      "#4ade80",
};

// ── Inline styles ─────────────────────────────────────────────────────────────
const S = {
  page: {
    minHeight: "100vh",
    background: BRAND.navyDark,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
    padding: "24px",
  },
  card: {
    width: "100%",
    maxWidth: "900px",
    minHeight: "520px",
    display: "grid",
    gridTemplateColumns: "55% 45%",
    borderRadius: "14px",
    overflow: "hidden",
    boxShadow: "0 32px 80px rgba(0,0,0,0.5)",
  },
  left: {
    background: BRAND.navyDark,
    padding: "44px 52px",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    position: "relative",
    overflow: "hidden",
  },
  dotsOverlay: {
    position: "absolute",
    inset: 0,
    backgroundImage: "radial-gradient(rgba(42,182,215,0.15) 1px, transparent 1px)",
    backgroundSize: "28px 28px",
    pointerEvents: "none",
  },
  glowOverlay: {
    position: "absolute",
    top: "-100px",
    right: "-100px",
    width: "380px",
    height: "380px",
    background: BRAND.cyan,
    opacity: 0.08,
    borderRadius: "50%",
    pointerEvents: "none",
  },
  accentBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: "2px",
    background: BRAND.cyan,
    opacity: 0.6,
  },
  logoArea: {
    position: "relative",
    zIndex: 2,
  },
  companyName: {
    fontSize: "15px",
    fontWeight: 500,
    color: BRAND.textPrimary,
    letterSpacing: "-0.2px",
    margin: 0,
  },
  platformLabel: {
    fontSize: "10px",
    color: BRAND.cyan,
    textTransform: "uppercase",
    letterSpacing: "2.5px",
    fontWeight: 500,
    marginTop: "2px",
  },
  heroArea: {
    position: "relative",
    zIndex: 2,
  },
  eyebrow: {
    fontSize: "11px",
    color: BRAND.cyan,
    textTransform: "uppercase",
    letterSpacing: "2.5px",
    fontWeight: 500,
    marginBottom: "16px",
  },
  headline: {
    fontFamily: "'Playfair Display', Georgia, serif",
    fontSize: "clamp(32px, 3vw, 40px)",
    fontWeight: 700,
    color: BRAND.textPrimary,
    lineHeight: 1.1,
    letterSpacing: "-0.5px",
    marginBottom: "20px",
  },
  headlineAccent: {
    fontStyle: "italic",
    color: BRAND.cyan,
    fontWeight: 400,
  },
  subText: {
    fontSize: "13px",
    color: BRAND.textSecondary,
    lineHeight: 1.8,
    maxWidth: "300px",
    fontWeight: 300,
    margin: 0,
  },
  statsRow: {
    display: "flex",
    gap: 0,
    position: "relative",
    zIndex: 2,
    borderTop: `1px solid rgba(42,182,215,0.2)`,
    paddingTop: "24px",
  },
  stat: {
    flex: 1,
    paddingRight: "24px",
    borderRight: "1px solid rgba(42,182,215,0.12)",
    marginRight: "24px",
  },
  statLast: {
    flex: 1,
  },
  statNum: {
    fontFamily: "'Playfair Display', Georgia, serif",
    fontSize: "26px",
    fontWeight: 700,
    color: BRAND.textPrimary,
    margin: 0,
  },
  statSup: {
    fontSize: "13px",
    color: BRAND.cyan,
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 500,
    verticalAlign: "super",
  },
  statLabel: {
    fontSize: "10px",
    color: BRAND.textMuted,
    textTransform: "uppercase",
    letterSpacing: "1.5px",
    marginTop: "4px",
  },
  right: {
    background: BRAND.navyDeep,
    borderLeft: "1px solid rgba(42,182,215,0.15)",
    padding: "44px 44px",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    gap: "22px",
  },
  formEyebrow: {
    fontSize: "10px",
    color: BRAND.cyan,
    textTransform: "uppercase",
    letterSpacing: "2.5px",
    fontWeight: 500,
  },
  formTitle: {
    fontFamily: "'Playfair Display', Georgia, serif",
    fontSize: "28px",
    fontWeight: 700,
    color: BRAND.textPrimary,
    letterSpacing: "-0.5px",
    margin: 0,
  },
  formSub: {
    fontSize: "12px",
    color: BRAND.textSecondary,
    fontWeight: 400,
    margin: 0,
  },
  fieldLabel: {
    fontSize: "10px",
    color: BRAND.textSecondary,
    textTransform: "uppercase",
    letterSpacing: "1.5px",
    fontWeight: 500,
    marginBottom: "7px",
    display: "block",
  },
  input: {
    background: "rgba(42,182,215,0.06)",
    border: "1px solid rgba(42,182,215,0.2)",
    borderRadius: "8px",
    padding: "11px 14px",
    fontSize: "13px",
    color: BRAND.textPrimary,
    fontFamily: "'DM Sans', sans-serif",
    width: "100%",
    outline: "none",
    boxSizing: "border-box",
    colorScheme: "dark",
  },
  errorBox: {
    background: "rgba(239,68,68,0.1)",
    border: "1px solid rgba(239,68,68,0.2)",
    borderRadius: "7px",
    padding: "10px 14px",
    fontSize: "12px",
    color: "#fca5a5",
  },
  dividerRow: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  dividerLine: {
    flex: 1,
    height: "1px",
    background: "rgba(42,182,215,0.15)",
  },
  dividerText: {
    fontSize: "11px",
    color: BRAND.textPrimary,
  },
  statusRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  statusDot: {
    width: "7px",
    height: "7px",
    borderRadius: "50%",
    background: BRAND.green,
    flexShrink: 0,
  },
  statusText: {
    fontSize: "11px",
    color: BRAND.green,
    fontWeight: 500,
  },
  statusDetail: {
    fontSize: "11px",
    color: BRAND.textPrimary,
  },
  footer: {
    fontSize: "10px",
    color: BRAND.textPrimary,
    textAlign: "center",
    letterSpacing: "0.5px",
    opacity: 0.75,
  },
};

export default function ICBOSLogin({ onLogin }) {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [btnHover, setBtnHover] = useState(false);

  const handleSignIn = async (e) => {
    e?.preventDefault();
    if (!email || !password) { setError("Email and password are required."); return; }
    setError("");
    setLoading(true);
    const { error: authErr } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (authErr) {
      setError(authErr.message === "Invalid login credentials"
        ? "Incorrect email or password. Please try again."
        : authErr.message);
    } else {
      onLogin?.();
    }
  };

  const btnStyle = {
    backgroundColor: btnHover ? BRAND.cyanHover : BRAND.cyan,
    border: "none",
    borderRadius: "8px",
    padding: "13px 20px",
    fontSize: "14px",
    fontWeight: 500,
    color: "#ffffff",
    cursor: loading ? "not-allowed" : "pointer",
    fontFamily: "'DM Sans', sans-serif",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    letterSpacing: "-0.2px",
    width: "100%",
    opacity: loading ? 0.7 : 1,
    transform: btnHover && !loading ? "translateY(-2px)" : "translateY(0)",
    transition: "background-color 0.2s ease, transform 0.15s ease",
  };

  return (
    <>
      {/* Load fonts */}
      <link
        href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;1,400&family=DM+Sans:wght@300;400;500&display=swap"
        rel="stylesheet"
      />
      {/* Dot pulse animation */}
      <style>{`
        @keyframes icbos-pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }
        .icbos-status-dot { animation: icbos-pulse 2.4s ease-in-out infinite; }
        @media (max-width: 640px) {
          .icbos-card { grid-template-columns: 1fr !important; }
          .icbos-left { display: none !important; }
          .icbos-right { padding: 36px 28px !important; }
        }
      `}</style>

      <div style={S.page}>
        <div style={S.card} className="icbos-card">

          {/* ── LEFT PANEL ── */}
          <div style={S.left} className="icbos-left">
            <div style={S.dotsOverlay} />
            <div style={S.glowOverlay} />

            {/* Logo */}
            <div style={S.logoArea}>
              <p style={S.companyName}>Immaculate Consulting</p>
              <p style={S.platformLabel}>IC-BOS Platform</p>
            </div>

            {/* Hero */}
            <div style={S.heroArea}>
              <p style={S.eyebrow}>Business Operating System</p>
              <h1 style={S.headline}>
                Reclaim your<br />
                practice&apos;s{" "}
                <em style={S.headlineAccent}>time</em>
                <br />
                &amp; revenue.
              </h1>
              <p style={S.subText}>
                The internal command center for Immaculate Consulting — built
                for NC medical practices running on AI-powered automation.
              </p>
            </div>

            {/* Stats */}
            <div style={S.statsRow}>
              <div style={S.stat}>
                <p style={S.statNum}>50<sup style={S.statSup}>%</sup></p>
                <p style={S.statLabel}>Less admin burden</p>
              </div>
              <div style={S.stat}>
                <p style={S.statNum}>$50<sup style={S.statSup}>K+</sup></p>
                <p style={S.statLabel}>Revenue recovered</p>
              </div>
              <div style={S.statLast}>
                <p style={S.statNum}>15<sup style={S.statSup}>h</sup></p>
                <p style={S.statLabel}>Saved weekly</p>
              </div>
            </div>

            <div style={S.accentBar} />
          </div>

          {/* ── RIGHT PANEL ── */}
          <div style={S.right} className="icbos-right">
            {/* Form header */}
            <div>
              <p style={S.formEyebrow}>Secure Access</p>
              <h2 style={S.formTitle}>Sign in.</h2>
              <p style={S.formSub}>Immaculate Consulting internal platform</p>
            </div>

            {/* Error */}
            {error && <div style={S.errorBox}>{error}</div>}

            {/* Email */}
            <div>
              <label style={S.fieldLabel}>Email address</label>
              <input
                style={S.input}
                type="email"
                placeholder="leonard@immaculate-consulting.org"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSignIn()}
                autoComplete="email"
              />
            </div>

            {/* Password */}
            <div>
              <label style={S.fieldLabel}>Password</label>
              <input
                style={S.input}
                type="password"
                placeholder="••••••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSignIn()}
                autoComplete="current-password"
              />
            </div>

            {/* Submit */}
            <button
              style={btnStyle}
              onClick={handleSignIn}
              onMouseEnter={() => setBtnHover(true)}
              onMouseLeave={() => setBtnHover(false)}
              disabled={loading}
            >
              {loading ? "Signing in..." : "Sign in to IC-BOS"}
              <span style={{ fontSize: "18px", color: "#ffffff" }}>→</span>
            </button>

            {/* Divider */}
            <div style={S.dividerRow}>
              <div style={S.dividerLine} />
              <span style={S.dividerText}>secure · encrypted</span>
              <div style={S.dividerLine} />
            </div>

            {/* Status */}
            <div style={S.statusRow}>
              <div
                className="icbos-status-dot"
                style={{ ...S.statusDot }}
              />
              <span style={S.statusText}>System live</span>
              <span style={S.statusDetail}>· Autonomously operated</span>
            </div>

            {/* Footer */}
            <p style={S.footer}>
              HIPAA compliant · Role-based access · NC Medical Practices
            </p>
          </div>

        </div>
      </div>
    </>
  );
}
