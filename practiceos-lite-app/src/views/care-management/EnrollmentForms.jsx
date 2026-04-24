import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabaseClient";
import { C } from "../../lib/tokens";
import { Btn, Loader, ErrorBanner, FL } from "../../components/ui";
import { inputStyle, selectStyle, ALL_PROVIDER_TYPES } from "./shared";

// ===============================================================================
// EnrollmentForms - three small inline forms rendered by EnrollmentDetail
// when the modal transitions out of "view" mode.
//
//   EditEnrollmentForm - mutate acuity / CM / plan type / HOP / notes
//   DisenrollForm      - close an enrollment with a reason code
//   ActivateForm       - move Pending or On Hold enrollments to Active
//
// All three are rendered inside the same EnrollmentDetail modal wrapper
// rather than their own modals, so they stay compact and share the
// modal's title/close affordance.
// ===============================================================================

function EditEnrollmentForm({ enrollment, onCancel, onSaved }) {
  const [careManagers, setCareManagers] = useState([]);
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const [error, setError]               = useState(null);

  const [planType, setPlanType]         = useState(enrollment.health_plan_type || "");
  const [providerType, setProviderType] = useState(enrollment.cm_provider_type || "");
  const [acuityTier, setAcuityTier]     = useState(enrollment.acuity_tier || "");
  const [assignedCM, setAssignedCM]     = useState(enrollment.assigned_care_manager_id || "");
  const [payerName, setPayerName]       = useState(enrollment.payer_name || "");
  const [planMemberId, setPlanMemberId] = useState(enrollment.plan_member_id || "");
  const [hopEligible, setHopEligible]   = useState(!!enrollment.hop_eligible);
  const [hopActive, setHopActive]       = useState(!!enrollment.hop_active);
  const [notes, setNotes]               = useState(enrollment.notes || "");

  useEffect(() => {
    supabase
      .from("users")
      .select("id, full_name, role")
      .eq("practice_id", enrollment.practice_id)
      .in("role", ["Care Manager", "Supervising Care Manager", "Care Manager Supervisor"])
      .order("full_name", { ascending: true })
      .then(({ data }) => { setCareManagers(data || []); setLoading(false); });
  }, [enrollment.practice_id]);

  const showAcuity = planType === "Tailored Plan";

  const acuityChanged   = acuityTier   !== (enrollment.acuity_tier || "");
  const assignedChanged = assignedCM   !== (enrollment.assigned_care_manager_id || "");

  const save = async () => {
    setSaving(true);
    setError(null);

    const nowIso = new Date().toISOString();
    const patch = {
      health_plan_type: planType || null,
      cm_provider_type: providerType || null,
      acuity_tier:      (showAcuity && acuityTier) ? acuityTier : null,
      assigned_care_manager_id: assignedCM || null,
      payer_name:       payerName.trim() || null,
      plan_member_id:   planMemberId.trim() || null,
      hop_eligible:     hopEligible,
      hop_active:       hopActive,
      notes:            notes.trim() || null,
      updated_at:       nowIso,
    };

    if (acuityChanged && acuityTier) {
      patch.acuity_tier_set_at = nowIso;
      patch.acuity_tier_set_by = null;
    }
    if (assignedChanged && assignedCM) {
      patch.assigned_at = nowIso;
    }

    try {
      const { error: updErr } = await supabase
        .from("cm_enrollments")
        .update(patch)
        .eq("id", enrollment.id);
      if (updErr) throw updErr;
      onSaved();
    } catch (e) {
      setError(e.message || "Failed to save changes");
      setSaving(false);
    }
  };

  if (loading) return <Loader label="Loading..." />;

  return (
    <div>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div style={{ padding: "10px 12px", marginBottom: 16, background: C.bgSecondary, borderRadius: 8, fontSize: 12, color: C.textSecondary }}>
        Patient, program, and status cannot be changed here.
        To move a patient to a different program, disenroll and create a new enrollment.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <FL>Health plan type</FL>
          <select value={planType} onChange={e => setPlanType(e.target.value)} style={selectStyle}>
            <option value="">-- Not set --</option>
            <option value="Tailored Plan">Tailored Plan</option>
            <option value="Standard Plan">Standard Plan</option>
            <option value="Other">Other</option>
          </select>
        </div>

        <div>
          <FL>CM provider type</FL>
          <select value={providerType} onChange={e => setProviderType(e.target.value)} style={selectStyle}>
            <option value="">-- Not set --</option>
            {ALL_PROVIDER_TYPES.map(pt => (
              <option key={pt} value={pt}>{pt}</option>
            ))}
          </select>
        </div>

        <div>
          <FL>Payer name</FL>
          <input type="text" value={payerName} onChange={e => setPayerName(e.target.value)} style={inputStyle} />
        </div>

        <div>
          <FL>Plan member ID / CNDS</FL>
          <input type="text" value={planMemberId} onChange={e => setPlanMemberId(e.target.value)} style={{ ...inputStyle, fontFamily: "monospace" }} />
        </div>

        {showAcuity && (
          <div>
            <FL>Acuity tier</FL>
            <select value={acuityTier} onChange={e => setAcuityTier(e.target.value)} style={selectStyle}>
              <option value="">-- Not set --</option>
              <option value="High">High</option>
              <option value="Moderate">Moderate</option>
              <option value="Low">Low</option>
            </select>
            {acuityChanged && <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 4 }}>Will stamp new set_at timestamp</div>}
          </div>
        )}

        <div>
          <FL>Assigned care manager</FL>
          <select value={assignedCM} onChange={e => setAssignedCM(e.target.value)} style={selectStyle}>
            <option value="">-- Unassigned --</option>
            {careManagers.map(cm => (
              <option key={cm.id} value={cm.id}>{cm.full_name} ({cm.role})</option>
            ))}
          </select>
          {assignedChanged && assignedCM && <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 4 }}>Will stamp new assigned_at timestamp</div>}
        </div>

        <div style={{ gridColumn: "1 / -1", display: "flex", gap: 24 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={hopEligible} onChange={e => setHopEligible(e.target.checked)} />
            <span style={{ fontSize: 13 }}>HOP eligible</span>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={hopActive} onChange={e => setHopActive(e.target.checked)} />
            <span style={{ fontSize: 13 }}>HOP active</span>
          </label>
        </div>

        <div style={{ gridColumn: "1 / -1" }}>
          <FL>Notes</FL>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
        <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
        <Btn variant="primary" disabled={saving} onClick={save}>
          {saving ? "Saving..." : "Save changes"}
        </Btn>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DisenrollForm - disenroll an active or pending enrollment.
//
// Required: disenrollment_reason_code (from cm_reference_codes category
// 'disenrollment_reason'). Optional: notes, disenrolled_at (defaults today).
//
// Side-effects: enrollment_status -> 'Disenrolled', disenrolled_at set.
// ---------------------------------------------------------------------------

function DisenrollForm({ enrollment, onCancel, onSaved }) {
  const [reasonCodes, setReasonCodes] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState(null);

  const [reasonCode, setReasonCode]       = useState("");
  const [disenrolledAt, setDisenrolledAt] = useState(() => new Date().toISOString().split("T")[0]);
  const [notes, setNotes]                 = useState("");

  useEffect(() => {
    supabase
      .from("cm_reference_codes")
      .select("code, label, sort_order")
      .eq("category", "disenrollment_reason")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .then(({ data }) => { setReasonCodes(data || []); setLoading(false); });
  }, []);

  const save = async () => {
    if (!reasonCode) { setError("Pick a disenrollment reason"); return; }
    if (!disenrolledAt) { setError("Disenrollment date required"); return; }

    setSaving(true);
    setError(null);

    const patch = {
      enrollment_status:           "Disenrolled",
      disenrollment_reason_code:   reasonCode,
      disenrolled_at:              new Date(disenrolledAt + "T12:00:00Z").toISOString(),
      disenrollment_notes:         notes.trim() || null,
      updated_at:                  new Date().toISOString(),
    };

    try {
      const { error: updErr } = await supabase
        .from("cm_enrollments")
        .update(patch)
        .eq("id", enrollment.id);
      if (updErr) throw updErr;
      onSaved();
    } catch (e) {
      setError(e.message || "Failed to disenroll");
      setSaving(false);
    }
  };

  if (loading) return <Loader label="Loading reason codes..." />;

  return (
    <div>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div style={{ padding: "10px 12px", marginBottom: 16, background: C.amberBg, border: "0.5px solid " + C.amberBorder, borderRadius: 8, fontSize: 12, color: C.textPrimary }}>
        <strong>Disenrolling ends this care management engagement.</strong>
        The patient touchpoint history is preserved. A new enrollment can be created later if the patient re-engages.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={{ gridColumn: "1 / -1" }}>
          <FL>Reason for disenrollment</FL>
          <select value={reasonCode} onChange={e => setReasonCode(e.target.value)} style={selectStyle}>
            <option value="">-- Select reason --</option>
            {reasonCodes.map(rc => (
              <option key={rc.code} value={rc.code}>{rc.label}</option>
            ))}
          </select>
        </div>

        <div>
          <FL>Disenrollment date</FL>
          <input type="date" value={disenrolledAt} onChange={e => setDisenrolledAt(e.target.value)} style={inputStyle} />
        </div>

        <div style={{ gridColumn: "1 / -1" }}>
          <FL>Notes (optional)</FL>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Additional context, follow-up actions..." style={{ ...inputStyle, resize: "vertical" }} />
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
        <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
        <Btn variant="primary" disabled={saving || !reasonCode} onClick={save} style={{ background: C.red, borderColor: C.red }}>
          {saving ? "Disenrolling..." : "Confirm disenrollment"}
        </Btn>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ActivateForm - transition Pending or On Hold enrollments to Active.
//
// Sets enrollment_status='Active' and enrolled_at (if not already set).
// If moving from On Hold, does not overwrite existing enrolled_at.
// ---------------------------------------------------------------------------

function ActivateForm({ enrollment, onCancel, onSaved }) {
  const [enrolledAt, setEnrolledAt] = useState(() => {
    if (enrollment.enrolled_at) return enrollment.enrolled_at.split("T")[0];
    return new Date().toISOString().split("T")[0];
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);

  const isResume = enrollment.enrollment_status === "On Hold";

  const save = async () => {
    if (!enrolledAt) { setError("Enrolled date required"); return; }
    setSaving(true);
    setError(null);

    const patch = {
      enrollment_status: "Active",
      updated_at:        new Date().toISOString(),
    };
    if (!enrollment.enrolled_at) {
      patch.enrolled_at = new Date(enrolledAt + "T12:00:00Z").toISOString();
    }

    try {
      const { error: updErr } = await supabase
        .from("cm_enrollments")
        .update(patch)
        .eq("id", enrollment.id);
      if (updErr) throw updErr;
      onSaved();
    } catch (e) {
      setError(e.message || "Failed to activate");
      setSaving(false);
    }
  };

  return (
    <div>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div style={{ padding: "10px 12px", marginBottom: 16, background: C.bgSecondary, borderRadius: 8, fontSize: 12, color: C.textSecondary }}>
        {isResume
          ? "Resuming this enrollment moves it back to Active. Original enrolled date is preserved."
          : "Activating moves this enrollment from Pending to Active, indicating the member has consented and engagement has begun."}
      </div>

      {!enrollment.enrolled_at && (
        <div>
          <FL>Enrolled date</FL>
          <input type="date" value={enrolledAt} onChange={e => setEnrolledAt(e.target.value)} style={inputStyle} />
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
        <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
        <Btn variant="primary" disabled={saving} onClick={save}>
          {saving ? "Activating..." : (isResume ? "Resume enrollment" : "Activate enrollment")}
        </Btn>
      </div>
    </div>
  );
}
