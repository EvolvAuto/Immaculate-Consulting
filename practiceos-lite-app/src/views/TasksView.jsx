// ═══════════════════════════════════════════════════════════════════════════════
// TasksView — priority-sorted task list + create/edit modal
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../auth/AuthProvider";
import { C } from "../lib/tokens";
import { insertRow, updateRow } from "../lib/db";
import { TASK_PRIORITY_VARIANT, toISODate } from "../components/constants";
import { Badge, Btn, Card, Modal, Input, Textarea, Select, TopBar, TabBar, Loader, ErrorBanner, EmptyState } from "../components/ui";

const PRIORITIES = ["Low", "Normal", "High", "Urgent"];
const CATEGORIES = ["Clinical", "Billing", "Admin", "Follow Up", "Prior Auth", "Referral", "Refill"];
const STATUSES = ["Open", "In Progress", "Completed", "Cancelled"];
const ROLES = ["Owner", "Manager", "Provider", "Medical Assistant", "Front Desk", "Billing"];

const priOrder = { "Urgent": 0, "High": 1, "Normal": 2, "Low": 3 };

export default function TasksView() {
  const { practiceId, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [tab, setTab] = useState("open");
  const [editing, setEditing] = useState(null);

  const load = async () => {
    try {
      setLoading(true);
      const [t, u] = await Promise.all([
        supabase.from("tasks")
          .select("*, patients(first_name, last_name), assignee:users!tasks_assigned_to_fkey(full_name)")
          .order("updated_at", { ascending: false }),
        supabase.from("users").select("id, full_name, role").eq("is_active", true),
      ]);
      if (t.error) throw t.error;
      setTasks(t.data || []);
      setUsers(u.data || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (practiceId) load(); }, [practiceId]);

  const save = async (form) => {
    try {
      const payload = {
        title: form.title, description: form.description || null,
        category: form.category, priority: form.priority, status: form.status,
        patient_id: form.patient_id || null, assigned_to: form.assigned_to || null,
        assigned_role: form.assigned_role || null, due_date: form.due_date || null,
      };
      if (form.id) {
        const u = await updateRow("tasks", form.id, payload, { audit: { entityType: "tasks" } });
        setTasks((prev) => prev.map((t) => t.id === u.id ? { ...t, ...u } : t));
      } else {
        payload.created_by = profile?.id;
        const u = await insertRow("tasks", payload, practiceId, { audit: { entityType: "tasks" } });
        setTasks((prev) => [u, ...prev]);
      }
      setEditing(null);
    } catch (e) { setError(e.message); }
  };

  const complete = async (t) => {
    try {
      const u = await updateRow("tasks", t.id, {
        status: "Completed",
        completed_at: new Date().toISOString(),
        completed_by: profile?.id,
      }, { audit: { entityType: "tasks" } });
      setTasks((prev) => prev.map((x) => x.id === u.id ? { ...x, ...u } : x));
    } catch (e) { setError(e.message); }
  };

  const filtered = tasks.filter((t) => {
    if (tab === "open") return t.status === "Open" || t.status === "In Progress";
    if (tab === "mine") return (t.assigned_to === profile?.id) && t.status !== "Completed" && t.status !== "Cancelled";
    if (tab === "completed") return t.status === "Completed";
    return true;
  }).sort((a, b) => (priOrder[a.priority] ?? 4) - (priOrder[b.priority] ?? 4));

  if (loading) return <div style={{ flex: 1 }}><TopBar title="Tasks" /><Loader /></div>;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar title="Tasks" sub={`${filtered.length} shown`}
        actions={<>
          <TabBar tabs={[["open", "All Open"], ["mine", "Mine"], ["completed", "Completed"]]} active={tab} onChange={setTab} />
          <Btn size="sm" onClick={() => setEditing({ title: "", priority: "Normal", category: "Admin", status: "Open" })}>+ New Task</Btn>
        </>} />

      <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
        {error && <ErrorBanner message={error} />}
        {filtered.length === 0 ? <EmptyState icon="✓" title={tab === "completed" ? "No completed tasks" : "All caught up!"} sub="No open tasks right now." />
          : <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 960, margin: "0 auto" }}>
            {filtered.map((t) => (
              <Card key={t.id} style={{ padding: 12, cursor: "pointer" }} onClick={() => setEditing(t)}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input type="checkbox" checked={t.status === "Completed"} onClick={(e) => e.stopPropagation()}
                    onChange={() => t.status !== "Completed" && complete(t)}
                    style={{ cursor: "pointer" }} />
                  <Badge label={t.priority} variant={TASK_PRIORITY_VARIANT[t.priority]} size="xs" />
                  <Badge label={t.category} variant="neutral" size="xs" />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary, textDecoration: t.status === "Completed" ? "line-through" : "none" }}>{t.title}</div>
                    <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>
                      {t.due_date ? `Due ${t.due_date}` : "No due date"}
                      {t.patients ? ` · ${t.patients.first_name} ${t.patients.last_name}` : ""}
                      {t.assignee ? ` · → ${t.assignee.full_name}` : t.assigned_role ? ` · → ${t.assigned_role}` : ""}
                    </div>
                  </div>
                  <Badge label={t.status} variant={t.status === "Completed" ? "green" : t.status === "In Progress" ? "blue" : "neutral"} size="xs" />
                </div>
              </Card>
            ))}
          </div>
        }
      </div>

      {editing && <TaskEditModal initial={editing} users={users} onClose={() => setEditing(null)} onSave={save} />}
    </div>
  );
}

function TaskEditModal({ initial, users, onClose, onSave }) {
  const [f, setF] = useState(initial);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  return (
    <Modal title={initial.id ? "Edit Task" : "New Task"} onClose={onClose} maxWidth={520}>
      <Input label="Title *" value={f.title} onChange={set("title")} />
      <Textarea label="Description" value={f.description} onChange={set("description")} rows={3} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Select label="Category" value={f.category} onChange={set("category")} options={CATEGORIES} />
        <Select label="Priority" value={f.priority} onChange={set("priority")} options={PRIORITIES} />
        <Select label="Status" value={f.status} onChange={set("status")} options={STATUSES} />
        <Input label="Due Date" type="date" value={f.due_date} onChange={set("due_date")} />
        <Select label="Assigned To (user)" value={f.assigned_to || ""} onChange={set("assigned_to")}
          options={[{ value: "", label: "— Unassigned —" }, ...users.map((u) => ({ value: u.id, label: u.full_name }))]} />
        <Select label="Assigned Role" value={f.assigned_role || ""} onChange={set("assigned_role")}
          options={[{ value: "", label: "— Any —" }, ...ROLES.map((r) => ({ value: r, label: r }))]} />
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        <Btn onClick={() => f.title.trim() && onSave(f)}>{initial.id ? "Save" : "Create Task"}</Btn>
      </div>
    </Modal>
  );
}
