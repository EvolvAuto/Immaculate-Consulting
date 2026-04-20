// ═══════════════════════════════════════════════════════════════════════════════
// DashboardView — KPI strip + today's overview across appts, queue, tasks, inbox
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { subscribeTable } from "../lib/db";
import { useAuth } from "../auth/AuthProvider";
import { C } from "../lib/tokens";
import { toISODate, slotToTime, APPT_STATUS_VARIANT, QUEUE_STATUS_VARIANT, TASK_PRIORITY_VARIANT, initialsOf } from "../components/constants";
import { Badge, Btn, Card, TopBar, StatCard, SectionHead, Avatar, ApptTypeDot, Loader, ErrorBanner, EmptyState } from "../components/ui";
import ProChartPrepCard from "../components/pro/ProChartPrepCard";

// Roles that get the Inbox widget on the Dashboard.
// Hard-coded rather than derived from NAV_BY_ROLE so this is import-safe.
const INBOX_ROLES = ["Owner", "Manager", "Provider", "Medical Assistant", "Front Desk"];

export default function DashboardView({ onNav }) {
  const { practiceId, profile, role, tier } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState({ appts: [], queue: [], tasks: [], insights: null });
  const [threads, setThreads] = useState([]);

  const hasInbox = INBOX_ROLES.indexOf(role) !== -1;

  // ─── Primary load: appts + queue + tasks + IC insight of the day ─────────
  useEffect(() => {
    if (!practiceId) return;
    const today = toISODate();
    (async () => {
      try {
        setLoading(true);
        const [a, q, t, ins] = await Promise.all([
          supabase.from("appointments")
            .select("id, patient_id, provider_id, appt_type, status, appt_date, start_slot, duration_slots, chief_complaint, copay_amount, copay_collected, patients(first_name, last_name), providers(first_name, last_name, color)")
            .eq("appt_date", today).order("start_slot"),
          supabase.from("queue_entries")
            .select("id, queue_status, chief_complaint, arrived_at, roomed_at, patients(first_name, last_name), providers(first_name, last_name), rooms(name)")
            .neq("queue_status", "Checked Out").neq("queue_status", "Left Without Being Seen"),
          supabase.from("tasks")
            .select("id, title, priority, category, status, due_date, patients(first_name, last_name)")
            .neq("status", "Completed").neq("status", "Cancelled").order("priority", { ascending: false }).limit(25),
          supabase.from("ic_insights_daily")
            .select("*").eq("snapshot_date", today).maybeSingle(),
        ]);
        if (a.error) throw a.error;
        if (q.error) throw q.error;
        if (t.error) throw t.error;
        setData({ appts: a.data || [], queue: q.data || [], tasks: t.data || [], insights: ins.data || null });
      } catch (e) { setError(e.message); }
      finally { setLoading(false); }
    })();
  }, [practiceId]);

  // ─── Inbox feed: realtime threads + messages for staff with inbox access ─
  useEffect(() => {
    if (!practiceId || !hasInbox) return;
    const loadThreads = async () => {
      const { data, error } = await supabase.from("message_threads")
        .select("id, subject, last_message_at, is_closed, patients(first_name, last_name), messages(id, body, is_read, created_at, direction)")
        .eq("is_closed", false)
        .order("last_message_at", { ascending: false })
        .limit(20);
      if (!error) setThreads(data || []);
    };
    loadThreads();
    const u1 = subscribeTable("message_threads", { practiceId, onChange: loadThreads });
    const u2 = subscribeTable("messages", { practiceId, onChange: loadThreads });
    return () => { u1(); u2(); };
  }, [practiceId, hasInbox]);

  if (loading) return <div style={{ flex: 1 }}><TopBar title="Dashboard" /><Loader /></div>;

  const todayAppts = data.appts;
  const completed = todayAppts.filter((a) => a.status === "Completed").length;
  const noShows = todayAppts.filter((a) => a.status === "No Show").length;
  const inProgress = todayAppts.filter((a) => a.status === "In Progress" || a.status === "Roomed").length;
  const activeQueue = data.queue.length;
  const urgentTasks = data.tasks.filter((t) => t.priority === "Urgent" || t.priority === "High").length;

  const copayExpected = todayAppts.reduce((sum, a) => sum + Number(a.copay_amount || 0), 0);
  const copayCollected = todayAppts.filter((a) => a.copay_collected).reduce((sum, a) => sum + Number(a.copay_amount || 0), 0);

  const unreadByThread = (t) => (t.messages || []).filter((m) => m.direction === "Inbound" && !m.is_read).length;
  const unreadThreads = threads.filter((t) => unreadByThread(t) > 0);
  const unreadCount = unreadThreads.reduce((sum, t) => sum + unreadByThread(t), 0);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <div style={{ fontSize: 20, fontWeight: 800, color: C.textPrimary, letterSpacing: "-0.02em" }}>
          {greeting}, {profile?.full_name?.split(" ")[0] || "there"}
        </div>
        <div style={{ fontSize: 12, color: C.textTertiary, marginTop: 2 }}>
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <StatCard label="Today's Schedule" value={todayAppts.length} sub={`${completed} done · ${inProgress} active · ${noShows} no-show`} color={C.teal} icon="📅" />
        <StatCard label="In Queue" value={activeQueue} sub="Waiting or roomed now" color={C.blue} icon="⏱" />
        <StatCard label="Open Tasks" value={data.tasks.length} sub={`${urgentTasks} urgent / high`} color={urgentTasks > 0 ? C.amber : C.textSecondary} icon="✓" />
        <StatCard label="Copay Collection" value={`$${copayCollected.toFixed(0)} / $${copayExpected.toFixed(0)}`} sub={copayExpected > 0 ? `${Math.round((copayCollected / copayExpected) * 100)}% collected` : "No expected copays"} color={C.green} icon="$" />
      </div>

      <ProChartPrepCard practiceId={practiceId} tier={tier} onNav={onNav} />

      {data.insights && (
        <Card style={{ borderLeft: `3px solid ${C.teal}` }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.teal, textTransform: "uppercase", letterSpacing: "0.06em" }}>IC Insight of the Day</div>
            <Badge label="New" variant="teal" />
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary, marginBottom: 8 }}>{data.insights.headline_stat}</div>
          {Array.isArray(data.insights.recommendations) && data.insights.recommendations.slice(0, 3).map((r, i) => (
            <div key={i} style={{ fontSize: 12, color: C.textSecondary, marginTop: 4 }}>{typeof r === "string" ? r : r.text}</div>
          ))}
          <Btn variant="outline" size="sm" style={{ marginTop: 12 }} onClick={() => onNav?.("insights")}>View all insights</Btn>
        </Card>
      )}

      {/* Row 1: today's schedule + live queue */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
        <Card>
          <SectionHead
            title="Today's Schedule"
            sub={`${todayAppts.length} appointments`}
            action={<Btn variant="outline" size="sm" onClick={() => onNav?.("schedule")}>Open Schedule</Btn>}
          />
          {todayAppts.length === 0 ? (
            <EmptyState icon="📅" title="No appointments scheduled today" sub="When patients book, they'll show here." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {todayAppts.slice(0, 10).map((a) => (
                <div key={a.id} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 10px", border: `0.5px solid ${C.borderLight}`, borderRadius: 8,
                }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.textSecondary, minWidth: 72 }}>{slotToTime(a.start_slot)}</div>
                  <ApptTypeDot type={a.appt_type} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>
                      {a.patients ? `${a.patients.first_name} ${a.patients.last_name}` : "-"}
                    </div>
                    <div style={{ fontSize: 11, color: C.textTertiary }}>
                      {a.appt_type}{a.providers ? ` · Dr. ${a.providers.last_name}` : ""}
                      {a.chief_complaint ? ` · ${a.chief_complaint}` : ""}
                    </div>
                  </div>
                  <Badge label={a.status} variant={APPT_STATUS_VARIANT[a.status] || "neutral"} />
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <SectionHead title="Live Queue" sub={`${activeQueue} active`} action={<Btn variant="outline" size="sm" onClick={() => onNav?.("queue")}>Queue</Btn>} />
          {data.queue.length === 0 ? (
            <div style={{ fontSize: 12, color: C.textTertiary, padding: 12, textAlign: "center" }}>No patients in queue.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {data.queue.slice(0, 8).map((q) => (
                <div key={q.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Avatar initials={initialsOf(q.patients?.first_name, q.patients?.last_name)} size={26} color={C.tealMid} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {q.patients ? `${q.patients.first_name} ${q.patients.last_name}` : "-"}
                    </div>
                    <div style={{ fontSize: 10, color: C.textTertiary }}>
                      {q.rooms?.name || "Lobby"}{q.providers ? ` · Dr. ${q.providers.last_name}` : ""}
                    </div>
                  </div>
                  <Badge label={q.queue_status} variant={QUEUE_STATUS_VARIANT[q.queue_status] || "neutral"} size="xs" />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Row 2: open tasks + inbox (inbox gated by role) */}
      <div style={{ display: "grid", gridTemplateColumns: hasInbox ? "2fr 1fr" : "1fr", gap: 16 }}>
        <Card>
          <SectionHead title="Open Tasks" sub="Prioritized by urgency" action={<Btn variant="outline" size="sm" onClick={() => onNav?.("tasks")}>All Tasks</Btn>} />
          {data.tasks.length === 0 ? (
            <div style={{ fontSize: 12, color: C.textTertiary, padding: 12, textAlign: "center" }}>All caught up! No open tasks.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 8 }}>
              {data.tasks.slice(0, 9).map((t) => (
                <div key={t.id} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 10px", border: `0.5px solid ${C.borderLight}`, borderRadius: 8,
                }}>
                  <Badge label={t.priority} variant={TASK_PRIORITY_VARIANT[t.priority] || "neutral"} size="xs" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</div>
                    <div style={{ fontSize: 10, color: C.textTertiary }}>
                      {t.category}{t.due_date ? ` · due ${t.due_date}` : ""}
                      {t.patients ? ` · ${t.patients.first_name} ${t.patients.last_name}` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {hasInbox && (
          <Card>
            <SectionHead
              title="Inbox"
              sub={unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
              action={<Btn variant="outline" size="sm" onClick={() => onNav?.("inbox")}>Open Inbox</Btn>}
            />
            {unreadThreads.length === 0 ? (
              <div style={{ fontSize: 12, color: C.textTertiary, padding: 12, textAlign: "center" }}>
                {threads.length === 0 ? "No messages yet." : "All messages read."}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {unreadThreads.slice(0, 6).map((t) => {
                  const inbound = (t.messages || []).filter((m) => m.direction === "Inbound");
                  const last = inbound[inbound.length - 1];
                  const count = unreadByThread(t);
                  return (
                    <div key={t.id} onClick={() => onNav?.("inbox")} style={{
                      display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
                      padding: "8px 10px", border: `0.5px solid ${C.borderLight}`, borderRadius: 8,
                    }}>
                      <Avatar initials={initialsOf(t.patients?.first_name, t.patients?.last_name)} size={28} color={C.teal} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: C.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {t.patients ? `${t.patients.first_name} ${t.patients.last_name}` : "Unknown"}
                        </div>
                        <div style={{ fontSize: 10, color: C.textTertiary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {t.subject ? t.subject : (last?.body ? last.body.slice(0, 50) : "-")}
                        </div>
                      </div>
                      <Badge label={count} variant="teal" size="xs" />
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
