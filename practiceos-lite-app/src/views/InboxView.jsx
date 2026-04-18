// ═══════════════════════════════════════════════════════════════════════════════
// InboxView — message_threads + messages with realtime + practitioner-compose
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../auth/AuthProvider";
import { C } from "../lib/tokens";
import { insertRow, updateRow, subscribeTable, logRead } from "../lib/db";
import { initialsOf } from "../components/constants";
import { Badge, Btn, Card, Modal, Input, Textarea, TopBar, TabBar, Avatar, Loader, ErrorBanner, EmptyState } from "../components/ui";
import { PatientPicker } from "./TasksView";

export default function InboxView() {
  const { practiceId, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [threads, setThreads] = useState([]);
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState("open");
  const [composing, setComposing] = useState(false);
  const endRef = useRef(null);

  const loadThreads = async () => {
    try {
      const { data, error } = await supabase.from("message_threads")
        .select("*, patients(first_name, last_name), providers(first_name, last_name), messages(id, body, is_read, created_at, direction)")
        .order("last_message_at", { ascending: false }).limit(100);
      if (error) throw error;
      setThreads(data || []);
    } catch (e) { setError(e.message); }
  };

  useEffect(() => {
    if (!practiceId) return;
    loadThreads().finally(() => setLoading(false));
    const u1 = subscribeTable("message_threads", { practiceId, onChange: loadThreads });
    const u2 = subscribeTable("messages", { practiceId, onChange: () => { loadThreads(); if (active) loadMessages(active.id); } });
    return () => { u1(); u2(); };
  }, [practiceId]);

  const loadMessages = async (threadId) => {
    try {
      const { data, error } = await supabase.from("messages").select("*").eq("thread_id", threadId).order("created_at");
      if (error) throw error;
      setMessages(data || []);
      await supabase.from("messages").update({ is_read: true, read_at: new Date().toISOString() })
        .eq("thread_id", threadId).eq("direction", "Inbound").eq("is_read", false);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (e) { setError(e.message); }
  };

  const openThread = async (t) => { setActive(t); await loadMessages(t.id); if (t.patient_id) await logRead("message_threads", t.id, t.patient_id); };

  const send = async () => {
    if (!draft.trim() || !active) return;
    try {
      await insertRow("messages", {
        thread_id: active.id, patient_id: active.patient_id,
        direction: "Outbound", channel: "Portal",
        body: draft, sender_user_id: profile.id, sender_label: profile.full_name,
      }, practiceId, { audit: { entityType: "messages", patientId: active.patient_id } });
      await updateRow("message_threads", active.id, { last_message_at: new Date().toISOString() });
      setDraft("");
      await loadMessages(active.id);
    } catch (e) { setError(e.message); }
  };

  const closeThread = async () => {
    if (!active) return;
    try {
      await updateRow("message_threads", active.id, { is_closed: true, closed_at: new Date().toISOString() });
      setActive({ ...active, is_closed: true });
      loadThreads();
    } catch (e) { setError(e.message); }
  };

  const startNewThread = async ({ patient, subject, body }) => {
    try {
      const t = await insertRow("message_threads", {
        patient_id: patient.id, subject, last_message_at: new Date().toISOString(),
      }, practiceId, { audit: { entityType: "message_threads", patientId: patient.id } });
      await insertRow("messages", {
        thread_id: t.id, patient_id: patient.id,
        direction: "Outbound", channel: "Portal", body,
        sender_user_id: profile.id, sender_label: profile.full_name,
      }, practiceId, { audit: { entityType: "messages", patientId: patient.id } });
      setComposing(false);
      await loadThreads();
      // Open the new thread
      const newThread = { ...t, patients: patient, messages: [] };
      setActive(newThread);
      loadMessages(t.id);
    } catch (e) { alert(e.message); }
  };

  if (loading) return <div style={{ flex: 1 }}><TopBar title="Inbox" /><Loader /></div>;

  const filtered = threads.filter((t) => filter === "open" ? !t.is_closed : filter === "closed" ? t.is_closed : true);
  const unreadCount = (t) => (t.messages || []).filter((m) => m.direction === "Inbound" && !m.is_read).length;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar title="Inbox" sub={`${filtered.length} threads`}
        actions={<>
          <TabBar tabs={[["open", "Open"], ["closed", "Closed"], ["all", "All"]]} active={filter} onChange={setFilter} />
          <Btn size="sm" onClick={() => setComposing(true)}>✉ New Message</Btn>
        </>} />

      {error && <div style={{ padding: 12 }}><ErrorBanner message={error} /></div>}

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div style={{ width: 340, borderRight: `0.5px solid ${C.borderLight}`, overflowY: "auto", background: C.bgPrimary }}>
          {filtered.length === 0 ? <EmptyState icon="✉" title="No threads" sub="Compose a new message to start a conversation." />
            : filtered.map((t) => {
              const last = (t.messages || []).slice(-1)[0];
              const unread = unreadCount(t);
              return (
                <div key={t.id} onClick={() => openThread(t)}
                  style={{
                    padding: "12px 14px", borderBottom: `0.5px solid ${C.borderLight}`,
                    cursor: "pointer", display: "flex", gap: 10,
                    background: active?.id === t.id ? C.bgSecondary : "transparent",
                  }}>
                  <Avatar initials={initialsOf(t.patients?.first_name, t.patients?.last_name)} size={32} color={unread > 0 ? C.teal : C.textTertiary} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                      <div style={{ fontSize: 13, fontWeight: unread > 0 ? 700 : 500, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {t.patients ? `${t.patients.first_name} ${t.patients.last_name}` : "Unknown"}
                      </div>
                      {unread > 0 && <Badge label={unread} variant="teal" size="xs" />}
                    </div>
                    <div style={{ fontSize: 11, color: C.textTertiary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t.subject || last?.body?.slice(0, 40) || "—"}
                    </div>
                  </div>
                </div>
              );
            })}
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", background: C.bgTertiary }}>
          {!active ? <EmptyState icon="💬" title="Select a conversation" sub="Choose a thread to view messages, or compose a new one." />
            : <>
              <div style={{ padding: "12px 20px", background: C.bgPrimary, borderBottom: `0.5px solid ${C.borderLight}`, display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{active.patients ? `${active.patients.first_name} ${active.patients.last_name}` : "Unknown"}</div>
                  <div style={{ fontSize: 11, color: C.textTertiary }}>{active.subject || "No subject"}</div>
                </div>
                {!active.is_closed && <Btn size="sm" variant="ghost" onClick={closeThread}>Close thread</Btn>}
                {active.is_closed && <Badge label="Closed" variant="neutral" />}
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 10 }}>
                {messages.map((m) => (
                  <div key={m.id} style={{ display: "flex", justifyContent: m.direction === "Outbound" ? "flex-end" : "flex-start" }}>
                    <div style={{
                      maxWidth: "70%", padding: "10px 14px", borderRadius: 12,
                      background: m.direction === "Outbound" ? C.teal : C.bgPrimary,
                      color: m.direction === "Outbound" ? "#fff" : C.textPrimary,
                      border: m.direction === "Outbound" ? "none" : `0.5px solid ${C.borderLight}`,
                    }}>
                      <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{m.body}</div>
                      <div style={{ fontSize: 10, opacity: 0.7, marginTop: 4 }}>
                        {m.sender_label || (m.direction === "Inbound" ? "Patient" : "You")} ·{" "}
                        {new Date(m.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={endRef} />
              </div>
              {!active.is_closed && (
                <div style={{ padding: 12, background: C.bgPrimary, borderTop: `0.5px solid ${C.borderLight}`, display: "flex", gap: 8 }}>
                  <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Type a reply..."
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                    style={{ flex: 1, padding: "9px 12px", border: `1px solid ${C.borderMid}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", outline: "none" }} />
                  <Btn onClick={send}>Send</Btn>
                </div>
              )}
            </>}
        </div>
      </div>

      {composing && <ComposeModal onClose={() => setComposing(false)} onSend={startNewThread} />}
    </div>
  );
}

function ComposeModal({ onClose, onSend }) {
  const [patient, setPatient] = useState(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const submit = () => {
    if (!patient) return alert("Pick a patient");
    if (!subject.trim()) return alert("Subject is required");
    if (!body.trim()) return alert("Message body is required");
    onSend({ patient, subject: subject.trim(), body: body.trim() });
  };

  return (
    <Modal title="New Message to Patient" onClose={onClose} maxWidth={540}>
      <PatientPicker value={patient} onChange={setPatient} placeholder="Search patient by name or MRN..." />
      <Input label="Subject *" value={subject} onChange={setSubject} placeholder="e.g. Lab results available" />
      <Textarea label="Message *" value={body} onChange={setBody} rows={6}
        placeholder="Hi, your recent lab results have been released to your portal..." />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        <Btn onClick={submit}>Send Message</Btn>
      </div>
      <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 10, textAlign: "center" }}>
        The patient will see this in their portal. If they've opted into SMS, they'll also receive a notification.
      </div>
    </Modal>
  );
}
