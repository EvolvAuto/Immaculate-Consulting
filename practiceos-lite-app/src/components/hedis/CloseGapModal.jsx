// ═══════════════════════════════════════════════════════════════════════════
// src/components/hedis/CloseGapModal.jsx
// Shared modal for manually attesting closure of a HEDIS gap.
// Used by both the chart's HEDIS tab and the Care Management Open Gaps
// sub-tab. Single source of truth for the INSERT-evidence + UPDATE-gap flow.
//
// Pre-fills form fields based on gap.measure_code:
//   GSD -> A1c value + unit + LOINC
//   CBP -> systolic + diastolic (stored in evidence_data jsonb)
//   else -> generic free-form value
//
// Save = two writes (INSERT cm_clinical_evidence then UPDATE cm_hedis_member_gaps).
// Not atomic; an orphan evidence row is preferable to a half-applied state.
// ═══════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { C } from "../../lib/tokens";
import { insertRow, updateRow } from "../../lib/db";
import { Modal, Btn, Input, Select, Textarea, FL } from "../ui";

// Per-measure form profile. Drives field rendering, validation, and the
// pre-filled evidence_type/category/LOINC. Unknown codes fall back to GENERIC.
const MEASURE_PROFILES = {
  GSD: {
    evidence_type:    "A1c Result",
    evidence_category:"Lab",
    default_loinc:    "4548-4",       // HbA1c (%) by HPLC, the most common
    default_unit:     "%",
    value_label:      "A1c value",
    value_kind:       "numeric",
  },
  CBP: {
    evidence_type:    "BP Reading",
    evidence_category:"Vital",
    value_kind:       "bp",            // special: systolic + diastolic
  },
  GENERIC: {
    evidence_type:    "Other",
    evidence_category:"Other",
    value_label:      "Value",
    value_kind:       "free",
  },
};

const A1C_UNITS = ["%", "mmol/mol"];

// Plausible clinical ranges. We reject out-of-range entries at save time
// rather than warn-and-allow; preventing data quality issues at entry beats
// downstream cleanup.
const RANGE = {
  GSD:     { min: 4,  max: 20 },
  CBP_SYS: { min: 60, max: 250 },
  CBP_DIA: { min: 30, max: 150 },
};

export default function CloseGapModal({ gap, onClose, onSaved }) {
  const { profile, practiceId } = useAuth();

  const profileKey = MEASURE_PROFILES[gap.measure_code] ? gap.measure_code : "GENERIC";
  const measureProfile = MEASURE_PROFILES[profileKey];

  const [evidenceDate, setEvidenceDate] = useState(new Date().toISOString().slice(0, 10));
  const [valueNumeric, setValueNumeric] = useState("");
  const [valueText,    setValueText]    = useState("");
  const [unit,         setUnit]         = useState(measureProfile.default_unit || "");
  const [loincCode,    setLoincCode]    = useState(measureProfile.default_loinc || "");
  const [systolic,     setSystolic]     = useState("");
  const [diastolic,    setDiastolic]    = useState("");
  const [attestationNote, setAttestationNote] = useState("");
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState(null);

  const measureName = gap.cm_hedis_measures?.measure_name || gap.measure_code;
  const sourceFile  = gap.cm_hedis_uploads?.file_name || "";

  // Validate before save. Returns null on success, error string on failure.
  const validate = () => {
    if (!evidenceDate) return "Evidence date is required.";

    if (measureProfile.value_kind === "numeric") {
      const v = parseFloat(valueNumeric);
      if (isNaN(v)) return (measureProfile.value_label || "Value") + " is required.";
      const r = RANGE[profileKey];
      if (r && (v < r.min || v > r.max)) {
        return (measureProfile.value_label || "Value") + " must be between " + r.min + " and " + r.max + ".";
      }
    } else if (measureProfile.value_kind === "bp") {
      const sys = parseFloat(systolic);
      const dia = parseFloat(diastolic);
      if (isNaN(sys) || isNaN(dia)) return "Both systolic and diastolic are required.";
      if (sys < RANGE.CBP_SYS.min || sys > RANGE.CBP_SYS.max) {
        return "Systolic must be between " + RANGE.CBP_SYS.min + " and " + RANGE.CBP_SYS.max + ".";
      }
      if (dia < RANGE.CBP_DIA.min || dia > RANGE.CBP_DIA.max) {
        return "Diastolic must be between " + RANGE.CBP_DIA.min + " and " + RANGE.CBP_DIA.max + ".";
      }
      if (sys <= dia) return "Systolic must be greater than diastolic.";
    } else {
      if (!valueText.trim()) return "A value is required.";
    }

    return null;
  };

  const save = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      // Build evidence payload based on measure profile.
      const payload = {
        patient_id:        gap.patient_id,
        evidence_type:     measureProfile.evidence_type,
        evidence_category: measureProfile.evidence_category,
        evidence_date:     evidenceDate,
        source:            "Manual Attestation",
        attested_by:       profile.id,
        attested_at:       new Date().toISOString(),
        attestation_note:  attestationNote.trim() || null,
        created_by:        profile.id,
      };

      if (measureProfile.value_kind === "numeric") {
        payload.value_numeric = parseFloat(valueNumeric);
        payload.unit          = unit || null;
        payload.loinc_code    = loincCode.trim() || null;
      } else if (measureProfile.value_kind === "bp") {
        // Systolic + diastolic land in evidence_data jsonb. This matches
        // the dm_canonical_v1 outbound config field-map for CBP, which
        // pulls evidence.data.systolic / evidence.data.diastolic.
        payload.evidence_data = {
          systolic:  parseFloat(systolic),
          diastolic: parseFloat(diastolic),
        };
      } else {
        payload.value_text = valueText.trim();
      }

      // 1. INSERT evidence row
      const evidence = await insertRow("cm_clinical_evidence", payload, practiceId, {
        audit: { entityType: "cm_clinical_evidence", patientId: gap.patient_id },
      });

      // 2. UPDATE the gap with closure metadata
      const updatedGap = await updateRow("cm_hedis_member_gaps", gap.id, {
        closed_at:           new Date().toISOString(),
        closure_method:      "Manual Attestation",
        closure_evidence_id: evidence.id,
      }, {
        audit: { entityType: "cm_hedis_member_gaps", patientId: gap.patient_id },
      });

      onSaved({ gap: updatedGap, evidence });
    } catch (e) {
      setError(e.message || "Failed to close gap.");
      setSaving(false);
    }
  };

  return (
    <Modal title={"Close gap: " + gap.measure_code} onClose={onClose} maxWidth={520}>
      {/* Context strip */}
      <div style={{
        marginBottom: 14, padding: "10px 12px",
        background: C.tealBg, border: "0.5px solid " + C.tealBorder,
        borderRadius: 6, fontSize: 12, color: C.textPrimary,
      }}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>{measureName}</div>
        <div style={{ fontSize: 11, color: C.textSecondary }}>
          {gap.source_plan_short_name ? "via " + gap.source_plan_short_name : ""}
          {sourceFile ? " (" + sourceFile + ")" : ""}
        </div>
      </div>

      {/* Measure-specific value entry */}
      {measureProfile.value_kind === "numeric" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
            <Input
              label={measureProfile.value_label || "Value"}
              type="number"
              value={valueNumeric}
              onChange={setValueNumeric}
              placeholder="7.2"
            />
            <Select
              label="Unit"
              value={unit}
              onChange={setUnit}
              options={A1C_UNITS}
            />
          </div>
          <Input
            label="LOINC code"
            value={loincCode}
            onChange={setLoincCode}
            placeholder="4548-4"
          />
        </>
      )}

      {measureProfile.value_kind === "bp" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Input
            label="Systolic (mmHg)"
            type="number"
            value={systolic}
            onChange={setSystolic}
            placeholder="128"
          />
          <Input
            label="Diastolic (mmHg)"
            type="number"
            value={diastolic}
            onChange={setDiastolic}
            placeholder="78"
          />
        </div>
      )}

      {measureProfile.value_kind === "free" && (
        <Input
          label={measureProfile.value_label || "Value"}
          value={valueText}
          onChange={setValueText}
          placeholder="e.g. Mammogram complete; report on file"
        />
      )}

      <Input
        label="Evidence date"
        type="date"
        value={evidenceDate}
        onChange={setEvidenceDate}
      />

      <Textarea
        label="Attestation note (optional)"
        value={attestationNote}
        onChange={setAttestationNote}
        rows={2}
        placeholder="Optional context about how this gap was closed."
      />

      {error && (
        <div style={{
          marginTop: 8, padding: "8px 12px",
          background: C.redBg, border: "0.5px solid " + C.redBorder,
          borderRadius: 6, fontSize: 12, color: C.red,
        }}>
          {error}
        </div>
      )}

      <div style={{
        marginTop: 16, paddingTop: 12,
        borderTop: "0.5px solid " + C.borderLight,
        display: "flex", gap: 8, justifyContent: "flex-end",
      }}>
        <Btn variant="outline" onClick={onClose} disabled={saving}>Cancel</Btn>
        <Btn onClick={save} disabled={saving}>
          {saving ? "Saving..." : "Close gap"}
        </Btn>
      </div>
    </Modal>
  );
}
