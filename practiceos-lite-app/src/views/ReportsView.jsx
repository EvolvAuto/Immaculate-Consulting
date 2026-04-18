// ═══════════════════════════════════════════════════════════════════════════════
// ReportsView — practice-wide compliance, trends, and gaps
// Panel-aware: shows only measures for panels the practice has patients on.
// Reads followup_window_days from clinical_panels so windows are editable
// from Settings without code changes.
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../auth/AuthProvider";
import { C } from "../lib/tokens";
import { Badge, Btn, Card, TopBar, TabBar, SectionHead, Loader, ErrorBanner, EmptyState } from "../components/ui";

// ─── Helpers ─────────────────────────────────────────────────────────────────
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};
const fmtPct = (n, d) => d === 0 ? "—" : `${Math.round((n / d) * 100)}%`;
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

// Given a threshold op + value string, decide if a measurement is "at goal"
// ops come from clinical_metrics.threshold_op: '<', '<=', '>', '>=', 'between'
const atGoal = (value, goalOp, goalValue) => {
  if (value == null || goalValue == null) return null;
  const v = Number(value);
  if (Number.isNaN(v)) return null;
  if (goalOp === "<")  return v <  Number(goalValue);
  if (goalOp === "<=") return v <= Number(goalValue);
  if (goalOp === ">")  return v >  Number(goalValue);
  if (goalOp === ">=") return v >= Number(goalValue);
  return null;
};

// Convert an array of objects to CSV text and trigger a download.
const exportCSV = (filename, rows) => {
  if (!rows || rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const escape = (v) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => escape(r[h])).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
};

// ═════════════════════════════════════════════════════════════════════════════
// Main view
// ═════════════════════════════════════════════════════════════════════════════
export default function ReportsView() {
  const { practiceId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rangeDays, setRangeDays] = useState(90);
  const [tab, setTab] = useState("compliance");

  // Raw data containers
  const [panels, setPanels] = useState([]);
  const [codes, setCodes] = useState([]);
  const [metrics, setMetrics] = useState([]);
  const [measurements, setMeasurements] = useState([]);
  const [patients, setPatients] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [providers, setProviders] = useState([]);
  const [screeners, setScreeners] = useState([]);

  // ─── Load all data in parallel ────────────────────────────────────────────
  useEffect(() => {
    if (!practiceId) return;
    (async () => {
      try {
        setLoading(true);
        const from = daysAgo(rangeDays);
        const [pnl, cds, mts, meas, pts, appts, provs, scrn] = await Promise.all([
          supabase.from("clinical_panels").select("*").eq("is_active", true).order("sort_order"),
          supabase.from("panel_condition_codes").select("*"),
          supabase.from("clinical_metrics").select("*").eq("is_active", true),
          supabase.from("clinical_measurements").select("patient_id, metric_id, measured_at, value, value_text").gte("measured_at", from),
          supabase.from("patients").select("id, first_name, last_name, date_of_birth, problem_list, mrn").eq("status", "Active"),
          supabase.from("appointments").select("id, provider_id, appt_date, status, copay_amount, copay_collected").gte("appt_date", from),
          supabase.from("providers").select("id, first_name, last_name").eq("is_active", true),
          supabase.from("screener_responses").select("id, screener_type, patient_id, total_score, positive, completed_at").gte("completed_at", from),
        ]);
        for (const r of [pnl, cds, mts, meas, pts, appts, provs, scrn]) if (r.error) throw r.error;
        setPanels(pnl.data || []);
        setCodes(cds.data || []);
        setMetrics(mts.data || []);
        setMeasurements(meas.data || []);
        setPatients(pts.data || []);
        setAppointments(appts.data || []);
        setProviders(provs.data || []);
        setScreeners(scrn.data || []);
      } catch (e) { setError(e.message); }
      finally { setLoading(false); }
    })();
  }, [practiceId, rangeDays]);

  // ─── Derived: which panels actually apply to this practice's patients ────
  // A panel applies if at least one active patient has a problem_list code matching its triggers.
  const panelPatientMap = useMemo(() => {
    const map = {}; // panel_id -> Set of patient_ids
    for (const panel of panels) {
      const panelCodes = codes.filter((c) => c.panel_id === panel.id);
      const matching = new Set();
      for (const p of patients) {
        const problems = (p.problem_list || []).map((it) => typeof it === "string" ? it : it.code).filter(Boolean);
        for (const pc of panelCodes) {
          for (const code of problems) {
            if (pc.code_prefix && code.startsWith(pc.code_prefix)) { matching.add(p.id); break; }
            if (pc.code === code) { matching.add(p.id); break; }
          }
          if (matching.has(p.id)) break;
        }
      }
      map[panel.id] = matching;
    }
    return map;
  }, [panels, codes, patients]);

  const applicablePanels = useMemo(
    () => panels.filter((p) => (panelPatientMap[p.id]?.size || 0) > 0),
    [panels, panelPatientMap]
  );

  if (loading) return <div style={{ flex: 1 }}><TopBar title="Reports" /><Loader /></div>;

  const rangeLabel = `Last ${rangeDays} days`;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar
        title="Reports"
        sub={`Practice-wide compliance, trends, and gaps · ${rangeLabel}`}
        actions={
          <>
            <TabBar
              tabs={[
                ["compliance", "Compliance"],
                ["noshow", "No-Shows"],
                ["gaps", "Follow-Up Gaps"],
                ["copay", "Copay"],
                ["screeners", "Screeners"],
              ]}
              active={tab}
              onChange={setTab}
            />
            <select
              value={rangeDays}
              onChange={(e) => setRangeDays(Number(e.target.value))}
              style={{ padding: "6px 10px", border: `0.5px solid ${C.borderMid}`, borderRadius: 6, fontSize: 12, fontFamily: "inherit" }}
            >
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
              <option value={180}>Last 180 days</option>
              <option value={365}>Last 365 days</option>
            </select>
          </>
        }
      />

      {error && <div style={{ padding: 12 }}><ErrorBanner message={error} /></div>}

      <div style={{ flex: 1, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
        {tab === "compliance" && (
          <ComplianceTab
            applicablePanels={applicablePanels}
            panelPatientMap={panelPatientMap}
            metrics={metrics}
            measurements={measurements}
            patients={patients}
            rangeDays={rangeDays}
          />
        )}
        {tab === "noshow" && (
          <NoShowTab appointments={appointments} providers={providers} rangeDays={rangeDays} />
        )}
        {tab === "gaps" && (
          <GapsTab
            applicablePanels={applicablePanels}
            panelPatientMap={panelPatientMap}
            metrics={metrics}
            patients={patients}
            practiceId={practiceId}
          />
        )}
        {tab === "copay" && (
          <CopayTab appointments={appointments} rangeDays={rangeDays} />
        )}
        {tab === "screeners" && (
          <ScreenersTab screeners={screeners} patients={patients} rangeDays={rangeDays} />
        )}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Tab 1: Compliance — per-panel % of eligible patients at goal at last measurement
// ═════════════════════════════════════════════════════════════════════════════
function ComplianceTab({ applicablePanels, panelPatientMap, metrics, measurements, patients, rangeDays }) {
  if (applicablePanels.length === 0) {
    return <EmptyState icon="📊" title="No applicable panels" sub="No active patients match any configured clinical panel triggers." />;
  }

  const rows = applicablePanels.map((panel) => {
    const eligiblePatientIds = panelPatientMap[panel.id] || new Set();
    const panelMetrics = metrics.filter((m) => m.panel_id === panel.id);
    const primary = panelMetrics.find((m) => m.is_primary) || panelMetrics[0];
    if (!primary) return { panel, primary: null, measured: 0, atGoal: 0, eligible: eligiblePatientIds.size };

    // Latest measurement per patient for the primary metric, within window
    const byPatient = new Map();
    for (const m of measurements) {
      if (m.metric_id !== primary.id) continue;
      if (!eligiblePatientIds.has(m.patient_id)) continue;
      const prev = byPatient.get(m.patient_id);
      if (!prev || new Date(m.measured_at) > new Date(prev.measured_at)) byPatient.set(m.patient_id, m);
    }
    const latest = Array.from(byPatient.values());
    const goalCount = latest.filter((m) => atGoal(m.value, primary.goal_op, primary.goal_value) === true).length;

    return {
      panel,
      primary,
      measured: latest.length,
      atGoal: goalCount,
      eligible: eligiblePatientIds.size,
    };
  });

  const exportRows = () => exportCSV(
    `compliance_${rangeDays}d_${new Date().toISOString().slice(0,10)}.csv`,
    rows.map((r) => ({
      panel: r.panel.name,
      measure: r.primary?.name || "—",
      eligible_patients: r.eligible,
      measured_in_window: r.measured,
      at_goal: r.atGoal,
      compliance_pct: r.measured ? Math.round((r.atGoal / r.measured) * 100) : 0,
      coverage_pct: r.eligible ? Math.round((r.measured / r.eligible) * 100) : 0,
    }))
  );

  return (
    <>
      <Card>
        <SectionHead
          title="AMH Measure Compliance"
          sub="% of eligible patients at goal at their most recent measurement in window"
          action={<Btn size="sm" variant="outline" onClick={exportRows}>Export CSV</Btn>}
        />
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1.2fr 0.8fr 0.8fr 1fr 1fr", gap: 12, padding: "8px 12px", fontSize: 10, fontWeight: 700, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: `0.5px solid ${C.borderLight}` }}>
          <div>Panel</div>
          <div>Primary Measure</div>
          <div style={{ textAlign: "right" }}>Eligible</div>
          <div style={{ textAlign: "right" }}>Measured</div>
          <div style={{ textAlign: "right" }}>Coverage</div>
          <div style={{ textAlign: "right" }}>At Goal</div>
        </div>
        {rows.map((r) => (
          <div key={r.panel.id} style={{ display: "grid", gridTemplateColumns: "2fr 1.2fr 0.8fr 0.8fr 1fr 1fr", gap: 12, padding: "10px 12px", fontSize: 12, alignItems: "center", borderBottom: `0.5px solid ${C.borderLight}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: r.panel.color || C.tealMid }} />
              <div style={{ fontWeight: 600, color: C.textPrimary }}>{r.panel.name}</div>
              {r.panel.amh_measure_ref && <Badge label={r.panel.amh_measure_ref} variant="neutral" size="xs" />}
            </div>
            <div style={{ color: C.textSecondary }}>{r.primary?.name || "—"}</div>
            <div style={{ textAlign: "right", color: C.textSecondary }}>{r.eligible}</div>
            <div style={{ textAlign: "right", color: C.textSecondary }}>{r.measured}</div>
            <div style={{ textAlign: "right" }}>
              <Badge label={fmtPct(r.measured, r.eligible)} variant={r.eligible && r.measured / r.eligible >= 0.7 ? "green" : r.measured / r.eligible >= 0.4 ? "amber" : "red"} size="xs" />
            </div>
            <div style={{ textAlign: "right" }}>
              <Badge label={fmtPct(r.atGoal, r.measured)} variant={r.measured && r.atGoal / r.measured >= 0.7 ? "green" : r.atGoal / r.measured >= 0.4 ? "amber" : "red"} size="xs" />
            </div>
          </div>
        ))}
      </Card>
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Tab 2: No-Show trends by provider + by day of week
// ═════════════════════════════════════════════════════════════════════════════
function NoShowTab({ appointments, providers, rangeDays }) {
  const totalCompleted = appointments.filter((a) => a.status === "Completed").length;
  const totalNoShow = appointments.filter((a) => a.status === "No Show").length;
  const totalCancelled = appointments.filter((a) => a.status === "Cancelled").length;
  const totalScheduled = appointments.filter((a) => ["Completed", "No Show", "Cancelled", "Checked In", "Roomed", "In Progress"].includes(a.status)).length;
  const noShowRate = totalScheduled ? totalNoShow / totalScheduled : 0;

  // By provider
  const byProvider = providers.map((p) => {
    const prov = appointments.filter((a) => a.provider_id === p.id);
    const completed = prov.filter((a) => a.status === "Completed").length;
    const noShow = prov.filter((a) => a.status === "No Show").length;
    const total = prov.length;
    return { id: p.id, name: `Dr. ${p.last_name}`, total, completed, noShow, rate: total ? noShow / total : 0 };
  }).sort((a, b) => b.rate - a.rate);

  // By day-of-week
  const DOW_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const byDow = [0,1,2,3,4,5,6].map((idx) => {
    const dow = appointments.filter((a) => {
      const d = new Date(a.appt_date + "T00:00:00");
      return d.getDay() === idx;
    });
    const noShow = dow.filter((a) => a.status === "No Show").length;
    return { idx, label: DOW_LABELS[idx], total: dow.length, noShow, rate: dow.length ? noShow / dow.length : 0 };
  });

  const exportRows = () => {
    const providerRows = byProvider.map((p) => ({ dimension: "Provider", name: p.name, total_appointments: p.total, no_shows: p.noShow, no_show_pct: Math.round(p.rate * 100) }));
    const dowRows = byDow.map((d) => ({ dimension: "Day of Week", name: d.label, total_appointments: d.total, no_shows: d.noShow, no_show_pct: Math.round(d.rate * 100) }));
    exportCSV(`noshow_${rangeDays}d_${new Date().toISOString().slice(0,10)}.csv`, [...providerRows, ...dowRows]);
  };

  const maxDowRate = Math.max(...byDow.map((d) => d.rate), 0.01);

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        <Card><div style={{ fontSize: 11, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>Overall No-Show Rate</div><div style={{ fontSize: 24, fontWeight: 800, color: noShowRate > 0.15 ? C.red : noShowRate > 0.10 ? C.amber : C.green }}>{Math.round(noShowRate * 100)}%</div><div style={{ fontSize: 11, color: C.textTertiary }}>{totalNoShow} of {totalScheduled} appointments</div></Card>
        <Card><div style={{ fontSize: 11, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>Completed</div><div style={{ fontSize: 24, fontWeight: 800, color: C.green }}>{totalCompleted}</div></Card>
        <Card><div style={{ fontSize: 11, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>No-Shows</div><div style={{ fontSize: 24, fontWeight: 800, color: C.red }}>{totalNoShow}</div></Card>
        <Card><div style={{ fontSize: 11, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>Cancellations</div><div style={{ fontSize: 24, fontWeight: 800, color: C.amber }}>{totalCancelled}</div></Card>
      </div>

      <Card>
        <SectionHead title="No-Show Rate by Provider" sub="Ranked highest to lowest" action={<Btn size="sm" variant="outline" onClick={exportRows}>Export CSV</Btn>} />
        {byProvider.filter((p) => p.total > 0).map((p) => (
          <div key={p.id} style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 0.8fr 0.8fr", gap: 12, padding: "8px 12px", fontSize: 12, alignItems: "center", borderBottom: `0.5px solid ${C.borderLight}` }}>
            <div style={{ fontWeight: 600, color: C.textPrimary }}>{p.name}</div>
            <div><div style={{ width: "100%", height: 8, background: C.bgSecondary, borderRadius: 4, overflow: "hidden" }}><div style={{ width: `${Math.round(p.rate * 100)}%`, height: "100%", background: p.rate > 0.15 ? C.red : p.rate > 0.10 ? C.amber : C.green }} /></div></div>
            <div style={{ textAlign: "right", color: C.textSecondary }}>{p.noShow} / {p.total}</div>
            <div style={{ textAlign: "right" }}><Badge label={`${Math.round(p.rate * 100)}%`} variant={p.rate > 0.15 ? "red" : p.rate > 0.10 ? "amber" : "green"} size="xs" /></div>
          </div>
        ))}
      </Card>

      <Card>
        <SectionHead title="No-Show Rate by Day of Week" sub="Identify the day with the highest attrition" />
        {byDow.map((d) => (
          <div key={d.idx} style={{ display: "grid", gridTemplateColumns: "1.5fr 2fr 0.8fr 0.8fr", gap: 12, padding: "8px 12px", fontSize: 12, alignItems: "center", borderBottom: `0.5px solid ${C.borderLight}` }}>
            <div style={{ fontWeight: 600, color: C.textPrimary }}>{d.label}</div>
            <div><div style={{ width: "100%", height: 8, background: C.bgSecondary, borderRadius: 4, overflow: "hidden" }}><div style={{ width: `${Math.round((d.rate / maxDowRate) * 100)}%`, height: "100%", background: d.rate > 0.15 ? C.red : d.rate > 0.10 ? C.amber : C.teal }} /></div></div>
            <div style={{ textAlign: "right", color: C.textSecondary }}>{d.noShow} / {d.total}</div>
            <div style={{ textAlign: "right" }}>{d.total === 0 ? <span style={{ fontSize: 11, color: C.textTertiary }}>—</span> : <Badge label={`${Math.round(d.rate * 100)}%`} variant={d.rate > 0.15 ? "red" : d.rate > 0.10 ? "amber" : "green"} size="xs" />}</div>
          </div>
        ))}
      </Card>
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Tab 3: Follow-Up Gaps — uses panel.followup_window_days (editable in Settings)
// ═════════════════════════════════════════════════════════════════════════════
function GapsTab({ applicablePanels, panelPatientMap, metrics, patients, practiceId }) {
  const [gaps, setGaps] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!practiceId || applicablePanels.length === 0) { setGaps([]); return; }
    (async () => {
      try {
        // For each applicable panel, find eligible patients whose latest measurement
        // of the primary metric is older than followup_window_days (or has none).
        const all = [];
        for (const panel of applicablePanels) {
          const panelMetrics = metrics.filter((m) => m.panel_id === panel.id);
          const primary = panelMetrics.find((m) => m.is_primary) || panelMetrics[0];
          if (!primary) continue;
          const windowDays = panel.followup_window_days || 90;
          const threshold = new Date();
          threshold.setDate(threshold.getDate() - windowDays);

          const eligibleIds = Array.from(panelPatientMap[panel.id] || []);
          if (eligibleIds.length === 0) continue;

          // Pull latest measurement per patient for this metric (no date filter — we want all of history)
          const { data: meas, error: merr } = await supabase
            .from("clinical_measurements")
            .select("patient_id, measured_at, value")
            .eq("metric_id", primary.id)
            .in("patient_id", eligibleIds)
            .order("measured_at", { ascending: false });
          if (merr) throw merr;

          const latestByPatient = new Map();
          for (const m of meas || []) {
            if (!latestByPatient.has(m.patient_id)) latestByPatient.set(m.patient_id, m);
          }

          for (const pid of eligibleIds) {
            const pt = patients.find((p) => p.id === pid);
            if (!pt) continue;
            const latest = latestByPatient.get(pid);
            const lastAt = latest ? new Date(latest.measured_at) : null;
            const overdue = !lastAt || lastAt < threshold;
            if (overdue) {
              const daysSince = lastAt ? Math.floor((Date.now() - lastAt.getTime()) / (1000 * 60 * 60 * 24)) : null;
              all.push({
                panel: panel.name,
                panelColor: panel.color,
                measure: primary.name,
                patient_id: pid,
                mrn: pt.mrn,
                name: `${pt.first_name} ${pt.last_name}`,
                last_value: latest?.value ?? null,
                last_at: latest?.measured_at ?? null,
                days_since: daysSince,
                window_days: windowDays,
              });
            }
          }
        }
        all.sort((a, b) => (b.days_since || 9999) - (a.days_since || 9999));
        setGaps(all);
      } catch (e) { setError(e.message); }
    })();
  }, [practiceId, applicablePanels, metrics, panelPatientMap, patients]);

  const exportGaps = () => exportCSV(
    `followup_gaps_${new Date().toISOString().slice(0,10)}.csv`,
    (gaps || []).map((g) => ({ panel: g.panel, measure: g.measure, mrn: g.mrn, patient: g.name, last_value: g.last_value ?? "", last_measured: g.last_at ? g.last_at.slice(0,10) : "Never", days_since: g.days_since ?? "Never", window_days: g.window_days }))
  );

  if (error) return <ErrorBanner message={error} />;
  if (gaps === null) return <Loader />;

  if (applicablePanels.length === 0) {
    return <EmptyState icon="📋" title="No applicable panels" sub="Configure clinical panels in Settings or add patients with matching diagnoses." />;
  }

  return (
    <Card>
      <SectionHead
        title="Patients Overdue for Follow-Up"
        sub={`${gaps.length} patients past their panel's configured window. Edit windows in Settings → Clinical Panels.`}
        action={<Btn size="sm" variant="outline" onClick={exportGaps} disabled={gaps.length === 0}>Export CSV</Btn>}
      />
      {gaps.length === 0 ? (
        <div style={{ padding: 20, textAlign: "center", color: C.textTertiary, fontSize: 12 }}>All patients are up to date on their measurements. ✓</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1.4fr 1fr 1fr 0.8fr", gap: 12, padding: "8px 12px", fontSize: 10, fontWeight: 700, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: `0.5px solid ${C.borderLight}` }}>
            <div>Panel</div><div>Measure</div><div>Patient</div><div>Last Value</div><div>Last Measured</div><div style={{ textAlign: "right" }}>Overdue</div>
          </div>
          {gaps.slice(0, 100).map((g) => (
            <div key={`${g.panel}-${g.patient_id}`} style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1.4fr 1fr 1fr 0.8fr", gap: 12, padding: "8px 12px", fontSize: 12, alignItems: "center", borderBottom: `0.5px solid ${C.borderLight}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 8, height: 8, borderRadius: "50%", background: g.panelColor || C.tealMid }} /><span style={{ color: C.textSecondary }}>{g.panel}</span></div>
              <div style={{ color: C.textSecondary }}>{g.measure}</div>
              <div><div style={{ fontWeight: 600, color: C.textPrimary }}>{g.name}</div><div style={{ fontSize: 10, color: C.textTertiary }}>{g.mrn || "—"}</div></div>
              <div style={{ color: C.textSecondary }}>{g.last_value ?? "—"}</div>
              <div style={{ color: C.textSecondary }}>{fmtDate(g.last_at)}</div>
              <div style={{ textAlign: "right" }}><Badge label={g.days_since == null ? "Never" : `${g.days_since}d`} variant={g.days_since == null || g.days_since > g.window_days * 2 ? "red" : "amber"} size="xs" /></div>
            </div>
          ))}
          {gaps.length > 100 && <div style={{ padding: 12, textAlign: "center", fontSize: 11, color: C.textTertiary }}>Showing top 100 of {gaps.length}. Export CSV for the full list.</div>}
        </>
      )}
    </Card>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Tab 4: Copay collection rate
// ═════════════════════════════════════════════════════════════════════════════
function CopayTab({ appointments, rangeDays }) {
  const withExpected = appointments.filter((a) => Number(a.copay_amount) > 0 && a.status !== "Cancelled" && a.status !== "No Show");
  const expected = withExpected.reduce((s, a) => s + Number(a.copay_amount || 0), 0);
  const collected = withExpected.filter((a) => a.copay_collected).reduce((s, a) => s + Number(a.copay_amount || 0), 0);
  const collectedCount = withExpected.filter((a) => a.copay_collected).length;
  const rate = expected ? collected / expected : 0;

  // Split the window in half to show a simple trend
  const mid = daysAgo(Math.floor(rangeDays / 2));
  const first = withExpected.filter((a) => a.appt_date < mid);
  const second = withExpected.filter((a) => a.appt_date >= mid);
  const firstRate = first.reduce((s, a) => s + Number(a.copay_amount || 0), 0) === 0 ? 0 : first.filter((a) => a.copay_collected).reduce((s, a) => s + Number(a.copay_amount || 0), 0) / first.reduce((s, a) => s + Number(a.copay_amount || 0), 0);
  const secondRate = second.reduce((s, a) => s + Number(a.copay_amount || 0), 0) === 0 ? 0 : second.filter((a) => a.copay_collected).reduce((s, a) => s + Number(a.copay_amount || 0), 0) / second.reduce((s, a) => s + Number(a.copay_amount || 0), 0);
  const delta = secondRate - firstRate;

  const exportRows = () => exportCSV(
    `copay_${rangeDays}d_${new Date().toISOString().slice(0,10)}.csv`,
    withExpected.map((a) => ({ appt_date: a.appt_date, status: a.status, copay_amount: a.copay_amount, copay_collected: a.copay_collected ? "Yes" : "No" }))
  );

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        <Card><div style={{ fontSize: 11, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>Collection Rate</div><div style={{ fontSize: 24, fontWeight: 800, color: rate >= 0.85 ? C.green : rate >= 0.70 ? C.amber : C.red }}>{Math.round(rate * 100)}%</div><div style={{ fontSize: 11, color: C.textTertiary }}>of expected copays</div></Card>
        <Card><div style={{ fontSize: 11, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>Expected</div><div style={{ fontSize: 24, fontWeight: 800, color: C.textPrimary }}>${expected.toFixed(0)}</div><div style={{ fontSize: 11, color: C.textTertiary }}>{withExpected.length} appts</div></Card>
        <Card><div style={{ fontSize: 11, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>Collected</div><div style={{ fontSize: 24, fontWeight: 800, color: C.green }}>${collected.toFixed(0)}</div><div style={{ fontSize: 11, color: C.textTertiary }}>{collectedCount} collected</div></Card>
        <Card><div style={{ fontSize: 11, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>Trend (H1 → H2)</div><div style={{ fontSize: 24, fontWeight: 800, color: delta >= 0 ? C.green : C.red }}>{delta >= 0 ? "+" : ""}{Math.round(delta * 100)}%</div><div style={{ fontSize: 11, color: C.textTertiary }}>{Math.round(firstRate * 100)}% → {Math.round(secondRate * 100)}%</div></Card>
      </div>

      <Card>
        <SectionHead title="Copay Detail" sub={`All appointments with expected copays in ${rangeDays}-day window`} action={<Btn size="sm" variant="outline" onClick={exportRows}>Export CSV</Btn>} />
        <div style={{ fontSize: 12, color: C.textTertiary, padding: 12 }}>
          {withExpected.length === 0 ? "No copays expected in this window." : `${withExpected.length} appointments · ${collectedCount} collected · ${withExpected.length - collectedCount} outstanding. Export CSV for appointment-level detail.`}
        </div>
      </Card>
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Tab 5: Screeners — activity + positive rate by screener type
// ═════════════════════════════════════════════════════════════════════════════
function ScreenersTab({ screeners, patients, rangeDays }) {
  const types = Array.from(new Set(screeners.map((s) => s.screener_type))).sort();
  const totalUnique = new Set(screeners.map((s) => s.patient_id)).size;

  const rows = types.map((type) => {
    const list = screeners.filter((s) => s.screener_type === type);
    const positive = list.filter((s) => s.positive === true).length;
    return { type, total: list.length, positive, rate: list.length ? positive / list.length : 0, unique: new Set(list.map((s) => s.patient_id)).size };
  });

  const exportRows = () => exportCSV(
    `screeners_${rangeDays}d_${new Date().toISOString().slice(0,10)}.csv`,
    rows.map((r) => ({ screener: r.type, completed: r.total, unique_patients: r.unique, positive: r.positive, positive_pct: Math.round(r.rate * 100) }))
  );

  if (rows.length === 0) {
    return <EmptyState icon="📝" title="No screeners completed" sub={`No screener responses recorded in the last ${rangeDays} days.`} />;
  }

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        <Card><div style={{ fontSize: 11, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>Total Screenings</div><div style={{ fontSize: 24, fontWeight: 800, color: C.textPrimary }}>{screeners.length}</div></Card>
        <Card><div style={{ fontSize: 11, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>Unique Patients</div><div style={{ fontSize: 24, fontWeight: 800, color: C.textPrimary }}>{totalUnique}</div></Card>
        <Card><div style={{ fontSize: 11, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>Screener Types Used</div><div style={{ fontSize: 24, fontWeight: 800, color: C.textPrimary }}>{rows.length}</div></Card>
        <Card><div style={{ fontSize: 11, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>Overall Positive Rate</div><div style={{ fontSize: 24, fontWeight: 800, color: C.amber }}>{Math.round((rows.reduce((s, r) => s + r.positive, 0) / (screeners.length || 1)) * 100)}%</div></Card>
      </div>

      <Card>
        <SectionHead title="Screener Activity" sub="Completion and positive rates by instrument" action={<Btn size="sm" variant="outline" onClick={exportRows}>Export CSV</Btn>} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 12, padding: "8px 12px", fontSize: 10, fontWeight: 700, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: `0.5px solid ${C.borderLight}` }}>
          <div>Screener</div><div style={{ textAlign: "right" }}>Completed</div><div style={{ textAlign: "right" }}>Unique Patients</div><div style={{ textAlign: "right" }}>Positive</div><div style={{ textAlign: "right" }}>Positive Rate</div>
        </div>
        {rows.map((r) => (
          <div key={r.type} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 12, padding: "10px 12px", fontSize: 12, alignItems: "center", borderBottom: `0.5px solid ${C.borderLight}` }}>
            <div style={{ fontWeight: 600, color: C.textPrimary }}>{r.type}</div>
            <div style={{ textAlign: "right", color: C.textSecondary }}>{r.total}</div>
            <div style={{ textAlign: "right", color: C.textSecondary }}>{r.unique}</div>
            <div style={{ textAlign: "right", color: C.textSecondary }}>{r.positive}</div>
            <div style={{ textAlign: "right" }}><Badge label={`${Math.round(r.rate * 100)}%`} variant={r.rate > 0.4 ? "red" : r.rate > 0.2 ? "amber" : "green"} size="xs" /></div>
          </div>
        ))}
      </Card>
    </>
  );
}
