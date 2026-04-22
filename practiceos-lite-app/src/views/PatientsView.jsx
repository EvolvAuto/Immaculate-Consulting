// ═══════════════════════════════════════════════════════════════════════════════
// PatientsView — searchable list + detail modal
// Stage 1b: chart body extracted to PatientChartPage.jsx. This file now owns
// the list, filters, sort, pagination, and the new-patient modal. The detail
// modal is a thin wrapper that renders PatientChartPage inside a Modal, so
// user-visible behavior is identical to pre-1b. Stage 1c will remove the modal
// wrapper and route directly to PatientChartPage.
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../auth/AuthProvider";
import { C } from "../lib/tokens";
import { insertRow, logRead } from "../lib/db";
import { ageFromDOB, formatPhone, initialsOf } from "../components/constants";
import { Badge, Btn, Card, Modal, Input, Select, TopBar, Avatar, Loader, ErrorBanner, EmptyState } from "../components/ui";
import PatientChartPage from "./patient/PatientChartPage";

const GENDERS = ["Male", "Female", "Non-Binary", "Other", "Unknown"];
const STATUSES = ["Active", "Inactive", "Deceased", "Merged"];
const PAYER_CATEGORIES = ["NC Medicaid - Standard", "NC Medicaid - Tailored", "NC Medicaid - Other", "Medicare", "Commercial", "Other"];
const PAGE = 25;

export default function PatientsView() {
  const { practiceId, tier } = useAuth();
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

      {viewing && <PatientDetailModal patient={viewing} practiceId={practiceId} tier={tier}
        onClose={() => setViewing(null)}
        onUpdate={(u) => { setPatients((prev) => prev.map((p) => p.id === u.id ? { ...p, ...u } : p)); setViewing({ ...viewing, ...u }); load(); }} />}
      {adding && <NewPatientModal onClose={() => setAdding(false)} practiceId={practiceId} onAdd={(p) => { load(); setAdding(false); }} />}
    </div>
  );
}

// ─── Thin wrapper that renders the chart inside a Modal. ──────────────────────
// This exists for Stage 1b only. Stage 1c replaces this with a route that
// renders PatientChartPage directly as a full page.
function PatientDetailModal({ patient, practiceId, tier, onClose, onUpdate }) {
  return (
    <Modal title={`${patient.first_name} ${patient.last_name}`} onClose={onClose} maxWidth={820}>
      <PatientChartPage
        patient={patient}
        practiceId={practiceId}
        tier={tier}
        onUpdate={onUpdate}
      />
    </Modal>
  );
}

// ─── New-patient modal (list-level, stays here) ──────────────────────────────
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
