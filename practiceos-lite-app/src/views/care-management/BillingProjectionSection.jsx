import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "../../lib/supabaseClient";
import { C } from "../../lib/tokens";
import { Badge, Btn, Card, Loader } from "../../components/ui";
import { AcuityBadge } from "./shared";

// ===============================================================================
// BillingProjectionSection - proactive current-month TCM billing-floor tracker.
// Surfaces Active enrollments whose current-month cm_billing_periods row does
// not yet meet the contact requirement, sorted by urgency (smallest gap with
// least days left first). Each row offers a per-enrollment "Explain with AI"
// that calls cmp-billing-projection-explain and renders the verdict + specific
// recommended actions inline.
//
// The projection math is deterministic (gap = required - actual, from the
// cm_billing_periods row already computed by the billing rollup trigger).
// Claude is used only for the interpretive layer: narrative, urgency sanity-
// check, and specific action recommendations grounded in the engagement
// pattern.
//
// Hidden when the BillingTab is viewing a historical month (viewedMonth !=
// current-month-first). This is a "what do I do TODAY" surface, not a
// retrospective.
// ===============================================================================

export default function BillingProjectionSection({ practiceId, viewedMonth }) {
  // Determine whether we are viewing the current month. If not, render nothing.
  const isCurrentMonth = useMemo(() => {
    if (!viewedMonth) return false;
    const now = new Date();
    const cur = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const v = new Date(viewedMonth);
    return cur.toISOString().split("T")[0] === v.toISOString().split("T")[0];
  }, [viewedMonth]);

  // Days left in month (inclusive of today). Used for row-level urgency coloring.
  const daysLeft = useMemo(() => {
    const now = new Date();
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
    return Math.max(0, monthEnd.getUTCDate() - now.getUTCDate());
  }, []);

  const [rows, setRows]                 = useState([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState(null);
  const [expandedId, setExpandedId]     = useState(null);
  const [aiState, setAiState]           = useState({}); // { [enrollment_id]: { busy, result, error, overloaded } }

  const load = useCallback(async () => {
    if (!practiceId || !isCurrentMonth) { setRows([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const now = new Date();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const monthStartStr = monthStart.toISOString().split("T")[0];

      const { data, error: e1 } = await supabase
        .from("cm_billing_periods")
        .select("id, enrollment_id, billing_month, required_contacts_total, actual_contacts_total, meets_contact_requirements, has_care_manager_majority, claim_status, cm_enrollments(id, enrollment_status, acuity_tier, program_type, health_plan_type, patient_id, patients(first_name, last_name))")
        .eq("practice_id", practiceId)
        .eq("billing_month", monthStartStr);
      if (e1) throw e1;

      // Keep only Active enrollments (billable universe for the current month).
      const kept = (data || []).filter(p => p.cm_enrollments?.enrollment_status === "Active");
      setRows(kept);
    } catch (err) {
      setError(err.message || "Failed to load projections");
    } finally {
      setLoading(false);
    }
  }, [practiceId, isCurrentMonth]);

  useEffect(() => { load(); }, [load]);

  // Per-row urgency based on gap + days left. Deterministic. Claude can
  // override when the CM clicks "Explain", but we color the row up front so
  // the at-risk set is legible without clicking anything.
  const scored = useMemo(() => {
    const scoredRows = rows.map(p => {
      const gap = Math.max(0, (p.required_contacts_total || 0) - (p.actual_contacts_total || 0));
      const met = p.meets_contact_requirements && p.has_care_manager_majority;
      let urgency = "low";
      if (!met && gap > 0) {
        if (daysLeft <= 3)       urgency = "critical";
        else if (daysLeft <= 7)  urgency = "high";
        else if (daysLeft <= 15) urgency = "medium";
        else                     urgency = "low";
      }
      return { ...p, gap, met, urgency };
    });
    // Sort: not-met first, then by urgency weight, then by gap desc.
    const weight = { critical: 4, high: 3, medium: 2, low: 1 };
    return scoredRows.sort((a, b) => {
      if (a.met !== b.met) return a.met ? 1 : -1;
      if (a.urgency !== b.urgency) return (weight[b.urgency] || 0) - (weight[a.urgency] || 0);
      return b.gap - a.gap;
    });
  }, [rows, daysLeft]);

  const atRisk  = scored.filter(r => !r.met && r.gap > 0);
  const already = scored.filter(r => r.met);

  const handleExplain = async (enrollmentId) => {
    setAiState(prev => ({ ...prev, [enrollmentId]: { busy: true, result: null, error: null, overloaded: false } }));
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) throw new Error("Not authenticated");
      const url = supabase.supabaseUrl + "/functions/v1/cmp-billing-projection-explain";
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": "Bearer " + token,
        },
        body: JSON.stringify({ enrollment_id: enrollmentId }),
      });
      const body = await res.json();
      if (!res.ok || body.error) {
        const err = new Error(body.error || "HTTP " + res.status);
        err.overloaded = body.overloaded === true;
        throw err;
      }
      setAiState(prev => ({ ...prev, [enrollmentId]: { busy: false, result: body, error: null, overloaded: false } }));
      setExpandedId(enrollmentId);
    } catch (e) {
      setAiState(prev => ({ ...prev, [enrollmentId]: { busy: false, result: null, error: e.message || "AI explain failed", overloaded: e.overloaded === true } }));
      setExpandedId(enrollmentId);
    }
  };

  if (!isCurrentMonth) return null;
  if (loading) {
    return (
      <Card style={{ marginBottom: 16 }}>
        <Loader label="Loading current-month projections..." />
      </Card>
    );
  }

  return (
    <Card style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "12px 14px", borderBottom: "0.5px solid " + C.borderLight, gap: 8, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textSecondary }}>
            Current-month projection
          </div>
          <div style={{ fontSize: 13, color: C.textPrimary, marginTop: 2 }}>
            {atRisk.length === 0
              ? "All Active enrollments meet the contact floor with CM majority."
              : atRisk.length + (atRisk.length === 1 ? " enrollment" : " enrollments") + " short of this month's floor &middot; " + daysLeft + " day" + (daysLeft === 1 ? "" : "s") + " left"}
          </div>
        </div>
        <Btn variant="outline" size="sm" onClick={load}>Refresh</Btn>
      </div>

      {error && (
        <div style={{ margin: 12, fontSize: 12, color: C.red, background: C.redBg, padding: "8px 10px", borderRadius: 6, border: "0.5px solid " + C.redBorder }}>
          {error}
        </div>
      )}

      {atRisk.length > 0 && (
        <div style={{ padding: 8 }}>
          {atRisk.map(p => (
            <ProjectionRow
              key={p.id}
              period={p}
              daysLeft={daysLeft}
              expanded={expandedId === p.enrollment_id}
              onToggle={() => setExpandedId(expandedId === p.enrollment_id ? null : p.enrollment_id)}
              onExplain={() => handleExplain(p.enrollment_id)}
              ai={aiState[p.enrollment_id]}
            />
          ))}
        </div>
      )}

      {already.length > 0 && atRisk.length > 0 && (
        <div style={{ padding: "8px 14px", fontSize: 11, color: C.textTertiary, borderTop: "0.5px solid " + C.borderLight }}>
          {already.length} enrollment{already.length === 1 ? "" : "s"} already meet this month's floor.
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// ProjectionRow - single enrollment row. Compact view shows patient + gap +
// urgency pill + Explain button. Expanded view shows the AI narrative +
// recommended actions inline.
// ---------------------------------------------------------------------------
function ProjectionRow({ period, daysLeft, expanded, onToggle, onExplain, ai }) {
  const enrollment = period.cm_enrollments || {};
  const patient = enrollment.patients || {};
  const name = (patient.last_name || "") + ", " + (patient.first_name || "");
  const urgColors = {
    critical: { bg: "#FEE2E2", border: "#DC2626", text: "#991B1B" },
    high:     { bg: "#FED7AA", border: "#EA580C", text: "#9A3412" },
    medium:   { bg: "#FEF3C7", border: "#F59E0B", text: "#854F0B" },
    low:      { bg: C.bgSecondary, border: C.borderLight, text: C.textSecondary },
  };
  const uc = urgColors[period.urgency] || urgColors.low;

  return (
    <div style={{
      border: "0.5px solid " + uc.border,
      background: uc.bg,
      borderRadius: 8,
      marginBottom: 6,
      overflow: "hidden",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {name}
          </div>
          <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <AcuityBadge tier={enrollment.acuity_tier} />
            <span>{enrollment.program_type}</span>
            <span>&middot;</span>
            <span style={{ fontWeight: 600, color: uc.text }}>
              {period.actual_contacts_total} / {period.required_contacts_total} contacts
            </span>
            {!period.has_care_manager_majority && (
              <>
                <span>&middot;</span>
                <Badge label="CM majority gap" variant="amber" size="xs" />
              </>
            )}
          </div>
        </div>
        <div style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: uc.text,
          padding: "3px 8px",
          border: "0.5px solid " + uc.border,
          borderRadius: 12,
          whiteSpace: "nowrap",
        }}>
          {period.urgency} &middot; {daysLeft}d left
        </div>
        <Btn
          size="sm"
          variant={expanded ? "ghost" : "outline"}
          disabled={ai?.busy}
          onClick={expanded ? onToggle : onExplain}
        >
          {ai?.busy ? "Analyzing..." : (expanded ? "Hide" : "Explain with AI")}
        </Btn>
      </div>

      {expanded && ai && (
        <div style={{ padding: 12, borderTop: "0.5px solid " + uc.border, background: C.bgPrimary }}>
          {ai.error && (
            <div style={{
              fontSize: 12, padding: "8px 10px", borderRadius: 6, marginBottom: 10,
              color:      ai.overloaded ? "#854F0B" : C.red,
              background: ai.overloaded ? "#FEF3C7" : C.redBg,
              border:     "0.5px solid " + (ai.overloaded ? "#F59E0B" : C.redBorder),
            }}>
              {ai.overloaded ? "\u26A0 " : ""}{ai.error}
            </div>
          )}
          {ai.result && <ProjectionResultCard result={ai.result} />}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProjectionResultCard - renders the verdict, headline, narrative, barriers,
// and recommended actions from cmp-billing-projection-explain.
// ---------------------------------------------------------------------------
function ProjectionResultCard({ result }) {
  const verdictColors = {
    will_miss:    { bg: "#FEE2E2", text: "#991B1B" },
    at_risk:      { bg: "#FED7AA", text: "#9A3412" },
    on_track:     { bg: "#DBEAFE", text: "#1E40AF" },
    already_met:  { bg: "#D1FAE5", text: "#065F46" },
  };
  const vc = verdictColors[result.verdict] || verdictColors.at_risk;
  const actions = Array.isArray(result.recommended_actions) ? result.recommended_actions : [];
  const barriers = Array.isArray(result.barriers_observed) ? result.barriers_observed : [];
  const caveats = Array.isArray(result.confidence_caveats) ? result.confidence_caveats : [];
  const gap = result.gap_analysis || {};

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <span style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: vc.text,
          background: vc.bg,
          padding: "3px 8px",
          borderRadius: 10,
          whiteSpace: "nowrap",
        }}>
          {(result.verdict || "").replace(/_/g, " ")}
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>
          {result.headline}
        </span>
      </div>

      {result.narrative && (
        <div style={{ fontSize: 13, color: C.textPrimary, lineHeight: 1.55, marginBottom: 10 }}>
          {result.narrative}
        </div>
      )}

      {gap.in_person_gap_note && (
        <div style={{ fontSize: 12, color: "#854F0B", background: "#FEF3C7", padding: "6px 10px", borderRadius: 6, marginBottom: 10, border: "0.5px solid #F59E0B" }}>
          In-person gap: {gap.in_person_gap_note}
        </div>
      )}

      {barriers.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 4 }}>
            Barriers observed
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: C.textSecondary }}>
            {barriers.map((b, i) => <li key={i} style={{ marginBottom: 2 }}>{b}</li>)}
          </ul>
        </div>
      )}

      {actions.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 4 }}>
            Recommended actions
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {actions.map((a, i) => (
              <div key={i} style={{ padding: 8, background: C.bgSecondary, borderRadius: 6, fontSize: 12 }}>
                <div style={{ color: C.textPrimary, fontWeight: 500 }}>{a.action}</div>
                <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 3, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <Badge label={a.owner} variant="neutral" size="xs" />
                  <span>&middot;</span>
                  <span>{(a.timing || "").replace(/_/g, " ")}</span>
                  {a.counts_toward_floor && (
                    <>
                      <span>&middot;</span>
                      <Badge label="Counts toward floor" variant="green" size="xs" />
                    </>
                  )}
                </div>
                {a.rationale && (
                  <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 4, fontStyle: "italic" }}>
                    {a.rationale}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {caveats.length > 0 && (
        <div style={{ fontSize: 11, color: C.textTertiary, fontStyle: "italic", marginTop: 8 }}>
          Confidence: {result.confidence}. {caveats.join("; ")}.
        </div>
      )}
    </div>
  );
}
