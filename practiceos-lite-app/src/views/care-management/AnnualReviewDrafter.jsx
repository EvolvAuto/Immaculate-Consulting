import { useState, useRef, useEffect } from "react";
import { supabase } from "../../lib/supabaseClient";
import { C } from "../../lib/tokens";
import { Badge, Btn, ErrorBanner, FL } from "../../components/ui";
import { inputStyle } from "./shared";

// ===============================================================================
// AnnualReviewDrafter - calls cmp-draft-annual-review, presents the draft
// for human review (edit/accept/reject), and on accept inserts a new
// cm_care_plans row with prior_plan_id set. The DB trigger auto-supersedes
// the prior plan.
//
// CRITICAL DEFENSIVE HANDLING: the AI is fed prior_plan.goals as full
// objects ({goal, domain, measure, rationale, priority, ...}). Sometimes
// the model echoes those objects verbatim into goals_met[].goal etc.
// instead of extracting the text. React #31 (Objects are not valid as a
// React child) results. safeText() coerces any value (string/object/array/
// null) to a renderable string so the UI never crashes regardless of what
// the model returns.
// ===============================================================================

// Coerce any value to a renderable string. Handles:
//   - strings/numbers/booleans -> as-is
//   - null/undefined           -> ""
//   - arrays                   -> joined with ", "
//   - objects                  -> first non-empty string-valued field among
//                                 common goal/event/desc keys, falling back
//                                 to JSON for diagnostics
function safeText(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(safeText).filter(Boolean).join(", ");
  if (typeof v === "object") {
    // Common text-bearing keys in our domain
    const keys = ["text", "goal", "description", "name", "event", "label", "title", "value"];
    for (const k of keys) {
      if (typeof v[k] === "string" && v[k].trim()) return v[k];
    }
    // Last-resort: stringify but cap length so a malformed blob doesn't
    // blow up the layout
    try {
      const s = JSON.stringify(v);
      return s.length > 200 ? s.slice(0, 200) + "..." : s;
    } catch {
      return "[unrenderable]";
    }
  }
  return String(v);
}

export default function AnnualReviewDrafter({ priorPlan, userId, onCancel, onSaved }) {
  const [drafting, setDrafting]   = useState(false);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState(null);
  const [aiOverloaded, setAiOverloaded] = useState(false);
  const [draft, setDraft]         = useState(null);
  const [context, setContext]     = useState(null);
  const [modelMeta, setModelMeta] = useState(null);

  const [overallAssessment, setOverallAssessment] = useState("");
  const [reviewerNotes, setReviewerNotes]         = useState("");
  const [nextReviewDue, setNextReviewDue]         = useState("");

  // Auto-resize the overall assessment textarea to fit its content. Fires
  // whenever the AI populates it on draft load OR the reviewer edits it.
  // Resets height to auto first so the box can shrink as well as grow.
  const overallRef = useRef(null);
  useEffect(() => {
    const el = overallRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [overallAssessment]);

  const handleDraft = async () => {
    setDrafting(true);
    setError(null);
    setAiOverloaded(false);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const url = supabase.supabaseUrl + "/functions/v1/cmp-draft-annual-review";
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": "Bearer " + token,
        },
        body: JSON.stringify({ prior_plan_id: priorPlan.id }),
      });
      const body = await res.json();
      if (!res.ok || body.error) {
        const err = new Error(body.error || "HTTP " + res.status);
        err.overloaded = body.overloaded === true;
        throw err;
      }

      setDraft(body.draft || null);
      setContext(body.context || null);
      setModelMeta({
        model: body.model_used,
        prompt_version: body.prompt_version,
        generated_at: body.generated_at,
      });
      setOverallAssessment(safeText(body.draft?.review_summary?.overall_assessment));
      setNextReviewDue(safeText(body.draft?.refreshed_plan?.suggested_next_review_due));
      setReviewerNotes("");
    } catch (e) {
      setError(e.message || "Draft failed");
      setAiOverloaded(e.overloaded === true);
    } finally {
      setDrafting(false);
    }
  };

  const handleAccept = async () => {
    if (!draft) { setError("No draft to save"); return; }
    setSaving(true);
    setError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const url = supabase.supabaseUrl + "/functions/v1/cmp-save-annual-review";
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": "Bearer " + token,
        },
        body: JSON.stringify({
          prior_plan_id:   priorPlan.id,
          refreshed_plan:  draft.refreshed_plan || {},
          review_summary:  { ...draft.review_summary, overall_assessment: overallAssessment || draft.review_summary?.overall_assessment || "" },
          next_review_due: nextReviewDue || null,
          reviewer_notes:  reviewerNotes.trim() || null,
          model_meta:      modelMeta || {},
        }),
      });
      const body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || "HTTP " + res.status);
      if (onSaved) onSaved();
    } catch (e) {
      setError(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (!draft) {
    const priorGoalCount = Array.isArray(priorPlan.goals) ? priorPlan.goals.length : 0;
    const priorAssessmentDate = priorPlan.assessment_date || priorPlan.created_at;
    return (
      <div>
        {error && (aiOverloaded ? (
          <div style={{ marginBottom: 16, fontSize: 12, padding: "10px 12px", borderRadius: 8, color: "#854F0B", background: "#FEF3C7", border: "0.5px solid #F59E0B" }}>
            {"\u26A0 " + error}
          </div>
        ) : <ErrorBanner message={error} onDismiss={() => { setError(null); setAiOverloaded(false); }} />)}
        <div style={{ padding: 14, marginBottom: 16, background: "#f0f9ff", border: "0.5px solid #bae6fd", borderRadius: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#075985", marginBottom: 6 }}>
            Ready to draft annual review
          </div>
          <div style={{ fontSize: 13, color: C.textPrimary, lineHeight: 1.55 }}>
            This will review <strong>v{priorPlan.version}</strong> (assessed {priorAssessmentDate ? new Date(priorAssessmentDate).toLocaleDateString() : "-"}) with
            <strong> {priorGoalCount} goal{priorGoalCount === 1 ? "" : "s"}</strong>.
            Claude will pull every touchpoint, HRSN screening, billing month, and risk assessment since that date and draft a review for your approval. You'll edit before saving. Approximate cost: 3-5 cents.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Btn variant="ghost" size="sm" onClick={onCancel}>Back</Btn>
          <Btn variant="primary" size="sm" disabled={drafting} onClick={handleDraft}>
            {drafting ? "Drafting (~30 seconds)..." : "Draft review"}
          </Btn>
        </div>
      </div>
    );
  }

  const rs = draft.review_summary || {};
  const rp = draft.refreshed_plan || {};
  const goalsMet        = Array.isArray(rs.goals_met)         ? rs.goals_met         : [];
  const goalsNotMet     = Array.isArray(rs.goals_not_met)     ? rs.goals_not_met     : [];
  const goalsCarried    = Array.isArray(rs.goals_carried_over) ? rs.goals_carried_over : [];
  const goalsRemoved    = Array.isArray(rs.goals_removed)     ? rs.goals_removed     : [];
  const keyEvents       = Array.isArray(rs.key_events)        ? rs.key_events        : [];
  const refreshedGoals  = Array.isArray(rp.goals)             ? rp.goals             : [];
  const refreshedInts   = Array.isArray(rp.interventions)     ? rp.interventions     : [];
  const refreshedNeeds  = Array.isArray(rp.unmet_needs)       ? rp.unmet_needs       : [];
  const confCaveats     = Array.isArray(draft.confidence_caveats) ? draft.confidence_caveats : [];

  return (
    <div>
      {error && (aiOverloaded ? (
        <div style={{ marginBottom: 16, fontSize: 12, padding: "10px 12px", borderRadius: 8, color: "#854F0B", background: "#FEF3C7", border: "0.5px solid #F59E0B" }}>
          {"\u26A0 " + error}
        </div>
      ) : <ErrorBanner message={error} onDismiss={() => { setError(null); setAiOverloaded(false); }} />)}

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textSecondary }}>
            Review draft
          </div>
          {rs.period_covered && (
            <div style={{ fontSize: 13, color: C.textPrimary, marginTop: 2 }}>{safeText(rs.period_covered)}</div>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {draft.confidence && (
            <Badge label={"CONFIDENCE " + String(draft.confidence).toUpperCase()} variant={draft.confidence === "high" ? "green" : draft.confidence === "medium" ? "amber" : "red"} size="xs" />
          )}
          {rs.interim_review_recommended && (
            <Badge label="INTERIM REVIEW RECOMMENDED" variant="amber" size="xs" />
          )}
          {rs.medications_need_review && (
            <Badge label="MED REVIEW" variant="amber" size="xs" />
          )}
          <Btn variant="outline" size="sm" disabled={drafting} onClick={handleDraft}>
            {drafting ? "..." : "Re-draft"}
          </Btn>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <FL>Overall assessment</FL>
        <textarea
          ref={overallRef}
          value={overallAssessment}
          onChange={e => setOverallAssessment(e.target.value)}
          rows={1}
          style={{ ...inputStyle, fontFamily: "inherit", overflow: "hidden", minHeight: 60, lineHeight: 1.5 }}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 6 }}>
            Prior period review
          </div>
          {goalsMet.length > 0 && (
            <ReviewGroup title={"Goals met (" + goalsMet.length + ")"} tone="green">
              {goalsMet.map((g, i) => (
                <div key={i} style={{ fontSize: 12, color: C.textPrimary, marginBottom: 4 }}>
                  <strong>{safeText(g.goal)}</strong>
                  {g.evidence && <div style={{ fontSize: 11, color: C.textTertiary }}>{safeText(g.evidence)}</div>}
                </div>
              ))}
            </ReviewGroup>
          )}
          {goalsNotMet.length > 0 && (
            <ReviewGroup title={"Goals not met (" + goalsNotMet.length + ")"} tone="red">
              {goalsNotMet.map((g, i) => (
                <div key={i} style={{ fontSize: 12, color: C.textPrimary, marginBottom: 4 }}>
                  <strong>{safeText(g.goal)}</strong>
                  {g.reason && <div style={{ fontSize: 11, color: C.textTertiary }}>Reason: {safeText(g.reason)}</div>}
                  {g.recommendation && <div style={{ fontSize: 11, color: C.textTertiary }}>Rec: {String(safeText(g.recommendation)).replace(/_/g, " ")}</div>}
                </div>
              ))}
            </ReviewGroup>
          )}
          {goalsCarried.length > 0 && (
            <ReviewGroup title={"Carry over (" + goalsCarried.length + ")"} tone="blue">
              {goalsCarried.map((g, i) => (
                <div key={i} style={{ fontSize: 12, color: C.textPrimary, marginBottom: 4 }}>
                  <strong>{safeText(g.goal)}</strong>
                  {g.rationale && <div style={{ fontSize: 11, color: C.textTertiary }}>{safeText(g.rationale)}</div>}
                </div>
              ))}
            </ReviewGroup>
          )}
          {goalsRemoved.length > 0 && (
            <ReviewGroup title={"Removed (" + goalsRemoved.length + ")"} tone="neutral">
              {goalsRemoved.map((g, i) => (
                <div key={i} style={{ fontSize: 12, color: C.textPrimary, marginBottom: 4 }}>
                  <strong>{safeText(g.goal)}</strong>
                  {g.reason && <div style={{ fontSize: 11, color: C.textTertiary }}>{safeText(g.reason)}</div>}
                </div>
              ))}
            </ReviewGroup>
          )}
          {keyEvents.length > 0 && (
            <ReviewGroup title={"Key events (" + keyEvents.length + ")"} tone="amber">
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: C.textPrimary }}>
                {keyEvents.map((ev, i) => <li key={i}>{safeText(ev)}</li>)}
              </ul>
            </ReviewGroup>
          )}
        </div>

        <div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 6 }}>
            Refreshed plan
          </div>
          {refreshedGoals.length > 0 && (
            <ReviewGroup title={"Goals (" + refreshedGoals.length + ")"} tone="blue">
              {refreshedGoals.map((g, i) => (
                <div key={i} style={{ fontSize: 12, color: C.textPrimary, marginBottom: 6 }}>
                  <div style={{ display: "flex", gap: 4, alignItems: "baseline", flexWrap: "wrap", marginBottom: 2 }}>
                    {g.priority && <Badge label={String(safeText(g.priority)).toUpperCase()} variant={g.priority === "high" ? "red" : g.priority === "medium" ? "amber" : "neutral"} size="xs" />}
                    {g.source && <Badge label={String(safeText(g.source)).replace(/_/g, " ").toUpperCase()} variant="neutral" size="xs" />}
                    {g.domain && <span style={{ fontSize: 10, color: C.textTertiary }}>{safeText(g.domain)}</span>}
                  </div>
                  <strong>{safeText(g.goal)}</strong>
                  {g.target_date && <div style={{ fontSize: 11, color: C.textTertiary }}>Target: {safeText(g.target_date)}</div>}
                  {g.rationale && <div style={{ fontSize: 11, color: C.textTertiary }}>{safeText(g.rationale)}</div>}
                </div>
              ))}
            </ReviewGroup>
          )}
          {refreshedInts.length > 0 && (
            <ReviewGroup title={"Interventions (" + refreshedInts.length + ")"} tone="neutral">
              {refreshedInts.map((iv, i) => (
                <div key={i} style={{ fontSize: 12, color: C.textPrimary, marginBottom: 4 }}>
                  <strong>{safeText(iv.intervention)}</strong>
                  <div style={{ fontSize: 11, color: C.textTertiary }}>
                    {iv.owner && <span>Owner: {String(safeText(iv.owner)).replace(/_/g, " ")} </span>}
                    {iv.frequency && <span>/ {safeText(iv.frequency)}</span>}
                  </div>
                </div>
              ))}
            </ReviewGroup>
          )}
          {refreshedNeeds.length > 0 && (
            <ReviewGroup title={"Unmet needs (" + refreshedNeeds.length + ")"} tone="amber">
              {refreshedNeeds.map((n, i) => (
                <div key={i} style={{ fontSize: 12, color: C.textPrimary, marginBottom: 4 }}>
                  <strong>{safeText(n.need)}</strong>
                  {n.category && <span style={{ fontSize: 10, color: C.textTertiary }}> ({safeText(n.category)})</span>}
                  {n.plan_to_address && <div style={{ fontSize: 11, color: C.textTertiary }}>{safeText(n.plan_to_address)}</div>}
                </div>
              ))}
            </ReviewGroup>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <div>
          <FL>Next review due</FL>
          <input type="date" value={nextReviewDue} onChange={e => setNextReviewDue(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <FL>Reviewer notes (optional)</FL>
          <input type="text" value={reviewerNotes} onChange={e => setReviewerNotes(e.target.value)} placeholder="Anything worth flagging to supervising CM" style={inputStyle} />
        </div>
      </div>

      {confCaveats.length > 0 && (
        <div style={{ marginBottom: 14, padding: 8, background: C.amberBg, border: "0.5px solid " + C.amberBorder, borderRadius: 6, fontSize: 11, color: C.textSecondary }}>
          <strong>Caveats:</strong> {confCaveats.map(safeText).join(" / ")}
        </div>
      )}

      {modelMeta && modelMeta.generated_at && (
        <div style={{ fontSize: 10, color: C.textTertiary, textAlign: "right", marginBottom: 10 }}>
          Drafted {new Date(modelMeta.generated_at).toLocaleString()}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", paddingTop: 12, borderTop: "0.5px solid " + C.borderLight }}>
        <Btn variant="ghost" size="sm" onClick={onCancel}>Cancel</Btn>
        <Btn variant="primary" size="sm" disabled={saving} onClick={handleAccept}>
          {saving ? "Saving..." : "Accept + create v" + ((priorPlan.version || 1) + 1)}
        </Btn>
      </div>
    </div>
  );
}

function ReviewGroup({ title, tone, children }) {
  const border = tone === "green" ? "#86efac" : tone === "red" ? "#fca5a5" : tone === "amber" ? "#fcd34d" : tone === "blue" ? "#7dd3fc" : C.borderLight;
  return (
    <div style={{ marginBottom: 10, paddingLeft: 10, borderLeft: "2px solid " + border }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 4 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

export function ReviewSummaryPanel({ summary, priorPlanId }) {
  if (!summary || typeof summary !== "object") return null;
  const met       = Array.isArray(summary.goals_met) ? summary.goals_met : [];
  const notMet    = Array.isArray(summary.goals_not_met) ? summary.goals_not_met : [];
  const carried   = Array.isArray(summary.goals_carried_over) ? summary.goals_carried_over : [];
  const removed   = Array.isArray(summary.goals_removed) ? summary.goals_removed : [];
  const keyEvents = Array.isArray(summary.key_events) ? summary.key_events : [];

  return (
    <div style={{ marginTop: 4, marginBottom: 16, padding: 14, background: "#f8fafc", border: "0.5px solid " + C.borderLight, borderRadius: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 8 }}>
        Review summary
        {priorPlanId && (
          <span style={{ marginLeft: 8, fontSize: 10, color: C.textTertiary, fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>
            (superseded prior plan)
          </span>
        )}
      </div>
      {summary.period_covered && (
        <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 6 }}>{safeText(summary.period_covered)}</div>
      )}
      {summary.overall_assessment && (
        <div style={{ fontSize: 13, color: C.textPrimary, lineHeight: 1.55, marginBottom: 10 }}>
          {safeText(summary.overall_assessment)}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, marginBottom: 10 }}>
        <ReviewStat label="Met"      value={met.length}     tone="green" />
        <ReviewStat label="Not met"  value={notMet.length}  tone="red" />
        <ReviewStat label="Carried"  value={carried.length} tone="blue" />
        <ReviewStat label="Removed"  value={removed.length} tone="neutral" />
      </div>
      {keyEvents.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 4 }}>
            Key events during period
          </div>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: C.textPrimary }}>
            {keyEvents.map((ev, i) => <li key={i}>{safeText(ev)}</li>)}
          </ul>
        </div>
      )}
      {summary.reviewer_notes && (
        <div style={{ marginTop: 10, fontSize: 12, color: C.textSecondary, fontStyle: "italic" }}>
          Reviewer notes: {safeText(summary.reviewer_notes)}
        </div>
      )}
      {summary.ai_generated && (
        <div style={{ marginTop: 10, fontSize: 10, color: C.textTertiary, borderTop: "0.5px solid " + C.borderLight, paddingTop: 6 }}>
          AI-drafted {summary.ai_generated_at ? new Date(summary.ai_generated_at).toLocaleDateString() : ""}
          {summary.ai_model ? " / " + safeText(summary.ai_model) : ""}
        </div>
      )}
    </div>
  );
}

function ReviewStat({ label, value, tone }) {
  const color = tone === "green" ? "#047857" : tone === "red" ? "#dc2626" : tone === "blue" ? "#0369a1" : C.textSecondary;
  return (
    <div style={{ padding: "6px 10px", background: C.bgPrimary, border: "0.5px solid " + C.borderLight, borderRadius: 6 }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textTertiary }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: color, lineHeight: 1 }}>{value}</div>
    </div>
  );
}
