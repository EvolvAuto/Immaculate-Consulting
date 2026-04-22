// ═══════════════════════════════════════════════════════════════════════════════
// PatientsView - searchable list.
// Filter state lives in URL query params (useSearchParams) so that navigating
// into a chart and clicking Back restores the exact filters/search/page the
// user had. This also makes filtered lists URL-shareable.
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../auth/AuthProvider";
import { C } from "../lib/tokens";
import { insertRow } from "../lib/db";
import { ageFromDOB, formatPhone, initialsOf } from "../components/constants";
import { Badge, Btn, Card, Modal, Input, Select, TopBar, Avatar, Loader, ErrorBanner, EmptyState } from "../components/ui";

const GENDERS = ["Male", "Female", "Non-Binary", "Other", "Unknown"];
const STATUSES = ["Active", "Inactive", "Deceased", "Merged"];
const PAYER_CATEGORIES = ["NC Medicaid - Standard", "NC Medicaid - Tailored", "NC Medicaid - Other", "Medicare", "Commercial", "Other"];
const PAGE = 25;

export default function PatientsView() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { practiceId } = useAuth();

  // URL-backed filter state. All defaults kept out of URL for clean sharing.
  const status      = searchParams.get("status") || "Active";
  const payerFilter = searchParams.get("payer")  || "all";
  const pcpFilter   = searchParams.get("pcp")    || "all";
  const sortBy      = searchParams.get("sort")   || "last_name";
  const page        = parseInt(searchParams.get("page") || "0", 10);
  const qParam      = searchParams.get("q")      || "";

  // Local state for the search input - debounced into URL so typing doesn't
  // spam history entries. Synced from URL on mount (and when URL changes
  // externally, e.g. browser back).
  const [qInput, setQInput] = useState(qParam);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [patients, setPatients] = useState([]);
  const [total, setTotal] = useState(0);
  const [providers, setProviders] = useState([]);
  const [adding, setAdding] = useState(false);

  // Helper: update multiple URL params at once, replace (don't push) history.
  // Values equal to defaults ("", "all", or "0" for page) are stripped from
  // the URL for cleanliness.
  const updateParams = (updates) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      Object.entries(updates).forEach(([k, v]) => {
        const isDefault = !v || v === "all" || (k === "page" && v === "0");
        if (isDefault) next.delete(k);
        else next.set(k, v);
      });
      return next;
    }, { replace: true });
  };

  // Load providers once
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

      if (qParam.trim()) {
        const t = qParam.trim();
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

  // Reload when any URL-backed filter changes
  useEffect(() => { if (practiceId) load(); }, [practiceId, page, status, payerFilter, pcpFilter, sortBy, qParam]);

  // Debounced: sync search input into URL after typing settles
  useEffect(() => {
    if (qInput === qParam) return;
    const t = setTimeout(() => {
      updateParams({ q: qInput, page: "0" });
    }, 250);
    return () => clearTimeout(t);
  }, [qInput]);

  // External URL change (e.g., browser back restores filters) - re-sync input
  useEffect(() => { setQInput(qParam); }, [qParam]);

  // Pass current URL in state so the chart's Back button can return here with
  // all filters/search/page intact. Deep-link entries arrive without this
  // state, in which case Back falls back to a clean /patients.
  const openDetail = (p) => {
    navigate(`/patients/${p.id}/info`, {
      state: { returnTo: location.pathname + location.search }
    });
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar title="Patients" sub={`${total} ${status.toLowerCase()}`}
        actions={<>
          <input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Search name, MRN, phone..."
            style={{ padding: "6px 10px", border: `0.5px solid ${C.borderMid}`, borderRadius: 6, fontSize: 12, fontFamily: "inherit", width: 220 }} />
          <select value={status} onChange={(e) => updateParams({ status: e.target.value, page: "0" })}
            style={{ padding: "6px 10px", border: `0.5px solid ${C.borderMid}`, borderRadius: 6, fontSize: 12, fontFamily: "inherit" }}>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
          <select value={payerFilter} onChange={(e) => updateParams({ payer: e.target.value, page: "0" })}
            style={{ padding: "6px 10px", border: `0.5px solid ${C.borderMid}`, borderRadius: 6, fontSize: 12, fontFamily: "inherit" }}>
            <option value="all">All insurance</option>
            {PAYER_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={pcpFilter} onChange={(e) => updateParams({ pcp: e.target.value, page: "0" })}
            style={{ padding: "6px 10px", border: `0.5px solid ${C.borderMid}`, borderRadius: 6, fontSize: 12, fontFamily: "inherit" }}>
            <option value="all">All PCPs</option>
            {providers.map((p) => <option key={p.id} value={p.id}>Dr. {p.last_name}</option>)}
          </select>
          <select value={sortBy} onChange={(e) => updateParams({ sort: e.target.value })}
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
          <EmptyState icon="👤" title="No patients match" sub={qParam || payerFilter !== "all" || pcpFilter !== "all" ? "Try adjusting your filters" : "Add your first patient to get started"}
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
            <Btn variant="ghost" size="sm" disabled={page === 0} onClick={() => updateParams({ page: String(page - 1) })}>← Prev</Btn>
            <div style={{ padding: "6px 12px", fontSize: 12, color: C.textSecondary }}>Page {page + 1} of {Math.ceil(total / PAGE)}</div>
            <Btn variant="ghost" size="sm" disabled={(page + 1) * PAGE >= total} onClick={() => updateParams({ page: String(page + 1) })}>Next →</Btn>
          </div>
        )}
      </div>

      {adding && <NewPatientModal onClose={() => setAdding(false)} practiceId={practiceId} onAdd={() => { load(); setAdding(false); }} />}
    </div>
  );
}

// ─── New-patient modal (list-level) ──────────────────────────────────────────
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
