// ═══════════════════════════════════════════════════════════════════════════════
// QueueView — realtime patient flow board (Waiting → Roomed → In Progress → Ready → Checked Out)
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../auth/AuthProvider";
import { C } from "../lib/tokens";
import { listRows, updateRow, insertRow, subscribeTable, logAudit } from "../lib/db";
import { QUEUE_STATUS_VARIANT, initialsOf } from "../components/constants";
import { Badge, Btn, Card, Modal, Input, Select, TopBar, Avatar, Loader, ErrorBanner, EmptyState } from "../components/ui";

const COLUMNS = [
  { key: "Waiting", label: "Waiting", color: C.amber },
  { key: "Roomed", label: "Roomed", color: C.blue },
  { key: "In Progress", label: "In Progress", color: C.purple },
  { key: "Ready", label: "Ready for Checkout", color: C.teal },
];

export default function QueueView() {
  const { practiceId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [queue, setQueue] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [providers, setProviders] = useState([]);
  const [walkIn, setWalkIn] = useState(false);

  const loadQueue = async () => {
    const { data, error } = await supabase.from("queue_entries")
      .select("*, patients(first_name, last_name), providers(first_name, last_name, color), rooms(name)")
      .neq("queue_status", "Checked Out").neq("queue_status", "Left Without Being Seen")
      .order("arrived_at");
    if (error) throw error;
    setQueue(data || []);
  };

  useEffect(() => {
    if (!practiceId) return;
    (async () => {
      try {
        const [r, p] = await Promise.all([
          listRows("rooms", { filters: { is_active: true }, order: "name" }),
          listRows("providers", { filters: { is_active: true }, order: "last_name" }),
        ]);
        setRooms(r); setProviders(p);
        await loadQueue();
      } catch (e) { setError(e.message); }
      finally { setLoading(false); }
    })();

    // Realtime subscription
    const unsub = subscribeTable("queue_entries", { practiceId, onChange: () => loadQueue() });
    return unsub;
  }, [practiceId]);

  const advance = async (entry, nextStatus, extraPatch = {}) => {
    try {
      const patch = { queue_status: nextStatus, ...extraPatch };
      const now = new Date().toISOString();
      if (nextStatus === "Roomed") patch.roomed_at = now;
      if (nextStatus === "In Progress") patch.seen_at = now;
      if (nextStatus === "Ready") patch.ready_at = now;
      if (nextStatus === "Checked Out") patch.checked_out_at = now;
      await updateRow("queue_entries", entry.id, patch, {
        audit: { entityType: "queue_entries", patientId: entry.patient_id, details: { to: nextStatus } },
      });
      await loadQueue();
    } catch (e) { setError(e.message); }
  };

  const assignRoom = async (entry, roomId) => {
    try {
      await updateRow("queue_entries", entry.id, { room_id: roomId, queue_status: "Roomed", roomed_at: new Date().toISOString() }, {
        audit: { entityType: "queue_entries", patientId: entry.patient_id, details: { room_id: roomId } },
      });
      await loadQueue();
    } catch (e) { setError(e.message); }
  };

  if (loading) return <div style={{ flex: 1 }}><TopBar title="Queue" /><Loader /></div>;

  const busyRoomIds = new Set(queue.filter((q) => q.room_id && q.queue_status !== "Checked Out").map((q) => q.room_id));

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar title="Live Queue" sub={`${queue.length} active · ${rooms.length - busyRoomIds.size} rooms open`}
        actions={<>
          <Badge label="● Live" variant="green" />
          <Btn size="sm" onClick={() => setWalkIn(true)}>+ Walk-In</Btn>
        </>} />

      {error && <div style={{ padding: 12 }}><ErrorBanner message={error} /></div>}

      <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        {COLUMNS.map((col) => {
          const items = queue.filter((q) => q.queue_status === col.key);
          return (
            <div key={col.key} style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 0", marginBottom: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: col.color }} />
                <div style={{ fontSize: 12, fontWeight: 700, color: C.textPrimary }}>{col.label}</div>
                <div style={{ fontSize: 11, color: C.textTertiary, marginLeft: "auto" }}>{items.length}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {items.length === 0 ? <div style={{ fontSize: 11, color: C.textTertiary, padding: 12, textAlign: "center", border: `1px dashed ${C.borderLight}`, borderRadius: 8 }}>Empty</div>
                  : items.map((q) => <QueueCard key={q.id} entry={q} rooms={rooms} busyRoomIds={busyRoomIds} onAssignRoom={assignRoom} onAdvance={advance} />)}
              </div>
            </div>
          );
        })}
      </div>

      {walkIn && <WalkInModal practiceId={practiceId} providers={providers} onClose={() => setWalkIn(false)} onCreated={loadQueue} />}
    </div>
  );
}

function QueueCard({ entry, rooms, busyRoomIds, onAssignRoom, onAdvance }) {
  const waitMin = Math.floor((Date.now() - new Date(entry.arrived_at).getTime()) / 60000);
  const nextMap = {
    "Waiting": "Roomed",
    "Roomed": "In Progress",
    "In Progress": "Ready",
    "Ready": "Checked Out",
  };
  const next = nextMap[entry.queue_status];

  return (
    <Card style={{ padding: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <Avatar initials={initialsOf(entry.patients?.first_name, entry.patients?.last_name)} size={28} color={entry.providers?.color || C.tealMid} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {entry.patients ? `${entry.patients.first_name} ${entry.patients.last_name}` : "—"}
          </div>
          <div style={{ fontSize: 10, color: C.textTertiary }}>
            {entry.providers ? `Dr. ${entry.providers.last_name}` : "No provider"}
            {entry.rooms && ` · ${entry.rooms.name}`}
          </div>
        </div>
        <Badge label={`${waitMin}m`} variant={waitMin > 30 ? "red" : waitMin > 15 ? "amber" : "neutral"} size="xs" />
      </div>
      {entry.chief_complaint && (
        <div style={{ fontSize: 11, color: C.textSecondary, background: C.bgSecondary, padding: "4px 8px", borderRadius: 4, marginBottom: 6 }}>
          {entry.chief_complaint}
        </div>
      )}
      {entry.queue_status === "Waiting" && (
        <select defaultValue="" onChange={(e) => e.target.value && onAssignRoom(entry, e.target.value)}
          style={{ width: "100%", padding: "4px 6px", border: `0.5px solid ${C.borderMid}`, borderRadius: 6, fontSize: 11, fontFamily: "inherit", marginBottom: 4 }}>
          <option value="">Assign room...</option>
          {rooms.map((r) => <option key={r.id} value={r.id} disabled={busyRoomIds.has(r.id)}>
            {r.name}{busyRoomIds.has(r.id) ? " (busy)" : ""}
          </option>)}
        </select>
      )}
      {next && (
        <Btn size="sm" variant="outline" onClick={() => onAdvance(entry, next)} style={{ width: "100%" }}>→ {next}</Btn>
      )}
      {entry.queue_status !== "Checked Out" && (
        <button onClick={() => onAdvance(entry, "Left Without Being Seen")}
          style={{ width: "100%", marginTop: 4, background: "none", border: "none", fontSize: 10, color: C.textTertiary, cursor: "pointer" }}>
          Mark left without being seen
        </button>
      )}
    </Card>
  );
}

function WalkInModal({ onClose, onCreated, providers, practiceId }) {
  const [f, setF] = useState({ patient_id: "", provider_id: providers[0]?.id || "", chief_complaint: "" });
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    if (!q || q.length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.from("patients")
        .select("id, first_name, last_name, date_of_birth")
        .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`)
        .eq("status", "Active").limit(8);
      setResults(data || []);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const save = async () => {
    if (!selected) { alert("Select a patient"); return; }
    try {
      await insertRow("queue_entries", {
        patient_id: selected.id,
        provider_id: f.provider_id || null,
        queue_status: "Waiting",
        chief_complaint: f.chief_complaint || null,
      }, practiceId, { audit: { entityType: "queue_entries", patientId: selected.id } });
      onCreated();
      onClose();
    } catch (e) { alert(e.message); }
  };

  return (
    <Modal title="Add Walk-In" onClose={onClose} maxWidth={480}>
      {!selected ? <>
        <Input label="Search Patient" value={q} onChange={setQ} placeholder="Name..." />
        {results.map((p) => (
          <div key={p.id} onClick={() => setSelected(p)} style={{ padding: "8px 12px", border: `0.5px solid ${C.borderLight}`, borderRadius: 8, fontSize: 12, cursor: "pointer", marginBottom: 4 }}>
            {p.first_name} {p.last_name} · DOB {p.date_of_birth}
          </div>
        ))}
      </> : (
        <div style={{ padding: "9px 12px", border: `1px solid ${C.tealBorder}`, borderRadius: 8, background: C.tealBg, marginBottom: 14, fontSize: 13, display: "flex", justifyContent: "space-between" }}>
          <div><b>{selected.first_name} {selected.last_name}</b> · DOB {selected.date_of_birth}</div>
          <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", cursor: "pointer" }}>×</button>
        </div>
      )}
      <Select label="Provider" value={f.provider_id} onChange={set("provider_id")}
        options={[{ value: "", label: "— Unassigned —" }, ...providers.map((p) => ({ value: p.id, label: `Dr. ${p.first_name} ${p.last_name}` }))]} />
      <Input label="Chief Complaint" value={f.chief_complaint} onChange={set("chief_complaint")} />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        <Btn onClick={save}>Add to Queue</Btn>
      </div>
    </Modal>
  );
}
