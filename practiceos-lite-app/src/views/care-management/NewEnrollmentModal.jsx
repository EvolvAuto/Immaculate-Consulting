import { useState, useEffect, useMemo } from "react";
import { supabase } from "../../lib/supabaseClient";
import { C } from "../../lib/tokens";
import { Btn, Modal, Loader, ErrorBanner, FL } from "../../components/ui";
import { PLAN_PROGRAM_MATRIX, validatePlanProgramProvider } from "../../lib/cmCadence";
import { inputStyle, selectStyle, ALL_PROGRAM_TYPES, ALL_PROVIDER_TYPES } from "./shared";

// ===============================================================================
// NewEnrollmentModal - create a new Care Management enrollment from scratch.
//
// Enforces the plan/program/provider validation matrix from cmCadence
// (Tailored Plan -> TCM via AMH+/CMA/CIN, Standard Plan -> AMH via
// AMH Tier 3/CIN, Other -> no constraint). Override checkbox exists for
// edge cases - plan transitions, dual enrollment, legacy data - and
// surfaces a warning banner when active.
//
// Auto-populates payer / plan_member_id / health_plan_type from the
// patient's rank=1 active insurance policy on selection. Duplicate-check
// warns before save if an Active enrollment already exists for the
// (patient, program) pair.
// ===============================================================================

export default function NewEnrollmentModal({ practiceId, userId, onClose, onCreated }) {
  const [patients, setPatients]           = useState([]);
  const [existing, setExisting]           = useState([]);
  const [careManagers, setCareManagers]   = useState([]);
  const [loading, setLoading]             = useState(true);

  // Form state
  const [patientSearch, setPatientSearch] = useState("");
  const [patientId, setPatientId]         = useState("");
  const [planType, setPlanType]           = useState("");
  const [programType, setProgramType]     = useState("");
  const [providerType, setProviderType]   = useState("");
  const [allowOverride, setAllowOverride] = useState(false);
  const [payerName, setPayerName]         = useState("");
  const [planMemberId, setPlanMemberId]   = useState("");
  const [acuityTier, setAcuityTier]       = useState("");
  const [status, setStatus]               = useState("Pending");
  const [enrolledAt, setEnrolledAt]       = useState(() => new Date().toISOString().split("T")[0]);
  const [assignedCM, setAssignedCM]       = useState("");
  const [hopEligible, setHopEligible]     = useState(false);
  const [notes, setNotes]                 = useState("");

  const [saving, setSaving]               = useState(false);
  const [error, setError]                 = useState(null);
  const [autoFilledFrom, setAutoFilledFrom] = useState("");

  // Load lookup data in parallel
  useEffect(() => {
    if (!practiceId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      supabase
        .from("patients")
        .select("id, first_name, last_name, mrn, date_of_birth")
        .eq("practice_id", practiceId)
        .order("last_name", { ascending: true })
        .limit(2000),
      supabase
        .from("cm_enrollments")
        .select("patient_id, program_type, enrollment_status")
        .eq("practice_id", practiceId)
        .eq("enrollment_status", "Active"),
      supabase
        .from("users")
        .select("id, full_name, role")
        .eq("practice_id", practiceId)
        .in("role", ["Care Manager", "Supervising Care Manager", "Care Manager Supervisor"])
        .order("full_name", { ascending: true }),
    ]).then(([pRes, eRes, cmRes]) => {
      if (cancelled) return;
      setPatients(pRes.data || []);
      setExisting(eRes.data || []);
      setCareManagers(cmRes.data || []);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [practiceId]);

  // Cascade: when plan type changes, auto-set program and reset provider
  // if the current provider is no longer valid for the new plan.
  useEffect(() => {
    if (!planType) return;
    const rule = PLAN_PROGRAM_MATRIX[planType];
    if (!rule) return;
    // Auto-set program_type when rule has a canonical program
    if (rule.program) {
      setProgramType(rule.program);
    }
    // Clear provider if not in the allowed set (unless override active)
    if (rule.providers && providerType && !allowOverride && !rule.providers.includes(providerType)) {
      setProviderType("");
    }
    // Clear acuity if moving to Standard or Other (acuity only meaningful for Tailored)
    if (planType !== "Tailored Plan") {
      setAcuityTier("");
    }
  }, [planType]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-populate from patient insurance when a patient is selected.
  //
  // Pulls rank=1 active insurance policy and:
  //   - Pre-fills payer_name + plan_member_id (if those fields are empty)
  //   - Derives health_plan_type from payer_category:
  //       "NC Medicaid - Tailored"  -> "Tailored Plan"
  //       "NC Medicaid - Standard"  -> "Standard Plan"
  //       anything else             -> left null (user picks)
  //   - Program type cascades automatically via the plan-cascade useEffect
  //
  // Only fills empty fields - won't clobber anything the user already typed.
  // Shows a small info banner so the user knows auto-fill happened.
  useEffect(() => {
    if (!patientId) { setAutoFilledFrom(""); return; }
    let cancelled = false;
    supabase
      .from("insurance_policies")
      .select("payer_category, payer_name, member_id")
      .eq("patient_id", patientId)
      .eq("is_active", true)
      .order("rank", { ascending: true })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return;
        if (!payerName.trim())    setPayerName(data.payer_name || "");
        if (!planMemberId.trim()) setPlanMemberId(data.member_id || "");
        if (!planType) {
          if (data.payer_category === "NC Medicaid - Tailored")      setPlanType("Tailored Plan");
          else if (data.payer_category === "NC Medicaid - Standard") setPlanType("Standard Plan");
        }
        setAutoFilledFrom(data.payer_name || "insurance on file");
      });
    return () => { cancelled = true; };
  }, [patientId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Patient search filtering
  const patientMatches = useMemo(() => {
    if (!patientSearch.trim()) return patients.slice(0, 25);
    const q = patientSearch.trim().toLowerCase();
    return patients.filter(p => {
      const name = ((p.first_name || "") + " " + (p.last_name || "")).toLowerCase();
      const mrn  = (p.mrn || "").toLowerCase();
      return name.includes(q) || mrn.includes(q);
    }).slice(0, 25);
  }, [patients, patientSearch]);

  const selectedPatient = useMemo(
    () => patients.find(p => p.id === patientId) || null,
    [patients, patientId]
  );

  // Duplicate check: does this (patient, program) already have an Active?
  const duplicateWarning = useMemo(() => {
    if (!patientId || !programType) return null;
    const dup = existing.find(e => e.patient_id === patientId && e.program_type === programType);
    return dup ? "This patient already has an Active enrollment in " + programType + ". Disenroll the existing enrollment first, or pick a different program." : null;
  }, [patientId, programType, existing]);

  // Plan/program/provider validation
  const combinationWarning = useMemo(() => {
    if (allowOverride) return null;
    return validatePlanProgramProvider(planType, programType, providerType);
  }, [planType, programType, providerType, allowOverride]);

  // Which program types are valid for the chosen plan?
  const allowedPrograms = useMemo(() => {
    if (!planType || allowOverride) return ALL_PROGRAM_TYPES;
    const rule = PLAN_PROGRAM_MATRIX[planType];
    if (!rule) return ALL_PROGRAM_TYPES;
    if (rule.program) return [rule.program];
    // Other plan type: General Engagement / Other only
    return ["General Engagement", "Other"];
  }, [planType, allowOverride]);

  // Which provider types are valid for the chosen plan?
  const allowedProviders = useMemo(() => {
    if (!planType || allowOverride) return ALL_PROVIDER_TYPES;
    const rule = PLAN_PROGRAM_MATRIX[planType];
    return (rule && rule.providers) ? rule.providers : ALL_PROVIDER_TYPES;
  }, [planType, allowOverride]);

  const showAcuity = planType === "Tailored Plan" || (allowOverride && planType);

  const save = async () => {
    if (!patientId)     { setError("Pick a patient"); return; }
    if (!programType)   { setError("Pick a program type"); return; }
    if (duplicateWarning)   { setError(duplicateWarning); return; }
    if (combinationWarning) { setError(combinationWarning + " (check the override box to proceed anyway)"); return; }
    if (status === "Active" && !enrolledAt) { setError("Enrolled date required for Active status"); return; }

    setSaving(true);
    setError(null);

    const nowIso = new Date().toISOString();
    const payload = {
      practice_id:       practiceId,
      patient_id:        patientId,
      program_type:      programType,
      enrollment_status: status,
      created_by:        userId || null,
    };
    if (planType)         payload.health_plan_type = planType;
    if (providerType)     payload.cm_provider_type = providerType;
    if (payerName.trim())    payload.payer_name     = payerName.trim();
    if (planMemberId.trim()) payload.plan_member_id = planMemberId.trim();
    if (showAcuity && acuityTier) {
      payload.acuity_tier         = acuityTier;
      payload.acuity_tier_set_at  = nowIso;
      payload.acuity_tier_set_by  = userId || null;
    }
    if (status === "Active" && enrolledAt) {
      payload.enrolled_at = new Date(enrolledAt + "T12:00:00Z").toISOString();
    }
    if (assignedCM) {
      payload.assigned_care_manager_id = assignedCM;
      payload.assigned_at              = nowIso;
    }
    if (hopEligible) payload.hop_eligible = true;
    if (notes.trim())  payload.notes = notes.trim();

    try {
      const { error: insErr } = await supabase.from("cm_enrollments").insert(payload);
      if (insErr) throw insErr;
      onCreated();
    } catch (e) {
      setError(e.message || "Failed to create enrollment");
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Modal title="New enrollment" onClose={onClose} width={760}>
        <Loader label="Loading practice patients..." />
      </Modal>
    );
  }

  return (
    <Modal title="New enrollment" onClose={onClose} width={760}>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {/* Patient picker */}
        <div style={{ gridColumn: "1 / -1" }}>
          <FL>Patient</FL>
          {selectedPatient ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", border: "0.5px solid " + C.borderLight, borderRadius: 8, background: C.bgSecondary }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary }}>
                  {selectedPatient.last_name}, {selectedPatient.first_name}
                </div>
                <div style={{ fontSize: 11, color: C.textTertiary, fontFamily: "monospace", marginTop: 2 }}>
                  {selectedPatient.mrn || "no MRN"}
                  {selectedPatient.date_of_birth ? " | DOB " + new Date(selectedPatient.date_of_birth).toLocaleDateString() : ""}
                </div>
              </div>
              <Btn size="sm" variant="outline" onClick={() => { setPatientId(""); setPatientSearch(""); setAutoFilledFrom(""); }}>
                Change
              </Btn>
            </div>
          ) : (
            <div>
              <input
                type="text"
                value={patientSearch}
                onChange={e => setPatientSearch(e.target.value)}
                placeholder="Search by name or MRN..."
                style={{ ...inputStyle, width: "100%" }}
              />
              {patientSearch.trim() && (
                <div style={{ marginTop: 6, maxHeight: 180, overflow: "auto", border: "0.5px solid " + C.borderLight, borderRadius: 8 }}>
                  {patientMatches.length === 0 ? (
                    <div style={{ padding: 12, fontSize: 12, color: C.textTertiary, textAlign: "center" }}>
                      No patients match "{patientSearch}"
                    </div>
                  ) : patientMatches.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => { setPatientId(p.id); setPatientSearch(""); }}
                      style={{
                        display: "block", width: "100%", textAlign: "left",
                        padding: "8px 12px", border: "none",
                        borderBottom: "0.5px solid " + C.borderLight,
                        background: C.bgPrimary, cursor: "pointer",
                        fontFamily: "inherit", fontSize: 13,
                      }}
                    >
                      <div style={{ fontWeight: 600, color: C.textPrimary }}>
                        {p.last_name}, {p.first_name}
                      </div>
                      <div style={{ fontSize: 11, color: C.textTertiary, fontFamily: "monospace" }}>
                        {p.mrn || "no MRN"}
                        {p.date_of_birth ? " | DOB " + new Date(p.date_of_birth).toLocaleDateString() : ""}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {autoFilledFrom && (
          <div style={{ gridColumn: "1 / -1", padding: "8px 12px", background: C.bgSecondary, border: "0.5px solid " + C.borderLight, borderRadius: 8, fontSize: 12, color: C.textSecondary }}>
            <strong>Auto-filled</strong> payer, plan type, and member ID from {autoFilledFrom} on file. Edit any field to override.
          </div>
        )}

        {/* Plan type picker - drives program + provider cascades */}
        <div>
          <FL>Health plan type</FL>
          <select value={planType} onChange={e => setPlanType(e.target.value)} style={selectStyle}>
            <option value="">-- Select plan type --</option>
            <option value="Tailored Plan">Tailored Plan (TCM universe)</option>
            <option value="Standard Plan">Standard Plan (AMH universe)</option>
            <option value="Other">Other / Not applicable</option>
          </select>
          {planType && PLAN_PROGRAM_MATRIX[planType] && PLAN_PROGRAM_MATRIX[planType].program && !allowOverride && (
            <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 4 }}>
              Program auto-set to {PLAN_PROGRAM_MATRIX[planType].program}
            </div>
          )}
        </div>

        <div>
          <FL>Program type</FL>
          <select value={programType} onChange={e => setProgramType(e.target.value)} style={selectStyle}>
            <option value="">-- Select program --</option>
            {allowedPrograms.map(pt => (
              <option key={pt} value={pt}>{pt}</option>
            ))}
          </select>
        </div>

        <div>
          <FL>CM provider type</FL>
          <select value={providerType} onChange={e => setProviderType(e.target.value)} style={selectStyle}>
            <option value="">-- Select provider --</option>
            {allowedProviders.map(pt => (
              <option key={pt} value={pt}>{pt}</option>
            ))}
          </select>
          {planType === "Tailored Plan" && !allowOverride && (
            <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 4 }}>
              Tailored Plan: AMH+, CMA, or CIN
            </div>
          )}
          {planType === "Standard Plan" && !allowOverride && (
            <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 4 }}>
              Standard Plan: AMH Tier 3 or CIN
            </div>
          )}
        </div>

        <div>
          <FL>Initial status</FL>
          <select value={status} onChange={e => setStatus(e.target.value)} style={selectStyle}>
            <option value="Pending">Pending (outreach not started)</option>
            <option value="Active">Active (consented + engaged)</option>
            <option value="On Hold">On Hold</option>
          </select>
        </div>

        {/* Override checkbox - gates the plan/program/provider validation */}
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.textSecondary, cursor: "pointer", padding: "6px 10px", background: allowOverride ? C.amberBg : "transparent", border: "0.5px solid " + (allowOverride ? C.amberBorder : C.borderLight), borderRadius: 8 }}>
            <input type="checkbox" checked={allowOverride} onChange={e => setAllowOverride(e.target.checked)} />
            <div>
              <strong>Allow nonstandard plan/program/provider combination</strong>
              <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 1 }}>
                Override the validation matrix. Use only for plan transitions, dual enrollment, or legacy data - document the reason in the notes field.
              </div>
            </div>
          </label>
        </div>

        <div>
          <FL>Payer name (optional)</FL>
          <input
            type="text"
            value={payerName}
            onChange={e => setPayerName(e.target.value)}
            placeholder="e.g. Vaya Health, Alliance Health"
            style={inputStyle}
          />
        </div>

        <div>
          <FL>Plan member ID / CNDS (optional)</FL>
          <input
            type="text"
            value={planMemberId}
            onChange={e => setPlanMemberId(e.target.value)}
            placeholder="e.g. 944HG128X2"
            style={{ ...inputStyle, fontFamily: "monospace" }}
          />
        </div>

        {showAcuity && (
          <div>
            <FL>Acuity tier (Tailored Plan / TCM only)</FL>
            <select value={acuityTier} onChange={e => setAcuityTier(e.target.value)} style={selectStyle}>
              <option value="">-- Not yet set --</option>
              <option value="High">High</option>
              <option value="Moderate">Moderate</option>
              <option value="Low">Low</option>
            </select>
          </div>
        )}

        <div>
          <FL>Assigned care manager (optional)</FL>
          <select value={assignedCM} onChange={e => setAssignedCM(e.target.value)} style={selectStyle}>
            <option value="">-- Unassigned --</option>
            {careManagers.map(cm => (
              <option key={cm.id} value={cm.id}>{cm.full_name} ({cm.role})</option>
            ))}
          </select>
        </div>

        {status === "Active" && (
          <div>
            <FL>Enrolled date</FL>
            <input
              type="date"
              value={enrolledAt}
              onChange={e => setEnrolledAt(e.target.value)}
              style={inputStyle}
            />
          </div>
        )}

        <div style={{ gridColumn: "1 / -1" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "8px 0" }}>
            <input type="checkbox" checked={hopEligible} onChange={e => setHopEligible(e.target.checked)} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>
                HOP eligible
              </div>
              <div style={{ fontSize: 11, color: C.textSecondary, marginTop: 2 }}>
                Patient is eligible for Healthy Opportunities Pilot HRSN interventions. HOP active can be toggled later based on interventions.
              </div>
            </div>
          </label>
        </div>

        <div style={{ gridColumn: "1 / -1" }}>
          <FL>Notes (optional)</FL>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            placeholder="Referral source, outreach strategy, initial clinical context..."
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </div>
      </div>

      {duplicateWarning && (
        <div style={{ marginTop: 12, padding: 12, background: C.amberBg, border: "0.5px solid " + C.amberBorder, borderRadius: 8, fontSize: 12, color: C.textPrimary }}>
          <strong>Duplicate check:</strong> {duplicateWarning}
        </div>
      )}

      {combinationWarning && (
        <div style={{ marginTop: 12, padding: 12, background: C.amberBg, border: "0.5px solid " + C.amberBorder, borderRadius: 8, fontSize: 12, color: C.textPrimary }}>
          <strong>Invalid combination:</strong> {combinationWarning}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" disabled={saving || !!duplicateWarning || !!combinationWarning} onClick={save}>
          {saving ? "Creating..." : "Create enrollment"}
        </Btn>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// EditEnrollmentForm - edit an existing enrollment.
//
// Editable: acuity_tier (with stamp), assigned_care_manager_id, health_plan_type,
// cm_provider_type, payer_name, plan_member_id, hop_eligible, hop_active, notes.
//
// NOT editable: patient_id, program_type, enrollment_status
//   (use Disenroll/Activate for status transitions; use Disenroll + new
//   enrollment for program changes so the audit trail is clean).
//
// If acuity_tier changes, stamp acuity_tier_set_at + acuity_tier_set_by.
// If assigned_care_manager_id changes, stamp assigned_at.
// ---------------------------------------------------------------------------
