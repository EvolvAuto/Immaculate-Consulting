// ═══════════════════════════════════════════════════════════════════════════════
// ScheduleView — day/month view with drag-drop, editable times, provider filter
// ═══════════════════════════════════════════════════════════════════════════════
// Uses real clock times (not "slots") in the UI. Under the hood we still write
// start_slot + duration_slots to match the DB schema, but users see "9:30 AM"
// and "30 min", not "slot 38".
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../auth/AuthProvider";
import { C } from "../lib/tokens";
import { listRows, insertRow, updateRow } from "../lib/db";
import { DEFAULT_APPT_TYPES, SLOT_H, TIME_COL_W, slotToTime, timeToSlot, toISODate, APPT_STATUS_VARIANT, hexToBg } from "../components/constants";
import { Badge, Btn, Card, Modal, Input, Textarea, Select, TopBar, TabBar, FL, Loader, ErrorBanner, EmptyState } from "../components/ui";

const STATUSES = ["Scheduled", "Confirmed", "Checked In", "Roomed", "In Progress", "Completed", "No Show", "Cancelled", "Rescheduled"];
const DURATION_OPTIONS = [
  { value: 1, label: "15 min" }, { value: 2, label: "30 min" }, { value: 3, label: "45 min" },
  { value: 4, label: "60 min" }, { value: 6, label: "90 min" }, { value: 8, label: "2 hrs" },
];

// Generate HH:MM options in 15-min increments, 6am-8pm
const TIME_OPTIONS = (() => {
  const out = [];
  for (let slot = 24; slot <= 80; slot++) out.push({ value: slot, label: slotToTime(slot) });
  return out;
})();

export default function ScheduleView() {
  const { practiceId } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // Navigate to a patient chart with returnTo stamped so Back returns here.
  const openChart = (patientId) => {
    if (!patientId) return;
    navigate(`/patients/${patientId}/info`, {
      state: { returnTo: location.pathname + location.search }
    });
  };
  const [viewMode, setViewMode] = useState("day"); // 'day' | 'month'
  const [date, setDate] = useState(toISODate());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [providers, setProviders] = useState([]);
  const [appts, setAppts] = useState([]);
  const [hours, setHours] = useState([]);
  const [customApptTypes, setCustomApptTypes] = useState([]);
  const [providerFilter, setProviderFilter] = useState("all");
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [drag, setDrag] = useState(null);

  // Merge default + custom appt types (custom overrides by name)
  const apptTypes = useMemo(() => {
    const customNames = new Set(customApptTypes.map((c) => c.name));
    const defaults = DEFAULT_APPT_TYPES.filter((d) => !customNames.has(d.name)).map((d) => ({
      ...d, id: d.name, isDefault: true,
    }));
    const custom = customApptTypes.map((c) => ({
      name: c.name, dot: c.color, bg: hexToBg(c.color, 0.12), border: hexToBg(c.color, 0.3),
      color: c.color, defaultDuration: c.default_duration_minutes, id: c.id, isDefault: false,
    }));
    return [...defaults, ...custom];
  }, [customApptTypes]);

  // Initial load: providers, hours, custom appt types
  useEffect(() => {
    if (!practiceId) return;
    (async () => {
      try {
        setLoading(true);
        const [p, h, t] = await Promise.all([
          listRows("providers", { filters: { is_active: true }, order: "last_name" }),
          listRows("practice_hours", { order: "day_of_week" }),
          listRows("practice_appt_types", { filters: { is_active: true }, order: "sort_order" }),
        ]);
        setProviders(p);
        setHours(h);
        setCustomApptTypes(t);
      } catch (e) { setError(e.message); }
      finally { setLoading(false); }
    })();
  }, [practiceId]);

  // Appointments — range depends on view mode
  useEffect(() => {
    if (!practiceId) return;
    (async () => {
      try {
        let start, end;
        if (viewMode === "day") {
          start = end = date;
        } else {
          const d = new Date(date + "T12:00:00");
          start = toISODate(new Date(d.getFullYear(), d.getMonth(), 1));
          end = toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
        }
        const { data, error } = await supabase.from("appointments")
          .select("*, patients(id, first_name, last_name, date_of_birth), providers(first_name, last_name, color)")
          .gte("appt_date", start).lte("appt_date", end);
        if (error) throw error;
        setAppts(data || []);
      } catch (e) { setError(e.message); }
    })();
  }, [practiceId, date, viewMode]);

  // Day-view math
  const dow = new Date(date + "T12:00:00").getDay();
  const dayHours = hours.find((h) => h.day_of_week === dow);
  const gridStart = dayHours?.open_slot ?? 28;
  const gridEnd = dayHours?.close_slot ?? 72;
  const timeLabels = useMemo(() => {
    const out = [];
    for (let s = gridStart; s <= gridEnd; s += 4) out.push({ slot: s, label: slotToTime(s) });
    return out;
  }, [gridStart, gridEnd]);
  const nowSlot = (() => {
    const now = new Date();
    return now.toISOString().slice(0, 10) === date ? now.getHours() * 4 + Math.floor(now.getMinutes() / 15) : -1;
  })();

  const visibleProviders = providerFilter === "all" ? providers : providers.filter((p) => p.id === providerFilter);
  const visibleAppts = providerFilter === "all" ? appts : appts.filter((a) => a.provider_id === providerFilter);

  const saveAppt = async (form) => {
    try {
      const payload = {
        provider_id: form.provider_id,
        patient_id: form.patient_id || null,
        appt_date: form.appt_date || date,
        start_slot: parseInt(form.start_slot),
        duration_slots: parseInt(form.duration_slots) || 2,
        appt_type: form.appt_type,
        status: form.status || "Scheduled",
        chief_complaint: form.chief_complaint || null,
        notes: form.notes || null,
      };
      if (form.id) {
        await updateRow("appointments", form.id, payload, {
          audit: { entityType: "appointments", patientId: form.patient_id },
        });
        // Refetch with the patient + provider joins so the calendar tile
        // shows the patient name immediately, not "Block".
        const { data: hydrated } = await supabase.from("appointments")
          .select("*, patients(id, first_name, last_name, date_of_birth), providers(first_name, last_name, color)")
          .eq("id", form.id).single();
        if (hydrated) setAppts((prev) => prev.map((a) => a.id === hydrated.id ? hydrated : a));
      } else {
        const row = await insertRow("appointments", payload, practiceId, {
          audit: { entityType: "appointments", patientId: form.patient_id },
        });
        const { data: hydrated } = await supabase.from("appointments")
          .select("*, patients(id, first_name, last_name, date_of_birth), providers(first_name, last_name, color)")
          .eq("id", row.id).single();
        setAppts((prev) => [...prev, hydrated || row]);
      }
      setEditing(null);
    } catch (e) { setError(e.message); }
  };

  const cancelAppt = async (id) => {
    if (!confirm("Cancel this appointment?")) return;
    try {
      await updateRow("appointments", id, { status: "Cancelled", cancelled_at: new Date().toISOString() },
        { audit: { entityType: "appointments" } });
      setAppts((prev) => prev.map((a) => a.id === id ? { ...a, status: "Cancelled" } : a));
      setEditing(null); setViewing(null);
    } catch (e) { setError(e.message); }
  };

  // Drag & drop handlers (day view only)
  const onDragStart = (e, appt) => {
    setDrag(appt);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", appt.id);
  };
  const onDrop = async (e, providerId, slot) => {
    e.preventDefault();
    if (!drag) return;
    const newStart = slot;
    const same = drag.provider_id === providerId && drag.start_slot === newStart;
    setDrag(null);
    if (same) return;
    try {
      await updateRow("appointments", drag.id, { provider_id: providerId, start_slot: newStart },
        { audit: { entityType: "appointments", patientId: drag.patient_id, details: { moved: true } } });
      setAppts((prev) => prev.map((a) => a.id === drag.id ? { ...a, provider_id: providerId, start_slot: newStart } : a));
    } catch (err) { setError(err.message); }
  };

  if (loading) return <div style={{ flex: 1 }}><TopBar title="Schedule" /><Loader /></div>;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar
        title="Schedule"
        sub={viewMode === "day"
          ? new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
          : new Date(date + "T12:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" })
        }
        actions={<>
          <TabBar tabs={[["day", "Day"], ["month", "Month"]]} active={viewMode} onChange={setViewMode} />
          <Btn variant="ghost" size="sm" onClick={() => {
            const d = new Date(date + "T12:00:00");
            if (viewMode === "day") d.setDate(d.getDate() - 1); else d.setMonth(d.getMonth() - 1);
            setDate(toISODate(d));
          }}>←</Btn>
          <Btn variant="ghost" size="sm" onClick={() => setDate(toISODate())}>Today</Btn>
          <Btn variant="ghost" size="sm" onClick={() => {
            const d = new Date(date + "T12:00:00");
            if (viewMode === "day") d.setDate(d.getDate() + 1); else d.setMonth(d.getMonth() + 1);
            setDate(toISODate(d));
          }}>→</Btn>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            style={{ padding: "6px 10px", border: `0.5px solid ${C.borderMid}`, borderRadius: 6, fontSize: 12, fontFamily: "inherit" }} />
          <select value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)}
            style={{ padding: "6px 10px", border: `0.5px solid ${C.borderMid}`, borderRadius: 6, fontSize: 12, fontFamily: "inherit" }}>
            <option value="all">All providers</option>
            {providers.map((p) => <option key={p.id} value={p.id}>Dr. {p.first_name} {p.last_name}</option>)}
          </select>
          <Btn size="sm" onClick={() => setEditing({
            provider_id: providers[0]?.id, start_slot: 36, duration_slots: 2,
            appt_type: apptTypes[1]?.name || "Follow-up", appt_date: date,
          })}>+ New Appointment</Btn>
        </>} />

      {error && <div style={{ padding: 12 }}><ErrorBanner message={error} /></div>}

      {providers.length === 0 ? (
        <EmptyState icon="👥" title="No providers yet" sub="Add providers in Staff view to build the schedule grid." />
      ) : viewMode === "day" ? (
        <DayGrid
          providers={visibleProviders} appts={visibleAppts} apptTypes={apptTypes}
          timeLabels={timeLabels} gridStart={gridStart} gridEnd={gridEnd} nowSlot={nowSlot}
          onCellClick={(providerId, slot) => setEditing({
            provider_id: providerId, start_slot: slot, duration_slots: 2,
            appt_type: apptTypes[1]?.name || "Follow-up", appt_date: date,
          })}
          onApptClick={(a) => setViewing(a)}
          onDragStart={onDragStart}
          onDrop={onDrop}
        />
      ) : (
        <MonthGrid
          date={date} appts={visibleAppts} apptTypes={apptTypes}
          onDayClick={(d) => { setDate(d); setViewMode("day"); }}
          onApptClick={(a) => setViewing(a)}
        />
      )}

      {viewing && (
        <ApptViewModal appt={viewing} apptTypes={apptTypes} onClose={() => setViewing(null)}
          onEdit={() => { setEditing(viewing); setViewing(null); }}
          onDelete={() => cancelAppt(viewing.id)}
          onOpenChart={() => { const pid = viewing.patient_id; setViewing(null); openChart(pid); }} />
      )}
      {editing && (
        <ApptFormModal initial={editing} providers={providers} apptTypes={apptTypes} practiceId={practiceId}
          onSave={saveAppt} onClose={() => setEditing(null)}
          onDelete={editing.id ? () => cancelAppt(editing.id) : null} />
      )}
    </div>
  );
}

// ─── Day grid ─────────────────────────────────────────────────────────────────
function DayGrid({ providers, appts, apptTypes, timeLabels, gridStart, gridEnd, nowSlot, onCellClick, onApptClick, onDragStart, onDrop }) {
  return (
    <div style={{ flex: 1, overflow: "auto", background: C.bgTertiary }}>
      <div style={{ display: "flex", minWidth: "max-content", background: C.bgPrimary, position: "sticky", top: 0, zIndex: 5, borderBottom: `1px solid ${C.borderLight}` }}>
        <div style={{ width: TIME_COL_W, flexShrink: 0 }} />
        {providers.map((p) => (
          <div key={p.id} style={{ flex: "1 1 200px", minWidth: 200, padding: "10px 12px", borderLeft: `0.5px solid ${C.borderLight}`, display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: p.color }} />
            <div style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary }}>Dr. {p.first_name} {p.last_name}</div>
            <div style={{ fontSize: 11, color: C.textTertiary }}>{p.credential}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", minWidth: "max-content", position: "relative" }}>
        <div style={{ width: TIME_COL_W, flexShrink: 0, background: C.bgPrimary, borderRight: `0.5px solid ${C.borderLight}` }}>
          {timeLabels.map((t) => (
            <div key={t.slot} style={{ height: SLOT_H * 4, fontSize: 10, color: C.textTertiary, padding: "2px 8px", borderTop: `0.5px solid ${C.borderLight}` }}>
              {t.label}
            </div>
          ))}
        </div>

        {providers.map((p) => {
          const colAppts = appts.filter((a) => a.provider_id === p.id);
          return (
            <div key={p.id} style={{ flex: "1 1 200px", minWidth: 200, position: "relative", borderLeft: `0.5px solid ${C.borderLight}`, background: C.bgPrimary }}>
              {timeLabels.slice(0, -1).map((t) => (
                <div
                  key={t.slot}
                  onClick={() => onCellClick(p.id, t.slot)}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                  onDrop={(e) => onDrop(e, p.id, t.slot)}
                  style={{ height: SLOT_H * 4, borderTop: `0.5px solid ${C.borderLight}`, cursor: "pointer" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = C.bgSecondary)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                />
              ))}

              {nowSlot >= gridStart && nowSlot <= gridEnd && (
                <div style={{ position: "absolute", left: 0, right: 0, top: (nowSlot - gridStart) * SLOT_H, height: 2, background: C.red, zIndex: 2 }} />
              )}

              {colAppts.map((a) => {
                const cfg = apptTypes.find((x) => x.name === a.appt_type) || apptTypes[1];
                const top = (a.start_slot - gridStart) * SLOT_H;
                const h = Math.max(a.duration_slots * SLOT_H, 28);
                return (
                  <div
                    key={a.id}
                    draggable
                    onDragStart={(e) => onDragStart(e, a)}
                    onClick={() => onApptClick(a)}
                    title="Click to view · Drag to reschedule"
                    style={{
                      position: "absolute", left: 4, right: 4, top, height: h - 2,
                      background: cfg.bg, border: `1px solid ${cfg.border}`,
                      borderLeft: `3px solid ${cfg.dot}`, borderRadius: 6,
                      padding: "3px 6px", cursor: "grab", overflow: "hidden",
                      opacity: a.status === "Cancelled" ? 0.45 : 1,
                    }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 700, color: cfg.color, lineHeight: 1.2, textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                      {a.patients
                        ? `${a.patients.first_name} ${a.patients.last_name}`
                        : a.patient_id ? "(loading)" : "Block"}
                    </div>
                    <div style={{ fontSize: 9, color: cfg.color, opacity: 0.8 }}>
                      {a.appt_type} · {slotToTime(a.start_slot)}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Month grid ───────────────────────────────────────────────────────────────
function MonthGrid({ date, appts, apptTypes, onDayClick, onApptClick }) {
  const d = new Date(date + "T12:00:00");
  const year = d.getFullYear(), month = d.getMonth();
  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = toISODate();

  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let i = 1; i <= daysInMonth; i++) cells.push(i);
  while (cells.length % 7 !== 0) cells.push(null);

  const apptsByDate = useMemo(() => {
    const m = {};
    appts.forEach((a) => { (m[a.appt_date] = m[a.appt_date] || []).push(a); });
    return m;
  }, [appts]);

  return (
    <div style={{ flex: 1, overflow: "auto", padding: 12, background: C.bgTertiary }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1, background: C.borderLight, border: `1px solid ${C.borderLight}`, borderRadius: 8, overflow: "hidden" }}>
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} style={{ padding: "8px 10px", fontSize: 10, fontWeight: 700, color: C.textSecondary, textTransform: "uppercase", letterSpacing: "0.05em", background: C.bgSecondary, textAlign: "center" }}>{d}</div>
        ))}
        {cells.map((day, i) => {
          if (!day) return <div key={i} style={{ minHeight: 110, background: C.bgSecondary, opacity: 0.5 }} />;
          const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const dayAppts = apptsByDate[dateStr] || [];
          const isToday = dateStr === today;
          return (
            <div key={i} onClick={() => onDayClick(dateStr)}
              style={{ minHeight: 110, background: C.bgPrimary, padding: 6, cursor: "pointer", display: "flex", flexDirection: "column", gap: 2 }}>
              <div style={{ fontSize: 12, fontWeight: isToday ? 700 : 500, color: isToday ? C.teal : C.textPrimary, marginBottom: 2 }}>{day}</div>
              {dayAppts.slice(0, 3).map((a) => {
                const cfg = apptTypes.find((x) => x.name === a.appt_type) || apptTypes[1];
                return (
                  <div key={a.id} onClick={(e) => { e.stopPropagation(); onApptClick(a); }}
                    style={{ fontSize: 10, padding: "2px 5px", background: cfg.bg, color: cfg.color, borderRadius: 3, borderLeft: `2px solid ${cfg.dot}`, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: a.status === "Cancelled" ? 0.45 : 1 }}>
                    {slotToTime(a.start_slot)} {a.patients ? `${a.patients.first_name[0]}. ${a.patients.last_name}` : a.patient_id ? "(loading)" : ""}
                  </div>
                );
              })}
              {dayAppts.length > 3 && (
                <div style={{ fontSize: 9, color: C.textTertiary, paddingLeft: 5 }}>+{dayAppts.length - 3} more</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── View existing appointment ───────────────────────────────────────────────
function ApptViewModal({ appt, apptTypes, onClose, onEdit, onDelete, onOpenChart }) {
  const cfg = apptTypes.find((x) => x.name === appt.appt_type) || apptTypes[1];
  const hasPatient = !!appt.patient_id;
  return (
    <Modal title="Appointment Details" onClose={onClose} maxWidth={480}>
      <div style={{ marginBottom: 14 }}>
        <Badge label={appt.status} variant={APPT_STATUS_VARIANT[appt.status] || "neutral"} />
        <span style={{ marginLeft: 8 }}><Badge label={appt.appt_type} variant="teal" size="xs" /></span>
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: C.textPrimary, marginBottom: 4 }}>
        {appt.patients ? `${appt.patients.first_name} ${appt.patients.last_name}` : "(No patient)"}
      </div>
      <div style={{ fontSize: 13, color: C.textSecondary, marginBottom: 12 }}>
        {appt.appt_date} · {slotToTime(appt.start_slot)} · {appt.duration_slots * 15} min
        {appt.providers && ` · Dr. ${appt.providers.first_name} ${appt.providers.last_name}`}
      </div>
      {appt.chief_complaint && (
        <div style={{ marginBottom: 12 }}><FL>Chief Complaint</FL><div style={{ fontSize: 13 }}>{appt.chief_complaint}</div></div>
      )}
      {appt.notes && (
        <div style={{ marginBottom: 12 }}><FL>Notes</FL><div style={{ fontSize: 13 }}>{appt.notes}</div></div>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20, flexWrap: "wrap" }}>
        {onDelete && appt.status !== "Cancelled" && <Btn variant="danger" onClick={onDelete}>Cancel Appt</Btn>}
        <Btn variant="outline" onClick={onClose}>Close</Btn>
        {hasPatient && onOpenChart && <Btn variant="outline" onClick={onOpenChart}>Open Chart</Btn>}
        <Btn onClick={onEdit}>Edit</Btn>
      </div>
    </Modal>
  );
}

// ─── Create / Edit ────────────────────────────────────────────────────────────
function ApptFormModal({ initial, providers, apptTypes, onSave, onClose, onDelete }) {
  const [form, setForm] = useState({ ...initial, appt_date: initial.appt_date || toISODate() });
  const [patientSearch, setPatientSearch] = useState("");
  const [patientResults, setPatientResults] = useState([]);
  const [selectedPatient, setSelectedPatient] = useState(initial.patients || null);

  useEffect(() => {
    if (initial.patient_id && !selectedPatient) {
      supabase.from("patients").select("id, first_name, last_name, date_of_birth").eq("id", initial.patient_id).single()
        .then(({ data }) => data && setSelectedPatient(data));
    }
  }, [initial.patient_id]);

  useEffect(() => {
    if (!patientSearch || patientSearch.length < 2) { setPatientResults([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.from("patients")
        .select("id, first_name, last_name, date_of_birth, mrn")
        .or(`first_name.ilike.%${patientSearch}%,last_name.ilike.%${patientSearch}%,mrn.ilike.%${patientSearch}%`)
        .eq("status", "Active").limit(10);
      setPatientResults(data || []);
    }, 200);
    return () => clearTimeout(t);
  }, [patientSearch]);

  const set = (k) => (v) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <Modal title={initial.id ? "Edit Appointment" : "New Appointment"} onClose={onClose} maxWidth={560}>
      <FL>Patient</FL>
      {selectedPatient ? (
        <div style={{ padding: "9px 12px", border: `1px solid ${C.tealBorder}`, borderRadius: 8, background: C.tealBg, display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: C.teal }}>
            {selectedPatient.first_name} {selectedPatient.last_name}
            <span style={{ fontSize: 11, color: C.textSecondary, marginLeft: 8 }}>DOB {selectedPatient.date_of_birth}</span>
          </div>
          <button onClick={() => { setSelectedPatient(null); set("patient_id")(null); }} style={{ background: "none", border: "none", color: C.textTertiary, cursor: "pointer", fontSize: 18 }}>×</button>
        </div>
      ) : (
        <>
          <input value={patientSearch} onChange={(e) => setPatientSearch(e.target.value)} placeholder="Search by name or MRN..."
            style={{ width: "100%", padding: "9px 12px", border: `1px solid ${C.borderMid}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", marginBottom: 10 }} />
          {patientResults.length > 0 && (
            <div style={{ border: `0.5px solid ${C.borderLight}`, borderRadius: 8, marginBottom: 14, maxHeight: 180, overflowY: "auto" }}>
              {patientResults.map((p) => (
                <div key={p.id} onClick={() => { setSelectedPatient(p); set("patient_id")(p.id); setPatientSearch(""); setPatientResults([]); }}
                  style={{ padding: "8px 12px", fontSize: 12, cursor: "pointer", borderBottom: `0.5px solid ${C.borderLight}` }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = C.bgSecondary)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                  {p.first_name} {p.last_name} · DOB {p.date_of_birth} {p.mrn && `· MRN ${p.mrn}`}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Input label="Date" type="date" value={form.appt_date} onChange={set("appt_date")} />
        <Select label="Provider" value={form.provider_id} onChange={set("provider_id")}
          options={providers.map((p) => ({ value: p.id, label: `Dr. ${p.first_name} ${p.last_name}` }))} />
        <Select label="Type" value={form.appt_type} onChange={set("appt_type")}
          options={apptTypes.map((t) => t.name)} />
        <Select label="Status" value={form.status || "Scheduled"} onChange={set("status")} options={STATUSES} />
        <Select label="Start Time" value={form.start_slot} onChange={(v) => set("start_slot")(parseInt(v))}
          options={TIME_OPTIONS} />
        <Select label="Duration" value={form.duration_slots} onChange={(v) => set("duration_slots")(parseInt(v))}
          options={DURATION_OPTIONS} />
      </div>
      {form.appt_type === "Telehealth" && (
        <div style={{
          padding: "8px 12px",
          background: C.tealBg,
          border: `0.5px solid ${C.tealBorder}`,
          borderRadius: 6,
          fontSize: 11,
          color: C.teal,
          marginBottom: 10,
        }}>
          Telehealth visit. The patient will receive a Join Video Visit button in their portal and on appointment reminders. A Start Telehealth Visit button will appear in the chart for staff. The video room is configured per-provider in Settings &gt; Telehealth.
        </div>
      )}
      <Input label="Chief Complaint" value={form.chief_complaint} onChange={set("chief_complaint")} placeholder="e.g. Annual physical, med refill, follow-up BP" />
      <Textarea label="Notes" value={form.notes} onChange={set("notes")} rows={3} />

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}>
        {onDelete && <Btn variant="danger" onClick={onDelete}>Cancel Appt</Btn>}
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        <Btn onClick={() => onSave(form)}>{initial.id ? "Save Changes" : "Create Appointment"}</Btn>
      </div>
    </Modal>
  );
}
