// ═══════════════════════════════════════════════════════════════════════════════
// src/views/portal/PortalMedications.jsx
// Shows active medications (from patients.medications JSONB), plus allergies
// and refill request flow. "Request Refill" inserts into refill_requests.
// ═══════════════════════════════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import { supabase, logAudit } from "../../lib/supabaseClient";
import {
  C, Panel, Badge, Btn, Field, SectionHead, Input, TextArea, Toast, InfoBox, Empty, fmtDate,
} from "./_ui.jsx";

export default function PortalMedications({ patient, patientId, practiceId }) {
  const [meds, setMeds] = useState([]);
  const [allergies, setAllergies] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refillFor, setRefillFor] = useState(null); // medication being refilled
  const [pharmacy, setPharmacy] = useState("");
  const [notes, setNotes] = useState("");
  const [toast, setToast] = useState(null);

  const load = async () => {
    const [pRes, rReq] = await Promise.all([
      supabase.from("patients")
        .select("medications, allergies")
        .eq("id", patientId).maybeSingle(),
      supabase.from("refill_requests")
        .select("id, medication_name, dosage, sig, pharmacy_name, status, created_at, resolution_note")
        .eq("patient_id", patientId)
        .order("created_at", { ascending:false }).limit(20),
    ]);
    const medsRaw = (pRes.data && pRes.data.medications) || [];
    const allergiesRaw = (pRes.data && pRes.data.allergies) || [];
    setMeds(Array.isArray(medsRaw) ? medsRaw : []);
    setAllergies(Array.isArray(allergiesRaw) ? allergiesRaw : []);
    setRequests(rReq.data || []);
    logAudit({ action:"Read", entityType:"medications", entityId:patientId }).catch(()=>{});
  };

  useEffect(() => {
    let active = true;
    (async () => { try { await load(); } finally { if (active) setLoading(false); } })();

    const channel = supabase.channel("portal-refills-" + patientId)
      .on("postgres_changes",
          { event:"*", schema:"public", table:"refill_requests", filter:"patient_id=eq." + patientId },
          () => load())
      .subscribe();
    return () => { active = false; supabase.removeChannel(channel); };
  }, [patientId]);

  const openRefill = (m) => {
    setRefillFor(m);
    setPharmacy(m.pharmacy || "");
    setNotes("");
  };

  const submitRefill = async () => {
    if (!refillFor) return;
    try {
      const payload = {
        practice_id:     practiceId,
        patient_id:      patientId,
        medication_name: refillFor.name || refillFor.medication || "Unknown",
        dosage:          refillFor.dose || refillFor.dosage || null,
        sig:             refillFor.sig || refillFor.directions || null,
        pharmacy_name:   pharmacy || null,
        notes:           notes || null,
        status:          "Pending",
      };
      const { error } = await supabase.from("refill_requests").insert(payload);
      if (error) throw error;

      logAudit({
        action:"Create", entityType:"refill_request", entityId:null,
        details:{ medication_name: payload.medication_name },
      }).catch(()=>{});

      setRefillFor(null); setPharmacy(""); setNotes("");
      setToast("Refill request submitted. Your care team will process it within 2-3 business days.");
      setTimeout(() => setToast(null), 5000);
      await load();
    } catch (e) {
      setToast("Could not submit refill: " + (e.message || e));
      setTimeout(() => setToast(null), 5000);
    }
  };

  if (loading) return <Empty title="Loading medications..." />;

  return (
    <div>
      <Toast show={!!toast} msg={toast || ""} />

      <InfoBox>
        Refill requests are routed to your primary provider. Allow 2-3 business days for processing.
        Your pharmacy will be notified when approved.
      </InfoBox>

      {/* Active medications */}
      <div style={{
        fontSize:10, textTransform:"uppercase", letterSpacing:"0.06em",
        color:C.textTertiary, margin:"12px 0 8px", fontWeight:600,
      }}>Active Medications</div>

      {meds.length === 0 && <Empty title="No medications on file" />}

      {meds.map((m, i) => {
        const name = m.name || m.medication || "Medication";
        const dose = m.dose || m.dosage || "";
        const sig = m.sig || m.directions || "";
        const pendingReq = requests.find(r =>
          r.medication_name === name && ["Pending","In Review"].includes(r.status));
        const isRefillingThis = refillFor && ((refillFor.name || refillFor.medication) === name);

        return (
          <Panel key={i} accent={C.tealMid}>
            <div style={{
              display:"flex", justifyContent:"space-between", alignItems:"flex-start",
              flexWrap:"wrap", gap:10,
            }}>
              <div style={{ flex:1, minWidth:200 }}>
                <div style={{ fontSize:13, fontWeight:600, color:C.textPrimary }}>
                  {name} {dose && <span style={{ color:C.textSecondary, fontWeight:500 }}> - {dose}</span>}
                </div>
                {sig && <div style={{ fontSize:11, color:C.textSecondary, marginTop:2 }}>{sig}</div>}
                {m.prescriber && <div style={{ fontSize:11, color:C.textTertiary, marginTop:4 }}>
                  Prescribed by {m.prescriber}
                </div>}
              </div>
              <div>
                {pendingReq
                  ? <Badge label={"Refill " + pendingReq.status} variant="amber" />
                  : <Btn onClick={() => openRefill(m)}>Request Refill</Btn>}
              </div>
            </div>

            {isRefillingThis && (
              <div style={{
                marginTop:12, padding:"10px 12px", borderRadius:7,
                background:C.tealBg, border:"0.5px solid " + C.tealBorder,
              }}>
                <div style={{ fontSize:12, fontWeight:600, color:C.tealDark, marginBottom:8 }}>
                  Refill request for {name}
                </div>
                <Field label="Pharmacy (optional)">
                  <Input value={pharmacy} onChange={setPharmacy}
                         placeholder="e.g. CVS on Main Street, Durham" />
                </Field>
                <Field label="Notes to Provider (optional)">
                  <TextArea value={notes} onChange={setNotes} rows={2}
                            placeholder="Any changes or issues?" />
                </Field>
                <div style={{ display:"flex", gap:8 }}>
                  <Btn onClick={submitRefill}>Submit Request</Btn>
                  <Btn variant="secondary" onClick={() => setRefillFor(null)}>Cancel</Btn>
                </div>
              </div>
            )}
          </Panel>
        );
      })}

      {/* Allergies */}
      <div style={{
        fontSize:10, textTransform:"uppercase", letterSpacing:"0.06em",
        color:C.textTertiary, margin:"16px 0 8px", fontWeight:600,
      }}>Allergies on File</div>
      <Panel>
        {allergies.length === 0 && <div style={{ fontSize:12, color:C.textTertiary }}>No known allergies recorded.</div>}
        <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
          {allergies.map((a, i) => {
            const label = typeof a === "object"
              ? (a.name || a.allergen || "") + (a.reaction ? " - " + a.reaction : "")
              : String(a);
            const sev = typeof a === "object" ? (a.severity || "") : "";
            return (
              <Badge key={i} label={label} variant={sev === "Severe" ? "red" : "amber"} />
            );
          })}
        </div>
      </Panel>

      {/* Recent refill requests */}
      {requests.length > 0 && (
        <>
          <div style={{
            fontSize:10, textTransform:"uppercase", letterSpacing:"0.06em",
            color:C.textTertiary, margin:"16px 0 8px", fontWeight:600,
          }}>Recent Refill Requests</div>
          {requests.map(r => (
            <Panel key={r.id} style={{ display:"flex", justifyContent:"space-between", flexWrap:"wrap", gap:8 }}>
              <div>
                <div style={{ fontSize:12, fontWeight:600, color:C.textPrimary }}>{r.medication_name}</div>
                <div style={{ fontSize:11, color:C.textTertiary, marginTop:2 }}>
                  Requested {fmtDate(r.created_at)}
                  {r.pharmacy_name ? " - " + r.pharmacy_name : ""}
                </div>
                {r.resolution_note && (
                  <div style={{ fontSize:11, color:C.textSecondary, marginTop:3, fontStyle:"italic" }}>{r.resolution_note}</div>
                )}
              </div>
              <Badge label={r.status}
                     variant={r.status === "Approved" || r.status === "Sent to Pharmacy" ? "teal"
                            : r.status === "Denied" ? "red" : "amber"} />
            </Panel>
          ))}
        </>
      )}
    </div>
  );
}
