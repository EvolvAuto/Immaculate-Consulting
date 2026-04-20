// ═══════════════════════════════════════════════════════════════════════════════
// src/views/AssignFormsModal.jsx
//
// Staff selects one or more forms to assign to a patient. Each assignment
// becomes a row in form_assignments. Patient sees them in their portal's
// Intake Forms tab alongside any appointment-gated forms.
//
// Forms offered here are the "standalone" kind - things that make sense
// independent of an appointment (re-consent, SDOH, PHQ-9, etc.). The full
// pre-visit intake remains appointment-gated.
// ═══════════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { C } from "../lib/tokens";

// The forms that are valid to assign standalone (not appt-gated).
// Keep aligned with PortalForms.jsx FORM_CONFIG + any new standalone forms.
const ASSIGNABLE_FORMS = [
  { type: "annual_consent_renewal", label: "Annual Consent Renewal",
    desc: "Re-sign HIPAA, Treatment, and Financial Policy consents" },
  { type: "sdoh_screener", label: "Social Determinants of Health Screener",
    desc: "Housing, food security, transportation, employment, safety" },
  { type: "phq9", label: "PHQ-9 Depression Screener",
    desc: "9-item standard depression screening instrument" },
  { type: "gad7", label: "GAD-7 Anxiety Screener",
    desc: "7-item standard generalized anxiety screening instrument" },
  { type: "medications_update", label: "Medications Update",
    desc: "Review and update the current medication list" },
  { type: "insurance_update", label: "Insurance Update",
    desc: "Request the patient to verify or update their coverage" },
  { type: "pre_specialty_referral", label: "Specialty Referral History",
    desc: "History pertinent to a specialty consult" },
  { type: "pediatric_well_check", label: "Pediatric Well-Check Intake",
    desc: "Age-bucketed developmental milestones + interval history" },
];

export default function AssignFormsModal({ patient, practiceId, onClose, onAssigned }) {
  const [selected, setSelected]       = useState({});
  const [dueDate, setDueDate]         = useState("");
  const [instructions, setInstructions] = useState("");
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState(null);
  const [createdCount, setCreatedCount] = useState(null);

  const toggle = (type) => {
    setSelected(prev => {
      const next = { ...prev };
      if (next[type]) delete next[type];
      else            next[type] = true;
      return next;
    });
  };

  const selectedCount = Object.keys(selected).length;

  const submit = async () => {
    setError(null);
    if (selectedCount === 0) {
      setError("Select at least one form to assign.");
      return;
    }

    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      const rows = ASSIGNABLE_FORMS
        .filter(f => selected[f.type])
        .map(f => ({
          practice_id:  practiceId,
          patient_id:   patient.id,
          form_type:    f.type,
          form_label:   f.label,
          instructions: instructions.trim() || null,
          due_date:     dueDate || null,
          assigned_by:  user ? user.id : null,
          status:       "Assigned",
        }));

      const { error: insErr } = await supabase
        .from("form_assignments")
        .insert(rows);
      if (insErr) throw insErr;

      setCreatedCount(rows.length);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const done = () => {
    if (onAssigned) onAssigned(createdCount);
    onClose();
  };

  const patientName = patient ? (patient.first_name + " " + patient.last_name).trim() : "Patient";

  return (
    <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={panel}>

        {createdCount !== null ? (
          <>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary, marginBottom: 4 }}>
              Forms assigned
            </div>
            <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 14 }}>
              {createdCount} form{createdCount === 1 ? "" : "s"} assigned to {patientName}.
              They will see these in their portal's Intake Forms tab on their next login.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="button" onClick={done} style={btnPrimary}>Done</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary, marginBottom: 4 }}>
              Assign forms to {patientName}
            </div>
            <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 14 }}>
              Selected forms will appear in the patient's portal. They can complete them at their own pace.
            </div>

            {error && <div style={errBox}>{error}</div>}

            <div style={{ marginBottom: 14 }}>
              <div style={{
                fontSize: 10, fontWeight: 700, color: C.textSecondary,
                textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6,
              }}>Forms to assign</div>
              <div style={{
                border: "0.5px solid " + C.borderMid, borderRadius: 6,
                maxHeight: 280, overflowY: "auto",
              }}>
                {ASSIGNABLE_FORMS.map((f, idx) => {
                  const isOn = !!selected[f.type];
                  return (
                    <label key={f.type} style={{
                      display: "flex", gap: 10, alignItems: "flex-start",
                      padding: "10px 12px",
                      borderBottom: idx < ASSIGNABLE_FORMS.length - 1 ? "0.5px solid " + C.borderLight : "none",
                      cursor: "pointer",
                      background: isOn ? C.tealBg : "transparent",
                    }}>
                      <input type="checkbox" checked={isOn} onChange={() => toggle(f.type)}
                             style={{ accentColor: C.teal, marginTop: 2, width: 14, height: 14, flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: C.textPrimary }}>
                          {f.label}
                        </div>
                        <div style={{ fontSize: 11, color: C.textSecondary, marginTop: 2 }}>
                          {f.desc}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
              <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 6 }}>
                {selectedCount} selected
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="Due date (optional)">
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
                       disabled={submitting} style={input} />
              </Field>
            </div>

            <Field label="Instructions to the patient (optional)">
              <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)}
                        rows={3} disabled={submitting}
                        placeholder="e.g. Please complete before your annual physical on May 15."
                        style={{ ...input, resize: "vertical", fontFamily: "inherit" }} />
            </Field>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button type="button" onClick={onClose} style={btnSecondary} disabled={submitting}>
                Cancel
              </button>
              <button type="button" onClick={submit} style={btnPrimary} disabled={submitting || selectedCount === 0}>
                {submitting ? "Assigning..." : "Assign " + (selectedCount > 0 ? "(" + selectedCount + ")" : "")}
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

const overlay = {
  position: "fixed", inset: 0, background: "rgba(10, 34, 24, 0.45)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 1000, padding: 20,
};

const panel = {
  background: "#fff", borderRadius: 10,
  boxShadow: "0 20px 50px rgba(0,0,0,0.3)",
  padding: 22, minWidth: 500, maxWidth: 580, width: "100%",
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
