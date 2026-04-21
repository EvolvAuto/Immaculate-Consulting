// ═══════════════════════════════════════════════════════════════════════════════
// src/views/PortalShell.jsx
// Patient-role shell rendered by App.jsx when useAuth().role === "Patient".
// Owns the sidebar, top bar, badges, and routes between portal views.
// Matches live schema (messages.is_read, patients.portal_user_id, etc.).
// ═══════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../auth/AuthProvider";
import { supabase, logAudit } from "../lib/supabaseClient";

import PortalDashboard     from "./portal/PortalDashboard.jsx";
import PortalAppointments  from "./portal/PortalAppointments.jsx";
import PortalMessages      from "./portal/PortalMessages.jsx";
import PortalVisits        from "./portal/PortalVisits.jsx";
import PortalLabs          from "./portal/PortalLabs.jsx";
import PortalTrends        from "./portal/PortalTrends.jsx";
import PortalMedications   from "./portal/PortalMedications.jsx";
import PortalForms         from "./portal/PortalForms.jsx";
import PortalInsurance     from "./portal/PortalInsurance.jsx";
import PortalBilling       from "./portal/PortalBilling.jsx";
import PortalDocuments     from "./portal/PortalDocuments.jsx";
import PatientProxyManager from "./portal/PatientProxyManager.jsx";
import AccountSwitcher     from "./portal/AccountSwitcher.jsx";
import PortalHRSNView      from "./portal/PortalHRSNView.jsx";

const C = {
  teal:"#0F6E56", tealMid:"#1D9E75", tealBg:"#E1F5EE", tealBorder:"#9FE1CB", tealDark:"#085041",
  amber:"#854F0B", amberBg:"#FAEEDA", amberBorder:"#FAC775", amberMid:"#D08A2E",
  red:"#A32D2D", redBg:"#FCEBEB", redBorder:"#F5B8B8",
  bgPrimary:"#ffffff", bgSecondary:"#f7f7f5", bgTertiary:"#f0efeb",
  textPrimary:"#1a1a18", textSecondary:"#6b6a63", textTertiary:"#9c9b94",
  borderLight:"rgba(0,0,0,0.08)", borderMid:"rgba(0,0,0,0.18)",
};

const PORTAL_NAV = [
  { id:"dashboard",    label:"Dashboard"       },
  { id:"appointments", label:"Appointments"    },
  { id:"messages",     label:"Messages"        },
  { id:"visits",       label:"Visit Summaries" },
  { id:"labs",         label:"Lab Results"     },
  { id:"trends",       label:"My Trends"       },
  { id:"medications",  label:"Medications"     },
  { id:"forms",        label:"Intake Forms"    },
  { id:"insurance",    label:"Insurance"       },
  { id:"billing",      label:"Billing"         },
  { id:"documents",    label:"Documents"       },
  { id:"access",       label:"Family Access"   },
];

export default function PortalShell() {
  const { patientId, practiceId, signOut } = useAuth();
  const [tab, setTab] = useState("dashboard");
  const [patient, setPatient] = useState(null);
  const [practice, setPractice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [badges, setBadges] = useState({ messages:0, forms:0 });
  const [homePatientId, setHomePatientId] = useState(patientId);

  // Read home_patient_id from the JWT claims so we know where "switch back"
  // should go. Set by switch-active-patient after the first proxy switch.
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const parts = session.access_token.split(".");
        if (parts.length !== 3) return;
        const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
        const home = payload?.app_metadata?.home_patient_id;
        if (home) setHomePatientId(home);
      } catch (_e) { /* fall through - default stays patientId */ }
    })();
  }, [patientId]);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!patientId) { setLoading(false); return; }
      try {
        const [{ data: pt }, { data: pr }] = await Promise.all([
          supabase.from("patients").select("*").eq("id", patientId).maybeSingle(),
          supabase.from("practices").select("*").eq("id", practiceId).maybeSingle(),
        ]);
        if (!active) return;
        setPatient(pt);
        setPractice(pr);
        supabase.from("patients")
          .update({ last_portal_access_at: new Date().toISOString() })
          .eq("id", patientId).then(()=>{}).catch(()=>{});
        logAudit({
          action: "Read",
          entityType: "patient_portal_session",
          entityId: patientId,
        }).catch(()=>{});
      } catch (e) {
        console.warn("[portal] load failed:", e?.message || e);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [patientId, practiceId]);

  const refreshBadges = useCallback(async () => {
    if (!patientId) return;
    try {
      const [msgCount, formCount] = await Promise.all([
        // Unread messages FROM staff = direction 'Outbound', is_read=false
        supabase.from("messages")
          .select("id", { count:"exact", head:true })
          .eq("patient_id", patientId)
          .eq("direction", "Outbound")
          .eq("is_read", false),
        supabase.from("portal_form_submissions")
          .select("id", { count:"exact", head:true })
          .eq("patient_id", patientId)
          .eq("status", "Draft"),
      ]);
      setBadges({
        messages: msgCount.count || 0,
        forms:    formCount.count || 0,
      });
    } catch (_e) { /* silent */ }
  }, [patientId]);

  useEffect(() => { refreshBadges(); }, [refreshBadges, tab]);

  if (loading) {
    return <div style={{
      minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center",
      fontFamily:"Inter, system-ui, sans-serif", color:C.textSecondary, fontSize:13,
    }}>Loading your portal...</div>;
  }

  if (!patient) {
    return <div style={{
      minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center",
      padding:20, fontFamily:"Inter, system-ui, sans-serif", textAlign:"center",
    }}>
      <div style={{ maxWidth:400 }}>
        <div style={{ fontSize:15, fontWeight:600, marginBottom:8 }}>No patient record linked</div>
        <div style={{ fontSize:12, color:C.textSecondary, marginBottom:16 }}>
          Your account is not connected to a patient record. Please contact your practice.
        </div>
        <button onClick={signOut} style={btnSecondary}>Sign out</button>
      </div>
    </div>;
  }

  const props = { patient, practice, patientId, practiceId, refreshBadges, goTab: setTab };
 const TabView = {
    dashboard:    PortalDashboard,
    appointments: PortalAppointments,
    messages:     PortalMessages,
    visits:       PortalVisits,
    labs:         PortalLabs,
    trends:       PortalTrends,
    medications:  PortalMedications,
    forms:        PortalForms,
    insurance:    PortalInsurance,
    billing:      PortalBilling,
    documents:    PortalDocuments,
    access:       PatientProxyManager,
    hrsn:         PortalHRSNView,
  }[tab] || PortalDashboard;

  const initials = ((patient.first_name || "")[0] || "") + ((patient.last_name || "")[0] || "");
  const activeBadge = (id) => {
    if (id === "messages" && badges.messages > 0) return badges.messages;
    if (id === "forms" && badges.forms > 0) return badges.forms;
    return null;
  };

  return (
    <div style={{
      display:"flex", height:"100vh", overflow:"hidden",
      fontFamily:"Inter, system-ui, sans-serif", background:C.bgTertiary,
      color:C.textPrimary, fontSize:13,
    }}>
      <div style={{
        width:220, flexShrink:0, background:C.bgPrimary,
        borderRight:"0.5px solid " + C.borderLight,
        display:"flex", flexDirection:"column", overflow:"hidden",
      }}>
        <div style={{
          padding:"14px 16px", borderBottom:"0.5px solid " + C.borderLight,
          display:"flex", alignItems:"center", gap:9,
        }}>
          <div style={{
            width:28, height:28, borderRadius:6, background:C.teal, color:"#fff",
            fontSize:11, fontWeight:700, display:"flex",
            alignItems:"center", justifyContent:"center", flexShrink:0,
          }}>P</div>
          <div style={{ overflow:"hidden" }}>
            <div style={{ fontSize:13, fontWeight:600, color:C.textPrimary, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
              {practice ? practice.name : "My Portal"}
            </div>
            <div style={{ fontSize:9, color:C.textTertiary }}>Patient Portal</div>
          </div>
        </div>

        <div style={{ flex:1, overflowY:"auto", padding:8 }}>
          <div style={{
            fontSize:9, fontWeight:600, letterSpacing:"0.08em",
            textTransform:"uppercase", color:C.textTertiary, padding:"0 8px", margin:"8px 0 4px",
          }}>My Portal</div>
          {PORTAL_NAV.map(n => {
            const active = tab === n.id;
            const bdg = activeBadge(n.id);
            return (
              <div key={n.id} onClick={()=>setTab(n.id)} style={{
                display:"flex", alignItems:"center", gap:8, padding:"7px 10px",
                borderRadius:7, cursor:"pointer", marginBottom:1,
                background: active ? C.tealBg : "transparent",
              }}>
                <span style={{
                  width:6, height:6, borderRadius:"50%", flexShrink:0,
                  background: active ? C.tealMid : C.borderMid,
                }} />
                <span style={{
                  flex:1, fontSize:12, fontWeight: active ? 500 : 400,
                  color: active ? C.teal : C.textSecondary,
                }}>{n.label}</span>
                {bdg !== null && (
                  <span style={{
                    fontSize:9, fontWeight:700, padding:"1px 6px", borderRadius:10,
                    background: active ? C.teal : C.amberBg,
                    color: active ? "#fff" : C.amber,
                  }}>{bdg}</span>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ padding:"8px 10px 0" }}>
          <AccountSwitcher activePatientId={patientId} homePatientId={homePatientId} />
        </div>

        <div style={{
          padding:"10px 12px", borderTop:"0.5px solid " + C.borderLight,
          display:"flex", alignItems:"center", gap:9,
        }}>
          <div style={{
            width:32, height:32, borderRadius:"50%", background:C.tealBg, color:C.teal,
            fontSize:11, fontWeight:700, display:"flex",
            alignItems:"center", justifyContent:"center", flexShrink:0,
          }}>{initials.toUpperCase() || "P"}</div>
          <div style={{ overflow:"hidden", flex:1 }}>
            <div style={{ fontSize:11, fontWeight:600, color:C.textPrimary, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
              {patient.first_name} {patient.last_name}
            </div>
            <div style={{ fontSize:9, color:C.textTertiary }}>
              {patient.mrn ? ("MRN " + patient.mrn) : "Patient"}
            </div>
          </div>
          <button onClick={signOut} title="Sign out" style={{
            background:"transparent", border:"0.5px solid " + C.borderMid, borderRadius:5,
            padding:"4px 8px", fontSize:10, cursor:"pointer", color:C.textSecondary,
            fontFamily:"inherit",
          }}>Exit</button>
        </div>
      </div>

      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
        <div style={{
          display:"flex", alignItems:"center", justifyContent:"space-between",
          padding:"12px 20px", borderBottom:"0.5px solid " + C.borderLight,
          background:C.bgPrimary, flexShrink:0,
        }}>
          <div>
            <div style={{ fontSize:14, fontWeight:600, color:C.textPrimary }}>
              {(PORTAL_NAV.find(n => n.id === tab) || {}).label || "Portal"}
            </div>
            <div style={{ fontSize:10, color:C.textTertiary, marginTop:1 }}>
              {practice ? practice.name : ""}
            </div>
          </div>
          <div style={{
            display:"flex", alignItems:"center", gap:5, fontSize:10, padding:"3px 10px",
            borderRadius:20, fontWeight:600, background:C.tealBg, color:C.teal,
          }}>
            <span style={{
              width:5, height:5, borderRadius:"50%", background:C.tealMid, display:"inline-block",
            }} /> Portal Active
          </div>
        </div>

        <div style={{ flex:1, overflowY:"auto", padding:"18px 22px" }}>
          <TabView {...props} />
        </div>
      </div>
    </div>
  );
}

const btnSecondary = {
  padding:"8px 16px", borderRadius:7, border:"0.5px solid " + C.borderMid,
  background:C.bgSecondary, color:C.textSecondary, fontSize:12, fontWeight:600,
  cursor:"pointer", fontFamily:"inherit",
};
