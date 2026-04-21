// ═══════════════════════════════════════════════════════════════════════════════
// src/views/portal/PortalDashboard.jsx
// Patient landing page. Matches live schema:
//   - appointments.status (not appt_status)
//   - messages.is_read + direction='Outbound' for "unread from staff" count
//   - insurance_policies.rank (1 = primary), is_active, no eligibility_status
// ═══════════════════════════════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import { supabase, logAudit } from "../../lib/supabaseClient";
import { C, Panel, Badge, Btn, SectionHead, fmtDate, slotToTime } from "./_ui.jsx";

export default function PortalDashboard({ patient, practice, patientId, practiceId, goTab }) {
  const [providers, setProviders]       = useState([]);
  const [nextAppt, setNextAppt]         = useState(null);
  const [unreadCount, setUnreadCount]   = useState(0);
  const [pendingForms, setPendingForms] = useState(0);
  const [insurance, setInsurance]       = useState(null);
  const [recentPayments, setRecentPayments] = useState(0);
  const [hrsnSchedule, setHrsnSchedule] = useState(null);
  const [hrsnLastResponse, setHrsnLastResponse] = useState(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const today = new Date().toISOString().slice(0, 10);

        const [provRes, apptRes, msgRes, formRes, insRes, payRes] = await Promise.all([
          supabase.from("providers")
            .select("id, first_name, last_name, credential, specialty, color, is_active")
            .eq("practice_id", practiceId).eq("is_active", true),
          supabase.from("appointments")
            .select("id, appt_date, start_slot, duration_slots, appt_type, status, provider_id, room_id, notes")
            .eq("patient_id", patientId).gte("appt_date", today)
            .in("status", ["Scheduled","Confirmed","Checked In"])
            .order("appt_date", { ascending:true }).order("start_slot", { ascending:true })
            .limit(1),
          supabase.from("messages")
            .select("id", { count:"exact", head:true })
            .eq("patient_id", patientId)
            .eq("direction", "Outbound")
            .eq("is_read", false),
          supabase.from("portal_form_submissions")
            .select("id", { count:"exact", head:true })
            .eq("patient_id", patientId).eq("status", "Draft"),
          supabase.from("insurance_policies")
            .select("id, payer_name, member_id, is_active, rank")
            .eq("patient_id", patientId).eq("rank", 1).maybeSingle(),
          supabase.from("copay_collections")
            .select("amount")
            .eq("patient_id", patientId)
            .gte("collected_at", new Date(Date.now() - 90*24*60*60*1000).toISOString()),
        ]);

        if (!active) return;
        setProviders(provRes.data || []);
        setNextAppt((apptRes.data || [])[0] || null);
        setUnreadCount(msgRes.count || 0);
        setPendingForms(formRes.count || 0);
        setInsurance(insRes.data || null);
        setRecentPayments(
          (payRes.data || []).reduce((s, r) => s + Number(r.amount || 0), 0)
        );

        logAudit({
          action: "Read",
          entityType: "portal_dashboard",
          entityId:   patientId,
        }).catch(() => {});
      } catch (e) {
        console.warn("[dashboard] load failed:", e?.message || e);
      }
    })();
    return () => { active = false; };
  }, [patientId, practiceId]);

  // Separate HRSN fetch - scoped to Pro/Command practices only so Lite
  // patients don't get an invisible-to-staff screening CTA.
  useEffect(() => {
    const tier = practice && practice.subscription_tier;
    if (tier !== "Pro" && tier !== "Command") return;
    let active = true;
    (async () => {
      try {
        const [schedRes, respRes] = await Promise.all([
          supabase.from("patient_screening_schedule")
            .select("id, due_date, cadence_months, last_screened_at")
            .eq("patient_id", patientId)
            .eq("screener_type", "HRSN")
            .maybeSingle(),
          supabase.from("screener_responses")
            .select("id, completed_at")
            .eq("patient_id", patientId)
            .eq("screener_type", "HRSN")
            .order("completed_at", { ascending: false })
            .limit(1),
        ]);
        if (!active) return;
        setHrsnSchedule(schedRes.data || null);
        setHrsnLastResponse((respRes.data || [])[0] || null);
      } catch (e) {
        console.warn("[dashboard] HRSN fetch failed:", e && e.message ? e.message : e);
      }
    })();
    return () => { active = false; };
  }, [patientId, practice]);

  // Derive whether to show the HRSN screening CTA panel
  const hrsnState = (() => {
    const tier = practice && practice.subscription_tier;
    if (tier !== "Pro" && tier !== "Command") return { show: false };

    // Recently screened? Don't nudge them again.
    if (hrsnLastResponse) {
      const daysSince = (Date.now() - new Date(hrsnLastResponse.completed_at).getTime()) / 86400000;
      if (daysSince < 14) return { show: false };
    }

    // Scheduled for later? Don't nudge yet.
    if (hrsnSchedule && hrsnSchedule.due_date) {
      const due = new Date(hrsnSchedule.due_date + "T00:00:00");
      if (due > new Date()) return { show: false };
    }

    // Show - differentiate first-time from re-screen for copy
    const isFirstTime = !hrsnLastResponse;
    return { show: true, isFirstTime: isFirstTime, lastScreenedAt: hrsnLastResponse && hrsnLastResponse.completed_at };
  })();

  const firstName = patient.first_name || "";
  const insuranceOk = insurance && insurance.is_active;

  const statusItems = [
    { ok: pendingForms === 0,       okLabel:"Forms: up to date",     warnLabel: pendingForms + " form" + (pendingForms===1?"":"s") + " pending" },
    { ok: insuranceOk,              okLabel:"Insurance: active",     warnLabel: insurance ? "Insurance: needs review" : "No insurance on file" },
    { ok: !!nextAppt,               okLabel: nextAppt ? ("Next visit: " + fmtDate(nextAppt.appt_date)) : "",
                                    warnLabel:"No upcoming appointment" },
  ];

  const kpis = [
    { label:"Next Appointment",
      value: nextAppt ? fmtDate(nextAppt.appt_date) : "None",
      sub:   nextAppt ? slotToTime(nextAppt.start_slot) : "Contact us to book",
      color: nextAppt ? C.teal : C.textTertiary },
    { label:"Unread Messages",
      value: String(unreadCount),
      sub:   unreadCount > 0 ? "From care team" : "All caught up",
      color: unreadCount > 0 ? C.amber : C.textTertiary },
    { label:"Recent Payments",
      value: "$" + recentPayments.toFixed(2),
      sub:   recentPayments > 0 ? "Last 90 days" : "No recent payments",
      color: C.teal },
    { label:"Forms Pending",
      value: String(pendingForms),
      sub:   pendingForms > 0 ? "Complete before visit" : "None",
      color: pendingForms > 0 ? C.purple : C.textTertiary },
  ];

  return (
    <div>
      <div style={{ marginBottom:14 }}>
        <div style={{ fontSize:17, fontWeight:600, color:C.textPrimary }}>
          {greeting()}, {firstName}
        </div>
        <div style={{ fontSize:12, color:C.textSecondary, marginTop:3 }}>
          Here is a quick look at your care with {practice ? practice.name : "your practice"}.
        </div>
      </div>

      <div style={{
        display:"flex", gap:6, flexWrap:"wrap", padding:"10px 12px",
        background:C.bgPrimary, border:"0.5px solid " + C.borderLight, borderRadius:10,
        marginBottom:12,
      }}>
        {statusItems.map((s, i) => (
          <div key={i} style={{
            display:"flex", alignItems:"center", gap:6, padding:"4px 10px",
            background: s.ok ? C.tealBg : C.amberBg, borderRadius:20, fontSize:10.5,
            color: s.ok ? C.teal : C.amber, fontWeight:600,
          }}>
            <span style={{
              width:6, height:6, borderRadius:"50%",
              background: s.ok ? C.tealMid : C.amberMid,
            }} />
            {s.ok ? s.okLabel : s.warnLabel}
          </div>
        ))}
      </div>

      <div style={{
        display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(170px, 1fr))",
        gap:10, marginBottom:14,
      }}>
        {kpis.map((k, i) => (
          <div key={i} style={{
            background:C.bgPrimary, border:"0.5px solid " + C.borderLight, borderRadius:10,
            padding:"12px 14px",
          }}>
            <div style={{
              fontSize:9.5, fontWeight:600, textTransform:"uppercase",
              letterSpacing:"0.06em", color:C.textTertiary, marginBottom:5,
            }}>{k.label}</div>
            <div style={{ fontSize:20, fontWeight:700, color:k.color, letterSpacing:"-0.01em" }}>{k.value}</div>
            <div style={{ fontSize:10.5, color:C.textSecondary, marginTop:2 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      <Panel>
        <SectionHead
          title="Your Care Team"
          subtitle={"Active providers at " + (practice ? practice.name : "your practice")}
        />
        {providers.length === 0 && (
          <div style={{ padding:"14px 6px", fontSize:12, color:C.textTertiary }}>
            No active providers on file yet.
          </div>
        )}
        <div style={{
          display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(200px, 1fr))", gap:10,
        }}>
          {providers.slice(0, 6).map(p => {
            const initials = ((p.first_name || "")[0] || "") + ((p.last_name || "")[0] || "");
            return (
              <div key={p.id} style={{
                border:"0.5px solid " + C.borderLight, borderRadius:9, padding:"10px 12px",
                background:C.bgSecondary,
              }}>
                <div style={{ display:"flex", gap:9, alignItems:"center", marginBottom:6 }}>
                  <div style={{
                    width:34, height:34, borderRadius:"50%",
                    background: p.color ? p.color + "22" : C.tealBg, color: p.color || C.teal,
                    fontSize:12, fontWeight:700, display:"flex",
                    alignItems:"center", justifyContent:"center",
                  }}>{initials.toUpperCase()}</div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:12, fontWeight:600, color:C.textPrimary, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                      Dr. {p.last_name}, {p.credential}
                    </div>
                    <div style={{ fontSize:10, color:C.textTertiary }}>{p.specialty}</div>
                  </div>
                </div>
                <Btn variant="ghost" style={{ width:"100%" }} onClick={() => goTab("messages")}>
                  Send Message
                </Btn>
              </div>
            );
          })}
        </div>
      </Panel>

     {nextAppt && (
        <Panel accent={C.amberMid}>
          <SectionHead
            title="Upcoming Appointment"
            right={<Btn variant="ghost" onClick={()=>goTab("appointments")}>View all</Btn>}
          />
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, flexWrap:"wrap" }}>
            <div>
              <div style={{ fontSize:10, fontWeight:600, color:C.amber, textTransform:"uppercase", letterSpacing:"0.04em" }}>
                {fmtDate(nextAppt.appt_date)} at {slotToTime(nextAppt.start_slot)}
              </div>
              <div style={{ fontSize:14, fontWeight:600, color:C.textPrimary, marginTop:3 }}>
                {nextAppt.appt_type}
              </div>
              <div style={{ marginTop:4 }}>
                <Badge label={nextAppt.status} variant={nextAppt.status === "Confirmed" ? "teal" : "amber"} />
              </div>
            </div>
            <div style={{ display:"flex", gap:6 }}>
              {pendingForms > 0 && (
                <Btn variant="primary" onClick={()=>goTab("forms")}>
                  Complete Forms ({pendingForms})
                </Btn>
              )}
            </div>
          </div>
        </Panel>
      )}

      {hrsnState.show && (
        <Panel accent={C.tealMid}>
          <SectionHead
            title={hrsnState.isFirstTime ? "Help us care for your whole health" : "Time for your check-in"}
          />
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, flexWrap:"wrap" }}>
            <div style={{ flex:1, minWidth:240 }}>
              <div style={{ fontSize:10, fontWeight:600, color:C.teal, textTransform:"uppercase", letterSpacing:"0.04em", marginBottom:4 }}>
                Social Needs Screening
              </div>
              <div style={{ fontSize:13, color:C.textSecondary, lineHeight:1.55 }}>
                {hrsnState.isFirstTime
                  ? "Your care team wants to understand the things outside the exam room that affect your health - food, housing, transportation, and more. Your answers stay private. Takes about 3 minutes."
                  : "Check in with your care team about the things outside the exam room - food, housing, transportation, and more. Let us know if anything has changed. Takes about 3 minutes."}
              </div>
            </div>
            <div style={{ display:"flex", gap:6 }}>
              <Btn variant="primary" onClick={()=>goTab("hrsn")}>
                {hrsnState.isFirstTime ? "Start screening" : "Update my screening"}
              </Btn>
            </div>
          </div>
        </Panel>
      )}

      <Panel>
        <SectionHead title="Quick Actions" />
        <div style={{
          display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(140px, 1fr))", gap:8,
        }}>
          {[
            { lbl:"Send Message",      tab:"messages"     },
            { lbl:"Request Refill",    tab:"medications"  },
            { lbl:"View Labs",         tab:"labs"         },
            { lbl:"Billing History",   tab:"billing"      },
            { lbl:"Complete Forms",    tab:"forms"        },
            { lbl:"Update Insurance",  tab:"insurance"    },
          ].map(a => (
            <button key={a.tab} onClick={()=>goTab(a.tab)} style={{
              background:C.bgSecondary, border:"0.5px solid " + C.borderLight,
              borderRadius:8, padding:"14px 10px", cursor:"pointer",
              fontSize:11.5, fontWeight:600, color:C.textPrimary, fontFamily:"inherit",
            }}>{a.lbl}</button>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}
