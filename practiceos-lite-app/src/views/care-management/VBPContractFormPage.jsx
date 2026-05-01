// ═══════════════════════════════════════════════════════════════════════════
// VBPContractFormPage.jsx
//
// Full-page form for creating + editing a VBP contract. Two modes:
//   Create: 4-step wizard (Identity > Payment > Eligibility > Measures)
//   Edit:   collapsible sections (all open by default), no stepper
//
// Routes (you wire these up in your router):
//   /care-management/vbp-contracts/new   -> create mode
//   /care-management/vbp-contracts/:id   -> edit mode
//
// Form mirrors the schema:
//   cm_vbp_contracts.payment_methodology     (jsonb, contract-level)
//   cm_vbp_contracts.eligibility_requirements (jsonb)
//   cm_vbp_contract_measures.payment_rule    (jsonb, per-measure)
//
// Adaptive behavior: program_type (per_gap_closure/per_gap_tiered/qrt_gate/
// shared_savings_pool/fee_inflator/hybrid/other) drives which structured
// fields render. Every structured form has a "Show raw JSON" escape hatch.
//
// Save semantics: contract row first, then bulk-replace measure rows. Edit
// is destructive replace on measures (delete-all + reinsert). Simpler to
// reason about; safe today because nothing FK's to cm_vbp_contract_measures.
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../auth/AuthProvider";
import { C } from "../../lib/tokens";
import { NC_HEALTH_PLANS_GROUPED } from "./constants";
import {
  Btn, Card, Loader, ErrorBanner, FL, Badge, Input, Select, Textarea,
} from "../../components/ui";
import { Th, Td, inputStyle, selectStyle } from "./shared";

// ─── Constants ───────────────────────────────────────────────────────────────
const PROGRAM_TYPES = [
  { value: "per_gap_closure",      label: "Per-gap closure",          desc: "Flat $ per closed gap (e.g. WellCare P4Q)" },
  { value: "per_gap_tiered",       label: "Per-gap tiered",           desc: "Rate-target tiers w/ optional High Priority diff (e.g. UHC CP-PCPi)" },
  { value: "qrt_gate",             label: "Quality threshold gate",   desc: "Weighted benchmarks; QRT >= threshold unlocks separate shared savings (e.g. WellCare CCPN)" },
  { value: "shared_savings_pool",  label: "Shared savings pool",      desc: "PMPM cost reduction creates pool; quality determines share (e.g. UBH OPSS)" },
  { value: "fee_inflator",         label: "Fee schedule inflator",    desc: "% rate increase on fee schedule based on performance (e.g. UHC HH PBC)" },
  { value: "hybrid",               label: "Hybrid",                   desc: "Combination of above" },
  { value: "other",                label: "Other",                    desc: "Novel structure - use raw JSON editors" },
];

const TARGET_TYPES = [
  { value: "rate",                 label: "Rate (%)" },
  { value: "gap_closure_count",    label: "Gap closure count" },
  { value: "gap_closure_rate",     label: "Gap closure rate (%)" },
  { value: "improvement_pct",      label: "Improvement over baseline (pp)" },
  { value: "improvement_count",    label: "Improvement count" },
  { value: "reporting_only",       label: "Reporting only (no target)" },
  { value: "other",                label: "Other (see payment_rule)" },
];

const MEASURE_STATUSES = [
  { value: "Active",                label: "Active" },
  { value: "Excluded_Retirement",   label: "Excluded - NCQA retired" },
  { value: "Excluded_Denominator",  label: "Excluded - denominator below min" },
  { value: "Excluded_Other",        label: "Excluded - other" },
];

const STATUS_OPTIONS = ["Draft", "Active", "Expired", "Cancelled", "Archived"];

// NC health plans / payers that may issue VBP contracts. Stored value is the
// canonical short_name (lowercase snake_case) so it matches what the HEDIS
// gap pipeline already uses on cm_hedis_uploads.source_plan_short_name -
// keeping the two columns aligned is critical for Phase 3 outbound
// serializer joins. Display label is human-readable.
//
// Grouped by line of business. Tailored Plan PHPs (Alliance, Partners,
// Trillium, Vaya) are NC's behavioral health/I-DD/TBI Medicaid plans.
// Standard Plan PHPs are the 5 statewide Medicaid managed care plans.

// HCP-LAN APM Framework categories. Industry-standard taxonomy from the
// Health Care Payment Learning & Action Network. Practices use this for
// portfolio reporting and to align with HCPLAN's 2030 goal of more two-sided
// risk contracts (3B + Category 4). See https://hcp-lan.org/apm-framework/
const HCP_LAN_CATEGORIES = [
  { value: "",   label: "Not classified" },
  { value: "1",  label: "1 - FFS, no link to quality" },
  { value: "2A", label: "2A - Foundational payments (infrastructure)" },
  { value: "2B", label: "2B - Pay for reporting" },
  { value: "2C", label: "2C - Pay-for-performance" },
  { value: "3A", label: "3A - Shared savings (upside only)" },
  { value: "3B", label: "3B - Shared savings + risk (upside + downside)" },
  { value: "3N", label: "3N - Risk-based, not linked to quality" },
  { value: "4A", label: "4A - Condition-specific population-based payment" },
  { value: "4B", label: "4B - Comprehensive population-based payment" },
  { value: "4C", label: "4C - Integrated finance + delivery system" },
  { value: "4N", label: "4N - Capitated, not linked to quality" },
];

// ═══════════════════════════════════════════════════════════════════════════
// Top-level page component
// ═══════════════════════════════════════════════════════════════════════════
export default function VBPContractFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { practiceId, profile } = useAuth();
  const isNew = !id || id === "new";

  const [loading, setLoading]   = useState(!isNew);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState(null);
  const [measureCatalog, setMeasureCatalog] = useState([]);

  // Wizard step (create only)
  const [step, setStep] = useState(0);

  // Form state - shape mirrors the schema exactly so save is a 1:1 mapping.
  const [contract, setContract] = useState(emptyContract());
  const [measures, setMeasures] = useState([]);

  // Section collapsed state (edit mode only)
  const [collapsed, setCollapsed] = useState({ identity: false, payment: false, eligibility: true, measures: false });

  // Load measure catalog for the picker dropdown.
  // amh_measure_set_year (int[]) drives the AMH-set-only constraint enforced
  // in MeasuresSection. Per NC, VBP contracts offered to AMH practices by
  // Standard Plans must use only measures from the AMH Measure Set for the
  // contract's MY. Future flexibility may relax this; an override toggle in
  // the section will allow non-AMH measures when explicitly enabled.
  useEffect(() => {
    supabase.from("cm_hedis_measures")
      .select("measure_code, measure_name, classification_status, measure_kind, active, amh_measure_set_year")
      .eq("active", true)
      .order("measure_code")
      .then(({ data, error: e }) => {
        if (e) { setError(e.message); return; }
        setMeasureCatalog(data || []);
      });
  }, []);

  // Load existing contract for edit mode
  useEffect(() => {
    if (isNew) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const [cRes, mRes] = await Promise.all([
          supabase.from("cm_vbp_contracts").select("*").eq("id", id).single(),
          supabase.from("cm_vbp_contract_measures").select("*").eq("contract_id", id).order("measurement_period_label", { nullsFirst: true }).order("measure_code"),
        ]);
        if (cancelled) return;
        if (cRes.error) throw cRes.error;
        if (mRes.error) throw mRes.error;
        setContract(cRes.data);
        setMeasures(mRes.data || []);
      } catch (e) {
        if (!cancelled) setError(e.message || "Failed to load contract");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, isNew]);

  // ─── Validation ────────────────────────────────────────────────────────────
  const validateStep = (s) => {
    const errs = [];
    if (s === 0) {
      if (!contract.contract_label?.trim())   errs.push("Contract label is required");
      if (!contract.payer_short_name?.trim()) errs.push("Payer is required");
      if (!contract.measurement_year)         errs.push("Measurement year is required");
      if (!contract.status)                   errs.push("Status is required");
    }
    if (s === 1) {
      // payment is optional - admins can fill in later. No required fields.
    }
    if (s === 3) {
      // measures - at least one is recommended but not required (some draft contracts may have zero)
      for (const m of measures) {
        if (!m.measure_code) {
          errs.push("Every measure row needs a measure code");
          break;
        }
        if (!m.target_type) {
          errs.push("Every measure row needs a target type");
          break;
        }
      }
    }
    return errs;
  };

  // ─── Save ─────────────────────────────────────────────────────────────────
  const save = async () => {
    const allErrors = [...validateStep(0), ...validateStep(1), ...validateStep(3)];
    if (allErrors.length > 0) {
      setError(allErrors.join("; "));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        practice_id:               practiceId,
        payer_short_name:          contract.payer_short_name.trim(),
        measurement_year:          parseInt(contract.measurement_year, 10),
        contract_label:            contract.contract_label.trim(),
        contract_type:             contract.contract_type?.trim() || null,
        program_type:              contract.program_type || null,
        hcp_lan_category:          contract.hcp_lan_category || null,
        effective_start:           contract.effective_start || null,
        effective_end:             contract.effective_end || null,
        status:                    contract.status,
        payment_methodology:       contract.payment_methodology,
        eligibility_requirements:  contract.eligibility_requirements,
        notes_payment_methodology: contract.notes_payment_methodology?.trim() || null,
        notes:                     contract.notes?.trim() || null,
      };

      let contractId;
      if (isNew) {
        payload.created_by = profile?.id || null;
        const { data, error: cErr } = await supabase
          .from("cm_vbp_contracts")
          .insert(payload)
          .select("id")
          .single();
        if (cErr) throw cErr;
        contractId = data.id;
      } else {
        contractId = contract.id;
        const { error: cErr } = await supabase
          .from("cm_vbp_contracts")
          .update(payload)
          .eq("id", contractId);
        if (cErr) throw cErr;

        // Destructive-replace measures
        const { error: dErr } = await supabase
          .from("cm_vbp_contract_measures")
          .delete()
          .eq("contract_id", contractId);
        if (dErr) throw dErr;
      }

      if (measures.length > 0) {
        const measurePayload = measures.map(m => ({
          contract_id:              contractId,
          measure_code:             m.measure_code,
          target_type:              m.target_type,
          target_value:             m.target_value === "" || m.target_value === null || m.target_value === undefined ? null : parseFloat(m.target_value),
          target_unit:              m.target_unit?.trim() || null,
          weight:                   m.weight === "" || m.weight === null || m.weight === undefined ? null : parseFloat(m.weight),
          denominator_min:          m.denominator_min === "" || m.denominator_min === null || m.denominator_min === undefined ? null : parseInt(m.denominator_min, 10),
          status:                   m.status || "Active",
          measurement_period_label: m.measurement_period_label?.trim() || null,
          payment_rule:             m.payment_rule,
          notes:                    m.notes?.trim() || null,
        }));
        const { error: mErr } = await supabase
          .from("cm_vbp_contract_measures")
          .insert(measurePayload);
        if (mErr) throw mErr;
      }

      navigate("/care-management", { state: { tab: "vbp" } });
    } catch (e) {
      setError(e.message || "Failed to save contract");
      setSaving(false);
    }
  };

  if (loading) return <div style={{ padding: 40, display: "flex", justifyContent: "center" }}><Loader /></div>;

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: "20px 24px", maxWidth: 1100, margin: "0 auto", width: "100%" }}>
      <div style={{ marginBottom: 14 }}>
        <Btn variant="ghost" size="sm" onClick={() => navigate("/care-management", { state: { tab: "vbp" } })}>← Back to contracts</Btn>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: C.textPrimary, margin: 0 }}>
            {isNew ? "New VBP contract" : "Edit VBP contract"}
          </h1>
          {!isNew && contract.contract_label && (
            <div style={{ fontSize: 13, color: C.textSecondary, marginTop: 4 }}>
              {contract.contract_label}
            </div>
          )}
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {isNew ? (
        <WizardLayout
          step={step}
          setStep={setStep}
          contract={contract}
          setContract={setContract}
          measures={measures}
          setMeasures={setMeasures}
          measureCatalog={measureCatalog}
          onCancel={() => navigate("/care-management", { state: { tab: "vbp" } })}
          onSave={save}
          saving={saving}
          validateStep={validateStep}
          setError={setError}
        />
      ) : (
        <EditLayout
          contract={contract}
          setContract={setContract}
          measures={measures}
          setMeasures={setMeasures}
          measureCatalog={measureCatalog}
          collapsed={collapsed}
          setCollapsed={setCollapsed}
          onCancel={() => navigate("/care-management", { state: { tab: "vbp" } })}
          onSave={save}
          saving={saving}
        />
      )}
    </div>
  );
}

// ─── Wizard layout (create) ──────────────────────────────────────────────────
function WizardLayout({ step, setStep, contract, setContract, measures, setMeasures, measureCatalog, onCancel, onSave, saving, validateStep, setError }) {
  const STEPS = [
    { label: "Identity",     desc: "Contract basics" },
    { label: "Payment",      desc: "Methodology + payout structure" },
    { label: "Eligibility",  desc: "Gating requirements" },
    { label: "Measures",     desc: "Measures included" },
  ];

  const goNext = () => {
    const errs = validateStep(step);
    if (errs.length > 0) { setError(errs.join("; ")); return; }
    setError(null);
    setStep(s => Math.min(STEPS.length - 1, s + 1));
  };
  const goBack = () => { setError(null); setStep(s => Math.max(0, s - 1)); };

  return (
    <>
      {/* Stepper */}
      <div style={{
        display: "flex", gap: 0, marginBottom: 20,
        border: "0.5px solid " + C.borderLight, borderRadius: 8, overflow: "hidden",
      }}>
        {STEPS.map((s, i) => {
          const isCurrent = i === step;
          const isCompleted = i < step;
          return (
            <button
              key={s.label}
              onClick={() => i < step && setStep(i)}
              disabled={i > step}
              style={{
                flex: 1, border: "none", borderRight: i < STEPS.length - 1 ? "0.5px solid " + C.borderLight : "none",
                padding: "12px 14px", textAlign: "left",
                background: isCurrent ? C.tealBg : "#fff",
                color: isCurrent ? C.teal : (isCompleted ? C.textPrimary : C.textTertiary),
                cursor: i < step ? "pointer" : (isCurrent ? "default" : "not-allowed"),
                fontFamily: "inherit",
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 2 }}>
                Step {i + 1}{isCompleted ? " ✓" : ""}
              </div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{s.label}</div>
              <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>{s.desc}</div>
            </button>
          );
        })}
      </div>

      <Card style={{ padding: 20 }}>
        {step === 0 && <IdentitySection contract={contract} setContract={setContract} />}
        {step === 1 && <PaymentSection contract={contract} setContract={setContract} />}
        {step === 2 && <EligibilitySection contract={contract} setContract={setContract} />}
        {step === 3 && <MeasuresSection contract={contract} measures={measures} setMeasures={setMeasures} measureCatalog={measureCatalog} />}
      </Card>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20, gap: 8 }}>
        <Btn variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Btn>
        <div style={{ display: "flex", gap: 8 }}>
          {step > 0 && <Btn variant="outline" onClick={goBack} disabled={saving}>Back</Btn>}
          {step < STEPS.length - 1 && <Btn variant="primary" onClick={goNext}>Next</Btn>}
          {step === STEPS.length - 1 && (
            <Btn variant="primary" onClick={onSave} disabled={saving}>
              {saving ? "Saving..." : "Create contract"}
            </Btn>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Edit layout (collapsible) ───────────────────────────────────────────────
function EditLayout({ contract, setContract, measures, setMeasures, measureCatalog, collapsed, setCollapsed, onCancel, onSave, saving }) {
  const toggle = (key) => setCollapsed(c => ({ ...c, [key]: !c[key] }));

  return (
    <>
      <CollapsibleSection title="Identity" isCollapsed={collapsed.identity} onToggle={() => toggle("identity")}>
        <IdentitySection contract={contract} setContract={setContract} />
      </CollapsibleSection>
      <CollapsibleSection title="Payment structure" isCollapsed={collapsed.payment} onToggle={() => toggle("payment")}>
        <PaymentSection contract={contract} setContract={setContract} />
      </CollapsibleSection>
      <CollapsibleSection title="Eligibility requirements" isCollapsed={collapsed.eligibility} onToggle={() => toggle("eligibility")}>
        <EligibilitySection contract={contract} setContract={setContract} />
      </CollapsibleSection>
      <CollapsibleSection title="Measures" isCollapsed={collapsed.measures} onToggle={() => toggle("measures")}>
        <MeasuresSection contract={contract} measures={measures} setMeasures={setMeasures} measureCatalog={measureCatalog} />
      </CollapsibleSection>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20, gap: 8 }}>
        <Btn variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Btn>
        <Btn variant="primary" onClick={onSave} disabled={saving}>
          {saving ? "Saving..." : "Save changes"}
        </Btn>
      </div>
    </>
  );
}

function CollapsibleSection({ title, isCollapsed, onToggle, children }) {
  return (
    <Card style={{ padding: 0, marginBottom: 14, overflow: "hidden" }}>
      <button
        onClick={onToggle}
        style={{
          width: "100%", padding: "12px 16px", border: "none",
          background: C.bgSecondary, cursor: "pointer", textAlign: "left",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          fontFamily: "inherit",
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 700, color: C.textPrimary }}>{title}</span>
        <span style={{ fontSize: 18, color: C.textSecondary }}>{isCollapsed ? "+" : "−"}</span>
      </button>
      {!isCollapsed && (
        <div style={{ padding: 20, borderTop: "0.5px solid " + C.borderLight }}>
          {children}
        </div>
      )}
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Section A: Identity
// ═══════════════════════════════════════════════════════════════════════════
function IdentitySection({ contract, setContract }) {
  const set = (k) => (v) => setContract(c => ({ ...c, [k]: v }));
  const currentYear = new Date().getFullYear();
  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <FL>Contract label *</FL>
        <input
          type="text"
          value={contract.contract_label}
          onChange={e => set("contract_label")(e.target.value)}
          placeholder="e.g. UHC CP-PCPi 2026"
          style={inputStyle}
        />
      </div>
      <div style={{ marginBottom: 14 }}>
        <FL>Health plan / payer *</FL>
        <select
          value={contract.payer_short_name || ""}
          onChange={e => set("payer_short_name")(e.target.value)}
          style={selectStyle}
        >
          <option value="">Select a health plan...</option>
          {NC_HEALTH_PLANS_GROUPED.map(group => (
            <optgroup key={group.group} label={group.group}>
              {group.options.map(opt => (
                <option key={opt.short} value={opt.short}>{opt.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 4, lineHeight: 1.5 }}>
          The short identifier is saved (e.g. "healthy_blue") so contracts join cleanly to the HEDIS gap pipeline. If a plan isn't listed, pick "Other" and explain in contract notes.
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <Input label="Measurement year *" type="number" value={contract.measurement_year || currentYear} onChange={set("measurement_year")} />
        <Input label="Effective start" type="date" value={contract.effective_start || ""} onChange={set("effective_start")} />
        <Input label="Effective end" type="date" value={contract.effective_end || ""} onChange={set("effective_end")} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
        <Input label="Contract type (free text)" value={contract.contract_type || ""} onChange={set("contract_type")} placeholder='e.g. AMH P4Q, "Behavioral Health Pay-For-Value"' />
        <Select label="Status *" value={contract.status} onChange={set("status")} options={STATUS_OPTIONS} />
      </div>
      <div style={{ marginBottom: 14 }}>
        <FL>HCP-LAN APM Framework category</FL>
        <select
          value={contract.hcp_lan_category || ""}
          onChange={e => set("hcp_lan_category")(e.target.value || null)}
          style={selectStyle}
        >
          {HCP_LAN_CATEGORIES.map(c => (
            <option key={c.value || "none"} value={c.value}>{c.label}</option>
          ))}
        </select>
        <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 4, lineHeight: 1.5 }}>
          Industry-standard taxonomy. 2B+ is the meaningful VBP range. HCPLAN's 2030 goal targets more 3B and Category 4 contracts (two-sided risk).
        </div>
      </div>
      <Textarea label="Contract notes" value={contract.notes || ""} onChange={set("notes")} rows={2} placeholder="Anything contextual: who signed, where the executed PDF lives, key dates outside the form..." />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Section B: Payment structure
// ═══════════════════════════════════════════════════════════════════════════
function PaymentSection({ contract, setContract }) {
  const set = (k) => (v) => setContract(c => ({ ...c, [k]: v }));
  const setMethodology = (patch) => {
    setContract(c => ({
      ...c,
      payment_methodology: { ...(c.payment_methodology || {}), ...patch },
    }));
  };

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <FL>Program type</FL>
        <select
          value={contract.program_type || ""}
          onChange={e => set("program_type")(e.target.value || null)}
          style={selectStyle}
        >
          <option value="">Not set</option>
          {PROGRAM_TYPES.map(pt => (
            <option key={pt.value} value={pt.value}>{pt.label}</option>
          ))}
        </select>
        {contract.program_type && (
          <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 4, lineHeight: 1.5 }}>
            {PROGRAM_TYPES.find(pt => pt.value === contract.program_type)?.desc}
          </div>
        )}
      </div>

      {/* Adaptive section based on program_type */}
      {contract.program_type === "per_gap_closure" && (
        <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 14, padding: "10px 12px", background: C.bgSecondary, borderRadius: 6 }}>
          Per-gap-closure contracts have all payment logic at the per-measure level. Add measures in Step 4 and set each measure's flat amount via its payment rule.
        </div>
      )}

      {contract.program_type === "per_gap_tiered" && (
        <PerGapTieredFields methodology={contract.payment_methodology || {}} setMethodology={setMethodology} />
      )}

      {contract.program_type === "qrt_gate" && (
        <QrtGateFields methodology={contract.payment_methodology || {}} setMethodology={setMethodology} />
      )}

      {contract.program_type === "shared_savings_pool" && (
        <SharedSavingsPoolFields methodology={contract.payment_methodology || {}} setMethodology={setMethodology} />
      )}

      {contract.program_type === "fee_inflator" && (
        <FeeInflatorFields methodology={contract.payment_methodology || {}} setMethodology={setMethodology} />
      )}

      {(contract.program_type === "hybrid" || contract.program_type === "other") && (
        <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 14, padding: "10px 12px", background: C.amberBg, borderRadius: 6, border: "0.5px solid " + (C.amberBorder || C.amber) }}>
          Hybrid / Other program types use the raw JSON editor below. Define any structure you need; the calc engine (Phase 3) will dispatch on shape.
        </div>
      )}

      <Textarea
        label="Notes about payment methodology"
        value={contract.notes_payment_methodology || ""}
        onChange={set("notes_payment_methodology")}
        rows={2}
        placeholder="Free-text notes about how payment works that don't fit the structured fields."
      />

      <RawJsonToggle
        label="payment_methodology jsonb"
        value={contract.payment_methodology}
        onChange={(parsed) => set("payment_methodology")(parsed)}
      />
    </div>
  );
}

function PerGapTieredFields({ methodology, setMethodology }) {
  return (
    <div style={{ marginBottom: 14, padding: 14, background: C.bgSecondary, borderRadius: 6 }}>
      <Input
        label="High Priority designation (optional)"
        value={methodology.high_priority_designation || ""}
        onChange={(v) => setMethodology({ high_priority_designation: v || undefined })}
        placeholder='e.g. "United-flagged at-risk members"'
      />
      <Input
        label="Retroactive eligibility window (days)"
        type="number"
        value={methodology.retroactive_adjustment_window_days || ""}
        onChange={(v) => setMethodology({ retroactive_adjustment_window_days: v ? parseInt(v, 10) : undefined })}
        placeholder="e.g. 365"
      />
      <div style={{ fontSize: 11, color: C.textTertiary, lineHeight: 1.5 }}>
        Membership-tier definitions (UHC's "Small / Large practice" variant) are not surfaced here. If your contract has them, use the raw JSON editor below to specify <code style={{ fontFamily: "monospace" }}>membership_tiers</code> as an array.
      </div>
    </div>
  );
}

function QrtGateFields({ methodology, setMethodology }) {
  return (
    <div style={{ marginBottom: 14, padding: 14, background: C.bgSecondary, borderRadius: 6 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Input
          label="Quality threshold % *"
          type="number"
          value={methodology.quality_threshold_pct ?? ""}
          onChange={(v) => setMethodology({ quality_threshold_pct: v === "" ? undefined : parseFloat(v) })}
          placeholder="50"
        />
        <Input
          label="Default denominator min"
          type="number"
          value={methodology.denominator_min_default ?? ""}
          onChange={(v) => setMethodology({ denominator_min_default: v === "" ? undefined : parseInt(v, 10) })}
          placeholder="30"
        />
      </div>
      <Textarea
        label="Shared savings terms"
        value={methodology.shared_savings_terms || ""}
        onChange={(v) => setMethodology({ shared_savings_terms: v || undefined })}
        rows={2}
        placeholder="e.g. 'Provider eligible for shared savings per participation agreement when QRT >= threshold and EMR data sharing requirement met.'"
      />
    </div>
  );
}

function SharedSavingsPoolFields({ methodology, setMethodology }) {
  return (
    <div style={{ marginBottom: 14, padding: 14, background: C.bgSecondary, borderRadius: 6 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <Input
          label="Baseline PMPM ($)"
          type="number"
          value={methodology.baseline_pmpm ?? ""}
          onChange={(v) => setMethodology({ baseline_pmpm: v === "" ? undefined : parseFloat(v) })}
          placeholder="425.00"
        />
        <Input
          label="Risk corridor (%)"
          type="number"
          value={methodology.risk_corridor_pct ?? ""}
          onChange={(v) => setMethodology({ risk_corridor_pct: v === "" ? undefined : parseFloat(v) })}
          placeholder="5"
        />
        <Input
          label="Pool max (% of baseline)"
          type="number"
          value={methodology.pool_max_pct_of_baseline ?? ""}
          onChange={(v) => setMethodology({ pool_max_pct_of_baseline: v === "" ? undefined : parseFloat(v) })}
          placeholder="15"
        />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 4 }}>
        <Input
          label="Claims runout (days)"
          type="number"
          value={methodology.claims_runout_days ?? ""}
          onChange={(v) => setMethodology({ claims_runout_days: v === "" ? undefined : parseInt(v, 10) })}
          placeholder="90"
        />
        <Input
          label="Min attributed claims"
          type="number"
          value={methodology.min_attributed_claims ?? ""}
          onChange={(v) => setMethodology({ min_attributed_claims: v === "" ? undefined : parseInt(v, 10) })}
          placeholder="2"
        />
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.textPrimary, marginTop: 4 }}>
        <input
          type="checkbox"
          checked={!!methodology.case_mix_adjustment_used}
          onChange={(e) => setMethodology({ case_mix_adjustment_used: e.target.checked })}
        />
        Case-mix adjustment factor used by plan
      </label>
    </div>
  );
}

function FeeInflatorFields({ methodology, setMethodology }) {
  const periods = methodology.measurement_periods || [];
  const setPeriods = (newPeriods) => setMethodology({ measurement_periods: newPeriods });

  const addPeriod = () => setPeriods([...periods, { label: "MP" + (periods.length + 1), start: "", end: "" }]);
  const removePeriod = (i) => setPeriods(periods.filter((_, idx) => idx !== i));
  const updatePeriod = (i, field, value) => setPeriods(periods.map((p, idx) => idx === i ? { ...p, [field]: value } : p));

  return (
    <div style={{ marginBottom: 14, padding: 14, background: C.bgSecondary, borderRadius: 6 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Input
          label="Applies to (fee schedule reference)"
          value={methodology.applies_to || ""}
          onChange={(v) => setMethodology({ applies_to: v || undefined })}
          placeholder='e.g. "primary_payment_appendix"'
        />
        <Input
          label="Fixed fee adjustment (%) - independent of performance"
          type="number"
          value={methodology.fixed_fee_adjustment_pct ?? ""}
          onChange={(v) => setMethodology({ fixed_fee_adjustment_pct: v === "" ? undefined : parseFloat(v) })}
          placeholder="0"
        />
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.textPrimary, marginBottom: 14 }}>
        <input
          type="checkbox"
          checked={methodology.is_percent_increase_not_pp !== false}
          onChange={(e) => setMethodology({ is_percent_increase_not_pp: e.target.checked })}
        />
        Adjustment is a % increase (not percentage points)
      </label>

      <div>
        <FL>Measurement periods (define MP1 / MP2 / MP3 etc.)</FL>
        <div style={{ fontSize: 11, color: C.textTertiary, marginBottom: 8, lineHeight: 1.5 }}>
          For multi-MP contracts. In Step 4 / Measures section, you'll create one row per measure per MP - each can have a different target.
        </div>
        {periods.length === 0 ? (
          <div style={{ fontSize: 12, color: C.textTertiary, fontStyle: "italic", marginBottom: 8 }}>
            No measurement periods defined yet.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
            {periods.map((p, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 8, alignItems: "end" }}>
                <Input label={i === 0 ? "Label" : ""} value={p.label || ""} onChange={(v) => updatePeriod(i, "label", v)} placeholder="MP1" />
                <Input label={i === 0 ? "Start" : ""} type="date" value={p.start || ""} onChange={(v) => updatePeriod(i, "start", v)} />
                <Input label={i === 0 ? "End" : ""} type="date" value={p.end || ""} onChange={(v) => updatePeriod(i, "end", v)} />
                <Btn size="sm" variant="ghost" onClick={() => removePeriod(i)}>Remove</Btn>
              </div>
            ))}
          </div>
        )}
        <Btn size="sm" variant="outline" onClick={addPeriod}>+ Add measurement period</Btn>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Section C: Eligibility requirements
// ═══════════════════════════════════════════════════════════════════════════
function EligibilitySection({ contract, setContract }) {
  const setEligibility = (patch) => {
    setContract(c => ({
      ...c,
      eligibility_requirements: { ...(c.eligibility_requirements || {}), ...patch },
    }));
  };
  const set = (k) => (v) => setContract(c => ({ ...c, [k]: v }));
  const elig = contract.eligibility_requirements || {};

  return (
    <div>
      <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 14, lineHeight: 1.55 }}>
        Gates that determine whether <strong>any</strong> payment is owed under this contract. When any of these fail, the contract pays $0 regardless of measure performance. Most contracts don't override defaults - this section is collapsible because it's usually empty.
      </div>

      <div style={{ marginBottom: 14, padding: 14, background: C.bgSecondary, borderRadius: 6 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.textPrimary, marginBottom: 8 }}>
          <input type="checkbox" checked={!!elig.requires_emr_data_sharing} onChange={e => setEligibility({ requires_emr_data_sharing: e.target.checked })} />
          Requires EMR data-sharing program participation
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.textPrimary, marginBottom: 8 }}>
          <input type="checkbox" checked={!!elig.monthly_file_required} onChange={e => setEligibility({ monthly_file_required: e.target.checked })} />
          Monthly data file submission required
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.textPrimary, marginBottom: 8 }}>
          <input type="checkbox" checked={elig.good_standing_required !== false} onChange={e => setEligibility({ good_standing_required: e.target.checked })} />
          Provider must remain in good standing
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.textPrimary }}>
          <input type="checkbox" checked={!!elig.non_disputable} onChange={e => setEligibility({ non_disputable: e.target.checked })} />
          Plan determination of compliance is non-disputable
        </label>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Input
          label="Default denominator min"
          type="number"
          value={elig.denominator_min_default ?? ""}
          onChange={(v) => setEligibility({ denominator_min_default: v === "" ? undefined : parseInt(v, 10) })}
          placeholder="30"
        />
        <Input
          label="Claims submission deadline"
          type="date"
          value={elig.claims_submission_deadline || ""}
          onChange={(v) => setEligibility({ claims_submission_deadline: v || undefined })}
        />
      </div>

      <RawJsonToggle
        label="eligibility_requirements jsonb"
        value={contract.eligibility_requirements}
        onChange={(parsed) => set("eligibility_requirements")(parsed)}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Section D: Measures
// ═══════════════════════════════════════════════════════════════════════════
function MeasuresSection({ contract, measures, setMeasures, measureCatalog }) {
  const measurementPeriods = (contract.payment_methodology?.measurement_periods) || [];
  const hasMultiMP = contract.program_type === "fee_inflator" && measurementPeriods.length > 0;

  // AMH Measure Set constraint: NC requires VBP contracts offered to AMH
  // practices by Standard Plans to include ONLY measures from the AMH
  // Measure Set for the contract's measurement year. The picker dropdown
  // is filtered to AMH-set measures by default. The override toggle below
  // is for future NC flexibility - leave OFF unless your Plan has confirmed
  // the contract may include non-AMH measures.
  const [allowNonAmh, setAllowNonAmh] = useState(false);
  const my = parseInt(contract.measurement_year, 10) || new Date().getFullYear();

  // Annotate each catalog entry with whether it's in the AMH set for this MY.
  // amh_measure_set_year is an integer array column on cm_hedis_measures.
  const annotatedCatalog = useMemo(
    () => (measureCatalog || []).map(c => ({
      ...c,
      in_amh_set_for_my:
        Array.isArray(c.amh_measure_set_year) && c.amh_measure_set_year.includes(my),
    })),
    [measureCatalog, my]
  );

  // Picker shows AMH-set only by default; full catalog when override is ON.
  const pickerCatalog = useMemo(
    () => allowNonAmh ? annotatedCatalog : annotatedCatalog.filter(c => c.in_amh_set_for_my),
    [annotatedCatalog, allowNonAmh]
  );

  // Detect legacy rows: an existing measure_code in the form NOT in the AMH
  // set for the contract's MY. Surfaces a single banner so users know their
  // contract has measures outside current NC policy. We do NOT auto-strip -
  // that's the user's decision and may require Plan dialogue.
  const nonAmhRowCount = useMemo(() => {
    if (!measures.length) return 0;
    const amhCodes = new Set(
      annotatedCatalog.filter(c => c.in_amh_set_for_my).map(c => c.measure_code)
    );
    return measures.filter(m => m.measure_code && !amhCodes.has(m.measure_code)).length;
  }, [measures, annotatedCatalog]);

  // Adding a new measure: if multi-MP, default to first MP. If multi-MP and
  // user picks an existing measure code, we don't auto-clone - admins should
  // intentionally duplicate the row per MP.
  const addMeasure = () => {
    setMeasures(prev => [...prev, {
      _key: Math.random().toString(36).slice(2),
      measure_code: "",
      target_type: "rate",
      target_value: "",
      target_unit: "percent",
      weight: contract.program_type === "qrt_gate" ? 1 : null,
      denominator_min: "",
      status: "Active",
      measurement_period_label: hasMultiMP ? (measurementPeriods[0]?.label || "MP1") : null,
      payment_rule: defaultPaymentRule(contract.program_type),
      notes: "",
    }]);
  };

  const removeMeasure = (i) => setMeasures(prev => prev.filter((_, idx) => idx !== i));

  const updateMeasure = (i, patch) => {
    setMeasures(prev => prev.map((m, idx) => idx === i ? { ...m, ...patch } : m));
  };

  const duplicateForMP = (i) => {
    const orig = measures[i];
    setMeasures(prev => [...prev, {
      ...orig,
      _key: Math.random().toString(36).slice(2),
      id: undefined,  // new row on save
      measurement_period_label: "",  // user picks the new MP
    }]);
  };

  return (
    <div>
      <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 10, lineHeight: 1.55 }}>
        Measures included in this contract. Each row is a (measure × MP) combination - for multi-MP contracts, duplicate the row per MP and set different targets/payment rules.
        {contract.program_type === "qrt_gate" && " Weight is used for the quality rating threshold calculation."}
      </div>

      {/* AMH Measure Set constraint controls. Default: dropdown filtered to */}
      {/* the contract's MY's AMH set. Toggle ON only with NC-approved      */}
      {/* flexibility (rare under current policy).                          */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        padding: "8px 12px", marginBottom: 12,
        background: C.bgSecondary, borderRadius: 6,
      }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.textPrimary }}>
          <input
            type="checkbox"
            checked={allowNonAmh}
            onChange={e => setAllowNonAmh(e.target.checked)}
          />
          Include measures outside the AMH Measure Set (NC flexibility)
        </label>
        <span style={{ fontSize: 11, color: C.textTertiary, flex: 1, minWidth: 220 }}>
          Default: picker shows only measures in the AMH Measure Set for MY {my}.
        </span>
      </div>

      {nonAmhRowCount > 0 && (
        <div style={{
          padding: "10px 12px", marginBottom: 12,
          background: C.amberBg, border: "0.5px solid " + C.amber, borderRadius: 6,
          fontSize: 12, color: C.textPrimary, lineHeight: 1.55,
        }}>
          <strong>{nonAmhRowCount} measure{nonAmhRowCount === 1 ? " is" : "s are"} outside the AMH Measure Set for MY {my}.</strong> NC policy requires AMH VBP contracts to use only AMH Measure Set measures unless the Health Plan has confirmed flexibility. Review with your Plan before activating this contract.
        </div>
      )}

      {measures.length === 0 ? (
        <div style={{ fontSize: 12, color: C.textTertiary, fontStyle: "italic", padding: 20, textAlign: "center", border: "0.5px dashed " + C.borderLight, borderRadius: 6, marginBottom: 12 }}>
          No measures yet. Click "+ Add measure" below.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 12 }}>
          {measures.map((m, i) => (
            <MeasureRow
              key={m._key || m.id || i}
              measure={m}
              measureCatalog={annotatedCatalog}
              pickerCatalog={pickerCatalog}
              programType={contract.program_type}
              measurementPeriods={measurementPeriods}
              onUpdate={(patch) => updateMeasure(i, patch)}
              onRemove={() => removeMeasure(i)}
              onDuplicateForMP={hasMultiMP ? () => duplicateForMP(i) : null}
            />
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <Btn size="sm" variant="primary" onClick={addMeasure}>+ Add measure</Btn>
      </div>
    </div>
  );
}

function MeasureRow({ measure, measureCatalog, pickerCatalog, programType, measurementPeriods, onUpdate, onRemove, onDuplicateForMP }) {
  const [expanded, setExpanded] = useState(!measure.measure_code);  // expand new rows
  const m = measure;
  // measureCatalog = full annotated catalog (used for name lookup so legacy
  // non-AMH measure rows still render their measure_name).
  // pickerCatalog  = filtered catalog for the dropdown (AMH-set only by
  // default, full catalog when MeasuresSection's "Include non-AMH" toggle
  // is on).
  const cat = measureCatalog.find(c => c.measure_code === m.measure_code);
  // True when this row references a measure NOT in the AMH set for the
  // contract's MY. Drives an inline "Non-AMH" pill in the row header.
  const isNonAmhRow = !!(cat && cat.in_amh_set_for_my === false);

  return (
    <div style={{
      border: "0.5px solid " + C.borderLight,
      borderRadius: 8,
      overflow: "hidden",
      background: "#fff",
    }}>
      {/* Compact header always visible */}
      <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", background: C.bgSecondary }}>
        <button
          onClick={() => setExpanded(e => !e)}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: C.textSecondary, padding: 0 }}
        >
          {expanded ? "−" : "+"}
        </button>
        <div style={{ flex: 1, minWidth: 240 }}>
          {m.measure_code ? (
            <>
              <code style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: C.teal }}>{m.measure_code}</code>
              {cat && <span style={{ marginLeft: 8, fontSize: 12, color: C.textPrimary }}>{cat.measure_name}</span>}
              {cat?.classification_status === "unknown" && <span style={{ marginLeft: 8 }}><Badge label="Unknown" variant="amber" size="xs" /></span>}
              {isNonAmhRow && <span style={{ marginLeft: 8 }}><Badge label="Non-AMH" variant="amber" size="xs" /></span>}
              {m.measurement_period_label && <span style={{ marginLeft: 8 }}><Badge label={m.measurement_period_label} variant="blue" size="xs" /></span>}
            </>
          ) : (
            <span style={{ fontSize: 12, color: C.textTertiary, fontStyle: "italic" }}>(new measure - pick a code)</span>
          )}
        </div>
        <div style={{ fontSize: 11, color: C.textSecondary }}>
          {m.target_type}{m.target_value !== "" && m.target_value !== null && m.target_value !== undefined ? " / " + m.target_value : ""}
        </div>
        {onDuplicateForMP && (
          <Btn size="sm" variant="ghost" onClick={onDuplicateForMP}>Duplicate for MP</Btn>
        )}
        <Btn size="sm" variant="ghost" onClick={onRemove}>Remove</Btn>
      </div>

      {expanded && (
        <div style={{ padding: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <FL>Measure code *</FL>
              <select
                value={m.measure_code}
                onChange={e => onUpdate({ measure_code: e.target.value })}
                style={selectStyle}
              >
                <option value="">Pick a measure...</option>
                {/* Legacy fallback: if this row's measure_code is NOT in the */}
                {/* picker (e.g. non-AMH legacy with override OFF), keep it  */}
                {/* visible so the select doesn't silently drop the value.  */}
                {m.measure_code && !pickerCatalog.some(c => c.measure_code === m.measure_code) && cat ? (
                  <option key={"_legacy_" + cat.measure_code} value={cat.measure_code}>
                    {cat.measure_code} - {cat.measure_name} [Non-AMH, locked]
                  </option>
                ) : null}
                {pickerCatalog.map(c => (
                  <option key={c.measure_code} value={c.measure_code}>
                    {c.measure_code} - {c.measure_name}
                    {c.classification_status === "unknown" ? " [Unknown]" : ""}
                    {c.in_amh_set_for_my === false ? " [Non-AMH]" : ""}
                  </option>
                ))}
              </select>
            </div>
            <Select
              label="Target type *"
              value={m.target_type}
              onChange={(v) => onUpdate({ target_type: v })}
              options={TARGET_TYPES.map(t => t.value)}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
            <Input label="Target value" type="number" value={m.target_value ?? ""} onChange={v => onUpdate({ target_value: v })} placeholder="75" />
            <Input label="Unit" value={m.target_unit ?? ""} onChange={v => onUpdate({ target_unit: v })} placeholder="percent" />
            {programType === "qrt_gate" && (
              <Input label="Weight" type="number" value={m.weight ?? ""} onChange={v => onUpdate({ weight: v })} placeholder="1" />
            )}
            <Input label="Denom min" type="number" value={m.denominator_min ?? ""} onChange={v => onUpdate({ denominator_min: v })} placeholder="30" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Select
              label="Status"
              value={m.status || "Active"}
              onChange={(v) => onUpdate({ status: v })}
              options={MEASURE_STATUSES.map(s => s.value)}
            />
            {measurementPeriods.length > 0 ? (
              <Select
                label="Measurement period"
                value={m.measurement_period_label || ""}
                onChange={(v) => onUpdate({ measurement_period_label: v })}
                options={["", ...measurementPeriods.map(mp => mp.label).filter(Boolean)]}
              />
            ) : (
              <Input label="Measurement period label (optional)" value={m.measurement_period_label || ""} onChange={(v) => onUpdate({ measurement_period_label: v })} placeholder='Leave blank unless multi-MP' />
            )}
          </div>

          {/* Per-measure payment rule subform */}
          <div style={{ marginTop: 14, padding: 14, background: C.tealBg, borderRadius: 6, border: "0.5px solid " + C.tealBorder }}>
            <FL>Payment rule (per-measure)</FL>
            <PaymentRuleSubform
              programType={programType}
              paymentRule={m.payment_rule || {}}
              onUpdate={(rule) => onUpdate({ payment_rule: rule })}
            />
          </div>

          <Textarea label="Measure notes" value={m.notes || ""} onChange={(v) => onUpdate({ notes: v })} rows={1} placeholder="Optional context about this measure's terms" />
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PaymentRuleSubform - per-measure payment_rule editor, adapts on programType
// ═══════════════════════════════════════════════════════════════════════════
function PaymentRuleSubform({ programType, paymentRule, onUpdate }) {
  const setRule = (patch) => onUpdate({ ...(paymentRule || {}), ...patch });

  // For per_gap_closure: { model: "per_gap", amount, high_priority_amount? }
  if (programType === "per_gap_closure") {
    return (
      <div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Input label="Amount per closed gap ($)" type="number" value={paymentRule.amount ?? ""} onChange={(v) => setRule({ model: "per_gap", amount: v === "" ? undefined : parseFloat(v) })} placeholder="250" />
          <Input label="High Priority amount ($, optional)" type="number" value={paymentRule.high_priority_amount ?? ""} onChange={(v) => setRule({ model: "per_gap", high_priority_amount: v === "" ? undefined : parseFloat(v) })} placeholder="500" />
        </div>
        <RawJsonToggle label="payment_rule jsonb" value={paymentRule} onChange={onUpdate} />
      </div>
    );
  }

  // For per_gap_tiered: { model: "per_gap_tiered", tiers: [...], minimum_threshold?: {...} }
  if (programType === "per_gap_tiered") {
    return <PerGapTieredRule paymentRule={paymentRule} onUpdate={onUpdate} />;
  }

  // For qrt_gate: { model: "weighted_benchmark", weight, benchmark_pct, primary_data_source }
  if (programType === "qrt_gate") {
    return (
      <div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Input label="Benchmark % (target)" type="number" value={paymentRule.benchmark_pct ?? ""} onChange={(v) => setRule({ model: "weighted_benchmark", benchmark_pct: v === "" ? undefined : parseFloat(v) })} placeholder="44.47" />
          <Input label="Weight (points)" type="number" value={paymentRule.weight ?? ""} onChange={(v) => setRule({ model: "weighted_benchmark", weight: v === "" ? undefined : parseFloat(v) })} placeholder="1" />
        </div>
        <Input label="Primary data source" value={paymentRule.primary_data_source ?? ""} onChange={(v) => setRule({ model: "weighted_benchmark", primary_data_source: v || undefined })} placeholder='e.g. "Claims, Flat File, Medical Record Review"' />
        <RawJsonToggle label="payment_rule jsonb" value={paymentRule} onChange={onUpdate} />
      </div>
    );
  }

  // For shared_savings_pool: { model: "improvement_points", baseline_pct, tiers: [...] }
  if (programType === "shared_savings_pool") {
    return <SharedSavingsRule paymentRule={paymentRule} onUpdate={onUpdate} />;
  }

  // For fee_inflator: { model: "fee_inflator", adjustment_pct, applies_to? }
  if (programType === "fee_inflator") {
    return (
      <div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Input label="Rate adjustment (%) when target met" type="number" value={paymentRule.adjustment_pct ?? ""} onChange={(v) => setRule({ model: "fee_inflator", adjustment_pct: v === "" ? undefined : parseFloat(v) })} placeholder="2.0" />
          <Input label="Applies to (override)" value={paymentRule.applies_to ?? ""} onChange={(v) => setRule({ model: "fee_inflator", applies_to: v || undefined })} placeholder="primary_payment_appendix" />
        </div>
        <RawJsonToggle label="payment_rule jsonb" value={paymentRule} onChange={onUpdate} />
      </div>
    );
  }

  // For hybrid / other / unset: just raw JSON
  return (
    <div>
      <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 8 }}>
        {programType ? "This program type uses arbitrary payment rules. Define the structure in JSON below." : "Set the contract's program type in the Payment section to get a structured form."}
      </div>
      <RawJsonToggle label="payment_rule jsonb" value={paymentRule} onChange={onUpdate} initiallyOpen={true} />
    </div>
  );
}

function PerGapTieredRule({ paymentRule, onUpdate }) {
  const tiers = paymentRule.tiers || [];
  const minThresh = paymentRule.minimum_threshold || null;
  const update = (patch) => onUpdate({ ...paymentRule, model: "per_gap_tiered", ...patch });

  const addTier = () => update({ tiers: [...tiers, { tier: tiers.length + 1, target_pct: 0, amount: 0, hp_amount: 0 }] });
  const removeTier = (i) => update({ tiers: tiers.filter((_, idx) => idx !== i) });
  const updateTier = (i, field, value) => {
    update({ tiers: tiers.map((t, idx) => idx === i ? { ...t, [field]: value === "" ? undefined : parseFloat(value) } : t) });
  };

  return (
    <div>
      <FL>Tiers (each tier defines a target % and payout if reached)</FL>
      {tiers.length === 0 ? (
        <div style={{ fontSize: 11, color: C.textTertiary, fontStyle: "italic", marginBottom: 8 }}>No tiers yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
          {tiers.map((t, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "60px 1fr 1fr 1fr auto", gap: 8, alignItems: "end" }}>
              <Input label={i === 0 ? "Tier" : ""} type="number" value={t.tier ?? i + 1} onChange={(v) => updateTier(i, "tier", v)} />
              <Input label={i === 0 ? "Target %" : ""} type="number" value={t.target_pct ?? ""} onChange={(v) => updateTier(i, "target_pct", v)} placeholder="65" />
              <Input label={i === 0 ? "Amount $" : ""} type="number" value={t.amount ?? ""} onChange={(v) => updateTier(i, "amount", v)} placeholder="15" />
              <Input label={i === 0 ? "HP amount $" : ""} type="number" value={t.hp_amount ?? ""} onChange={(v) => updateTier(i, "hp_amount", v)} placeholder="30" />
              <Btn size="sm" variant="ghost" onClick={() => removeTier(i)}>Remove</Btn>
            </div>
          ))}
        </div>
      )}
      <Btn size="sm" variant="outline" onClick={addTier}>+ Add tier</Btn>

      <div style={{ marginTop: 16, paddingTop: 12, borderTop: "0.5px dashed " + C.borderLight }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.textPrimary, marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={!!minThresh}
            onChange={(e) => update({ minimum_threshold: e.target.checked ? { improvement_pp: 3, amount: 5, hp_amount: 10 } : null })}
          />
          Has minimum threshold improvement fallback (paid even when no tier reached)
        </label>
        {minThresh && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, paddingLeft: 24 }}>
            <Input label="Improvement (pp)" type="number" value={minThresh.improvement_pp ?? ""} onChange={(v) => update({ minimum_threshold: { ...minThresh, improvement_pp: v === "" ? undefined : parseFloat(v) } })} placeholder="3" />
            <Input label="Amount $" type="number" value={minThresh.amount ?? ""} onChange={(v) => update({ minimum_threshold: { ...minThresh, amount: v === "" ? undefined : parseFloat(v) } })} placeholder="5" />
            <Input label="HP amount $" type="number" value={minThresh.hp_amount ?? ""} onChange={(v) => update({ minimum_threshold: { ...minThresh, hp_amount: v === "" ? undefined : parseFloat(v) } })} placeholder="10" />
          </div>
        )}
      </div>

      <RawJsonToggle label="payment_rule jsonb" value={paymentRule} onChange={onUpdate} />
    </div>
  );
}

function SharedSavingsRule({ paymentRule, onUpdate }) {
  const tiers = paymentRule.tiers || [];
  const update = (patch) => onUpdate({ ...paymentRule, model: "improvement_points", ...patch });

  const addTier = () => update({ tiers: [...tiers, { improvement_pp: 0, points: 0 }] });
  const removeTier = (i) => update({ tiers: tiers.filter((_, idx) => idx !== i) });
  const updateTier = (i, field, value) => {
    update({ tiers: tiers.map((t, idx) => idx === i ? { ...t, [field]: value === "" ? undefined : parseFloat(value) } : t) });
  };

  return (
    <div>
      <Input label="Baseline %" type="number" value={paymentRule.baseline_pct ?? ""} onChange={(v) => update({ baseline_pct: v === "" ? undefined : parseFloat(v) })} placeholder="42.5" />
      <FL>Improvement tiers (each tier earns points toward shared savings pool)</FL>
      {tiers.length === 0 ? (
        <div style={{ fontSize: 11, color: C.textTertiary, fontStyle: "italic", marginBottom: 8 }}>No improvement tiers yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
          {tiers.map((t, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, alignItems: "end" }}>
              <Input label={i === 0 ? "Improvement (pp)" : ""} type="number" value={t.improvement_pp ?? ""} onChange={(v) => updateTier(i, "improvement_pp", v)} placeholder="5" />
              <Input label={i === 0 ? "Points" : ""} type="number" value={t.points ?? ""} onChange={(v) => updateTier(i, "points", v)} placeholder="0.5" />
              <Btn size="sm" variant="ghost" onClick={() => removeTier(i)}>Remove</Btn>
            </div>
          ))}
        </div>
      )}
      <Btn size="sm" variant="outline" onClick={addTier}>+ Add improvement tier</Btn>

      <RawJsonToggle label="payment_rule jsonb" value={paymentRule} onChange={onUpdate} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// RawJsonToggle - the universal escape hatch. Click to toggle a textarea
// showing the current jsonb. On valid JSON, calls onChange with parsed value.
// On invalid JSON, shows inline error and doesn't propagate.
// ═══════════════════════════════════════════════════════════════════════════
function RawJsonToggle({ label, value, onChange, initiallyOpen = false }) {
  const [open, setOpen] = useState(initiallyOpen);
  const [text, setText] = useState(() => JSON.stringify(value || {}, null, 2));
  const [parseError, setParseError] = useState(null);

  // Re-sync from prop when it changes externally (e.g., structured form edits
  // a field, this textarea should reflect the new value).
  useEffect(() => {
    if (!open) {
      setText(JSON.stringify(value || {}, null, 2));
      setParseError(null);
    }
  }, [value, open]);

  const handleChange = (newText) => {
    setText(newText);
    if (!newText.trim()) {
      setParseError(null);
      onChange(null);
      return;
    }
    try {
      const parsed = JSON.parse(newText);
      setParseError(null);
      onChange(parsed);
    } catch (e) {
      setParseError(e.message);
    }
  };

  return (
    <div style={{ marginTop: 10 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background: "transparent", border: "none", cursor: "pointer",
          fontSize: 11, color: C.textSecondary, fontFamily: "inherit", padding: 0,
          textDecoration: "underline",
        }}
      >
        {open ? "Hide" : "Show"} raw {label}
      </button>
      {open && (
        <div style={{ marginTop: 8 }}>
          <textarea
            value={text}
            onChange={e => handleChange(e.target.value)}
            rows={8}
            style={{
              ...inputStyle,
              fontFamily: "monospace", fontSize: 11,
              padding: 10, lineHeight: 1.5,
              resize: "vertical",
            }}
          />
          {parseError && (
            <div style={{ fontSize: 11, color: C.red, marginTop: 4 }}>
              JSON parse error: {parseError}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function emptyContract() {
  return {
    payer_short_name: "",
    measurement_year: new Date().getFullYear(),
    contract_label: "",
    contract_type: "",
    program_type: null,
    hcp_lan_category: null,
    effective_start: "",
    effective_end: "",
    status: "Draft",
    payment_methodology: null,
    eligibility_requirements: null,
    notes_payment_methodology: "",
    notes: "",
  };
}

function defaultPaymentRule(programType) {
  switch (programType) {
    case "per_gap_closure":     return { model: "per_gap" };
    case "per_gap_tiered":      return { model: "per_gap_tiered", tiers: [] };
    case "qrt_gate":            return { model: "weighted_benchmark", weight: 1 };
    case "shared_savings_pool": return { model: "improvement_points", tiers: [] };
    case "fee_inflator":        return { model: "fee_inflator" };
    default:                    return null;
  }
}
