// ═══════════════════════════════════════════════════════════════════════════════
// src/views/patient/PatientPortalInviteButton.jsx
// Drop-in component to place inside the patient detail header/actions row.
// Shows either "Enable Portal", "Resend Invite", or "Portal Active".
//
// Usage in PatientsView.jsx - inside the row of action buttons for a patient:
//   import PatientPortalInviteButton from "./patient/PatientPortalInviteButton";
//   ...
//   <PatientPortalInviteButton patient={patient} />
// ═══════════════════════════════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { supabase } from "../../lib/supabaseClient";
import { sendPortalInvite, revokePortalInvite, buildActivationUrl } from "../../lib/portalInvite";

const C = {
  teal:"#0F6E56", tealBg:"#E1F5EE", tealBorder:"#9FE1CB",
  amber:"#854F0B", amberBg:"#FAEEDA", amberBorder:"#FAC775",
  red:"#A32D2D", redBg:"#FCEBEB", redBorder:"#F5B8B8",
  bgPrimary:"#ffffff", bgSecondary:"#f7f7f5",
  textPrimary:"#1a1a18", textSecondary:"#6b6a63", textTertiary:"#9c9b94",
  borderLight:"rgba(0,0,0,0.08)", borderMid:"rgba(0,0,0,0.18)",
};

export default function PatientPortalInviteButton({ patient, onChange }) {
  const { practiceId, user } = useAuth();
  const [invite, setInvite] = useState(null); // latest invite row
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const loadInvite = async () => {
    const { data } = await supabase.from("portal_invitations")
      .select("id, email, token, status, expires_at, sent_at, activated_at, created_at")
      .eq("patient_id", patient.id)
      .order("created_at", { ascending:false }).limit(1).maybeSingle();
    setInvite(data);
    setLoading(false);
  };

  useEffect(() => { loadInvite(); }, [patient.id]);

  const openModal = () => {
    setEmail(patient.email || "");
    setMsg(null);
    setShowModal(true);
  };

  const submit = async () => {
    if (!email || !email.includes("@")) { setMsg("Please enter a valid email."); return; }
    setBusy(true);
    try {
      const { invite: newInv } = await sendPortalInvite({
        practiceId, patientId: patient.id, email, invitedBy: user?.id,
      });
      setInvite(newInv);
      setMsg("Invitation sent. Link expires in 48 hours.");
      if (onChange) onChange();
      setTimeout(() => setShowModal(false), 1500);
    } catch (e) {
      setMsg("Error: " + (e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!invite) return;
    if (!confirm("Revoke this invitation? The patient will no longer be able to use this link.")) return;
    try {
      await revokePortalInvite(invite.id);
      await loadInvite();
    } catch (e) {
      setMsg("Could not revoke: " + (e.message || e));
    }
  };

  const copyLink = async () => {
    if (!invite) return;
    const url = buildActivationUrl(invite.token);
    try { await navigator.clipboard.writeText(url); setMsg("Link copied to clipboard."); }
    catch { setMsg("Copy failed. URL: " + url); }
  };

  if (loading) return null;

  // Determine state
  const status = invite?.status;
  const isActive = patient.last_portal_access_at || status === "Activated";
  const isPending = status === "Pending" || status === "Sent";

  return (
    <>
      {isActive && (
        <button onClick={openModal} style={btn("teal")}>
          Portal Active - Resend
        </button>
      )}
      {!isActive && isPending && (
        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
          <button onClick={openModal} style={btn("amber")}>
            Invite Pending - Resend
          </button>
          <button onClick={copyLink} style={btn("neutral")}>Copy Link</button>
          <button onClick={revoke} style={btn("danger")}>Revoke</button>
        </div>
      )}
      {!isActive && !isPending && (
        <button onClick={openModal} style={btn("primary")}>
          Enable Portal Access
        </button>
      )}

      {showModal && (
        <div style={overlayStyle} onClick={()=>setShowModal(false)}>
          <div style={modalStyle} onClick={(e)=>e.stopPropagation()}>
            <div style={{ fontSize:14, fontWeight:600, marginBottom:4 }}>
              Send Portal Invitation
            </div>
            <div style={{ fontSize:11, color:C.textTertiary, marginBottom:14 }}>
              {patient.first_name} {patient.last_name} - MRN {patient.mrn || "--"}
            </div>
            <div style={{ fontSize:11, fontWeight:600, color:C.textSecondary, marginBottom:5, textTransform:"uppercase", letterSpacing:"0.04em" }}>Email</div>
            <input value={email} onChange={(e)=>setEmail(e.target.value)} type="email" placeholder="patient@example.com"
                   style={inputStyle} />
            <div style={{
              fontSize:11, color:C.textTertiary, marginTop:8, marginBottom:14, lineHeight:1.55,
            }}>
              Patient will receive a secure link to verify their identity (date of birth + last 4 of phone)
              and set a password. Link expires in 48 hours.
            </div>
            {msg && <div style={{ fontSize:11.5, color: msg.startsWith("Error") ? C.red : C.teal, marginBottom:10 }}>{msg}</div>}
            <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
              <button onClick={()=>setShowModal(false)} style={btn("neutral")}>Cancel</button>
              <button onClick={submit} disabled={busy} style={btn("primary")}>{busy ? "Sending..." : "Send Invitation"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function btn(variant) {
  const base = {
    padding:"7px 14px", borderRadius:6, fontSize:11, fontWeight:600,
    cursor:"pointer", fontFamily:"inherit", border:"0.5px solid",
  };
  const variants = {
    primary:  { background:C.teal, color:"#fff", borderColor:C.teal },
    teal:     { background:C.tealBg, color:C.teal, borderColor:C.tealBorder },
    amber:    { background:C.amberBg, color:C.amber, borderColor:C.amberBorder },
    neutral:  { background:C.bgSecondary, color:C.textSecondary, borderColor:C.borderMid },
    danger:   { background:C.redBg, color:C.red, borderColor:C.redBorder },
  };
  return { ...base, ...(variants[variant] || variants.primary) };
}

const inputStyle = {
  width:"100%", padding:"9px 12px", border:"0.5px solid " + C.borderMid,
  borderRadius:7, fontSize:13, fontFamily:"inherit", color:C.textPrimary,
  background:C.bgPrimary, outline:"none", boxSizing:"border-box",
};

const overlayStyle = {
  position:"fixed", inset:0, background:"rgba(0,0,0,0.4)", zIndex:1000,
  display:"flex", alignItems:"center", justifyContent:"center", padding:20,
  fontFamily:"Inter, system-ui, sans-serif",
};

const modalStyle = {
  background:C.bgPrimary, border:"0.5px solid " + C.borderMid, borderRadius:12,
  padding:"22px 24px", width:"100%", maxWidth:440,
  boxShadow:"0 10px 40px rgba(0,0,0,0.2)",
};
