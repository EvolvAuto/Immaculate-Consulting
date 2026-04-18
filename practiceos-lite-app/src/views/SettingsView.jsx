// ═══════════════════════════════════════════════════════════════════════════════
// SettingsView — practice info, rooms CRUD, module toggles, practice hours
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../auth/AuthProvider";
import { C } from "../lib/tokens";
import { listRows, insertRow, updateRow, logAudit } from "../lib/db";
import { DAYS_OF_WEEK, slotToTime } from "../components/constants";
import { Badge, Btn, Card, FL, Input, Select, Toggle, SectionHead, TopBar, TabBar, Loader, ErrorBanner } from "../components/ui";

const ROOM_TYPES = ["Exam", "Procedure", "Telehealth", "Lab", "Admin"];

export default function SettingsView() {
  const { practiceId } = useAuth();
  const [tab, setTab] = useState("practice");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const [practice, setPractice] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [hours, setHours] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [newRoom, setNewRoom] = useState({ name: "", room_type: "Exam" });
  const [newHoliday, setNewHoliday] = useState({ name: "", holiday_date: "" });

  useEffect(() => {
    if (!practiceId) return;
    (async () => {
      try {
        setLoading(true);
        const [p, r, h, hol] = await Promise.all([
          supabase.from("practices").select("*").eq("id", practiceId).single(),
          listRows("rooms", { order: "name" }),
          listRows("practice_hours", { order: "day_of_week" }),
          listRows("holidays", { order: "holiday_date" }),
        ]);
        if (p.error) throw p.error;
        setPractice(p.data);
        setRooms(r);
        setHours(h);
        setHolidays(hol);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [practiceId]);

  const flashSaved = () => { setSaved(true); setTimeout(() => setSaved(false), 2000); };

  const savePractice = async () => {
    try {
      const patch = {
        name: practice.name, legal_name: practice.legal_name, specialty: practice.specialty,
        npi: practice.npi, tax_id: practice.tax_id, phone: practice.phone, email: practice.email,
        address_line1: practice.address_line1, city: practice.city, state: practice.state, zip: practice.zip,
      };
      await updateRow("practices", practiceId, patch, {
        audit: { entityType: "practices", details: { fields: Object.keys(patch) } },
      });
      flashSaved();
    } catch (e) { setError(e.message); }
  };

  const addRoom = async () => {
    if (!newRoom.name.trim()) return;
    try {
      const row = await insertRow("rooms", { ...newRoom, is_active: true }, practiceId, {
        audit: { entityType: "rooms" },
      });
      setRooms((prev) => [...prev, row].sort((a, b) => a.name.localeCompare(b.name)));
      setNewRoom({ name: "", room_type: "Exam" });
    } catch (e) { setError(e.message); }
  };

  const toggleRoom = async (room) => {
    try {
      const updated = await updateRow("rooms", room.id, { is_active: !room.is_active }, {
        audit: { entityType: "rooms", details: { is_active: !room.is_active } },
      });
      setRooms((prev) => prev.map((r) => (r.id === room.id ? updated : r)));
    } catch (e) { setError(e.message); }
  };

  const updateRoomType = async (room, room_type) => {
    try {
      const updated = await updateRow("rooms", room.id, { room_type }, {
        audit: { entityType: "rooms", details: { room_type } },
      });
      setRooms((prev) => prev.map((r) => (r.id === room.id ? updated : r)));
    } catch (e) { setError(e.message); }
  };

  const updateHours = async (row, patch) => {
    try {
      const updated = await updateRow("practice_hours", row.id, patch);
      setHours((prev) => prev.map((h) => (h.id === row.id ? updated : h)));
    } catch (e) { setError(e.message); }
  };

  const addHoliday = async () => {
    if (!newHoliday.name || !newHoliday.holiday_date) return;
    try {
      const row = await insertRow("holidays", newHoliday, practiceId, {
        audit: { entityType: "holidays", details: newHoliday },
      });
      setHolidays((prev) => [...prev, row].sort((a, b) => a.holiday_date.localeCompare(b.holiday_date)));
      setNewHoliday({ name: "", holiday_date: "" });
    } catch (e) { setError(e.message); }
  };

  const removeHoliday = async (id) => {
    try {
      await supabase.from("holidays").delete().eq("id", id);
      await logAudit({ action: "Delete", entityType: "holidays", entityId: id });
      setHolidays((prev) => prev.filter((h) => h.id !== id));
    } catch (e) { setError(e.message); }
  };

  if (loading) return <div style={{ flex: 1 }}><TopBar title="Settings" sub="Practice configuration" /><Loader /></div>;
  if (!practice) return <div style={{ flex: 1 }}><TopBar title="Settings" /><ErrorBanner message="Practice not loaded" /></div>;

  const set = (k) => (v) => setPractice((p) => ({ ...p, [k]: v }));

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar title="Settings" sub="Practice configuration"
        actions={<>
          {saved && <Badge label="Saved!" variant="green" />}
          <TabBar
            tabs={[["practice", "Practice"], ["rooms", "Rooms"], ["hours", "Hours"], ["holidays", "Holidays"]]}
            active={tab}
            onChange={setTab}
          />
        </>}
      />
      <div style={{ flex: 1, overflowY: "auto", padding: 24, display: "flex", flexDirection: "column", gap: 16, maxWidth: 900, margin: "0 auto", width: "100%" }}>
        {error && <ErrorBanner message={error} />}

        {tab === "practice" && (
          <Card>
            <SectionHead title="Practice Information" sub="Core details used across the app and proposals" action={<Btn onClick={savePractice}>Save Changes</Btn>} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Input label="Practice Name" value={practice.name} onChange={set("name")} />
              <Input label="Legal Name" value={practice.legal_name} onChange={set("legal_name")} />
              <Input label="Specialty" value={practice.specialty} onChange={set("specialty")} />
              <Input label="NPI" value={practice.npi} onChange={set("npi")} />
              <Input label="Tax ID" value={practice.tax_id} onChange={set("tax_id")} />
              <Input label="Phone" value={practice.phone} onChange={set("phone")} />
              <Input label="Email" value={practice.email} onChange={set("email")} />
              <Input label="Address" value={practice.address_line1} onChange={set("address_line1")} />
              <Input label="City" value={practice.city} onChange={set("city")} />
              <Input label="State" value={practice.state} onChange={set("state")} />
              <Input label="ZIP" value={practice.zip} onChange={set("zip")} />
              <Input label="Timezone" value={practice.timezone} onChange={set("timezone")} />
            </div>
          </Card>
        )}

        {tab === "rooms" && (
          <Card>
            <SectionHead title="Rooms" sub="Exam rooms, procedure rooms, and telehealth endpoints" />
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
              {rooms.map((r) => (
                <div key={r.id} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 12px",
                  border: `0.5px solid ${C.borderLight}`,
                  borderRadius: 8, opacity: r.is_active ? 1 : 0.55,
                }}>
                  <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: C.textPrimary }}>{r.name}</div>
                  <select
                    value={r.room_type}
                    onChange={(e) => updateRoomType(r, e.target.value)}
                    style={{ padding: "4px 8px", border: `0.5px solid ${C.borderMid}`, borderRadius: 6, fontSize: 12, fontFamily: "inherit" }}
                  >
                    {ROOM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <Toggle value={r.is_active} onChange={() => toggleRoom(r)} />
                </div>
              ))}
              {rooms.length === 0 && <div style={{ padding: 16, fontSize: 12, color: C.textTertiary, textAlign: "center" }}>No rooms yet. Add one below.</div>}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={newRoom.name}
                onChange={(e) => setNewRoom((p) => ({ ...p, name: e.target.value }))}
                placeholder="New room name..."
                style={{ flex: 1, padding: "9px 12px", border: `1px solid ${C.borderMid}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", outline: "none" }}
              />
              <select
                value={newRoom.room_type}
                onChange={(e) => setNewRoom((p) => ({ ...p, room_type: e.target.value }))}
                style={{ padding: "9px 12px", border: `0.5px solid ${C.borderMid}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit" }}
              >
                {ROOM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <Btn onClick={addRoom}>+ Add Room</Btn>
            </div>
          </Card>
        )}

        {tab === "hours" && (
          <Card>
            <SectionHead title="Practice Hours" sub="Applies across schedule grid and patient-facing booking" />
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {hours.map((h) => (
                <div key={h.id} style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "8px 12px", border: `0.5px solid ${C.borderLight}`, borderRadius: 8,
                }}>
                  <div style={{ width: 100, fontSize: 13, fontWeight: 600 }}>{DAYS_OF_WEEK[h.day_of_week]}</div>
                  <Toggle value={h.is_open} onChange={(v) => updateHours(h, { is_open: v })} />
                  {h.is_open && (
                    <>
                      <div style={{ fontSize: 11, color: C.textSecondary }}>Open</div>
                      <input type="number" min={0} max={95} value={h.open_slot}
                        onChange={(e) => updateHours(h, { open_slot: parseInt(e.target.value) || 0 })}
                        style={{ width: 60, padding: "4px 8px", border: `0.5px solid ${C.borderMid}`, borderRadius: 6, fontSize: 12 }}
                      />
                      <div style={{ fontSize: 11, color: C.textTertiary }}>({slotToTime(h.open_slot)})</div>
                      <div style={{ fontSize: 11, color: C.textSecondary }}>Close</div>
                      <input type="number" min={0} max={95} value={h.close_slot}
                        onChange={(e) => updateHours(h, { close_slot: parseInt(e.target.value) || 0 })}
                        style={{ width: 60, padding: "4px 8px", border: `0.5px solid ${C.borderMid}`, borderRadius: 6, fontSize: 12 }}
                      />
                      <div style={{ fontSize: 11, color: C.textTertiary }}>({slotToTime(h.close_slot)})</div>
                    </>
                  )}
                </div>
              ))}
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: C.textTertiary }}>
              Slots are 15-min increments. 28 = 7:00 AM · 48 = 12:00 PM · 72 = 6:00 PM
            </div>
          </Card>
        )}

        {tab === "holidays" && (
          <Card>
            <SectionHead title="Holidays" sub="Schedule automatically closes on these dates" />
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
              {holidays.map((h) => (
                <div key={h.id} style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "8px 12px", border: `0.5px solid ${C.borderLight}`, borderRadius: 8,
                }}>
                  <div style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{h.name}</div>
                  <div style={{ fontSize: 12, color: C.textSecondary }}>{h.holiday_date}</div>
                  <button onClick={() => removeHoliday(h.id)} style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 16 }}>×</button>
                </div>
              ))}
              {holidays.length === 0 && <div style={{ padding: 16, fontSize: 12, color: C.textTertiary, textAlign: "center" }}>No holidays on file.</div>}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={newHoliday.name}
                onChange={(e) => setNewHoliday((p) => ({ ...p, name: e.target.value }))}
                placeholder="Holiday name (e.g. Thanksgiving)"
                style={{ flex: 1, padding: "9px 12px", border: `1px solid ${C.borderMid}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit" }}
              />
              <input
                type="date"
                value={newHoliday.holiday_date}
                onChange={(e) => setNewHoliday((p) => ({ ...p, holiday_date: e.target.value }))}
                style={{ padding: "9px 12px", border: `1px solid ${C.borderMid}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit" }}
              />
              <Btn onClick={addHoliday}>+ Add Holiday</Btn>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
