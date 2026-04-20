// ═══════════════════════════════════════════════════════════════════════════════
// src/views/GrantFamilyAccessModal.jsx
//
// Staff-initiated proxy access grant. Used when the patient cannot log in to
// grant access themselves - most commonly minors, but also incapacitated
// adults and any guardianship scenario.
//
// Calls the grant-proxy-access v2 edge function with patient_id in the body.
// The edge function enforces that the patient belongs to the caller's practice.
// ═══════════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { C } from "../lib/tokens";

const RELATIONSHIPS = ["Parent", "Legal Guardian", "Spouse", "Adult Child", "Power of Attorney", "Other"];
const PERMISSIONS   = ["Full Access", "View Only"];

export default function GrantFamilyAccessModal({ patient, onClose, onGranted }) {
  const [form, setForm] = useState({
    grantee_email: "",
    relationship:  "Parent",
    permission:    "Full Access",
    display_label: "",
    expires_at:    "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState(null);
  const [result, setResult]         = useState(null);

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const patientName = patient ? (patient.first_name + " " + patient.last_name).trim() : "this patient";

  const submit = async () => {
    setError(null);
    if (!form.grantee_email.trim()) { setError("Email is required."); return; }
    const normalized = form.grantee_email.toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      setError("Please enter a valid email address.");
      return;
    }

    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Your session expired. Please sign out and back in.");

      const url = supabase.supabaseUrl.replace(/\/+$/, "") + "/functions/v1/grant-proxy-access";
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": "Bearer " + session.access_token,
          "apikey":        supabase.supabaseKey,
        },
        body: JSON.stringify({
          patient_id:    patient.id,
          grantee_email: normalized,
          relationship:  form.relationship,
          permission:    form.permission,
          display_label: form.display_label.trim() || null,
          expires_at:    form.expires_at || null,
        }),
      });
      const payload = await resp.json().catch(() => ({}));

      if (!resp.ok) throw new Error(payload.error || ("HTTP " + resp.status));

      // Not ok but 200 status = needs_registration case
      if (payload.ok === false && payload.needs_registration) {
        setError(payload.message);
        setSubmitting(false);
        return;
      }
      if (payload.error) throw new Error(payload.error);

      setResult(payload);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const done = () => {
    if (onGranted && result) onGranted(result);
    onClose();
  };

  return (
    <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={panel}>

        {result ? (
          <>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary, marginBottom: 4 }}>
              Access granted
            </div>
            <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 14 }}>
              <strong>{result.grantee_email}</strong> now has <strong>{result.grant.permission}</strong> access to {patientName}'s chart as <strong>{result.grant.relationship}</strong>.
            </div>

            <div style={{
              background: C.tealBg, border: "0.5px solid " + C.tealBorder,
              borderRadius: 6, padding: "12px 14px", marginBottom: 14,
              fontSize: 12, color: C.textSecondary, lineHeight: 1.5,
            }}>
              The next time they log into their own portal, an account switcher will appear in their sidebar. They can click it to view {patientName}'s chart.
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="button" onClick={done} style={btnPrimary}>Done</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary, marginBottom: 4 }}>
              Grant family access to {patientName}'s chart
            </div>
            <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 14 }}>
              Gives a trusted family member or caregiver access to this patient's chart. Used for parents of minors, legal guardians, spouses, or anyone acting on the patient's behalf.
            </div>

            {error && <div style={errBox}>{error}</div>}

            <Field label="Their email *">
              <Input type="email" value={form.grantee_email}
                     onChange={v => set("grantee_email", v)}
                     placeholder="parent@example.com" disabled={submitting} />
            </Field>
            <div style={{ fontSize: 11, color: C.textTertiary, marginTop: -6, marginBottom: 10 }}>
              They must have an existing portal account at this practice. If they don't, create them as a patient first (+ New Patient), then send them a portal invitation.
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="Relationship *">
                <Select value={form.relationship} onChange={v => set("relationship", v)}
                        options={RELATIONSHIPS} disabled={submitting} />
              </Field>
              <Field label="Permission *">
                <Select value={form.permission} onChange={v => set("permission", v)}
                        options={PERMISSIONS} disabled={submitting} />
              </Field>
            </div>

            <Field label="Display label (optional)">
              <Input value={form.display_label} onChange={v => set("display_label", v)}
                     placeholder={"e.g. " + patientName + "'s chart"}
                     disabled={submitting} />
            </Field>
            <div style={{ fontSize: 11, color: C.textTertiary, marginTop: -6, marginBottom: 10 }}>
              What the grantee will see in their account switcher.
            </div>

            <Field label="Expires (optional)">
              <Input type="date" value={form.expires_at}
                     onChange={v => set("expires_at", v)} disabled={submitting} />
            </Field>
            <div style={{ fontSize: 11, color: C.textTertiary, marginTop: -6, marginBottom: 14 }}>
              Leave blank for no expiration. Consider setting a date if custody is temporary or if this is for a minor approaching 18.
            </div>

            <div style={{
              background: C.amberBg, border: "0.5px solid " + C.amberBorder,
              borderRadius: 6, padding: "10px 14px", marginBottom: 14,
              fontSize: 11, lineHeight: 1.55, color: C.amber,
            }}>
              <div style={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, fontSize: 10, marginBottom: 4 }}>
                HIPAA reminder
              </div>
              Only grant access to individuals with a legal right to the patient's information (parent of a minor, legal guardian, or healthcare proxy on file). Verify the relationship before granting.
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" onClick={onClose} style={btnSecondary} disabled={submitting}>
                Cancel
              </button>
              <button type="button" onClick={submit} style={btnPrimary} disabled={submitting}>
                {submitting ? "Granting..." : "Grant access"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: C.textSecondary,
        textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4,
      }}>{label}</div>
      {children}
    </div>
  );
}

function Input({ value, onChange, type = "text", placeholder, disabled }) {
  return (
    <input type={type} value={value || ""} placeholder={placeholder} disabled={disabled}
           onChange={(e) => onChange(e.target.value)}
           style={input} />
  );
}

function Select({ value, onChange, options, disabled }) {
  const normalized = options.map(o => typeof o === "string" ? { value: o, label: o } : o);
  return (
    <select value={value || ""} onChange={(e) => onChange(e.target.value)} disabled={disabled}
            style={input}>
      {normalized.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
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
  padding: 22, minWidth: 460, maxWidth: 540, width: "100%",
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
