import { useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { C } from "../../lib/tokens";
import { Badge, Btn, Modal, ErrorBanner, FL } from "../../components/ui";
import { normalizeGoals, isBlankGoal } from "../../lib/cmGoals";
import { GoalEditor, GoalDisplay } from "../../components/GoalEditor";
import { PlanStatusBadge, DetailField } from "./shared";
import AnnualReviewDrafter, { ReviewSummaryPanel } from "./AnnualReviewDrafter";

// ===============================================================================
// PlanDetailModal - read-only view of a care plan with all JSONB collections
// rendered as plain lists. Quick-action buttons for status transitions.
//
// Three sub-modes (wrapped inside the same Modal):
//   view         (default) - read-only summary + goals + lifecycle + actions
//   draftReview           - renders AnnualReviewDrafter for AI-assisted review
//   captureAck            - renders CaptureAckForm for staff-captured member ack
//
// Goals editor: inline edit of structured goals on Draft/Active plans for
// non-CHW roles. Normalizes legacy string-array goals into the canonical
// {goal, domain, priority, target_date, measure, rationale, status} shape.
//
// CaptureAckForm is internal to this file - only used by PlanDetailModal.
// ===============================================================================

export default function PlanDetailModal({ plan, profile, onClose, onUpdated }) {
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [generatingReviewPdf, setGeneratingReviewPdf] = useState(false);
  const [sharingPortal,  setSharingPortal]  = useState(false);
  // Sub-mode: "view" (default) | "draftReview" (annual review) | "captureAck"
  // (staff-captured member acknowledgment). All nested flows render INSIDE the
  // existing Modal wrapper to avoid double-Modal stacking.
  const [mode, setMode] = useState("view");
  // Edit-goals mode: toggles the Goals section from read-only GoalDisplay to
  // editable GoalEditor with Save/Cancel buttons. Used to add structured
  // metadata (domain, target_date, measure, rationale, status) to goals on
  // existing plans - particularly useful for legacy plans that were migrated
  // from string-array goals to the canonical shape and now need metadata
  // filled in after the fact.
  const [editingGoals, setEditingGoals] = useState(false);
  const [editedGoals, setEditedGoals]   = useState([]);
  const [savingGoals, setSavingGoals]   = useState(false);
  const [goalsError, setGoalsError]     = useState(null);

  // Role gate for the Annual Review AI button. Tier gating is enforced
  // server-side in cmp-draft-annual-review; a 403 surfaces in the error
  // banner if the practice isn't on Command tier.
  const role = profile?.role;
  const canDraftReview =
    plan.plan_status === "Active"
    && role
    && role !== "CHW";

  const title = (plan.patients?.first_name || "") + " " + (plan.patients?.last_name || "") + " - " + plan.plan_type;

  // Map the in-app user role to the cm_delivery_role enum used in the
  // human_reviewer_role column. Falls back to "Other" for roles that don't
  // have a clean clinical equivalent (e.g. Owner, Billing).
  const roleToDeliveryRole = (r) => {
    if (r === "Supervising Care Manager" || r === "Supervising CM") return "Supervising Care Manager";
    if (r === "Care Manager") return "Care Manager";
    if (r === "CHW" || r === "Extender") return "CHW";
    if (r === "Provider") return "Provider";
    return "Other";
  };

  const transitionStatus = async (newStatus, opts = {}) => {
    setSaving(true); setError(null);
    const nowIso = new Date().toISOString();
    const patch = { plan_status: newStatus, updated_at: nowIso };
    if (newStatus === "Active" && !plan.effective_date) {
      patch.effective_date = new Date().toISOString().split("T")[0];
    }
    // When activating an AI-drafted plan, we must also record the human
    // reviewer to satisfy cm_care_plans_ai_review_gate. Gate definition:
    //   NOT (ai_drafted=true AND plan_status='Active' AND human_reviewed_by IS NULL)
    // The reviewer is the current user clicking Activate. This is a single-
    // click attestation - the person hitting "Mark reviewed + activate" is
    // the human whose review we're recording.
    if (newStatus === "Active" && opts.markReviewed) {
      patch.human_reviewed_by    = profile?.id || null;
      patch.human_reviewed_at    = nowIso;
      patch.human_reviewer_role  = roleToDeliveryRole(profile?.role);
      patch.updated_by           = profile?.id || null;
    }
    try {
      const { error: updErr } = await supabase
        .from("cm_care_plans")
        .update(patch)
        .eq("id", plan.id);
      if (updErr) throw updErr;
      onUpdated();
    } catch (e) { setError(e.message); setSaving(false); }
  };

  // Generate (or regenerate) the PDF and open it in a new tab. Each call
  // produces a fresh artifact so the download always reflects the current
  // plan state. The edge function also writes document_url/path/at to the
  // plan row.
  const handleDownloadPdf = async () => {
    setGeneratingPdf(true); setError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) throw new Error("Not signed in");
      const url = supabase.supabaseUrl + "/functions/v1/cmp-generate-plan-pdf";
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": "Bearer " + token,
        },
        body: JSON.stringify({ plan_id: plan.id }),
      });
      const body = await res.json();
      if (!res.ok || !body?.signed_url) {
        throw new Error(body?.error || "PDF generation failed");
      }
      window.open(body.signed_url, "_blank", "noopener,noreferrer");
      if (onUpdated) onUpdated();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setGeneratingPdf(false);
    }
  };

  // Generate the annual-review-style PDF. Distinct from handleDownloadPdf
  // because the content includes review_summary (goals met/not met/carried/
  // removed) in addition to the refreshed plan. Only enabled for plans that
  // are themselves annual reviews (prior_plan_id + review_summary present).
  const handleDownloadReviewPdf = async () => {
    setGeneratingReviewPdf(true); setError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) throw new Error("Not signed in");
      const url = supabase.supabaseUrl + "/functions/v1/cmp-generate-annual-review-pdf";
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": "Bearer " + token,
        },
        body: JSON.stringify({ plan_id: plan.id }),
      });
      const body = await res.json();
      if (!res.ok || !body?.signed_url) {
        throw new Error(body?.error || "Annual review PDF generation failed");
      }
      window.open(body.signed_url, "_blank", "noopener,noreferrer");
      if (onUpdated) onUpdated();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setGeneratingReviewPdf(false);
    }
  };

  // Push the plan to the patient portal and queue a notification email.
  // Requires a PDF on file (edge function also enforces this).
  const handleSharePortal = async () => {
    if (!plan.document_storage_path) {
      setError("Generate the PDF first, then share to portal.");
      return;
    }
    setSharingPortal(true); setError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) throw new Error("Not signed in");
      const url = supabase.supabaseUrl + "/functions/v1/cmp-share-plan-portal";
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": "Bearer " + token,
        },
        body: JSON.stringify({ plan_id: plan.id }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Portal share failed");
      if (onUpdated) onUpdated();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setSharingPortal(false);
    }
  };

  // Goals editor handlers. Start copies the current normalized goals into
  // editing state so the user can mutate without affecting the rendered
  // view. Cancel discards changes. Save writes canonicalized, non-blank
  // goals back to cm_care_plans and refreshes the parent list.
  const handleStartEditGoals = () => {
    setEditedGoals(normalizeGoals(Array.isArray(plan.goals) ? plan.goals : []));
    setGoalsError(null);
    setEditingGoals(true);
  };

  const handleCancelEditGoals = () => {
    setEditedGoals([]);
    setGoalsError(null);
    setEditingGoals(false);
  };

  const handleSaveGoals = async () => {
    const cleaned = normalizeGoals(editedGoals).filter(g => !isBlankGoal(g));
    if (cleaned.length === 0) {
      setGoalsError("Add at least one goal before saving");
      return;
    }
    setSavingGoals(true);
    setGoalsError(null);
    try {
      const { error: updErr } = await supabase
        .from("cm_care_plans")
        .update({ goals: cleaned, updated_at: new Date().toISOString() })
        .eq("id", plan.id);
      if (updErr) throw updErr;
      setEditingGoals(false);
      setEditedGoals([]);
      if (onUpdated) onUpdated();
    } catch (e) {
      setGoalsError(e.message || "Failed to save goals");
    } finally {
      setSavingGoals(false);
    }
  };

  const goals         = Array.isArray(plan.goals)         ? plan.goals         : [];
  const interventions = Array.isArray(plan.interventions) ? plan.interventions : [];
  const unmetNeeds    = Array.isArray(plan.unmet_needs)   ? plan.unmet_needs   : [];
  const riskFactors   = Array.isArray(plan.risk_factors)  ? plan.risk_factors  : [];
  const strengths     = Array.isArray(plan.strengths)     ? plan.strengths     : [];
  const supports      = Array.isArray(plan.supports)      ? plan.supports      : [];

  // Annual review drafting mode: swap the whole body for the draft flow.
  // Same Modal wrapper; different title and content. Accept here means a new
  // plan version was inserted - we propagate onUpdated() to refresh the list.
  if (mode === "draftReview") {
    return (
      <Modal title={"Annual review: " + title} onClose={onClose} width={900}>
        <AnnualReviewDrafter
          priorPlan={plan}
          userId={profile?.id}
          onCancel={() => setMode("view")}
          onSaved={() => { if (onUpdated) onUpdated(); }}
        />
      </Modal>
    );
  }

  if (mode === "captureAck") {
    return (
      <Modal title={"Capture acknowledgment: " + title} onClose={onClose} width={560}>
        <CaptureAckForm
          plan={plan}
          onCancel={() => setMode("view")}
          onSaved={() => { setMode("view"); if (onUpdated) onUpdated(); }}
        />
      </Modal>
    );
  }

  return (
    <Modal title={title} onClose={onClose} width={820}>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div style={{ display: "flex", gap: 8, marginBottom: 16, paddingBottom: 12, borderBottom: "0.5px solid " + C.borderLight, flexWrap: "wrap" }}>
        {plan.plan_status === "Draft" && plan.ai_drafted && !plan.human_reviewed_by && (
          role && role !== "CHW" ? (
            <Btn variant="primary" size="sm" disabled={saving} onClick={() => transitionStatus("Active", { markReviewed: true })}>
              {saving ? "Activating..." : "Mark reviewed + activate"}
            </Btn>
          ) : (
            <div style={{ fontSize: 12, color: C.textTertiary, fontStyle: "italic", padding: "6px 0" }}>
              Awaiting review by Care Manager or Supervisor before activation
            </div>
          )
        )}
        {plan.plan_status === "Draft" && (!plan.ai_drafted || plan.human_reviewed_by) && (
          <Btn variant="primary" size="sm" disabled={saving} onClick={() => transitionStatus("Active")}>
            {saving ? "Activating..." : "Activate plan"}
          </Btn>
        )}
        {plan.plan_status === "Active" && (
          <Btn variant="outline" size="sm" disabled={saving} onClick={() => transitionStatus("Archived")}>
            {saving ? "Archiving..." : "Archive plan"}
          </Btn>
        )}
        {plan.plan_status === "Archived" && (
          <Btn variant="outline" size="sm" disabled={saving} onClick={() => transitionStatus("Active")}>
            Re-activate
          </Btn>
        )}
        {canDraftReview && (
          <Btn variant="primary" size="sm" onClick={() => setMode("draftReview")}>
            Draft annual review with AI
          </Btn>
        )}
        {plan.plan_status === "Active" && role && role !== "CHW" && (
          <Btn variant="outline" size="sm" disabled={generatingPdf} onClick={handleDownloadPdf}>
            {generatingPdf ? "Generating..." : (plan.document_generated_at ? "Download PDF" : "Generate PDF")}
          </Btn>
        )}
        {plan.plan_status === "Active" && role && role !== "CHW" && plan.prior_plan_id && plan.review_summary && (
          <Btn variant="outline" size="sm" disabled={generatingReviewPdf} onClick={handleDownloadReviewPdf}>
            {generatingReviewPdf ? "Generating..." : "Annual Review PDF"}
          </Btn>
        )}
        {plan.plan_status === "Active" && role && role !== "CHW" && !plan.member_ack_at && (
          <Btn variant="outline" size="sm" onClick={() => setMode("captureAck")}>
            Capture acknowledgment
          </Btn>
        )}
        {plan.plan_status === "Active" && role && role !== "CHW" && plan.document_storage_path && !plan.portal_shared_at && (
          <Btn variant="outline" size="sm" disabled={sharingPortal} onClick={handleSharePortal}>
            {sharingPortal ? "Sharing..." : "Share to portal"}
          </Btn>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        <DetailField label="Status"      value={
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <PlanStatusBadge status={plan.plan_status} />
            {plan.ai_drafted && <Badge label="AI DRAFTED" variant="blue" size="xs" />}
            {plan.ai_drafted && plan.human_reviewed_by && (
              <Badge label="REVIEWED" variant="green" size="xs" />
            )}
          </div>
        } />
        <DetailField label="Version"     value={"v" + plan.version} />
        <DetailField label="Assessment"  value={plan.assessment_date ? new Date(plan.assessment_date).toLocaleDateString() : "-"} />
        <DetailField label="Effective"   value={plan.effective_date ? new Date(plan.effective_date).toLocaleDateString() : "-"} />
        <DetailField label="Last reviewed" value={plan.last_reviewed_at ? new Date(plan.last_reviewed_at).toLocaleDateString() : "-"} />
        <DetailField label="Next review" value={plan.next_review_due ? new Date(plan.next_review_due).toLocaleDateString() : "-"} />
        <DetailField label="Meds reviewed" value={plan.medications_reviewed ? "Yes" : "No"} />
        <DetailField label="PDF generated" value={plan.document_generated_at ? new Date(plan.document_generated_at).toLocaleDateString() : "-"} />
      </div>

      {/* Lifecycle panel: PDF + portal share + member ack status. Only
          surfaces on Active plans where lifecycle is meaningful. */}
      {plan.plan_status === "Active" && (plan.portal_shared_at || plan.member_ack_at || plan.document_storage_path) && (
        <div style={{ padding: 12, marginBottom: 20, border: "0.5px solid " + C.borderLight, borderRadius: 8, background: C.bgSecondary }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 10 }}>
            Lifecycle
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.textTertiary, textTransform: "uppercase", marginBottom: 4 }}>PDF</div>
              {plan.document_storage_path ? (
                <div style={{ fontSize: 13, color: C.textPrimary }}>
                  <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: C.green, marginRight: 6, verticalAlign: "middle" }}></span>
                  Generated
                </div>
              ) : (
                <div style={{ fontSize: 13, color: C.textTertiary, fontStyle: "italic" }}>Not yet generated</div>
              )}
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.textTertiary, textTransform: "uppercase", marginBottom: 4 }}>Portal share</div>
              {plan.portal_shared_at ? (
                <div style={{ fontSize: 13, color: C.textPrimary }}>
                  <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: C.green, marginRight: 6, verticalAlign: "middle" }}></span>
                  {new Date(plan.portal_shared_at).toLocaleDateString()}
                </div>
              ) : (
                <div style={{ fontSize: 13, color: C.textTertiary, fontStyle: "italic" }}>Not shared</div>
              )}
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.textTertiary, textTransform: "uppercase", marginBottom: 4 }}>Member ack</div>
              {plan.member_ack_at ? (
                <div style={{ fontSize: 13, color: C.textPrimary }}>
                  <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: C.green, marginRight: 6, verticalAlign: "middle" }}></span>
                  {new Date(plan.member_ack_at).toLocaleDateString()}
                  {plan.member_ack_method && (
                    <span style={{ fontSize: 11, color: C.textTertiary, marginLeft: 6 }}>
                      ({plan.member_ack_method}{plan.member_ack_role ? ", " + plan.member_ack_role.toLowerCase() : ""})
                    </span>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: 13, color: C.textTertiary, fontStyle: "italic" }}>Pending</div>
              )}
            </div>
          </div>
          {plan.member_ack_notes && (
            <div style={{ marginTop: 10, padding: "8px 10px", background: C.bgPrimary, borderRadius: 6, fontSize: 12, color: C.textSecondary, borderLeft: "2px solid " + C.borderLight }}>
              <span style={{ fontWeight: 600, color: C.textTertiary }}>Ack notes: </span>{plan.member_ack_notes}
            </div>
          )}
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary }}>
            Goals ({normalizeGoals(editingGoals ? editedGoals : goals).length})
          </div>
          {!editingGoals && (plan.plan_status === "Draft" || plan.plan_status === "Active") && role && role !== "CHW" && (
  <Btn variant="outline" size="sm" onClick={handleStartEditGoals}>
    Edit goals
  </Btn>
)}
        </div>
        {editingGoals ? (
          <div>
            <GoalEditor goals={editedGoals} onChange={setEditedGoals} label={null} />
            {goalsError && (
              <div style={{ marginTop: 8, padding: "8px 10px", background: C.redBg, border: "0.5px solid " + C.redBorder, borderRadius: 6, fontSize: 12, color: C.red }}>
                {goalsError}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <Btn variant="primary" size="sm" onClick={handleSaveGoals} disabled={savingGoals}>
                {savingGoals ? "Saving..." : "Save goals"}
              </Btn>
              <Btn variant="ghost" size="sm" onClick={handleCancelEditGoals} disabled={savingGoals}>
                Cancel
              </Btn>
            </div>
          </div>
        ) : (
          <GoalDisplay goals={goals} emptyMsg="No goals recorded" />
        )}
      </div>
      <PlanSection title="Interventions" items={interventions} emptyMsg="No interventions recorded" />
      <PlanSection title="Unmet needs"   items={unmetNeeds}    emptyMsg="No unmet needs recorded" />
      <PlanSection title="Risk factors"  items={riskFactors}   emptyMsg="No risk factors recorded" />
      <PlanSection title="Strengths"     items={strengths}     emptyMsg="No strengths recorded" />
      <PlanSection title="Supports"      items={supports}      emptyMsg="No supports recorded" />

      {/* Review summary - rendered when this plan is the output of an
          annual/interim review. Shows what changed vs. the prior version. */}
      {plan.review_summary && (
        <ReviewSummaryPanel summary={plan.review_summary} priorPlanId={plan.prior_plan_id} />
      )}
    </Modal>
  );
}

// Staff-captured member acknowledgment. Records that a CM walked the member
// through their plan via phone/in-person/video. The edge function handles
// server-side validation (Command tier, Active plan, non-CHW role, method
// in the accepted set).
function CaptureAckForm({ plan, onCancel, onSaved }) {
  const [method, setMethod] = useState("Telephonic");
  const [notes,  setNotes]  = useState("");
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState(null);

  const METHOD_OPTIONS = [
    { value: "Telephonic", label: "By phone" },
    { value: "In Person",  label: "In person" },
    { value: "Video",      label: "Video visit" },
  ];

  const handleSubmit = async () => {
    setSaving(true); setError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) throw new Error("Not signed in");
      const url = supabase.supabaseUrl + "/functions/v1/cmp-member-ack-plan";
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": "Bearer " + token,
        },
        body: JSON.stringify({
          plan_id: plan.id,
          method:  method,
          notes:   notes || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Acknowledgment failed");
      onSaved();
    } catch (e) {
      setError(e.message || String(e));
      setSaving(false);
    }
  };

  return (
    <div>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      <div style={{ fontSize: 13, color: C.textSecondary, marginBottom: 16, lineHeight: 1.5 }}>
        Record that you walked the member through this care plan and they acknowledged it verbally.
        This attestation becomes part of the audit trail for NC Medicaid compliance.
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 8 }}>
          How did you confirm?
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {METHOD_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setMethod(opt.value)}
              style={{
                padding: "8px 14px",
                border: "0.5px solid " + (method === opt.value ? C.teal : C.borderLight),
                background: method === opt.value ? C.teal : C.bgPrimary,
                color: method === opt.value ? "#ffffff" : C.textPrimary,
                borderRadius: 6,
                fontSize: 13,
                fontWeight: method === opt.value ? 600 : 400,
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <FL>Notes (optional)</FL>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Any questions the member raised, or changes they requested..."
          rows={4}
          style={{
            width: "100%",
            padding: "10px 12px",
            border: "1px solid " + C.borderMid,
            borderRadius: 8,
            fontSize: 13,
            fontFamily: "inherit",
            resize: "vertical",
            boxSizing: "border-box",
            background: C.bgPrimary,
            color: C.textPrimary,
          }}
        />
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", paddingTop: 12, borderTop: "0.5px solid " + C.borderLight }}>
        <Btn variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Btn>
        <Btn variant="primary" size="sm" onClick={handleSubmit} disabled={saving}>
          {saving ? "Recording..." : "Record acknowledgment"}
        </Btn>
      </div>
    </div>
  );
}

function PlanSection({ title, items, emptyMsg }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 8 }}>
        {title} ({items.length})
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: 12, color: C.textTertiary, fontStyle: "italic", padding: "6px 0" }}>{emptyMsg}</div>
      ) : (
        <div style={{ border: "0.5px solid " + C.borderLight, borderRadius: 8 }}>
          {items.map((item, i) => {
            const text = typeof item === "string" ? item : (item.text || item.description || item.name || JSON.stringify(item));
            return (
              <div key={i} style={{ padding: "8px 12px", borderBottom: i < items.length - 1 ? "0.5px solid " + C.borderLight : "none", fontSize: 13 }}>
                {text}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NewPlanModal - create a new care plan linked to an active enrollment.
//
// Plan type defaults based on enrollment health_plan_type:
//   Tailored Plan -> "Care Plan"
//   Standard Plan -> "AMH Tier 3 Care Plan"
//   Other/null    -> "Care Plan" as generic default
//
// v1 goals entry: simple multi-line textarea, one goal per line. Saves as
// a JSONB array of strings.
// ---------------------------------------------------------------------------
