// ===============================================================================
// src/components/AiUsageCard.jsx
// Dashboard widget: monthly AI usage + cap progress. Owner/Manager only.
//
// Reads from pro_ai_usage via ai_usage_monthly_summary RPC. Shows:
//   - Total calls this month vs. tier cap as a progress bar
//   - Per-feature breakdown with mini bars
//
// Client-facing AI transparency policy (memory #21): we NEVER show token
// counts, model names, or dollar cost to practice users. The RPC returns
// token sums for future use (cap-warning tuning, internal analytics) but
// this widget only surfaces call counts and cap progress.
//
// TODO: Pull the monthly cap from practices.ai_monthly_cap column once the
// onboarding wizard makes it per-practice configurable. Until then, defaults
// are hardcoded per tier per memory #19.
// ===============================================================================

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { C } from "../lib/tokens";
import { Card, SectionHead, Loader, ErrorBanner, EmptyState } from "./ui";

// Tier caps (TODO: move to practices row when onboarding wizard lands)
const MONTHLY_CAPS = {
  Command: 10000,
  Pro: 6000,
  Lite: 0,
};

// Friendly names for feature keys stored in pro_ai_usage.feature.
// Unknown features fall through to a humanized version of the key.
const FEATURE_LABELS = {
  cmp_draft_care_plan:     "Care Plan Drafter",
  cmp_summarize_touchpoint: "Touchpoint Summarizer",
  cmp_billing_explain:     "Billing Explainer",
  cmp_billing_projection:  "Billing Projection",
  cmp_draft_annual_review: "Annual Review Drafter",
  cmp_risk_assess:         "Risk Assessment",
  pro_hrsn_summarize:      "HRSN Summarizer",
  pro_chart_prep:          "Chart Prep",
  pro_ai_assistant:        "AI Assistant",
  pro_insurance_ocr:       "Insurance OCR",
};

function humanizeFeature(key) {
  if (FEATURE_LABELS[key]) return FEATURE_LABELS[key];
  // Fallback: snake_case -> Title Case
  return String(key || "Unknown")
    .split("_")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function currentMonthLabel() {
  const d = new Date();
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

// Color the progress bar based on how close to cap
function progressColor(pct) {
  if (pct >= 100) return C.red || "#dc2626";
  if (pct >= 80)  return C.amber || "#d97706";
  return C.teal;
}

export default function AiUsageCard({ practiceId, tier }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);

  const cap = MONTHLY_CAPS[tier] || 0;

  useEffect(() => {
    if (!practiceId || cap === 0) { setLoading(false); return; }
    let active = true;
    (async () => {
      try {
        setLoading(true);
        const { data, error: rpcError } = await supabase
          .rpc("ai_usage_monthly_summary", { p_practice_id: practiceId });
        if (!active) return;
        if (rpcError) throw rpcError;
        setRows(data || []);
        setError(null);
      } catch (e) {
        if (!active) return;
        setError(e.message || String(e));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [practiceId, cap]);

  if (cap === 0) return null; // Lite or unknown tier: don't render

  const totalCalls = rows.reduce((sum, r) => sum + Number(r.call_count || 0), 0);
  const percentOfCap = cap > 0 ? Math.min(999, Math.round((totalCalls / cap) * 100)) : 0;
  const barColor = progressColor(percentOfCap);
  const maxFeatureCount = rows.length > 0
    ? Math.max(...rows.map(r => Number(r.call_count || 0)))
    : 1;

  return (
    <Card>
      <SectionHead
        title="AI Usage"
        sub={currentMonthLabel()}
      />

      {loading && <Loader />}
      {error && <ErrorBanner message={"Couldn't load usage: " + error} />}

      {!loading && !error && (
        <>
          {/* Progress bar + headline */}
          <div style={{ marginBottom: 16 }}>
            <div style={{
              display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6,
            }}>
              <div style={{ fontSize: 13, color: C.textSecondary }}>
                <span style={{ fontSize: 18, fontWeight: 700, color: C.textPrimary }}>
                  {totalCalls.toLocaleString()}
                </span>
                {" / "}
                <span>{cap.toLocaleString()} calls</span>
              </div>
              <div style={{
                fontSize: 12, fontWeight: 700,
                color: percentOfCap >= 80 ? barColor : C.textTertiary,
              }}>
                {percentOfCap}%
              </div>
            </div>
            <div style={{
              height: 8, background: C.bgSecondary, borderRadius: 4, overflow: "hidden",
            }}>
              <div style={{
                width: Math.min(100, percentOfCap) + "%",
                height: "100%",
                background: barColor,
                transition: "width 300ms ease",
              }} />
            </div>
            {percentOfCap >= 80 && (
              <div style={{ fontSize: 11, color: barColor, marginTop: 6, fontWeight: 600 }}>
                {percentOfCap >= 100
                  ? "Monthly cap reached. AI features may be rate-limited."
                  : "Approaching monthly cap. Consider pacing remaining usage."}
              </div>
            )}
          </div>

          {/* Feature breakdown */}
          {rows.length === 0 ? (
            <EmptyState
              icon="✨"
              title="No AI usage this month yet"
              sub="Usage by feature will show here once staff start using AI tools."
            />
          ) : (
            <div>
              <div style={{
                fontSize: 10, fontWeight: 700, color: C.textTertiary,
                textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8,
              }}>
                By feature
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {rows.map(r => {
                  const count = Number(r.call_count || 0);
                  const pct = maxFeatureCount > 0 ? Math.round((count / maxFeatureCount) * 100) : 0;
                  return (
                    <div key={r.feature} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{
                        fontSize: 12, color: C.textPrimary, minWidth: 160,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {humanizeFeature(r.feature)}
                      </div>
                      <div style={{
                        fontSize: 12, fontWeight: 600, color: C.textSecondary,
                        minWidth: 44, textAlign: "right",
                      }}>
                        {count.toLocaleString()}
                      </div>
                      <div style={{
                        flex: 1, height: 6, background: C.bgSecondary, borderRadius: 3, overflow: "hidden",
                      }}>
                        <div style={{
                          width: pct + "%", height: "100%", background: C.tealMid || C.teal,
                        }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
