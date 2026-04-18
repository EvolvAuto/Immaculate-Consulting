// ═══════════════════════════════════════════════════════════════════════════════
// InsightsView — daily headline + metrics + clinical quality + throughput +
// wait time + screener ops + 30-day trend + network benchmarks
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../auth/AuthProvider";
import { C } from "../lib/tokens";
import { Badge, Btn, Card, TopBar, SectionHead, StatCard, Loader, ErrorBanner, EmptyState } from "../components/ui";

const daysAgoDate = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
const daysAgoIso  = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString(); };

const atGoal = (value, metric) => {
  if (value == null || !metric) return null;
  const v = Number(value);
  if (Number.isNaN(v)) return null;
  const lo = metric.goal_low != null ? Number(metric.goal_low) : null;
  const hi = metric.goal_high != null ? Number(metric.goal_high) : null;
  if (lo != null && hi != null) return v >= lo && v <= hi;
  if (hi != null && metric.higher_is_better === false) return v <= hi;
  if (lo != null && metric.higher_is_better === true)  return v >= lo;
  if (hi != null) return v <= hi;
  if (lo != null) return v >= lo;
  return null;
};

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function InsightsView() {
  const { practiceId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rangeDays, setRangeDays] = useState(30);

  // Existing
  const [insights, setInsights] = useState([]);
  const [benchmarks, setBenchmarks] = useState([]);
  const [practice, setPractice] = useState(null);

  // New analytical sections
  const [panels, setPanels] = useState([]);
  const [codes, setCodes] = useState([]);
  const [metrics, setMetrics] = useState([]);
  const [measurements, setMeasurements] = useState([]);
  const [patients, setPatients] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [queueEntries, setQueueEntries] = useState([]);
  const [providers, setProviders] = useState([]);
  const [screeners, setScreeners] = useState([]);

  useEffect(() => {
    if (!practiceId) return;
    (async () => {
      try {
        setLoading(true);
        const fromDate = daysAgoDate(rangeDays);
        const fromIso  = daysAgoIso(rangeDays);
        const [i, b, p, pnl, cds, mts, meas, pts, appts, qe, provs, scrn] = await Promise.all([
          supabase.from("ic_insights_daily").select("*").order("snapshot_date", { ascending: false }).limit(30),
          supabase.from("benchmark_snapshots").select("*").order("snapshot_date", { ascending: false }).limit(50),
          supabase.from("practices").select("*").eq("id", practiceId).single(),
          supabase.from("clinical_panels").select("*").eq("is_active", true).order("sort_order"),
          supabase.from("panel_condition_codes").select("*"),
          supabase.from("clinical_metrics").select("*").eq("is_active", true).order("sort_order"),
          supabase.from("clinical_measurements").select("patient_id, metric_id, measured_at, value_numeric").gte("measured_at", fromDate),
          supabase.from("patients").select("id, problem_list").eq("status", "Active"),
          supabase.from("appointments").select("id, provider_id, appt_date, status").gte("appt_date", fromDate),
          supabase.from("queue_entries").select("id, arrived_at, roomed_at").gte("arrived_at", fromIso).not("roomed_at", "is", null),
          supabase.from("providers").select("id, first_name, last_name").eq("is_active", true),
          supabase.from("screener_responses").select("id, screener_type, requires_followup, reviewed_at, completed_at").gte("completed_at", fromIso),
        ]);
        for (const r of [i, b, pnl, cds, mts, meas, pts, appts, qe, provs, scrn]) if (r.error) throw r.error;
        setInsights(i.data || []);
        setBenchmarks(b.data || []);
        setPractice(p.data);
        setPanels(pnl.data || []);
        setCodes(cds.data || []);
        setMetrics(mts.data || []);
        setMeasurements(meas.data || []);
        setPatients(pts.data || []);
        setAppointments(appts.data || []);
        setQueueEntries(qe.data || []);
        setProviders(provs.data || []);
        setScreeners(scrn.data || []);
      } catch (e) { setError(e.message); }
      finally { setLoading(false); }
    })();
  }, [practiceId, rangeDays]);

  const latest = insights[0];
  const latestMetrics = latest?.metrics || {};

  const compare = (myValue, b) => {
    if (!b || myValue == null) return null;
    if (myValue >= b.p90) return { tier: "Top 10%", color: C.green, pct: 95 };
    if (myValue >= b.p75) return { tier: "Top quartile", color: C.teal, pct: 80 };
    if (myValue >= b.p50) return { tier: "Above median", color: C.blue, pct: 60 };
    if (myValue >= b.p25) return { tier: "Below median", color: C.amber, pct: 35 };
    return { tier: "Bottom quartile", color: C.red, pct: 15 };
  };

  // Map each active patient to the panels they qualify for, via problem_list
  const panelPatientMap = useMemo(() => {
    const map = {};
    for (const panel of panels) {
      const panelCodes = codes.filter((c) => c.panel_id === panel.id);
      const matching = new Set();
      for (const p of patients) {
        const problems = (p.problem_list || []).map((it) => typeof it === "string" ? it : it.code).filter(Boolean);
        outer: for (const pc of panelCodes) {
          for (const code of problems) {
            if (pc.code_prefix === true && code.startsWith(pc.code)) { matching.add(p.id); break outer; }
            if (pc.code_prefix !== true && pc.code === code)        { matching.add(p.id); break outer; }
          }
        }
      }
      map[panel.id] = matching;
    }
    return map;
  }, [panels, codes, patients]);

  const clinicalQuality = useMemo(() => {
    let totalMeasured = 0;
    let totalAtGoal = 0;
    const panelScores = [];
    for (const panel of panels) {
      const eligibleIds = panelPatientMap[panel.id] || new Set();
      if (eligibleIds.size === 0) continue;
      const panelMetrics = metrics.filter((m) => m.panel_id === panel.id);
      const primary = panelMetrics[0];
      if (!primary) continue;
      const byPatient = new Map();
      for (const m of measurements) {
        if (m.metric_id !== primary.id) continue;
        if (!eligibleIds.has(m.patient_id)) continue;
        const prev = byPatient.get(m.patient_id);
        if (!prev || new Date(m.measured_at) > new Date(prev.measured_at)) byPatient.set(m.patient_id, m);
      }
      const latestByP = Array.from(byPatient.values());
      const goalCount = latestByP.filter((m) => atGoal(m.value_numeric, primary) === true).length;
      totalMeasured += latestByP.length;
      totalAtGoal += goalCount;
      if (latestByP.length > 0) {
        panelScores.push({ name: panel.name, color: panel.color, rate: goalCount / latestByP.length, count: latestByP.length });
      }
    }
    return { composite: totalMeasured > 0 ? totalAtGoal / totalMeasured : null, panelScores, totalMeasured, totalAtGoal };
  }, [panels, panelPatientMap, metrics, measurements]);

  const throughputByProvider = useMemo(() => {
    return providers.map((p) => {
      const prov = appointments.filter((a) => a.provider_id === p.id);
      const completed = prov.filter((a) => a.status === "Completed").length;
      return { id: p.id, name: `Dr. ${p.last_name}`, completed, scheduled: prov.length, avgPerDay: rangeDays > 0 ? completed / rangeDays : 0 };
    }).sort((a, b) => b.completed - a.completed);
  }, [providers, appointments, rangeDays]);

  const waitTimeByDow = useMemo(() => {
    return [0,1,2,3,4,5,6].map((idx) => {
      const entries = queueEntries.filter((q) => new Date(q.arrived_at).getDay() === idx);
      const waits = entries.map((q) => (new Date(q.roomed_at).getTime() - new Date(q.arrived_at).getTime()) / 60000);
      const avg = waits.length > 0 ? waits.reduce((a, b) => a + b, 0) / waits.length : 0;
      return { idx, label: DOW[idx], count: entries.length, avgMin: Math.round(avg) };
    });
  }, [queueEntries]);

  const screenerStats = useMemo(() => {
    const d7 = new Date(); d7.setDate(d7.getDate() - 7);
    const d14 = new Date(); d14.setDate(d14.getDate() - 14);
    const thisWeek = screeners.filter((s) => new Date(s.completed_at) >= d7).length;
    const lastWeek = screeners.filter((s) => { const d = new Date(s.completed_at); return d >= d14 && d < d7; }).length;
    const flaggedUnreviewed = screeners.filter((s) => s.requires_followup === true && s.reviewed_at == null).length;
    return { total: screeners.length, thisWeek, lastWeek, delta: thisWeek - lastWeek, flaggedUnreviewed };
  }, [screeners]);

  if (loading) return <div style={{ flex: 1 }}><TopBar title="IC Insights" /><Loader /></div>;

  const maxThroughput = Math.max(...throughputByProvider.map((p) => p.completed), 1);
  const maxWait = Math.max(...waitTimeByDow.map((d) => d.avgMin), 1);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar
        title="IC Insights"
        sub={latest ? `Last snapshot: ${latest.snapshot_date} · Analytics: last ${rangeDays} days` : `No insights yet · Analytics: last ${rangeDays} days`}
        actions={
          <select value={rangeDays} onChange={(e) => setRangeDays(Number(e.target.value))}
            style={{ padding: "6px 10px", border: `0.5px solid ${C.borderMid}`, borderRadius: 6, fontSize: 12, fontFamily: "inherit" }}>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={180}>Last 180 days</option>
          </select>
        }
      />

      <div style={{ flex: 1, overflowY: "auto", padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
        {error && <ErrorBanner message={error} />}

        {/* ── Today's Headline + Recommendations ───────────────────────── */}
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

            {/* ── Today's Metrics ─────────────────────────────────────── */}
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
          </>
        }

        {/* ── Clinical Quality Score ───────────────────────────────────── */}
        <Card>
          <SectionHead title="Clinical Quality Score" sub={`Composite at-goal rate across ${clinicalQuality.panelScores.length} active panels · last ${rangeDays} days`} />
          {clinicalQuality.composite == null ? (
            <div style={{ padding: 20, textAlign: "center", color: C.textTertiary, fontSize: 12 }}>
              No measured patients in window.
            </div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12, padding: "4px 12px 12px" }}>
                <div style={{ fontSize: 40, fontWeight: 800, color: clinicalQuality.composite >= 0.7 ? C.green : clinicalQuality.composite >= 0.5 ? C.amber : C.red, letterSpacing: "-0.03em" }}>
                  {Math.round(clinicalQuality.composite * 100)}%
                </div>
                <div style={{ fontSize: 12, color: C.textTertiary }}>
                  {clinicalQuality.totalAtGoal} of {clinicalQuality.totalMeasured} measured patients at goal
                </div>
              </div>
              {clinicalQuality.panelScores.map((p) => (
                <div key={p.name} style={{ display: "grid", gridTemplateColumns: "1.5fr 2fr 0.8fr 0.8fr", gap: 12, padding: "8px 12px", fontSize: 12, alignItems: "center", borderBottom: `0.5px solid ${C.borderLight}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: p.color || C.tealMid }} />
                    <div style={{ fontWeight: 600, color: C.textPrimary }}>{p.name}</div>
                  </div>
                  <div><div style={{ width: "100%", height: 8, background: C.bgSecondary, borderRadius: 4, overflow: "hidden" }}><div style={{ width: `${Math.round(p.rate * 100)}%`, height: "100%", background: p.rate >= 0.7 ? C.green : p.rate >= 0.5 ? C.amber : C.red }} /></div></div>
                  <div style={{ textAlign: "right", color: C.textSecondary }}>{p.count} measured</div>
                  <div style={{ textAlign: "right" }}><Badge label={`${Math.round(p.rate * 100)}%`} variant={p.rate >= 0.7 ? "green" : p.rate >= 0.5 ? "amber" : "red"} size="xs" /></div>
                </div>
              ))}
            </>
          )}
        </Card>

        {/* ── Throughput by Provider ───────────────────────────────────── */}
        <Card>
          <SectionHead title="Throughput by Provider" sub={`Completed appointments in ${rangeDays}-day window`} />
          {throughputByProvider.filter((p) => p.scheduled > 0).length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: C.textTertiary, fontSize: 12 }}>No provider appointments in this window.</div>
          ) : throughputByProvider.filter((p) => p.scheduled > 0).map((p) => (
            <div key={p.id} style={{ display: "grid", gridTemplateColumns: "1.5fr 2fr 0.8fr 0.8fr", gap: 12, padding: "8px 12px", fontSize: 12, alignItems: "center", borderBottom: `0.5px solid ${C.borderLight}` }}>
              <div style={{ fontWeight: 600, color: C.textPrimary }}>{p.name}</div>
              <div><div style={{ width: "100%", height: 8, background: C.bgSecondary, borderRadius: 4, overflow: "hidden" }}><div style={{ width: `${Math.round((p.completed / maxThroughput) * 100)}%`, height: "100%", background: C.teal }} /></div></div>
              <div style={{ textAlign: "right", color: C.textSecondary }}>{p.completed} / {p.scheduled}</div>
              <div style={{ textAlign: "right", color: C.textSecondary }}>{p.avgPerDay.toFixed(1)}/day</div>
            </div>
          ))}
        </Card>

        {/* ── Avg Wait Time by Day of Week ─────────────────────────────── */}
        <Card>
          <SectionHead title="Avg Wait Time by Day of Week" sub="Arrival to roomed" />
          {queueEntries.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: C.textTertiary, fontSize: 12 }}>No queue data in this window.</div>
          ) : waitTimeByDow.map((d) => (
            <div key={d.idx} style={{ display: "grid", gridTemplateColumns: "1.5fr 2fr 0.8fr 0.8fr", gap: 12, padding: "8px 12px", fontSize: 12, alignItems: "center", borderBottom: `0.5px solid ${C.borderLight}` }}>
              <div style={{ fontWeight: 600, color: C.textPrimary }}>{d.label}</div>
              <div><div style={{ width: "100%", height: 8, background: C.bgSecondary, borderRadius: 4, overflow: "hidden" }}><div style={{ width: `${Math.round((d.avgMin / maxWait) * 100)}%`, height: "100%", background: d.avgMin > 30 ? C.red : d.avgMin > 15 ? C.amber : C.teal }} /></div></div>
              <div style={{ textAlign: "right", color: C.textSecondary }}>{d.count} visits</div>
              <div style={{ textAlign: "right" }}>{d.count === 0 ? <span style={{ color: C.textTertiary }}>-</span> : <Badge label={`${d.avgMin}m`} variant={d.avgMin > 30 ? "red" : d.avgMin > 15 ? "amber" : "green"} size="xs" />}</div>
            </div>
          ))}
        </Card>

        {/* ── Screener Operations ──────────────────────────────────────── */}
        <Card>
          <SectionHead title="Screener Operations" sub="Recent velocity and follow-up review queue" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, padding: "12px 16px" }}>
            <div>
              <div style={{ fontSize: 11, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>This week</div>
              <div style={{ fontSize: 22, fontWeight: 800 }}>{screenerStats.thisWeek}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>Last week</div>
              <div style={{ fontSize: 22, fontWeight: 800 }}>{screenerStats.lastWeek}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>Trend</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: screenerStats.delta >= 0 ? C.green : C.red }}>{screenerStats.delta >= 0 ? "+" : ""}{screenerStats.delta}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>Awaiting Review</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: screenerStats.flaggedUnreviewed > 0 ? C.amber : C.green }}>{screenerStats.flaggedUnreviewed}</div>
            </div>
          </div>
          {screenerStats.flaggedUnreviewed > 0 && (
            <div style={{ margin: "0 16px 16px", padding: "10px 12px", fontSize: 12, color: C.amber, background: C.bgSecondary, borderRadius: 6 }}>
              {screenerStats.flaggedUnreviewed} flagged screener{screenerStats.flaggedUnreviewed !== 1 ? "s" : ""} awaiting clinical review. Linked follow-up tasks are in the Tasks tab.
            </div>
          )}
          {screenerStats.total === 0 && (
            <div style={{ padding: 20, textAlign: "center", color: C.textTertiary, fontSize: 12 }}>No screener activity in this window.</div>
          )}
        </Card>

        {/* ── 30-Day Trend ─────────────────────────────────────────────── */}
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

        {/* ── Network Benchmarks ───────────────────────────────────────── */}
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
