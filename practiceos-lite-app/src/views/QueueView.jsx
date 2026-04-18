// ═══════════════════════════════════════════════════════════════════════════════
// QueueView — realtime flow board with drag-and-drop + backward progression
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../auth/AuthProvider";
import { C } from "../lib/tokens";
import { listRows, updateRow, insertRow, subscribeTable } from "../lib/db";
import { initialsOf } from "../components/constants";
import { Badge, Btn, Card, Modal, Input, Select, TopBar, Avatar, Loader, ErrorBanner, EmptyState } from "../components/ui";

const COLUMNS = [
  { key: "Waiting",     label: "Waiting",            color: C.amber },
  { key: "Roomed",      label: "Roomed",             color: C.blue },
  { key: "In Progress", label: "In Progress",        color: C.purple },
  { key: "Ready",       label: "Ready for Checkout", color: C.teal },
];
const STATUS_ORDER = COLUMNS.map((c) => c.key);
const NEXT_STATUS = { "Waiting": "Roomed", "Roomed": "In Progress", "In Progress": "Ready", "Ready": "Checked Out" };
const PREV_STATUS = { "Roomed": "Waiting", "In Progress": "Roomed", "Ready": "In Progress" };

export default function QueueView() {
  const { practiceId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [queue, setQueue] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [providers, setProviders] = useState([]);
  const [walkIn, setWalkIn] = useState(false);
  const [dragOver, setDragOver] = useState(null);

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
    const unsub = subscribeTable("queue_entries", { practiceId, onChange: loadQueue });
    return unsub;
  }, [practiceId]);

  // Move entry to a given status. Handles timestamps for forward AND backward moves.
  const moveTo = async (entry, newStatus, extraPatch = {}) => {
    if (entry.queue_status === newStatus) return;
    try {
      const now = new Date().toISOString();
      const patch = { queue_status: newStatus, ...extraPatch };
      const fromIdx = STATUS_ORDER.indexOf(entry.queue_status);
      const toIdx   = STATUS_ORDER.indexOf(newStatus);

      // Forward: stamp the timestamp for the target stage
      if (newStatus === "Roomed" && !entry.roomed_at)      patch.roomed_at = now;
      if (newStatus === "In Progress" && !entry.seen_at)   patch.seen_at = now;
      if (newStatus === "Ready" && !entry.ready_at)        patch.ready_at = now;
      if (newStatus === "Checked Out")                     patch.checked_out_at = now;

      // Backward: clear downstream timestamps so cycle times recompute correctly
      if (toIdx < fromIdx) {
        if (toIdx < STATUS_ORDER.indexOf("Roomed"))      patch.roomed_at = null;
        if (toIdx < STATUS_ORDER.indexOf("In Progress")) patch.seen_at = null;
        if (toIdx < STATUS_ORDER.indexOf("Ready"))       patch.ready_at = null;
      }

      await updateRow("queue_entries", entry.id, patch, {
        audit: { entityType: "queue_entries", patientId: entry.patient_id, details: { from: entry.queue_status, to: newStatus } },
      });
      await loadQueue();
    } catch (e) { setError(e.message); }
  };

  const advance = (entry) => NEXT_STATUS[entry.queue_status] && moveTo(entry, NEXT_STATUS[entry.queue_status]);
  const retreat = (entry) => PREV_STATUS[entry.queue_status] && moveTo(entry, PREV_STATUS[entry.queue_status]);

  const assignRoom = async (entry, roomId) => {
    if (entry.queue_status === "Waiting") {
      await moveTo(entry, "Roomed", { room_id: roomId });
    } else {
      await updateRow("queue_entries", entry.id, { room_id: roomId });
      await loadQueue();
    }
  };

  // Drag handlers ─────────────────────────────────────────────────────────────
  const onDragStart = (e, entry) => {
    e.dataTransfer.setData("text/plain", entry.id);
    e.dataTransfer.effectAllowed = "move";
  };
  const onDragOver = (e, colKey) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver(colKey);
  };
  const onDrop = (e, colKey) => {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData("text/plain");
    const entry = queue.find((q) => q.id === id);
    if (entry) moveTo(entry, colKey);
  };

  if (loading) return <div style={{ flex: 1 }}><TopBar title="Queue" /><Loader /></div>;

  const busyRoomIds = new Set(queue.filter((q) => q.room_id).map((q) => q.room_id));

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar title="Live Queue" sub={`${queue.length} active · ${rooms.length - busyRoomIds.size} rooms open · drag cards between columns`}
        actions={<>
          <Badge label="● Live" variant="green" />
          <Btn size="sm" onClick={() => setWalkIn(true)}>+ Walk-In</Btn>
        </>} />

      {error && <div style={{ padding: 12 }}><ErrorBanner message={error} /></div>}

      <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        {COLUMNS.map((col) => {
          const items = queue.filter((q) => q.queue_status === col.key);
          const isOver = dragOver === col.key;
          return (
            <div key={col.key}
              onDragOver={(e) => onDragOver(e, col.key)}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => onDrop(e, col.key)}
              style={{
                display: "flex", flexDirection: "column", minWidth: 0,
                background: isOver ? C.tealBg : "transparent",
                borderRadius: 8, padding: 4, transition: "background 0.15s",
              }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 4px", marginBottom: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: col.color }} />
                <div style={{ fontSize: 12, fontWeight: 700, color: C.textPrimary }}>{col.label}</div>
                <div style={{ fontSize: 11, color: C.textTertiary, marginLeft: "auto" }}>{items.length}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 80 }}>
                {items.length === 0 ? (
                  <div style={{ fontSize: 11, color: C.textTertiary, padding: 12, textAlign: "center",
                    border: `1px dashed ${isOver ? C.teal : C.borderLight}`, borderRadius: 8 }}>
                    {isOver ? "Drop here" : "Empty"}
                  </div>
                ) : items.map((q) => (
                  <QueueCard key={q.id} entry={q} rooms={rooms} busyRoomIds={busyRoomIds}
                    onAssignRoom={assignRoom} onAdvance={advance} onRetreat={retreat}
                    onDragStart={onDragStart} onCheckOut={() => moveTo(q, "Checked Out")}
                    onLWBS={() => moveTo(q, "Left Without Being Seen")} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {walkIn && <WalkInModal practiceId={practiceId} providers={providers} onClose={() => setWalkIn(false)} onCreated={loadQueue} />}
    </div>
  );
}

function QueueCard({ entry, rooms, busyRoomIds, onAssignRoom, onAdvance, onRetreat, onDragStart, onCheckOut, onLWBS }) {
  const waitMin = Math.floor((Date.now() - new Date(entry.arrived_at).getTime()) / 60000);
  const canAdvance = !!NEXT_STATUS[entry.queue_status];
  const canRetreat = !!PREV_STATUS[entry.queue_status];

  return (
    <Card
      draggable
      onDragStart={(e) => onDragStart(e, entry)}
      style={{ padding: 10, cursor: "grab", userSelect: "none" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <Avatar initials={initialsOf(entry.patients?.first_name, entry.patients?.last_name)}
          size={28} color={entry.providers?.color || C.tealMid} />
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

      {entry.queue_status === "Waiting" && !entry.room_id && (
        <select defaultValue="" onChange={(e) => e.target.value && onAssignRoom(entry, e.target.value)}
          onClick={(e) => e.stopPropagation()}
          style={{ width: "100%", padding: "4px 6px", border: `0.5px solid ${C.borderMid}`, borderRadius: 6, fontSize: 11, fontFamily: "inherit", marginBottom: 4 }}>
          <option value="">Assign room...</option>
          {rooms.map((r) => <option key={r.id} value={r.id} disabled={busyRoomIds.has(r.id)}>
            {r.name}{busyRoomIds.has(r.id) ? " (busy)" : ""}
          </option>)}
        </select>
      )}

      <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
        {canRetreat && <Btn size="sm" variant="ghost" onClick={() => onRetreat(entry)} style={{ flex: "0 0 auto", padding: "4px 8px" }} title="Move back">← Back</Btn>}
        {canAdvance && <Btn size="sm" variant="outline" onClick={() => onAdvance(entry)} style={{ flex: 1 }}>
          → {NEXT_STATUS[entry.queue_status]}
        </Btn>}
        {entry.queue_status === "Ready" && <Btn size="sm" onClick={onCheckOut} style={{ flex: 1 }}>Check Out</Btn>}
      </div>

      {entry.queue_status !== "Checked Out" && (
        <button onClick={onLWBS}
          style={{ width: "100%", marginTop: 4, background: "none", border: "none", fontSize: 10, color: C.textTertiary, cursor: "pointer" }}>
          Left without being seen
        </button>
      )}
    </Card>
  );
}

function WalkInModal({ onClose, onCreated, providers, practiceId }) {
  const [f, setF] = useState({ provider_id: providers[0]?.id || "", chief_complaint: "" });
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
        patient_id: selected.id, provider_id: f.provider_id || null,
        queue_status: "Waiting", chief_complaint: f.chief_complaint || null,
      }, practiceId, { audit: { entityType: "queue_entries", patientId: selected.id } });
      onCreated(); onClose();
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
