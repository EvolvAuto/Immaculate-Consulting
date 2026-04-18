// ═══════════════════════════════════════════════════════════════════════════════
// ScheduleView — day grid with provider columns, 15-min slots, appt CRUD
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../auth/AuthProvider";
import { C } from "../lib/tokens";
import { listRows, insertRow, updateRow, logAudit } from "../lib/db";
import { DEFAULT_APPT_TYPES, SLOT_H, TIME_COL_W, slotToTime, toISODate, APPT_STATUS_VARIANT } from "../components/constants";
import { Badge, Btn, Card, Modal, Input, Textarea, Select, TopBar, FL, Loader, ErrorBanner, EmptyState } from "../components/ui";

const STATUSES = ["Scheduled", "Confirmed", "Checked In", "Roomed", "In Progress", "Completed", "No Show", "Cancelled", "Rescheduled"];

export default function ScheduleView() {
  const { practiceId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [date, setDate] = useState(toISODate());
  const [providers, setProviders] = useState([]);
  const [appts, setAppts] = useState([]);
  const [hours, setHours] = useState([]);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);

  useEffect(() => {
    if (!practiceId) return;
    (async () => {
      try {
        setLoading(true);
        const [p, h] = await Promise.all([
          listRows("providers", { filters: { is_active: true }, order: "last_name" }),
          listRows("practice_hours", { order: "day_of_week" }),
        ]);
        setProviders(p);
        setHours(h);
      } catch (e) { setError(e.message); }
      finally { setLoading(false); }
    })();
  }, [practiceId]);

  useEffect(() => {
    if (!practiceId) return;
    (async () => {
      try {
        const { data, error } = await supabase.from("appointments")
          .select("*, patients(id, first_name, last_name, date_of_birth), providers(first_name, last_name, color)")
          .eq("appt_date", date);
        if (error) throw error;
        setAppts(data || []);
      } catch (e) { setError(e.message); }
    })();
  }, [practiceId, date]);

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

  const saveAppt = async (form) => {
    try {
      const payload = {
        provider_id: form.provider_id,
        patient_id: form.patient_id || null,
        appt_date: date,
        start_slot: parseInt(form.start_slot),
        duration_slots: parseInt(form.duration_slots) || 2,
        appt_type: form.appt_type,
        status: form.status || "Scheduled",
        chief_complaint: form.chief_complaint || null,
        notes: form.notes || null,
      };
      if (form.id) {
        const row = await updateRow("appointments", form.id, payload, {
          audit: { entityType: "appointments", patientId: form.patient_id },
        });
        setAppts((prev) => prev.map((a) => a.id === row.id ? { ...a, ...row } : a));
      } else {
        const row = await insertRow("appointments", payload, practiceId, {
          audit: { entityType: "appointments", patientId: form.patient_id },
        });
        setAppts((prev) => [...prev, row]);
      }
      setEditing(null);
    } catch (e) { setError(e.message); }
  };

  const deleteAppt = async (id) => {
    if (!confirm("Cancel this appointment?")) return;
    try {
      await updateRow("appointments", id, { status: "Cancelled", cancelled_at: new Date().toISOString() }, {
        audit: { entityType: "appointments" },
      });
      setAppts((prev) => prev.map((a) => a.id === id ? { ...a, status: "Cancelled" } : a));
      setEditing(null);
      setViewing(null);
    } catch (e) { setError(e.message); }
  };

  if (loading) return <div style={{ flex: 1 }}><TopBar title="Schedule" /><Loader /></div>;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar title="Schedule" sub={new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
        actions={<>
          <Btn variant="ghost" size="sm" onClick={() => {
            const d = new Date(date + "T12:00:00"); d.setDate(d.getDate() - 1); setDate(toISODate(d));
          }}>←</Btn>
          <Btn variant="ghost" size="sm" onClick={() => setDate(toISODate())}>Today</Btn>
          <Btn variant="ghost" size="sm" onClick={() => {
            const d = new Date(date + "T12:00:00"); d.setDate(d.getDate() + 1); setDate(toISODate(d));
          }}>→</Btn>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            style={{ padding: "6px 10px", border: `0.5px solid ${C.borderMid}`, borderRadius: 6, fontSize: 12, fontFamily: "inherit" }} />
          <Btn size="sm" onClick={() => setEditing({ provider_id: providers[0]?.id, start_slot: 36, duration_slots: 2, appt_type: "Follow-up" })}>+ New Appointment</Btn>
        </>}
      />

      {error && <div style={{ padding: 12 }}><ErrorBanner message={error} /></div>}

      {providers.length === 0 ? (
        <EmptyState icon="👥" title="No providers yet" sub="Add providers in Staff view to build the schedule grid." />
      ) : (
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
                      onClick={() => setEditing({ provider_id: p.id, start_slot: t.slot, duration_slots: 2, appt_type: "Follow-up" })}
                      style={{ height: SLOT_H * 4, borderTop: `0.5px solid ${C.borderLight}`, cursor: "pointer" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = C.bgSecondary)}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    />
                  ))}

                  {nowSlot >= gridStart && nowSlot <= gridEnd && (
                    <div style={{
                      position: "absolute", left: 0, right: 0,
                      top: (nowSlot - gridStart) * SLOT_H,
                      height: 2, background: C.red, zIndex: 2,
                    }} />
                  )}

                  {colAppts.map((a) => {
                    const cfg = DEFAULT_APPT_TYPES.find((x) => x.name === a.appt_type) || DEFAULT_APPT_TYPES[1];
                    const top = (a.start_slot - gridStart) * SLOT_H;
                    const h = Math.max(a.duration_slots * SLOT_H, 28);
                    return (
                      <div
                        key={a.id}
                        onClick={() => setViewing(a)}
                        style={{
                          position: "absolute", left: 4, right: 4,
                          top, height: h - 2,
                          background: cfg.bg, border: `1px solid ${cfg.border}`,
                          borderLeft: `3px solid ${cfg.dot}`, borderRadius: 6,
                          padding: "3px 6px", cursor: "pointer",
                          overflow: "hidden",
                          opacity: a.status === "Cancelled" ? 0.45 : 1,
                        }}
                      >
                        <div style={{ fontSize: 11, fontWeight: 700, color: cfg.color, lineHeight: 1.2, textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                          {a.patients ? `${a.patients.first_name} ${a.patients.last_name}` : "Block"}
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
      )}

      {viewing && (
        <ApptViewModal appt={viewing} onClose={() => setViewing(null)} onEdit={() => { setEditing(viewing); setViewing(null); }} onDelete={() => deleteAppt(viewing.id)} />
      )}
      {editing && (
        <ApptFormModal
          initial={editing}
          providers={providers}
          practiceId={practiceId}
          onSave={saveAppt}
          onClose={() => setEditing(null)}
          onDelete={editing.id ? () => deleteAppt(editing.id) : null}
        />
      )}
    </div>
  );
}

// ─── View existing appointment ────────────────────────────────────────────────
function ApptViewModal({ appt, onClose, onEdit, onDelete }) {
  const cfg = DEFAULT_APPT_TYPES.find((x) => x.name === appt.appt_type) || DEFAULT_APPT_TYPES[1];
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
        <div style={{ marginBottom: 12 }}>
          <FL>Chief Complaint</FL>
          <div style={{ fontSize: 13 }}>{appt.chief_complaint}</div>
        </div>
      )}
      {appt.notes && (
        <div style={{ marginBottom: 12 }}>
          <FL>Notes</FL>
          <div style={{ fontSize: 13 }}>{appt.notes}</div>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}>
        {onDelete && <Btn variant="danger" onClick={onDelete}>Cancel Appt</Btn>}
        <Btn variant="outline" onClick={onClose}>Close</Btn>
        <Btn onClick={onEdit}>Edit</Btn>
      </div>
    </Modal>
  );
}

// ─── Create / Edit appointment ────────────────────────────────────────────────
function ApptFormModal({ initial, providers, practiceId, onSave, onClose, onDelete }) {
  const [form, setForm] = useState(initial);
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
          <input
            value={patientSearch}
            onChange={(e) => setPatientSearch(e.target.value)}
            placeholder="Search by name or MRN..."
            style={{ width: "100%", padding: "9px 12px", border: `1px solid ${C.borderMid}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", marginBottom: 10 }}
          />
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
        <Select label="Provider" value={form.provider_id} onChange={set("provider_id")}
          options={providers.map((p) => ({ value: p.id, label: `Dr. ${p.first_name} ${p.last_name}` }))} />
        <Select label="Type" value={form.appt_type} onChange={set("appt_type")}
          options={DEFAULT_APPT_TYPES.map((t) => t.name)} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Input label="Start Slot (15-min)" type="number" value={form.start_slot} onChange={set("start_slot")} />
        <Input label="Duration (slots)" type="number" value={form.duration_slots} onChange={set("duration_slots")} />
      </div>
      <div style={{ fontSize: 11, color: C.textTertiary, marginTop: -8, marginBottom: 14 }}>
        Start: {slotToTime(parseInt(form.start_slot) || 28)} · Duration: {(parseInt(form.duration_slots) || 2) * 15} min
      </div>
      <Select label="Status" value={form.status || "Scheduled"} onChange={set("status")} options={STATUSES} />
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
