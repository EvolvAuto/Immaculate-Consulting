// ═══════════════════════════════════════════════════════════════════════════
// src/components/hedis/CloseGapModal.jsx
//
// Shared modal for manually attesting closure of a HEDIS gap. Used by:
//   - Care Management > HEDIS > Open Gaps (HEDISTab.jsx)
//   - Patient chart > HEDIS tab (PatientChartPage.jsx)
//
// Two distinct flows based on measure_kind:
//
//   SIMPLE (GSD, CBP, etc): single value entry (numeric / BP / free text).
//     Save = INSERT evidence + UPDATE gap.closed_at. Two writes, sequential,
//     not atomic; orphan evidence preferred over half-applied state.
//
//   COMPOSITE (CIS-10, IMA Combo 2, etc): per-sub-component evidence entry.
//     Each antigen / component has its own date + code + dose count, OR an
//     exclusion. Save iterates: INSERT evidence + INSERT link + UPDATE
//     subcomponent.doses_completed. After all subcomponents are completed
//     or excluded, UPDATE the parent gap's closed_at.
//
// The modal fetches measure metadata on open (measure_kind + sub_components
// jsonb) and routes to the right inner form.
//
// For composite gaps with no sub-component rows yet (e.g. patient matched
// manually after the reconciler ran), the modal lazy-generates them from
// the measure spec.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { supabase } from "../../lib/supabaseClient";
import { C } from "../../lib/tokens";
import { insertRow, updateRow } from "../../lib/db";
import { Modal, Btn, Input, Select, Textarea, FL, Badge, Loader } from "../ui";

// ─── Top-level dispatcher ──────────────────────────────────────────────────
export default function CloseGapModal({ gap, onClose, onSaved }) {
  const [measure, setMeasure] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  // Fetch measure metadata to decide simple vs composite. Measure_kind and
  // sub_components are not on the embedded row from parent select queries
  // (those embed only measure_name + measure_category).
  useEffect(() => {
    if (!gap?.measure_code) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error: e } = await supabase
          .from("cm_hedis_measures")
          .select("measure_code, measure_name, measure_kind, sub_components")
          .eq("measure_code", gap.measure_code)
          .single();
        if (cancelled) return;
        if (e) throw e;
        setMeasure(data);
      } catch (e) {
        if (!cancelled) setError(e.message || "Failed to load measure metadata");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [gap?.measure_code]);

  if (loading) {
    return (
      <Modal title={"Close gap: " + gap.measure_code} onClose={onClose} maxWidth={520}>
        <Loader label="Loading measure..." />
      </Modal>
    );
  }
  if (error) {
    return (
      <Modal title={"Close gap: " + gap.measure_code} onClose={onClose} maxWidth={520}>
        <div style={{ padding: 12, background: "#fef2f2", border: "0.5px solid " + C.red, borderRadius: 6, color: C.red, fontSize: 12 }}>
          {error}
        </div>
      </Modal>
    );
  }

  const isComposite = measure?.measure_kind === "composite";
  if (isComposite) {
    return <CompositeCloseGap gap={gap} measure={measure} onClose={onClose} onSaved={onSaved} />;
  }
  return <SimpleCloseGap gap={gap} onClose={onClose} onSaved={onSaved} />;
}

// ═══════════════════════════════════════════════════════════════════════════
// SIMPLE PATH - original modal logic, untouched semantics. Per-measure form
// profile drives field rendering, validation, and pre-filled LOINC.
// ═══════════════════════════════════════════════════════════════════════════
const MEASURE_PROFILES = {
  GSD: {
    evidence_type:    "A1c Result",
    evidence_category:"Lab",
    default_loinc:    "4548-4",
    default_unit:     "%",
    value_label:      "A1c value",
    value_kind:       "numeric",
  },
  CBP: {
    evidence_type:    "BP Reading",
    evidence_category:"Vital",
    value_kind:       "bp",
  },
  GENERIC: {
    evidence_type:    "Other",
    evidence_category:"Other",
    value_label:      "Value",
    value_kind:       "free",
  },
};

const A1C_UNITS = ["%", "mmol/mol"];

const SIMPLE_RANGES = {
  GSD:     { min: 4,  max: 20 },
  CBP_SYS: { min: 60, max: 250 },
  CBP_DIA: { min: 30, max: 150 },
};

function SimpleCloseGap({ gap, onClose, onSaved }) {
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
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState(null);

  const measureName = gap.cm_hedis_measures?.measure_name || gap.measure_code;
  const sourceFile  = gap.cm_hedis_uploads?.file_name || "";

  const validate = () => {
    if (!evidenceDate) return "Evidence date is required.";
    if (measureProfile.value_kind === "numeric") {
      const v = parseFloat(valueNumeric);
      if (isNaN(v)) return (measureProfile.value_label || "Value") + " is required.";
      const r = SIMPLE_RANGES[profileKey];
      if (r && (v < r.min || v > r.max)) {
        return (measureProfile.value_label || "Value") + " must be between " + r.min + " and " + r.max + ".";
      }
    } else if (measureProfile.value_kind === "bp") {
      const sys = parseFloat(systolic);
      const dia = parseFloat(diastolic);
      if (isNaN(sys) || isNaN(dia)) return "Both systolic and diastolic are required.";
      if (sys < SIMPLE_RANGES.CBP_SYS.min || sys > SIMPLE_RANGES.CBP_SYS.max) {
        return "Systolic must be between " + SIMPLE_RANGES.CBP_SYS.min + " and " + SIMPLE_RANGES.CBP_SYS.max + ".";
      }
      if (dia < SIMPLE_RANGES.CBP_DIA.min || dia > SIMPLE_RANGES.CBP_DIA.max) {
        return "Diastolic must be between " + SIMPLE_RANGES.CBP_DIA.min + " and " + SIMPLE_RANGES.CBP_DIA.max + ".";
      }
      if (sys <= dia) return "Systolic must be greater than diastolic.";
    } else {
      if (!valueText.trim()) return "A value is required.";
    }
    return null;
  };

  const save = async () => {
    const validationError = validate();
    if (validationError) { setError(validationError); return; }
    setError(null);
    setSaving(true);
    try {
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
        evidence_data:     { measure_code: gap.measure_code },
      };

      if (measureProfile.value_kind === "numeric") {
        payload.value_numeric = parseFloat(valueNumeric);
        payload.unit          = unit || null;
        payload.loinc_code    = loincCode.trim() || null;
      } else if (measureProfile.value_kind === "bp") {
        payload.evidence_data = { ...payload.evidence_data, systolic: parseFloat(systolic), diastolic: parseFloat(diastolic) };
      } else {
        payload.value_text = valueText.trim();
      }

      const evidence = await insertRow("cm_clinical_evidence", payload, practiceId, {
        audit: { entityType: "cm_clinical_evidence", patientId: gap.patient_id },
      });

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
      <div style={{ marginBottom: 14, padding: "10px 12px", background: C.tealBg, border: "0.5px solid " + C.tealBorder, borderRadius: 6, fontSize: 12, color: C.textPrimary }}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>{measureName}</div>
        <div style={{ fontSize: 11, color: C.textSecondary }}>
          {gap.source_plan_short_name ? "via " + gap.source_plan_short_name : ""}
          {sourceFile ? " (" + sourceFile + ")" : ""}
        </div>
      </div>

      {measureProfile.value_kind === "numeric" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
            <Input label={measureProfile.value_label || "Value"} type="number" value={valueNumeric} onChange={setValueNumeric} placeholder="7.2" />
            <Select label="Unit" value={unit} onChange={setUnit} options={A1C_UNITS} />
          </div>
          <Input label="LOINC code" value={loincCode} onChange={setLoincCode} placeholder="4548-4" />
        </>
      )}

      {measureProfile.value_kind === "bp" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Input label="Systolic (mmHg)" type="number" value={systolic} onChange={setSystolic} placeholder="128" />
          <Input label="Diastolic (mmHg)" type="number" value={diastolic} onChange={setDiastolic} placeholder="78" />
        </div>
      )}

      {measureProfile.value_kind === "free" && (
        <Input label={measureProfile.value_label || "Value"} value={valueText} onChange={setValueText} placeholder="e.g. Mammogram complete; report on file" />
      )}

      <Input label="Evidence date" type="date" value={evidenceDate} onChange={setEvidenceDate} />
      <Textarea label="Attestation note (optional)" value={attestationNote} onChange={setAttestationNote} rows={2} placeholder="Optional context about how this gap was closed." />

      {error && (
        <div style={{ marginTop: 8, padding: "8px 12px", background: "#fef2f2", border: "0.5px solid " + C.red, borderRadius: 6, fontSize: 12, color: C.red }}>
          {error}
        </div>
      )}

      <div style={{ marginTop: 16, paddingTop: 12, borderTop: "0.5px solid " + C.borderLight, display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn variant="outline" onClick={onClose} disabled={saving}>Cancel</Btn>
        <Btn onClick={save} disabled={saving}>{saving ? "Saving..." : "Close gap"}</Btn>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPOSITE PATH - per-sub-component evidence entry
//
// Lifecycle:
//   1. On mount, fetch sub-component rows for this gap.
//   2. If zero rows exist (e.g. gap matched manually after reconciler ran),
//      lazy-generate from measure.sub_components and re-fetch.
//   3. Render one card per sub-component. Already-completed and already-
//      excluded show as locked summaries; incomplete show the entry form.
//   4. On save, iterate: for each entry, INSERT evidence + INSERT link +
//      UPDATE doses_completed. For each exclusion, UPDATE exclusion fields.
//   5. After all writes, recheck: if every sub-component is completed or
//      excluded, UPDATE parent gap's closed_at with method='Composite
//      components met'.
// ═══════════════════════════════════════════════════════════════════════════
// CVX defaults per CIS antigen. CVX is the standard immunization code system
// (CDC IIS). These are the most common SINGLE-antigen codes; staff can
// override for combo formulations. Reference: cdc.gov/vaccines/programs/iis/
//   DTaP combos: 50 (DTaP-Hib), 110 (Pediarix DTaP-HepB-IPV), 120 (Pentacel
//   DTaP-HepB-IPV+Hib), 130 (Kinrix DTaP-IPV)
//   PCV: 100 (PCV7 historical), 133 (PCV13 most common), 152 (PCV15),
//   215 (PCV20 newest)
//   RV: 116 (RV5/RotaTeq, 3-dose), 119 (RV1/Rotarix, 2-dose)
// Defaults below pick the most common standalone code for each antigen.
const CVX_DEFAULTS = {
  DTaP: "20",
  IPV:  "10",
  MMR:  "03",
  HiB:  "49",
  HepB: "08",
  VZV:  "21",
  PCV:  "133",
  HepA: "85",
  RV:   "116",
  Flu:  "88",
};

// ═══════════════════════════════════════════════════════════════════════════
function CompositeCloseGap({ gap, measure, onClose, onSaved }) {
  const { profile, practiceId } = useAuth();

  const [subcomps, setSubcomps] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState(null);
  const [generating, setGenerating] = useState(false);

  // Per-subcomponent draft state. Keyed by subcomp.id. Each entry:
  //   { date, code, doses, note, exclusion, exclusionReason, included }
  // The `included` flag is used in visit mode (checkbox to include the
  // antigen in the current visit's batch). In chart-review mode it's
  // ignored - the date+code presence drives whether an entry is processed.
  const [drafts, setDrafts] = useState({});

  // Two distinct workflows:
  //   "visit"        - Staff documenting today's visit. One date applies
  //                    to all checked antigens. CVX codes pre-filled.
  //                    Click checkbox + verify CVX + save. Most common.
  //   "chart_review" - Catch-up entry where doses span multiple historical
  //                    visits. Each card has its own date input. Slower but
  //                    needed when entering past records.
  const [mode, setMode] = useState("visit");
  const [visitDate, setVisitDate] = useState(() => new Date().toISOString().slice(0, 10));

  const measureName = measure?.measure_name || gap.cm_hedis_measures?.measure_name || gap.measure_code;
  const sourceFile  = gap.cm_hedis_uploads?.file_name || "";

  // Load sub-components, lazy-generating if absent
  const loadSubcomps = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: e } = await supabase
        .from("cm_hedis_gap_subcomponents")
        .select("*")
        .eq("gap_id", gap.id)
        .order("component_index", { ascending: true, nullsFirst: false })
        .order("component_code");
      if (e) throw e;

      if ((data || []).length === 0) {
        // Lazy-generate from measure spec. This only happens when the
        // reconciler skipped subcomp generation for this gap (e.g. because
        // patient_id was null at reconcile time and was added later).
        await generateSubcomps();
        // Re-fetch after generation
        const { data: data2, error: e2 } = await supabase
          .from("cm_hedis_gap_subcomponents")
          .select("*")
          .eq("gap_id", gap.id)
          .order("component_index", { ascending: true, nullsFirst: false })
          .order("component_code");
        if (e2) throw e2;
        setSubcomps(data2 || []);
      } else {
        setSubcomps(data);
      }
    } catch (e) {
      setError(e.message || "Failed to load sub-components");
    } finally {
      setLoading(false);
    }
  };

  // Generate sub-component rows from measure.sub_components jsonb spec.
  // Mirrors the reconciler's logic so behavior is consistent.
  const generateSubcomps = async () => {
    setGenerating(true);
    try {
      const spec = Array.isArray(measure?.sub_components) ? measure.sub_components : [];
      if (spec.length === 0) {
        throw new Error("Measure has no sub_components defined; cannot lazy-generate.");
      }
      const rows = spec.map((comp, idx) => ({
        practice_id:    practiceId,
        gap_id:         gap.id,
        patient_id:     gap.patient_id,
        component_code: comp.code,
        component_label: comp.label || null,
        component_index: idx,
        doses_required: parseInt(
          comp.doses_required ??
          (Array.isArray(comp.doses_required_options) ? comp.doses_required_options[0] : null) ??
          comp.visits_required ??
          1, 10
        ),
        window_status: "open",
      }));
      const { error: e } = await supabase
        .from("cm_hedis_gap_subcomponents")
        .insert(rows);
      if (e) throw e;
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    if (gap?.id) loadSubcomps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gap?.id]);

  // ─── Stats ────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    let done = 0, excluded = 0, open = 0;
    for (const s of subcomps) {
      if (s.exclusion_documented) excluded++;
      else if (s.completed) done++;
      else open++;
    }
    return { done, excluded, open, total: subcomps.length };
  }, [subcomps]);

  // How many open antigens are queued for save in the current draft state.
  // Drives the save button label and the visit-mode progress indicator.
  // Visit mode counts antigens with included=true; chart-review counts
  // antigens with date+code filled in.
  const pendingCount = useMemo(() => {
    let n = 0;
    for (const s of subcomps) {
      if (s.completed || s.exclusion_documented) continue;
      const d = drafts[s.id];
      if (!d) continue;
      if (d.exclusion) { n++; continue; }
      if (mode === "visit") {
        if (d.included && d.code?.trim()) n++;
      } else {
        if (d.date && d.code?.trim()) n++;
      }
    }
    return n;
  }, [subcomps, drafts, mode]);

  // ─── Draft helpers ───────────────────────────────────────────────────
  // getDraft takes the full subcomp so it can pre-fill the CVX default
  // for the antigen (DTaP -> 20, MMR -> 03, etc). Defaults render in the
  // input but aren't persisted to drafts state until the user actually
  // edits a field (the patch in updateDraft is what materializes the
  // draft entry).
  const getDraft = (subcomp) => drafts[subcomp.id] || {
    date: new Date().toISOString().slice(0, 10),
    code: CVX_DEFAULTS[subcomp.component_code] || "",
    doses: 1,
    note: "",
    exclusion: false,
    exclusionReason: "",
    included: false,
  };
  const updateDraft = (subcomp, patch) => {
    setDrafts(prev => ({ ...prev, [subcomp.id]: { ...getDraft(subcomp), ...patch } }));
  };

  // ─── Save ────────────────────────────────────────────────────────────
  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      const patientId = gap.patient_id || subcomps[0]?.patient_id;
      if (!patientId) {
        throw new Error("Could not determine patient_id for this gap.");
      }

      const writes = []; // queue of { subcomp, draft, entryDate, entryCode } to process

      // Validate visit-mode top-level state up front
      if (mode === "visit" && !visitDate) {
        throw new Error("Visit date is required.");
      }

      for (const s of subcomps) {
        // Skip already-done or already-excluded
        if (s.completed || s.exclusion_documented) continue;
        const d = drafts[s.id];
        if (!d) continue;

        if (d.exclusion) {
          // Exclusion is mode-agnostic - reason is always required
          if (!d.exclusionReason?.trim()) {
            throw new Error("Exclusion reason required for " + s.component_code);
          }
          writes.push({ kind: "exclusion", subcomp: s, draft: d });
          continue;
        }

        // Determine entry date and code based on mode
        let entryDate, entryCode;
        if (mode === "visit") {
          // Visit mode: only process antigens the user explicitly checked.
          // Use the top-level visit date for everyone. CVX must be filled
          // (the default pre-fills it; user can override or clear).
          if (!d.included) continue;
          entryDate = visitDate;
          entryCode = d.code?.trim();
          if (!entryCode) {
            throw new Error(s.component_code + ": CVX/CPT code is required.");
          }
        } else {
          // Chart-review mode: per-card date + code. Skip silently if
          // either is missing (user hasn't engaged with this card yet).
          if (!d.date || !d.code?.trim()) continue;
          entryDate = d.date;
          entryCode = d.code.trim();
        }

        // Validate doses count
        const doses = parseInt(d.doses, 10) || 1;
        const remaining = s.doses_required - s.doses_completed;
        if (doses < 1 || doses > remaining) {
          throw new Error(s.component_code + ": doses must be between 1 and " + remaining);
        }
        writes.push({ kind: "evidence", subcomp: s, draft: d, doses, entryDate, entryCode });
      }

      if (writes.length === 0) {
        throw new Error(mode === "visit"
          ? "Nothing to save. Check the antigens administered today, or mark one as excluded."
          : "Nothing to save. Fill date+code on at least one antigen, or mark one as excluded.");
      }

      // Iterate writes. Per-write failures are reported but don't roll back
      // earlier successes - same philosophy as the simple modal: partial
      // attestation is preferable to losing all of it on the last failure.
      for (const w of writes) {
        if (w.kind === "evidence") {
          // Heuristic: CIS/IMA component codes typically map to CVX vaccine
          // codes. Store as evidence_data.cvx for now; lab-style measures
          // could put a real loinc_code here later.
          const isVaccine = ["DTaP","IPV","MMR","HiB","HepB","VZV","PCV","HepA","RV","Flu","Combo10","HPV","Tdap"].includes(w.subcomp.component_code);
          const evidence = await insertRow("cm_clinical_evidence", {
            patient_id:        patientId,
            evidence_type:     isVaccine ? "Immunization" : "Encounter",
            evidence_category: isVaccine ? "Immunization" : "Encounter",
            evidence_date:     w.entryDate,
            source:            "Manual Attestation",
            attested_by:       profile.id,
            attested_at:       new Date().toISOString(),
            attestation_note:  w.draft.note?.trim() || null,
            created_by:        profile.id,
            evidence_data: {
              measure_code:    gap.measure_code,
              component_code:  w.subcomp.component_code,
              component_label: w.subcomp.component_label || null,
              code_entered:    w.entryCode,
              doses_satisfied: w.doses,
            },
          }, practiceId, {
            audit: { entityType: "cm_clinical_evidence", patientId },
          });

          // Link evidence to subcomponent
          const { error: linkErr } = await supabase
            .from("cm_evidence_subcomponent_links")
            .insert({
              evidence_id:          evidence.id,
              subcomponent_id:      w.subcomp.id,
              satisfies_dose_count: w.doses,
              notes:                w.draft.note?.trim() || null,
            });
          if (linkErr) throw linkErr;

          // Bump doses_completed. completed is GENERATED so DB recomputes.
          const newDoses = w.subcomp.doses_completed + w.doses;
          const willComplete = newDoses >= w.subcomp.doses_required;
          // Distinguish in-window vs outside-window close per schema CHECK.
          // window_close is nullable; when not set, default to in_window
          // (most common case - staff closing gaps live during the MY).
          const inWindow = !w.subcomp.window_close || w.entryDate <= w.subcomp.window_close;
          const newWindowStatus = willComplete
            ? (inWindow ? "closed_in_window" : "closed_outside_window")
            : "open";
          const { error: upErr } = await supabase
            .from("cm_hedis_gap_subcomponents")
            .update({
              doses_completed: newDoses,
              completed_at:    willComplete ? new Date().toISOString() : null,
              window_status:   newWindowStatus,
            })
            .eq("id", w.subcomp.id);
          if (upErr) throw upErr;
        } else if (w.kind === "exclusion") {
          const { error: upErr } = await supabase
            .from("cm_hedis_gap_subcomponents")
            .update({
              exclusion_documented: true,
              exclusion_reason:     w.draft.exclusionReason.trim(),
              window_status:        "excluded",
            })
            .eq("id", w.subcomp.id);
          if (upErr) throw upErr;
        }
      }

      // Re-fetch sub-components to compute final state
      const { data: refreshed, error: refreshErr } = await supabase
        .from("cm_hedis_gap_subcomponents")
        .select("*")
        .eq("gap_id", gap.id)
        .order("component_index", { ascending: true, nullsFirst: false })
        .order("component_code");
      if (refreshErr) throw refreshErr;

      const allDoneOrExcluded = (refreshed || []).every(
        s => s.completed || s.exclusion_documented
      );

      if (allDoneOrExcluded && (refreshed || []).length > 0) {
        // Full close: update the parent gap and notify the caller. The
        // parent typically closes the modal in its onSaved handler.
        const updatedGap = await updateRow("cm_hedis_member_gaps", gap.id, {
          closed_at:      new Date().toISOString(),
          closure_method: "Composite components met",
        }, {
          audit: { entityType: "cm_hedis_member_gaps", patientId, details: { method: "composite", subcomponent_count: refreshed.length } },
        });
        onSaved({ gap: updatedGap, evidence: null });
      } else {
        // Partial save: keep the modal open and refresh in place so just-
        // saved doses appear (e.g. DTaP 1/4 -> DTaP 2/4 with "2 remaining"
        // visible). Clear the draft buffer so a second save doesn't re-
        // submit the same entries.
        setSubcomps(refreshed || []);
        setDrafts({});
        setSaving(false);
      }
    } catch (e) {
      console.error("[CloseGapModal] save failed:", e);
      setError(e.message || "Failed to save attestations");
      setSaving(false);
      // NOTE: don't call loadSubcomps() here - it starts with setError(null)
      // which clobbers the message. Refresh inline instead, swallowing any
      // refresh failures (the error message is what matters to the user).
      try {
        const { data } = await supabase
          .from("cm_hedis_gap_subcomponents")
          .select("*")
          .eq("gap_id", gap.id)
          .order("component_index", { ascending: true, nullsFirst: false })
          .order("component_code");
        if (data) {
          setSubcomps(data);
          setDrafts({});
        }
      } catch (_) {}
    }
  };

  // ─── Render ──────────────────────────────────────────────────────────
  if (loading || generating) {
    return (
      <Modal title={"Close gap: " + gap.measure_code} onClose={onClose} maxWidth={780}>
        <Loader label={generating ? "Generating sub-components..." : "Loading components..."} />
      </Modal>
    );
  }

  return (
    <Modal title={"Close gap: " + gap.measure_code} onClose={onClose} maxWidth={780}>
      {/* Context strip */}
      <div style={{ marginBottom: 14, padding: "10px 12px", background: C.tealBg, border: "0.5px solid " + C.tealBorder, borderRadius: 6, fontSize: 12, color: C.textPrimary }}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>{measureName}</div>
        <div style={{ fontSize: 11, color: C.textSecondary }}>
          {gap.source_plan_short_name ? "via " + gap.source_plan_short_name : ""}
          {sourceFile ? " (" + sourceFile + ")" : ""}
        </div>
      </div>

      <div style={{ marginBottom: 12, padding: "10px 12px", background: C.bgSecondary, borderRadius: 6, fontSize: 12, color: C.textPrimary, lineHeight: 1.55 }}>
        <strong>Composite measure.</strong> {mode === "visit"
          ? "Check off antigens administered at today's visit. The gap closes when every component is completed or documented as excluded across visits."
          : "Document each component with its own evidence date - useful for catch-up entry where doses span multiple historical visits."}
      </div>

      {/* Mode toggle */}
      <div style={{ display: "flex", gap: 0, marginBottom: 12, border: "0.5px solid " + C.borderMid, borderRadius: 6, overflow: "hidden", width: "fit-content" }}>
        <ModeButton active={mode === "visit"} onClick={() => setMode("visit")}>
          Visit mode
        </ModeButton>
        <ModeButton active={mode === "chart_review"} onClick={() => setMode("chart_review")}>
          Chart review
        </ModeButton>
      </div>

      {/* Visit date - only in visit mode */}
      {mode === "visit" && (
        <div style={{ marginBottom: 14, padding: "10px 12px", background: "#fff", border: "0.5px solid " + C.borderLight, borderRadius: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <FL style={{ marginBottom: 0 }}>Visit date</FL>
            <input
              type="date"
              value={visitDate}
              onChange={e => setVisitDate(e.target.value)}
              style={{ padding: "6px 8px", border: "0.5px solid " + C.borderMid, borderRadius: 4, fontSize: 12, fontFamily: "inherit" }}
            />
            <span style={{ fontSize: 11, color: C.textTertiary, marginLeft: "auto" }}>
              Applies to every antigen checked below
            </span>
          </div>
        </div>
      )}

      {/* Progress strip */}
      <div style={{ display: "flex", gap: 14, marginBottom: 14, padding: "10px 12px", background: "#fff", border: "0.5px solid " + C.borderLight, borderRadius: 6, fontSize: 12 }}>
        <div><strong>{stats.done}</strong> of {stats.total} complete</div>
        {stats.excluded > 0 && <div style={{ color: C.textSecondary }}>{stats.excluded} excluded</div>}
        {stats.open > 0 && <div style={{ color: C.amber }}>{stats.open} remaining</div>}
        {mode === "visit" && pendingCount > 0 && (
          <div style={{ marginLeft: "auto", color: C.teal, fontWeight: 600 }}>
            {pendingCount} marked for this visit
          </div>
        )}
      </div>

      {/* Sub-component cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 460, overflowY: "auto" }}>
        {subcomps.map(s => (
          <SubcomponentCard
            key={s.id}
            subcomp={s}
            draft={getDraft(s)}
            mode={mode}
            onUpdate={(patch) => updateDraft(s, patch)}
          />
        ))}
      </div>

      {error && (
        <div style={{ marginTop: 10, padding: "8px 12px", background: "#fef2f2", border: "0.5px solid " + C.red, borderRadius: 6, fontSize: 12, color: C.red }}>
          {error}
        </div>
      )}

      <div style={{ marginTop: 14, paddingTop: 12, borderTop: "0.5px solid " + C.borderLight, display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn variant="outline" onClick={onClose} disabled={saving}>Cancel</Btn>
        <Btn onClick={save} disabled={saving || subcomps.length === 0 || pendingCount === 0}>
          {saving ? "Saving..."
            : mode === "visit"
              ? (pendingCount > 0 ? "Save visit (" + pendingCount + " antigen" + (pendingCount === 1 ? "" : "s") + ")" : "Save visit")
              : (pendingCount > 0 ? "Save attestations (" + pendingCount + ")" : "Save attestations")}
        </Btn>
      </div>
    </Modal>
  );
}

// ─── Mode toggle button ──────────────────────────────────────────────────
function ModeButton({ active, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "8px 16px",
        fontSize: 12,
        fontWeight: 600,
        fontFamily: "inherit",
        border: "none",
        cursor: "pointer",
        background: active ? C.teal : "#fff",
        color: active ? "#fff" : C.textPrimary,
        transition: "background 0.15s, color 0.15s",
      }}
    >
      {children}
    </button>
  );
}

// ─── Single sub-component card ───────────────────────────────────────────
function SubcomponentCard({ subcomp, draft, mode, onUpdate }) {
  const s = subcomp;

  // Locked: already completed
  if (s.completed) {
    return (
      <div style={{ padding: "10px 14px", border: "0.5px solid " + C.tealMid, borderLeft: "3px solid " + C.tealMid, borderRadius: 6, background: C.tealBg }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <code style={{ fontFamily: "monospace", fontWeight: 700, color: C.teal }}>{s.component_code}</code>
          <span style={{ fontSize: 12, color: C.textPrimary }}>{s.component_label}</span>
          <Badge label="Complete" variant="green" size="xs" />
          <span style={{ marginLeft: "auto", fontSize: 11, color: C.textTertiary }}>
            {s.doses_completed} / {s.doses_required} doses
            {s.completed_at ? " · " + new Date(s.completed_at).toLocaleDateString() : ""}
          </span>
        </div>
      </div>
    );
  }

  // Locked: documented exclusion
  if (s.exclusion_documented) {
    return (
      <div style={{ padding: "10px 14px", border: "0.5px solid " + C.borderMid, borderLeft: "3px solid " + C.borderMid, borderRadius: 6, background: "#fafafa" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <code style={{ fontFamily: "monospace", fontWeight: 700, color: C.textSecondary }}>{s.component_code}</code>
          <span style={{ fontSize: 12, color: C.textPrimary }}>{s.component_label}</span>
          <Badge label="Excluded" variant="neutral" size="xs" />
        </div>
        {s.exclusion_reason && (
          <div style={{ fontSize: 11, color: C.textSecondary, marginLeft: 0 }}>
            <strong>Reason:</strong> {s.exclusion_reason}
          </div>
        )}
      </div>
    );
  }

  // Open: form state forks by mode
  const remaining = s.doses_required - s.doses_completed;
  const partialProgress = s.doses_completed > 0;
  const inExclusion = draft.exclusion;
  const isVisitMode = mode === "visit";
  // In visit mode: card is collapsed unless user has checked it OR they're
  // in exclusion entry. In chart review: always show the form.
  const expanded = !isVisitMode || draft.included || inExclusion;

  return (
    <div style={{
      padding: "12px 14px",
      border: "0.5px solid " + (draft.included ? C.tealBorder : C.amberBorder),
      borderLeft: "3px solid " + (draft.included ? C.teal : C.amber),
      borderRadius: 6,
      background: "#fff",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: expanded ? 8 : 0, flexWrap: "wrap" }}>
        {/* Visit-mode include checkbox */}
        {isVisitMode && !inExclusion && (
          <input
            type="checkbox"
            checked={!!draft.included}
            onChange={e => onUpdate({ included: e.target.checked })}
            style={{ width: 16, height: 16, cursor: "pointer", margin: 0 }}
            title="Administered at this visit"
          />
        )}
        <code style={{ fontFamily: "monospace", fontWeight: 700, color: C.teal }}>{s.component_code}</code>
        <span style={{ fontSize: 13, color: C.textPrimary, fontWeight: 500 }}>{s.component_label}</span>
        <Badge label={s.doses_completed + " / " + s.doses_required + " doses"} variant={partialProgress ? "blue" : "amber"} size="xs" />
        {partialProgress && <span style={{ fontSize: 11, color: C.textTertiary }}>{remaining} remaining</span>}
      </div>

      {expanded && !inExclusion && (
        <>
          {isVisitMode ? (
            // Visit mode: just CVX + doses (date is the top-level visit date)
            <div style={{ display: "grid", gridTemplateColumns: "1fr 80px", gap: 8 }}>
              <div>
                <FL>CVX/CPT code</FL>
                <input type="text" value={draft.code} onChange={e => onUpdate({ code: e.target.value })}
                  placeholder="e.g. 20"
                  style={{ width: "100%", padding: "6px 8px", border: "0.5px solid " + C.borderMid, borderRadius: 4, fontSize: 12, fontFamily: "inherit" }} />
              </div>
              <div>
                <FL>Doses</FL>
                <input type="number" min="1" max={remaining} value={draft.doses} onChange={e => onUpdate({ doses: e.target.value })}
                  style={{ width: "100%", padding: "6px 8px", border: "0.5px solid " + C.borderMid, borderRadius: 4, fontSize: 12, fontFamily: "inherit" }} />
              </div>
            </div>
          ) : (
            // Chart review mode: per-card date + CVX + doses
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 80px", gap: 8 }}>
              <div>
                <FL>Evidence date</FL>
                <input type="date" value={draft.date} onChange={e => onUpdate({ date: e.target.value })}
                  style={{ width: "100%", padding: "6px 8px", border: "0.5px solid " + C.borderMid, borderRadius: 4, fontSize: 12, fontFamily: "inherit" }} />
              </div>
              <div>
                <FL>CVX/CPT code</FL>
                <input type="text" value={draft.code} onChange={e => onUpdate({ code: e.target.value })}
                  placeholder="e.g. 20"
                  style={{ width: "100%", padding: "6px 8px", border: "0.5px solid " + C.borderMid, borderRadius: 4, fontSize: 12, fontFamily: "inherit" }} />
              </div>
              <div>
                <FL>Doses</FL>
                <input type="number" min="1" max={remaining} value={draft.doses} onChange={e => onUpdate({ doses: e.target.value })}
                  style={{ width: "100%", padding: "6px 8px", border: "0.5px solid " + C.borderMid, borderRadius: 4, fontSize: 12, fontFamily: "inherit" }} />
              </div>
            </div>
          )}
          <div style={{ marginTop: 6, fontSize: 11, color: C.textTertiary, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Set Doses &gt; 1 if this entry covers multiple historical shots (e.g. chart review).</span>
            <button onClick={() => onUpdate({ exclusion: true, included: false })}
              style={{ background: "none", border: "none", color: C.textSecondary, fontSize: 11, cursor: "pointer", textDecoration: "underline", fontFamily: "inherit", padding: 0 }}>
              Mark as excluded instead
            </button>
          </div>
        </>
      )}

      {inExclusion && (
        <>
          <div>
            <FL>Exclusion reason</FL>
            <input type="text" value={draft.exclusionReason} onChange={e => onUpdate({ exclusionReason: e.target.value })}
              placeholder="e.g. Medical contraindication; Documented immunity; Parental refusal"
              style={{ width: "100%", padding: "6px 8px", border: "0.5px solid " + C.borderMid, borderRadius: 4, fontSize: 12, fontFamily: "inherit" }} />
          </div>
          <div style={{ marginTop: 6, fontSize: 11, color: C.textTertiary, textAlign: "right" }}>
            <button onClick={() => onUpdate({ exclusion: false, exclusionReason: "" })}
              style={{ background: "none", border: "none", color: C.textSecondary, fontSize: 11, cursor: "pointer", textDecoration: "underline", fontFamily: "inherit", padding: 0 }}>
              Cancel exclusion - go back to evidence entry
            </button>
          </div>
        </>
      )}

      {/* Visit-mode collapsed shortcut: tiny "exclude" link when not yet included */}
      {isVisitMode && !expanded && (
        <div style={{ marginTop: 6, fontSize: 11, color: C.textTertiary, textAlign: "right" }}>
          <button onClick={() => onUpdate({ exclusion: true, included: false })}
            style={{ background: "none", border: "none", color: C.textSecondary, fontSize: 11, cursor: "pointer", textDecoration: "underline", fontFamily: "inherit", padding: 0 }}>
            Not given today - mark as excluded
          </button>
        </div>
      )}
    </div>
  );
}
