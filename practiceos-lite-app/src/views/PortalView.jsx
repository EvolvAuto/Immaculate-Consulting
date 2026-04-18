// ═══════════════════════════════════════════════════════════════════════════════
// PortalView — patient-facing portal (role=Patient)
// Uses patients_self_read RLS policies. This is routed separately from staff nav.
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useState, useRef } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../auth/AuthProvider";
import { C } from "../lib/tokens";
import { insertRow, updateRow } from "../lib/db";
import { APPT_STATUS_VARIANT, ageFromDOB, slotToTime } from "../components/constants";
import { Badge, Btn, Card, Modal, Input, Textarea, Select, TopBar, TabBar, SectionHead, Loader, ErrorBanner, EmptyState, FL } from "../components/ui";

export default function PortalView() {
  const { profile, practiceId } = useAuth();
  const [tab, setTab] = useState("home");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState({ patient: null, appts: [], labs: [], threads: [], insurance: [] });

  useEffect(() => {
    if (!profile?.patient_id) { setLoading(false); return; }
    (async () => {
      try {
        setLoading(true);
        const patientId = profile.patient_id;
        const [patient, appts, labs, threads, ins] = await Promise.all([
          supabase.from("patients").select("*").eq("id", patientId).single(),
          supabase.from("appointments").select("*, providers(first_name, last_name)").eq("patient_id", patientId).order("appt_date", { ascending: false }).limit(20),
          supabase.from("lab_results").select("*").eq("patient_id", patientId).eq("released_to_portal", true).order("resulted_at", { ascending: false }).limit(20),
          supabase.from("message_threads").select("*, messages(id, body, direction, created_at, sender_label, is_read)").eq("patient_id", patientId).order("last_message_at", { ascending: false }),
          supabase.from("insurance_policies").select("*").eq("patient_id", patientId).eq("is_active", true).order("rank"),
        ]);
        if (patient.error) throw patient.error;
        setData({
          patient: patient.data,
          appts: appts.data || [],
          labs: labs.data || [],
          threads: threads.data || [],
          insurance: ins.data || [],
        });
      } catch (e) { setError(e.message); }
      finally { setLoading(false); }
    })();
  }, [profile?.patient_id]);

  if (loading) return <Loader label="Loading your portal..." />;

  if (!profile?.patient_id) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Card style={{ maxWidth: 480, textAlign: "center", padding: 32 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔐</div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Patient portal account required</div>
          <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 8 }}>
            Your user account isn't linked to a patient record yet. Please contact the practice to enable portal access.
          </div>
        </Card>
      </div>
    );
  }

  const upcoming = data.appts.filter((a) => new Date(a.appt_date) >= new Date(new Date().toDateString()) && !["Cancelled", "No Show", "Completed"].includes(a.status));
  const unreadMessages = data.threads.reduce((s, t) => s + (t.messages || []).filter((m) => m.direction === "Outbound" && !m.is_read).length, 0);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar title={`Welcome, ${data.patient?.first_name || "Patient"}`} sub="Your health, one place"
        actions={<TabBar
          tabs={[
            ["home", "Home"],
            ["appts", `Appointments`],
            ["labs", `Lab Results${data.labs.length ? ` (${data.labs.length})` : ""}`],
            ["messages", `Messages${unreadMessages ? ` (${unreadMessages})` : ""}`],
            ["profile", "Profile"],
          ]}
          active={tab} onChange={setTab} />} />

      <div style={{ flex: 1, overflowY: "auto", padding: 24, maxWidth: 960, margin: "0 auto", width: "100%" }}>
        {error && <ErrorBanner message={error} />}

        {tab === "home" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {upcoming[0] && (
              <Card style={{ background: `linear-gradient(135deg, ${C.tealBg}, ${C.bgPrimary})`, borderLeft: `4px solid ${C.teal}`, padding: 20 }}>
                <Badge label="Next Appointment" variant="teal" />
                <div style={{ fontSize: 20, fontWeight: 700, marginTop: 10 }}>
                  {new Date(upcoming[0].appt_date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                </div>
                <div style={{ fontSize: 14, color: C.textSecondary, marginTop: 4 }}>
                  {slotToTime(upcoming[0].start_slot)} · {upcoming[0].appt_type}
                  {upcoming[0].providers && ` with Dr. ${upcoming[0].providers.first_name} ${upcoming[0].providers.last_name}`}
                </div>
                {upcoming[0].status === "Scheduled" && (
                  <Btn style={{ marginTop: 16 }} onClick={async () => {
                    await updateRow("appointments", upcoming[0].id, { status: "Confirmed", confirmation_status: "Patient Confirmed" });
                    setData((p) => ({ ...p, appts: p.appts.map((a) => a.id === upcoming[0].id ? { ...a, status: "Confirmed" } : a) }));
                  }}>Confirm Appointment</Btn>
                )}
              </Card>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              <Card onClick={() => setTab("labs")} style={{ textAlign: "center", padding: 20 }}>
                <div style={{ fontSize: 28, marginBottom: 6 }}>🧪</div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{data.labs.length}</div>
                <div style={{ fontSize: 11, color: C.textTertiary }}>Lab results available</div>
              </Card>
              <Card onClick={() => setTab("messages")} style={{ textAlign: "center", padding: 20 }}>
                <div style={{ fontSize: 28, marginBottom: 6 }}>💬</div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{unreadMessages}</div>
                <div style={{ fontSize: 11, color: C.textTertiary }}>Unread messages</div>
              </Card>
              <Card onClick={() => setTab("appts")} style={{ textAlign: "center", padding: 20 }}>
                <div style={{ fontSize: 28, marginBottom: 6 }}>📅</div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{upcoming.length}</div>
                <div style={{ fontSize: 11, color: C.textTertiary }}>Upcoming visits</div>
              </Card>
            </div>
          </div>
        )}

        {tab === "appts" && (
          <>
            <SectionHead title="Appointments" />
            {data.appts.length === 0 ? <EmptyState icon="📅" title="No appointments on file" />
              : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {data.appts.map((a) => (
                  <Card key={a.id}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{ minWidth: 140 }}>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{a.appt_date}</div>
                        <div style={{ fontSize: 11, color: C.textTertiary }}>{slotToTime(a.start_slot)}</div>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{a.appt_type}</div>
                        {a.providers && <div style={{ fontSize: 11, color: C.textTertiary }}>Dr. {a.providers.first_name} {a.providers.last_name}</div>}
                      </div>
                      <Badge label={a.status} variant={APPT_STATUS_VARIANT[a.status] || "neutral"} size="xs" />
                    </div>
                  </Card>
                ))}
              </div>}
          </>
        )}

        {tab === "labs" && (
          <>
            <SectionHead title="Lab Results" sub="Released to you by your provider" />
            {data.labs.length === 0 ? <EmptyState icon="🧪" title="No lab results available" sub="Results appear here after your provider reviews and releases them." />
              : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {data.labs.map((l) => (
                  <Card key={l.id} style={{ borderLeft: l.is_critical ? `3px solid ${C.red}` : l.is_abnormal ? `3px solid ${C.amber}` : `3px solid ${C.green}` }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{l.test_name}</div>
                        <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>
                          {l.lab_name} · {l.resulted_at && new Date(l.resulted_at).toLocaleDateString()}
                        </div>
                        {l.patient_notes && <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 8, padding: 8, background: C.bgSecondary, borderRadius: 6 }}>
                          <b>Note from your care team:</b> {l.patient_notes}
                        </div>}
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 16, fontWeight: 700, color: l.is_critical ? C.red : l.is_abnormal ? C.amber : C.green }}>
                          {l.result_value} {l.result_unit}
                        </div>
                        {l.reference_range && <div style={{ fontSize: 10, color: C.textTertiary }}>Ref: {l.reference_range}</div>}
                        {l.is_abnormal && <Badge label={l.is_critical ? "Critical" : "Abnormal"} variant={l.is_critical ? "red" : "amber"} size="xs" />}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>}
          </>
        )}

        {tab === "messages" && <PortalMessages threads={data.threads} profile={profile} patientId={profile.patient_id} practiceId={practiceId} onReload={() => {/* refresh */}} />}

        {tab === "profile" && data.patient && (
          <div>
            <SectionHead title="Your Information" sub="Contact your practice to update any details" />
            <Card>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <Field label="Name" value={`${data.patient.first_name} ${data.patient.last_name}`} />
                <Field label="Date of Birth" value={`${data.patient.date_of_birth} (${ageFromDOB(data.patient.date_of_birth)} y/o)`} />
                <Field label="Phone" value={data.patient.phone_mobile} />
                <Field label="Email" value={data.patient.email} />
                <Field label="Address" value={[data.patient.address_line1, data.patient.city, data.patient.state, data.patient.zip].filter(Boolean).join(", ")} span={2} />
                <Field label="Preferred Language" value={data.patient.preferred_language} />
                <Field label="Pronouns" value={data.patient.pronouns} />
              </div>
            </Card>

            <div style={{ marginTop: 20 }}>
              <SectionHead title="Insurance on File" />
              {data.insurance.length === 0 ? <EmptyState title="No insurance on file" />
                : data.insurance.map((i) => (
                  <Card key={i.id} style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{i.payer_name}</div>
                    <div style={{ fontSize: 11, color: C.textTertiary }}>{i.payer_category} · Rank {i.rank}</div>
                    <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 4, fontFamily: "monospace" }}>Member ID: {i.member_id}</div>
                  </Card>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const Field = ({ label, value, span = 1 }) => (
  <div style={{ gridColumn: `span ${span}` }}>
    <FL>{label}</FL>
    <div style={{ fontSize: 13, color: value ? C.textPrimary : C.textTertiary }}>{value || "—"}</div>
  </div>
);

function PortalMessages({ threads, profile, patientId, practiceId }) {
  const [active, setActive] = useState(threads[0] || null);
  const [draft, setDraft] = useState("");
  const [newThread, setNewThread] = useState(false);
  const [newSubject, setNewSubject] = useState("");

  const send = async () => {
    if (!draft.trim() || !active) return;
    try {
      await insertRow("messages", {
        thread_id: active.id, patient_id: patientId,
        direction: "Inbound", channel: "Portal", body: draft,
        sender_user_id: profile.id, sender_label: profile.full_name,
      }, practiceId);
      await updateRow("message_threads", active.id, { last_message_at: new Date().toISOString() });
      setDraft("");
      alert("Message sent. Your care team will respond soon.");
    } catch (e) { alert(e.message); }
  };

  const startNew = async () => {
    if (!newSubject.trim() || !draft.trim()) { alert("Subject and message required"); return; }
    try {
      const t = await insertRow("message_threads", {
        patient_id: patientId, subject: newSubject, last_message_at: new Date().toISOString(),
      }, practiceId);
      await insertRow("messages", {
        thread_id: t.id, patient_id: patientId, direction: "Inbound", channel: "Portal",
        body: draft, sender_user_id: profile.id, sender_label: profile.full_name,
      }, practiceId);
      setNewThread(false); setNewSubject(""); setDraft("");
      alert("Message sent.");
    } catch (e) { alert(e.message); }
  };

  if (newThread) {
    return (
      <Card>
        <SectionHead title="New Message" action={<Btn variant="ghost" size="sm" onClick={() => setNewThread(false)}>Cancel</Btn>} />
        <Input label="Subject" value={newSubject} onChange={setNewSubject} />
        <Textarea label="Message" value={draft} onChange={setDraft} rows={6} />
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Btn onClick={startNew}>Send Message</Btn>
        </div>
      </Card>
    );
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <SectionHead title="Messages" sub="Communicate securely with your care team" />
        <Btn size="sm" onClick={() => setNewThread(true)}>+ New Message</Btn>
      </div>
      {threads.length === 0 ? <EmptyState icon="💬" title="No messages yet" sub="Send a message to your care team." />
        : <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 12, height: 480 }}>
          <div style={{ border: `0.5px solid ${C.borderLight}`, borderRadius: 8, overflowY: "auto" }}>
            {threads.map((t) => (
              <div key={t.id} onClick={() => setActive(t)}
                style={{ padding: 12, borderBottom: `0.5px solid ${C.borderLight}`, cursor: "pointer", background: active?.id === t.id ? C.bgSecondary : "transparent" }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{t.subject || "(no subject)"}</div>
                <div style={{ fontSize: 10, color: C.textTertiary }}>{t.last_message_at && new Date(t.last_message_at).toLocaleDateString()}</div>
              </div>
            ))}
          </div>
          <div style={{ border: `0.5px solid ${C.borderLight}`, borderRadius: 8, display: "flex", flexDirection: "column" }}>
            {!active ? <EmptyState title="Select a thread" />
              : <>
                <div style={{ padding: 12, borderBottom: `0.5px solid ${C.borderLight}`, fontSize: 13, fontWeight: 700 }}>{active.subject}</div>
                <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                  {(active.messages || []).map((m) => (
                    <div key={m.id} style={{
                      maxWidth: "80%", padding: "8px 12px", borderRadius: 10,
                      alignSelf: m.direction === "Inbound" ? "flex-end" : "flex-start",
                      background: m.direction === "Inbound" ? C.teal : C.bgSecondary,
                      color: m.direction === "Inbound" ? "#fff" : C.textPrimary,
                    }}>
                      <div style={{ fontSize: 12 }}>{m.body}</div>
                      <div style={{ fontSize: 9, opacity: 0.7, marginTop: 2 }}>{new Date(m.created_at).toLocaleString()}</div>
                    </div>
                  ))}
                </div>
                {!active.is_closed && (
                  <div style={{ padding: 8, borderTop: `0.5px solid ${C.borderLight}`, display: "flex", gap: 6 }}>
                    <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Type a reply..."
                      style={{ flex: 1, padding: "8px 10px", border: `0.5px solid ${C.borderMid}`, borderRadius: 6, fontSize: 12, fontFamily: "inherit", outline: "none" }} />
                    <Btn size="sm" onClick={send}>Send</Btn>
                  </div>
                )}
              </>}
          </div>
        </div>}
    </>
  );
}
