// ═══════════════════════════════════════════════════════════════════════════════
// PatientsView — searchable list + detail modal
// UPDATES: NC insurance editing, SDOH/screener display, insurance filter,
//          payer-category filter, PCP filter, sort controls
// ═══════════════════════════════════════════════════════════════════════════════

import TrendsTab from "./patient/TrendsTab";
import MedicationsTab from "./patient/MedicationsTab";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../auth/AuthProvider";
import { C } from "../lib/tokens";
import PatientPortalInviteButton from "./patient/PatientPortalInviteButton";
import InvitePatientModal from "./InvitePatientModal";
import AssignFormsModal from "./AssignFormsModal";
import GrantFamilyAccessModal from "./GrantFamilyAccessModal";
import { insertRow, updateRow, logRead } from "../lib/db";
import { ageFromDOB, formatPhone, initialsOf, APPT_STATUS_VARIANT, NC_PAYERS } from "../components/constants";
import { Badge, Btn, Card, Modal, Input, Select, TopBar, TabBar, FL, Avatar, SectionHead, Loader, ErrorBanner, EmptyState, Textarea } from "../components/ui";

const GENDERS = ["Male", "Female", "Non-Binary", "Other", "Unknown"];
const STATUSES = ["Active", "Inactive", "Deceased", "Merged"];
const PAYER_CATEGORIES = ["NC Medicaid - Standard", "NC Medicaid - Tailored", "NC Medicaid - Other", "Medicare", "Commercial", "Other"];
const SCREENER_SEVERITY_COLORS = {
  "Minimal": C.green, "Mild": C.blue, "Moderate": C.amber,
  "Moderately Severe": "#f59e0b", "Severe": C.red,
  "Low Risk": C.green, "Moderate Risk": C.amber, "High Risk": C.red,
};
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
  const [payerFilter, setPayerFilter] = useState("all");
  const [pcpFilter, setPcpFilter] = useState("all");
  const [sortBy, setSortBy] = useState("last_name");
  const [providers, setProviders] = useState([]);
  const [viewing, setViewing] = useState(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!practiceId) return;
    supabase.from("providers").select("id, first_name, last_name").eq("is_active", true).order("last_name")
      .then(({ data }) => setProviders(data || []));
  }, [practiceId]);

  const load = async () => {
    try {
      setLoading(true);

      // If filtering by payer category, we need to pre-resolve patient IDs
      let patientIdsFromInsurance = null;
      if (payerFilter !== "all") {
        const { data: policies } = await supabase.from("insurance_policies")
          .select("patient_id").eq("payer_category", payerFilter).eq("is_active", true);
        patientIdsFromInsurance = (policies || []).map((p) => p.patient_id);
        if (patientIdsFromInsurance.length === 0) {
          setPatients([]); setTotal(0); setLoading(false); return;
        }
      }

      let query = supabase.from("patients")
        .select("*, pcp:providers!patients_pcp_provider_id_fkey(first_name, last_name), insurance_policies(payer_category, payer_name, rank, is_active)", { count: "exact" })
        .eq("status", status);

      if (q.trim()) {
        const t = q.trim();
        query = query.or(`first_name.ilike.%${t}%,last_name.ilike.%${t}%,mrn.ilike.%${t}%,phone_mobile.ilike.%${t}%`);
      }
      if (patientIdsFromInsurance) query = query.in("id", patientIdsFromInsurance);
      if (pcpFilter !== "all") query = query.eq("pcp_provider_id", pcpFilter);

      const { data, count, error } = await query.order(sortBy).range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) throw error;
      setPatients(data || []);
      setTotal(count || 0);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (practiceId) load(); }, [practiceId, page, status, payerFilter, pcpFilter, sortBy]);
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
          <select value={payerFilter} onChange={(e) => { setPayerFilter(e.target.value); setPage(0); }}
            style={{ padding: "6px 10px", border: `0.5px solid ${C.borderMid}`, borderRadius: 6, fontSize: 12, fontFamily: "inherit" }}>
            <option value="all">All insurance</option>
            {PAYER_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={pcpFilter} onChange={(e) => { setPcpFilter(e.target.value); setPage(0); }}
            style={{ padding: "6px 10px", border: `0.5px solid ${C.borderMid}`, borderRadius: 6, fontSize: 12, fontFamily: "inherit" }}>
            <option value="all">All PCPs</option>
            {providers.map((p) => <option key={p.id} value={p.id}>Dr. {p.last_name}</option>)}
          </select>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}
            style={{ padding: "6px 10px", border: `0.5px solid ${C.borderMid}`, borderRadius: 6, fontSize: 12, fontFamily: "inherit" }}>
            <option value="last_name">Sort: Last name</option>
            <option value="first_name">Sort: First name</option>
            <option value="date_of_birth">Sort: DOB</option>
            <option value="created_at">Sort: Recent</option>
          </select>
          <Btn size="sm" onClick={() => setAdding(true)}>+ New Patient</Btn>
        </>} />

      <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
        {error && <ErrorBanner message={error} />}
        {loading ? <Loader /> : patients.length === 0 ? (
          <EmptyState icon="👤" title="No patients match" sub={q || payerFilter !== "all" || pcpFilter !== "all" ? "Try adjusting your filters" : "Add your first patient to get started"}
            action={<Btn onClick={() => setAdding(true)}>+ New Patient</Btn>} />
        ) : (
          <Card style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "40px 1.4fr 1fr 1fr 1fr 1.2fr 80px", padding: "10px 14px", fontSize: 10, fontWeight: 700, color: C.textSecondary, textTransform: "uppercase", letterSpacing: "0.05em", background: C.bgSecondary, borderBottom: `0.5px solid ${C.borderLight}` }}>
              <div></div><div>Name</div><div>DOB / Age</div><div>Phone</div><div>PCP</div><div>Primary Insurance</div><div>Status</div>
            </div>
            {patients.map((p) => {
              const primary = (p.insurance_policies || []).find((x) => x.rank === 1 && x.is_active);
              return (
                <div key={p.id} onClick={() => openDetail(p)}
                  style={{ display: "grid", gridTemplateColumns: "40px 1.4fr 1fr 1fr 1fr 1.2fr 80px", padding: "12px 14px", fontSize: 13, borderBottom: `0.5px solid ${C.borderLight}`, cursor: "pointer", alignItems: "center" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = C.bgSecondary)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                  <Avatar initials={initialsOf(p.first_name, p.last_name)} size={28} color={C.tealMid} />
                  <div>
                    <div style={{ fontWeight: 600, color: C.textPrimary }}>{p.first_name} {p.last_name}</div>
                    <div style={{ fontSize: 11, color: C.textTertiary, fontFamily: "monospace" }}>MRN {p.mrn || "—"}</div>
                  </div>
                  <div style={{ color: C.textSecondary }}>{p.date_of_birth} ({ageFromDOB(p.date_of_birth)})</div>
                  <div style={{ color: C.textSecondary }}>{formatPhone(p.phone_mobile)}</div>
                  <div style={{ color: C.textSecondary }}>{p.pcp ? `Dr. ${p.pcp.last_name}` : "—"}</div>
                  <div>
                    {primary ? (
                      <>
                        <div style={{ fontSize: 12, color: C.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{primary.payer_name}</div>
                        <div style={{ fontSize: 10, color: C.textTertiary }}>{primary.payer_category}</div>
                      </>
                    ) : <span style={{ color: C.textTertiary, fontSize: 12 }}>None</span>}
                  </div>
                  <Badge label={p.status} variant={p.status === "Active" ? "green" : "neutral"} size="xs" />
                </div>
              );
            })}
          </Card>
        )}

        {total > PAGE && (
          <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 16 }}>
            <Btn variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← Prev</Btn>
            <div style={{ padding: "6px 12px", fontSize: 12, color: C.textSecondary }}>Page {page + 1} of {Math.ceil(total / PAGE)}</div>
            <Btn variant="ghost" size="sm" disabled={(page + 1) * PAGE >= total} onClick={() => setPage((p) => p + 1)}>Next →</Btn>
          </div>
        )}
      </div>

      {viewing && <PatientDetailModal patient={viewing} practiceId={practiceId}
        onClose={() => setViewing(null)}
        onUpdate={(u) => { setPatients((prev) => prev.map((p) => p.id === u.id ? { ...p, ...u } : p)); setViewing({ ...viewing, ...u }); load(); }} />}
      {adding && <NewPatientModal onClose={() => setAdding(false)} practiceId={practiceId} onAdd={(p) => { load(); setAdding(false); }} />}
    </div>
  );
}

// ─── Detail modal with tabs ───────────────────────────────────────────────────
function PatientDetailModal({ patient, practiceId, onClose, onUpdate }) {
  const [tab, setTab] = useState("info");
  const [appts, setAppts] = useState([]);
  const [encounters, setEncounters] = useState([]);
  const [insurance, setInsurance] = useState([]);
 const [screeners, setScreeners] = useState([]);
  const [editing, setEditing] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showAssignForms, setShowAssignForms] = useState(false);
  const [showGrantAccess, setShowGrantAccess] = useState(false);

  const reload = async () => {
    const [a, e, i, s] = await Promise.all([
      supabase.from("appointments").select("id, appt_date, start_slot, appt_type, status, providers(last_name)").eq("patient_id", patient.id).order("appt_date", { ascending: false }).limit(30),
      supabase.from("encounters").select("id, encounter_date, status, appt_type, chief_complaint, assessment, provider_id, providers(first_name, last_name)").eq("patient_id", patient.id).order("encounter_date", { ascending: false }).limit(20),
      supabase.from("insurance_policies").select("*").eq("patient_id", patient.id).order("rank"),
      supabase.from("screener_responses").select("*").eq("patient_id", patient.id).order("completed_at", { ascending: false }).limit(20),
    ]);
    setAppts(a.data || []);
    setEncounters(e.data || []);
    setInsurance(i.data || []);
    setScreeners(s.data || []);
  };
  useEffect(() => { reload(); }, [patient.id]);

  const activeInsurance = insurance.filter((i) => i.is_active);
  const hrsnScreener = screeners.find((s) => s.screener_type === "HRSN");
  const mentalHealthScreeners = screeners.filter((s) => ["PHQ-9", "PHQ-2", "GAD-7", "AUDIT-C"].includes(s.screener_type));

  return (
    <Modal title={`${patient.first_name} ${patient.last_name}`} onClose={onClose} maxWidth={820}>
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
  tabs={[
    ["info", "Info"],
    ["appts", `Appts (${appts.length})`],
    ["notes", `Notes (${encounters.length})`],
    ["trends", "Trends"],
    ["meds", "Medications"],
    ["screening", "SDOH"],
    ["clinical", "Clinical"],
    ["insurance", `Insurance (${insurance.length})`],
  ]}
  active={tab} onChange={setTab} />
      </div>

      {tab === "info" && (
        editing
          ? <PatientEditForm patient={patient} onSave={async (patch) => {
              try {
                const u = await updateRow("patients", patient.id, patch,
                  { audit: { entityType: "patients", patientId: patient.id, details: { fields: Object.keys(patch) } } });
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
              <Field label="County" value={patient.county} />
              <Field label="Interpreter Needed" value={patient.interpreter_needed ? "Yes" : "No"} />
              <Field label="Emergency Contact" value={patient.emergency_contact_name} />
              <Field label="Emergency Phone" value={formatPhone(patient.emergency_contact_phone)} />
              <Field label="SMS Opt-Out" value={patient.sms_opt_out ? "Yes" : "No"} />
              <Field label="Portal Enabled" value={patient.portal_enabled ? "Yes" : "No"} />
             <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <Btn variant="outline" onClick={() => setShowGrantAccess(true)}>Grant family access</Btn>
                <Btn variant="outline" onClick={() => setShowAssignForms(true)}>Assign forms</Btn>
                <Btn variant="outline" onClick={() => setShowInvite(true)}>Invite to portal</Btn>
                <Btn variant="outline" onClick={() => setEditing(true)}>Edit patient</Btn>
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

      {tab === "notes" && (
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
        <InsuranceTab patient={patient} insurance={insurance} practiceId={practiceId} onReload={reload} />
      )}

      {tab === "sdoh" && (
        <SDOHTab hrsn={hrsnScreener} mental={mentalHealthScreeners} />
      )}
      {tab === "trends" && <TrendsTab patient={patient} />}

{tab === "meds" && <MedicationsTab patient={patient} />}

      {showInvite && (
        <InvitePatientModal
          patient={patient}
          practiceId={practiceId}
          onClose={() => setShowInvite(false)}
        />
      )}
     {showAssignForms && (
        <AssignFormsModal
          patient={patient}
          practiceId={practiceId}
          onClose={() => setShowAssignForms(false)}
        />
      )}
      {showGrantAccess && (
        <GrantFamilyAccessModal
          patient={patient}
          onClose={() => setShowGrantAccess(false)}
        />
      )}
    </Modal>
  );
}

// ─── SDOH tab ─────────────────────────────────────────────────────────────────
function SDOHTab({ hrsn, mental }) {
  if (!hrsn && mental.length === 0) {
    return <EmptyState icon="📋" title="No screeners on file" sub="HRSN / PHQ-9 / GAD-7 / AUDIT-C screeners will appear here once completed." />;
  }
  return (
    <div>
      {hrsn && (
        <>
          <SectionHead title="HRSN (Health-Related Social Needs)" sub={`Completed ${new Date(hrsn.completed_at).toLocaleDateString()}`} />
          <Card style={{ marginBottom: 16, borderLeft: `4px solid ${SCREENER_SEVERITY_COLORS[hrsn.severity] || C.textSecondary}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
              <Badge label={hrsn.severity || "—"} variant="teal" />
              {hrsn.requires_followup && <Badge label="Follow-up required" variant="amber" size="xs" />}
              <div style={{ marginLeft: "auto", fontSize: 11, color: C.textTertiary }}>via {hrsn.administered_via}</div>
            </div>
            {Array.isArray(hrsn.flags) && hrsn.flags.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.textSecondary, textTransform: "uppercase", marginBottom: 6 }}>Flagged needs</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {hrsn.flags.map((f, i) => <Badge key={i} label={typeof f === "string" ? f : (f.domain || f.name)} variant="amber" size="xs" />)}
                </div>
              </div>
            )}
            {hrsn.responses && typeof hrsn.responses === "object" && (
              <details style={{ fontSize: 12, color: C.textSecondary }}>
                <summary style={{ cursor: "pointer", fontWeight: 600 }}>View responses</summary>
                <pre style={{ marginTop: 8, background: C.bgSecondary, padding: 10, borderRadius: 6, fontSize: 11, overflow: "auto" }}>
                  {JSON.stringify(hrsn.responses, null, 2)}
                </pre>
              </details>
            )}
          </Card>
        </>
      )}

      {mental.length > 0 && (
        <>
          <SectionHead title="Mental Health Screeners" />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {mental.map((s) => (
              <Card key={s.id} style={{ padding: 12, borderLeft: `3px solid ${SCREENER_SEVERITY_COLORS[s.severity] || C.textSecondary}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{s.screener_type}</div>
                  <Badge label={`Score: ${s.total_score ?? "—"}`} variant="teal" size="xs" />
                  {s.severity && <Badge label={s.severity} variant={s.severity === "Severe" || s.severity === "Moderately Severe" ? "red" : s.severity === "Moderate" ? "amber" : "neutral"} size="xs" />}
                  {s.requires_followup && <Badge label="Follow-up" variant="amber" size="xs" />}
                  <div style={{ marginLeft: "auto", fontSize: 11, color: C.textTertiary }}>{new Date(s.completed_at).toLocaleDateString()}</div>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Insurance tab with NC payer selector ────────────────────────────────────
function InsuranceTab({ patient, insurance, practiceId, onReload }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);

  const deactivate = async (id) => {
    if (!confirm("Remove this insurance policy?")) return;
    try {
      await updateRow("insurance_policies", id, { is_active: false },
        { audit: { entityType: "insurance_policies", patientId: patient.id } });
      onReload();
    } catch (e) { alert(e.message); }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <SectionHead title="Insurance Policies" />
        <Btn size="sm" onClick={() => setAdding(true)}>+ Add Policy</Btn>
      </div>
      {insurance.length === 0 ? <EmptyState icon="💳" title="No insurance on file" />
        : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {insurance.map((p) => (
            <Card key={p.id} style={{ padding: 12, opacity: p.is_active ? 1 : 0.55 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{p.payer_name}</div>
                    <Badge label={`Rank ${p.rank}`} variant="teal" size="xs" />
                    {!p.is_active && <Badge label="Inactive" variant="neutral" size="xs" />}
                  </div>
                  <div style={{ fontSize: 11, color: C.textTertiary, marginBottom: 4 }}>{p.payer_category}</div>
                  <div style={{ fontSize: 12, color: C.textSecondary }}>
                    Member ID: <code>{p.member_id}</code>{p.group_number && ` · Group: ${p.group_number}`}
                  </div>
                  {p.copay_primary != null && <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 4 }}>Copay: ${p.copay_primary}</div>}
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  <Btn size="sm" variant="outline" onClick={() => setEditing(p)}>Edit</Btn>
                  {p.is_active && <Btn size="sm" variant="ghost" onClick={() => deactivate(p.id)}>Remove</Btn>}
                </div>
              </div>
            </Card>
          ))}
        </div>}

      {(adding || editing) && <InsuranceFormModal
        initial={editing || { rank: (insurance.length + 1), is_active: true }}
        patientId={patient.id} practiceId={practiceId}
        onClose={() => { setAdding(false); setEditing(null); }}
        onSaved={() => { setAdding(false); setEditing(null); onReload(); }} />}
    </div>
  );
}

// ─── Insurance form with NC payer dropdown ────────────────────────────────────
function InsuranceFormModal({ initial, patientId, practiceId, onClose, onSaved }) {
  const [f, setF] = useState(initial);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));

  const handlePayerSelect = (payerName) => {
    const group = NC_PAYERS.find((g) => g.options.includes(payerName));
    setF((p) => ({ ...p, payer_name: payerName, payer_category: group?.category || "Other" }));
  };

  const save = async () => {
    if (!f.payer_name || !f.member_id) { alert("Payer and Member ID are required"); return; }
    try {
      const payload = {
        patient_id: patientId,
        payer_name: f.payer_name,
        payer_category: f.payer_category,
        member_id: f.member_id,
        group_number: f.group_number || null,
        rank: parseInt(f.rank) || 1,
        copay_primary: f.copay_primary != null && f.copay_primary !== "" ? parseFloat(f.copay_primary) : null,
        is_active: f.is_active !== false,
        effective_date: f.effective_date || null,
        termination_date: f.termination_date || null,
      };
      if (f.id) {
        await updateRow("insurance_policies", f.id, payload,
          { audit: { entityType: "insurance_policies", patientId } });
      } else {
        await insertRow("insurance_policies", payload, practiceId,
          { audit: { entityType: "insurance_policies", patientId } });
      }
      onSaved();
    } catch (e) { alert(e.message); }
  };

  return (
    <Modal title={f.id ? "Edit Insurance" : "Add Insurance"} onClose={onClose} maxWidth={520}>
      <FL>Payer *</FL>
      <select
        value={f.payer_name || ""}
        onChange={(e) => handlePayerSelect(e.target.value)}
        style={{ width: "100%", padding: "9px 12px", border: `1px solid ${C.borderMid}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", marginBottom: 14 }}
      >
        <option value="">Select payer...</option>
        {NC_PAYERS.map((group) => (
          <optgroup key={group.group} label={group.group}>
            {group.options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          </optgroup>
        ))}
      </select>

      {f.payer_category && (
        <div style={{ marginTop: -8, marginBottom: 14 }}>
          <Badge label={f.payer_category} variant="teal" size="xs" />
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
        <Input label="Member ID *" value={f.member_id} onChange={set("member_id")} />
        <Input label="Rank" type="number" value={f.rank} onChange={set("rank")} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Input label="Group Number" value={f.group_number} onChange={set("group_number")} />
        <Input label="Copay" type="number" value={f.copay_primary} onChange={set("copay_primary")} placeholder="0.00" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Input label="Effective Date" type="date" value={f.effective_date} onChange={set("effective_date")} />
        <Input label="Termination Date" type="date" value={f.termination_date} onChange={set("termination_date")} />
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        <Btn onClick={save}>{f.id ? "Save" : "Add Policy"}</Btn>
      </div>
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
        <Input label="County" value={f.county} onChange={set("county")} />
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
          address_line1: f.address_line1, city: f.city, state: f.state, zip: f.zip, county: f.county,
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
