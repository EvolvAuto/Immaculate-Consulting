import { useState, useEffect, useMemo } from "react";
import { supabase } from "../../lib/supabaseClient";
import { C } from "../../lib/tokens";
import { Badge, Btn, Card, Loader, EmptyState, ErrorBanner } from "../../components/ui";
import { KpiCard, PlanStatusBadge, Th, Td } from "./shared";
import PlanDetailModal from "./PlanDetailModal";
import NewPlanModal from "./NewPlanModal";

// ===============================================================================
// PlansTab - manages cm_care_plans (formal care plans linked to enrollments).
//
// Plan types (cm_plan_type enum):
//   - Care Plan (generic TCM)
//   - Individual Support Plan (IDD populations)
//   - AMH Tier 3 Care Plan (Standard Plan)
//   - Comprehensive Assessment (intake-era)
//   - 90-Day Transition Plan (institutional discharge)
//
// Plans have status (Draft/Active/Archived/Superseded) and track review
// cadence via next_review_due. "Overdue review" = status='Active' AND
// next_review_due is in the past.
// ===============================================================================

export default function PlansTab({ practiceId, profile }) {
  const [plans, setPlans]                 = useState([]);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState(null);
  const [statusFilter, setStatusFilter]   = useState("all");
  const [planTypeFilter, setPlanTypeFilter] = useState("all");
  const [selected, setSelected]           = useState(null);
  const [showNewPlan, setShowNewPlan]     = useState(false);

  const role = profile?.role;
  const canCreate = role && role !== "CHW";

  const load = () => {
    if (!practiceId) return;
    setLoading(true);
    supabase
      .from("cm_care_plans")
      .select("id, patient_id, enrollment_id, plan_type, plan_status, version, assessment_date, last_reviewed_at, next_review_due, effective_date, expires_at, goals, interventions, unmet_needs, risk_factors, strengths, supports, medications_reviewed, ai_drafted, ai_draft_model, ai_draft_at, ai_draft_prompt_version, human_reviewed_at, human_reviewed_by, human_reviewer_role, prior_plan_id, review_summary, member_ack_at, member_ack_method, member_ack_notes, member_ack_by, member_ack_role, document_url, document_storage_path, document_generated_at, portal_shared_at, portal_shared_by, notes, created_at, patients(first_name, last_name, mrn), cm_enrollments(program_type, health_plan_type, cm_provider_type)")
      .eq("practice_id", practiceId)
      .order("created_at", { ascending: false })
      .then(({ data, error: e }) => {
        if (e) setError(e.message);
        else setPlans(data || []);
        setLoading(false);
      });
  };

  useEffect(() => { load(); }, [practiceId]);

  const today = new Date().toISOString().split("T")[0];

  const kpis = useMemo(() => {
    const active = plans.filter(p => p.plan_status === "Active");
    const drafts = plans.filter(p => p.plan_status === "Draft");
    const overdueReview = active.filter(p => p.next_review_due && p.next_review_due < today);
    return {
      total:         plans.length,
      active:        active.length,
      drafts:        drafts.length,
      overdueReview: overdueReview.length,
    };
  }, [plans, today]);

  const filtered = useMemo(() => {
    return plans.filter(p => {
      if (statusFilter !== "all" && p.plan_status !== statusFilter) return false;
      if (planTypeFilter !== "all" && p.plan_type !== planTypeFilter) return false;
      return true;
    });
  }, [plans, statusFilter, planTypeFilter]);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
        <KpiCard label="Total plans"    value={kpis.total} />
        <KpiCard label="Active"         value={kpis.active}        hint="Active care plans" />
        <KpiCard label="Drafts"         value={kpis.drafts}        hint="Not yet activated" variant={kpis.drafts > 0 ? "amber" : "neutral"} />
        <KpiCard label="Review overdue" value={kpis.overdueReview} hint="Active plans past next_review_due" variant={kpis.overdueReview > 0 ? "amber" : "neutral"} />
      </div>

      <Card style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, padding: 12 }}>
        <div style={{ display: "flex", gap: 6 }}>
          {["all", "Draft", "Active", "Archived", "Superseded"].map(s => (
            <Btn key={s} size="sm" variant={statusFilter === s ? "primary" : "ghost"} onClick={() => setStatusFilter(s)}>
              {s === "all" ? "All statuses" : s}
            </Btn>
          ))}
        </div>
        <select value={planTypeFilter} onChange={e => setPlanTypeFilter(e.target.value)} style={{ ...selectStyle, width: 240 }}>
          <option value="all">All plan types</option>
          <option value="Care Plan">Care Plan</option>
          <option value="Individual Support Plan">Individual Support Plan</option>
          <option value="AMH Tier 3 Care Plan">AMH Tier 3 Care Plan</option>
          <option value="Comprehensive Assessment">Comprehensive Assessment</option>
          <option value="90-Day Transition Plan">90-Day Transition Plan</option>
        </select>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {canCreate && (
            <Btn variant="primary" size="sm" onClick={() => setShowNewPlan(true)}>+ New plan</Btn>
          )}
          <Btn variant="outline" size="sm" onClick={load}>Refresh</Btn>
        </div>
      </Card>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <Card>
        {loading ? (
          <Loader label="Loading care plans..." />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No care plans yet"
            message={plans.length === 0 ? "Create the first care plan from an active enrollment." : "No plans match the current filters."}
          />
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                <Th>Patient</Th>
                <Th>Plan type</Th>
                <Th>Status</Th>
                <Th align="right">Version</Th>
                <Th align="right">Assessment</Th>
                <Th align="right">Last reviewed</Th>
                <Th align="right">Next review</Th>
                <Th align="right">Goals</Th>
                <Th>Flags</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(plan => {
                const overdueReview = plan.plan_status === "Active" && plan.next_review_due && plan.next_review_due < today;
                const goalsCount = Array.isArray(plan.goals) ? plan.goals.length : 0;
                return (
                  <tr key={plan.id} onClick={() => setSelected(plan)} style={{ cursor: "pointer" }}>
                    <Td>
                      <div style={{ fontWeight: 600 }}>
                        {plan.patients?.last_name || ""}, {plan.patients?.first_name || ""}
                      </div>
                      {plan.patients?.mrn && (
                        <div style={{ fontSize: 11, color: C.textTertiary, fontFamily: "monospace", marginTop: 2 }}>{plan.patients.mrn}</div>
                      )}
                    </Td>
                    <Td>{plan.plan_type}</Td>
                    <Td><PlanStatusBadge status={plan.plan_status} /></Td>
                    <Td align="right" style={{ color: C.textSecondary }}>v{plan.version}</Td>
                    <Td align="right" style={{ color: C.textSecondary }}>
                      {plan.assessment_date ? new Date(plan.assessment_date).toLocaleDateString() : "-"}
                    </Td>
                    <Td align="right" style={{ color: C.textSecondary }}>
                      {plan.last_reviewed_at ? new Date(plan.last_reviewed_at).toLocaleDateString() : "-"}
                    </Td>
                    <Td align="right" style={{ color: overdueReview ? C.red : C.textSecondary, fontWeight: overdueReview ? 700 : 400 }}>
                      {plan.next_review_due ? new Date(plan.next_review_due).toLocaleDateString() : "-"}
                    </Td>
                    <Td align="right">{goalsCount}</Td>
                    <Td>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {overdueReview && <Badge label="REVIEW DUE" variant="red" size="xs" />}
                        {plan.ai_drafted && !plan.human_reviewed_at && <Badge label="AI DRAFT" variant="amber" size="xs" />}
                        {plan.member_ack_at && <Badge label="MEMBER ACK" variant="green" size="xs" />}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {selected && (
        <PlanDetailModal plan={selected} profile={profile} onClose={() => setSelected(null)} onUpdated={() => { setSelected(null); load(); }} />
      )}
      {showNewPlan && (
        <NewPlanModal
          practiceId={practiceId}
          userId={profile?.id}
          onClose={() => setShowNewPlan(false)}
          onCreated={() => { setShowNewPlan(false); load(); }}
        />
      )}
    </div>
  );
}


// ---------------------------------------------------------------------------
// PlanDetailModal - read-only view of a care plan with all JSONB collections
// rendered as plain lists. Quick-action buttons for status transitions.
// ---------------------------------------------------------------------------
