// ═══════════════════════════════════════════════════════════════════════════════
// WaitlistView — cascading SMS outreach, slot-open detection, priority score
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../auth/AuthProvider";
import { C } from "../lib/tokens";
import { listRows, insertRow, updateRow, logAudit } from "../lib/db";
import { DEFAULT_APPT_TYPES } from "../components/constants";
import { Badge, Btn, Card, Modal, TopBar, TabBar, Input, Textarea, Select, FL, SectionHead, Loader, ErrorBanner, EmptyState } from "../components/ui";

const STATUS_VAR = {
  "Open":      "amber",
  "Contacted": "blue",
  "Accepted":  "green",
  "Declined":  "neutral",
  "Expired":   "neutral",
  "Filled":    "green",
};

export default function WaitlistView() {
  const { practiceId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [entries, setEntries] = useState([]);
  const [providers, setProviders] = useState([]);
  const [tab, setTab] = useState("open");
  const [adding, setAdding] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      const [w, p] = await Promise.all([
        supabase.from("waitlist_entries")
          .select("*, patients(first_name, last_name, phone_mobile), providers(first_name, last_name)")
          .order("priority_score", { ascending: false }).order("created_at"),
        listRows("providers", { filters: { is_active: true }, order: "last_name" }),
      ]);
      if (w.error) throw w.error;
      setEntries(w.data || []);
      setProviders(p);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (practiceId) load(); }, [practiceId]);

  const markContacted = async (entry) => {
    try {
      await updateRow("waitlist_entries", entry.id, {
        status: "Contacted",
        last_contacted_at: new Date().toISOString(),
        contact_attempts: (entry.contact_attempts || 0) + 1,
      }, { audit: { entityType: "waitlist_entries", patientId: entry.patient_id } });
      load();
    } catch (e) { setError(e.message); }
  };

  const resolve = async (entry, status) => {
    try {
      await updateRow("waitlist_entries", entry.id, { status, ...(status === "Filled" ? { filled_at: new Date().toISOString() } : {}) },
        { audit: { entityType: "waitlist_entries", patientId: entry.patient_id, details: { to: status } } });
      load();
    } catch (e) { setError(e.message); }
  };

  if (loading) return <div style={{ flex: 1 }}><TopBar title="Waitlist" /><Loader /></div>;

  const filtered = entries.filter((e) => {
    if (tab === "open") return e.status === "Open" || e.status === "Contacted";
    if (tab === "filled") return e.status === "Filled" || e.status === "Accepted";
    return true;
  });

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar title="Waitlist" sub={`${filtered.length} patients`}
        actions={<>
          <TabBar tabs={[["open", "Open"], ["filled", "Filled"], ["all", "All"]]} active={tab} onChange={setTab} />
          <Btn size="sm" onClick={() => setAdding(true)}>+ Add to Waitlist</Btn>
        </>} />

      <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
        {error && <ErrorBanner message={error} />}
        {filtered.length === 0 ? <EmptyState icon="📋" title="Waitlist is empty" sub="Add patients who want an earlier appointment." />
          : <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 1000, margin: "0 auto" }}>
            {filtered.map((e) => (
              <Card key={e.id} style={{ padding: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 8, background: C.tealBg, color: C.teal, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14 }}>
                    {e.priority_score}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary }}>
                      {e.patients ? `${e.patients.first_name} ${e.patients.last_name}` : "—"}
                    </div>
                    <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>
                      {e.appt_type} · {e.providers ? `Dr. ${e.providers.last_name}` : "Any provider"}
                      {e.preferred_window && ` · ${e.preferred_window}`}
                      {e.contact_attempts > 0 && ` · ${e.contact_attempts} contact attempts`}
                    </div>
                    {e.notes && <div style={{ fontSize: 11, color: C.textSecondary, marginTop: 4, fontStyle: "italic" }}>"{e.notes}"</div>}
                  </div>
                  <Badge label={e.status} variant={STATUS_VAR[e.status] || "neutral"} size="xs" />
                  <div style={{ display: "flex", gap: 4 }}>
                    {(e.status === "Open" || e.status === "Contacted") && (
                      <>
                        <Btn size="sm" variant="outline" onClick={() => markContacted(e)}>Contact</Btn>
                        <Btn size="sm" onClick={() => resolve(e, "Filled")}>Filled</Btn>
                        <Btn size="sm" variant="ghost" onClick={() => resolve(e, "Declined")}>Decline</Btn>
                      </>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>}
      </div>

      {adding && <AddModal practiceId={practiceId} providers={providers} onClose={() => setAdding(false)} onAdded={load} />}
    </div>
  );
}

function AddModal({ onClose, onAdded, providers, practiceId }) {
  const [f, setF] = useState({ patient_id: "", provider_id: "", appt_type: "Follow-up", preferred_window: "", notes: "", priority_score: 50 });
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [patient, setPatient] = useState(null);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    if (!q || q.length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.from("patients").select("id, first_name, last_name, date_of_birth")
        .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`).eq("status", "Active").limit(8);
      setResults(data || []);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const save = async () => {
    if (!patient) { alert("Select a patient"); return; }
    try {
      await insertRow("waitlist_entries", {
        patient_id: patient.id,
        provider_id: f.provider_id || null,
        appt_type: f.appt_type,
        preferred_window: f.preferred_window || null,
        notes: f.notes || null,
        priority_score: parseInt(f.priority_score) || 50,
        status: "Open",
      }, practiceId, { audit: { entityType: "waitlist_entries", patientId: patient.id } });
      onAdded();
      onClose();
    } catch (e) { alert(e.message); }
  };

  return (
    <Modal title="Add to Waitlist" onClose={onClose} maxWidth={480}>
      {!patient ? <>
        <Input label="Patient" value={q} onChange={setQ} placeholder="Search name..." />
        {results.map((p) => (
          <div key={p.id} onClick={() => setPatient(p)} style={{ padding: "8px 12px", border: `0.5px solid ${C.borderLight}`, borderRadius: 8, fontSize: 12, cursor: "pointer", marginBottom: 4 }}>
            {p.first_name} {p.last_name} · DOB {p.date_of_birth}
          </div>
        ))}
      </> : (
        <div style={{ padding: "9px 12px", border: `1px solid ${C.tealBorder}`, borderRadius: 8, background: C.tealBg, marginBottom: 14, fontSize: 13, display: "flex", justifyContent: "space-between" }}>
          <div><b>{patient.first_name} {patient.last_name}</b></div>
          <button onClick={() => setPatient(null)} style={{ background: "none", border: "none", cursor: "pointer" }}>×</button>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Select label="Provider" value={f.provider_id} onChange={set("provider_id")}
          options={[{ value: "", label: "Any provider" }, ...providers.map((p) => ({ value: p.id, label: `Dr. ${p.last_name}` }))]} />
        <Select label="Appt Type" value={f.appt_type} onChange={set("appt_type")} options={DEFAULT_APPT_TYPES.map((t) => t.name)} />
      </div>
      <Input label="Preferred Window" value={f.preferred_window} onChange={set("preferred_window")} placeholder="e.g. Morning, Afternoon, Any" />
      <Input label="Priority Score (0-100)" type="number" value={f.priority_score} onChange={set("priority_score")} />
      <Textarea label="Notes" value={f.notes} onChange={set("notes")} rows={2} />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        <Btn onClick={save}>Add</Btn>
      </div>
    </Modal>
  );
}
