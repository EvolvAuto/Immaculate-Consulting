// ═══════════════════════════════════════════════════════════════════════════════
// AutomationsView - staff visibility into PracticeOS Lite automation runs.
// Reads automation_runs and automation_settings. Groups runs by workflow,
// shows 48h health stats, surfaces recent errors, allows manual re-runs.
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../auth/AuthProvider";
import { C } from "../lib/tokens";
import { Badge, Btn, Card, Modal, TopBar, TabBar, Loader, ErrorBanner, EmptyState } from "../components/ui";

// Workflow catalog - human-friendly labels and invocation details for each.
// Keys match automation_runs.workflow_name.
const WORKFLOWS = [
  { key: "portal_invite_delivery",   label: "Portal Invites",         desc: "Emails activation links to newly invited patients.",              fn: "run-notifications",        body: { workflow: "portal_invite_delivery" } },
  { key: "lab_released_notify",      label: "Lab Result Alerts",      desc: "Notifies patients when new lab results are released to portal.",  fn: "run-notifications",        body: { workflow: "lab_released_notify" } },
  { key: "refill_ack",               label: "Refill Acknowledgments", desc: "Emails patients when their refill request is received.",          fn: "run-notifications",        body: { workflow: "refill_ack" } },
  { key: "form_submission_notify",   label: "Intake Form Alerts",     desc: "Alerts front desk when patients complete pre-visit forms.",       fn: "run-notifications",        body: { workflow: "form_submission_notify" } },
  { key: "insurance_update_notify",  label: "Insurance Updates",      desc: "Alerts billing when patients submit insurance changes.",          fn: "run-notifications",        body: { workflow: "insurance_update_notify" } },
  { key: "message_alert",            label: "Portal Message Alerts",  desc: "Alerts practice inbox when a patient sends a portal message.",    fn: "run-notifications",        body: { workflow: "message_alert" } },
  { key: "appointment_reminder_24h", label: "24h SMS Reminders",      desc: "Sends SMS reminders the evening before appointments.",            fn: "run-appointment-reminders",body: { window: "24h" } },
  { key: "appointment_reminder_2h",  label: "2h SMS Reminders",       desc: "Sends SMS reminders about 2 hours before appointments.",          fn: "run-appointment-reminders",body: { window: "2h" } },
  { key: "no_show_followup",         label: "No-Show Follow-Up",      desc: "Creates staff task (+ optional SMS) for each no-show appointment.",fn: "run-no-show-followup",     body: {} },
  { key: "balance_reminder_weekly",  label: "Balance Reminders",      desc: "Weekly reminder to patients with outstanding balances (deferred).",fn: "run-notifications",        body: { workflow: "balance_reminder_weekly" } },
];

// Window presets for the top TabBar filter.
const WINDOWS = [["24h", "Last 24h"], ["48h", "Last 48h"], ["7d", "Last 7 days"]];
const WINDOW_TO_HOURS = { "24h": 24, "48h": 48, "7d": 168 };

export default function AutomationsView() {
  const { practiceId } = useAuth();
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [runs, setRuns]           = useState([]);
  const [settings, setSettings]   = useState({});
  const [windowKey, setWindowKey] = useState("48h");
  const [tab, setTab]             = useState("all");
  const [detailRun, setDetailRun] = useState(null);
  const [running, setRunning]     = useState({}); // { [workflowKey]: true } while manual invoke in flight

  const load = async () => {
    try {
      setLoading(true);
      const since = new Date(Date.now() - WINDOW_TO_HOURS[windowKey] * 3600 * 1000).toISOString();
      const [r, s] = await Promise.all([
        supabase.from("automation_runs")
          .select("*")
          .gte("started_at", since)
          .order("started_at", { ascending: false })
          .limit(500),
        supabase.from("automation_settings").select("key, value"),
      ]);
      if (r.error) throw r.error;
      if (s.error) throw s.error;
      setRuns(r.data || []);
      const sMap = {};
      (s.data || []).forEach((row) => { sMap[row.key] = row.value; });
      setSettings(sMap);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (practiceId) load(); }, [practiceId, windowKey]);

  // Aggregate runs by workflow for the summary cards.
  const summary = useMemo(() => {
    const byWf = {};
    WORKFLOWS.forEach((w) => {
      byWf[w.key] = { total: 0, success: 0, partial: 0, failed: 0, processed: 0, lastRun: null, lastError: null, lastStatus: null };
    });
    runs.forEach((r) => {
      const w = byWf[r.workflow_name];
      if (!w) return;
      w.total++;
      if (r.status === "success") w.success++;
      else if (r.status === "partial") w.partial++;
      else if (r.status === "failed") w.failed++;
      w.processed += r.rows_processed || 0;
      if (!w.lastRun || new Date(r.started_at) > new Date(w.lastRun)) {
        w.lastRun = r.started_at;
        w.lastStatus = r.status;
        w.lastError = r.last_error;
      }
    });
    return byWf;
  }, [runs]);

  const filteredWorkflows = WORKFLOWS.filter((w) => {
    if (tab === "all") return true;
    if (tab === "failing") return summary[w.key].failed > 0;
    if (tab === "healthy") return summary[w.key].failed === 0 && summary[w.key].total > 0;
    if (tab === "idle") return summary[w.key].total === 0;
    return true;
  });

  const runNow = async (wf) => {
    try {
      setRunning((p) => ({ ...p, [wf.key]: true }));
      const { data, error } = await supabase.functions.invoke(wf.fn, {
        body: { ...wf.body, triggered_by: "manual" },
      });
      if (error) throw error;
      // small delay then reload so the new row is visible
      setTimeout(() => { load(); setRunning((p) => ({ ...p, [wf.key]: false })); }, 1500);
    } catch (e) {
      setError(`Manual run of ${wf.label} failed: ${e.message}`);
      setRunning((p) => ({ ...p, [wf.key]: false }));
    }
  };

  // Surface config gaps prominently - e.g. missing emails or Twilio number.
  const configWarnings = [];
  if (!settings.practice_inbox_email) configWarnings.push("practice_inbox_email");
  if (!settings.front_desk_email)     configWarnings.push("front_desk_email");
  if (!settings.billing_email)        configWarnings.push("billing_email");
  if (!settings.twilio_from_number)   configWarnings.push("twilio_from_number (SMS workflows will fail until set)");

  if (loading) return <div style={{ flex: 1 }}><TopBar title="Automations" /><Loader /></div>;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar
        title="Automations"
        sub={`${runs.length} runs in ${windowKey}`}
        actions={<>
          <TabBar tabs={WINDOWS} active={windowKey} onChange={setWindowKey} />
          <Btn size="sm" variant="outline" onClick={load}>↻ Refresh</Btn>
        </>} />

      <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
        {error && <ErrorBanner message={error} />}

        {configWarnings.length > 0 && (
          <Card style={{ padding: 12, marginBottom: 16, background: C.amberBg, border: `1px solid ${C.amberBorder}`, maxWidth: 1100, margin: "0 auto 16px" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.amberText, marginBottom: 4 }}>⚠ Config gaps in automation_settings</div>
            <div style={{ fontSize: 12, color: C.textSecondary }}>
              {configWarnings.join(", ")}.
              {" "}Update in Supabase SQL Editor or the Settings view to activate affected workflows.
            </div>
          </Card>
        )}

        <TabBar
          tabs={[
            ["all",      `All (${WORKFLOWS.length})`],
            ["failing",  `Failing (${WORKFLOWS.filter((w) => summary[w.key].failed > 0).length})`],
            ["healthy",  `Healthy (${WORKFLOWS.filter((w) => summary[w.key].failed === 0 && summary[w.key].total > 0).length})`],
            ["idle",     `Idle (${WORKFLOWS.filter((w) => summary[w.key].total === 0).length})`],
          ]}
          active={tab} onChange={setTab} />

        {filteredWorkflows.length === 0
          ? <EmptyState icon="⚡" title="No workflows match" sub="Try a different filter." />
          : <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 1100, margin: "12px auto 0" }}>
              {filteredWorkflows.map((wf) => (
                <WorkflowCard
                  key={wf.key}
                  wf={wf}
                  stats={summary[wf.key]}
                  runs={runs.filter((r) => r.workflow_name === wf.key)}
                  running={!!running[wf.key]}
                  onRun={() => runNow(wf)}
                  onSelectRun={setDetailRun}
                />
              ))}
            </div>}
      </div>

      {detailRun && <RunDetailModal run={detailRun} onClose={() => setDetailRun(null)} />}
    </div>
  );
}

// ─── Workflow summary card ─────────────────────────────────────────────────────
function WorkflowCard({ wf, stats, runs, running, onRun, onSelectRun }) {
  const [expanded, setExpanded] = useState(false);
  const successRate = stats.total > 0 ? Math.round((stats.success / stats.total) * 100) : null;

  const statusVariant = stats.lastStatus === "success" ? "green"
    : stats.lastStatus === "partial" ? "amber"
    : stats.lastStatus === "failed"  ? "red"
    : "neutral";

  const statusLabel = stats.total === 0 ? "No runs yet"
    : stats.lastStatus === "success" ? "Healthy"
    : stats.lastStatus === "partial" ? "Partial"
    : "Failing";

  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      {/* Header row - always visible */}
      <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 14, cursor: "pointer" }}
           onClick={() => setExpanded((v) => !v)}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary }}>{wf.label}</span>
            <Badge label={statusLabel} variant={statusVariant} size="xs" />
            {successRate != null && <span style={{ fontSize: 11, color: C.textTertiary }}>{successRate}% success</span>}
          </div>
          <div style={{ fontSize: 12, color: C.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{wf.desc}</div>
        </div>

        <div style={{ display: "flex", gap: 16, alignItems: "center", fontSize: 11, color: C.textTertiary, flexShrink: 0 }}>
          <Stat label="Runs" value={stats.total} />
          <Stat label="Processed" value={stats.processed} />
          {stats.failed > 0 && <Stat label="Failed" value={stats.failed} color={C.red} />}
        </div>

        <Btn size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onRun(); }} disabled={running}>
          {running ? "Running..." : "Run now"}
        </Btn>
        <span style={{ fontSize: 12, color: C.textTertiary, width: 16, textAlign: "center" }}>{expanded ? "▾" : "▸"}</span>
      </div>

      {/* Expanded: last error banner + run history */}
      {expanded && (
        <div style={{ borderTop: `0.5px solid ${C.borderLight}`, padding: 14, background: C.bgSecondary }}>
          {stats.lastError && (
            <div style={{ fontSize: 11, color: C.red, marginBottom: 10, padding: "6px 10px", background: C.redBg, borderRadius: 4 }}>
              <b>Last error:</b> {stats.lastError}
            </div>
          )}
          {runs.length === 0
            ? <div style={{ fontSize: 12, color: C.textTertiary, textAlign: "center", padding: 20 }}>No runs in this window yet.</div>
            : <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "grid", gridTemplateColumns: "90px 70px 70px 90px 70px 1fr", fontSize: 10, color: C.textTertiary, padding: "4px 8px", textTransform: "uppercase", letterSpacing: 0.5 }}>
                  <span>Started</span><span>Trigger</span><span>Status</span><span>Rows OK / fail</span><span>Duration</span><span>Error</span>
                </div>
                {runs.slice(0, 20).map((r) => (
                  <div key={r.id} onClick={() => onSelectRun(r)}
                       style={{ display: "grid", gridTemplateColumns: "90px 70px 70px 90px 70px 1fr", fontSize: 11, padding: "6px 8px", background: C.bgPrimary, borderRadius: 4, cursor: "pointer", alignItems: "center" }}
                       onMouseEnter={(e) => e.currentTarget.style.background = C.bgTertiary}
                       onMouseLeave={(e) => e.currentTarget.style.background = C.bgPrimary}>
                    <span style={{ color: C.textSecondary }}>{fmtTime(r.started_at)}</span>
                    <Badge label={r.triggered_by} variant="neutral" size="xs" />
                    <Badge label={r.status} variant={r.status === "success" ? "green" : r.status === "partial" ? "amber" : "red"} size="xs" />
                    <span style={{ color: C.textSecondary }}>{r.rows_succeeded || 0} / {r.rows_failed || 0}</span>
                    <span style={{ color: C.textTertiary }}>{r.duration_ms != null ? `${r.duration_ms}ms` : "-"}</span>
                    <span style={{ color: r.last_error ? C.red : C.textTertiary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.last_error || "-"}
                    </span>
                  </div>
                ))}
              </div>}
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={{ textAlign: "center", minWidth: 40 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: color || C.textPrimary }}>{value}</div>
      <div style={{ fontSize: 10, color: C.textTertiary, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
    </div>
  );
}

function RunDetailModal({ run, onClose }) {
  return (
    <Modal title={`Run: ${run.workflow_name}`} onClose={onClose} maxWidth={600}>
      <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 8, fontSize: 13 }}>
        <Field label="Started">{fmtDateTime(run.started_at)}</Field>
        <Field label="Triggered by">{run.triggered_by}</Field>
        <Field label="Status">
          <Badge label={run.status} variant={run.status === "success" ? "green" : run.status === "partial" ? "amber" : "red"} size="xs" />
        </Field>
        <Field label="Duration">{run.duration_ms != null ? `${run.duration_ms}ms` : "-"}</Field>
        <Field label="Rows processed">{run.rows_processed ?? 0}</Field>
        <Field label="Rows succeeded">{run.rows_succeeded ?? 0}</Field>
        <Field label="Rows failed" color={run.rows_failed > 0 ? C.red : undefined}>{run.rows_failed ?? 0}</Field>
        {run.last_error && <Field label="Last error" color={C.red}>{run.last_error}</Field>}
        {run.details && Object.keys(run.details).length > 0 && (
          <Field label="Details">
            <pre style={{ fontSize: 11, background: C.bgSecondary, padding: 8, borderRadius: 4, overflow: "auto", maxHeight: 200, margin: 0 }}>
              {JSON.stringify(run.details, null, 2)}
            </pre>
          </Field>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
        <Btn onClick={onClose}>Close</Btn>
      </div>
    </Modal>
  );
}

function Field({ label, children, color }) {
  return <>
    <span style={{ color: C.textTertiary, fontSize: 12 }}>{label}</span>
    <span style={{ color: color || C.textPrimary }}>{children}</span>
  </>;
}

// ─── helpers ───────────────────────────────────────────────────────────────────
function fmtTime(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}
function fmtDateTime(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleString();
}
