import { useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { C } from "../../lib/tokens";
import { Badge, Btn, Modal, ErrorBanner, FL } from "../../components/ui";
import { ClaimStatusBadge, VerificationBadge, DetailField, inputStyle } from "./shared";

// ===============================================================================
// BillingPeriodDetailModal - breakdown of a single billing period with
// claim lifecycle actions and verification controls.
//
// Renders: summary grid, claim-lifecycle audit log, contact breakdown by
// method + role, flagged issues. Action buttons adapt to current claim
// status (Ready -> Submit; Submitted -> Mark Paid / Denied). AI "Explain"
// button invokes cmp-billing-explainer and renders the structured analysis
// via BillingAnalysisCard (internal to this file).
//
// BillingAnalysisCard and AnalysisSection are internal helpers - they are
// used only by this modal to render the AI output sections.
// ===============================================================================

export default function BillingPeriodDetailModal({ period, userId, canSubmitClaim, onClose, onUpdated }) {
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);
  const [showSubmit, setShowSubmit]   = useState(false);
  const [showPaid, setShowPaid]       = useState(false);
  const [showDenied, setShowDenied]   = useState(false);
  const [claimExtId, setClaimExtId]   = useState("");
  const [paidAmount, setPaidAmount]   = useState("");
  const [denialCode, setDenialCode]   = useState("");
  const [denialReason, setDenialReason] = useState("");

  // AI explainer state. The edge function returns a structured analysis with
  // status assessment, path-to-ready steps, audit risks, and recommended
  // actions. `aiContext` holds the small metadata packet (billing_month,
  // days_remaining, etc.) so the UI can show deadlines without recomputing.
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiAnalysis, setAiAnalysis]   = useState(null);
  const [aiContext, setAiContext]     = useState(null);
  const [aiError, setAiError]         = useState(null);

  const title = (period.patients?.first_name || "") + " " + (period.patients?.last_name || "")
    + " - " + new Date(period.billing_month + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  const patchBillingPeriod = async (patch) => {
    setSaving(true); setError(null);
    try {
      const { error: updErr } = await supabase
        .from("cm_billing_periods")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", period.id);
      if (updErr) throw updErr;
      onUpdated();
    } catch (e) {
      setError(e.message || "Update failed");
      setSaving(false);
    }
  };

  const submitClaim = async () => {
    if (!claimExtId.trim()) { setError("External claim ID required"); return; }
    await patchBillingPeriod({
      claim_status:        "Submitted",
      claim_external_id:   claimExtId.trim(),
      claim_submitted_at:  new Date().toISOString(),
      claim_submitted_by:  userId || null,
      claim_ready_at:      period.claim_ready_at || new Date().toISOString(),
    });
  };

  const markPaid = async () => {
    const amt = parseFloat(paidAmount);
    if (isNaN(amt) || amt < 0) { setError("Valid paid amount required"); return; }
    await patchBillingPeriod({
      claim_status:      "Paid",
      claim_paid_at:     new Date().toISOString(),
      claim_paid_amount: amt,
    });
  };

  const markDenied = async () => {
    if (!denialReason.trim()) { setError("Denial reason required"); return; }
    await patchBillingPeriod({
      claim_status:        "Denied",
      claim_denial_code:   denialCode.trim() || null,
      claim_denial_reason: denialReason.trim(),
    });
  };

  const approveVerification = async () => {
    await patchBillingPeriod({
      verification_status: "Approved",
      verified_at:         new Date().toISOString(),
      verified_by:         userId || null,
    });
  };

  // -------------------------------------------------------------------------
  // AI explainer - calls cmp-billing-explainer and renders the structured
  // analysis inline. Works for all claim statuses; the edge function returns
  // different sections based on status (path_to_ready vs audit_risks vs
  // denial_analysis). Re-runnable by clicking again.
  // -------------------------------------------------------------------------
  const handleAiAnalyze = async () => {
    setAiAnalyzing(true);
    setAiError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const url = supabase.supabaseUrl + "/functions/v1/cmp-billing-explainer";
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": "Bearer " + token,
        },
        body: JSON.stringify({ billing_period_id: period.id }),
      });
      const body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || "HTTP " + res.status);

      setAiAnalysis(body.analysis || null);
      setAiContext(body.context || null);
    } catch (e) {
      setAiError(e.message || "AI analysis failed");
    } finally {
      setAiAnalyzing(false);
    }
  };

  const roleRows = [
    ["Care Manager",             period.actual_care_manager_contacts],
    ["Supervising Care Manager", period.actual_supervising_contacts],
    ["Extender",                 period.actual_extender_contacts],
    ["Provider",                 period.actual_provider_contacts],
  ].filter(r => r[1] > 0);

  const methodRows = [
    ["In Person",  period.actual_in_person],
    ["Telephonic", period.actual_telephonic],
    ["Video",      period.actual_video],
  ].filter(r => r[1] > 0);

  const flags = Array.isArray(period.flagged_issues) ? period.flagged_issues : [];

  // Which action buttons should be shown. Precomputed so the action row
  // only renders when at least one is available (avoids empty bordered row).
  const showReady     = period.claim_status === "Ready"     && canSubmitClaim && !showSubmit;
  const showSubmitted = period.claim_status === "Submitted" && canSubmitClaim && !showPaid && !showDenied;
  const showVerify    = period.verification_status !== "Approved" && canSubmitClaim;

  return (
    <Modal title={title} onClose={onClose} width={760}>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {/* Toolbar: Explain with AI always available; claim lifecycle actions conditional */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, paddingBottom: 12, borderBottom: "0.5px solid " + C.borderLight, flexWrap: "wrap" }}>
        <Btn
          variant={aiAnalysis ? "outline" : "primary"}
          size="sm"
          disabled={aiAnalyzing}
          onClick={handleAiAnalyze}
        >
          {aiAnalyzing ? "Analyzing..." : (aiAnalysis ? "Re-analyze" : "Explain with AI")}
        </Btn>
        {showReady && (
          <Btn variant="primary" size="sm" onClick={() => setShowSubmit(true)}>Submit claim</Btn>
        )}
        {showSubmitted && (
          <>
            <Btn variant="primary" size="sm" onClick={() => setShowPaid(true)}>Mark paid</Btn>
            <Btn variant="outline" size="sm" onClick={() => setShowDenied(true)} style={{ color: C.red, borderColor: C.redBorder }}>Mark denied</Btn>
          </>
        )}
        {showVerify && (
          <Btn variant="outline" size="sm" disabled={saving} onClick={approveVerification}>
            {saving ? "Approving..." : "Mark verified"}
          </Btn>
        )}
      </div>

      {/* AI analysis error + result */}
      {aiError && (
        <div style={{ marginBottom: 16, fontSize: 12, color: C.red, background: C.redBg, padding: "10px 12px", borderRadius: 8, border: "0.5px solid " + C.redBorder }}>
          {aiError}
        </div>
      )}
      {aiAnalysis && (
        <BillingAnalysisCard analysis={aiAnalysis} context={aiContext} claimStatus={period.claim_status} />
      )}

      {/* Inline submit claim form */}
      {showSubmit && (
        <div style={{ padding: 12, marginBottom: 16, background: C.bgSecondary, borderRadius: 8 }}>
          <FL>External claim ID (from billing system)</FL>
          <input type="text" value={claimExtId} onChange={e => setClaimExtId(e.target.value)} placeholder="e.g. CLM-2026-04-00123" style={{ ...inputStyle, fontFamily: "monospace" }} />
          <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
            <Btn variant="ghost" size="sm" onClick={() => { setShowSubmit(false); setClaimExtId(""); }}>Cancel</Btn>
            <Btn variant="primary" size="sm" disabled={saving || !claimExtId.trim()} onClick={submitClaim}>
              {saving ? "Submitting..." : "Confirm submission"}
            </Btn>
          </div>
        </div>
      )}

      {/* Inline mark paid form */}
      {showPaid && (
        <div style={{ padding: 12, marginBottom: 16, background: C.bgSecondary, borderRadius: 8 }}>
          <FL>Paid amount (USD)</FL>
          <input type="number" step="0.01" value={paidAmount} onChange={e => setPaidAmount(e.target.value)} placeholder="0.00" style={inputStyle} />
          <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
            <Btn variant="ghost" size="sm" onClick={() => { setShowPaid(false); setPaidAmount(""); }}>Cancel</Btn>
            <Btn variant="primary" size="sm" disabled={saving || !paidAmount} onClick={markPaid}>
              {saving ? "Saving..." : "Confirm payment"}
            </Btn>
          </div>
        </div>
      )}

      {/* Inline mark denied form */}
      {showDenied && (
        <div style={{ padding: 12, marginBottom: 16, background: C.bgSecondary, borderRadius: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
            <div>
              <FL>Denial code (optional)</FL>
              <input type="text" value={denialCode} onChange={e => setDenialCode(e.target.value)} placeholder="e.g. CO-97" style={{ ...inputStyle, fontFamily: "monospace" }} />
            </div>
            <div>
              <FL>Denial reason</FL>
              <input type="text" value={denialReason} onChange={e => setDenialReason(e.target.value)} placeholder="e.g. Duplicate service" style={inputStyle} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
            <Btn variant="ghost" size="sm" onClick={() => { setShowDenied(false); setDenialCode(""); setDenialReason(""); }}>Cancel</Btn>
            <Btn variant="primary" size="sm" disabled={saving || !denialReason.trim()} onClick={markDenied} style={{ background: C.red, borderColor: C.red }}>
              {saving ? "Saving..." : "Confirm denial"}
            </Btn>
          </div>
        </div>
      )}

      {/* Summary row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        <DetailField label="Program"          value={period.program_type_snapshot} />
        <DetailField label="Plan"             value={period.cm_enrollments?.health_plan_type || "-"} />
        <DetailField label="Acuity"           value={period.acuity_tier_snapshot || "-"} />
        <DetailField label="Provider"         value={period.cm_enrollments?.cm_provider_type || "-"} />
        <DetailField label="Claim status"     value={<ClaimStatusBadge status={period.claim_status} />} />
        <DetailField label="Verification"     value={<VerificationBadge status={period.verification_status} />} />
        <DetailField label="Contacts"         value={period.actual_contacts_total + " / " + period.required_contacts_total} />
        <DetailField label="CM majority"      value={period.has_care_manager_majority ? "Yes" : "No"} />
      </div>

      {/* Claim lifecycle audit */}
      {(period.claim_ready_at || period.claim_submitted_at || period.claim_paid_at) && (
        <div style={{ marginBottom: 20, padding: 12, background: C.bgSecondary, borderRadius: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 8 }}>
            Claim lifecycle
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.8 }}>
            {period.claim_ready_at && <div>Ready: {new Date(period.claim_ready_at).toLocaleString()}</div>}
            {period.claim_submitted_at && (
              <div>
                Submitted: {new Date(period.claim_submitted_at).toLocaleString()}
                {period.claim_external_id && <span style={{ fontFamily: "monospace", color: C.textSecondary }}> ({period.claim_external_id})</span>}
              </div>
            )}
            {period.claim_paid_at && (
              <div style={{ color: C.green }}>
                Paid: {new Date(period.claim_paid_at).toLocaleString()}
                {period.claim_paid_amount && <span> - ${Number(period.claim_paid_amount).toFixed(2)}</span>}
              </div>
            )}
            {period.claim_denial_reason && (
              <div style={{ color: C.red }}>
                Denied: {period.claim_denial_code ? "[" + period.claim_denial_code + "] " : ""}{period.claim_denial_reason}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Contact breakdown */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 8 }}>
          Qualifying contacts ({period.actual_contacts_total})
        </div>
        {period.actual_contacts_total === 0 ? (
          <div style={{ fontSize: 12, color: C.textTertiary, fontStyle: "italic", padding: "6px 0" }}>
            No qualifying contacts logged this month. Log touchpoints from the Touchpoints tab - only successful contacts via In Person, Telephonic, or Video count toward the billing floor.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <div style={{ fontSize: 11, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>By method</div>
              {methodRows.map(([label, count]) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13 }}>
                  <span>{label}</span>
                  <span style={{ fontWeight: 600 }}>{count}</span>
                </div>
              ))}
            </div>
            <div>
              <div style={{ fontSize: 11, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>By role</div>
              {roleRows.map(([label, count]) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13 }}>
                  <span>{label}</span>
                  <span style={{ fontWeight: 600 }}>{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Flagged issues */}
      {flags.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 8 }}>
            Flagged issues ({flags.length})
          </div>
          <div style={{ border: "0.5px solid " + C.redBorder, borderRadius: 8, background: C.redBg }}>
            {flags.map((f, i) => {
              const text = typeof f === "string" ? f : (f.message || f.description || JSON.stringify(f));
              return (
                <div key={i} style={{ padding: "8px 12px", borderBottom: i < flags.length - 1 ? "0.5px solid " + C.redBorder : "none", fontSize: 13 }}>
                  {text}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {period.notes && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 8 }}>
            Notes
          </div>
          <div style={{ fontSize: 13, padding: "8px 12px", background: C.bgSecondary, borderRadius: 8 }}>
            {period.notes}
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// NewEnrollmentModal - create a new Care Management enrollment.
//
// Enrollment has three plan-related dimensions:
//   1. health_plan_type - Tailored Plan / Standard Plan / Other (or null for informal)
//   2. program_type     - TCM / AMH / General Engagement / Other
//   3. cm_provider_type - AMH+ / AMH Tier 3 / CMA / CIN / Other
//      (Plan-based excluded: practices do not enroll plan-managed members)
//
// Valid combinations are enforced by PLAN_PROGRAM_MATRIX in cmCadence.js:
//   Tailored Plan -> TCM, delivered by AMH+ / CMA / CIN
//   Standard Plan -> AMH, delivered by AMH Tier 3 / CIN
//   Other         -> General Engagement or Other, any provider
//   (null plan)   -> informal, no constraint
//
// The "Allow nonstandard combination" override exists for edge cases
// (plan transitions, dual enrollment, etc.) that do not fit the matrix.
//
// Acuity tier only applies to Tailored Plan (TCM) enrollments.
//
// Partial-unique index on (patient_id, program_type) WHERE status='Active'
// prevents duplicate active enrollments. Surfaced as UX warning before save.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// BillingAnalysisCard - renders the structured output from cmp-billing-explainer.
// Sections shown adapt to claim_status: Not Ready gets path_to_ready, Ready/
// Submitted get audit_risks, Denied gets denial_analysis. All statuses get
// the narrative summary + recommended_next_actions + add_on_opportunities.
// ---------------------------------------------------------------------------
function BillingAnalysisCard({ analysis, context, claimStatus }) {
  if (!analysis) return null;

  const pathToReady     = Array.isArray(analysis.path_to_ready)          ? analysis.path_to_ready          : [];
  const auditRisks      = Array.isArray(analysis.audit_risks)            ? analysis.audit_risks            : [];
  const nextActions     = Array.isArray(analysis.recommended_next_actions) ? analysis.recommended_next_actions : [];
  const addOns          = Array.isArray(analysis.add_on_opportunities)   ? analysis.add_on_opportunities   : [];
  const denial          = analysis.denial_analysis || null;
  const caveats         = Array.isArray(analysis.confidence_caveats)     ? analysis.confidence_caveats     : [];

  const statusLabel = (s) => {
    if (!s) return "Analysis";
    return s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  };

  const statusColor = (s) => {
    if (s === "ready_strong" || s === "paid" || s === "on_track") return "#047857"; // green
    if (s === "ready_audit_risk" || s === "at_risk" || s === "submitted_waiting") return "#d97706"; // amber
    if (s === "blocked" || s === "denied_resubmittable" || s === "denied_terminal") return "#dc2626"; // red
    return "#0369a1"; // blue
  };

  const priorityColor = (p) => p === "urgent" ? "red" : p === "high" ? "red" : p === "medium" ? "amber" : "neutral";
  const severityColor = (s) => s === "high" ? "red" : s === "medium" ? "amber" : "neutral";

  const deadlineLabel = (d) => {
    if (!d) return null;
    if (d === "asap")         return "ASAP";
    if (d === "end_of_month") return "End of month";
    // Try to parse as ISO date
    try {
      const dt = new Date(d + "T12:00:00Z");
      return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    } catch (e) { return d; }
  };

  return (
    <div style={{ marginBottom: 20, padding: 14, background: "#f0f9ff", border: "0.5px solid #bae6fd", borderRadius: 10 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10, gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#075985" }}>
            AI Analysis
          </div>
          {analysis.status_assessment && (
            <div style={{ fontSize: 12, fontWeight: 700, color: statusColor(analysis.status_assessment) }}>
              {statusLabel(analysis.status_assessment)}
            </div>
          )}
          {context?.days_remaining_in_month > 0 && context?.month_status === "current" && (
            <div style={{ fontSize: 11, color: C.textTertiary }}>
              {context.days_remaining_in_month} day{context.days_remaining_in_month === 1 ? "" : "s"} left this month
            </div>
          )}
        </div>
        {analysis.confidence && (
          <Badge
            label={"CONFIDENCE " + String(analysis.confidence).toUpperCase()}
            variant={analysis.confidence === "high" ? "green" : analysis.confidence === "medium" ? "amber" : "red"}
            size="xs"
          />
        )}
      </div>

      {/* Narrative */}
      {analysis.narrative_summary && (
        <div style={{ fontSize: 13, color: C.textPrimary, lineHeight: 1.55, marginBottom: 14 }}>
          {analysis.narrative_summary}
        </div>
      )}

      {/* Path to ready (Not Ready periods) */}
      {pathToReady.length > 0 && (
        <AnalysisSection title="Path to ready" tone="amber">
          {pathToReady.map((step, i) => (
            <div key={i} style={{ padding: "8px 10px", background: C.bgPrimary, border: "0.5px solid " + C.borderLight, borderRadius: 6, marginBottom: i < pathToReady.length - 1 ? 6 : 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 2 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>{step.action}</div>
                {deadlineLabel(step.deadline) && (
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.red, whiteSpace: "nowrap" }}>
                    By {deadlineLabel(step.deadline)}
                  </div>
                )}
              </div>
              {step.reason && (
                <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>{step.reason}</div>
              )}
            </div>
          ))}
        </AnalysisSection>
      )}

      {/* Audit risks (Ready/Submitted periods) */}
      {auditRisks.length > 0 && (
        <AnalysisSection title="Audit durability risks" tone="amber">
          {auditRisks.map((risk, i) => (
            <div key={i} style={{ padding: "8px 10px", background: C.bgPrimary, border: "0.5px solid " + C.borderLight, borderRadius: 6, marginBottom: i < auditRisks.length - 1 ? 6 : 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap", marginBottom: 2 }}>
                <Badge label={String(risk.severity || "medium").toUpperCase()} variant={severityColor(risk.severity)} size="xs" />
                <div style={{ fontSize: 13, color: C.textPrimary }}>{risk.risk}</div>
              </div>
              {risk.mitigation && (
                <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2, fontStyle: "italic" }}>Mitigation: {risk.mitigation}</div>
              )}
            </div>
          ))}
        </AnalysisSection>
      )}

      {/* Denial analysis (Denied periods) */}
      {claimStatus === "Denied" && denial && denial.root_cause_hypothesis && (
        <AnalysisSection title="Denial analysis" tone="red">
          <div style={{ padding: 10, background: C.bgPrimary, border: "0.5px solid " + C.borderLight, borderRadius: 6 }}>
            <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 4 }}>
              <strong style={{ color: C.textPrimary }}>Likely root cause:</strong> {denial.root_cause_hypothesis}
            </div>
            {Array.isArray(denial.evidence) && denial.evidence.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.textSecondary, marginBottom: 2 }}>Evidence</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: C.textPrimary }}>
                  {denial.evidence.map((ev, i) => <li key={i}>{ev}</li>)}
                </ul>
              </div>
            )}
            {denial.resubmission_viability && (
              <div style={{ marginTop: 8, fontSize: 12 }}>
                <strong style={{ color: C.textPrimary }}>Resubmission viability:</strong>{" "}
                <Badge
                  label={String(denial.resubmission_viability).replace(/_/g, " ").toUpperCase()}
                  variant={denial.resubmission_viability === "viable" ? "green" : denial.resubmission_viability === "partially_viable" ? "amber" : "red"}
                  size="xs"
                />
              </div>
            )}
            {Array.isArray(denial.resubmission_steps) && denial.resubmission_steps.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.textSecondary, marginBottom: 2 }}>Resubmission steps</div>
                <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: C.textPrimary }}>
                  {denial.resubmission_steps.map((st, i) => <li key={i}>{st}</li>)}
                </ol>
              </div>
            )}
          </div>
        </AnalysisSection>
      )}

      {/* Add-on opportunities */}
      {addOns.length > 0 && (
        <AnalysisSection title="Add-on code opportunities" tone="green">
          {addOns.map((a, i) => (
            <div key={i} style={{ padding: "8px 10px", background: C.bgPrimary, border: "0.5px solid " + C.borderLight, borderRadius: 6, marginBottom: i < addOns.length - 1 ? 6 : 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap", marginBottom: 2 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>{String(a.code || "").toUpperCase()}</div>
                <Badge
                  label={String(a.eligibility || "").replace(/_/g, " ").toUpperCase()}
                  variant={a.eligibility === "likely_eligible" ? "green" : a.eligibility === "needs_verification" ? "amber" : "neutral"}
                  size="xs"
                />
              </div>
              {a.reasoning && <div style={{ fontSize: 11, color: C.textTertiary }}>{a.reasoning}</div>}
            </div>
          ))}
        </AnalysisSection>
      )}

      {/* Recommended next actions (always shown) */}
      {nextActions.length > 0 && (
        <AnalysisSection title="Recommended next actions" tone="blue">
          {nextActions.map((a, i) => (
            <div key={i} style={{ padding: "8px 10px", background: C.bgPrimary, border: "0.5px solid " + C.borderLight, borderRadius: 6, marginBottom: i < nextActions.length - 1 ? 6 : 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap", marginBottom: 2 }}>
                <Badge label={String(a.priority || "medium").toUpperCase()} variant={priorityColor(a.priority)} size="xs" />
                <div style={{ fontSize: 13, color: C.textPrimary, flex: 1 }}>{a.action}</div>
              </div>
              <div style={{ fontSize: 10, color: C.textTertiary, marginTop: 4, display: "flex", gap: 10 }}>
                {a.owner && <span>Owner: {String(a.owner).replace(/_/g, " ")}</span>}
                {a.estimated_impact && <span>Impact: {String(a.estimated_impact).replace(/_/g, " ")}</span>}
              </div>
            </div>
          ))}
        </AnalysisSection>
      )}

      {/* Confidence caveats */}
      {caveats.length > 0 && (
        <div style={{ marginTop: 10, padding: 8, fontSize: 11, color: C.textTertiary, fontStyle: "italic" }}>
          Caveats: {caveats.join(" / ")}
        </div>
      )}
    </div>
  );
}

function AnalysisSection({ title, tone, children }) {
  const borderColor = tone === "amber" ? "#fbbf24" : tone === "red" ? "#f87171" : tone === "green" ? "#34d399" : "#60a5fa";
  return (
    <div style={{ marginBottom: 12, paddingLeft: 10, borderLeft: "2px solid " + borderColor }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 6 }}>
        {title}
      </div>
      {children}
    </div>
  );
}
