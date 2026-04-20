// ═══════════════════════════════════════════════════════════════════════════════
// OutreachReviewView - review and send Pro outreach drafts.
// Route: /pro/outreach  or  /pro/outreach/{batchId}
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { C } from "../../lib/tokens";
import { Btn, Card, Loader, ErrorBanner, EmptyState, Modal, TopBar, Badge } from "../../components/ui";
import ProGate from "../../components/pro/ProGate";
import {
  proApi,
  listOutreachBatches,
  fetchBatchWithDrafts,
  updateDraftBody,
  updateDraftStatus,
} from "../../lib/proApi";

export default function OutreachReviewView({ batchId: initialBatchId }) {
  return (
    <ProGate feature="Outreach review">
      <OutreachInner initialBatchId={initialBatchId} />
    </ProGate>
  );
}

function OutreachInner({ initialBatchId }) {
  const { practiceId } = useAuth();
  const [activeBatchId, setActiveBatchId] = useState(initialBatchId || null);
  const [batches, setBatches] = useState([]);
  const [error, setError] = useState(null);

  const loadBatches = async () => {
    try {
      const rows = await listOutreachBatches();
      setBatches(rows);
      if (!activeBatchId && rows.length > 0) setActiveBatchId(rows[0].id);
    } catch (e) { setError(e.message); }
  };

  useEffect(() => { if (practiceId) loadBatches(); }, [practiceId]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar title="Outreach Review" sub="Review AI-drafted patient messages before sending" />
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div style={{ width: 320, borderRight: "0.5px solid " + C.borderLight, overflowY: "auto" }}>
          {error && <ErrorBanner message={error} />}
          {batches.length === 0 ? (
            <div style={{ padding: 20 }}>
              <EmptyState
                icon="📬"
                title="No outreach batches"
                sub="Go to AI Practice Assistant, ask a question that returns patients, and click 'Draft outreach'."
              />
            </div>
          ) : (
            batches.map((b) => (
              <BatchRow
                key={b.id}
                batch={b}
                active={b.id === activeBatchId}
                onClick={() => setActiveBatchId(b.id)}
              />
            ))
          )}
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
          {activeBatchId ? (
            <BatchDetail batchId={activeBatchId} onChanged={loadBatches} />
          ) : (
            <EmptyState icon="👈" title="Select a batch" sub="Pick a batch on the left to review drafts." />
          )}
        </div>
      </div>
    </div>
  );
}

function BatchRow({ batch, active, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: "12px 14px",
        cursor: "pointer",
        background: active ? (C.tealBg || "#E6F4EF") : "transparent",
        borderLeft: active ? "3px solid " + (C.teal || "#1D9E75") : "3px solid transparent",
        borderBottom: "0.5px solid " + C.borderLight,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>{batch.title}</div>
      <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 4 }}>
        {new Date(batch.created_at).toLocaleString()}
      </div>
      <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Badge>{batch.total_drafts} drafts</Badge>
        {batch.drafts_sent > 0 && <Badge color="green">{batch.drafts_sent} sent</Badge>}
        {batch.drafts_approved > 0 && <Badge color="teal">{batch.drafts_approved} approved</Badge>}
        {batch.drafts_rejected > 0 && <Badge color="red">{batch.drafts_rejected} rejected</Badge>}
      </div>
    </div>
  );
}

function BatchDetail({ batchId, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    try {
      setLoading(true); setError(null);
      const { batch, drafts } = await fetchBatchWithDrafts(batchId);
      setData({ batch, drafts });
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [batchId]);

  if (error) return <ErrorBanner message={error} />;
  if (!data || loading) return <Loader />;

  const { batch, drafts } = data;
  const draftCount = drafts.filter((d) => d.status === "Draft").length;
  const approvedCount = drafts.filter((d) => d.status === "Approved").length;

  return (
    <div style={{ maxWidth: 820, margin: "0 auto" }}>
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.textPrimary }}>{batch.title}</div>
            <div style={{ fontSize: 12, color: C.textTertiary, marginTop: 4 }}>
              Created {new Date(batch.created_at).toLocaleString()}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Badge>{batch.total_drafts} total</Badge>
            <Badge color="green">{batch.drafts_sent} sent</Badge>
          </div>
        </div>
        {batch.context_summary && (
          <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 8, lineHeight: 1.4 }}>
            Context: {batch.context_summary}
          </div>
        )}
        {batch.template_used && (
          <div style={{ marginTop: 10, padding: 10, background: "#FAFBFC", border: "0.5px solid " + C.borderLight, borderRadius: 6 }}>
            <div style={{ fontSize: 10, color: C.textTertiary, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 }}>Template</div>
            <div style={{ fontSize: 13, color: C.textPrimary, fontFamily: "ui-monospace, monospace" }}>{batch.template_used}</div>
          </div>
        )}
      </Card>

      <div style={{ marginTop: 16, fontSize: 11, color: C.textTertiary, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase" }}>
        Drafts
      </div>
      {drafts.length === 0 ? (
        <Card style={{ marginTop: 10 }}>
          <div style={{ color: C.textTertiary, fontSize: 13 }}>No drafts in this batch.</div>
        </Card>
      ) : (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
          {drafts.map((d) => (
            <DraftRow key={d.id} draft={d} onChanged={() => { load(); onChanged && onChanged(); }} />
          ))}
        </div>
      )}
    </div>
  );
}

function DraftRow({ draft, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(draft.final_body || draft.draft_body || "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const patient = draft.patients || {};
  const name = (patient.first_name || "") + " " + (patient.last_name || "");
  const isDraftOrApproved = draft.status === "Draft" || draft.status === "Approved";
  const isSent = draft.status === "Sent";
  const isRejected = draft.status === "Rejected";

  const saveEdit = async () => {
    try {
      setSaving(true); setErr(null);
      await updateDraftBody(draft.id, editText);
      setEditing(false);
      onChanged();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const setStatus = async (status) => {
    try {
      setSaving(true); setErr(null);
      await updateDraftStatus(draft.id, status);
      onChanged();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const send = async () => {
    if (!confirm("Send this message now?")) return;
    try {
      setSaving(true); setErr(null);
      await proApi.outreachSend({ draftId: draft.id });
      onChanged();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const statusBadge = isSent ? <Badge color="green">Sent</Badge>
    : isRejected ? <Badge color="red">Rejected</Badge>
    : draft.status === "Approved" ? <Badge color="teal">Approved</Badge>
    : <Badge>Draft</Badge>;

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary }}>{name.trim() || "Unknown patient"}</div>
            {statusBadge}
            {draft.channel !== "SMS" && <Badge>{draft.channel}</Badge>}
            {patient.sms_opt_out && <Badge color="red">SMS opt-out</Badge>}
            {!patient.phone_mobile && draft.channel === "SMS" && <Badge color="red">No phone</Badge>}
          </div>
          <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>
            MRN {patient.mrn || "-"} - {patient.phone_mobile || "no phone"}
          </div>
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        {editing ? (
          <>
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              rows={3}
              style={{
                width: "100%", padding: 10,
                border: "0.5px solid " + C.borderLight,
                borderRadius: 6, fontSize: 13, fontFamily: "inherit",
                color: C.textPrimary, resize: "vertical", boxSizing: "border-box",
              }}
            />
            <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 4 }}>
              {editText.length} chars
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
              <Btn size="sm" variant="secondary" onClick={() => { setEditing(false); setEditText(draft.final_body || draft.draft_body || ""); }}>
                Cancel
              </Btn>
              <Btn size="sm" onClick={saveEdit} disabled={saving}>{saving ? "Saving..." : "Save edit"}</Btn>
            </div>
          </>
        ) : (
          <div style={{
            padding: 10, background: "#FAFBFC",
            border: "0.5px solid " + C.borderLight, borderRadius: 6,
            fontSize: 13, color: C.textPrimary, lineHeight: 1.45, whiteSpace: "pre-wrap",
          }}>
            {draft.final_body || draft.draft_body}
          </div>
        )}
      </div>

      {err && <div style={{ fontSize: 12, color: "#DC2626", marginTop: 6 }}>{err}</div>}
      {draft.error_message && <div style={{ fontSize: 12, color: "#DC2626", marginTop: 6 }}>{draft.error_message}</div>}

      {isDraftOrApproved && !editing && (
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10 }}>
          <Btn size="sm" variant="secondary" onClick={() => setEditing(true)}>Edit</Btn>
          {draft.status === "Draft" && (
            <Btn size="sm" variant="secondary" onClick={() => setStatus("Rejected")} disabled={saving}>Reject</Btn>
          )}
          {draft.status === "Draft" && (
            <Btn size="sm" variant="secondary" onClick={() => setStatus("Approved")} disabled={saving}>Approve</Btn>
          )}
          <Btn size="sm" onClick={send} disabled={saving}>Send now</Btn>
        </div>
      )}
      {isSent && draft.sent_at && (
        <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 8, textAlign: "right" }}>
          Sent {new Date(draft.sent_at).toLocaleString()}
        </div>
      )}
    </Card>
  );
}
