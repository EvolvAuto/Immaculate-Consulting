// ═══════════════════════════════════════════════════════════════════════════════
// src/views/portal/MedicationsSection.jsx
//
// Drop-in replacement for the Current Medications section of the intake form.
// Replaces the free-text textarea with 5 structured rows (Name, Dose, Frequency,
// Type) so staff receive clean, reviewable data they can one-click-promote into
// patient_medications.
//
// On Save + Mark Complete: writes a portal_form_submissions row with
//   form_type = 'medications'
//   data     = { meds: [ { name, dose, frequency, type }, ... ] }
//   status   = 'Submitted'
//
// Props:
//   patientId       uuid    - the authenticated patient's id
//   practiceId      uuid    - the patient's practice id
//   appointmentId   uuid    - (optional) link to upcoming appointment if intake
//                             is attached to one
//   onComplete      fn      - called after successful submission
//   onClose         fn      - called when user hits Close
// ═══════════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { C } from "../../lib/tokens";

const FREQUENCIES = [
  "Once daily",
  "Twice daily",
  "Three times daily",
  "Four times daily",
  "Every other day",
  "Once weekly",
  "As needed",
  "Other",
];

const MED_TYPES = [
  "Prescription",
  "Over-the-counter",
  "Supplement",
  "Herbal",
];

const EMPTY_ROW = { name: "", dose: "", frequency: "", type: "" };

export default function MedicationsSection({ patientId, practiceId, appointmentId, onComplete, onClose }) {
  const [rows, setRows]       = useState([{ ...EMPTY_ROW }, { ...EMPTY_ROW }, { ...EMPTY_ROW }, { ...EMPTY_ROW }, { ...EMPTY_ROW }]);
  const [nkdm, setNkdm]       = useState(false); // "No Known Drugs / Medications"
  const [saving, setSaving]   = useState(false);
  const [banner, setBanner]   = useState(null);

  const updateRow = (i, field, val) => {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r));
  };
  const addRow = () => setRows(prev => [...prev, { ...EMPTY_ROW }]);
  const removeRow = (i) => setRows(prev => prev.filter((_, idx) => idx !== i));

  // A row is "filled" if it has at least a name
  const filledRows = rows.filter(r => r.name.trim().length > 0);

  const handleSave = async () => {
    setBanner(null);
    if (!nkdm && filledRows.length === 0) {
      setBanner({ kind: "error", msg: "Add at least one medication, or check 'I take no medications'." });
      return;
    }
    for (const r of filledRows) {
      if (!r.dose.trim())      { setBanner({ kind: "error", msg: "Please enter a dose for " + r.name + "." }); return; }
      if (!r.frequency.trim()) { setBanner({ kind: "error", msg: "Please select a frequency for " + r.name + "." }); return; }
      if (!r.type.trim())      { setBanner({ kind: "error", msg: "Please select a type for " + r.name + "." }); return; }
    }

    setSaving(true);
    try {
      const payload = {
        practice_id:    practiceId,
        patient_id:     patientId,
        appointment_id: appointmentId || null,
        form_type:      "medications",
        data:           { meds: nkdm ? [] : filledRows, no_known_medications: nkdm },
        status:         "Submitted",
        submitted_at:   new Date().toISOString(),
      };
      const { error } = await supabase.from("portal_form_submissions").insert(payload);
      if (error) throw error;
      setBanner({ kind: "ok", msg: "Medication list submitted. Staff will review at your next visit." });
      if (onComplete) onComplete({ meds: payload.data.meds, nkdm });
    } catch (e) {
      setBanner({ kind: "error", msg: "Could not save: " + e.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div style={st.intro}>
        List every medication you take, including over-the-counter drugs, vitamins, and supplements.
        Enter <strong>one per row</strong> so our care team can review accurately.
      </div>

      {banner && (
        <div style={banner.kind === "error" ? st.bannerErr : st.bannerOk}>{banner.msg}</div>
      )}

      <label style={st.nkdmRow}>
        <input type="checkbox" checked={nkdm} onChange={e => setNkdm(e.target.checked)} style={{ accentColor: C.teal, width: 15, height: 15 }} />
        I am not currently taking any medications, vitamins, or supplements.
      </label>

      {!nkdm && (
        <>
          <div style={st.headerRow}>
            <div style={{ flex: 2.2 }}>Drug Name</div>
            <div style={{ flex: 1 }}>Dose</div>
            <div style={{ flex: 1.4 }}>Frequency</div>
            <div style={{ flex: 1.3 }}>Type</div>
            <div style={{ width: 28 }}></div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
            {rows.map((row, i) => (
              <div key={i} style={st.dataRow}>
                <input
                  type="text"
                  value={row.name}
                  onChange={e => updateRow(i, "name", e.target.value)}
                  placeholder="e.g. Lisinopril"
                  style={{ ...st.input, flex: 2.2 }}
                />
                <input
                  type="text"
                  value={row.dose}
                  onChange={e => updateRow(i, "dose", e.target.value)}
                  placeholder="e.g. 10 mg"
                  style={{ ...st.input, flex: 1 }}
                />
                <select
                  value={row.frequency}
                  onChange={e => updateRow(i, "frequency", e.target.value)}
                  style={{ ...st.input, flex: 1.4 }}
                >
                  <option value="">Select...</option>
                  {FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
                <select
                  value={row.type}
                  onChange={e => updateRow(i, "type", e.target.value)}
                  style={{ ...st.input, flex: 1.3 }}
                >
                  <option value="">Select...</option>
                  {MED_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  disabled={rows.length <= 1}
                  style={rows.length <= 1 ? st.removeBtnDisabled : st.removeBtn}
                  title="Remove this row"
                >
                  x
                </button>
              </div>
            ))}
          </div>

          <button type="button" onClick={addRow} style={st.addBtn}>
            + Add another medication
          </button>
        </>
      )}

      <div style={st.actions}>
        <button type="button" onClick={handleSave} disabled={saving} style={saving ? st.primaryBtnDisabled : st.primaryBtn}>
          {saving ? "Saving..." : "Save and Mark Complete"}
        </button>
        <button type="button" onClick={onClose} style={st.ghostBtn}>Close</button>
      </div>
    </div>
  );
}

const st = {
  intro:     { fontSize: 12, color: C.textSecondary, background: C.tealBg, border: "0.5px solid " + C.tealBorder, borderRadius: 6, padding: "10px 14px", marginBottom: 14, lineHeight: 1.6 },
  bannerErr: { fontSize: 12, color: C.red,   background: C.redBg,   border: "0.5px solid " + C.redBorder,   borderRadius: 6, padding: "8px 12px", marginBottom: 12 },
  bannerOk:  { fontSize: 12, color: C.green, background: C.greenBg, border: "0.5px solid " + C.greenBorder, borderRadius: 6, padding: "8px 12px", marginBottom: 12 },

  nkdmRow: { display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: C.bgSecondary, border: "0.5px solid " + C.borderLight, borderRadius: 6, fontSize: 12, color: C.textPrimary, marginBottom: 14, cursor: "pointer" },

  headerRow: { display: "flex", gap: 8, padding: "0 4px 6px 4px", fontSize: 10, fontWeight: 700, color: C.textTertiary, textTransform: "uppercase", letterSpacing: 0.5 },
  dataRow:   { display: "flex", gap: 8, alignItems: "center" },

  input: { padding: "8px 10px", fontSize: 13, fontFamily: "inherit", border: "0.5px solid " + C.borderLight, borderRadius: 5, boxSizing: "border-box", background: "#fff" },

  removeBtn:         { width: 28, height: 32, background: "transparent", border: "0.5px solid " + C.borderLight, borderRadius: 5, color: C.textTertiary, cursor: "pointer", fontSize: 13 },
  removeBtnDisabled: { width: 28, height: 32, background: "transparent", border: "0.5px solid " + C.borderLight, borderRadius: 5, color: C.borderLight,   cursor: "not-allowed", fontSize: 13 },

  addBtn: { fontSize: 12, fontWeight: 600, padding: "7px 14px", borderRadius: 5, background: "transparent", color: C.teal, border: "0.5px dashed " + C.tealBorder, cursor: "pointer", fontFamily: "inherit", marginBottom: 4 },

  actions: { display: "flex", gap: 8, marginTop: 18, alignItems: "center" },
  primaryBtn:         { fontSize: 12, fontWeight: 700, padding: "9px 18px", borderRadius: 6, background: C.teal, color: "#fff", border: "none", cursor: "pointer", fontFamily: "inherit" },
  primaryBtnDisabled: { fontSize: 12, fontWeight: 700, padding: "9px 18px", borderRadius: 6, background: C.textTertiary, color: "#fff", border: "none", cursor: "not-allowed", fontFamily: "inherit", opacity: 0.7 },
  ghostBtn:           { fontSize: 12, fontWeight: 600, padding: "9px 16px", borderRadius: 6, background: "transparent", color: C.textSecondary, border: "0.5px solid " + C.borderLight, cursor: "pointer", fontFamily: "inherit" },
};
