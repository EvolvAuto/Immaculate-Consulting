// ═══════════════════════════════════════════════════════════════════════════════
// PatientsView — searchable list + detail modal (info, appts, encounters, ins)
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../auth/AuthProvider";
import { C } from "../lib/tokens";
import { insertRow, updateRow, logRead } from "../lib/db";
import { ageFromDOB, formatPhone, initialsOf, APPT_STATUS_VARIANT } from "../components/constants";
import { Badge, Btn, Card, Modal, Input, Select, TopBar, TabBar, FL, Avatar, SectionHead, Loader, ErrorBanner, EmptyState, InsuranceSelect } from "../components/ui";

const GENDERS = ["Male", "Female", "Non-Binary", "Other", "Unknown"];
const STATUSES = ["Active", "Inactive", "Deceased", "Merged"];
const PAGE = 25;

export default function PatientsView() {
  const { practiceId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [patients, setPatients] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("Active");
  const [viewing, setViewing] = useState(null);
  const [adding, setAdding] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      let query = supabase.from("patients")
        .select("*, pcp:providers!patients_pcp_provider_id_fkey(first_name, last_name)", { count: "exact" })
        .eq("status", status);
      if (q.trim()) {
        const t = q.trim();
        query = query.or(`first_name.ilike.%${t}%,last_name.ilike.%${t}%,mrn.ilike.%${t}%,phone_mobile.ilike.%${t}%`);
      }
      const { data, count, error } = await query.order("last_name").range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) throw error;
      setPatients(data || []);
      setTotal(count || 0);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (practiceId) load(); }, [practiceId, page, status]);
  useEffect(() => {
    const t = setTimeout(() => { setPage(0); if (practiceId) load(); }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const openDetail = async (p) => { await logRead("patients", p.id, p.id); setViewing(p); };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar title="Patients" sub={`${total} ${status.toLowerCase()}`}
        actions={<>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, MRN, phone..."
            style={{ padding: "6px 10px", border: `0.5px solid ${C.borderMid}`, borderRadius: 6, fontSize: 12, fontFamily: "inherit", width: 220 }} />
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}
            style={{ padding: "6px 10px", border: `0.5px solid ${C.borderMid}`, borderRadius: 6, fontSize: 12, fontFamily: "inherit" }}>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
          <Btn size="sm" onClick={() => setAdding(true)}>+ New Patient</Btn>
        </>} />

      <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
        {error && <ErrorBanner message={error} />}
        {loading ? <Loader /> : patients.length === 0 ? (
          <EmptyState icon="👤" title="No patients match" sub={q ? "Try a different search" : "Add your first patient to get started"}
            action={<Btn onClick={() => setAdding(true)}>+ New Patient</Btn>} />
        ) : (
          <Card style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "40px 1.5fr 1fr 1fr 1fr 1fr 80px", padding: "10px 14px", fontSize: 10, fontWeight: 700, color: C.textSecondary, textTransform: "uppercase", letterSpacing: "0.05em", background: C.bgSecondary, borderBottom: `0.5px solid ${C.borderLight}` }}>
              <div></div><div>Name</div><div>DOB / Age</div><div>Phone</div><div>MRN</div><div>PCP</div><div>Status</div>
            </div>
            {patients.map((p) => (
              <div key={p.id} onClick={() => openDetail(p)}
                style={{ display: "grid", gridTemplateColumns: "40px 1.5fr 1fr 1fr 1fr 1fr 80px", padding: "12px 14px", fontSize: 13, borderBottom: `0.5px solid ${C.borderLight}`, cursor: "pointer", alignItems: "center" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = C.bgSecondary)}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                <Avatar initials={initialsOf(p.first_name, p.last_name)} size={28} color={C.tealMid} />
                <div>
                  <div style={{ fontWeight: 600, color: C.textPrimary }}>{p.first_name} {p.last_name}</div>
                  {p.preferred_name && <div style={{ fontSize: 11, color: C.textTertiary }}>"{p.preferred_name}"</div>}
                </div>
                <div style={{ color: C.textSecondary }}>{p.date_of_birth} ({ageFromDOB(p.date_of_birth)})</div>
                <div style={{ color: C.textSecondary }}>{formatPhone(p.phone_mobile)}</div>
                <div style={{ color: C.textSecondary, fontFamily: "monospace", fontSize: 12 }}>{p.mrn || "—"}</div>
                <div style={{ color: C.textSecondary }}>{p.pcp ? `Dr. ${p.pcp.last_name}` : "—"}</div>
                <Badge label={p.status} variant={p.status === "Active" ? "green" : "neutral"} size="xs" />
              </div>
            ))}
          </Card>
        )}

        {total > PAGE && (
          <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 16 }}>
            <Btn variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← Prev</Btn>
            <div style={{ padding: "6px 12px", fontSize: 12, color: C.textSecondary }}>
              Page {page + 1} of {Math.ceil(total / PAGE)}
            </div>
            <Btn variant="ghost" size="sm" disabled={(page + 1) * PAGE >= total} onClick={() => setPage((p) => p + 1)}>Next →</Btn>
          </div>
        )}
      </div>

      {viewing && <PatientDetailModal patient={viewing} onClose={() => setViewing(null)} onUpdate={(u) => { setPatients((prev) => prev.map((p) => p.id === u.id ? { ...p, ...u } : p)); setViewing({ ...viewing, ...u }); }} />}
      {adding && <NewPatientModal onClose={() => setAdding(false)} practiceId={practiceId} onAdd={(p) => { setPatients((prev) => [p, ...prev]); setAdding(false); }} />}
    </div>
  );
}

// ─── Patient detail modal with tabs ───────────────────────────────────────────
function PatientDetailModal({ patient, onClose, onUpdate }) {
  const [tab, setTab] = useState("info");
  const [appts, setAppts] = useState([]);
  const [encounters, setEncounters] = useState([]);
  const [insurance, setInsurance] = useState([]);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from("appointments").select("id, appt_date, start_slot, appt_type, status, providers(last_name)").eq("patient_id", patient.id).order("appt_date", { ascending: false }).limit(30),
      supabase.from("encounters").select("id, encounter_date, status, appt_type, chief_complaint, assessment, provider_id, providers(first_name, last_name)").eq("patient_id", patient.id).order("encounter_date", { ascending: false }).limit(20),
      supabase.from("insurance_policies").select("*").eq("patient_id", patient.id).eq("is_active", true).order("rank"),
    ]).then(([a, e, i]) => {
      setAppts(a.data || []);
      setEncounters(e.data || []);
      setInsurance(i.data || []);
    });
  }, [patient.id]);

  return (
    <Modal title={`${patient.first_name} ${patient.last_name}`} onClose={onClose} maxWidth={760}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <Avatar initials={initialsOf(patient.first_name, patient.last_name)} size={48} color={C.tealMid} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{patient.first_name} {patient.last_name}</div>
          <div style={{ fontSize: 12, color: C.textSecondary }}>
            DOB {patient.date_of_birth} ({ageFromDOB(patient.date_of_birth)} y/o {patient.gender}) · MRN {patient.mrn || "—"}
          </div>
        </div>
        <Badge label={patient.status} variant={patient.status === "Active" ? "green" : "neutral"} />
      </div>

      <div style={{ marginBottom: 16 }}>
        <TabBar
          tabs={[["info", "Info"], ["appts", `Appts (${appts.length})`], ["encounters", `Notes (${encounters.length})`], ["clinical", "Clinical"], ["insurance", `Insurance (${insurance.length})`]]}
          active={tab} onChange={setTab} />
      </div>

      {tab === "info" && (
        editing ? <PatientEditForm patient={patient} onSave={async (patch) => {
          try {
            const u = await updateRow("patients", patient.id, patch, { audit: { entityType: "patients", patientId: patient.id, details: { fields: Object.keys(patch) } } });
            onUpdate(u); setEditing(false);
          } catch (e) { alert(e.message); }
        }} onCancel={() => setEditing(false)} />
        : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Field label="Mobile Phone" value={formatPhone(patient.phone_mobile)} />
            <Field label="Email" value={patient.email} />
            <Field label="Preferred Language" value={patient.preferred_language} />
            <Field label="Pronouns" value={patient.pronouns} />
            <Field label="Address" value={[patient.address_line1, patient.city, patient.state, patient.zip].filter(Boolean).join(", ")} span={2} />
            <Field label="Emergency Contact" value={patient.emergency_contact_name} />
            <Field label="Emergency Phone" value={formatPhone(patient.emergency_contact_phone)} />
            <Field label="SMS Opt-Out" value={patient.sms_opt_out ? "Yes" : "No"} />
            <Field label="Portal Enabled" value={patient.portal_enabled ? "Yes" : "No"} />
            <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
              <Btn variant="outline" onClick={() => setEditing(true)}>Edit Patient</Btn>
            </div>
          </div>
        )
      )}

      {tab === "appts" && (
        appts.length === 0 ? <EmptyState icon="📅" title="No appointment history" />
        : <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {appts.map((a) => (
            <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 10px", border: `0.5px solid ${C.borderLight}`, borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: C.textSecondary, minWidth: 100 }}>{a.appt_date}</div>
              <div style={{ flex: 1, fontSize: 12 }}>{a.appt_type}{a.providers && ` · Dr. ${a.providers.last_name}`}</div>
              <Badge label={a.status} variant={APPT_STATUS_VARIANT[a.status] || "neutral"} size="xs" />
            </div>
          ))}
        </div>
      )}

      {tab === "encounters" && (
        encounters.length === 0 ? <EmptyState icon="📝" title="No clinical notes" />
        : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {encounters.map((e) => (
            <Card key={e.id} style={{ padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>{e.encounter_date} · {e.appt_type}</div>
                <Badge label={e.status} variant={e.status === "Signed" ? "green" : e.status === "Amended" ? "amber" : "neutral"} size="xs" />
              </div>
              {e.chief_complaint && <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 4 }}><b>CC:</b> {e.chief_complaint}</div>}
              {e.assessment && <div style={{ fontSize: 12, color: C.textSecondary }}><b>A:</b> {e.assessment.slice(0, 180)}{e.assessment.length > 180 ? "…" : ""}</div>}
              {e.providers && <div style={{ fontSize: 10, color: C.textTertiary, marginTop: 6 }}>Dr. {e.providers.first_name} {e.providers.last_name}</div>}
            </Card>
          ))}
        </div>
      )}

      {tab === "clinical" && (
        <div>
          <SectionHead title="Allergies" />
          <div style={{ marginBottom: 16 }}>
            {(patient.allergies || []).length === 0 ? <div style={{ fontSize: 12, color: C.textTertiary }}>None on file</div>
              : (patient.allergies || []).map((a, i) => <Badge key={i} label={typeof a === "string" ? a : a.substance || a.name} variant="red" />)}
          </div>
          <SectionHead title="Active Medications" />
          <div style={{ marginBottom: 16 }}>
            {(patient.medications || []).length === 0 ? <div style={{ fontSize: 12, color: C.textTertiary }}>None on file</div>
              : (patient.medications || []).map((m, i) => (
                <div key={i} style={{ padding: "6px 10px", border: `0.5px solid ${C.borderLight}`, borderRadius: 6, marginBottom: 4, fontSize: 12 }}>
                  {typeof m === "string" ? m : `${m.name || m.drug} ${m.dose || ""} ${m.frequency || ""}`}
                </div>
              ))}
          </div>
          <SectionHead title="Problem List" />
          <div>
            {(patient.problem_list || []).length === 0 ? <div style={{ fontSize: 12, color: C.textTertiary }}>None on file</div>
              : (patient.problem_list || []).map((pr, i) => (
                <div key={i} style={{ padding: "6px 10px", border: `0.5px solid ${C.borderLight}`, borderRadius: 6, marginBottom: 4, fontSize: 12 }}>
                  {typeof pr === "string" ? pr : `${pr.code ? pr.code + " — " : ""}${pr.description || pr.name}`}
                </div>
              ))}
          </div>
        </div>
      )}

      {tab === "insurance" && (
        insurance.length === 0 ? <EmptyState icon="💳" title="No active insurance" />
        : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {insurance.map((p) => (
            <Card key={p.id} style={{ padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{p.payer_name}</div>
                <Badge label={`Rank ${p.rank}`} variant="teal" size="xs" />
              </div>
              <div style={{ fontSize: 11, color: C.textTertiary, marginBottom: 4 }}>{p.payer_category}</div>
              <div style={{ fontSize: 12, color: C.textSecondary }}>Member ID: <code>{p.member_id}</code>{p.group_number && ` · Group: ${p.group_number}`}</div>
              {p.copay_primary && <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 4 }}>Copay: ${p.copay_primary}</div>}
            </Card>
          ))}
        </div>
      )}
    </Modal>
  );
}

const Field = ({ label, value, span = 1 }) => (
  <div style={{ gridColumn: `span ${span}` }}>
    <FL>{label}</FL>
    <div style={{ fontSize: 13, color: value ? C.textPrimary : C.textTertiary }}>{value || "—"}</div>
  </div>
);

function PatientEditForm({ patient, onSave, onCancel }) {
  const [f, setF] = useState({ ...patient });
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Input label="First Name" value={f.first_name} onChange={set("first_name")} />
        <Input label="Last Name" value={f.last_name} onChange={set("last_name")} />
        <Input label="Preferred Name" value={f.preferred_name} onChange={set("preferred_name")} />
        <Input label="DOB" type="date" value={f.date_of_birth} onChange={set("date_of_birth")} />
        <Select label="Gender" value={f.gender} onChange={set("gender")} options={GENDERS} />
        <Input label="Pronouns" value={f.pronouns} onChange={set("pronouns")} />
        <Input label="Mobile" value={f.phone_mobile} onChange={set("phone_mobile")} />
        <Input label="Email" value={f.email} onChange={set("email")} />
        <Input label="Address" value={f.address_line1} onChange={set("address_line1")} style={{ gridColumn: "1 / -1" }} />
        <Input label="City" value={f.city} onChange={set("city")} />
        <Input label="State" value={f.state} onChange={set("state")} />
        <Input label="ZIP" value={f.zip} onChange={set("zip")} />
        <Input label="MRN" value={f.mrn} onChange={set("mrn")} />
        <Input label="Emergency Contact" value={f.emergency_contact_name} onChange={set("emergency_contact_name")} />
        <Input label="Emergency Phone" value={f.emergency_contact_phone} onChange={set("emergency_contact_phone")} />
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
        <Btn variant="outline" onClick={onCancel}>Cancel</Btn>
        <Btn onClick={() => onSave({
          first_name: f.first_name, last_name: f.last_name, preferred_name: f.preferred_name,
          date_of_birth: f.date_of_birth, gender: f.gender, pronouns: f.pronouns,
          phone_mobile: f.phone_mobile, email: f.email,
          address_line1: f.address_line1, city: f.city, state: f.state, zip: f.zip,
          mrn: f.mrn, emergency_contact_name: f.emergency_contact_name, emergency_contact_phone: f.emergency_contact_phone,
        })}>Save Changes</Btn>
      </div>
    </div>
  );
}

function NewPatientModal({ onClose, onAdd, practiceId }) {
  const [f, setF] = useState({ first_name: "", last_name: "", date_of_birth: "", gender: "Unknown", phone_mobile: "", email: "", mrn: "" });
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!f.first_name || !f.last_name || !f.date_of_birth) { alert("Name and DOB required"); return; }
    try {
      setSaving(true);
      const row = await insertRow("patients", { ...f, status: "Active", mrn: f.mrn || null }, practiceId,
        { audit: { entityType: "patients", patientId: null, details: { first_name: f.first_name, last_name: f.last_name } } });
      onAdd(row);
    } catch (e) { alert(e.message); setSaving(false); }
  };
  return (
    <Modal title="New Patient" onClose={onClose} maxWidth={520}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Input label="First Name *" value={f.first_name} onChange={set("first_name")} />
        <Input label="Last Name *" value={f.last_name} onChange={set("last_name")} />
        <Input label="DOB *" type="date" value={f.date_of_birth} onChange={set("date_of_birth")} />
        <Select label="Gender" value={f.gender} onChange={set("gender")} options={GENDERS} />
        <Input label="Mobile" value={f.phone_mobile} onChange={set("phone_mobile")} />
        <Input label="Email" value={f.email} onChange={set("email")} />
        <Input label="MRN (optional)" value={f.mrn} onChange={set("mrn")} style={{ gridColumn: "1 / -1" }} />
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        <Btn onClick={save} disabled={saving}>{saving ? "Creating..." : "Create Patient"}</Btn>
      </div>
    </Modal>
  );
}
