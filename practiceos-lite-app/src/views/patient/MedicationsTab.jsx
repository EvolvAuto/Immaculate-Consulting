// ═══════════════════════════════════════════════════════════════════════════════
// src/views/patient/MedicationsTab.jsx
// Structured medication history: active meds + discontinued timeline with
// dose changes, indication (ICD-10), prescriber, and reason for stopping.
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../auth/AuthProvider";
import { C } from "../../lib/tokens";
import { insertRow, updateRow } from "../../lib/db";
import { Badge, Btn, Card, Modal, Input, Textarea, Select, FL, SectionHead, Loader, ErrorBanner, EmptyState } from "../../components/ui";

const STATUSES = ["Active", "Discontinued", "Completed", "On Hold", "Allergic Reaction"];
const ROUTES = ["PO", "SC", "IM", "IV", "Topical", "Inhaled", "Nasal", "Ophthalmic", "Otic", "PR"];
const FREQS = ["Daily", "BID", "TID", "QID", "Q6h", "Q8h", "Q12h", "PRN", "Weekly", "Monthly", "Every morning (fasting)", "Every evening", "With meals", "Custom"];

export default function MedicationsTab({ patient }) {
  const { practiceId, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [meds, setMeds] = useState([]);
  const [providers, setProviders] = useState([]);
  const [tab, setTab] = useState("active");
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      const [mRes, pRes] = await Promise.all([
        supabase.from("patient_medications").select("*, prov:providers(first_name, last_name)").eq("patient_id", patient.id).order("start_date", { ascending: false, nullsFirst: false }),
        supabase.from("providers").select("id, first_name, last_name").eq("is_active", true),
      ]);
      if (mRes.error) throw mRes.error;
      setMeds(mRes.data || []);
      setProviders(pRes.data || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (patient?.id) load(); }, [patient?.id]);

  const save = async (form) => {
    try {
      const payload = {
        name: form.name, generic_name: form.generic_name || null,
        dose: form.dose, route: form.route, frequency: form.frequency,
        indication: form.indication || null, indication_icd10: form.indication_icd10 || null,
        start_date: form.start_date || null, end_date: form.end_date || null,
        status: form.status, reason_stopped: form.reason_stopped || null,
        prescribed_by: form.prescribed_by || null, is_controlled: !!form.is_controlled,
        notes: form.notes || null,
      };
      if (form.id) await updateRow("patient_medications", form.id, payload, { audit: { entityType: "patient_medications", patientId: patient.id } });
      else {
        payload.created_by = profile?.id;
        await insertRow("patient_medications", payload, practiceId, { audit: { entityType: "patient_medications", patientId: patient.id } });
      }
      setEditing(null); setAdding(false); load();
    } catch (e) { alert(e.message); }
  };

  const discontinue = async (med, reason) => {
    try {
      await updateRow("patient_medications", med.id, {
        status: "Discontinued",
        end_date: new Date().toISOString().slice(0, 10),
        reason_stopped: reason || "Discontinued",
      }, { audit: { entityType: "patient_medications", patientId: patient.id } });
      load();
    } catch (e) { alert(e.message); }
  };

  if (loading) return <Loader />;
  if (error) return <ErrorBanner message={error} />;

  const active = meds.filter((m) => m.status === "Active");
  const historical = meds.filter((m) => m.status !== "Active");

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => setTab("active")} style={pillStyle(tab === "active")}>Active ({active.length})</button>
          <button onClick={() => setTab("historical")} style={pillStyle(tab === "historical")}>History ({historical.length})</button>
          <button onClick={() => setTab("timeline")} style={pillStyle(tab === "timeline")}>Timeline</button>
        </div>
        <Btn size="sm" onClick={() => setAdding(true)}>+ Add Medication</Btn>
      </div>

      {tab === "active" && (
        active.length === 0 ? <EmptyState icon="💊" title="No active medications" />
        : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {active.map((m) => <MedCard key={m.id} med={m} onEdit={() => setEditing(m)} onDiscontinue={(reason) => discontinue(m, reason)} />)}
        </div>
      )}
      {tab === "historical" && (
        historical.length === 0 ? <EmptyState icon="📜" title="No discontinued medications" />
        : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {historical.map((m) => <MedCard key={m.id} med={m} onEdit={() => setEditing(m)} historical />)}
        </div>
      )}
      {tab === "timeline" && <MedicationTimeline meds={meds} />}

      {(adding || editing) && (
        <MedForm
          initial={editing || { name: "", dose: "", route: "PO", frequency: "Daily", status: "Active", is_controlled: false }}
          providers={providers}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSave={save}
        />
      )}
    </div>
  );
}

const pillStyle = (active) => ({
  padding: "5px 12px", borderRadius: 999,
  border: `0.5px solid ${active ? C.teal : C.borderMid}`,
  background: active ? C.tealBg : "transparent",
  color: active ? C.teal : C.textSecondary,
  fontSize: 12, fontWeight: active ? 600 : 400, cursor: "pointer", fontFamily: "inherit",
});

function MedCard({ med, onEdit, onDiscontinue, historical }) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <Card style={{ padding: 14, opacity: historical ? 0.8 : 1, borderLeft: med.is_controlled ? `3px solid #A32D2D` : (historical ? `3px solid ${C.textTertiary}` : `3px solid ${C.teal}`) }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{med.name}</span>
            {med.generic_name && med.generic_name !== med.name && (
              <span style={{ fontSize: 11, color: C.textTertiary }}>({med.generic_name})</span>
            )}
            <Badge label={med.status} variant={med.status === "Active" ? "green" : med.status === "Discontinued" ? "neutral" : "amber"} size="xs" />
            {med.is_controlled && <Badge label="Controlled" variant="red" size="xs" />}
          </div>
          <div style={{ fontSize: 12, color: C.textPrimary }}>
            <b>{med.dose}</b> {med.route} · {med.frequency}
          </div>
          {med.indication && (
            <div style={{ fontSize: 11, color: C.textSecondary, marginTop: 2 }}>
              For: {med.indication}{med.indication_icd10 && ` (${med.indication_icd10})`}
            </div>
          )}
          <div style={{ fontSize: 10, color: C.textTertiary, marginTop: 6 }}>
            {med.start_date && `Started ${med.start_date}`}
            {med.end_date && ` · Ended ${med.end_date}`}
            {med.prov && ` · Rx'd by Dr. ${med.prov.last_name}`}
          </div>
          {med.reason_stopped && (
            <div style={{ fontSize: 11, color: C.textSecondary, marginTop: 6, fontStyle: "italic" }}>
              Stopped: {med.reason_stopped}
            </div>
          )}
          {med.notes && (
            <div style={{ fontSize: 11, color: C.textSecondary, marginTop: 6, padding: 8, background: C.bgSecondary, borderRadius: 4 }}>
              {med.notes}
            </div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Btn size="sm" variant="outline" onClick={onEdit}>Edit</Btn>
          {!historical && onDiscontinue && !confirming && (
            <Btn size="sm" variant="ghost" onClick={() => setConfirming(true)}>Stop</Btn>
          )}
        </div>
      </div>
      {confirming && (
        <div style={{ marginTop: 10, padding: 10, background: C.amberBg, borderRadius: 6 }}>
          <FL>Reason for discontinuing *</FL>
          <Input value={reason} onChange={setReason} placeholder="e.g. Side effect: cough, dose change, goal achieved" />
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 8 }}>
            <Btn size="sm" variant="outline" onClick={() => { setConfirming(false); setReason(""); }}>Cancel</Btn>
            <Btn size="sm" onClick={() => reason.trim() && onDiscontinue(reason)}>Discontinue</Btn>
          </div>
        </div>
      )}
    </Card>
  );
}

function MedicationTimeline({ meds }) {
  if (meds.length === 0) return <EmptyState title="No medications to chart" />;

  // Compute date range
  const dates = meds.flatMap((m) => [m.start_date, m.end_date]).filter(Boolean).map((d) => new Date(d).getTime());
  if (dates.length === 0) return <EmptyState title="No start dates on medications" />;

  const min = Math.min(...dates);
  const max = Math.max(...dates, Date.now());
  const range = max - min || 1;

  const xPct = (dateStr) => {
    if (!dateStr) return 100;
    const t = new Date(dateStr).getTime();
    return ((t - min) / range) * 100;
  };

  const years = [];
  const startY = new Date(min).getFullYear();
  const endY = new Date(max).getFullYear();
  for (let y = startY; y <= endY; y++) years.push(y);

  return (
    <div>
      <div style={{ padding: 14, background: C.bgPrimary, border: `0.5px solid ${C.borderLight}`, borderRadius: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.textTertiary, marginBottom: 4 }}>
          {years.map((y) => <span key={y}>{y}</span>)}
        </div>
        <div style={{ height: 1, background: C.borderLight, marginBottom: 16 }} />
        {meds.map((m) => {
          const start = xPct(m.start_date);
          const end = m.end_date ? xPct(m.end_date) : 100;
          return (
            <div key={m.id} style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 12, alignItems: "center", padding: "6px 0" }}>
              <div style={{ fontSize: 12 }}>
                <div style={{ fontWeight: 500 }}>{m.name}</div>
                <div style={{ fontSize: 10, color: C.textTertiary }}>{m.dose} {m.frequency}</div>
              </div>
              <div style={{ position: "relative", height: 10, background: C.bgSecondary, borderRadius: 4 }}>
                <div style={{
                  position: "absolute", left: `${start}%`, width: `${end - start}%`,
                  top: 0, height: 10, borderRadius: 4,
                  background: m.status === "Active" ? C.teal : C.textTertiary,
                  opacity: m.status === "Active" ? 1 : 0.5,
                }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MedForm({ initial, providers, onClose, onSave }) {
  const [f, setF] = useState(initial);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  return (
    <Modal title={initial.id ? "Edit Medication" : "Add Medication"} onClose={onClose} maxWidth={560}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Input label="Name (brand or generic) *" value={f.name} onChange={set("name")} />
        <Input label="Generic name" value={f.generic_name} onChange={set("generic_name")} />
        <Input label="Dose *" value={f.dose} onChange={set("dose")} placeholder="500 mg, 10 units, etc." />
        <Select label="Route" value={f.route} onChange={set("route")} options={ROUTES} />
        <Select label="Frequency" value={f.frequency} onChange={set("frequency")} options={FREQS} />
        <Select label="Status" value={f.status} onChange={set("status")} options={STATUSES} />
        <Input label="Indication" value={f.indication} onChange={set("indication")} placeholder="Hypertension, Type 2 DM..." />
        <Input label="ICD-10" value={f.indication_icd10} onChange={set("indication_icd10")} placeholder="I10, E11.9..." />
        <Input label="Start date" type="date" value={f.start_date} onChange={set("start_date")} />
        <Input label="End date" type="date" value={f.end_date} onChange={set("end_date")} />
        <Select label="Prescribed by" value={f.prescribed_by || ""} onChange={set("prescribed_by")}
          options={[{ value: "", label: "— Select —" }, ...providers.map((p) => ({ value: p.id, label: `Dr. ${p.first_name} ${p.last_name}` }))]} />
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 18 }}>
          <input type="checkbox" checked={!!f.is_controlled} onChange={(e) => set("is_controlled")(e.target.checked)} />
          <span style={{ fontSize: 12 }}>Controlled substance</span>
        </div>
      </div>
      {f.status !== "Active" && (
        <Input label="Reason stopped" value={f.reason_stopped} onChange={set("reason_stopped")} />
      )}
      <Textarea label="Notes" value={f.notes} onChange={set("notes")} rows={2} />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        <Btn onClick={() => f.name.trim() && f.dose.trim() && onSave(f)}>{initial.id ? "Save" : "Add"}</Btn>
      </div>
    </Modal>
  );
}
