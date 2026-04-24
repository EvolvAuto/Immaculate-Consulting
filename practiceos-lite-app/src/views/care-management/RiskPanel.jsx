import { useState } from "react";
import { C } from "../../lib/tokens";
import { Badge, Btn, FL } from "../../components/ui";
import { inputStyle } from "./shared";

// ===============================================================================
// RiskPanel - renders the latest active risk assessment for an enrollment
// in the EnrollmentDetail modal. Handles loading, no-assessment, and
// assessment-present states. Action handlers (Re-assess, Acknowledge,
// Dismiss) are wired by the parent EnrollmentDetail which owns the
// edge-function calls and the state refresh cycle.
//
// RiskTrajectorySparkline is kept in this file because it's used only
// by RiskPanel - inline SVG, no libraries, renders a compact timeline
// of the enrollment's risk-level history when there are 2+ assessments.
// ===============================================================================

// ---------------------------------------------------------------------------
// RiskPanel - renders the latest active risk assessment for an enrollment
// in the EnrollmentDetail modal. Three states:
//   - loading
//   - no assessment yet (shows "Run initial assessment" CTA)
//   - assessment present (shows narrative + factors + interventions + actions)
// Actions: Re-assess (any role), Acknowledge + Dismiss (non-CHW only).
// ---------------------------------------------------------------------------
export default function RiskPanel({
  risk, history, loading, busy, error,
  canReassess, canAckDismiss,
  onReassess, onAcknowledge,
  showDismiss, setShowDismiss,
  dismissReason, setDismissReason,
  onDismiss,
}) {
  // Collapsible history section - null means not expanded, id means expanded
  const [expandedHistoryId, setExpandedHistoryId] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const safeHistory = Array.isArray(history) ? history : [];
  if (loading) {
    return (
      <div style={{ marginBottom: 20, padding: 12, background: C.bgSecondary, borderRadius: 8, fontSize: 12, color: C.textTertiary }}>
        Loading risk assessment...
      </div>
    );
  }

  // No assessment yet - show "Run initial assessment" CTA
  if (!risk) {
    return (
      <div style={{ marginBottom: 20, padding: 14, background: C.bgSecondary, border: "0.5px dashed " + C.borderLight, borderRadius: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 3 }}>
              Clinical risk
            </div>
            <div style={{ fontSize: 13, color: C.textSecondary }}>
              No assessment yet. Run an assessment to evaluate engagement, clinical, and social risk signals.
            </div>
          </div>
          {canReassess && (
            <Btn variant="primary" size="sm" disabled={busy} onClick={onReassess}>
              {busy ? "Assessing..." : "Run assessment"}
            </Btn>
          )}
        </div>
        {error && (
          <div style={{ marginTop: 10, fontSize: 12, color: C.red, background: C.redBg, padding: 8, borderRadius: 6, border: "0.5px solid " + C.redBorder }}>
            {error}
          </div>
        )}
      </div>
    );
  }

  const level = risk.risk_level;
  const levelColor =
    level === "critical" ? "#dc2626" :
    level === "high"     ? "#dc2626" :
    level === "medium"   ? "#d97706" :
    "#047857";
  const levelBg =
    level === "critical" ? "#fef2f2" :
    level === "high"     ? "#fef2f2" :
    level === "medium"   ? "#fffbeb" :
    "#f0fdf4";
  const levelBorder =
    level === "critical" ? "#fca5a5" :
    level === "high"     ? "#fca5a5" :
    level === "medium"   ? "#fcd34d" :
    "#86efac";

  const factors = Array.isArray(risk.risk_factors) ? risk.risk_factors : [];
  const interventions = Array.isArray(risk.recommended_interventions) ? risk.recommended_interventions : [];
  const protective = Array.isArray(risk.protective_factors) ? risk.protective_factors : [];

  const severityColor = (s) => s === "high" ? "red" : s === "medium" ? "amber" : "neutral";
  const urgencyColor  = (u) => u === "urgent" ? "red" : u === "high" ? "red" : u === "medium" ? "amber" : "neutral";

  return (
    <div style={{ marginBottom: 20, padding: 14, background: levelBg, border: "0.5px solid " + levelBorder, borderRadius: 10 }}>
      {/* Header - level + headline + action buttons */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: levelColor }}>
              {(level || "").toUpperCase()} RISK
            </div>
            {typeof risk.risk_score === "number" && (
              <div style={{ fontSize: 10, color: C.textTertiary }}>score {risk.risk_score}/100</div>
            )}
            {risk.confidence && (
              <Badge label={"CONF " + String(risk.confidence).toUpperCase()} variant={risk.confidence === "high" ? "green" : risk.confidence === "medium" ? "amber" : "red"} size="xs" />
            )}
            {risk.acknowledged_at && <Badge label="ACK" variant="blue" size="xs" />}
            {risk.dismissed_at && <Badge label="DISMISSED" variant="neutral" size="xs" />}
          </div>
          {risk.headline && (
            <div style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary, lineHeight: 1.4 }}>
              {risk.headline}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {canReassess && (
            <Btn variant="outline" size="sm" disabled={busy} onClick={onReassess}>
              {busy ? "..." : "Re-assess"}
            </Btn>
          )}
          {canAckDismiss && !risk.acknowledged_at && !risk.dismissed_at && (
            <Btn variant="outline" size="sm" disabled={busy} onClick={onAcknowledge}>Acknowledge</Btn>
          )}
          {canAckDismiss && !risk.dismissed_at && (
            <Btn variant="outline" size="sm" disabled={busy} onClick={() => setShowDismiss(true)} style={{ color: C.textSecondary }}>
              Dismiss
            </Btn>
          )}
        </div>
      </div>

      {/* Dismiss reason inline form */}
      {showDismiss && (
        <div style={{ marginBottom: 12, padding: 10, background: C.bgPrimary, border: "0.5px solid " + C.borderLight, borderRadius: 6 }}>
          <FL>Reason for dismissing this assessment</FL>
          <input
            type="text"
            value={dismissReason}
            onChange={e => setDismissReason(e.target.value)}
            placeholder="e.g. Already resolved - member re-engaged last week"
            style={inputStyle}
          />
          <div style={{ display: "flex", gap: 6, marginTop: 8, justifyContent: "flex-end" }}>
            <Btn variant="ghost" size="sm" onClick={() => { setShowDismiss(false); setDismissReason(""); }}>Cancel</Btn>
            <Btn variant="primary" size="sm" disabled={busy || !dismissReason.trim()} onClick={onDismiss}>
              {busy ? "Dismissing..." : "Confirm dismiss"}
            </Btn>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ marginBottom: 10, fontSize: 12, color: C.red, background: C.redBg, padding: 8, borderRadius: 6, border: "0.5px solid " + C.redBorder }}>
          {error}
        </div>
      )}

      {/* Risk trajectory sparkline - only renders when there are 2+ total
          assessments (active + at least 1 historical). Gives at-a-glance
          context on whether risk is improving, stable, or escalating. */}
      <RiskTrajectorySparkline history={safeHistory} current={risk} />

      {/* Narrative */}
      {risk.narrative && (
        <div style={{ fontSize: 13, color: C.textPrimary, lineHeight: 1.55, marginBottom: 12 }}>
          {risk.narrative}
        </div>
      )}

      {/* Risk factors */}
      {factors.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 6 }}>
            Risk factors
          </div>
          {factors.map((f, i) => (
            <div key={i} style={{ padding: "6px 10px", background: C.bgPrimary, border: "0.5px solid " + C.borderLight, borderRadius: 6, marginBottom: i < factors.length - 1 ? 4 : 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap", marginBottom: 2 }}>
                <Badge label={String(f.severity || "med").toUpperCase()} variant={severityColor(f.severity)} size="xs" />
                {f.category && <Badge label={String(f.category).toUpperCase()} variant="neutral" size="xs" />}
                <div style={{ fontSize: 12, color: C.textPrimary, fontWeight: 500 }}>{f.factor}</div>
              </div>
              {f.evidence && <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>Evidence: {f.evidence}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Recommended interventions */}
      {interventions.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 6 }}>
            Recommended interventions
          </div>
          {interventions.map((iv, i) => (
            <div key={i} style={{ padding: "6px 10px", background: C.bgPrimary, border: "0.5px solid " + C.borderLight, borderRadius: 6, marginBottom: i < interventions.length - 1 ? 4 : 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap", marginBottom: 2 }}>
                <Badge label={String(iv.urgency || "med").toUpperCase()} variant={urgencyColor(iv.urgency)} size="xs" />
                <div style={{ fontSize: 12, color: C.textPrimary, fontWeight: 500, flex: 1 }}>{iv.action}</div>
              </div>
              <div style={{ fontSize: 10, color: C.textTertiary, marginTop: 3, display: "flex", gap: 10 }}>
                {iv.owner && <span>Owner: {String(iv.owner).replace(/_/g, " ")}</span>}
                {iv.rationale && <span style={{ flex: 1 }}>- {iv.rationale}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Protective factors + next-contact-by + assessment metadata */}
      {protective.length > 0 && (
        <div style={{ marginBottom: 10, fontSize: 12, color: C.textSecondary }}>
          <span style={{ fontWeight: 600, color: C.textPrimary }}>Protective factors:</span> {protective.join(" / ")}
        </div>
      )}
      {risk.suggested_next_contact_by && (
        <div style={{ marginBottom: 8, fontSize: 12, color: C.textPrimary }}>
          <span style={{ fontWeight: 600 }}>Suggested next contact by:</span>{" "}
          <span style={{ color: levelColor, fontWeight: 600 }}>
            {new Date(risk.suggested_next_contact_by + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}
          </span>
        </div>
      )}

      {/* Dismiss reason audit trail */}
      {risk.dismissed_at && risk.dismissed_reason && (
        <div style={{ marginTop: 10, fontSize: 11, color: C.textTertiary, fontStyle: "italic", paddingTop: 8, borderTop: "0.5px solid " + C.borderLight }}>
          Dismissed {new Date(risk.dismissed_at).toLocaleDateString()}: {risk.dismissed_reason}
        </div>
      )}

      {/* Footer: assessment metadata */}
      <div style={{ marginTop: 10, fontSize: 10, color: C.textTertiary, borderTop: "0.5px solid " + C.borderLight, paddingTop: 8, display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <span>Assessed {risk.assessed_at ? new Date(risk.assessed_at).toLocaleString() : ""}</span>
        <span>Trigger: {risk.trigger_reason}{risk.model ? " / " + risk.model : ""}</span>
      </div>

      {/* History: previous (superseded) assessments. Each is expandable to
          show the full narrative + factors + interventions that were active
          at that point in time. Disposition badge indicates how the entry
          ended: Acknowledged, Dismissed, or neither (superseded without
          being actioned). */}
      {safeHistory.length > 0 && (
        <div style={{ marginTop: 10, borderTop: "0.5px solid " + C.borderLight, paddingTop: 8 }}>
          <button
            onClick={() => setHistoryOpen(!historyOpen)}
            style={{
              background: "transparent",
              border: "none",
              padding: "4px 0",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: C.textSecondary,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span>{historyOpen ? "-" : "+"}</span>
            <span>Assessment history ({safeHistory.length})</span>
          </button>
          {historyOpen && (
            <div style={{ marginTop: 8 }}>
              {safeHistory.map((h, i) => {
                const isExpanded = expandedHistoryId === h.id;
                const levelMap = { critical: "red", high: "red", medium: "amber", low: "green" };
                const hFactors = Array.isArray(h.risk_factors) ? h.risk_factors : [];
                const hInterventions = Array.isArray(h.recommended_interventions) ? h.recommended_interventions : [];
                // Disposition: what happened to this assessment before it was
                // superseded? Dismissed takes precedence over Acknowledged in display.
                let disposition = "Superseded";
                let dispVariant = "neutral";
                if (h.dismissed_at) { disposition = "Dismissed"; dispVariant = "neutral"; }
                else if (h.acknowledged_at) { disposition = "Acknowledged"; dispVariant = "blue"; }
                return (
                  <div key={h.id} style={{
                    padding: "8px 10px",
                    background: C.bgPrimary,
                    border: "0.5px solid " + C.borderLight,
                    borderRadius: 6,
                    marginBottom: i < safeHistory.length - 1 ? 6 : 0,
                  }}>
                    <button
                      onClick={() => setExpandedHistoryId(isExpanded ? null : h.id)}
                      style={{
                        background: "transparent",
                        border: "none",
                        padding: 0,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        textAlign: "left",
                        width: "100%",
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        gap: 8,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap", marginBottom: 2 }}>
                          <Badge label={String(h.risk_level || "").toUpperCase()} variant={levelMap[h.risk_level] || "neutral"} size="xs" />
                          <Badge label={disposition.toUpperCase()} variant={dispVariant} size="xs" />
                          <span style={{ fontSize: 11, color: C.textTertiary }}>
                            {h.assessed_at ? new Date(h.assessed_at).toLocaleDateString() : ""}
                          </span>
                        </div>
                        {h.headline && (
                          <div style={{ fontSize: 12, color: C.textPrimary, lineHeight: 1.4 }}>
                            {h.headline}
                          </div>
                        )}
                      </div>
                      <span style={{ fontSize: 11, color: C.textTertiary, marginLeft: 8 }}>
                        {isExpanded ? "Hide" : "View"}
                      </span>
                    </button>
                    {isExpanded && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "0.5px solid " + C.borderLight }}>
                        {h.narrative && (
                          <div style={{ fontSize: 12, color: C.textPrimary, lineHeight: 1.5, marginBottom: 10 }}>
                            {h.narrative}
                          </div>
                        )}
                        {hFactors.length > 0 && (
                          <div style={{ marginBottom: 10 }}>
                            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 4 }}>
                              Risk factors at the time
                            </div>
                            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, color: C.textPrimary, lineHeight: 1.5 }}>
                              {hFactors.map((f, j) => (
                                <li key={j}>
                                  <strong>{f.factor}</strong>
                                  {f.evidence && <span style={{ color: C.textTertiary }}> - {f.evidence}</span>}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {hInterventions.length > 0 && (
                          <div style={{ marginBottom: 10 }}>
                            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 4 }}>
                              Recommended interventions at the time
                            </div>
                            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, color: C.textPrimary, lineHeight: 1.5 }}>
                              {hInterventions.map((iv, j) => (
                                <li key={j}>{iv.action}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {h.dismissed_reason && (
                          <div style={{ fontSize: 11, color: C.textTertiary, fontStyle: "italic", marginBottom: 4 }}>
                            Dismiss reason: {h.dismissed_reason}
                          </div>
                        )}
                        <div style={{ fontSize: 10, color: C.textTertiary, display: "flex", gap: 10, flexWrap: "wrap" }}>
                          <span>Trigger: {h.trigger_reason || "-"}</span>
                          {h.model && <span>{h.model}</span>}
                          {h.acknowledged_at && <span>Acknowledged {new Date(h.acknowledged_at).toLocaleDateString()}</span>}
                          {h.dismissed_at && <span>Dismissed {new Date(h.dismissed_at).toLocaleDateString()}</span>}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RiskTrajectorySparkline - compact visualization of risk_level over time
// for one enrollment. Used inside RiskPanel when the member has >= 2 total
// assessments (current + at least 1 historical). Inline-SVG, no libraries.
//
// X-axis: index (evenly spaced) - simpler than date-based and highlights
//         trajectory regardless of gaps. Most-recent on the right.
// Y-axis: risk level mapped to height. low=bottom, critical=top.
// Line + markers color-coded by level at that point.
// ---------------------------------------------------------------------------
function RiskTrajectorySparkline({ history, current }) {
  // Combine history (superseded) + current (active, if any) into one
  // chronologically-ordered array. `history` is already sorted newest-first
  // in the parent; reverse to oldest-first, then append current.
  const historyOldestFirst = Array.isArray(history) ? history.slice().reverse() : [];
  const points = [...historyOldestFirst];
  if (current) points.push(current);
  if (points.length < 2) return null;

  const LEVEL_Y = { low: 3, medium: 2, high: 1, critical: 0 };
  const LEVEL_COLOR = { low: "#10b981", medium: "#f59e0b", high: "#ef4444", critical: "#991b1b" };
  const W = 260;
  const H = 56;
  const MARGIN = 6;
  const plotW = W - MARGIN * 2;
  const plotH = H - MARGIN * 2;

  const coords = points.map((p, i) => {
    const x = MARGIN + (points.length > 1 ? (i * plotW) / (points.length - 1) : plotW / 2);
    const yBucket = LEVEL_Y[p.risk_level];
    const y = MARGIN + (typeof yBucket === "number" ? (yBucket * plotH) / 3 : plotH / 2);
    return { x, y, point: p };
  });

  const pathD = coords.map((c, i) => (i === 0 ? "M" : "L") + c.x.toFixed(1) + "," + c.y.toFixed(1)).join(" ");

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary }}>
          Risk trajectory ({points.length} assessments)
        </div>
        <div style={{ fontSize: 9, color: C.textTertiary }}>
          oldest {points[0]?.assessed_at ? new Date(points[0].assessed_at).toLocaleDateString() : ""}
          {" -> "}
          newest {points[points.length - 1]?.assessed_at ? new Date(points[points.length - 1].assessed_at).toLocaleDateString() : ""}
        </div>
      </div>
      <div style={{ background: C.bgPrimary, border: "0.5px solid " + C.borderLight, borderRadius: 6, padding: 4 }}>
        <svg width="100%" height={H} viewBox={"0 0 " + W + " " + H} preserveAspectRatio="none" style={{ display: "block" }}>
          {/* Horizontal gridlines - one per level */}
          {[0, 1, 2, 3].map(i => {
            const y = MARGIN + (i * plotH) / 3;
            return <line key={i} x1={MARGIN} y1={y} x2={W - MARGIN} y2={y} stroke="#e5e7eb" strokeWidth="0.5" strokeDasharray="2,2" />;
          })}
          {/* Level labels on the left */}
          <text x={2} y={MARGIN + 3} fontSize="7" fill={C.textTertiary}>CRIT</text>
          <text x={2} y={MARGIN + plotH / 3 + 3} fontSize="7" fill={C.textTertiary}>HIGH</text>
          <text x={2} y={MARGIN + 2 * plotH / 3 + 3} fontSize="7" fill={C.textTertiary}>MED</text>
          <text x={2} y={MARGIN + plotH + 3} fontSize="7" fill={C.textTertiary}>LOW</text>
          {/* Trajectory line */}
          <path d={pathD} fill="none" stroke={C.textSecondary} strokeWidth="1.5" />
          {/* Points colored by level */}
          {coords.map((c, i) => (
            <circle
              key={i}
              cx={c.x}
              cy={c.y}
              r={3.5}
              fill={LEVEL_COLOR[c.point.risk_level] || C.textTertiary}
              stroke="white"
              strokeWidth="1"
            >
              <title>
                {c.point.assessed_at ? new Date(c.point.assessed_at).toLocaleDateString() : ""} - {String(c.point.risk_level || "").toUpperCase()}
                {c.point.headline ? " - " + c.point.headline : ""}
              </title>
            </circle>
          ))}
        </svg>
      </div>
    </div>
  );
}
