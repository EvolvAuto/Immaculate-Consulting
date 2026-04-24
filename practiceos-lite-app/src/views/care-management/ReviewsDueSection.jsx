import { useMemo } from "react";
import { C } from "../../lib/tokens";
import { Btn } from "../../components/ui";

// ===============================================================================
// ReviewsDueSection - surfaces Active plans whose next_review_due has passed
// so CMs can kick off annual reviews without hunting through the full plans
// table. Clicking a row selects the plan in the parent (PlansTab), which
// opens PlanDetailModal where the user clicks "Start annual review" to
// launch AnnualReviewDrafter.
//
// Pure presentational - no data loading of its own. Parent passes the already-
// loaded plans array + a setter; this component filters and renders.
// Renders null when no overdue reviews exist (section simply disappears).
// ===============================================================================

export default function ReviewsDueSection({ plans, onSelectPlan }) {
  const overdue = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return (plans || [])
      .filter(p => p.plan_status === "Active" && p.next_review_due && new Date(p.next_review_due) <= today)
      .sort((a, b) => new Date(a.next_review_due) - new Date(b.next_review_due));
  }, [plans]);

  if (overdue.length === 0) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <div style={{
      marginBottom: 16,
      padding: 14,
      background: "#FEF3C7",
      border: "0.5px solid #F59E0B",
      borderRadius: 10,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10, gap: 8, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#854F0B" }}>
            Annual reviews due
          </div>
          <div style={{ fontSize: 13, color: C.textPrimary, marginTop: 2 }}>
            {overdue.length} {overdue.length === 1 ? "plan has" : "plans have"} passed the review date. Open any plan and click "Start annual review" to launch the drafter.
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {overdue.map(plan => {
          const dueDate = new Date(plan.next_review_due);
          const daysOverdue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));
          const verySlipped = daysOverdue >= 30;
          const patientName = plan.patients
            ? ((plan.patients.last_name || "") + ", " + (plan.patients.first_name || ""))
            : "(Unknown patient)";

          return (
            <div
              key={plan.id}
              onClick={() => onSelectPlan && onSelectPlan(plan)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "8px 12px",
                background: C.bgPrimary,
                borderRadius: 8,
                border: "0.5px solid " + (verySlipped ? "#DC2626" : "#F59E0B"),
                cursor: "pointer",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {patientName}
                </div>
                <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>
                  {plan.plan_type} &middot; v{plan.version} &middot; due {dueDate.toLocaleDateString()}
                </div>
              </div>
              <div style={{
                fontSize: 11,
                fontWeight: 700,
                color: verySlipped ? "#DC2626" : "#854F0B",
                whiteSpace: "nowrap",
              }}>
                {daysOverdue === 0 ? "Due today" : daysOverdue + " day" + (daysOverdue === 1 ? "" : "s") + " overdue"}
              </div>
              <Btn size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onSelectPlan && onSelectPlan(plan); }}>
                Review &rarr;
              </Btn>
            </div>
          );
        })}
      </div>
    </div>
  );
}
