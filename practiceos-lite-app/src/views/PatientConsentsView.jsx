// ═══════════════════════════════════════════════════════════════════════════════
// PatientConsentsView - patient portal screen showing consent documents
// requiring signature. Typed-name e-signature flow calls the sign-consent
// Edge Function which performs SHA-256 integrity verification and records
// a full attestation (IP, user agent, timestamp).
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../auth/AuthProvider";
import { C } from "../lib/tokens";
import { Badge, Btn, Card, Modal, Input, FL, Loader, ErrorBanner, EmptyState } from "../components/ui";

export default function PatientConsentsView() {
  const { profile } = useAuth();   // profile should include patient record; adapt to your portal auth shape
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [pending, setPending]   = useState([]);   // active docs patient hasn't signed yet
  const [signed, setSigned]     = useState([]);   // docs patient has already signed
  const [signing, setSigning]   = useState(null); // doc currently being signed
  const [confirmation, setConfirmation] = useState(null); // after successful signature

  const patientFullName = profile?.first_name && profile?.last_name
    ? `${profile.first_name} ${profile.last_name}` : "";

  const load = async () => {
    try {
      setLoading(true);
      // Active documents for the patient's practice (RLS ensures only their practice's docs)
      const { data: activeDocs, error: dErr } = await supabase.from("consent_documents")
        .select("*")
        .is("effective_to", null)
        .is("retired_at", null)
        .order("consent_type");
      if (dErr) throw dErr;

      // Already signed consents (RLS filters to this patient automatically via is_patient policy)
      const { data: signedRows, error: sErr } = await supabase.from("consents")
        .select("id, consent_type, version, signed_at, consent_document_id, revoked_at")
        .order("signed_at", { ascending: false });
      if (sErr) throw sErr;

      // Pending = active docs whose id is NOT in any non-revoked signed row
      const signedDocIds = new Set((signedRows || []).filter((r) => !r.revoked_at).map((r) => r.consent_document_id));
      setPending((activeDocs || []).filter((d) => !signedDocIds.has(d.id)));
      setSigned(signedRows || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const submitSignature = async (form) => {
    try {
      const { data, error: err } = await supabase.functions.invoke("sign-consent", {
        body: {
          consent_document_id: signing.id,
          typed_name:          form.typed_name,
          signed_by_name:      patientFullName,
          relationship:        "self",
        },
      });
      if (err) throw err;
      if (data?.error) throw new Error(data.error);
      setConfirmation({ title: signing.title, signed_at: data.signed_at });
      setSigning(null);
      load();
    } catch (e) { setError(e.message); }
  };

  if (loading) return <div style={{ padding: 40, textAlign: "center" }}><Loader /></div>;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "20px 20px 0" }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: C.textPrimary, margin: "0 0 4px" }}>Consent Forms</h1>
        <p style={{ fontSize: 13, color: C.textSecondary, margin: 0 }}>Review and sign consent documents from your care team.</p>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
        {error && <ErrorBanner message={error} />}

        {/* Pending signatures section */}
        {pending.length > 0 && (
          <div style={{ maxWidth: 720, margin: "0 auto 24px" }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary, marginBottom: 10 }}>Awaiting your signature</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {pending.map((doc) => (
                <Card key={doc.id} style={{ padding: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary }}>{doc.title}</div>
                      <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 2 }}>{doc.consent_type} · version {doc.version}</div>
                    </div>
                    <Badge label="Pending" variant="amber" size="xs" />
                    <Btn size="sm" onClick={() => setSigning(doc)}>Review & Sign</Btn>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Already signed */}
        {signed.length > 0 && (
          <div style={{ maxWidth: 720, margin: "0 auto" }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary, marginBottom: 10 }}>Signed documents</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {signed.map((s) => (
                <Card key={s.id} style={{ padding: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: C.textPrimary }}>{s.consent_type}</div>
                      <div style={{ fontSize: 11, color: C.textTertiary }}>
                        v{s.version} · signed {s.signed_at ? new Date(s.signed_at).toLocaleDateString() : "-"}
                      </div>
                    </div>
                    {s.revoked_at
                      ? <Badge label="Revoked" variant="red" size="xs" />
                      : <Badge label="On file" variant="green" size="xs" />}
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {pending.length === 0 && signed.length === 0 && (
          <EmptyState icon="✓" title="No consents to sign" sub="Your care team will send you any consent documents they need." />
        )}
      </div>

      {signing && (
        <SignModal
          doc={signing}
          patientFullName={patientFullName}
          onClose={() => setSigning(null)}
          onSubmit={submitSignature}
        />
      )}
      {confirmation && (
        <Modal title="Signature recorded" onClose={() => setConfirmation(null)} maxWidth={440}>
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✓</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary, marginBottom: 6 }}>{confirmation.title}</div>
            <div style={{ fontSize: 12, color: C.textSecondary }}>Signed {new Date(confirmation.signed_at).toLocaleString()}</div>
          </div>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <Btn onClick={() => setConfirmation(null)}>Done</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

function SignModal({ doc, patientFullName, onClose, onSubmit }) {
  const [typedName, setTypedName] = useState("");
  const [agreed, setAgreed]       = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const nameMatches = typedName.trim().toLowerCase() === patientFullName.trim().toLowerCase() && patientFullName;
  const canSubmit   = nameMatches && agreed && !submitting;

  const handleSubmit = async () => {
    setSubmitting(true);
    try { await onSubmit({ typed_name: typedName }); }
    finally { setSubmitting(false); }
  };

  return (
    <Modal title={doc.title} onClose={onClose} maxWidth={720}>
      <div style={{ fontSize: 11, color: C.textTertiary, marginBottom: 8 }}>
        {doc.consent_type} · version {doc.version}
      </div>

      {/* Document body - scrollable */}
      <pre style={{
        whiteSpace: "pre-wrap",
        fontSize: 13,
        lineHeight: 1.55,
        color: C.textPrimary,
        background: C.bgSecondary,
        padding: 16,
        borderRadius: 6,
        maxHeight: 360,
        overflow: "auto",
        margin: "0 0 16px",
        border: `0.5px solid ${C.borderLight}`,
        fontFamily: "inherit",
      }}>
        {doc.body_markdown}
      </pre>

      {/* Attestation block */}
      <div style={{ padding: 14, background: C.tealBg, border: `1px solid ${C.tealBorder}`, borderRadius: 6, marginBottom: 14 }}>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 12, cursor: "pointer" }}>
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ marginTop: 2 }} />
          <span style={{ color: C.textPrimary, lineHeight: 1.5 }}>
            I have read and understand this document. By typing my full legal name below and clicking Sign,
            I agree to be bound by its terms. I understand this electronic signature has the same legal
            effect as a handwritten signature.
          </span>
        </label>
      </div>

      <FL>Type your full legal name: <span style={{ color: C.textTertiary }}>({patientFullName || "full name required"})</span></FL>
      <Input value={typedName} onChange={setTypedName} placeholder={patientFullName} />
      {typedName && !nameMatches && (
        <div style={{ fontSize: 11, color: C.red, marginTop: 4 }}>
          Must match your name on file exactly.
        </div>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}>
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        <Btn disabled={!canSubmit} onClick={handleSubmit}>
          {submitting ? "Signing..." : "Sign"}
        </Btn>
      </div>
    </Modal>
  );
}
