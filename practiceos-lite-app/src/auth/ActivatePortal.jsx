// ═══════════════════════════════════════════════════════════════════════════════
// src/auth/ActivatePortal.jsx
// Patient portal activation page.
// Flow: read ?token= from URL -> verify identity (DOB + last 4 phone) -> set password
// -> auto-sign in -> redirect to portal dashboard.
// Rendered by App.jsx when location.pathname === "/activate".
// ═══════════════════════════════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import { supabase, signInWithEmail } from "../lib/supabaseClient";

const C = {
  teal:"#0F6E56", tealMid:"#1D9E75", tealBg:"#E1F5EE", tealBorder:"#9FE1CB", tealDark:"#085041",
  red:"#A32D2D", redBg:"#FCEBEB", redBorder:"#F5B8B8",
  bgPrimary:"#ffffff", bgSecondary:"#f7f7f5", bgTertiary:"#f0efeb",
  textPrimary:"#1a1a18", textSecondary:"#6b6a63", textTertiary:"#9c9b94",
  borderLight:"rgba(0,0,0,0.08)", borderMid:"rgba(0,0,0,0.18)",
};

const EDGE_URL = (import.meta.env.VITE_SUPABASE_URL || "") + "/functions/v1/portal-activate";
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";

// Extract ?token= from current URL
function getToken() {
  const params = new URLSearchParams(window.location.search);
  return params.get("token") || "";
}

async function callEdge(payload) {
  const res = await fetch(EDGE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": ANON_KEY,
      "Authorization": "Bearer " + ANON_KEY,
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

export default function ActivatePortal() {
  const token = getToken();
  const [step, setStep] = useState(token ? "verify" : "nolink");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [dob, setDob] = useState("");
  const [phoneLast4, setPhoneLast4] = useState("");
  const [email, setEmail] = useState("");
  const [patientName, setPatientName] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");

  const submitVerify = async (e) => {
    e.preventDefault();
    setErr("");
    if (!dob) { setErr("Please enter your date of birth."); return; }
    if (!phoneLast4 || phoneLast4.length !== 4) { setErr("Please enter the last 4 digits of your phone."); return; }
    setLoading(true);
    try {
      const r = await callEdge({ action:"verify", token, dob, phoneLast4 });
      setEmail(r.email);
      setPatientName(r.patientName || "");
      setStep("password");
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setLoading(false);
    }
  };

  const submitComplete = async (e) => {
    e.preventDefault();
    setErr("");
    if (pw.length < 8) { setErr("Password must be at least 8 characters."); return; }
    if (pw !== pw2)    { setErr("Passwords do not match."); return; }
    setLoading(true);
    try {
      await callEdge({ action:"complete", token, dob, phoneLast4, password: pw });
      // Now sign in with the newly set credentials
      await signInWithEmail(email, pw);
      // App.jsx will pick up the session and route to portal dashboard
      window.history.replaceState({}, "", "/");
      window.location.reload();
    } catch (e2) {
      setErr(e2.message);
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center",
      background:C.bgTertiary, padding:20, fontFamily:"Inter, system-ui, sans-serif"
    }}>
      <div style={{
        width:"100%", maxWidth:440, background:C.bgPrimary,
        border:"0.5px solid " + C.borderLight, borderRadius:12,
        padding:"32px 28px", boxShadow:"0 4px 20px rgba(0,0,0,0.06)"
      }}>
        <div style={{ textAlign:"center", marginBottom:24 }}>
          <div style={{
            width:48, height:48, borderRadius:10, background:C.teal, color:"#fff",
            display:"inline-flex", alignItems:"center", justifyContent:"center",
            fontSize:18, fontWeight:700, marginBottom:12
          }}>P</div>
          <div style={{ fontSize:18, fontWeight:600, color:C.textPrimary }}>Activate Patient Portal</div>
          <div style={{ fontSize:12, color:C.textTertiary, marginTop:4 }}>PracticeOS Lite</div>
        </div>

        {step === "nolink" && (
          <div style={{ background:C.redBg, border:"0.5px solid " + C.redBorder,
                        borderRadius:7, padding:"12px 14px", fontSize:12, color:C.red, lineHeight:1.6 }}>
            No activation token was found in the URL. Please use the secure link provided in
            your invitation email. If you need a new link, contact your practice.
          </div>
        )}

        {step === "verify" && (
          <form onSubmit={submitVerify}>
            <div style={{
              background:C.tealBg, border:"0.5px solid " + C.tealBorder, borderRadius:7,
              padding:"10px 12px", fontSize:11.5, color:C.tealDark, lineHeight:1.55, marginBottom:18
            }}>
              To protect your privacy, please verify your identity before setting your password.
            </div>

            <Label>Date of Birth</Label>
            <Input type="date" value={dob} onChange={setDob} autoFocus />

            <Label>Last 4 digits of your phone number</Label>
            <Input type="tel" inputMode="numeric" maxLength={4}
                   value={phoneLast4} onChange={(v)=>setPhoneLast4(v.replace(/\D/g,"").slice(0,4))}
                   placeholder="1234" />

            <ErrBox msg={err} />

            <button type="submit" disabled={loading} style={primaryBtn(loading)}>
              {loading ? "Verifying..." : "Continue"}
            </button>

            <HelpText />
          </form>
        )}

        {step === "password" && (
          <form onSubmit={submitComplete}>
            <div style={{
              background:C.tealBg, border:"0.5px solid " + C.tealBorder, borderRadius:7,
              padding:"10px 12px", fontSize:11.5, color:C.tealDark, lineHeight:1.55, marginBottom:18
            }}>
              Welcome{patientName ? ", " + patientName.split(" ")[0] : ""}.
              Create a password for your portal account. You will sign in with{" "}
              <strong>{email}</strong>.
            </div>

            <Label>New Password</Label>
            <Input type="password" value={pw} onChange={setPw} placeholder="At least 8 characters" autoFocus />

            <Label>Confirm Password</Label>
            <Input type="password" value={pw2} onChange={setPw2} />

            <ErrBox msg={err} />

            <button type="submit" disabled={loading} style={primaryBtn(loading)}>
              {loading ? "Setting up..." : "Activate and Sign In"}
            </button>

            <HelpText />
          </form>
        )}
      </div>
    </div>
  );
}

// ─── small helpers ────────────────────────────────────────────────────────────
function Label({ children }) {
  return <div style={{
    fontSize:11, fontWeight:600, color:C.textSecondary, marginBottom:5,
    textTransform:"uppercase", letterSpacing:"0.04em"
  }}>{children}</div>;
}

function Input({ type="text", value, onChange, placeholder, autoFocus, inputMode, maxLength }) {
  return (
    <input
      type={type} value={value} placeholder={placeholder}
      inputMode={inputMode} maxLength={maxLength} autoFocus={autoFocus}
      onChange={(e)=>onChange(e.target.value)}
      style={{
        width:"100%", padding:"10px 12px", border:"0.5px solid " + C.borderMid,
        borderRadius:7, fontSize:13, fontFamily:"inherit", color:C.textPrimary,
        background:C.bgPrimary, outline:"none", marginBottom:14, boxSizing:"border-box",
      }}
    />
  );
}

function primaryBtn(loading) {
  return {
    width:"100%", padding:"11px 14px", borderRadius:7, border:"0.5px solid " + C.teal,
    background:loading ? C.tealMid : C.teal, color:"#fff", fontSize:13, fontWeight:600,
    cursor:loading ? "wait" : "pointer", fontFamily:"inherit", marginTop:4,
  };
}

function ErrBox({ msg }) {
  if (!msg) return null;
  return (
    <div style={{
      background:C.redBg, border:"0.5px solid " + C.redBorder, borderRadius:7,
      padding:"8px 12px", fontSize:12, color:C.red, marginBottom:12, lineHeight:1.5
    }}>{msg}</div>
  );
}

function HelpText() {
  return (
    <div style={{ fontSize:11, color:C.textTertiary, marginTop:16, textAlign:"center", lineHeight:1.55 }}>
      Having trouble? Contact your practice directly to resend or reset your invitation.
    </div>
  );
}
