import { useState, useEffect, useMemo } from "react";
import { supabase } from "../../lib/supabaseClient";
import { C } from "../../lib/tokens";
import { Badge, Btn, Modal, Loader, ErrorBanner, FL } from "../../components/ui";
import { normalizeGoals, blankGoal, isBlankGoal } from "../../lib/cmGoals";
import { GoalEditor } from "../../components/GoalEditor";
import { inputStyle, selectStyle } from "./shared";

// ===============================================================================
// NewPlanModal - create a new care plan linked to an active enrollment.
//
// Plan type defaults based on enrollment health_plan_type:
//   Tailored Plan -> "Care Plan"
//   Standard Plan -> "AMH Tier 3 Care Plan"
//   Other/null    -> "Care Plan" as generic default
//
// Goals entry: structured GoalEditor (canonical shape). AI "Draft with AI"
// button invokes cmp-draft-care-plan edge fn; returned draft populates
// structuredGoals and shows the AiDraftPreview for reviewer context.
//
// AiDraftPreview and AiDraftChunk are internal to this file - they render
// read-only cards for sections not directly editable in v1 (interventions,
// unmet needs, risk factors, strengths, supports) so the CM can see what
// the AI picked up before activating the plan.
// ===============================================================================

export default function NewPlanModal({ practiceId, userId, onClose, onCreated }) {
  const [enrollments, setEnrollments] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState(null);

  const [enrollmentId, setEnrollmentId]   = useState("");
  const [planType, setPlanType]           = useState("");
  const [assessmentDate, setAssessmentDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [nextReviewDue, setNextReviewDue]   = useState("");
  // Structured goals array (canonical shape). Replaces the old goalsText string.
  // Always at least one blank row so there's always somewhere to type.
  const [structuredGoals, setStructuredGoals] = useState([blankGoal()]);
  const [medsReviewed, setMedsReviewed]     = useState(false);
  const [notes, setNotes]                   = useState("");

  // AI draft state. Only structure-level draft data here now - goals live in
  // structuredGoals above. aiDraft.goals is merged into structuredGoals on
  // "Draft with AI" so the editor shows the AI output immediately.
  const [aiDrafting, setAiDrafting]     = useState(false);
  const [aiError, setAiError]           = useState(null);
  const [aiDraft, setAiDraft]           = useState(null);
  const [aiMeta, setAiMeta]             = useState(null);
  useEffect(() => {
    if (!practiceId) return;
    supabase
      .from("cm_enrollments")
      .select("id, patient_id, program_type, enrollment_status, health_plan_type, patients(first_name, last_name, mrn)")
      .eq("practice_id", practiceId)
      .in("enrollment_status", ["Active", "Pending"])
      .order("enrollment_status", { ascending: true })
      .then(({ data }) => { setEnrollments(data || []); setLoading(false); });
  }, [practiceId]);

  const selectedEnrollment = useMemo(
    () => enrollments.find(e => e.id === enrollmentId) || null,
    [enrollments, enrollmentId]
  );

  useEffect(() => {
    if (!selectedEnrollment) return;
    if (selectedEnrollment.health_plan_type === "Standard Plan") setPlanType("AMH Tier 3 Care Plan");
    else setPlanType("Care Plan");
    // Clear any prior AI draft when the enrollment changes
    setAiDraft(null);
    setAiMeta(null);
    setAiError(null);
  }, [selectedEnrollment?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!assessmentDate || nextReviewDue) return;
    const d = new Date(assessmentDate + "T12:00:00Z");
    d.setUTCFullYear(d.getUTCFullYear() + 1);
    setNextReviewDue(d.toISOString().split("T")[0]);
  }, [assessmentDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------------------------------------------------------
  // AI draft call - invokes the cmp-draft-care-plan edge function with the
  // current enrollment. Populates the goals textarea + captures structured
  // sections that will be written on save.
  // -------------------------------------------------------------------------
  const handleAiDraft = async () => {
    if (!enrollmentId) { setAiError("Pick an enrollment first"); return; }
    setAiDrafting(true);
    setAiError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const url = supabase.supabaseUrl + "/functions/v1/cmp-draft-care-plan";
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": "Bearer " + token,
        },
        body: JSON.stringify({ enrollment_id: enrollmentId }),
      });
      const body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || "HTTP " + res.status);

      // Populate structuredGoals directly from the AI output. normalizeGoals
      // handles the legacy {text, ...} shape from cmp-draft-care-plan v1 by
      // renaming text -> goal.
      const aiGoals = Array.isArray(body.structured?.goals) ? body.structured.goals : [];
      setStructuredGoals(normalizeGoals(aiGoals));

      setAiDraft(body.structured || null);
      setAiMeta({
        model_used:     body.model_used,
        prompt_version: body.prompt_version,
        generated_at:   body.generated_at,
      });

      // If AI recommends 6-month review cadence, override the 12-month default
      const cadence = body.structured?.recommended_review_cadence_months;
      if (cadence === 6 && assessmentDate) {
        const d = new Date(assessmentDate + "T12:00:00Z");
        d.setUTCMonth(d.getUTCMonth() + 6);
        setNextReviewDue(d.toISOString().split("T")[0]);
      }
    } catch (e) {
      setAiError(e.message || "AI draft failed");
    } finally {
      setAiDrafting(false);
    }
  };
  const save = async () => {
    if (!enrollmentId) { setError("Pick an enrollment"); return; }
    if (!planType)     { setError("Pick a plan type"); return; }

    // Goals: filter blanks, normalize, then require at least one non-blank.
    const goals = normalizeGoals(structuredGoals).filter(g => !isBlankGoal(g));
    if (goals.length === 0) { setError("Add at least one goal"); return; }

    setSaving(true); setError(null);

    const nowIso = new Date().toISOString();
    const payload = {
      practice_id:   practiceId,
      patient_id:    selectedEnrollment.patient_id,
      enrollment_id: enrollmentId,
      plan_type:     planType,
      plan_status:   "Draft",
      assessment_date: assessmentDate || null,
      next_review_due: nextReviewDue || null,
      goals:         goals,
      medications_reviewed: medsReviewed,
      medications_reviewed_at: medsReviewed ? nowIso : null,
      medications_reviewed_by: medsReviewed ? (userId || null) : null,
      notes:         notes.trim() || null,
      created_by:    userId || null,
    };

    // When AI drafted, attach all the other structured sections + audit flags.
    // goals is already canonical-shaped above (came from structuredGoals which
    // is kept in canonical form via normalizeGoals on every AI draft call).
    if (aiDraft) {
      payload.interventions = Array.isArray(aiDraft.interventions) ? aiDraft.interventions : [];
      payload.unmet_needs   = Array.isArray(aiDraft.unmet_needs)   ? aiDraft.unmet_needs   : [];
      payload.risk_factors  = Array.isArray(aiDraft.risk_factors)  ? aiDraft.risk_factors  : [];
      payload.strengths     = Array.isArray(aiDraft.strengths)     ? aiDraft.strengths     : [];
      payload.supports      = Array.isArray(aiDraft.supports)      ? aiDraft.supports      : [];
      payload.ai_drafted            = true;
      payload.ai_draft_model        = aiMeta?.model_used || null;
      payload.ai_draft_at           = aiMeta?.generated_at || nowIso;
      payload.ai_draft_prompt_version = aiMeta?.prompt_version || null;
    }

    try {
      const { error: insErr } = await supabase.from("cm_care_plans").insert(payload);
      if (insErr) throw insErr;
      onCreated();
    } catch (e) { setError(e.message || "Failed to create plan"); setSaving(false); }
  };
  if (loading) {
    return (
      <Modal title="New care plan" onClose={onClose} width={900}>
        <Loader label="Loading enrollments..." />
      </Modal>
    );
  }

  return (
    <Modal title="New care plan" onClose={onClose} width={900}>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={{ gridColumn: "1 / -1" }}>
          <FL>Enrollment</FL>
          <select value={enrollmentId} onChange={e => setEnrollmentId(e.target.value)} style={selectStyle}>
            <option value="">-- Pick an enrollment --</option>
            {enrollments.map(e => (
              <option key={e.id} value={e.id}>
                {e.patients?.last_name || ""}, {e.patients?.first_name || ""}
                {e.patients?.mrn ? " (" + e.patients.mrn + ")" : ""} - {e.program_type}{e.health_plan_type ? " / " + e.health_plan_type : ""} [{e.enrollment_status}]
              </option>
            ))}
          </select>
        </div>

        {/* AI Draft call-to-action - appears once an enrollment is picked */}
        {enrollmentId && (
          <div style={{ gridColumn: "1 / -1", padding: 12, background: C.bgSecondary, border: "0.5px solid " + C.borderLight, borderRadius: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary }}>AI draft assistant</div>
                <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 2 }}>
                  {aiDraft
                    ? "Draft generated. Review each section below before saving."
                    : "Pull the member's record (enrollment, touchpoints, HRSN, problem list) and draft SMART goals + interventions + barriers for your review."}
                </div>
              </div>
              <Btn
                variant={aiDraft ? "outline" : "primary"}
                size="sm"
                disabled={aiDrafting}
                onClick={handleAiDraft}
              >
                {aiDrafting ? "Drafting..." : (aiDraft ? "Re-draft" : "Draft with AI")}
              </Btn>
            </div>
            {aiError && (
              <div style={{ marginTop: 8, fontSize: 12, color: C.red, background: C.redBg, padding: "6px 10px", borderRadius: 6, border: "0.5px solid " + C.redBorder }}>
                {aiError}
              </div>
            )}
          </div>
        )}

        <div>
          <FL>Plan type</FL>
          <select value={planType} onChange={e => setPlanType(e.target.value)} style={selectStyle}>
            <option value="">-- Select plan type --</option>
            <option value="Care Plan">Care Plan (TCM)</option>
            <option value="Individual Support Plan">Individual Support Plan</option>
            <option value="AMH Tier 3 Care Plan">AMH Tier 3 Care Plan (Standard Plan)</option>
            <option value="Comprehensive Assessment">Comprehensive Assessment</option>
            <option value="90-Day Transition Plan">90-Day Transition Plan</option>
          </select>
        </div>

        <div>
          <FL>Assessment date</FL>
          <input type="date" value={assessmentDate} onChange={e => setAssessmentDate(e.target.value)} style={inputStyle} />
        </div>

        <div>
          <FL>Next review due</FL>
          <input type="date" value={nextReviewDue} onChange={e => setNextReviewDue(e.target.value)} style={inputStyle} />
          <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 4 }}>
            {aiDraft && aiDraft.recommended_review_cadence_months === 6
              ? "AI recommends 6-month review based on this member's profile"
              : "Default: 1 year after assessment"}
          </div>
        </div>

        <div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginTop: 28 }}>
            <input type="checkbox" checked={medsReviewed} onChange={e => setMedsReviewed(e.target.checked)} />
            <span style={{ fontSize: 13 }}>Medications reviewed</span>
          </label>
        </div>

        {/* Assessment summary - shown when AI drafted */}
        {aiDraft?.assessment_summary && (
          <div style={{ gridColumn: "1 / -1", padding: 12, background: "#f0f9ff", border: "0.5px solid #bae6fd", borderRadius: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#075985", marginBottom: 4 }}>
              AI Assessment Summary
            </div>
            <div style={{ fontSize: 13, color: C.textPrimary, lineHeight: 1.5 }}>
              {aiDraft.assessment_summary}
            </div>
          </div>
        )}

        <div style={{ gridColumn: "1 / -1" }}>
          <GoalEditor
            goals={structuredGoals}
            onChange={setStructuredGoals}
            label="Goals"
          />
          <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 4 }}>
            {aiDraft
              ? "AI-drafted goals load structured. Edit the text, adjust priority, add target dates - all fields persist."
              : "Add one or more goals. Expand each row to set domain, target date, measure, and rationale."}
          </div>
        </div>

        {/* AI draft preview - read-only cards for the sections that aren't editable in v1 */}
        {aiDraft && (
          <div style={{ gridColumn: "1 / -1" }}>
            <AiDraftPreview draft={aiDraft} />
          </div>
        )}

        <div style={{ gridColumn: "1 / -1" }}>
          <FL>Notes (optional)</FL>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" disabled={saving || !enrollmentId || !planType} onClick={save}>
          {saving ? "Creating..." : "Create as Draft"}
        </Btn>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// AiDraftPreview - read-only preview of the sections the AI drafted.
// For v1 users cannot edit these in the creation modal (they edit post-save
// via MCP or future PlanDetailModal enhancements). Visible tells the CM what
// context the AI included so they can course-correct with a Re-draft.
// ---------------------------------------------------------------------------
function AiDraftPreview({ draft }) {
  const interventions = Array.isArray(draft.interventions) ? draft.interventions : [];
  const unmetNeeds    = Array.isArray(draft.unmet_needs)   ? draft.unmet_needs   : [];
  const riskFactors   = Array.isArray(draft.risk_factors)  ? draft.risk_factors  : [];
  const strengths     = Array.isArray(draft.strengths)     ? draft.strengths     : [];
  const supports      = Array.isArray(draft.supports)      ? draft.supports      : [];
  const quality       = draft.quality_notes || {};

  return (
    <div style={{ padding: 12, background: "#fafafa", border: "0.5px solid " + C.borderLight, borderRadius: 8 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary }}>
          AI draft sections
        </div>
        {quality.data_completeness && (
          <Badge
            label={"DATA " + String(quality.data_completeness).toUpperCase()}
            variant={quality.data_completeness === "high" ? "green" : quality.data_completeness === "medium" ? "amber" : "red"}
            size="xs"
          />
        )}
      </div>

      <AiDraftChunk title="Interventions" items={interventions} render={(i) => (
        <div>
          <div style={{ fontSize: 13, color: C.textPrimary }}>{i.description}</div>
          <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>
            {[i.cadence, i.responsible_party].filter(Boolean).join(" \u00B7 ")}
          </div>
        </div>
      )} />

      <AiDraftChunk title="Unmet needs / barriers" items={unmetNeeds} render={(u) => (
        <div>
          <div style={{ fontSize: 13, color: C.textPrimary, display: "flex", gap: 6, alignItems: "baseline" }}>
            <span>{u.description}</span>
            {u.urgency && <Badge label={String(u.urgency).toUpperCase()} variant={u.urgency === "urgent" ? "red" : u.urgency === "high" ? "amber" : "neutral"} size="xs" />}
          </div>
          {u.mitigation_idea && (
            <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2, fontStyle: "italic" }}>Idea: {u.mitigation_idea}</div>
          )}
        </div>
      )} />

      <AiDraftChunk title="Risk factors" items={riskFactors} render={(r) => (
        <div style={{ fontSize: 13, color: C.textPrimary }}>{r.description}</div>
      )} />

      <AiDraftChunk title="Strengths" items={strengths} render={(s) => (
        <div style={{ fontSize: 13, color: C.textPrimary }}>{typeof s === "string" ? s : (s.text || JSON.stringify(s))}</div>
      )} />

      <AiDraftChunk title="Supports" items={supports} render={(s) => (
        <div>
          <div style={{ fontSize: 13, color: C.textPrimary }}>{s.name}{s.relationship ? " (" + s.relationship + ")" : ""}</div>
          {s.role && <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>{s.role}</div>}
        </div>
      )} />

      {Array.isArray(quality.missing_data_elements) && quality.missing_data_elements.length > 0 && (
        <div style={{ marginTop: 12, padding: 10, background: C.amberBg, border: "0.5px solid " + C.amberBorder, borderRadius: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 4 }}>
            Missing data that would improve this draft
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: C.textPrimary }}>
            {quality.missing_data_elements.map((el, i) => <li key={i}>{el}</li>)}
          </ul>
        </div>
      )}

      <div style={{ marginTop: 10, fontSize: 10, color: C.textTertiary, fontStyle: "italic" }}>
        Clinical review required before finalization.
      </div>
    </div>
  );
}

function AiDraftChunk({ title, items, render }) {
  if (!items || items.length === 0) return null;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.textSecondary, marginBottom: 4 }}>
        {title} ({items.length})
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {items.map((it, i) => (
          <div key={i} style={{ padding: "8px 10px", background: C.bgPrimary, border: "0.5px solid " + C.borderLight, borderRadius: 6 }}>
            {render(it)}
          </div>
        ))}
      </div>
    </div>
  );
}

// ===============================================================================
// Billing Readiness tab
// ===============================================================================
//
// Displays cm_billing_periods - one row per (enrollment, billing_month).
//
// Data pipeline: supabase.rpc("cm_rollup_practice_billing", { practice, month })
// aggregates qualifying touchpoints (counts_toward_tcm_contact) into billing
// period rows, computing readiness flags and claim_status.
//
// v1 simplified rules:
//   - required_contacts_total = 1 for any Active TCM or AMH enrollment
//   - meets_contact_requirements = actual >= required
//   - has_care_manager_majority = care_manager_count >= ceil(total / 2)
//   - Ready when: meets + CM majority + no duplicative
//
// Claim lifecycle (simplified): Not Ready -> Ready (auto) -> Submitted (manual)
//   -> Paid / Denied. No appeal/void UI in v1.
//
// Month is normalized to first-of-month. Prev/next buttons shift by calendar
// month. "Recompute this month" calls the rollup RPC and reloads.
// ===============================================================================
