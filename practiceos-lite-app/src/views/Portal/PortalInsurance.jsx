// ═══════════════════════════════════════════════════════════════════════════════
// src/views/portal/PortalInsurance.jsx
// Shows current primary insurance (rank=1), submits staff-reviewed update
// request. Matches live schema: rank (1=primary), subscriber_first_name +
// subscriber_last_name, subscriber_relation, termination_date, is_active. There
// is no eligibility_status column on insurance_policies.
// ═══════════════════════════════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import { supabase, logAudit } from "../../lib/supabaseClient";
import {
  C, Panel, Badge, Btn, Field, SectionHead, Select, TextArea, Input,
  Toast, InfoBox, Empty, fmtDate,
} from "./_ui.jsx";

const NC_PAYER_OPTIONS = [
  "AmeriHealth Caritas NC (Medicaid)",
  "Carolina Complete Health (Medicaid)",
  "Healthy Blue (Medicaid)",
  "UnitedHealthcare Community Plan (Medicaid)",
  "WellCare of NC (Medicaid)",
  "Alliance Health (Tailored Plan)",
  "Trillium Health Resources (Tailored Plan)",
  "Vaya Health (Tailored Plan)",
  "Partners Health Management (Tailored Plan)",
  "NC Medicaid Direct",
  "Medicare (Traditional)",
  "Medicare Advantage - BCBS NC",
  "Medicare Advantage - UnitedHealthcare",
  "Blue Cross Blue Shield NC (Commercial)",
  "Aetna",
  "Cigna",
  "UnitedHealthcare",
  "Humana",
  "Ambetter NC",
  "Molina Healthcare",
  "NC State Health Plan (Aetna)",
  "Tricare / Military",
  "Veterans Affairs (VA)",
  "Self-Pay / No Insurance",
  "Other - not listed",
];

export default function PortalInsurance({ patientId, practiceId }) {
  const [policies, setPolicies] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [toast, setToast]       = useState(null);
  const [editing, setEditing]   = useState(false);
  const [form, setForm] = useState({
    payer_name: "", member_id: "", group_number: "", plan_name: "",
    subscriber_name: "", subscriber_dob: "", relationship: "Self", notes: "",
  });

  const load = async () => {
    const [p, r] = await Promise.all([
      supabase.from("insurance_policies")
        .select("id, rank, payer_name, payer_category, member_id, group_number, plan_name, effective_date, termination_date, is_active, subscriber_first_name, subscriber_last_name, subscriber_relation")
        .eq("patient_id", patientId)
        .order("rank", { ascending: true }),
      supabase.from("insurance_update_requests")
        .select("id, payer_name, member_id, status, review_note, created_at, reviewed_at")
        .eq("patient_id", patientId)
        .order("created_at", { ascending:false }).limit(10),
    ]);
    setPolicies(p.data || []);
    setRequests(r.data || []);
    logAudit({ action:"Read", entityType:"insurance_policies", entityId:patientId }).catch(()=>{});
  };

  useEffect(() => {
    let active = true;
    (async () => { try { await load(); } finally { if (active) setLoading(false); } })();
    return () => { active = false; };
  }, [patientId]);

  const openEdit = () => {
    const primary = policies.find(p => p.rank === 1) || {};
    const subName = [(primary.subscriber_first_name || ""), (primary.subscriber_last_name || "")]
      .filter(Boolean).join(" ");
    setForm({
      payer_name:     primary.payer_name || "",
      member_id:      primary.member_id || "",
      group_number:   primary.group_number || "",
      plan_name:      primary.plan_name || "",
      subscriber_name: subName,
      subscriber_dob: "",
      relationship:   primary.subscriber_relation || "Self",
      notes: "",
    });
    setEditing(true);
  };

  const submit = async () => {
    if (!form.payer_name || !form.member_id) {
      setToast("Please provide at least payer and member ID.");
      setTimeout(()=>setToast(null), 4000);
      return;
    }
    try {
      const { error } = await supabase.from("insurance_update_requests").insert({
        practice_id:     practiceId,
        patient_id:      patientId,
        payer_name:      form.payer_name,
        member_id:       form.member_id,
        group_number:    form.group_number || null,
        plan_name:       form.plan_name || null,
        subscriber_name: form.subscriber_name || null,
        subscriber_dob:  form.subscriber_dob || null,
        relationship:    form.relationship || "Self",
        notes:           form.notes || null,
        status:          "Pending Review",
      });
      if (error) throw error;

      logAudit({
        action:"Create", entityType:"insurance_update_request",
        entityId:null, details:{ payer: form.payer_name },
      }).catch(()=>{});

      setEditing(false);
      setToast("Insurance update submitted. Staff will review and verify eligibility within 1-2 business days.");
      setTimeout(()=>setToast(null), 5000);
      await load();
    } catch (e) {
      setToast("Could not submit: " + (e.message || e));
      setTimeout(()=>setToast(null), 5000);
    }
  };

  if (loading) return <Empty title="Loading insurance info..." />;
  const primary   = policies.find(p => p.rank === 1);
  const secondary = policies.filter(p => p.rank !== 1);

  return (
    <div>
      <Toast show={!!toast} msg={toast || ""} />

      <InfoBox>
        Updates go through staff review so we can verify eligibility with your payer
        before the information is applied to your chart.
      </InfoBox>

      <Panel accent={primary ? C.tealMid : C.amberMid}>
        <SectionHead
          title="Primary Insurance"
          right={!editing && <Btn onClick={openEdit}>{primary ? "Update" : "Add Insurance"}</Btn>}
        />
        {!primary && (
          <div style={{ fontSize:12, color:C.textSecondary }}>No primary insurance on file.</div>
        )}
        {primary && (
          <div>
            <div style={{ fontSize:15, fontWeight:600, color:C.textPrimary, marginBottom:4 }}>
              {primary.payer_name}
            </div>
            <div style={{ fontSize:11, color:C.textSecondary, fontFamily:"'DM Mono', monospace" }}>
              Member ID: {primary.member_id}
              {primary.group_number ? " - Group: " + primary.group_number : ""}
            </div>
            {primary.plan_name && (
              <div style={{ fontSize:11, color:C.textSecondary, marginTop:3 }}>{primary.plan_name}</div>
            )}
            <div style={{ marginTop:8, display:"flex", gap:6, flexWrap:"wrap" }}>
              <Badge label={primary.is_active ? "Active" : "Inactive"}
                     variant={primary.is_active ? "teal" : "red"} />
              {primary.effective_date && (
                <Badge label={"Effective " + fmtDate(primary.effective_date)} variant="neutral" />
              )}
              {primary.termination_date && (
                <Badge label={"Ends " + fmtDate(primary.termination_date)} variant="amber" />
              )}
            </div>
          </div>
        )}
      </Panel>

      {secondary.map(p => (
        <Panel key={p.id}>
          <div style={{ fontSize:11, textTransform:"uppercase", color:C.textTertiary, fontWeight:600, marginBottom:4 }}>
            {p.rank === 2 ? "Secondary" : "Rank " + p.rank}
          </div>
          <div style={{ fontSize:13, fontWeight:600 }}>{p.payer_name}</div>
          <div style={{ fontSize:11, color:C.textSecondary, fontFamily:"'DM Mono', monospace", marginTop:2 }}>
            Member ID: {p.member_id}
          </div>
        </Panel>
      ))}

      {editing && (
        <Panel accent={C.tealMid}>
          <SectionHead title="Update Insurance Information" />
          <Field label="Insurance Payer">
            <Select value={form.payer_name}
                    onChange={(v)=>setForm({...form, payer_name:v})}
                    options={[{ value:"", label:"Select your insurance..." },
                              ...NC_PAYER_OPTIONS.map(o => ({ value:o, label:o }))]} />
          </Field>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <Field label="Member ID">
              <Input value={form.member_id} onChange={v => setForm({...form, member_id:v})} />
            </Field>
            <Field label="Group Number (if on card)">
              <Input value={form.group_number} onChange={v => setForm({...form, group_number:v})} />
            </Field>
          </div>
          <Field label="Plan Name (optional)">
            <Input value={form.plan_name} onChange={v => setForm({...form, plan_name:v})} />
          </Field>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <Field label="Relationship to Subscriber">
              <Select value={form.relationship} onChange={v => setForm({...form, relationship:v})}
                      options={["Self","Spouse","Parent","Child","Other"]} />
            </Field>
            <Field label="Subscriber DOB (if not self)">
              <Input type="date" value={form.subscriber_dob} onChange={v => setForm({...form, subscriber_dob:v})} />
            </Field>
          </div>
          {form.relationship !== "Self" && (
            <Field label="Subscriber Full Name">
              <Input value={form.subscriber_name} onChange={v => setForm({...form, subscriber_name:v})} />
            </Field>
          )}
          <Field label="Notes to Staff (optional)">
            <TextArea value={form.notes} onChange={v => setForm({...form, notes:v})} rows={2} />
          </Field>
          <div style={{ display:"flex", gap:8 }}>
            <Btn onClick={submit}>Submit for Review</Btn>
            <Btn variant="secondary" onClick={() => setEditing(false)}>Cancel</Btn>
          </div>
        </Panel>
      )}

      {requests.length > 0 && (
        <>
          <div style={{
            fontSize:10, textTransform:"uppercase", letterSpacing:"0.06em",
            color:C.textTertiary, margin:"16px 0 8px", fontWeight:600,
          }}>Update Requests</div>
          {requests.map(r => (
            <Panel key={r.id} style={{ display:"flex", justifyContent:"space-between", flexWrap:"wrap", gap:8 }}>
              <div>
                <div style={{ fontSize:12, fontWeight:600, color:C.textPrimary }}>{r.payer_name}</div>
                <div style={{ fontSize:11, color:C.textTertiary, marginTop:2 }}>
                  Member: {r.member_id} - Submitted {fmtDate(r.created_at)}
                </div>
                {r.review_note && (
                  <div style={{ fontSize:11, color:C.textSecondary, marginTop:3, fontStyle:"italic" }}>{r.review_note}</div>
                )}
              </div>
              <Badge label={r.status}
                     variant={r.status === "Approved" ? "teal" :
                              r.status === "Rejected" ? "red" : "amber"} />
            </Panel>
          ))}
        </>
      )}
    </div>
  );
}
