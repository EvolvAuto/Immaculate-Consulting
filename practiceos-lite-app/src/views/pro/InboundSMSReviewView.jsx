// ═══════════════════════════════════════════════════════════════════════════════
// InboundSMSReviewView - inbound SMS inbox with AI-drafted reply suggestions.
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../auth/AuthProvider";
import { C } from "../../lib/tokens";
import { Btn, Card, Loader, ErrorBanner, EmptyState, TopBar, Badge } from "../../components/ui";
import ProGate from "../../components/pro/ProGate";
import {
  proApi,
  listInboundSmsWithDrafts,
  listInboundSmsNeedingDraft,
} from "../../lib/proApi";

export default function InboundSMSReviewView() {
  return (
    <ProGate feature="Inbound SMS assistant">
      <InboundInner />
    </ProGate>
  );
}

function InboundInner() {
  const { practiceId } = useAuth();
  const [needsDraft, setNeedsDraft] = useState([]);
  const [withDrafts, setWithDrafts] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      setLoading(true); setError(null);
      const [a, b] = await Promise.all([
        listInboundSmsNeedingDraft(),
        listInboundSmsWithDrafts(),
      ]);
      setNeedsDraft(a);
      setWithDrafts(b);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (practiceId) load(); }, [practiceId]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar title="Inbound SMS" sub="AI-drafted replies for patient messages - staff reviews before sending" />
      <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
        {error && <ErrorBanner message={error} />}
        {loading ? <Loader /> : (
          <div style={{ maxWidth: 820, margin: "0 auto" }}>
            <Section title="Needs AI draft" count={needsDraft.length}>
              {needsDraft.length === 0 ? (
                <EmptyState icon="📭" title="Inbox clear" sub="No inbound SMS is waiting for a draft." />
              ) : (
                needsDraft.map((m) => <NeedsDraftRow key={m.id} msg={m} onDone={load} />)
              )}
            </Section>

            <Section title="Drafts ready for review" count={withDrafts.filter((d) => d.status === "Draft" || d.status === "Escalated").length}>
              {withDrafts.length === 0 ? (
                <div style={{ fontSize: 13, color: C.textTertiary, padding: 8 }}>Nothing yet.</div>
              ) : (
                withDrafts.map((d) => <DraftReplyRow key={d.id} draft={d} onChanged={load} />)
              )}
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, count, children }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: C.textTertiary, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase" }}>{title}</div>
        <Badge>{count}</Badge>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{children}</div>
    </div>
  );
}

function NeedsDraftRow({ msg, onDone }) {
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState(null);
  const p = msg.patients || {};
  const name = ((p.first_name || "") + " " + (p.last_name || "")).trim() || "Unknown";

  const run = async () => {
    try {
      setRunning(true); setErr(null);
      await proApi.inboundSmsDraft({ messageId: msg.id });
      onDone();
    } catch (e) { setErr(e.message); }
    finally { setRunning(false); }
  };

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary }}>{name}</div>
          <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>
            MRN {p.mrn || "-"} - {new Date(msg.created_at).toLocaleString()}
          </div>
        </div>
        <Btn size="sm" onClick={run} disabled={running}>
          {running ? "Drafting..." : "Generate AI draft"}
        </Btn>
      </div>
      <div style={{ marginTop: 10, padding: 10, background: "#FAFBFC", border: "0.5px solid " + C.borderLight, borderRadius: 6, fontSize: 13, color: C.textPrimary, whiteSpace: "pre-wrap" }}>
        {msg.body}
      </div>
      {err && <div style={{ fontSize: 12, color: "#DC2626", marginTop: 6 }}>{err}</div>}
    </Card>
  );
}

function DraftReplyRow({ draft, onChanged }) {
  const inbound = draft.messages || {};
  const p = inbound.patients || {};
  const name = ((p.first_name || "") + " " + (p.last_name || "")).trim() || "Unknown";

  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(draft.final_body || draft.draft_body || "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const isEscalated = draft.status === "Escalated";
  const isSent = draft.status === "Sent";
  const isRejected = draft.status === "Rejected";

  const save = async () => {
    try {
      setSaving(true); setErr(null);
      const { error } = await supabase
        .from("pro_inbound_sms_drafts")
        .update({ edited_body: editText })
        .eq("id", draft.id);
      if (error) throw new Error(error.message);
      setEditing(false);
      onChanged();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const setStatus = async (status) => {
    try {
      setSaving(true); setErr(null);
      const { error } = await supabase
        .from("pro_inbound_sms_drafts")
        .update({ status })
        .eq("id", draft.id);
      if (error) throw new Error(error.message);
      onChanged();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const sendReply = async () => {
    if (!confirm("Send this reply now?")) return;
    try {
      setSaving(true); setErr(null);
      // Insert outbound message into messages table
      const finalBody = editText && editText.trim() ? editText.trim() : (draft.final_body || draft.draft_body);
      const { data: outMsg, error } = await supabase
        .from("messages")
        .insert({
          practice_id: draft.practice_id,
          patient_id: draft.patient_id,
          direction: "Outbound",
          channel: "SMS",
          body: finalBody,
          thread_id: inbound.thread_id || null,
          delivery_status: "Queued",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      await supabase
        .from("pro_inbound_sms_drafts")
        .update({ status: "Sent", sent_at: new Date().toISOString(), sent_message_id: outMsg.id, edited_body: editText || null })
        .eq("id", draft.id);
      onChanged();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary }}>{name}</div>
            {isSent && <Badge color="green">Sent</Badge>}
            {isRejected && <Badge color="red">Rejected</Badge>}
            {isEscalated && <Badge color="red">Escalated - urgent</Badge>}
            {draft.classification && !isEscalated && <Badge>{draft.classification}</Badge>}
            {draft.confidence !== null && draft.confidence !== undefined && (
              <Badge>{Math.round(Number(draft.confidence) * 100)}%</Badge>
            )}
          </div>
          <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>
            MRN {p.mrn || "-"} - {p.phone_mobile || "no phone"} - {inbound.created_at ? new Date(inbound.created_at).toLocaleString() : ""}
          </div>
        </div>
      </div>

      {inbound.body && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 10, color: C.textTertiary, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 }}>Inbound</div>
          <div style={{ padding: 10, background: "#FAFBFC", border: "0.5px solid " + C.borderLight, borderRadius: 6, fontSize: 13, color: C.textPrimary, whiteSpace: "pre-wrap" }}>
            {inbound.body}
          </div>
        </div>
      )}

      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 10, color: C.textTertiary, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 }}>AI draft reply</div>
        {editing ? (
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
        ) : (
          <div style={{
            padding: 10,
            background: isEscalated ? "#FEF2F2" : "#ECFDF5",
            border: "0.5px solid " + (isEscalated ? "#FCA5A5" : "#A7F3D0"),
            borderRadius: 6, fontSize: 13, color: C.textPrimary, lineHeight: 1.45, whiteSpace: "pre-wrap",
          }}>
            {draft.final_body || draft.draft_body}
          </div>
        )}
      </div>

      {err && <div style={{ fontSize: 12, color: "#DC2626", marginTop: 6 }}>{err}</div>}

      {!isSent && !isRejected && (
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10 }}>
          {editing ? (
            <>
              <Btn size="sm" variant="secondary" onClick={() => { setEditing(false); setEditText(draft.final_body || draft.draft_body); }}>Cancel</Btn>
              <Btn size="sm" onClick={save} disabled={saving}>{saving ? "Saving..." : "Save edit"}</Btn>
            </>
          ) : (
            <>
              <Btn size="sm" variant="secondary" onClick={() => setEditing(true)}>Edit</Btn>
              <Btn size="sm" variant="secondary" onClick={() => setStatus("Rejected")} disabled={saving}>Reject</Btn>
              <Btn size="sm" onClick={sendReply} disabled={saving}>
                {isEscalated ? "Send urgent reply" : "Send reply"}
              </Btn>
            </>
          )}
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
