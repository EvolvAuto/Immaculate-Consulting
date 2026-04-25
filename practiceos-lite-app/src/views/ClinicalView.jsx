// ═══════════════════════════════════════════════════════════════════════════════
// ClinicalView — encounter list + editor with search and filters
// ═══════════════════════════════════════════════════════════════════════════════

import PanelQuickEntryStrip, { savePanelValues } from "./patient/PanelQuickEntryStrip";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../auth/AuthProvider";
import { C } from "../lib/tokens";
import { insertRow, updateRow } from "../lib/db";
import { ICD10_COMMON, CPT_COMMON, toISODate } from "../components/constants";
import { Badge, Btn, Card, Modal, Input, Textarea, Select, TopBar, TabBar, FL, SectionHead, Loader, ErrorBanner, EmptyState, CodeSearchModal } from "../components/ui";
import ScribeModal from "../components/ScribeModal";

const STATUSES = ["Draft", "In Progress", "Signed", "Amended"];

export default function ClinicalView() {
  const { practiceId, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [encounters, setEncounters] = useState([]);
  const [providers, setProviders] = useState([]);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);

  // Filters
  const [filter, setFilter] = useState("mine");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const load = async () => {
    try {
      setLoading(true);
      let q = supabase.from("encounters")
        .select("*, patients(id, first_name, last_name, date_of_birth), providers(id, first_name, last_name)")
        .order("encounter_date", { ascending: false }).order("created_at", { ascending: false });
      if (filter === "mine" && profile?.provider_id) q = q.eq("provider_id", profile.provider_id);
      if (filter === "drafts") q = q.in("status", ["Draft", "In Progress"]);
      if (dateFrom) q = q.gte("encounter_date", dateFrom);
      if (dateTo)   q = q.lte("encounter_date", dateTo);
      const { data, error } = await q.limit(200);
      if (error) throw error;
      setEncounters(data || []);

      if (providers.length === 0) {
        const { data: p } = await supabase.from("providers").select("id, first_name, last_name").eq("is_active", true).order("last_name");
        setProviders(p || []);
      }
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (practiceId) load(); }, [practiceId, filter, dateFrom, dateTo]);

  // Client-side filtering for quick text search + status + provider
  const displayed = useMemo(() => {
    const s = search.trim().toLowerCase();
    return encounters.filter((e) => {
      if (statusFilter && e.status !== statusFilter) return false;
      if (providerFilter && e.provider_id !== providerFilter) return false;
      if (!s) return true;
      const haystack = [
        e.patients?.first_name, e.patients?.last_name, e.chief_complaint,
        e.assessment, e.plan, e.appt_type,
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(s);
    });
  }, [encounters, search, statusFilter, providerFilter]);

  if (loading) return <div style={{ flex: 1 }}><TopBar title="Clinical" /><Loader /></div>;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar title="Clinical Notes" sub={`${displayed.length} of ${encounters.length} encounters`}
        actions={<>
          <TabBar tabs={[["mine", "My Notes"], ["drafts", "Drafts"], ["all", "All"]]} active={filter} onChange={setFilter} />
          <Btn size="sm" onClick={() => setCreating(true)}>+ New Encounter</Btn>
        </>} />

      <div style={{ padding: "12px 20px", background: C.bgSecondary, borderBottom: `0.5px solid ${C.borderLight}`, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search patient name, chief complaint, assessment..."
          style={{ flex: "1 1 260px", padding: "6px 10px", border: `0.5px solid ${C.borderMid}`, borderRadius: 6, fontSize: 12, fontFamily: "inherit", minWidth: 240 }} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          style={{ padding: "6px 10px", border: `0.5px solid ${C.borderMid}`, borderRadius: 6, fontSize: 12, fontFamily: "inherit" }}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)}
          style={{ padding: "6px 10px", border: `0.5px solid ${C.borderMid}`, borderRadius: 6, fontSize: 12, fontFamily: "inherit" }}>
          <option value="">All providers</option>
          {providers.map((p) => <option key={p.id} value={p.id}>Dr. {p.last_name}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} title="From"
          style={{ padding: "5px 8px", border: `0.5px solid ${C.borderMid}`, borderRadius: 6, fontSize: 12, fontFamily: "inherit" }} />
        <span style={{ fontSize: 11, color: C.textTertiary }}>→</span>
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} title="To"
          style={{ padding: "5px 8px", border: `0.5px solid ${C.borderMid}`, borderRadius: 6, fontSize: 12, fontFamily: "inherit" }} />
        {(search || statusFilter || providerFilter || dateFrom || dateTo) && (
          <Btn size="sm" variant="ghost" onClick={() => { setSearch(""); setStatusFilter(""); setProviderFilter(""); setDateFrom(""); setDateTo(""); }}>Clear</Btn>
        )}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
        {error && <ErrorBanner message={error} />}
        {displayed.length === 0 ? <EmptyState icon="📝" title="No encounters match" sub={search ? "Try a different search" : "Create a new encounter to document a visit."} />
          : <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 960, margin: "0 auto" }}>
            {displayed.map((e) => (
              <Card key={e.id} onClick={() => setEditing(e)} style={{ cursor: "pointer" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ fontSize: 12, color: C.textSecondary, minWidth: 100 }}>{e.encounter_date}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary }}>
                      {e.patients ? `${e.patients.first_name} ${e.patients.last_name}` : "(no patient)"}
                    </div>
                    <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>
                      {e.appt_type}{e.providers ? ` · Dr. ${e.providers.first_name} ${e.providers.last_name}` : ""}
                      {e.chief_complaint ? ` · ${e.chief_complaint}` : ""}
                    </div>
                  </div>
                  <Badge label={e.status} variant={e.status === "Signed" ? "green" : e.status === "Amended" ? "amber" : e.status === "Draft" ? "neutral" : "blue"} size="xs" />
                </div>
              </Card>
            ))}
          </div>}
      </div>

      {creating && <NewEncounterModal practiceId={practiceId} profile={profile} onClose={() => setCreating(false)} onCreated={(e) => { setEncounters((prev) => [e, ...prev]); setCreating(false); setEditing(e); }} />}
      {editing && <EncounterEditor encounter={editing} profile={profile} onClose={() => setEditing(null)}
        onSaved={(u) => { setEncounters((prev) => prev.map((x) => x.id === u.id ? { ...x, ...u } : x)); setEditing({ ...editing, ...u }); }} />}
    </div>
  );
}

// ─── New Encounter Modal ─────────────────────────────────────────────────────
function NewEncounterModal({ onClose, onCreated, practiceId, profile }) {
  const [patientQ, setPatientQ] = useState("");
  const [results, setResults] = useState([]);
  const [patient, setPatient] = useState(null);
  const [apptType, setApptType] = useState("Follow-up");
  const [chief, setChief] = useState("");
  const [apptTypes, setApptTypes] = useState([]);

  useEffect(() => {
    supabase.from("appointment_types").select("name").eq("is_active", true).order("sort_order")
      .then(({ data }) => setApptTypes((data || []).map((r) => r.name)));
  }, []);

  useEffect(() => {
    if (!patientQ || patientQ.length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.from("patients").select("id, first_name, last_name, date_of_birth")
        .or(`first_name.ilike.%${patientQ}%,last_name.ilike.%${patientQ}%`).eq("status", "Active").limit(8);
      setResults(data || []);
    }, 200);
    return () => clearTimeout(t);
  }, [patientQ]);

  const create = async () => {
    if (!patient) { alert("Select a patient"); return; }
    if (!profile?.provider_id) { alert("Your user must be linked to a provider to create encounters."); return; }
    try {
      const row = await insertRow("encounters", {
        patient_id: patient.id, provider_id: profile.provider_id,
        encounter_date: toISODate(), appt_type: apptType, status: "Draft",
        chief_complaint: chief || null, created_by: profile.id,
      }, practiceId, { audit: { entityType: "encounters", patientId: patient.id } });
      onCreated({ ...row, patients: patient, providers: { first_name: profile.full_name?.split(" ")[0], last_name: profile.full_name?.split(" ").slice(-1)[0] } });
    } catch (e) { alert(e.message); }
  };

  return (
    <Modal title="New Encounter" onClose={onClose} maxWidth={480}>
      {!patient ? <>
        <Input label="Patient" value={patientQ} onChange={setPatientQ} placeholder="Search name..." />
        {results.map((p) => (
          <div key={p.id} onClick={() => setPatient(p)} style={{ padding: "8px 12px", border: `0.5px solid ${C.borderLight}`, borderRadius: 8, fontSize: 12, cursor: "pointer", marginBottom: 4 }}>
            {p.first_name} {p.last_name} · DOB {p.date_of_birth}
          </div>
        ))}
      </> : (
        <div style={{ padding: "9px 12px", border: `1px solid ${C.tealBorder}`, borderRadius: 8, background: C.tealBg, marginBottom: 14, fontSize: 13, display: "flex", justifyContent: "space-between" }}>
          <div><b>{patient.first_name} {patient.last_name}</b> · DOB {patient.date_of_birth}</div>
          <button onClick={() => setPatient(null)} style={{ background: "none", border: "none", cursor: "pointer" }}>×</button>
        </div>
      )}
      <Select label="Encounter Type" value={apptType} onChange={setApptType}
        options={apptTypes.length > 0 ? apptTypes : ["Follow-up", "New Patient", "Annual Exam", "Procedure", "Telehealth", "Walk-in"]} />
      <Input label="Chief Complaint" value={chief} onChange={setChief} />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        <Btn onClick={create}>Create Draft</Btn>
      </div>
    </Modal>
  );
}

// ─── Encounter Editor (unchanged from prior version, SOAP + sign/amend) ──────
function EncounterEditor({ encounter, profile, onClose, onSaved }) {
  const [panelValues, setPanelValues] = useState({});
  const [patient, setPatient] = useState(null);

  useEffect(() => {
  if (!encounter?.patient_id) return;
  supabase.from("patients").select("*").eq("id", encounter.patient_id).single()
    .then(({ data }) => setPatient(data));
}, [encounter?.patient_id]);
  const [e, setE] = useState(encounter);
  const [codeModal, setCodeModal] = useState(null);
  const [scribeOpen, setScribeOpen] = useState(false);
  const [amending, setAmending] = useState(false);
  const [amendReason, setAmendReason] = useState("");
  const [saving, setSaving] = useState(false);

  const locked = e.status === "Signed" && !amending;
  const set = (k) => (v) => setE((p) => ({ ...p, [k]: v }));

  const addCode = (listKey, code) => {
    const list = Array.isArray(e[listKey]) ? e[listKey] : [];
    if (list.some((c) => c.code === code.code)) return;
    setE((p) => ({ ...p, [listKey]: [...list, code] }));
  };
  const removeCode = (listKey, codeStr) => {
    setE((p) => ({ ...p, [listKey]: (p[listKey] || []).filter((c) => c.code !== codeStr) }));
  };

  const saveDraft = async () => {
    try {
      setSaving(true);
      const patch = {
        chief_complaint: e.chief_complaint, subjective: e.subjective, objective: e.objective,
        assessment: e.assessment, plan: e.plan, diagnoses: e.diagnoses || [], cpt_codes: e.cpt_codes || [],
        em_level: e.em_level || null, vitals: e.vitals || {}, provider_notes: e.provider_notes || null,
      };
      const u = await updateRow("encounters", e.id, patch, { audit: { entityType: "encounters", patientId: e.patient_id } });

      if (Object.keys(panelValues).length > 0) {
        try {
          const [mRes, pRes] = await Promise.all([
            supabase.from("clinical_metrics").select("*"),
            supabase.from("clinical_panels").select("*"),
          ]);
          await savePanelValues({
            patientId: e.patient_id, practiceId: e.practice_id,
            encounterId: e.id, values: panelValues,
            metrics: mRes.data || [], panels: pRes.data || [],
            enteredBy: profile.id,
          });
          setPanelValues({});
        } catch (err) { console.warn("panel values save failed:", err.message); }
      }

      onSaved(u); alert("Draft saved");
    } catch (err) { alert(err.message); }
    finally { setSaving(false); }
  };

  const sign = async () => {
    if (!confirm("Sign and lock this encounter? After signing, changes require an amendment.")) return;
    try {
      setSaving(true);
      const u = await updateRow("encounters", e.id, {
        chief_complaint: e.chief_complaint, subjective: e.subjective, objective: e.objective,
        assessment: e.assessment, plan: e.plan, diagnoses: e.diagnoses || [], cpt_codes: e.cpt_codes || [],
        em_level: e.em_level || null, vitals: e.vitals || {},
        status: "Signed", signed_at: new Date().toISOString(), signed_by: profile.id,
      }, { audit: { entityType: "encounters", patientId: e.patient_id, details: { action: "sign" } } });

      if (Object.keys(panelValues).length > 0) {
        try {
          const [mRes, pRes] = await Promise.all([
            supabase.from("clinical_metrics").select("*"),
            supabase.from("clinical_panels").select("*"),
          ]);
          await savePanelValues({
            patientId: e.patient_id, practiceId: e.practice_id,
            encounterId: e.id, values: panelValues,
            metrics: mRes.data || [], panels: pRes.data || [],
            enteredBy: profile.id,
          });
          setPanelValues({});
        } catch (err) { console.warn("panel values save failed:", err.message); }
      }

      onSaved(u); onClose();
    } catch (err) { alert(err.message); }
    finally { setSaving(false); }
  };

  const amend = async () => {
    if (!amendReason.trim()) { alert("Amendment reason is required"); return; }
    try {
      setSaving(true);
      await supabase.from("revision_history").insert({
        practice_id: e.practice_id, entity_type: "encounters", entity_id: e.id,
        revision_number: 1, changed_by: profile.id, change_reason: amendReason,
        before_snapshot: encounter, after_snapshot: e,
      });
      const u = await updateRow("encounters", e.id, {
        chief_complaint: e.chief_complaint, subjective: e.subjective, objective: e.objective,
        assessment: e.assessment, plan: e.plan, diagnoses: e.diagnoses || [], cpt_codes: e.cpt_codes || [],
        status: "Amended", amended_at: new Date().toISOString(), amended_by: profile.id, amendment_reason: amendReason,
      }, { audit: { entityType: "encounters", patientId: e.patient_id, details: { action: "amend", reason: amendReason } } });
      onSaved(u); setAmending(false); onClose();
    } catch (err) { alert(err.message); }
    finally { setSaving(false); }
  };

  const vitals = e.vitals || {};
  const setVital = (k) => (v) => setE((p) => ({ ...p, vitals: { ...(p.vitals || {}), [k]: v } }));

  return (
    <Modal title={`${encounter.patients?.first_name} ${encounter.patients?.last_name} · ${e.encounter_date}`} onClose={onClose} maxWidth={820}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <Badge label={e.status} variant={e.status === "Signed" ? "green" : e.status === "Amended" ? "amber" : "neutral"} />
        <Badge label={e.appt_type} variant="teal" size="xs" />
        {locked && <span style={{ fontSize: 11, color: C.textTertiary }}>🔒 Signed — use Amend to make changes</span>}
      </div>

      <SectionHead title="Vitals" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8, marginBottom: 16 }}>
        {["bp", "hr", "temp", "rr", "spo2", "wt"].map((k) => (
          <div key={k}>
            <FL>{k.toUpperCase()}</FL>
            <input disabled={locked} value={vitals[k] || ""} onChange={(ev) => setVital(k)(ev.target.value)}
              style={{ width: "100%", padding: "6px 8px", border: `0.5px solid ${C.borderMid}`, borderRadius: 6, fontSize: 12, fontFamily: "inherit" }} />
          </div>
        ))}
      </div>

      <SectionHead title="SOAP Note" action={!locked ? <Btn size="sm" variant="outline" onClick={() => setScribeOpen(true)}>AI Scribe</Btn> : null} />
      <div style={{ opacity: locked ? 0.7 : 1 }}>
        <Input label="Chief Complaint" value={e.chief_complaint} onChange={locked ? () => {} : set("chief_complaint")} />
        <Textarea label="Subjective" value={e.subjective} onChange={locked ? () => {} : set("subjective")} rows={3} />
        <Textarea label="Objective" value={e.objective} onChange={locked ? () => {} : set("objective")} rows={3} />
        <Textarea label="Assessment" value={e.assessment} onChange={locked ? () => {} : set("assessment")} rows={3} />
        {patient && (
  <PanelQuickEntryStrip
    patient={patient}
    encounter={e}
    disabled={locked}
    onValuesChange={setPanelValues}
  />
)}
        <Textarea label="Plan" value={e.plan} onChange={locked ? () => {} : set("plan")} rows={3} />
      </div>

      <SectionHead title="Diagnoses (ICD-10)" action={!locked && <Btn size="sm" variant="outline" onClick={() => setCodeModal("diagnoses")}>+ Add</Btn>} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
        {(e.diagnoses || []).length === 0 ? <div style={{ fontSize: 12, color: C.textTertiary }}>None</div>
          : (e.diagnoses || []).map((c) => (
            <div key={c.code} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", border: `0.5px solid ${C.borderLight}`, borderRadius: 6, fontSize: 12, background: C.tealBg }}>
              <code style={{ color: C.teal, fontWeight: 700 }}>{c.code}</code>
              <span style={{ color: C.textSecondary }}>{c.description}</span>
              {!locked && <button onClick={() => removeCode("diagnoses", c.code)} style={{ background: "none", border: "none", cursor: "pointer", color: C.red }}>×</button>}
            </div>
          ))}
      </div>

      <SectionHead title="Procedures / Billing (CPT)" action={!locked && <Btn size="sm" variant="outline" onClick={() => setCodeModal("cpt_codes")}>+ Add</Btn>} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
        {(e.cpt_codes || []).length === 0 ? <div style={{ fontSize: 12, color: C.textTertiary }}>None</div>
          : (e.cpt_codes || []).map((c) => (
            <div key={c.code} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", border: `0.5px solid ${C.borderLight}`, borderRadius: 6, fontSize: 12, background: C.amberBg }}>
              <code style={{ color: C.amber, fontWeight: 700 }}>{c.code}</code>
              <span style={{ color: C.textSecondary }}>{c.description}</span>
              {!locked && <button onClick={() => removeCode("cpt_codes", c.code)} style={{ background: "none", border: "none", cursor: "pointer", color: C.red }}>×</button>}
            </div>
          ))}
      </div>

      {amending && (
        <div style={{ padding: 12, background: C.amberBg, borderRadius: 8, marginBottom: 12 }}>
          <Input label="Reason for Amendment *" value={amendReason} onChange={setAmendReason} placeholder="e.g. Corrected assessment per updated lab result" />
        </div>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20, borderTop: `0.5px solid ${C.borderLight}`, paddingTop: 16 }}>
        {locked && !amending && <Btn variant="amber" onClick={() => setAmending(true)}>Amend</Btn>}
        {amending && <Btn variant="outline" onClick={() => { setAmending(false); setAmendReason(""); }}>Cancel Amendment</Btn>}
        {amending && <Btn variant="amber" onClick={amend} disabled={saving}>Save Amendment</Btn>}
        {!locked && !amending && <>
          <Btn variant="outline" onClick={onClose}>Close</Btn>
          <Btn variant="ghost" onClick={saveDraft} disabled={saving}>Save Draft</Btn>
          <Btn onClick={sign} disabled={saving}>Sign & Lock</Btn>
        </>}
      </div>

      {codeModal === "diagnoses" && <CodeSearchModal title="Add ICD-10" codes={ICD10_COMMON} onAdd={(c) => addCode("diagnoses", c)} onClose={() => setCodeModal(null)} />}
      {codeModal === "cpt_codes" && <CodeSearchModal title="Add CPT" codes={CPT_COMMON} onAdd={(c) => addCode("cpt_codes", c)} onClose={() => setCodeModal(null)} />}
      {scribeOpen && (
        <ScribeModal
          encounter={e}
          practiceId={e.practice_id}
          profile={profile}
          onClose={() => setScribeOpen(false)}
          onInsert={(draft) => {
            // Append-if-existing, replace-if-empty. Provider can edit before signing.
            setE((prev) => ({
              ...prev,
              subjective: prev.subjective ? prev.subjective + "\n\n" + draft.subjective : draft.subjective,
              objective:  prev.objective  ? prev.objective  + "\n\n" + draft.objective  : draft.objective,
              assessment: prev.assessment ? prev.assessment + "\n\n" + draft.assessment : draft.assessment,
              plan:       prev.plan       ? prev.plan       + "\n\n" + draft.plan       : draft.plan,
            }));
            setScribeOpen(false);
          }}
        />
      )}
    </Modal>
  );
}
