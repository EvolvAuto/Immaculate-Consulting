// ═══════════════════════════════════════════════════════════════════════════════
// InsightsView — practice-level KPIs: clinical quality, throughput, wait time,
// screener operations, and network benchmarks.
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../auth/AuthProvider";
import { C } from "../lib/tokens";
import { Badge, Card, TopBar, SectionHead, Loader, ErrorBanner, EmptyState } from "../components/ui";

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

export default function InsightsView() {
  const { practiceId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rangeDays, setRangeDays] = useState(30);

  const [panels, setPanels] = useState([]);
  const [codes, setCodes] = useState([]);
  const [metrics, setMetrics] = useState([]);
  const [measurements, setMeasurements] = useState([]);
  const [patients, setPatients] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [queueEntries, setQueueEntries] = useState([]);
  const [providers, setProviders] = useState([]);
  const [screeners, setScreeners] = useState([]);
  const [benchmarks, setBenchmarks] = useState([]);

  useEffect(() => {
    if (!practiceId) return;
    (async () => {
      try {
        setLoading(true);
        const fromDate = daysAgoDate(rangeDays);
        const fromIso  = daysAgoIso(rangeDays);
        const [pnl, cds, mts, meas, pts, appts, qe, provs, scrn, bm] = await Promise.all([
          supabase.from("clinical_panels").select("*").eq("is_active", true).order("sort_order"),
          supabase.from("panel_condition_codes").select("*"),
          supabase.from("clinical_metrics").select("*").eq("is_active", true).order("sort_order"),
          supabase.from("clinical_measurements").select("patient_id, metric_id, measured_at, value_numeric").gte("measured_at", fromDate),
          supabase.from("patients").select("id, problem_list").eq("status", "Active"),
          supabase.from("appointments").select("id, provider_id, appt_date, status").gte("appt_date", fromDate),
          supabase.from("queue_entries").select("id, arrived_at, roomed_at").gte("arrived_at", fromIso).not("roomed_at", "is", null),
          supabase.from("providers").select("id, first_name, last_name").eq("is_active", true),
          supabase.from("screener_responses").select("id, screener_type, requires_followup, reviewed_at, completed_at").gte("completed_at", fromIso),
          supabase.from("benchmark_snapshots").select("*"),
        ]);
        for (const r of [pnl, cds, mts, meas, pts, appts, qe, provs, scrn, bm]) if (r.error) throw r.error;
        setPanels(pnl.data || []);
        setCodes(cds.data || []);
        setMetrics(mts.data || []);
        setMeasurements(meas.data || []);
        setPatients(pts.data || []);
        setAppointments(appts.data || []);
        setQueueEntries(qe.data || []);
        setProviders(provs.data || []);
        setScreeners(scrn.data || []);
        setBenchmarks(bm.data || []);
      } catch (e) { setError(e.message); }
      finally { setLoading(false); }
    })();
  }, [practiceId, rangeDays]);

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
      const latest = Array.from(byPatient.values());
      const goalCount = latest.filter((m) => atGoal(m.value_numeric, primary) === true).length;
      totalMeasured += latest.length;
      totalAtGoal += goalCount;
      if (latest.length > 0) {
        panelScores.push({ name: panel.name, color: panel.color, rate: goalCount / latest.length, count: latest.length });
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
    const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return [0,1,2,3,4,5,6].map((idx) => {
      const entries = queueEntries.filter((q) => new Date(q.arrived_at).getDay() === idx);
      const waits = entries.map((q) => (new Date(q.roomed_at).getTime() - new Date(q.arrived_at).getTime()) / 60000);
      const avg = waits.length > 0 ? waits.reduce((a, b) => a + b, 0) / waits.length : 0;
      return { idx, label: DOW[idx], count: entries.length, avgMin: Math.round(avg) };
    });
  }, [queueEntries]);

  const overallWait = useMemo(() => {
    const waits = queueEntries.map((q) => (new Date(q.roomed_at).getTime() - new Date(q.arrived_at).getTime()) / 60000);
    return waits.length > 0 ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : 0;
  }, [queueEntries]);

  const todayStats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const t = appointments.filter((a) => a.appt_date === today);
    return { completed: t.filter((a) => a.status === "Completed").length, total: t.length };
  }, [appointments]);

  const noShowRate = useMemo(() => {
    const c = appointments.filter((a) => a.status === "Completed").length;
    const n = appointments.filter((a) => a.status === "No Show").length;
    const x = appointments.filter((a) => a.status === "Cancelled").length;
    const denom = c + n + x;
    return denom > 0 ? n / denom : 0;
  }, [appointments]);

  const screenerStats = useMemo(() => {
    const d7 = new Date(); d7.setDate(d7.getDate() - 7);
    const d14 = new Date(); d14.setDate(d14.getDate() - 14);
    const thisWeek = screeners.filter((s) => new Date(s.completed_at) >= d7).length;
    const lastWeek = screeners.filter((s) => { const d = new Date(s.completed_at); return d >= d14 && d < d7; }).length;
    const flaggedUnreviewed = screeners.filter((s) => s.requires_followup === true && s.reviewed_at == null).length;
    return { total: screeners.length, thisWeek, lastWeek, delta: thisWeek - lastWeek, flaggedUnreviewed };
  }, [screeners]);

  if (loading) return <div style={{ flex: 1 }}><TopBar title="Insights" /><Loader /></div>;

  const maxThroughput = Math.max(...throughputByProvider.map((p) => p.completed), 1);
  const maxWait = Math.max(...waitTimeByDow.map((d) => d.avgMin), 1);

  const KpiCard = ({ label, value, color, sub }) => (
    <Card>
      <div style={{ fontSize: 11, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: color || C.textPrimary }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.textTertiary }}>{sub}</div>}
    </Card>
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar
        title="Insights"
        sub={`Practice-level KPIs, throughput, and benchmarks · Last ${rangeDays} days`}
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

      {error && <div style={{ padding: 12 }}><ErrorBanner message={error} /></div>}

      <div style={{ flex: 1, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          <KpiCard
            label="Clinical Quality Score"
            value={clinicalQuality.composite == null ? "-" : `${Math.round(clinicalQuality.composite * 100)}%`}
            color={clinicalQuality.composite == null ? C.textTertiary : clinicalQuality.composite >= 0.7 ? C.green : clinicalQuality.composite >= 0.5 ? C.amber : C.red}
            sub={`${clinicalQuality.totalAtGoal} / ${clinicalQuality.totalMeasured} at goal`}
          />
          <KpiCard label="Today's Throughput" value={`${todayStats.completed} / ${todayStats.total}`} sub="completed of scheduled" />
          <KpiCard
            label="Avg Wait Time"
            value={`${overallWait}m`}
            color={overallWait > 30 ? C.red : overallWait > 15 ? C.amber : C.green}
            sub={`${queueEntries.length} visits, arrival to roomed`}
          />
          <KpiCard
            label="No-Show Rate"
            value={`${Math.round(noShowRate * 100)}%`}
            color={noShowRate > 0.15 ? C.red : noShowRate > 0.10 ? C.amber : C.green}
            sub={`over ${rangeDays} days`}
          />
        </div>

        <Card>
          <SectionHead title="Clinical Quality — Panel Breakdown" sub="% of measured patients at goal on each panel's primary metric" />
          {clinicalQuality.panelScores.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: C.textTertiary, fontSize: 12 }}>
              No measured patients in window. Section populates as patients get seen and measurements recorded.
            </div>
          ) : clinicalQuality.panelScores.map((p) => (
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
        </Card>

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

        <Card>
          <SectionHead title="Network Benchmarks" sub="Percentile comparison against anonymized peer practices" />
          {benchmarks.length === 0 ? (
            <EmptyState icon="📊" title="Benchmarks not yet available" sub="Network benchmarks populate once enough practices are on the platform and sample sizes support valid comparisons." />
          ) : benchmarks.map((b) => (
            <div key={b.id} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr", gap: 12, padding: "8px 12px", fontSize: 12, borderBottom: `0.5px solid ${C.borderLight}` }}>
              <div style={{ fontWeight: 600, color: C.textPrimary }}>{b.metric_key}</div>
              <div style={{ textAlign: "right", color: C.textSecondary }}>P25 {b.p25}</div>
              <div style={{ textAlign: "right", color: C.textSecondary }}>P50 {b.p50}</div>
              <div style={{ textAlign: "right", color: C.textSecondary }}>P75 {b.p75}</div>
              <div style={{ textAlign: "right", color: C.textSecondary }}>P90 {b.p90}</div>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
