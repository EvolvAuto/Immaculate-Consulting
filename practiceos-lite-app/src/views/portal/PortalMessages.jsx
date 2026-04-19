// ═══════════════════════════════════════════════════════════════════════════════
// src/views/portal/PortalMessages.jsx
// Secure messaging. RLS limits threads + messages to the patient's own.
// Live schema:
//   - messages.direction = 'Inbound' (from patient) / 'Outbound' (from staff)
//   - messages.channel = 'Portal' when sent from here
//   - messages.sender_user_id / sender_label / is_read
//   - messages.patient_id (denormalized for RLS)
//   - message_threads.is_closed (bool, not a status enum)
//   - message_threads.provider_id - if provider inactive, thread is read-only
// ═══════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { supabase, logAudit } from "../../lib/supabaseClient";
import {
  C, Panel, Badge, Btn, Field, SectionHead, Select, TextArea, Input,
  Toast, InfoBox, Empty, fmtDateTime,
} from "./_ui.jsx";

export default function PortalMessages({ patient, patientId, practiceId }) {
  const { user } = useAuth();
  const [threads, setThreads]     = useState([]);
  const [messagesByThread, setMessagesByThread] = useState({});
  const [providers, setProviders] = useState([]);
  const [expanded, setExpanded]   = useState(null);
  const [composing, setComposing] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null);
  const [loading, setLoading]     = useState(true);
  const [toast, setToast]         = useState(null);

  const [toProvider, setToProvider] = useState("");
  const [subject, setSubject]       = useState("");
  const [body, setBody]             = useState("");
  const [replyBody, setReplyBody]   = useState("");

  const load = async () => {
    const [th, pr] = await Promise.all([
      supabase.from("message_threads")
        .select("id, subject, provider_id, is_closed, last_message_at, created_at")
        .eq("patient_id", patientId)
        .order("last_message_at", { ascending:false, nullsFirst:false })
        .limit(40),
      supabase.from("providers")
        .select("id, first_name, last_name, credential, specialty, is_active")
        .eq("practice_id", practiceId),
    ]);
    setThreads(th.data || []);
    setProviders(pr.data || []);

    if (th.data && th.data.length > 0) {
      const { data: msgs } = await supabase.from("messages")
        .select("id, thread_id, direction, channel, body, sender_user_id, sender_label, is_read, read_at, created_at")
        .in("thread_id", th.data.map(x => x.id))
        .order("created_at", { ascending:true });
      const byThread = {};
      (msgs || []).forEach(m => {
        if (!byThread[m.thread_id]) byThread[m.thread_id] = [];
        byThread[m.thread_id].push(m);
      });
      setMessagesByThread(byThread);
    }
    logAudit({ action:"Read", entityType:"messages", entityId:patientId }).catch(()=>{});
  };

  useEffect(() => {
    let active = true;
    (async () => { try { await load(); } finally { if (active) setLoading(false); } })();

    const channel = supabase.channel("portal-messages-" + patientId)
      .on("postgres_changes",
          { event:"INSERT", schema:"public", table:"messages", filter:"patient_id=eq." + patientId },
          () => { load(); })
      .subscribe();
    return () => { active = false; supabase.removeChannel(channel); };
  }, [patientId, practiceId]);

  const activeProviders = useMemo(() => providers.filter(p => p.is_active), [providers]);

  const providerLabel = (id) => {
    const p = providers.find(x => x.id === id);
    if (!p) return "Your care team";
    return "Dr. " + p.last_name + ", " + p.credential;
  };

  const isProviderDeparted = (id) => {
    const p = providers.find(x => x.id === id);
    return p ? p.is_active === false : false;
  };

  const markThreadRead = async (threadId) => {
    const unread = (messagesByThread[threadId] || []).filter(m => !m.is_read && m.direction === "Outbound");
    if (unread.length === 0) return;
    await supabase.from("messages")
      .update({ is_read:true, read_at:new Date().toISOString() })
      .in("id", unread.map(u => u.id));
  };

  const toggleThread = async (t) => {
    if (expanded === t.id) { setExpanded(null); return; }
    setExpanded(t.id);
    await markThreadRead(t.id);
    await load();
  };

  const patientLabel = (patient.first_name || "") + " " + (patient.last_name || "");

  const sendNew = async () => {
    if (!toProvider || !subject || !body) {
      setToast("Please fill in all fields.");
      setTimeout(()=>setToast(null),3000); return;
    }
    try {
      const { data: thread, error: tErr } = await supabase.from("message_threads").insert({
        practice_id:      practiceId,
        patient_id:       patientId,
        provider_id:      toProvider,
        subject,
        is_closed:        false,
        last_message_at:  new Date().toISOString(),
      }).select().single();
      if (tErr) throw tErr;

      const { error: mErr } = await supabase.from("messages").insert({
        thread_id:       thread.id,
        practice_id:     practiceId,
        patient_id:      patientId,
        direction:       "Inbound",
        channel:         "Portal",
        subject,
        body,
        sender_user_id:  user?.id || null,
        sender_label:    patientLabel.trim(),
        is_read:         false,
      });
      if (mErr) throw mErr;

      logAudit({ action:"Create", entityType:"message_thread", entityId:thread.id }).catch(()=>{});

      setComposing(false);
      setToProvider(""); setSubject(""); setBody("");
      setToast("Message sent securely. Expect a response within 1 business day.");
      setTimeout(()=>setToast(null), 5000);
      await load();
    } catch (e) {
      setToast("Could not send message: " + (e.message || e));
      setTimeout(()=>setToast(null), 5000);
    }
  };

  const sendReply = async (threadId) => {
    if (!replyBody.trim()) return;
    try {
      const { error } = await supabase.from("messages").insert({
        thread_id:       threadId,
        practice_id:     practiceId,
        patient_id:      patientId,
        direction:       "Inbound",
        channel:         "Portal",
        body:            replyBody,
        sender_user_id:  user?.id || null,
        sender_label:    patientLabel.trim(),
        is_read:         false,
      });
      if (error) throw error;
      await supabase.from("message_threads")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", threadId);
      logAudit({ action:"Create", entityType:"message", entityId:threadId }).catch(()=>{});
      setReplyBody("");
      setReplyingTo(null);
      await load();
    } catch (e) {
      setToast("Could not send reply: " + (e.message || e));
      setTimeout(()=>setToast(null), 5000);
    }
  };

  if (loading) return <Empty title="Loading messages..." />;

  return (
    <div>
      <Toast show={!!toast} msg={toast || ""} />

      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
        <div style={{ fontSize:13, fontWeight:600, color:C.textPrimary }}>Secure Messaging</div>
        <Btn onClick={()=>setComposing(!composing)}>
          {composing ? "Cancel" : "+ New Message"}
        </Btn>
      </div>

      {composing && (
        <Panel accent={C.tealMid}>
          <SectionHead title="New Secure Message" />
          <Field label="To">
            <Select value={toProvider} onChange={setToProvider}
                    options={[{value:"",label:"Select a provider..."},
                      ...activeProviders.map(p => ({
                        value: p.id,
                        label: "Dr. " + p.last_name + ", " + p.credential + (p.specialty ? " - " + p.specialty : ""),
                      }))]} />
          </Field>
          <Field label="Subject">
            <Input value={subject} onChange={setSubject} placeholder="Brief subject..." />
          </Field>
          <Field label="Message">
            <TextArea value={body} onChange={setBody} rows={4}
                      placeholder="Describe your question or concern..." />
          </Field>
          <div style={{ display:"flex", gap:8 }}>
            <Btn onClick={sendNew}>Send Message</Btn>
            <Btn variant="secondary" onClick={()=>setComposing(false)}>Cancel</Btn>
          </div>
          <div style={{ fontSize:10.5, color:C.textTertiary, marginTop:10, lineHeight:1.55 }}>
            For emergencies, call 911. For urgent medical concerns after hours, call the
            practice directly - messages are only checked during business hours.
          </div>
        </Panel>
      )}

      {threads.length === 0 && <Empty title="No message threads yet" subtitle="Use + New Message to start a conversation with your care team." />}

      {threads.map(t => {
        const thisMsgs = messagesByThread[t.id] || [];
        const lastMsg = thisMsgs[thisMsgs.length - 1];
        const hasUnread = thisMsgs.some(m => !m.is_read && m.direction === "Outbound");
        const departed = isProviderDeparted(t.provider_id);
        const open = expanded === t.id;

        return (
          <Panel key={t.id} style={{
            cursor:"pointer",
            borderLeft: hasUnread ? "3px solid " + C.tealMid : undefined,
          }}>
            <div onClick={() => toggleThread(t)} style={{
              display:"flex", justifyContent:"space-between", alignItems:"flex-start",
            }}>
              <div style={{ flex:1 }}>
                {departed && <div style={{ marginBottom:4 }}>
                  <Badge label="Provider No Longer at Practice" variant="red" />
                </div>}
                {t.is_closed && <div style={{ marginBottom:4 }}>
                  <Badge label="Thread Closed" variant="neutral" />
                </div>}
                <div style={{ fontSize:13, fontWeight:600, color:C.textPrimary }}>
                  {t.subject || "(no subject)"}
                </div>
                <div style={{ fontSize:11, color:C.textTertiary, marginTop:1 }}>
                  {providerLabel(t.provider_id)}
                  {lastMsg ? " - " + fmtDateTime(lastMsg.created_at) : ""}
                </div>
                {!open && lastMsg && (
                  <div style={{
                    fontSize:12, color:C.textSecondary, marginTop:6,
                    overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                  }}>
                    {lastMsg.direction === "Inbound" ? "You: " : ""}{lastMsg.body}
                  </div>
                )}
              </div>
              <div style={{ fontSize:10, color:C.textTertiary, padding:"0 4px" }}>
                {open ? "\u25B2" : "\u25BC"}
              </div>
            </div>

            {open && (
              <div style={{
                marginTop:12, borderTop:"0.5px solid " + C.borderLight, paddingTop:12,
              }}>
                {departed && (
                  <InfoBox variant="red">
                    This provider is no longer at this practice. The thread is read-only -
                    new messages are routed to your current care team.
                  </InfoBox>
                )}
                {thisMsgs.map(m => (
                  <div key={m.id} style={{
                    marginBottom:10, padding:"10px 12px", borderRadius:7,
                    background: m.direction === "Inbound" ? C.bgSecondary : C.tealBg,
                    border: "0.5px solid " + (m.direction === "Inbound" ? C.borderLight : C.tealBorder),
                  }}>
                    <div style={{
                      fontSize:10, fontWeight:600, color:C.textTertiary,
                      textTransform:"uppercase", letterSpacing:"0.04em", marginBottom:4,
                    }}>
                      {m.direction === "Inbound" ? (m.sender_label || "You") : (m.sender_label || "Care Team")}
                      {" - "}{fmtDateTime(m.created_at)}
                    </div>
                    <div style={{ fontSize:12, color:C.textPrimary, lineHeight:1.6, whiteSpace:"pre-wrap" }}>
                      {m.body}
                    </div>
                  </div>
                ))}

                {!departed && !t.is_closed && replyingTo !== t.id && (
                  <Btn variant="ghost" onClick={() => { setReplyingTo(t.id); setReplyBody(""); }}>Reply</Btn>
                )}

                {!departed && !t.is_closed && replyingTo === t.id && (
                  <div style={{ marginTop:6 }}>
                    <TextArea value={replyBody} onChange={setReplyBody} rows={3}
                              placeholder="Type your reply..." />
                    <div style={{ display:"flex", gap:6, marginTop:6 }}>
                      <Btn onClick={() => sendReply(t.id)}>Send Reply</Btn>
                      <Btn variant="secondary" onClick={()=>{ setReplyingTo(null); setReplyBody(""); }}>Cancel</Btn>
                    </div>
                  </div>
                )}
              </div>
            )}
          </Panel>
        );
      })}
    </div>
  );
}
