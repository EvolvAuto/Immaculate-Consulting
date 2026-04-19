// ═══════════════════════════════════════════════════════════════════════════════
// src/views/portal/PortalAppointments.jsx
// Upcoming + past appointments. Cancellation creates a staff task. Request
// appointment also creates a task (simpler than the waitlist_entries schema for v1).
// Live schema: appointments.status (not appt_status), cancelled_reason, tasks
// require source='Portal' per RLS.
// ═══════════════════════════════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import { supabase, logAudit } from "../../lib/supabaseClient";
import {
  C, Panel, Badge, Btn, Field, SectionHead, Select, TextArea, Input,
  Toast, InfoBox, Empty, fmtDate, slotToTime,
} from "./_ui.jsx";

export default function PortalAppointments({ patient, patientId, practiceId }) {
  const [upcoming, setUpcoming]   = useState([]);
  const [past, setPast]           = useState([]);
  const [providers, setProviders] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [toast, setToast]         = useState(null);

  const [cancelFor, setCancelFor]       = useState(null);
  const [cancelReason, setCancelReason] = useState("");

  const [reqType, setReqType]           = useState("Follow-up");
  const [reqProvider, setReqProvider]   = useState("");
  const [reqPreferred, setReqPreferred] = useState("");
  const [reqReason, setReqReason]       = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const [up, pa, pr] = await Promise.all([
          supabase.from("appointments")
            .select("id, appt_date, start_slot, duration_slots, appt_type, status, provider_id, room_id, notes")
            .eq("patient_id", patientId).gte("appt_date", today)
            .not("status", "in", "(Cancelled,Completed,No Show)")
            .order("appt_date", { ascending:true }).order("start_slot", { ascending:true }),
          supabase.from("appointments")
            .select("id, appt_date, start_slot, appt_type, status, provider_id")
            .eq("patient_id", patientId).lt("appt_date", today)
            .in("status", ["Completed","No Show","Cancelled"])
            .order("appt_date", { ascending:false }).limit(20),
          supabase.from("providers")
            .select("id, first_name, last_name, credential, specialty")
            .eq("practice_id", practiceId).eq("is_active", true),
        ]);
        if (!active) return;
        setUpcoming(up.data || []);
        setPast(pa.data || []);
        setProviders(pr.data || []);
        logAudit({ action:"Read", entityType:"appointments", entityId:patientId }).catch(()=>{});
      } catch (e) {
        console.warn("[appts] load failed:", e?.message || e);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [patientId, practiceId]);

  const providerLabel = (id) => {
    const p = providers.find(x => x.id === id);
    return p ? ("Dr. " + p.first_name + " " + p.last_name + ", " + p.credential) : "Your provider";
  };

  const submitCancel = async () => {
    if (!cancelFor) return;
    try {
      const providerName = providerLabel(cancelFor.provider_id);
      const dateStr = fmtDate(cancelFor.appt_date) + " at " + slotToTime(cancelFor.start_slot);
      const { error } = await supabase.from("tasks").insert({
        practice_id: practiceId,
        title: "Patient cancellation request: " + cancelFor.appt_type,
        description: "Patient " + patient.first_name + " " + patient.last_name +
                     " (MRN " + (patient.mrn || "--") + ") has requested cancellation of their " +
                     cancelFor.appt_type + " with " + providerName + " on " + dateStr +
                     ". Reason: " + (cancelReason || "not provided") + ". " +
                     "Please contact the patient to confirm and reschedule as needed.",
        category: "Follow Up",
        priority: "Normal",
        status:   "Open",
        patient_id: patientId,
        appointment_id: cancelFor.id,
        source: "Portal",
      });
      if (error) throw error;

      logAudit({
        action:"Create", entityType:"task", entityId:null,
        details:{ source:"portal", kind:"cancel_request", appointment_id:cancelFor.id },
      }).catch(()=>{});

      setToast("Cancellation request sent. Our staff will contact you to confirm.");
      setCancelFor(null);
      setCancelReason("");
      setTimeout(() => setToast(null), 5000);
    } catch (e) {
      setToast("Could not submit request: " + (e.message || e));
      setTimeout(() => setToast(null), 5000);
    }
  };

  const submitRequest = async () => {
    try {
      const { error } = await supabase.from("tasks").insert({
        practice_id: practiceId,
        title: "Patient appointment request: " + reqType,
        description: "Patient " + patient.first_name + " " + patient.last_name +
                     " (MRN " + (patient.mrn || "--") + ") requested an appointment via the portal.\n\n" +
                     "Type: " + reqType + "\n" +
                     "Preferred provider: " + (reqProvider ? providerLabel(reqProvider) : "any") + "\n" +
                     "Preferred date: " + (reqPreferred || "any") + "\n" +
                     "Reason: " + (reqReason || "not provided"),
        category: "Admin",
        priority: "Normal",
        status:   "Open",
        patient_id: patientId,
        source: "Portal",
      });
      if (error) throw error;

      logAudit({
        action:"Create", entityType:"appointment_request", entityId:null,
        details:{ source:"portal", appt_type:reqType, preferred_date:reqPreferred },
      }).catch(()=>{});

      setRequesting(false);
      setReqReason(""); setReqPreferred(""); setReqProvider("");
      setToast("Appointment request submitted. Our scheduling team will reach out shortly.");
      setTimeout(() => setToast(null), 5000);
    } catch (e) {
      setToast("Could not submit request: " + (e.message || e));
      setTimeout(() => setToast(null), 5000);
    }
  };

  if (loading) return <Empty title="Loading your appointments..." />;

  return (
    <div>
      <Toast show={!!toast} msg={toast || ""} />

      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
        <div style={{
          fontSize:10, textTransform:"uppercase", letterSpacing:"0.06em",
          color:C.textTertiary, fontWeight:600,
        }}>Upcoming</div>
        <Btn onClick={()=>setRequesting(!requesting)}>
          {requesting ? "Cancel" : "+ Request Appointment"}
        </Btn>
      </div>

      {requesting && (
        <Panel accent={C.tealMid}>
          <SectionHead title="Request an Appointment" />
          <InfoBox>
            This is a request, not a booking. Our scheduling team will contact you within
            one business day to confirm a time that works.
          </InfoBox>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <Field label="Appointment Type">
              <Select value={reqType} onChange={setReqType}
                      options={["New Patient","Follow-up","Annual Exam","Procedure","Telehealth","Walk-in"]} />
            </Field>
            <Field label="Preferred Provider">
              <Select value={reqProvider} onChange={setReqProvider}
                      options={[{value:"",label:"Any provider"},
                        ...providers.map(p => ({ value:p.id, label:"Dr. " + p.last_name + ", " + p.credential }))]} />
            </Field>
          </div>
          <Field label="Preferred Date (optional)">
            <Input type="date" value={reqPreferred} onChange={setReqPreferred} />
          </Field>
          <Field label="Reason for Visit">
            <TextArea value={reqReason} onChange={setReqReason} rows={3}
                      placeholder="Briefly describe what you would like to discuss..." />
          </Field>
          <div style={{ display:"flex", gap:8 }}>
            <Btn onClick={submitRequest}>Submit Request</Btn>
            <Btn variant="secondary" onClick={()=>setRequesting(false)}>Cancel</Btn>
          </div>
        </Panel>
      )}

      {upcoming.length === 0 && !requesting && (
        <Empty title="No upcoming appointments" subtitle="Use the Request button above to ask for one." />
      )}

      {upcoming.map(a => (
        <Panel key={a.id} accent={C.amberMid}>
          <div style={{ display:"flex", justifyContent:"space-between", flexWrap:"wrap", gap:10 }}>
            <div style={{ flex:1, minWidth:220 }}>
              <div style={{
                fontSize:10, fontWeight:600, color:C.amber,
                textTransform:"uppercase", letterSpacing:"0.04em",
              }}>{fmtDate(a.appt_date)} at {slotToTime(a.start_slot)}</div>
              <div style={{ fontSize:14, fontWeight:600, color:C.textPrimary, marginTop:3 }}>{a.appt_type}</div>
              <div style={{ fontSize:11, color:C.textSecondary, marginTop:2 }}>{providerLabel(a.provider_id)}</div>
              <div style={{ marginTop:6, display:"flex", gap:6 }}>
                <Badge label={a.status} variant={a.status === "Confirmed" ? "teal" : "amber"} />
                <Badge label={durLabel(a.duration_slots)} variant="neutral" />
              </div>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              <Btn variant="secondary" onClick={() => setCancelFor(a)}>Request Cancel</Btn>
            </div>
          </div>
          {cancelFor && cancelFor.id === a.id && (
            <div style={{
              marginTop:10, padding:"10px 12px", borderRadius:7,
              background:C.redBg, border:"0.5px solid " + C.redBorder,
            }}>
              <div style={{ fontSize:12, color:C.red, fontWeight:600, marginBottom:8 }}>
                Are you sure? A staff member will contact you to confirm and discuss rescheduling.
              </div>
              <Field label="Reason (optional)">
                <TextArea value={cancelReason} onChange={setCancelReason} rows={2}
                          placeholder="Briefly tell us why you need to cancel..." />
              </Field>
              <div style={{ display:"flex", gap:8 }}>
                <Btn variant="danger" onClick={submitCancel}>Submit Cancellation Request</Btn>
                <Btn variant="secondary" onClick={() => { setCancelFor(null); setCancelReason(""); }}>
                  Keep Appointment
                </Btn>
              </div>
            </div>
          )}
        </Panel>
      ))}

      <div style={{
        fontSize:10, textTransform:"uppercase", letterSpacing:"0.06em",
        color:C.textTertiary, margin:"16px 0 8px", fontWeight:600,
      }}>Past Visits</div>
      {past.length === 0 && <Empty title="No past visits on record" />}
      {past.map(p => (
        <Panel key={p.id} style={{ display:"flex", justifyContent:"space-between",
          alignItems:"center", flexWrap:"wrap", gap:8 }}>
          <div>
            <div style={{ fontSize:11, color:C.textTertiary }}>{fmtDate(p.appt_date)}</div>
            <div style={{ fontSize:13, fontWeight:600, color:C.textPrimary, marginTop:2 }}>{p.appt_type}</div>
            <div style={{ fontSize:11, color:C.textSecondary, marginTop:1 }}>{providerLabel(p.provider_id)}</div>
          </div>
          <Badge label={p.status} variant={
            p.status === "Completed" ? "teal" :
            p.status === "No Show"   ? "red"  : "neutral"
          } />
        </Panel>
      ))}
    </div>
  );
}

function durLabel(slots) {
  const mins = (slots || 0) * 15;
  if (mins < 60) return mins + " min";
  return Math.floor(mins/60) + "h" + (mins % 60 ? " " + (mins % 60) + "m" : "");
}
