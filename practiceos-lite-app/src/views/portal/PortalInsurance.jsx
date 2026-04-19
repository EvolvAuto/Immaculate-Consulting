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
  const [editingRank, setEditingRank] = useState(null); // null | 1 | 2
 const [form, setForm] = useState({
    payer_name: "", member_id: "", group_number: "", plan_name: "",
    subscriber_name: "", subscriber_dob: "", relationship: "Self", notes: "",
    front_image_url: "", back_image_url: "",
  });

  const load = async () => {
    const [p, r] = await Promise.all([
      supabase.from("insurance_policies")
        .select("id, rank, payer_name, payer_category, member_id, group_number, plan_name, effective_date, termination_date, is_active, subscriber_first_name, subscriber_last_name, subscriber_relation")
        .eq("patient_id", patientId)
        .order("rank", { ascending: true }),
      supabase.from("insurance_update_requests")
        .select("id, rank, payer_name, member_id, status, review_note, created_at, reviewed_at")
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

 const openEdit = (rank) => {
    const current = policies.find(p => p.rank === rank) || {};
    const subName = [(current.subscriber_first_name || ""), (current.subscriber_last_name || "")]
      .filter(Boolean).join(" ");
  setForm({
      payer_name:     current.payer_name || "",
      member_id:      current.member_id || "",
      group_number:   current.group_number || "",
      plan_name:      current.plan_name || "",
      subscriber_name: subName,
      subscriber_dob: "",
      relationship:   current.subscriber_relation || "Self",
      notes: "",
      front_image_url: "",
      back_image_url:  "",
    });
    setEditingRank(rank);
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
        rank:            editingRank,
        payer_name:      form.payer_name,
        member_id:       form.member_id,
        group_number:    form.group_number || null,
        plan_name:       form.plan_name || null,
        subscriber_name: form.subscriber_name || null,
        subscriber_dob:  form.subscriber_dob || null,
        relationship:    form.relationship || "Self",
        notes:           form.notes || null,
        front_image_url: form.front_image_url || null,
        back_image_url:  form.back_image_url  || null,
        status:          "Pending Review",
      });
      if (error) throw error;

      logAudit({
        action:"Create", entityType:"insurance_update_request",
        entityId:null, details:{ payer: form.payer_name, rank: editingRank },
      }).catch(()=>{});

      setEditingRank(null);
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
  const secondary = policies.find(p => p.rank === 2);

  // Map pending requests by rank so we can show a "pending review" state per card
  const pendingByRank = {};
  requests.filter(r => r.status === "Pending Review").forEach(r => {
    if (!pendingByRank[r.rank]) pendingByRank[r.rank] = r;
  });

  const isEditing = editingRank !== null;
  const rankLabel = (r) => r === 1 ? "Primary" : r === 2 ? "Secondary" : "Rank " + r;
  const editPolicy = editingRank != null ? policies.find(p => p.rank === editingRank) : null;
  const editTitle = editingRank == null ? ""
    : (editPolicy ? "Update " + rankLabel(editingRank) + " Insurance"
                  : "Add " + rankLabel(editingRank) + " Insurance");

  const renderPolicyCard = (rank, policy, label) => {
    const pending = pendingByRank[rank];
    const accent = policy ? C.tealMid : (rank === 1 ? C.amberMid : C.borderMid);
    const emptyMsg = rank === 1
      ? "No primary insurance on file."
      : "No secondary insurance on file. Add one if you have a second plan (for example, through a spouse or Medicare).";
    return (
      <Panel accent={accent}>
        <SectionHead
          title={label}
          right={!isEditing && !pending && (
            <Btn onClick={() => openEdit(rank)}>{policy ? "Update" : "Add " + label}</Btn>
          )}
        />
        {pending && (
          <div style={{
            fontSize:11, color:C.amber, fontWeight:600, marginBottom:8,
            background:C.amberBg, border:"0.5px solid " + C.amberBorder,
            padding:"6px 10px", borderRadius:5,
          }}>
            Update pending review - submitted {fmtDate(pending.created_at)}
          </div>
        )}
        {!policy && !pending && (
          <div style={{ fontSize:12, color:C.textSecondary }}>{emptyMsg}</div>
        )}
        {policy && (
          <div>
            <div style={{ fontSize:15, fontWeight:600, color:C.textPrimary, marginBottom:4 }}>
              {policy.payer_name}
            </div>
            <div style={{ fontSize:11, color:C.textSecondary, fontFamily:"'DM Mono', monospace" }}>
              Member ID: {policy.member_id}
              {policy.group_number ? " - Group: " + policy.group_number : ""}
            </div>
            {policy.plan_name && (
              <div style={{ fontSize:11, color:C.textSecondary, marginTop:3 }}>{policy.plan_name}</div>
            )}
            <div style={{ marginTop:8, display:"flex", gap:6, flexWrap:"wrap" }}>
              <Badge label={policy.is_active ? "Active" : "Inactive"}
                     variant={policy.is_active ? "teal" : "red"} />
              {policy.effective_date && (
                <Badge label={"Effective " + fmtDate(policy.effective_date)} variant="neutral" />
              )}
              {policy.termination_date && (
                <Badge label={"Ends " + fmtDate(policy.termination_date)} variant="amber" />
              )}
            </div>
          </div>
        )}
      </Panel>
    );
  };

  return (
    <div>
      <Toast show={!!toast} msg={toast || ""} />

      <InfoBox>
        Updates go through staff review so we can verify eligibility with your payer
        before the information is applied to your chart.
      </InfoBox>

      {renderPolicyCard(1, primary,   "Primary Insurance")}
      {renderPolicyCard(2, secondary, "Secondary Insurance")}

      {isEditing && (
        <Panel accent={C.tealMid}>
          <SectionHead title={editTitle} />
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

          <div style={{ marginTop:10, marginBottom:14 }}>
            <div style={{ fontSize:10, fontWeight:700, color:C.textSecondary, textTransform:"uppercase", letterSpacing:0.5, marginBottom:6 }}>
              Insurance Card Photos
            </div>
            <div style={{ fontSize:11, color:C.textTertiary, marginBottom:10 }}>
              Optional but helpful - clear photos of both sides of your card let staff verify faster.
              Accepted: JPG, PNG, HEIC, PDF (10 MB max).
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              <CardUploadField
                label="Front of card"
                value={form.front_image_url}
                onChange={(path) => setForm(prev => ({ ...prev, front_image_url: path }))}
                patientId={patientId}
                practiceId={practiceId}
                side="front"
              />
              <CardUploadField
                label="Back of card"
                value={form.back_image_url}
                onChange={(path) => setForm(prev => ({ ...prev, back_image_url: path }))}
                patientId={patientId}
                practiceId={practiceId}
                side="back"
              />
            </div>
          </div>

          <div style={{ display:"flex", gap:8 }}>
            <Btn onClick={submit}>Submit for Review</Btn>
            <Btn variant="secondary" onClick={() => setEditingRank(null)}>Cancel</Btn>
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
                <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:2, flexWrap:"wrap" }}>
                  <Badge label={rankLabel(r.rank)} variant={r.rank === 1 ? "teal" : "purple"} />
                  <div style={{ fontSize:12, fontWeight:600, color:C.textPrimary }}>{r.payer_name}</div>
                </div>
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

// ─── Insurance card upload field ─────────────────────────────────────────
function CardUploadField({ label, value, onChange, patientId, practiceId, side }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError]         = useState(null);
  const [preview, setPreview]     = useState(null);

  useEffect(() => {
    if (!value) { setPreview(null); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.storage
        .from("insurance-cards")
        .createSignedUrl(value, 3600);
      if (!cancelled && data) setPreview(data.signedUrl);
    })();
    return () => { cancelled = true; };
  }, [value]);

  const handleFile = async (file) => {
    if (!file) return;
    setError(null);

    if (file.size > 10 * 1024 * 1024) {
      setError("File must be under 10 MB.");
      return;
    }
    const allowed = ["image/jpeg","image/jpg","image/png","image/webp","image/heic","image/heif","application/pdf"];
    if (!allowed.includes(file.type)) {
      setError("Use JPG, PNG, WebP, HEIC, or PDF.");
      return;
    }

    setUploading(true);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = practiceId + "/" + patientId + "/" + Date.now() + "_" + side + "." + ext;
      const { error: upErr } = await supabase.storage
        .from("insurance-cards")
        .upload(path, file, { upsert: false, contentType: file.type });
      if (upErr) throw upErr;
      onChange(path);
    } catch (e) {
      setError((e && e.message) || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const isPdf = value && value.toLowerCase().endsWith(".pdf");

  return (
    <div style={{
      border:"0.5px dashed " + C.borderMid, borderRadius:6, padding:8,
      background: value ? C.tealBg : C.bgSecondary,
    }}>
      <div style={{ fontSize:10, fontWeight:700, color:C.textSecondary, textTransform:"uppercase", letterSpacing:0.5, marginBottom:6 }}>
        {label}
      </div>

      {value && isPdf && (
        <div style={{ padding:"18px 0", textAlign:"center", background:C.redBg, color:C.red, fontSize:13, fontWeight:700, borderRadius:4, marginBottom:6 }}>
          PDF uploaded
        </div>
      )}
      {value && !isPdf && preview && (
        <div style={{ marginBottom:6 }}>
          <img src={preview} alt={label}
               style={{ width:"100%", maxHeight:120, objectFit:"cover", borderRadius:4, display:"block" }} />
        </div>
      )}
      {value && !isPdf && !preview && (
        <div style={{ fontSize:11, color:C.textSecondary, marginBottom:6, fontStyle:"italic" }}>
          Preview loading...
        </div>
      )}

      {!value && !uploading && (
        <label style={{
          display:"block", padding:"6px 10px", background:"#fff",
          border:"0.5px solid " + C.tealBorder, borderRadius:4,
          fontSize:11, color:C.teal, fontWeight:600,
          cursor:"pointer", textAlign:"center", fontFamily:"inherit",
        }}>
          Choose file
          <input type="file" accept="image/*,application/pdf"
                 style={{ display:"none" }}
                 onChange={(e) => handleFile(e.target.files && e.target.files[0])} />
        </label>
      )}

      {uploading && (
        <div style={{ fontSize:11, color:C.textSecondary, textAlign:"center", padding:"4px 0" }}>
          Uploading...
        </div>
      )}

      {value && !uploading && (
        <button type="button" onClick={() => onChange("")}
                style={{
                  width:"100%", padding:"4px 8px", background:"transparent",
                  border:"0.5px solid " + C.borderMid, borderRadius:4,
                  fontSize:10, color:C.textSecondary, cursor:"pointer", fontFamily:"inherit",
                }}>
          Replace
        </button>
      )}

      {error && (
        <div style={{ fontSize:10, color:C.red, marginTop:4 }}>{error}</div>
      )}
    </div>
  );
}
