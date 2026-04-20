// ═══════════════════════════════════════════════════════════════════════════════
// src/views/AddStaffModal.jsx
//
// Rendered when the "Add staff member" button is clicked in StaffView.
// Collects { email, full_name, role, provider_id? }, calls create-staff-user,
// and displays the activation link for the admin to share with the new hire.
//
// The activation link is shown both as a copyable field AND we note that
// Supabase's default SMTP will email it to the new hire automatically if
// configured. In production once Resend is wired up, the email path becomes
// reliable and this manual-copy becomes a fallback.
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { C } from "../lib/tokens";

const ROLES = ["Owner", "Manager", "Provider", "Medical Assistant", "Front Desk", "Billing"];

export default function AddStaffModal({ practiceId, onClose, onCreated }) {
  const [form, setForm] = useState({
    email: "", full_name: "", role: "Front Desk",
    provider_id: "", phone: "", title: "",
  });
  const [providers, setProviders]           = useState([]);
  const [loadingProviders, setLoadingProvs] = useState(true);
  const [submitting, setSubmitting]         = useState(false);
  const [error, setError]                   = useState(null);
  const [result, setResult]                 = useState(null);
  const [linkCopied, setLinkCopied]         = useState(false);

  // Load providers list for the Provider-role dropdown
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.from("providers")
          .select("id, full_name, specialty")
          .eq("practice_id", practiceId)
          .eq("is_active", true)
          .order("full_name");
        if (!cancelled) setProviders(data || []);
      } catch (_e) { /* silent */ }
      finally { if (!cancelled) setLoadingProvs(false); }
    })();
    return () => { cancelled = true; };
  }, [practiceId]);

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const submit = async () => {
    setError(null);
    if (!form.email.trim()) { setError("Email is required."); return; }
    if (!form.full_name.trim()) { setError("Full name is required."); return; }
    if (form.role === "Provider" && !form.provider_id) {
      setError("Please select a Provider record to link this account to.");
      return;
    }

    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Your session expired. Please sign out and back in.");

      const url = supabase.supabaseUrl.replace(/\/+$/, "") + "/functions/v1/create-staff-user";
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": "Bearer " + session.access_token,
          "apikey":        supabase.supabaseKey,
        },
        body: JSON.stringify({
          email:       form.email.trim(),
          full_name:   form.full_name.trim(),
          role:        form.role,
          provider_id: form.provider_id || null,
          phone:       form.phone.trim() || null,
          title:       form.title.trim() || null,
        }),
      });
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok || payload.error) throw new Error(payload.error || ("HTTP " + resp.status));

      setResult(payload);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const copyLink = async () => {
    if (!result?.activation_link) return;
    try {
      await navigator.clipboard.writeText(result.activation_link);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2500);
    } catch (_e) { /* clipboard permission denied */ }
  };

  const done = () => {
    if (onCreated && result) onCreated(result);
    onClose();
  };

  return (
    <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={panel}>

        {/* SUCCESS STATE - activation link display */}
        {result ? (
          <>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary, marginBottom: 4 }}>
              Staff account created
            </div>
            <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 14 }}>
              {result.full_name} ({result.role}) has been added to the practice.
            </div>

            <div style={{
              background: C.tealBg, border: "0.5px solid " + C.tealBorder,
              borderRadius: 6, padding: "12px 14px", marginBottom: 14,
            }}>
              <div style={{
                fontSize: 10, fontWeight: 700, color: C.teal, textTransform: "uppercase",
                letterSpacing: 0.5, marginBottom: 6,
              }}>Share this link with the new hire</div>
              <div style={{ fontSize: 11, color: C.textSecondary, marginBottom: 8, lineHeight: 1.5 }}>
                They use this link to set their password. It was also emailed to <strong>{result.email}</strong>,
                but if the email doesn't land, copy-paste this to them directly.
              </div>
              <div style={{
                background: "#fff", border: "0.5px solid " + C.borderLight, borderRadius: 4,
                padding: "6px 10px", fontSize: 10, fontFamily: "monospace",
                color: C.textPrimary, wordBreak: "break-all", marginBottom: 8,
                maxHeight: 80, overflow: "auto",
              }}>
                {result.activation_link || "(no link - check Supabase auth logs)"}
              </div>
              {result.activation_link && (
                <button type="button" onClick={copyLink}
                  style={{
                    ...btnSecondary,
                    background: linkCopied ? C.tealMid : "#fff",
                    color: linkCopied ? "#fff" : C.teal,
                    borderColor: C.tealBorder,
                  }}>
                  {linkCopied ? "✓ Copied" : "Copy link"}
                </button>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" onClick={done} style={btnPrimary}>Done</button>
            </div>
          </>
        ) : (
          <>
            {/* FORM STATE */}
            <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary, marginBottom: 4 }}>
              Add staff member
            </div>
            <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 14 }}>
              Creates the account and generates a password-set link to share with the new hire.
            </div>

            {error && (
              <div style={errBox}>{error}</div>
            )}

            <Field label="Email *">
              <Input type="email" value={form.email} onChange={v => set("email", v)}
                     placeholder="name@practice.com" disabled={submitting} />
            </Field>

            <Field label="Full name *">
              <Input value={form.full_name} onChange={v => set("full_name", v)}
                     placeholder="e.g. Dr. Jane Smith" disabled={submitting} />
            </Field>

            <Field label="Role *">
              <Select value={form.role} onChange={v => set("role", v)}
                      options={ROLES} disabled={submitting} />
            </Field>

            {form.role === "Provider" && (
              <Field label="Link to provider record *">
                <Select
                  value={form.provider_id}
                  onChange={v => set("provider_id", v)}
                  options={[
                    { value: "", label: loadingProviders ? "Loading..." : "-- select provider --" },
                    ...providers.map(p => ({ value: p.id, label: p.full_name + (p.specialty ? " (" + p.specialty + ")" : "") })),
                  ]}
                  disabled={submitting || loadingProviders}
                />
              </Field>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="Title (optional)">
                <Input value={form.title} onChange={v => set("title", v)}
                       placeholder="e.g. MD, RN, Practice Manager" disabled={submitting} />
              </Field>
              <Field label="Phone (optional)">
                <Input type="tel" value={form.phone} onChange={v => set("phone", v)}
                       placeholder="(919) 555-0100" disabled={submitting} />
              </Field>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button type="button" onClick={onClose} style={btnSecondary} disabled={submitting}>
                Cancel
              </button>
              <button type="button" onClick={submit} style={btnPrimary} disabled={submitting}>
                {submitting ? "Creating..." : "Create staff account"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── tiny locally-scoped primitives (avoids import churn) ──────────────────
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
