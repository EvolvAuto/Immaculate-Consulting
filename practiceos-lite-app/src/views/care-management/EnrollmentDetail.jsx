import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../auth/AuthProvider";
import { C } from "../../lib/tokens";
import { Badge, Btn, Modal, Loader, EmptyState } from "../../components/ui";
import { StatusBadge, AcuityBadge, PlanTypeBadge, DetailField } from "./shared";
import RiskPanel from "./RiskPanel";
import { EditEnrollmentForm, DisenrollForm, ActivateForm } from "./EnrollmentForms";

// ===============================================================================
// EnrollmentDetail - detail modal for a single Care Management enrollment.
//
// Four sub-modes:
//   view (default) - read-only summary + touchpoint history + risk panel
//   edit           - rendered via EditEnrollmentForm
//   disenroll      - rendered via DisenrollForm
//   activate       - rendered via ActivateForm (Pending or On Hold -> Active)
//
// Risk state (latest active assessment + history) is owned here rather than
// in RiskPanel so the re-assess / acknowledge / dismiss edge-function calls
// can coordinate with the parent Registry reload via onRiskChanged.
// ===============================================================================

// Sub-component: enrollment detail modal. Read-only for now - edit flows
// (update acuity, disenroll, reassign CM) come in the next session.
export default function EnrollmentDetail({ enrollment, onClose, onUpdated, onRiskChanged }) {
  const { profile } = useAuth();
  const [touchpoints, setTouchpoints] = useState([]);
  const [loading, setLoading]         = useState(true);
  // Sub-mode: view (default) | edit | disenroll | activate
  const [mode, setMode] = useState("view");

  // AI risk state - latest active assessment for this enrollment, plus the
  // action-handler flags for Re-assess / Acknowledge / Dismiss.
  const [risk, setRisk] = useState(null);
  const [riskHistory, setRiskHistory] = useState([]);
  const [riskLoading, setRiskLoading] = useState(true);
  const [riskBusy, setRiskBusy]       = useState(false);
  const [riskError, setRiskError]     = useState(null);
  const [riskOverloaded, setRiskOverloaded] = useState(false);
  const [showDismiss, setShowDismiss] = useState(false);
  const [dismissReason, setDismissReason] = useState("");

  const loadRisk = useCallback(async () => {
    setRiskLoading(true);
    try {
      // Single query: all assessments for this enrollment. The one with
      // superseded_at IS NULL is the currently-active assessment; the rest
      // are history (sorted newest-first for the timeline view).
      const { data } = await supabase
        .from("cm_enrollment_risk_assessments")
        .select("id, risk_level, risk_score, headline, narrative, risk_factors, protective_factors, recommended_interventions, suggested_next_contact_by, confidence, assessed_at, acknowledged_at, acknowledged_by, dismissed_at, dismissed_by, dismissed_reason, trigger_reason, model, superseded_at, superseded_by_id")
        .eq("enrollment_id", enrollment.id)
        .order("assessed_at", { ascending: false });
      const rows = data || [];
      const active  = rows.find(r => !r.superseded_at) || null;
      const history = rows.filter(r => r.superseded_at);
      setRisk(active);
      setRiskHistory(history);
    } catch (e) {
      setRiskError(e.message || "Could not load risk assessment");
    } finally {
      setRiskLoading(false);
    }
  }, [enrollment.id]);

  useEffect(() => {
    supabase
      .from("cm_touchpoints")
      .select("id, touchpoint_at, contact_method, successful_contact, delivered_by_role, activity_category_code, notes")
      .eq("enrollment_id", enrollment.id)
      .order("touchpoint_at", { ascending: false })
      .limit(50)
      .then(({ data }) => { setTouchpoints(data || []); setLoading(false); });
    loadRisk();
  }, [enrollment.id, loadRisk]);

  // Re-assess: call cmp-risk-assess-enrollment edge fn. Supersedes current
  // via DB trigger; we just refetch after.
  const handleReassess = async () => {
    setRiskBusy(true);
    setRiskError(null);
    setRiskOverloaded(false);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) throw new Error("Not authenticated");
      const url = supabase.supabaseUrl + "/functions/v1/cmp-risk-assess-enrollment";
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": "Bearer " + token,
        },
        body: JSON.stringify({ enrollment_id: enrollment.id, trigger_reason: "manual" }),
      });
      const body = await res.json();
      if (!res.ok || body.error) {
        const err = new Error(body.error || "HTTP " + res.status);
        err.overloaded = body.overloaded === true;
        throw err;
      }
      await loadRisk();
      // Await the parent's reload so rows is fresh before the user can close
      // the modal. Previously this was fire-and-forget, which produced a race:
      // if the user closed the modal quickly, the Registry would still show
      // stale risk data until they hit Refresh.
      if (onRiskChanged) await onRiskChanged();
    } catch (e) {
      setRiskError(e.message || "Re-assess failed");
      setRiskOverloaded(e.overloaded === true);
    } finally {
      setRiskBusy(false);
    }
  };

  // Acknowledge: mark the current assessment as seen and being worked.
  const handleAcknowledge = async () => {
    if (!risk?.id) return;
    setRiskBusy(true);
    setRiskError(null);
    try {
      const { error: e1 } = await supabase
        .from("cm_enrollment_risk_assessments")
        .update({
          acknowledged_at: new Date().toISOString(),
          acknowledged_by: profile?.id || null,
        })
        .eq("id", risk.id);
      if (e1) throw e1;
      await loadRisk();
      if (onRiskChanged) await onRiskChanged();
    } catch (e) {
      setRiskError(e.message || "Acknowledge failed");
    } finally {
      setRiskBusy(false);
    }
  };

  // Dismiss: removes from "At risk" queue. Requires a reason for audit trail.
  const handleDismiss = async () => {
    if (!risk?.id) return;
    if (!dismissReason.trim()) { setRiskError("Dismiss reason required"); return; }
    setRiskBusy(true);
    setRiskError(null);
    try {
      const { error: e1 } = await supabase
        .from("cm_enrollment_risk_assessments")
        .update({
          dismissed_at: new Date().toISOString(),
          dismissed_by: profile?.id || null,
          dismissed_reason: dismissReason.trim(),
        })
        .eq("id", risk.id);
      if (e1) throw e1;
      setShowDismiss(false);
      setDismissReason("");
      await loadRisk();
      if (onRiskChanged) await onRiskChanged();
    } catch (e) {
      setRiskError(e.message || "Dismiss failed");
    } finally {
      setRiskBusy(false);
    }
  };

  const title = (enrollment.patients?.first_name || "") + " " + (enrollment.patients?.last_name || "");
  const canActivate   = enrollment.enrollment_status === "Pending" || enrollment.enrollment_status === "On Hold";
  const canDisenroll  = enrollment.enrollment_status !== "Disenrolled";
  const canEdit       = enrollment.enrollment_status !== "Deceased" && enrollment.enrollment_status !== "Transferred";

  // Role gate for risk actions. CHW can trigger Re-assess but cannot
  // Acknowledge/Dismiss (those are supervisor-level decisions).
  const role = profile?.role;
  const canReassess = role && enrollment.enrollment_status !== "Disenrolled";
  const canAckDismiss = role && role !== "CHW";

  // Inline mode: show the relevant form in place of the read-only view.
  if (mode === "edit") {
    return (
      <Modal title={"Edit enrollment: " + title} onClose={onClose} width={760}>
        <EditEnrollmentForm
          enrollment={enrollment}
          onCancel={() => setMode("view")}
          onSaved={() => { if (onUpdated) onUpdated(); }}
        />
      </Modal>
    );
  }
  if (mode === "disenroll") {
    return (
      <Modal title={"Disenroll: " + title} onClose={onClose} width={640}>
        <DisenrollForm
          enrollment={enrollment}
          onCancel={() => setMode("view")}
          onSaved={() => { if (onUpdated) onUpdated(); }}
        />
      </Modal>
    );
  }
  if (mode === "activate") {
    return (
      <Modal title={"Activate: " + title} onClose={onClose} width={560}>
        <ActivateForm
          enrollment={enrollment}
          onCancel={() => setMode("view")}
          onSaved={() => { if (onUpdated) onUpdated(); }}
        />
      </Modal>
    );
  }

  return (
    <Modal title={"Enrollment: " + title} onClose={onClose} width={760}>
      {/* Action buttons row */}
      {(canActivate || canEdit || canDisenroll) && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16, paddingBottom: 12, borderBottom: "0.5px solid " + C.borderLight }}>
          {canActivate && (
            <Btn variant="primary" size="sm" onClick={() => setMode("activate")}>
              {enrollment.enrollment_status === "On Hold" ? "Resume enrollment" : "Activate"}
            </Btn>
          )}
          {canEdit && (
            <Btn variant="outline" size="sm" onClick={() => setMode("edit")}>Edit</Btn>
          )}
          {canDisenroll && (
            <Btn variant="outline" size="sm" onClick={() => setMode("disenroll")} style={{ color: C.red, borderColor: C.redBorder }}>
              Disenroll
            </Btn>
          )}
        </div>
      )}

      {/* Summary row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        <DetailField label="Plan type"    value={<PlanTypeBadge planType={enrollment.health_plan_type} />} />
        <DetailField label="Program"      value={enrollment.program_type} />
        <DetailField label="Provider"     value={enrollment.cm_provider_type || "-"} />
        <DetailField label="Acuity"       value={<AcuityBadge tier={enrollment.acuity_tier} />} />
        <DetailField label="Status"       value={<StatusBadge status={enrollment.enrollment_status} />} />
        <DetailField label="Enrolled"     value={enrollment.enrolled_at ? new Date(enrollment.enrolled_at).toLocaleDateString() : "-"} />
        <DetailField label="Payer"        value={enrollment.payer_name} />
        <DetailField label="Plan member #" value={enrollment.plan_member_id || "-"} monospace />
        <DetailField label="Assigned CM"  value={enrollment.assigned_care_manager_id ? "Set" : "Unassigned"} />
        <DetailField label="HOP"          value={enrollment.hop_active ? "Active" : (enrollment.hop_eligible ? "Eligible" : "No")} />
      </div>

      {enrollment.enrollment_status === "Disenrolled" && (
        <div style={{ padding: 12, marginBottom: 16, background: C.redBg, border: "0.5px solid " + C.redBorder, borderRadius: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.red, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Disenrolled</div>
          <div style={{ fontSize: 13, color: C.textPrimary }}>
            {enrollment.disenrollment_reason_code || "reason unspecified"}
            {enrollment.disenrolled_at && <span style={{ color: C.textSecondary }}> on {new Date(enrollment.disenrolled_at).toLocaleDateString()}</span>}
          </div>
        </div>
      )}

      {/* AI clinical risk panel */}
      <RiskPanel
        risk={risk}
        history={riskHistory}
        loading={riskLoading}
        busy={riskBusy}
        error={riskError}
        overloaded={riskOverloaded}
        canReassess={canReassess}
        canAckDismiss={canAckDismiss}
        onReassess={handleReassess}
        onAcknowledge={handleAcknowledge}
        showDismiss={showDismiss}
        setShowDismiss={setShowDismiss}
        dismissReason={dismissReason}
        setDismissReason={setDismissReason}
        onDismiss={handleDismiss}
      />

      {/* Touchpoint history */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 8 }}>
          Touchpoint history ({touchpoints.length})
        </div>
        {loading ? (
          <Loader label="Loading touchpoints..." />
        ) : touchpoints.length === 0 ? (
          <EmptyState title="No touchpoints yet" message="Log the first contact with this patient from the Touchpoints tab." />
        ) : (
          <div style={{ border: "0.5px solid " + C.borderLight, borderRadius: 8, maxHeight: 320, overflow: "auto" }}>
            {touchpoints.map((tp, i) => (
              <div key={tp.id} style={{
                padding: "10px 12px",
                borderBottom: i < touchpoints.length - 1 ? "0.5px solid " + C.borderLight : "none",
                background: tp.successful_contact ? "transparent" : C.amberBg,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>
                    {new Date(tp.touchpoint_at).toLocaleString()}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <Badge label={tp.contact_method} variant="teal" size="xs" />
                    <Badge label={tp.delivered_by_role} variant="purple" size="xs" />
                    {!tp.successful_contact && <Badge label="Attempt" variant="amber" size="xs" />}
                  </div>
                </div>
                {tp.notes && <div style={{ fontSize: 12, color: C.textSecondary }}>{tp.notes}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// TouchpointsTab - contact log view for Care Managers and CHWs.
//
// Shows all touchpoints logged for the practice, filterable by date range,
// patient name, care manager, program, and success status. Role-aware:
//   - CHW sees only their own touchpoints (delivered_by_user_id = self)
//   - Care Managers / Supervisors see all practice touchpoints
//
// Append-only: v1 does not allow edit or delete. This matches TCM Provider
// Manual audit expectations (records retention + HIPAA) - mutating touchpoint
// history would break the billing trail.
// ---------------------------------------------------------------------------

// Values must match the cm_contact_method Postgres enum exactly.
const CONTACT_METHODS = [
  "In Person",
  "Telephonic",
  "Video",
  "Secure Message",
  "Letter",
  "Email",
  "Attempt - No Contact",
];

// Methods that count toward the TCM monthly billing floor when successful.
// Per TCM Provider Manual Section 4.2: qualifying contacts are member-facing
// interactions (in-person, telephonic, or two-way audio/video). Letter, email,
// and secure message do not qualify; attempts with no contact never qualify.
const TCM_QUALIFYING_METHODS = new Set(["In Person", "Telephonic", "Video"]);

// HOP HRSN domains used across PracticeOS (matches hrsn_referral_drafts.domain
// values). These are stored in cm_touchpoints.hrsn_domains_addressed as text[].
const HOP_DOMAINS = [
  { code: "food_insecurity",     label: "Food insecurity" },
  { code: "housing_instability", label: "Housing instability" },
  { code: "housing_quality",     label: "Housing quality" },
  { code: "transportation",      label: "Transportation" },
  { code: "utilities",           label: "Utilities" },
  { code: "interpersonal_safety", label: "Interpersonal safety" },
];

const DATE_RANGE_PRESETS = [
  { key: "7d",    label: "Last 7 days",  days: 7 },
  { key: "30d",   label: "Last 30 days", days: 30 },
  { key: "month", label: "This month",   days: null },
  { key: "all",   label: "All time",     days: null },
];
