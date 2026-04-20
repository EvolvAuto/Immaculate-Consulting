// ═══════════════════════════════════════════════════════════════════════════════
// src/views/InvitePatientModal.jsx
//
// Creates a portal_invitations row for an existing patient and returns the
// activation URL for the admin to share. Replaces the SQL-insert workflow
// we've been using for test patients (Jamal, Ryan, Kate).
//
// Uses the existing portal_invitations schema - no new backend needed. Client
// just inserts the row directly (RLS allows staff to write via form_subs_staff
// style policies on portal_invitations).
// ═══════════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { C } from "../lib/tokens";

export default function InvitePatientModal({ patient, practiceId, onClose, onInvited }) {
  const [email, setEmail]         = useState(patient && patient.email ? patient.email : "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]         = useState(null);
  const [result, setResult]       = useState(null);
  const [copied, setCopied]       = useState(false);

  const submit = async () => {
    setError(null);
    const normalized = email.toLowerCase().trim();
    if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      setError("Please enter a valid email address.");
      return;
    }

    setSubmitting(true);
    try {
      // Check for existing unused invitations on this patient
      const { data: existing } = await supabase.from("portal_invitations")
        .select("id, status")
        .eq("patient_id", patient.id)
        .in("status", ["Pending", "Sent"])
        .limit(1);
      if (existing && existing.length > 0) {
        if (!window.confirm("This patient already has a pending invitation. Issue a new one anyway? The old one will still work until it expires.")) {
          setSubmitting(false);
          return;
        }
      }

      // Generate a token client-side (uses crypto.getRandomValues)
      const token = generateToken();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      const { data, error: insErr } = await supabase
        .from("portal_invitations")
        .insert({
          practice_id: practiceId,
          patient_id:  patient.id,
          email:       normalized,
          token,
          status:      "Sent",
          expires_at:  expiresAt.toISOString(),
        })
        .select("id, token, expires_at, email")
        .single();

      if (insErr) throw insErr;

      // Build activation URL from current origin (practiceos.immaculate-consulting.org)
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const url = origin + "/activate?token=" + data.token;

      setResult({
        ...data,
        activation_url: url,
      });
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const copyUrl = async () => {
    if (!result?.activation_url) return;
    try {
      await navigator.clipboard.writeText(result.activation_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (_e) { /* clipboard permission denied */ }
  };

  const done = () => {
    if (onInvited && result) onInvited(result);
    onClose();
  };

  const patientName = patient ? (patient.first_name + " " + patient.last_name).trim() : "Patient";
  const dob = patient && patient.date_of_birth ? String(patient.date_of_birth).slice(0, 10) : null;
  const phoneLast4 = patient && patient.phone_mobile
    ? String(patient.phone_mobile).replace(/\D/g, "").slice(-4)
    : null;

  return (
    <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={panel}>

        {result ? (
          <>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary, marginBottom: 4 }}>
              Portal invitation created
            </div>
            <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 14 }}>
              {patientName} can now activate their portal using the link below.
              Expires <strong>{new Date(result.expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</strong>.
            </div>

            <div style={{
              background: C.tealBg, border: "0.5px solid " + C.tealBorder,
              borderRadius: 6, padding: "12px 14px", marginBottom: 14,
            }}>
              <div style={{
                fontSize: 10, fontWeight: 700, color: C.teal, textTransform: "uppercase",
                letterSpacing: 0.5, marginBottom: 6,
              }}>Activation link</div>
              <div style={{
                background: "#fff", border: "0.5px solid " + C.borderLight, borderRadius: 4,
                padding: "6px 10px", fontSize: 10, fontFamily: "monospace",
                color: C.textPrimary, wordBreak: "break-all", marginBottom: 8,
                maxHeight: 80, overflow: "auto",
              }}>
                {result.activation_url}
              </div>
              <button type="button" onClick={copyUrl}
                style={{
                  ...btnSecondary,
                  background: copied ? C.tealMid : "#fff",
                  color: copied ? "#fff" : C.teal,
                  borderColor: C.tealBorder,
                }}>
                {copied ? "✓ Copied" : "Copy link"}
              </button>
            </div>

            <div style={{
              background: C.amberBg, border: "0.5px solid " + C.amberBorder,
              borderRadius: 6, padding: "10px 14px", marginBottom: 14,
              fontSize: 11, lineHeight: 1.55, color: C.amber,
            }}>
              <div style={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, fontSize: 10, marginBottom: 4 }}>
                Patient will be asked to verify:
              </div>
              <div>Date of birth: <strong>{dob || "(not on file — set one on the patient record first)"}</strong></div>
              <div>Last 4 digits of phone: <strong>{phoneLast4 || "(no mobile phone on file)"}</strong></div>
              {(!dob || !phoneLast4) && (
                <div style={{ marginTop: 6, fontStyle: "italic" }}>
                  Without DOB and mobile phone on the patient record, activation will fail.
                  Update the patient's demographics before sending.
                </div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" onClick={done} style={btnPrimary}>Done</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary, marginBottom: 4 }}>
              Invite to patient portal
            </div>
            <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 14 }}>
              {patientName} will receive a link to activate their portal account.
            </div>

            {error && <div style={errBox}>{error}</div>}

            <Field label="Invitation email *">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                     placeholder="patient@example.com" disabled={submitting}
                     style={input} />
            </Field>
            <div style={{ fontSize: 11, color: C.textTertiary, marginBottom: 14 }}>
              If this email is already a staff account, the invitation will be refused.
              Use a personal (non-practice) email for patient portals.
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" onClick={onClose} style={btnSecondary} disabled={submitting}>
                Cancel
              </button>
              <button type="button" onClick={submit} style={btnPrimary} disabled={submitting}>
                {submitting ? "Creating..." : "Create invitation"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// 32 random bytes → 64 hex chars. Matches format of existing tokens in DB.
function generateToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: C.textSecondary,
        textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4,
      }}>{label}</div>
      {children}
    </div>
  );
}

const overlay = {
  position: "fixed", inset: 0, background: "rgba(10, 34, 24, 0.45)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 1000, padding: 20,
};

const panel = {
  background: "#fff", borderRadius: 10,
  boxShadow: "0 20px 50px rgba(0,0,0,0.3)",
  padding: 22, minWidth: 460, maxWidth: 520, width: "100%",
  maxHeight: "90vh", overflowY: "auto",
  fontFamily: "Inter, system-ui, sans-serif",
};

const input = {
  width: "100%", padding: "8px 10px", fontSize: 13, fontFamily: "inherit",
  border: "0.5px solid " + C.borderMid, borderRadius: 5,
  boxSizing: "border-box", background: "#fff",
};

const btnPrimary = {
  padding: "8px 16px", borderRadius: 6, border: "none",
  background: C.teal, color: "#fff", fontSize: 12, fontWeight: 700,
  cursor: "pointer", fontFamily: "inherit",
};

const btnSecondary = {
  padding: "8px 16px", borderRadius: 6,
  border: "0.5px solid " + C.borderMid, background: "#fff",
  color: C.textSecondary, fontSize: 12, fontWeight: 600,
  cursor: "pointer", fontFamily: "inherit",
};

const errBox = {
  fontSize: 11, color: C.red, background: C.redBg,
  border: "0.5px solid " + C.redBorder, borderRadius: 5,
  padding: "8px 12px", marginBottom: 12,
};
