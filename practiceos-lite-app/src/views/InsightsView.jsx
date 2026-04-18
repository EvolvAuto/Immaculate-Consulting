// ═══════════════════════════════════════════════════════════════════════════════
// InsightsView — ic_insights_daily trend + benchmark_snapshots percentile panels
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../auth/AuthProvider";
import { C } from "../lib/tokens";
import { Badge, Btn, Card, TopBar, SectionHead, StatCard, Loader, ErrorBanner, EmptyState } from "../components/ui";

export default function InsightsView() {
  const { practiceId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [insights, setInsights] = useState([]);
  const [benchmarks, setBenchmarks] = useState([]);
  const [practice, setPractice] = useState(null);

  useEffect(() => {
    if (!practiceId) return;
    (async () => {
      try {
        setLoading(true);
        const [i, b, p] = await Promise.all([
          supabase.from("ic_insights_daily").select("*").order("snapshot_date", { ascending: false }).limit(30),
          supabase.from("benchmark_snapshots").select("*").order("snapshot_date", { ascending: false }).limit(50),
          supabase.from("practices").select("*").eq("id", practiceId).single(),
        ]);
        if (i.error) throw i.error;
        setInsights(i.data || []);
        setBenchmarks(b.data || []);
        setPractice(p.data);
      } catch (e) { setError(e.message); }
      finally { setLoading(false); }
    })();
  }, [practiceId]);

  const latest = insights[0];
  const latestMetrics = latest?.metrics || {};

  // Compare our metric to benchmark percentiles
  const latestBench = benchmarks.find((b) => b.specialty === practice?.specialty || !practice?.specialty);
  const compare = (myValue, b) => {
    if (!b || myValue == null) return null;
    const { p25, p50, p75, p90 } = b;
    if (myValue >= p90) return { tier: "Top 10%", color: C.green, pct: 95 };
    if (myValue >= p75) return { tier: "Top quartile", color: C.teal, pct: 80 };
    if (myValue >= p50) return { tier: "Above median", color: C.blue, pct: 60 };
    if (myValue >= p25) return { tier: "Below median", color: C.amber, pct: 35 };
    return { tier: "Bottom quartile", color: C.red, pct: 15 };
  };

  if (loading) return <div style={{ flex: 1 }}><TopBar title="Insights" /><Loader /></div>;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar title="IC Insights" sub={latest ? `Last snapshot: ${latest.snapshot_date}` : "No insights yet"} />

      <div style={{ flex: 1, overflowY: "auto", padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
        {error && <ErrorBanner message={error} />}

        {!latest ? <EmptyState icon="📊" title="No insights available" sub="IC runs a daily snapshot of your practice metrics. Check back after the first run." />
          : <>
            <Card style={{ borderLeft: `4px solid ${C.teal}`, padding: 20 }}>
              <Badge label="Today's Headline" variant="teal" />
              <div style={{ fontSize: 22, fontWeight: 800, color: C.textPrimary, marginTop: 10, letterSpacing: "-0.02em" }}>
                {latest.headline_stat}
              </div>
              {Array.isArray(latest.recommendations) && latest.recommendations.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.textSecondary, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                    Recommendations
                  </div>
                  {latest.recommendations.map((r, i) => (
                    <div key={i} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: `0.5px solid ${C.borderLight}` }}>
                      <div style={{ width: 20, height: 20, borderRadius: "50%", background: C.tealBg, color: C.teal, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{i + 1}</div>
                      <div style={{ fontSize: 13, color: C.textPrimary }}>{typeof r === "string" ? r : r.text || JSON.stringify(r)}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <div>
              <SectionHead title="Today's Metrics" sub="Snapshot of your operational health" />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
                {Object.entries(latestMetrics).slice(0, 8).map(([k, v]) => (
                  <StatCard
                    key={k}
                    label={k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                    value={typeof v === "number" ? (Number.isInteger(v) ? v : v.toFixed(2)) : String(v)}
                    color={C.teal}
                  />
                ))}
                {Object.keys(latestMetrics).length === 0 && (
                  <div style={{ gridColumn: "1 / -1", padding: 16, fontSize: 12, color: C.textTertiary, textAlign: "center" }}>
                    Metrics JSON is empty. Once your daily snapshot runs, metrics will appear here.
                  </div>
                )}
              </div>
            </div>

            {insights.length > 1 && (
              <Card>
                <SectionHead title="30-Day Trend" sub="Headline stat history" />
                <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 240, overflowY: "auto" }}>
                  {insights.slice(0, 14).map((i) => (
                    <div key={i.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 8px", borderBottom: `0.5px solid ${C.borderLight}` }}>
                      <div style={{ fontSize: 11, color: C.textTertiary, minWidth: 84 }}>{i.snapshot_date}</div>
                      <div style={{ fontSize: 12, color: C.textPrimary, flex: 1 }}>{i.headline_stat}</div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </>
        }

        <div>
          <SectionHead title="Network Benchmarks" sub="How you compare to similar NC practices (anonymized)" />
          {benchmarks.length === 0 ? (
            <Card><div style={{ padding: 24, textAlign: "center", color: C.textTertiary, fontSize: 12 }}>
              No benchmark data yet. Benchmarks are published quarterly based on the IC network.
            </div></Card>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
              {benchmarks.slice(0, 6).map((b) => {
                const myVal = latestMetrics[b.metric_key];
                const cmp = compare(myVal, b);
                return (
                  <Card key={b.id}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.textSecondary, textTransform: "uppercase", letterSpacing: "0.05em" }}>{b.metric_key}</div>
                    <div style={{ fontSize: 11, color: C.textTertiary, marginBottom: 8 }}>{b.specialty} · {b.practice_size_bucket}</div>
                    {cmp && (
                      <>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                          <div style={{ fontSize: 22, fontWeight: 800, color: cmp.color }}>{myVal}</div>
                          <Badge label={cmp.tier} variant="teal" size="xs" />
                        </div>
                        <div style={{ height: 6, background: C.bgSecondary, borderRadius: 3, marginTop: 8, position: "relative" }}>
                          <div style={{ position: "absolute", left: `${cmp.pct}%`, top: -3, width: 3, height: 12, background: cmp.color, borderRadius: 2 }} />
                        </div>
                      </>
                    )}
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.textTertiary, marginTop: 6 }}>
                      <span>p25: {b.p25}</span><span>p50: {b.p50}</span><span>p75: {b.p75}</span><span>p90: {b.p90}</span>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
