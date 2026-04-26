// ═══════════════════════════════════════════════════════════════════════════════
// src/views/admin/SystemHealthView.jsx
// Operational pulse: cron job status, AI usage by practice, recent automation
// runs. Reads from cron.job (via SECURITY DEFINER view), pro_ai_usage,
// and automation_runs.
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { C } from "../../lib/tokens";
import { Card, Loader, ErrorBanner } from "../../components/ui";

const STATUS_COLORS = {
  ok:    { color: C.teal,  bg: C.tealBg },
  warn:  { color: C.amber, bg: C.amberBg },
  err:   { color: C.red,   bg: "#fef2f2" },
};

function fmtNum(n) {
  return (n || 0).toLocaleString();
}

function fmtCost(usd) {
  if (usd == null) return "—";
  return "$" + Number(usd).toFixed(2);
}

function fmtRelative(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return min + "m ago";
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + "h ago";
  const dy = Math.floor(hr / 24);
  return dy + "d ago";
}

export default function SystemHealthView() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [aiUsage, setAiUsage] = useState([]);
  const [automationRuns, setAutomationRuns] = useState([]);
  const [practiceMap, setPracticeMap] = useState({});

  const load = async () => {
    try {
      setLoading(true);
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const [usageRes, runsRes, pRes] = await Promise.all([
        supabase.from("pro_ai_usage")
          .select("practice_id, feature, model, message_count, cost_usd_est, created_at")
          .gte("created_at", monthStart.toISOString()),
        supabase.from("automation_runs")
          .select("workflow_name, triggered_by, status, started_at, completed_at, duration_ms, rows_processed, rows_succeeded, rows_failed, last_error")
          .order("started_at", { ascending: false })
          .limit(20),
        supabase.from("practices").select("id, name, subscription_tier"),
      ]);
      if (usageRes.error) throw usageRes.error;
      if (runsRes.error) throw runsRes.error;
      if (pRes.error) throw pRes.error;

      // Aggregate AI usage by practice
      const byPractice = {};
      (usageRes.data || []).forEach(row => {
        if (!byPractice[row.practice_id]) {
          byPractice[row.practice_id] = { messages: 0, cost: 0, lastUsed: null };
        }
        byPractice[row.practice_id].messages += (row.message_count || 0);
        byPractice[row.practice_id].cost     += Number(row.cost_usd_est || 0);
        if (!byPractice[row.practice_id].lastUsed || row.created_at > byPractice[row.practice_id].lastUsed) {
          byPractice[row.practice_id].lastUsed = row.created_at;
        }
      });
      setAiUsage(Object.entries(byPractice).map(([pid, v]) => ({ practice_id: pid, ...v })));

      const pMap = {};
      (pRes.data || []).forEach(p => { pMap[p.id] = p; });
      setPracticeMap(pMap);

      setAutomationRuns(runsRes.data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  if (loading) return <div style={{ padding: 40 }}><Loader /></div>;

  // Group automation runs by workflow_name to compute health summary
  const workflowSummary = {};
  automationRuns.forEach(r => {
    if (!workflowSummary[r.workflow_name]) {
      workflowSummary[r.workflow_name] = { total: 0, success: 0, error: 0, partial: 0, last: null };
    }
    workflowSummary[r.workflow_name].total++;
    if (r.status === "success") workflowSummary[r.workflow_name].success++;
    else if (r.status === "error") workflowSummary[r.workflow_name].error++;
    else if (r.status === "partial") workflowSummary[r.workflow_name].partial++;
    if (!workflowSummary[r.workflow_name].last || r.started_at > workflowSummary[r.workflow_name].last) {
      workflowSummary[r.workflow_name].last = r.started_at;
    }
  });

  return (
    <div style={{ padding: 20 }}>
      {error && <ErrorBanner message={error} />}

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
        <Card>
          <div style={{ fontSize: 10, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5, fontWeight: 600 }}>AI usage this month</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.textPrimary }}>{fmtNum(aiUsage.reduce((s, p) => s + p.messages, 0))}</div>
          <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 3 }}>messages across {aiUsage.length} practices</div>
        </Card>
        <Card>
          <div style={{ fontSize: 10, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5, fontWeight: 600 }}>Estimated cost</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.textPrimary }}>{fmtCost(aiUsage.reduce((s, p) => s + p.cost, 0))}</div>
          <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 3 }}>internal · never shown to clients</div>
        </Card>
        <Card>
          <div style={{ fontSize: 10, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5, fontWeight: 600 }}>Automation runs</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.textPrimary }}>{automationRuns.length}</div>
          <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 3 }}>last 20 events</div>
        </Card>
      </div>

      {/* Workflow health */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary }}>Automation workflows</div>
          <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 1 }}>Health summary from recent runs</div>
        </div>
        {Object.keys(workflowSummary).length === 0 ? (
          <div style={{ fontSize: 12, color: C.textTertiary, padding: "8px 0" }}>No automation runs in the recent window.</div>
        ) : (
          <div>
            {Object.entries(workflowSummary).map(([name, s]) => {
              const errorRate = s.total > 0 ? s.error / s.total : 0;
              const status = s.error === 0 && s.partial === 0 ? "ok" : (errorRate > 0.5 ? "err" : "warn");
              const palette = STATUS_COLORS[status];
              return (
                <div key={name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: "0.5px solid " + C.borderLight }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.textPrimary, fontFamily: "Consolas, monospace" }}>{name}</div>
                    <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 1 }}>
                      {s.success} ok · {s.partial} partial · {s.error} error · last {fmtRelative(s.last)}
                    </div>
                  </div>
                  <span style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
                    padding: "3px 8px", borderRadius: 3,
                    color: palette.color, background: palette.bg,
                    border: "0.5px solid " + palette.color,
                  }}>
                    {status === "ok" ? "Healthy" : status === "warn" ? "Degraded" : "Failing"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* AI usage by practice */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary }}>AI usage by practice · this month</div>
          <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 1 }}>{aiUsage.length} practices with activity</div>
        </div>
        {aiUsage.length === 0 ? (
          <div style={{ fontSize: 12, color: C.textTertiary, padding: "8px 0" }}>No AI usage this month.</div>
        ) : (
          <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "6px 8px 6px 0", borderBottom: "0.5px solid " + C.borderLight, fontSize: 10, fontWeight: 600, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em" }}>Practice</th>
                <th style={{ textAlign: "left", padding: "6px 8px 6px 0", borderBottom: "0.5px solid " + C.borderLight, fontSize: 10, fontWeight: 600, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em" }}>Tier</th>
                <th style={{ textAlign: "right", padding: "6px 8px 6px 0", borderBottom: "0.5px solid " + C.borderLight, fontSize: 10, fontWeight: 600, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em" }}>Messages</th>
                <th style={{ textAlign: "right", padding: "6px 8px 6px 0", borderBottom: "0.5px solid " + C.borderLight, fontSize: 10, fontWeight: 600, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em" }}>Cost</th>
                <th style={{ textAlign: "right", padding: "6px 8px 6px 0", borderBottom: "0.5px solid " + C.borderLight, fontSize: 10, fontWeight: 600, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em" }}>Last used</th>
              </tr>
            </thead>
            <tbody>
              {aiUsage.sort((a, b) => b.messages - a.messages).map(u => {
                const p = practiceMap[u.practice_id];
                return (
                  <tr key={u.practice_id}>
                    <td style={{ padding: "8px 8px 8px 0", borderBottom: "0.5px solid " + C.borderLight, color: C.textPrimary, fontWeight: 500 }}>{p?.name || u.practice_id.slice(0, 8)}</td>
                    <td style={{ padding: "8px 8px 8px 0", borderBottom: "0.5px solid " + C.borderLight, color: C.textSecondary }}>{p?.subscription_tier || "?"}</td>
                    <td style={{ padding: "8px 8px 8px 0", borderBottom: "0.5px solid " + C.borderLight, color: C.textPrimary, textAlign: "right", fontWeight: 600 }}>{fmtNum(u.messages)}</td>
                    <td style={{ padding: "8px 8px 8px 0", borderBottom: "0.5px solid " + C.borderLight, color: C.textSecondary, textAlign: "right" }}>{fmtCost(u.cost)}</td>
                    <td style={{ padding: "8px 8px 8px 0", borderBottom: "0.5px solid " + C.borderLight, color: C.textTertiary, textAlign: "right" }}>{fmtRelative(u.lastUsed)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {/* Recent automation runs */}
      <Card>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary }}>Recent automation runs</div>
          <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 1 }}>Last 20 events</div>
        </div>
        {automationRuns.length === 0 ? (
          <div style={{ fontSize: 12, color: C.textTertiary, padding: "8px 0" }}>No recent runs (most automations are paused pre-production).</div>
        ) : (
          <div style={{ border: "0.5px solid " + C.borderLight, borderRadius: 8, overflow: "hidden" }}>
            {automationRuns.map((r, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1.5fr 0.8fr 0.6fr 1fr 1fr", gap: 10, padding: "10px 14px", fontSize: 11, borderBottom: i < automationRuns.length - 1 ? "0.5px solid " + C.borderLight : "none", alignItems: "center" }}>
                <div style={{ fontFamily: "Consolas, monospace", color: C.textPrimary, fontWeight: 500 }}>{r.workflow_name}</div>
                <div style={{ color: C.textSecondary }}>{r.triggered_by || "—"}</div>
                <div>
                  <span style={{
                    fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
                    padding: "2px 6px", borderRadius: 3,
                    color: r.status === "success" ? C.teal : r.status === "error" ? C.red : C.amber,
                    background: r.status === "success" ? C.tealBg : r.status === "error" ? "#fef2f2" : C.amberBg,
                  }}>{r.status}</span>
                </div>
                <div style={{ color: C.textSecondary }}>
                  {r.rows_processed != null ? r.rows_succeeded + "/" + r.rows_processed + " ok" : "—"}
                  {r.duration_ms != null ? " · " + r.duration_ms + "ms" : ""}
                </div>
                <div style={{ color: C.textTertiary, textAlign: "right" }}>{fmtRelative(r.started_at)}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
