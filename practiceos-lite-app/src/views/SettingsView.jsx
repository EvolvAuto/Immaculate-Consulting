// ═══════════════════════════════════════════════════════════════════════════════
// SettingsView — Practice info, rooms, hours, holidays, appointment types
// ═══════════════════════════════════════════════════════════════════════════════

import ClinicalPanelsTab from "./settings/ClinicalPanelsTab";
import TelehealthSettings from "./settings/TelehealthSettings";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../auth/AuthProvider";
import { C } from "../lib/tokens";
import { listRows, insertRow, updateRow, deleteRow } from "../lib/db";
import { DAYS_OF_WEEK, TIMEZONES, slotToTime24, time24ToSlot } from "../components/constants";
import { Badge, Btn, Card, Modal, Input, Select, Toggle, TopBar, TabBar, FL, SectionHead, Loader, ErrorBanner, EmptyState } from "../components/ui";

const ROOM_TYPES = ["Exam", "Procedure", "Telehealth", "Lab", "Admin"];
const COLOR_PRESETS = ["#3B82F6", "#1D9E75", "#8B5CF6", "#D08A2E", "#06B6D4", "#EF4444", "#10B981", "#EC4899", "#F59E0B", "#6366F1"];

export default function SettingsView() {
  const { practiceId, role } = useAuth();
  const [tab, setTab] = useState("practice");

  const canEdit = role === "Owner" || role === "Manager";

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
     <TopBar title="Settings" sub="Practice configuration"
        actions={<TabBar tabs={[
          ["practice", "Practice Info"],
          ["appt_types", "Appointment Types"],
          ["panels", "Clinical Panels"],
          ["rooms", "Rooms"],
          ["hours", "Hours"],
          ["holidays", "Holidays"],
          ["telehealth", "Telehealth"],
        ]} active={tab} onChange={setTab} />} />

      <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
        {!canEdit && (
          <div style={{ padding: 10, background: C.amberBg, color: C.amber, borderRadius: 6, marginBottom: 14, fontSize: 12, maxWidth: 860, margin: "0 auto 14px" }}>
            Read-only — only Owners and Managers can edit practice settings.
          </div>
        )}
        {tab === "practice"  && <PracticeInfoTab  practiceId={practiceId} canEdit={canEdit} />}
        {tab === "appt_types" && <ApptTypesTab    practiceId={practiceId} canEdit={canEdit} />}
        {tab === "panels"     && <ClinicalPanelsTab canEdit={canEdit} />}
        {tab === "rooms"     && <RoomsTab         practiceId={practiceId} canEdit={canEdit} />}
        {tab === "hours"     && <HoursTab         practiceId={practiceId} canEdit={canEdit} />}
        {tab === "holidays"  && <HolidaysTab       practiceId={practiceId} canEdit={canEdit} />}
        {tab === "telehealth" && <TelehealthSettings practiceId={practiceId} canEdit={canEdit} />}
      </div>
    </div>
  );
}

// ─── Practice info tab ────────────────────────────────────────────────────────
function PracticeInfoTab({ practiceId, canEdit }) {
  const [p, setP] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!practiceId) return;
    supabase.from("practices").select("*").eq("id", practiceId).single()
      .then(({ data, error }) => { if (error) setError(error.message); else setP(data); });
  }, [practiceId]);

  if (error) return <ErrorBanner message={error} />;
  if (!p) return <Loader />;

  const set = (k) => (v) => { setP((prev) => ({ ...prev, [k]: v })); setDirty(true); };

  const save = async () => {
    try {
      setSaving(true); setError(null);
      await updateRow("practices", p.id, {
        name: p.name, specialty: p.specialty, phone: p.phone, email: p.email,
        address_line1: p.address_line1, address_line2: p.address_line2,
        city: p.city, state: p.state, zip: p.zip, timezone: p.timezone,
      });
      setDirty(false);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>
      <SectionHead title="Practice Information" />
      <Card>
        <Input label="Practice Name" value={p.name} onChange={set("name")} disabled={!canEdit} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Input label="Specialty" value={p.specialty} onChange={set("specialty")} disabled={!canEdit} />
          <Select label="Timezone" value={p.timezone || "America/New_York"} onChange={set("timezone")} disabled={!canEdit}
            options={TIMEZONES.map((tz) => ({ value: tz.value, label: tz.label }))} />
          <Input label="Phone" value={p.phone} onChange={set("phone")} disabled={!canEdit} />
          <Input label="Email" value={p.email} onChange={set("email")} disabled={!canEdit} />
        </div>
        <Input label="Address Line 1" value={p.address_line1} onChange={set("address_line1")} disabled={!canEdit} />
        <Input label="Address Line 2" value={p.address_line2} onChange={set("address_line2")} disabled={!canEdit} />
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12 }}>
          <Input label="City" value={p.city} onChange={set("city")} disabled={!canEdit} />
          <Input label="State" value={p.state} onChange={set("state")} disabled={!canEdit} />
          <Input label="ZIP" value={p.zip} onChange={set("zip")} disabled={!canEdit} />
        </div>
        {canEdit && (
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
            <Btn onClick={save} disabled={!dirty || saving}>{saving ? "Saving..." : "Save Changes"}</Btn>
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── Appointment types tab ────────────────────────────────────────────────────
function ApptTypesTab({ practiceId, canEdit }) {
  const [types, setTypes] = useState([]);
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState(null);

  const load = async () => {
    try {
      const rows = await listRows("practice_appt_types", { order: "sort_order" });
      setTypes(rows);
    } catch (e) { setError(e.message); }
  };
  useEffect(() => { if (practiceId) load(); }, [practiceId]);

  const save = async (t) => {
    try {
      const payload = { name: t.name, color: t.color, default_duration_minutes: parseInt(t.default_duration) || 30,
        is_active: t.is_active !== false, sort_order: parseInt(t.sort_order) || 0 };
      if (t.id) await updateRow("practice_appt_types", t.id, payload);
      else await insertRow("practice_appt_types", payload, practiceId);
      setEditing(null); setAdding(false);
      load();
    } catch (e) { setError(e.message); }
  };

  const remove = async (t) => {
    if (!confirm(`Delete "${t.name}"? Existing appointments using this type will keep their label but it won't appear in new-appointment dropdowns.`)) return;
    try { await deleteRow("practice_appt_types", t.id); load(); } catch (e) { setError(e.message); }
  };

  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>
      {error && <ErrorBanner message={error} />}
      <SectionHead title="Appointment Types" sub="Types show in the schedule with custom colors"
        action={canEdit && <Btn size="sm" onClick={() => setAdding(true)}>+ Add Type</Btn>} />
      {types.length === 0 ? <EmptyState icon="📅" title="No types configured" sub="Add types to let staff schedule appointments." />
        : <Card style={{ padding: 0 }}>
          {types.map((t, i) => (
            <div key={t.id} style={{
              display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
              borderBottom: i < types.length - 1 ? `0.5px solid ${C.borderLight}` : "none",
              opacity: t.is_active ? 1 : 0.55,
            }}>
              <div style={{ width: 14, height: 14, borderRadius: "50%", background: t.color, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>{t.name}</div>
                <div style={{ fontSize: 11, color: C.textTertiary }}>
                  {t.default_duration_minutes} min default · order {t.sort_order}
                  {!t.is_active && " · Inactive"}
                </div>
              </div>
              {canEdit && <>
                <Btn size="sm" variant="outline" onClick={() => setEditing(t)}>Edit</Btn>
                <Btn size="sm" variant="ghost" onClick={() => remove(t)}>×</Btn>
              </>}
            </div>
          ))}
        </Card>}

      {adding && <ApptTypeForm
        initial={{ name: "", color: COLOR_PRESETS[0], default_duration: 30, is_active: true, sort_order: (types.at(-1)?.sort_order || 0) + 1 }}
        onClose={() => setAdding(false)} onSave={save} />}
      {editing && <ApptTypeForm initial={editing} onClose={() => setEditing(null)} onSave={save} />}
    </div>
  );
}

function ApptTypeForm({ initial, onClose, onSave }) {
  const [f, setF] = useState({ ...initial, default_duration: initial.default_duration_minutes ?? initial.default_duration ?? 30 });
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  return (
    <Modal title={initial.id ? "Edit Appointment Type" : "New Appointment Type"} onClose={onClose} maxWidth={480}>
      <Input label="Name *" value={f.name} onChange={set("name")} placeholder="e.g. Wellness Visit" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Input label="Default Duration (min)" type="number" value={f.default_duration} onChange={set("default_duration")} />
        <Input label="Sort Order" type="number" value={f.sort_order} onChange={set("sort_order")} />
      </div>
      <FL>Color</FL>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
        {COLOR_PRESETS.map((c) => (
          <button key={c} onClick={() => set("color")(c)} style={{
            width: 32, height: 32, borderRadius: "50%", background: c,
            border: f.color === c ? `3px solid ${C.textPrimary}` : "2px solid #fff",
            boxShadow: "0 0 0 1px rgba(0,0,0,0.1)", cursor: "pointer",
          }} />
        ))}
        <input type="color" value={f.color} onChange={(e) => set("color")(e.target.value)}
          style={{ width: 32, height: 32, border: "none", cursor: "pointer", background: "transparent" }} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <FL>Active</FL>
        <Toggle value={f.is_active} onChange={set("is_active")} />
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        <Btn onClick={() => f.name.trim() && onSave(f)}>Save</Btn>
      </div>
    </Modal>
  );
}

// ─── Rooms tab ────────────────────────────────────────────────────────────────
function RoomsTab({ practiceId, canEdit }) {
  const [rooms, setRooms] = useState([]);
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);

  const load = async () => setRooms(await listRows("rooms", { order: "name" }));
  useEffect(() => { if (practiceId) load(); }, [practiceId]);

  const save = async (r) => {
    try {
      const payload = { name: r.name, room_type: r.room_type, is_active: r.is_active !== false };
      if (r.id) await updateRow("rooms", r.id, payload);
      else await insertRow("rooms", payload, practiceId);
      setEditing(null); setAdding(false); load();
    } catch (e) { alert(e.message); }
  };
  const remove = async (r) => {
    if (!confirm(`Delete "${r.name}"?`)) return;
    try { await deleteRow("rooms", r.id); load(); } catch (e) { alert(e.message); }
  };

  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>
      <SectionHead title="Rooms" action={canEdit && <Btn size="sm" onClick={() => setAdding(true)}>+ Add Room</Btn>} />
      {rooms.length === 0 ? <EmptyState icon="🚪" title="No rooms" />
        : <Card style={{ padding: 0 }}>
          {rooms.map((r, i) => (
            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderBottom: i < rooms.length - 1 ? `0.5px solid ${C.borderLight}` : "none", opacity: r.is_active ? 1 : 0.55 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{r.name}</div>
                <div style={{ fontSize: 11, color: C.textTertiary }}>{r.room_type}{!r.is_active && " · Inactive"}</div>
              </div>
              {canEdit && <>
                <Btn size="sm" variant="outline" onClick={() => setEditing(r)}>Edit</Btn>
                <Btn size="sm" variant="ghost" onClick={() => remove(r)}>×</Btn>
              </>}
            </div>
          ))}
        </Card>}
      {adding && <RoomForm initial={{ name: "", room_type: "Exam", is_active: true }} onClose={() => setAdding(false)} onSave={save} />}
      {editing && <RoomForm initial={editing} onClose={() => setEditing(null)} onSave={save} />}
    </div>
  );
}
function RoomForm({ initial, onClose, onSave }) {
  const [f, setF] = useState(initial);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  return (
    <Modal title={initial.id ? "Edit Room" : "New Room"} onClose={onClose} maxWidth={420}>
      <Input label="Name *" value={f.name} onChange={set("name")} />
      <Select label="Type" value={f.room_type} onChange={set("room_type")} options={ROOM_TYPES} />
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}><FL>Active</FL><Toggle value={f.is_active} onChange={set("is_active")} /></div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}><Btn variant="outline" onClick={onClose}>Cancel</Btn><Btn onClick={() => f.name.trim() && onSave(f)}>Save</Btn></div>
    </Modal>
  );
}

// ─── Hours tab ────────────────────────────────────────────────────────────────
function HoursTab({ practiceId, canEdit }) {
  const [hours, setHours] = useState([]);
  useEffect(() => {
    if (!practiceId) return;
    listRows("practice_hours", { order: "day_of_week" }).then(setHours);
  }, [practiceId]);

  const updateDay = async (dow, patch) => {
    const row = hours.find((h) => h.day_of_week === dow);
    try {
      if (row) await updateRow("practice_hours", row.id, patch);
      else await insertRow("practice_hours", { day_of_week: dow, ...patch }, practiceId);
      const next = await listRows("practice_hours", { order: "day_of_week" });
      setHours(next);
    } catch (e) { alert(e.message); }
  };

  return (
    <div style={{ maxWidth: 620, margin: "0 auto" }}>
      <SectionHead title="Practice Hours" sub="Times the practice accepts appointments" />
      <Card style={{ padding: 0 }}>
        {[0,1,2,3,4,5,6].map((dow) => {
          const h = hours.find((x) => x.day_of_week === dow);
          const isClosed = h?.is_closed !== false && !h?.open_slot;
          return (
            <div key={dow} style={{ display: "grid", gridTemplateColumns: "100px 80px 1fr 1fr", alignItems: "center", gap: 12, padding: "12px 14px", borderBottom: dow < 6 ? `0.5px solid ${C.borderLight}` : "none" }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{DAYS_OF_WEEK[dow]}</div>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: C.textTertiary, cursor: canEdit ? "pointer" : "default" }}>
                <input type="checkbox" disabled={!canEdit} checked={!(h?.is_closed ?? true) || !!h?.open_slot}
                  onChange={(e) => updateDay(dow, e.target.checked ? { open_slot: 32, close_slot: 68, is_closed: false } : { is_closed: true, open_slot: null, close_slot: null })} />
                Open
              </label>
              {!isClosed && <>
                <input type="time" disabled={!canEdit} value={h?.open_slot ? slotToTime24(h.open_slot) : "08:00"}
                  onChange={(e) => updateDay(dow, { open_slot: time24ToSlot(e.target.value) })}
                  style={{ padding: "6px 8px", border: `0.5px solid ${C.borderMid}`, borderRadius: 6, fontSize: 12, fontFamily: "inherit" }} />
                <input type="time" disabled={!canEdit} value={h?.close_slot ? slotToTime24(h.close_slot) : "17:00"}
                  onChange={(e) => updateDay(dow, { close_slot: time24ToSlot(e.target.value) })}
                  style={{ padding: "6px 8px", border: `0.5px solid ${C.borderMid}`, borderRadius: 6, fontSize: 12, fontFamily: "inherit" }} />
              </>}
              {isClosed && <div style={{ gridColumn: "3 / span 2", fontSize: 11, color: C.textTertiary }}>Closed</div>}
            </div>
          );
        })}
      </Card>
    </div>
  );
}

// ─── Holidays tab ─────────────────────────────────────────────────────────────
function HolidaysTab({ practiceId, canEdit }) {
  const [holidays, setHolidays] = useState([]);
  const [adding, setAdding] = useState(false);
  const load = async () => setHolidays(await listRows("holidays", { order: "holiday_date" }));
  useEffect(() => { if (practiceId) load(); }, [practiceId]);

  const add = async (h) => {
    try {
      await insertRow("holidays", { holiday_date: h.holiday_date, name: h.name, is_closed: true }, practiceId);
      setAdding(false); load();
    } catch (e) { alert(e.message); }
  };
  const remove = async (h) => { if (confirm(`Delete ${h.name}?`)) { await deleteRow("holidays", h.id); load(); } };

  return (
    <div style={{ maxWidth: 620, margin: "0 auto" }}>
      <SectionHead title="Holidays" action={canEdit && <Btn size="sm" onClick={() => setAdding(true)}>+ Add Holiday</Btn>} />
      <Card style={{ padding: 0 }}>
        {holidays.length === 0 ? <div style={{ padding: 24, textAlign: "center", color: C.textTertiary, fontSize: 12 }}>No holidays configured</div>
          : holidays.map((h, i) => (
            <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderBottom: i < holidays.length - 1 ? `0.5px solid ${C.borderLight}` : "none" }}>
              <div style={{ fontSize: 12, color: C.textSecondary, minWidth: 100 }}>{h.holiday_date}</div>
              <div style={{ flex: 1, fontSize: 13 }}>{h.name}</div>
              {canEdit && <Btn size="sm" variant="ghost" onClick={() => remove(h)}>×</Btn>}
            </div>
          ))}
      </Card>
      {adding && <HolidayForm onClose={() => setAdding(false)} onSave={add} />}
    </div>
  );
}
function HolidayForm({ onClose, onSave }) {
  const [f, setF] = useState({ name: "", holiday_date: "" });
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  return (
    <Modal title="Add Holiday" onClose={onClose} maxWidth={400}>
      <Input label="Name *" value={f.name} onChange={set("name")} placeholder="e.g. Thanksgiving" />
      <Input label="Date *" type="date" value={f.holiday_date} onChange={set("holiday_date")} />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}><Btn variant="outline" onClick={onClose}>Cancel</Btn><Btn onClick={() => f.name && f.holiday_date && onSave(f)}>Add</Btn></div>
    </Modal>
  );
}
