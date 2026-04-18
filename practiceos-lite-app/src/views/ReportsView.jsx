// ═══════════════════════════════════════════════════════════════════════════════
// ReportsView — aggregated read-only metrics across appts, providers, payers
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../auth/AuthProvider";
import { C } from "../lib/tokens";
import { toISODate } from "../components/constants";
import { Badge, Btn, Card, TopBar, StatCard, SectionHead, Select, Loader, ErrorBanner, EmptyState } from "../components/ui";

const RANGES = [
  { value: "7",  label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "365", label: "Last 12 months" },
];

export default function ReportsView() {
  const { practiceId } = useAuth();
  const [range, setRange] = useState("30");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [appts, setAppts] = useState([]);
  const [providers, setProviders] = useState([]);
  const [insurances, setInsurances] = useState([]);
  const [encounters, setEncounters] = useState([]);

  useEffect(() => {
    if (!practiceId) return;
    (async () => {
      try {
        setLoading(true);
        const start = new Date(); start.setDate(start.getDate() - parseInt(range));
        const startStr = toISODate(start);
        const [a, p, i, e] = await Promise.all([
          supabase.from("appointments")
            .select("id, appt_date, appt_type, status, copay_amount, copay_collected, provider_id")
            .gte("appt_date", startStr),
          supabase.from("providers").select("id, first_name, last_name, color").eq("is_active", true),
          supabase.from("insurance_policies").select("payer_category, payer_name").eq("is_active", true),
          supabase.from("encounters").select("id, encounter_date, status").gte("encounter_date", startStr),
        ]);
        if (a.error) throw a.error;
        setAppts(a.data || []);
        setProviders(p.data || []);
        setInsurances(i.data || []);
        setEncounters(e.data || []);
      } catch (err) { setError(err.message); }
      finally { setLoading(false); }
    })();
  }, [practiceId, range]);

  const stats = useMemo(() => {
    const total = appts.length;
    const completed = appts.filter((a) => a.status === "Completed").length;
    const noShows = appts.filter((a) => a.status === "No Show").length;
    const cancelled = appts.filter((a) => a.status === "Cancelled").length;
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
    const noShowRate = total > 0 ? Math.round((noShows / total) * 100) : 0;
    const cancelRate = total > 0 ? Math.round((cancelled / total) * 100) : 0;
    const copayExpected = appts.reduce((s, a) => s + Number(a.copay_amount || 0), 0);
    const copayCollected = appts.filter((a) => a.copay_collected).reduce((s, a) => s + Number(a.copay_amount || 0), 0);
    const collectionRate = copayExpected > 0 ? Math.round((copayCollected / copayExpected) * 100) : 100;

    const byType = {};
    appts.forEach((a) => { byType[a.appt_type] = (byType[a.appt_type] || 0) + 1; });

    const byProvider = {};
    appts.forEach((a) => {
      if (!byProvider[a.provider_id]) byProvider[a.provider_id] = { total: 0, completed: 0, noShow: 0 };
      byProvider[a.provider_id].total++;
      if (a.status === "Completed") byProvider[a.provider_id].completed++;
      if (a.status === "No Show") byProvider[a.provider_id].noShow++;
    });

    const byPayer = {};
    insurances.forEach((ins) => {
      byPayer[ins.payer_category] = (byPayer[ins.payer_category] || 0) + 1;
    });

    const encDraft = encounters.filter((e) => e.status === "Draft" || e.status === "In Progress").length;
    const encSigned = encounters.filter((e) => e.status === "Signed" || e.status === "Amended").length;
    const sigRate = encounters.length > 0 ? Math.round((encSigned / encounters.length) * 100) : 0;

    return { total, completed, noShows, cancelled, completionRate, noShowRate, cancelRate, copayExpected, copayCollected, collectionRate, byType, byProvider, byPayer, encDraft, encSigned, sigRate };
  }, [appts, insurances, encounters]);

  if (loading) return <div style={{ flex: 1 }}><TopBar title="Reports" /><Loader /></div>;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar title="Reports" sub={RANGES.find((r) => r.value === range)?.label}
        actions={
          <select value={range} onChange={(e) => setRange(e.target.value)}
            style={{ padding: "6px 10px", border: `0.5px solid ${C.borderMid}`, borderRadius: 6, fontSize: 12, fontFamily: "inherit" }}>
            {RANGES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        } />

      <div style={{ flex: 1, overflowY: "auto", padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
        {error && <ErrorBanner message={error} />}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          <StatCard label="Appointments" value={stats.total} sub={`${stats.completed} completed`} color={C.teal} />
          <StatCard label="Completion Rate" value={`${stats.completionRate}%`} sub={`${stats.completed} / ${stats.total}`} color={C.green} />
          <StatCard label="No-Show Rate" value={`${stats.noShowRate}%`} sub={`${stats.noShows} no-shows`} color={stats.noShowRate > 12 ? C.red : C.amber} />
          <StatCard label="Cancellation Rate" value={`${stats.cancelRate}%`} sub={`${stats.cancelled} cancelled`} color={C.textSecondary} />
          <StatCard label="Copay Collection" value={`${stats.collectionRate}%`} sub={`$${stats.copayCollected.toFixed(0)} / $${stats.copayExpected.toFixed(0)}`} color={stats.collectionRate < 85 ? C.amber : C.green} />
          <StatCard label="Notes Signed" value={`${stats.sigRate}%`} sub={`${stats.encDraft} drafts open`} color={stats.encDraft > 5 ? C.amber : C.teal} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Card>
            <SectionHead title="Volume by Appointment Type" />
            {Object.keys(stats.byType).length === 0 ? <EmptyState title="No data" />
              : Object.entries(stats.byType).sort((a, b) => b[1] - a[1]).map(([type, count]) => {
                const pct = Math.round((count / stats.total) * 100);
                return (
                  <div key={type} style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                      <span>{type}</span>
                      <span style={{ color: C.textSecondary }}>{count} <span style={{ color: C.textTertiary }}>({pct}%)</span></span>
                    </div>
                    <div style={{ height: 6, background: C.bgSecondary, borderRadius: 3 }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: C.teal, borderRadius: 3 }} />
                    </div>
                  </div>
                );
              })}
          </Card>

          <Card>
            <SectionHead title="Payer Mix" sub={`${insurances.length} active policies`} />
            {Object.keys(stats.byPayer).length === 0 ? <EmptyState title="No policies on file" />
              : Object.entries(stats.byPayer).sort((a, b) => b[1] - a[1]).map(([cat, count]) => {
                const pct = Math.round((count / insurances.length) * 100);
                const colors = { "NC Medicaid - Standard": C.teal, "NC Medicaid - Tailored": C.purple, "NC Medicaid - Other": C.blue, "Medicare": C.amber, "Commercial": C.green, "Other": C.textSecondary };
                return (
                  <div key={cat} style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                      <span>{cat}</span>
                      <span style={{ color: C.textSecondary }}>{count} <span style={{ color: C.textTertiary }}>({pct}%)</span></span>
                    </div>
                    <div style={{ height: 6, background: C.bgSecondary, borderRadius: 3 }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: colors[cat] || C.textTertiary, borderRadius: 3 }} />
                    </div>
                  </div>
                );
              })}
          </Card>
        </div>

        <Card>
          <SectionHead title="Provider Productivity" />
          {providers.length === 0 ? <EmptyState title="No providers" />
            : <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr", padding: "8px 0", fontSize: 10, fontWeight: 700, color: C.textSecondary, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: `0.5px solid ${C.borderLight}` }}>
              <div>Provider</div><div>Total</div><div>Completed</div><div>No-Show</div><div>Rate</div>
            </div>}
          {providers.map((p) => {
            const s = stats.byProvider[p.id] || { total: 0, completed: 0, noShow: 0 };
            const rate = s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0;
            return (
              <div key={p.id} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr", padding: "10px 0", fontSize: 12, borderBottom: `0.5px solid ${C.borderLight}`, alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: p.color }} />
                  <span>Dr. {p.first_name} {p.last_name}</span>
                </div>
                <div>{s.total}</div>
                <div style={{ color: C.green }}>{s.completed}</div>
                <div style={{ color: s.noShow > 3 ? C.red : C.textSecondary }}>{s.noShow}</div>
                <div style={{ fontWeight: 700, color: rate >= 85 ? C.green : rate >= 70 ? C.amber : C.red }}>{rate}%</div>
              </div>
            );
          })}
        </Card>

        <div style={{ fontSize: 11, color: C.textTertiary, textAlign: "center", padding: 12 }}>
          All reports respect practice-level RLS. Exports require explicit audit logging — use the Compliance tab for export audit trail.
        </div>
      </div>
    </div>
  );
}
