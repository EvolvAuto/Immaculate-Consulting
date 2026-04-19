// ═══════════════════════════════════════════════════════════════════════════════
// ConsentsView - staff management of consent document templates and signed
// consents. Create new versions, retire old ones, view patient signatures.
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../auth/AuthProvider";
import { C } from "../lib/tokens";
import { Badge, Btn, Card, Modal, Input, Textarea, Select, TopBar, TabBar, FL, Loader, ErrorBanner, EmptyState } from "../components/ui";

const CONSENT_TYPES = ["HIPAA Privacy", "Telehealth", "Financial Policy", "General Treatment", "Patient Portal", "Release of Information"];

export default function ConsentsView() {
  const { practiceId, profile } = useAuth();
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [docs, setDocs]           = useState([]);
  const [signed, setSigned]       = useState([]);
  const [tab, setTab]             = useState("documents");
  const [editing, setEditing]     = useState(null);       // new/edit doc
  const [viewing, setViewing]     = useState(null);       // viewing doc body
  const [viewingSig, setViewingSig] = useState(null);     // viewing signed consent detail

  const load = async () => {
    try {
      setLoading(true);
      const [d, s] = await Promise.all([
        supabase.from("consent_documents")
          .select("*")
          .order("consent_type", { ascending: true })
          .order("effective_from", { ascending: false }),
        supabase.from("consents")
          .select("*, patients(first_name, last_name, mrn), consent_documents(title, version)")
          .order("signed_at", { ascending: false })
          .limit(200),
      ]);
      if (d.error) throw d.error;
      if (s.error) throw s.error;
      setDocs(d.data || []);
      setSigned(s.data || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (practiceId) load(); }, [practiceId]);

  const saveDoc = async (form) => {
    try {
      // Hash the body (client-side SHA-256) so server has integrity check baseline
      const bodyHash = await sha256Hex(form.body_markdown);
      const payload = {
        practice_id:    practiceId,
        consent_type:   form.consent_type,
        version:        form.version,
        title:          form.title,
        body_markdown:  form.body_markdown,
        body_hash:      bodyHash,
        effective_from: form.effective_from || new Date().toISOString().slice(0, 10),
        created_by:     profile?.id,
      };
      const { data, error: err } = await supabase.from("consent_documents").insert(payload).select().maybeSingle();
      if (err) throw err;
      setDocs((prev) => [data, ...prev]);
      setEditing(null);
    } catch (e) { setError(e.message); }
  };

  const retireDoc = async (doc) => {
    if (!confirm(`Retire "${doc.title}" v${doc.version}? This prevents new signatures on this document. Existing signed consents are unaffected.`)) return;
    try {
      const { data, error: err } = await supabase.from("consent_documents")
        .update({ retired_at: new Date().toISOString(), retired_reason: "Retired by staff", effective_to: new Date().toISOString().slice(0, 10) })
        .eq("id", doc.id).select().maybeSingle();
      if (err) throw err;
      setDocs((prev) => prev.map((d) => d.id === doc.id ? data : d));
    } catch (e) { setError(e.message); }
  };

  // Group documents by consent_type for clean display
  const grouped = useMemo(() => {
    const g = {};
    CONSENT_TYPES.forEach((ct) => { g[ct] = []; });
    docs.forEach((d) => { if (g[d.consent_type]) g[d.consent_type].push(d); });
    return g;
  }, [docs]);

  if (loading) return <div style={{ flex: 1 }}><TopBar title="Consents" /><Loader /></div>;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar title="Consents" sub={tab === "documents" ? `${docs.length} documents` : `${signed.length} signatures`}
        actions={<>
          <TabBar tabs={[["documents", "Documents"], ["signatures", "Signatures"]]} active={tab} onChange={setTab} />
          {tab === "documents" && <Btn size="sm" onClick={() => setEditing({ consent_type: "HIPAA Privacy", version: "", title: "", body_markdown: "", effective_from: new Date().toISOString().slice(0, 10) })}>+ New Document</Btn>}
        </>} />

      <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
        {error && <ErrorBanner message={error} />}

        {tab === "documents" && (
          <div style={{ maxWidth: 1000, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
            {CONSENT_TYPES.map((ct) => (
              <Card key={ct} style={{ padding: 0 }}>
                <div style={{ padding: "12px 16px", borderBottom: `0.5px solid ${C.borderLight}`, background: C.bgSecondary }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>{ct}</span>
                  <span style={{ fontSize: 11, color: C.textTertiary, marginLeft: 8 }}>{grouped[ct].length} version{grouped[ct].length !== 1 ? "s" : ""}</span>
                </div>
                {grouped[ct].length === 0
                  ? <div style={{ padding: 16, fontSize: 12, color: C.textTertiary, textAlign: "center" }}>No documents of this type yet.</div>
                  : <div style={{ display: "flex", flexDirection: "column" }}>
                      {grouped[ct].map((doc) => {
                        const isActive = !doc.retired_at && !doc.effective_to;
                        return (
                          <div key={doc.id} style={{ padding: "10px 16px", borderBottom: `0.5px solid ${C.borderLight}`, display: "flex", alignItems: "center", gap: 12 }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 500, color: C.textPrimary }}>{doc.title}</div>
                              <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>
                                v{doc.version} · effective from {doc.effective_from}
                                {doc.retired_at && ` · retired ${doc.retired_at.slice(0, 10)}`}
                              </div>
                            </div>
                            <Badge label={isActive ? "Active" : "Retired"} variant={isActive ? "green" : "neutral"} size="xs" />
                            <Btn size="sm" variant="outline" onClick={() => setViewing(doc)}>View</Btn>
                            {isActive && <Btn size="sm" variant="outline" onClick={() => retireDoc(doc)}>Retire</Btn>}
                          </div>
                        );
                      })}
                    </div>}
              </Card>
            ))}
          </div>
        )}

        {tab === "signatures" && (
          signed.length === 0
            ? <EmptyState icon="✍" title="No signatures yet" sub="Patient signatures will appear here once they're signed in the portal." />
            : <div style={{ maxWidth: 1000, margin: "0 auto", display: "flex", flexDirection: "column", gap: 6 }}>
                {signed.map((s) => (
                  <Card key={s.id} style={{ padding: 12, cursor: "pointer" }} onClick={() => setViewingSig(s)}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: C.textPrimary }}>
                          {s.patients ? `${s.patients.first_name} ${s.patients.last_name}` : "Unknown patient"}
                          <span style={{ fontWeight: 400, color: C.textTertiary, marginLeft: 6 }}>(MRN {s.patients?.mrn || "--"})</span>
                        </div>
                        <div style={{ fontSize: 11, color: C.textSecondary, marginTop: 2 }}>
                          {s.consent_type} · v{s.version} · signed {s.signed_at ? new Date(s.signed_at).toLocaleString() : "--"}
                        </div>
                      </div>
                      <Badge label={s.signed_method || "--"} variant="neutral" size="xs" />
                      {s.revoked_at && <Badge label="Revoked" variant="red" size="xs" />}
                    </div>
                  </Card>
                ))}
              </div>
        )}
      </div>

      {editing && <DocumentEditModal initial={editing} onClose={() => setEditing(null)} onSave={saveDoc} />}
      {viewing && <DocumentViewModal doc={viewing} onClose={() => setViewing(null)} />}
      {viewingSig && <SignatureDetailModal consent={viewingSig} onClose={() => setViewingSig(null)} />}
    </div>
  );
}

function DocumentEditModal({ initial, onClose, onSave }) {
  const [f, setF] = useState(initial);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const valid = f.title.trim() && f.version.trim() && f.body_markdown.trim().length > 50;

  return (
    <Modal title="New Consent Document" onClose={onClose} maxWidth={720}>
      <div style={{ fontSize: 12, color: C.amberText, background: C.amberBg, padding: 10, borderRadius: 6, marginBottom: 12 }}>
        ⚠ Consent document text should be reviewed by a healthcare attorney before being published for patient signing.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 140px 140px", gap: 10 }}>
        <Select label="Consent Type *" value={f.consent_type} onChange={set("consent_type")} options={CONSENT_TYPES} />
        <Input label="Version *" value={f.version} onChange={set("version")} placeholder="2026.1" />
        <Input label="Effective From" type="date" value={f.effective_from} onChange={set("effective_from")} />
      </div>
      <Input label="Title *" value={f.title} onChange={set("title")} placeholder="HIPAA Notice of Privacy Practices" />
      <FL>Body (Markdown) *</FL>
      <textarea value={f.body_markdown} onChange={(e) => set("body_markdown")(e.target.value)} rows={14}
        style={{ width: "100%", padding: 10, border: `0.5px solid ${C.borderMid}`, borderRadius: 6, fontSize: 12, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", outline: "none", resize: "vertical" }}
        placeholder="# Document Title&#10;&#10;Full legal text of the consent..." />
      <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 4 }}>{f.body_markdown.length} characters · minimum 50</div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        <Btn disabled={!valid} onClick={() => valid && onSave(f)}>Create Document</Btn>
      </div>
    </Modal>
  );
}

function DocumentViewModal({ doc, onClose }) {
  return (
    <Modal title={`${doc.title} - v${doc.version}`} onClose={onClose} maxWidth={720}>
      <div style={{ fontSize: 11, color: C.textTertiary, marginBottom: 10 }}>
        Hash: <code>{doc.body_hash}</code>
      </div>
      <pre style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.5, color: C.textPrimary, background: C.bgSecondary, padding: 16, borderRadius: 6, maxHeight: 500, overflow: "auto", margin: 0 }}>
        {doc.body_markdown}
      </pre>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
        <Btn onClick={onClose}>Close</Btn>
      </div>
    </Modal>
  );
}

function SignatureDetailModal({ consent, onClose }) {
  return (
    <Modal title="Signature Detail" onClose={onClose} maxWidth={560}>
      <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 8, fontSize: 13 }}>
        <Field label="Patient">{consent.patients ? `${consent.patients.first_name} ${consent.patients.last_name}` : "-"}</Field>
        <Field label="Document">{consent.consent_documents?.title || consent.consent_type}</Field>
        <Field label="Version">{consent.version}</Field>
        <Field label="Signed at">{consent.signed_at ? new Date(consent.signed_at).toLocaleString() : "-"}</Field>
        <Field label="Signed by name">{consent.signed_by_name || "-"}</Field>
        <Field label="Typed name">{consent.typed_name || "-"}</Field>
        <Field label="Relationship">{consent.relationship || "-"}</Field>
        <Field label="Method">{consent.signed_method || "-"}</Field>
        <Field label="IP address">{consent.signed_ip || "-"}</Field>
        <Field label="User agent"><span style={{ fontSize: 11, wordBreak: "break-all" }}>{consent.signed_user_agent || "-"}</span></Field>
        <Field label="Document hash"><code style={{ fontSize: 10 }}>{consent.document_hash || "-"}</code></Field>
        {consent.revoked_at && <Field label="Revoked at" color={C.red}>{new Date(consent.revoked_at).toLocaleString()}</Field>}
        {consent.revoked_reason && <Field label="Revoke reason" color={C.red}>{consent.revoked_reason}</Field>}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
        <Btn onClick={onClose}>Close</Btn>
      </div>
    </Modal>
  );
}

function Field({ label, children, color }) {
  return <>
    <span style={{ color: C.textTertiary, fontSize: 12 }}>{label}</span>
    <span style={{ color: color || C.textPrimary }}>{children}</span>
  </>;
}

async function sha256Hex(input) {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
