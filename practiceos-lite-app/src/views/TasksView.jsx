// ═══════════════════════════════════════════════════════════════════════════════
// TasksView — priority-sorted list with patient linking via search
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../auth/AuthProvider";
import { C } from "../lib/tokens";
import { insertRow, updateRow } from "../lib/db";
import { TASK_PRIORITY_VARIANT } from "../components/constants";
import { Badge, Btn, Card, Modal, Input, Textarea, Select, TopBar, TabBar, FL, Loader, ErrorBanner, EmptyState } from "../components/ui";

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
          .select("*, patients(id, first_name, last_name, date_of_birth), assignee:users!tasks_assigned_to_fkey(full_name)")
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
        patient_id: form.patient?.id || null, assigned_to: form.assigned_to || null,
        assigned_role: form.assigned_role || null, due_date: form.due_date || null,
      };
      if (form.id) {
        const u = await updateRow("tasks", form.id, payload, { audit: { entityType: "tasks" } });
        setTasks((prev) => prev.map((t) => t.id === u.id ? { ...t, ...u, patients: form.patient } : t));
      } else {
        payload.created_by = profile?.id;
        const u = await insertRow("tasks", payload, practiceId, { audit: { entityType: "tasks" } });
        setTasks((prev) => [{ ...u, patients: form.patient }, ...prev]);
      }
      setEditing(null);
    } catch (e) { setError(e.message); }
  };

  const complete = async (t) => {
    try {
      const u = await updateRow("tasks", t.id, {
        status: "Completed", completed_at: new Date().toISOString(), completed_by: profile?.id,
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
          <Btn size="sm" onClick={() => setEditing({ title: "", priority: "Normal", category: "Admin", status: "Open", patient: null })}>+ New Task</Btn>
        </>} />

      <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
        {error && <ErrorBanner message={error} />}
        {filtered.length === 0 ? <EmptyState icon="✓" title={tab === "completed" ? "No completed tasks" : "All caught up!"} sub="No open tasks right now." />
          : <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 960, margin: "0 auto" }}>
            {filtered.map((t) => (
              <Card key={t.id} style={{ padding: 12, cursor: "pointer" }} onClick={() => setEditing({ ...t, patient: t.patients })}>
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
                      {t.patients ? ` · 👤 ${t.patients.first_name} ${t.patients.last_name}` : ""}
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
    <Modal title={initial.id ? "Edit Task" : "New Task"} onClose={onClose} maxWidth={560}>
      <Input label="Title *" value={f.title} onChange={set("title")} />
      <Textarea label="Description" value={f.description} onChange={set("description")} rows={3} />

      <FL>Linked Patient</FL>
      <PatientPicker value={f.patient} onChange={set("patient")} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 6 }}>
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

// ─── Reusable searchable patient picker ───────────────────────────────────────
export function PatientPicker({ value, onChange, placeholder = "Search patient by name..." }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!q || q.length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.from("patients")
        .select("id, first_name, last_name, date_of_birth, mrn")
        .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,mrn.ilike.%${q}%`)
        .eq("status", "Active").limit(8);
      setResults(data || []); setOpen(true);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  if (value) {
    return (
      <div style={{ padding: "8px 12px", border: `1px solid ${C.tealBorder}`, borderRadius: 8, background: C.tealBg, display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 13 }}>
          <b>{value.first_name} {value.last_name}</b>
          {value.date_of_birth && <span style={{ color: C.textTertiary }}> · DOB {value.date_of_birth}</span>}
        </div>
        <button onClick={() => { onChange(null); setQ(""); }}
          style={{ background: "none", border: "none", cursor: "pointer", color: C.textSecondary, fontSize: 18, lineHeight: 1 }}>×</button>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", marginBottom: 12 }}>
      <input value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => setOpen(true)}
        placeholder={placeholder}
        style={{ width: "100%", padding: "8px 12px", border: `0.5px solid ${C.borderMid}`, borderRadius: 6, fontSize: 13, fontFamily: "inherit", outline: "none" }} />
      {open && results.length > 0 && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, background: C.bgPrimary, border: `0.5px solid ${C.borderMid}`, borderRadius: 6, boxShadow: "0 4px 12px rgba(0,0,0,0.08)", zIndex: 10, maxHeight: 240, overflowY: "auto" }}>
          {results.map((p) => (
            <div key={p.id} onClick={() => { onChange(p); setQ(""); setOpen(false); }}
              style={{ padding: "8px 12px", fontSize: 12, cursor: "pointer", borderBottom: `0.5px solid ${C.borderLight}` }}
              onMouseEnter={(e) => e.currentTarget.style.background = C.bgSecondary}
              onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
              <b>{p.first_name} {p.last_name}</b>
              <span style={{ color: C.textTertiary }}> · DOB {p.date_of_birth}{p.mrn && ` · MRN ${p.mrn}`}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
