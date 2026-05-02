// ═══════════════════════════════════════════════════════════════════════════════
// src/views/patient/DocumentsTab.jsx
// Patient chart tab for external records: lab results, imaging, faxed referral
// responses, consents, etc. Storage path is <practice_id>/<patient_id>/<doc_id>.<ext>
// so RLS isolates by path prefix. Archive (not delete) preserves the audit trail.
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../auth/AuthProvider";
import { C } from "../../lib/tokens";
import { Btn, Card, Modal, Input, Select, Textarea, Badge, FL, SectionHead, EmptyState, Loader, ErrorBanner } from "../../components/ui";

const DOCUMENT_TYPES = [
  "Lab Result",
  "Imaging Report",
  "Referral Response",
  "External Records",
  "Insurance Document",
  "Consent / Form",
  "Other",
];

const ACCEPTED_MIME = "application/pdf,image/jpeg,image/png,image/tiff,image/heic,image/heif,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB; matches bucket limit

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

function badgeVariantForType(t) {
  if (t === "Lab Result")        return "teal";
  if (t === "Imaging Report")    return "blue";
  if (t === "Referral Response") return "amber";
  if (t === "Consent / Form")    return "green";
  return "neutral";
}

export default function DocumentsTab({ patientId, practiceId }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showUpload, setShowUpload] = useState(false);
  const [filter, setFilter] = useState("");

  const reload = async () => {
    if (!patientId) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase.from("patient_documents")
        .select("*")
        .eq("patient_id", patientId)
        .eq("is_archived", false)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setDocs(data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [patientId]);

  const handleView = async (doc) => {
    try {
      const { data, error } = await supabase.storage.from("patient-documents")
        .createSignedUrl(doc.storage_path, 60 * 5); // 5 min
      if (error) throw error;
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (e) {
      alert("Could not open document: " + e.message);
    }
  };

  const handleArchive = async (doc) => {
    if (!confirm(`Archive "${doc.name}"? It will be hidden from the chart but the file is preserved for audit.`)) return;
    try {
      const { error } = await supabase.from("patient_documents")
        .update({ is_archived: true, archived_at: new Date().toISOString() })
        .eq("id", doc.id);
      if (error) throw error;
      reload();
    } catch (e) {
      alert("Could not archive: " + e.message);
    }
  };

  const filtered = filter
    ? docs.filter((d) => d.document_type === filter)
    : docs;

  const types = Array.from(new Set(docs.map((d) => d.document_type)));

  if (loading) return <Loader />;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <SectionHead title="Documents" sub="External records, lab results, faxed reports, consents" />
        <div style={{ display: "flex", gap: 8 }}>
          {types.length > 1 && (
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{
                padding: "6px 10px",
                border: "0.5px solid " + C.borderMid,
                borderRadius: 6,
                fontSize: 12,
                fontFamily: "inherit",
              }}
            >
              <option value="">All types ({docs.length})</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {t} ({docs.filter((d) => d.document_type === t).length})
                </option>
              ))}
            </select>
          )}
          <Btn size="sm" onClick={() => setShowUpload(true)}>+ Upload Document</Btn>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {filtered.length === 0 ? (
        <EmptyState
          icon="📄"
          title={filter ? "No " + filter + " documents" : "No documents on file"}
          sub={filter ? "Try clearing the filter." : "Upload lab results, imaging reports, faxed referrals, or consents."}
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map((d) => (
            <Card key={d.id}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>{d.name}</span>
                    <Badge label={d.document_type} variant={badgeVariantForType(d.document_type)} size="xs" />
                  </div>
                  <div style={{ fontSize: 11, color: C.textTertiary }}>
                    {d.document_date ? "Document date: " + d.document_date + " · " : ""}
                    Uploaded {new Date(d.created_at).toLocaleDateString()}
                    {d.uploaded_by_name ? " by " + d.uploaded_by_name : ""}
                    {" · " + formatBytes(d.file_size_bytes)}
                  </div>
                  {d.notes && (
                    <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 6, lineHeight: 1.4 }}>
                      {d.notes}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  <Btn size="sm" variant="outline" onClick={() => handleView(d)}>View</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => handleArchive(d)}>Archive</Btn>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {showUpload && (
        <UploadDocumentModal
          patientId={patientId}
          practiceId={practiceId}
          onClose={() => setShowUpload(false)}
          onUploaded={() => { setShowUpload(false); reload(); }}
        />
      )}
    </div>
  );
}

// ─── Upload modal ─────────────────────────────────────────────────────────────
function UploadDocumentModal({ patientId, practiceId, onClose, onUploaded }) {
  const { profile } = useAuth();
  const [file, setFile] = useState(null);
  const [name, setName] = useState("");
  const [docType, setDocType] = useState("Lab Result");
  const [docDate, setDocDate] = useState("");
  const [notes, setNotes] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  const handleFileChange = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (f.size > MAX_SIZE_BYTES) {
      setError("File too large: " + formatBytes(f.size) + ". Max 25 MB.");
      return;
    }
    setFile(f);
    if (!name) setName(f.name.replace(/\.[^/.]+$/, "")); // strip extension for default name
    setError(null);
  };

  const handleUpload = async () => {
    if (!file) { setError("Pick a file first."); return; }
    if (!name.trim()) { setError("Document name required."); return; }
    setUploading(true);
    setError(null);

    let docId = null;
    try {
      // Create the metadata row first to claim a UUID and storage path.
      // storage_path is set to a placeholder; updated after the upload succeeds.
      const ext = (file.name.split(".").pop() || "bin").toLowerCase();
      const uploaderName = profile && (profile.full_name || profile.first_name)
        ? (profile.full_name || (profile.first_name + " " + (profile.last_name || "")).trim())
        : null;

      const { data: doc, error: insErr } = await supabase.from("patient_documents")
        .insert({
          practice_id: practiceId,
          patient_id: patientId,
          name: name.trim(),
          document_type: docType,
          document_date: docDate || null,
          notes: notes.trim() || null,
          storage_path: practiceId + "/" + patientId + "/PENDING-" + crypto.randomUUID() + "." + ext,
          mime_type: file.type || "application/octet-stream",
          file_size_bytes: file.size,
          uploaded_by: profile.id,
          uploaded_by_name: uploaderName,
        })
        .select()
        .single();
      if (insErr) throw insErr;
      docId = doc.id;

      // Now upload to the real path keyed by doc.id
      const realPath = practiceId + "/" + patientId + "/" + doc.id + "." + ext;
      const { error: upErr } = await supabase.storage.from("patient-documents")
        .upload(realPath, file, { contentType: file.type || "application/octet-stream", upsert: false });
      if (upErr) throw upErr;

      const { error: updErr } = await supabase.from("patient_documents")
        .update({ storage_path: realPath })
        .eq("id", doc.id);
      if (updErr) throw updErr;

      onUploaded();
    } catch (e) {
      // Roll back the metadata row if we created one but the upload failed
      if (docId) {
        try { await supabase.from("patient_documents").delete().eq("id", docId); }
        catch (_e) { /* swallow; rollback is best-effort */ }
      }
      setError(e.message || String(e));
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal title="Upload Document" onClose={uploading ? () => {} : onClose} maxWidth={520}>
      {error && (
        <div style={{
          padding: "8px 12px",
          background: "#fef2f2",
          border: "1px solid " + C.red,
          borderRadius: 6,
          color: C.red,
          marginBottom: 14,
          fontSize: 12,
        }}>{error}</div>
      )}

      <FL>File *</FL>
      <input
        type="file"
        accept={ACCEPTED_MIME}
        onChange={handleFileChange}
        disabled={uploading}
        style={{
          width: "100%",
          padding: "8px 0",
          marginBottom: 14,
          fontSize: 13,
          fontFamily: "inherit",
        }}
      />
      {file && (
        <div style={{ fontSize: 11, color: C.textTertiary, marginTop: -10, marginBottom: 14 }}>
          {file.name} · {formatBytes(file.size)}
        </div>
      )}

      <Input label="Document Name *" value={name} onChange={setName} placeholder="e.g. CBC results 5/1/26" />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Select label="Type" value={docType} onChange={setDocType} options={DOCUMENT_TYPES} />
        <Input label="Document Date" type="date" value={docDate} onChange={setDocDate} />
      </div>

      <Textarea label="Notes" value={notes} onChange={setNotes} rows={3} placeholder="e.g. From LabCorp, A1c 8.4 elevated; reviewed with patient 5/2" />

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
        <Btn variant="outline" onClick={onClose} disabled={uploading}>Cancel</Btn>
        <Btn onClick={handleUpload} disabled={uploading || !file}>{uploading ? "Uploading..." : "Upload"}</Btn>
      </div>
    </Modal>
  );
}
