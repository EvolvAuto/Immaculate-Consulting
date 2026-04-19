// ═══════════════════════════════════════════════════════════════════════════════
// src/views/portal/PortalForms.jsx
// Pre-visit intake forms. Sections filtered by appt type + patient age + gender.
// Writes a single portal_form_submissions row per appointment, with section data
// keyed inside the JSONB `data` field.
// Live schema uses patients.gender (not sex).
// ═══════════════════════════════════════════════════════════════════════════════

import ConsentSection from "./ConsentSection";
import MedicationsSection from "./MedicationsSection";
import { useState, useEffect, useMemo } from "react";
import { supabase, logAudit } from "../../lib/supabaseClient";
import {
  C, Panel, Badge, Btn, Field, SectionHead, Select, TextArea, Input,
  Toast, InfoBox, Empty, fmtDate, slotToTime,
} from "./_ui.jsx";

const APPT_KEY_MAP = {
  "New Patient":   "new-patient",
  "Annual Exam":   "annual",
  "Follow-up":     "follow-up",
  "Walk-in":       "sick",
  "Procedure":     "procedure",
  "Telehealth":    "telehealth",
  "Physical Exam": "annual",
};

const FORM_CONFIG = {
  demographics:   { label:"Patient Demographics",  required:true,  apptTypes:["new-patient","annual"] },
  health_history: { label:"Health History",        required:false, apptTypes:["new-patient","annual"] },
  medications:    { label:"Current Medications",   required:false, apptTypes:["new-patient","annual","follow-up","sick"] },
  allergies:      { label:"Allergies",             required:false, apptTypes:["new-patient","annual","sick"] },
  social_history: { label:"Social History",        required:false, ageMin:18, apptTypes:["new-patient","annual"] },
  ros:            { label:"Review of Systems",     required:false, apptTypes:["new-patient","annual","sick"] },
  consent:        { label:"Consent & HIPAA",       required:true,  apptTypes:["new-patient","annual","follow-up","sick"] },
  womens_health:  { label:"Women's Health",        required:false, specialty:true, ageMin:18, gender:"Female", apptTypes:["new-patient","annual"] },
  pediatrics:     { label:"Pediatric History",     required:false, specialty:true, ageMax:17, apptTypes:["new-patient","annual"] },
};

function calcAge(dob) {
  if (!dob) return null;
  const d = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

export default function PortalForms({ patient, patientId, practiceId, refreshBadges }) {
  const [appt, setAppt]       = useState(null);
  const [submission, setSubmission] = useState(null);
  const [loading, setLoading] = useState(true);
  const [openSection, setOpenSection] = useState(null);
  const [draft, setDraft]     = useState({});
  const [saving, setSaving]   = useState(false);
  const [toast, setToast]     = useState(null);

  const age = useMemo(() => calcAge(patient && patient.date_of_birth), [patient]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const { data: upcoming } = await supabase.from("appointments")
          .select("id, appt_date, start_slot, appt_type, status")
          .eq("patient_id", patientId).gte("appt_date", today)
          .not("status", "in", "(Cancelled,Completed,No Show)")
          .order("appt_date", { ascending:true }).limit(1);
        const next = (upcoming || [])[0];

        let sub = null;
        if (next) {
          const { data: subs } = await supabase.from("portal_form_submissions")
            .select("*").eq("appointment_id", next.id).maybeSingle();
          sub = subs;
        }

        if (!active) return;
        setAppt(next || null);
        setSubmission(sub);
        logAudit({ action:"Read", entityType:"portal_form_submissions", entityId:patientId }).catch(()=>{});
      } catch (e) {
        console.warn("[forms] load failed:", e?.message || e);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [patientId]);

  const apptKey = appt ? (APPT_KEY_MAP[appt.appt_type] || "follow-up") : "follow-up";

  const activeSections = useMemo(() => {
    const pg = patient && patient.gender ? String(patient.gender) : "";
    return Object.entries(FORM_CONFIG).filter(([, v]) => {
      if (!v.apptTypes.includes(apptKey)) return false;
      if (v.ageMin && age !== null && age < v.ageMin) return false;
      if (v.ageMax && age !== null && age > v.ageMax) return false;
      if (v.gender && pg && pg.toLowerCase() !== v.gender.toLowerCase()) return false;
      return true;
    });
  }, [apptKey, age, patient]);

  const openEdit = (key) => {
    const existing = (submission && submission.data && submission.data[key]) || {};
    setDraft(existing);
    setOpenSection(key);
  };

  const saveSection = async (markComplete = false) => {
    if (!appt) return;
    setSaving(true);
    try {
      const existingData = (submission && submission.data) || {};
      const completed = (submission && submission.data && submission.data._completed) || [];
      const newData = {
        ...existingData,
        [openSection]: { ...draft, _updated_at: new Date().toISOString() },
      };
      if (markComplete && !completed.includes(openSection)) {
        newData._completed = [...completed, openSection];
      }

      if (submission) {
        const { error } = await supabase.from("portal_form_submissions")
          .update({ data: newData }).eq("id", submission.id);
        if (error) throw error;
        setSubmission({ ...submission, data: newData });
      } else {
        const { data: inserted, error } = await supabase.from("portal_form_submissions")
          .insert({
            practice_id:    practiceId,
            patient_id:     patientId,
            appointment_id: appt.id,
            form_type:      "pre_visit_intake",
            data:           newData,
            status:         "Draft",
          })
          .select().single();
        if (error) throw error;
        setSubmission(inserted);
      }

      logAudit({
        action:"Update", entityType:"portal_form_submission",
        entityId: submission ? submission.id : null,
        details:{ section: openSection, complete: markComplete },
      }).catch(()=>{});

      setOpenSection(null);
      setToast(markComplete ? "Section saved as complete." : "Progress saved.");
      setTimeout(()=>setToast(null), 3000);
      if (refreshBadges) refreshBadges();
    } catch (e) {
      setToast("Could not save: " + (e.message || e));
      setTimeout(()=>setToast(null), 5000);
    } finally {
      setSaving(false);
    }
  };

  // Used by self-contained sections (consent, medications) that save their own data
  // via edge functions or separate submission rows. Only tracks completion state here.
  const markSectionCompleteAndClose = async (sectionKey) => {
    if (!appt) return;
    try {
      const existingData = (submission && submission.data) || {};
      const completed = existingData._completed || [];
      if (completed.includes(sectionKey)) { setOpenSection(null); return; }
      const newData = { ...existingData, _completed: [...completed, sectionKey] };

      if (submission) {
        const { error } = await supabase.from("portal_form_submissions")
          .update({ data: newData }).eq("id", submission.id);
        if (error) throw error;
        setSubmission({ ...submission, data: newData });
      } else {
        const { data: inserted, error } = await supabase.from("portal_form_submissions")
          .insert({
            practice_id:    practiceId,
            patient_id:     patientId,
            appointment_id: appt.id,
            form_type:      "pre_visit_intake",
            data:           newData,
            status:         "Draft",
          })
          .select().single();
        if (error) throw error;
        setSubmission(inserted);
      }

      setOpenSection(null);
      setToast("Section saved as complete.");
      setTimeout(()=>setToast(null), 3000);
      if (refreshBadges) refreshBadges();
    } catch (e) {
      setToast("Could not mark complete: " + (e.message || e));
      setTimeout(()=>setToast(null), 5000);
    }
  };

  const submitAll = async () => {
    if (!submission) { setToast("Please complete at least one section first."); setTimeout(()=>setToast(null),3000); return; }
    const required = activeSections.filter(([, v]) => v.required).map(([k]) => k);
    const completed = (submission.data && submission.data._completed) || [];
    const missing = required.filter(r => !completed.includes(r));
    if (missing.length > 0) {
      setToast("Missing required sections: " + missing.map(m => FORM_CONFIG[m].label).join(", "));
      setTimeout(()=>setToast(null), 5000);
      return;
    }
    try {
      const { error } = await supabase.from("portal_form_submissions")
        .update({ status:"Submitted", submitted_at: new Date().toISOString() })
        .eq("id", submission.id);
      if (error) throw error;
      setSubmission({ ...submission, status:"Submitted" });
      logAudit({ action:"Update", entityType:"portal_form_submission", entityId: submission.id,
                 details:{ status:"Submitted" } }).catch(()=>{});
      setToast("Forms submitted. Your practice will review them before your visit.");
      setTimeout(()=>setToast(null), 5000);
      if (refreshBadges) refreshBadges();
    } catch (e) {
      setToast("Could not submit: " + (e.message || e));
      setTimeout(()=>setToast(null), 5000);
    }
  };

  if (loading) return <Empty title="Loading your forms..." />;
  if (!appt) return <Empty title="No upcoming appointment"
                           subtitle="Forms become available when you have an upcoming visit scheduled." />;

  const completed = (submission && submission.data && submission.data._completed) || [];
  const isSubmitted = submission && submission.status !== "Draft";

  return (
    <div>
      <Toast show={!!toast} msg={toast || ""} />

      <Panel accent={C.amberMid}>
        <div style={{ fontSize:10, fontWeight:600, color:C.amber, textTransform:"uppercase", letterSpacing:"0.04em" }}>
          Complete before your visit: {fmtDate(appt.appt_date)} at {slotToTime(appt.start_slot)}
        </div>
        <div style={{ fontSize:14, fontWeight:600, color:C.textPrimary, marginTop:3 }}>
          {appt.appt_type} Intake
        </div>
        <div style={{ fontSize:11, color:C.textSecondary, marginTop:2 }}>
          {completed.length} of {activeSections.length} sections complete
        </div>
      </Panel>

      {isSubmitted && (
        <InfoBox variant="teal">
          You have already submitted these forms. Your practice has them and will review before
          your visit. If you need to update something, contact the front desk.
        </InfoBox>
      )}

      {activeSections.map(([key, cfg]) => {
        const isComplete = completed.includes(key);
        const isOpen = openSection === key;
        return (
          <Panel key={key}>
            <div style={{
              display:"flex", justifyContent:"space-between", alignItems:"center",
              flexWrap:"wrap", gap:8,
            }}>
              <div>
                <div style={{ fontSize:13, fontWeight:600, color:C.textPrimary }}>{cfg.label}</div>
                <div style={{ fontSize:11, color:C.textTertiary, marginTop:2 }}>
                  {cfg.required ? "Required" : "Optional"}
                </div>
              </div>
              <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                {isComplete && <Badge label="Complete" variant="teal" />}
                {cfg.specialty && <Badge label="Specialty" variant="purple" />}
                {!isSubmitted && (
                  <Btn variant={isComplete ? "secondary" : "primary"}
                       onClick={() => openEdit(key)}>
                    {isComplete ? "Edit" : "Start"}
                  </Btn>
                )}
              </div>
            </div>

           {isOpen && key === "consent" && (
              <div style={{ marginTop:12, borderTop:"0.5px solid " + C.borderLight, paddingTop:12 }}>
                <ConsentSection
                  patientName={((patient && patient.first_name) || "") + " " + ((patient && patient.last_name) || "")}
                  onComplete={() => markSectionCompleteAndClose("consent")}
                  onClose={() => setOpenSection(null)}
                />
              </div>
            )}
            {isOpen && key === "medications" && (
              <div style={{ marginTop:12, borderTop:"0.5px solid " + C.borderLight, paddingTop:12 }}>
                <MedicationsSection
                  patientId={patientId}
                  practiceId={practiceId}
                  appointmentId={appt && appt.id}
                  onComplete={() => markSectionCompleteAndClose("medications")}
                  onClose={() => setOpenSection(null)}
                />
              </div>
            )}
            {isOpen && key !== "consent" && key !== "medications" && (
              <div style={{
                marginTop:12, borderTop:"0.5px solid " + C.borderLight, paddingTop:12,
              }}>
                <SectionForm sectionKey={key} draft={draft} setDraft={setDraft} patient={patient} />
                <div style={{ display:"flex", gap:8, marginTop:12 }}>
                  <Btn onClick={() => saveSection(true)} disabled={saving}>
                    {saving ? "Saving..." : "Save & Mark Complete"}
                  </Btn>
                  <Btn variant="secondary" onClick={() => saveSection(false)} disabled={saving}>
                    Save Progress
                  </Btn>
                  <Btn variant="ghost" onClick={() => setOpenSection(null)}>Close</Btn>
                </div>
              </div>
            )}
          </Panel>
        );
      })}

      {!isSubmitted && (
        <div style={{ marginTop:14, display:"flex", justifyContent:"flex-end" }}>
          <Btn onClick={submitAll}>Submit All Forms</Btn>
        </div>
      )}
    </div>
  );
}

function SectionForm({ sectionKey, draft, setDraft }) {
  const set = (k, v) => setDraft(prev => ({ ...prev, [k]: v }));

  if (sectionKey === "demographics") {
    return (
      <>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
          <Field label="Preferred Name">
            <Input value={draft.preferred_name || ""} onChange={v => set("preferred_name", v)}
                   placeholder="What should we call you?" />
          </Field>
          <Field label="Preferred Pronouns">
            <Select value={draft.pronouns || ""} onChange={v => set("pronouns", v)}
                    options={["", "she/her", "he/him", "they/them", "other"]} />
          </Field>
        </div>
        <Field label="Street Address">
          <Input value={draft.street || ""} onChange={v => set("street", v)} />
        </Field>
        <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr 1fr", gap:10 }}>
          <Field label="City"><Input value={draft.city || ""} onChange={v => set("city", v)} /></Field>
          <Field label="State"><Input value={draft.state || ""} onChange={v => set("state", v)} maxLength={2} /></Field>
          <Field label="ZIP"><Input value={draft.zip || ""} onChange={v => set("zip", v)} maxLength={10} /></Field>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
          <Field label="Mobile Phone"><Input value={draft.mobile || ""} onChange={v => set("mobile", v)} type="tel" /></Field>
          <Field label="Email"><Input value={draft.email || ""} onChange={v => set("email", v)} type="email" /></Field>
        </div>
        <Field label="Emergency Contact Name"><Input value={draft.emergency_name || ""} onChange={v => set("emergency_name", v)} /></Field>
        <Field label="Emergency Contact Phone"><Input value={draft.emergency_phone || ""} onChange={v => set("emergency_phone", v)} type="tel" /></Field>
      </>
    );
  }


  if (sectionKey === "health_history") {
    return (
      <>
        <Field label="Past Medical History (chronic conditions, major surgeries, hospitalizations)">
          <TextArea value={draft.pmh || ""} onChange={v => set("pmh", v)} rows={5}
                    placeholder="e.g. hypertension since 2015, appendectomy in 2018..." />
        </Field>
        <Field label="Family History (parents, siblings)">
          <TextArea value={draft.fh || ""} onChange={v => set("fh", v)} rows={3}
                    placeholder="e.g. Mother: diabetes. Father: heart disease." />
        </Field>
      </>
    );
  }


  if (sectionKey === "allergies") {
    return (
      <>
        <Field label="Drug Allergies">
          <TextArea value={draft.drug || ""} onChange={v => set("drug", v)} rows={2}
                    placeholder="e.g. Penicillin - hives" />
        </Field>
        <Field label="Food Allergies">
          <TextArea value={draft.food || ""} onChange={v => set("food", v)} rows={2} />
        </Field>
        <Field label="Environmental Allergies">
          <TextArea value={draft.env || ""} onChange={v => set("env", v)} rows={2}
                    placeholder="e.g. pollen, dust mites, pet dander" />
        </Field>
      </>
    );
  }

  if (sectionKey === "social_history") {
    return (
      <>
        <Field label="Tobacco Use">
          <Select value={draft.tobacco || ""} onChange={v => set("tobacco", v)}
                  options={["", "Never", "Former", "Current - daily", "Current - occasional"]} />
        </Field>
        <Field label="Alcohol Use">
          <Select value={draft.alcohol || ""} onChange={v => set("alcohol", v)}
                  options={["", "None", "Occasional (1-2 drinks/wk)", "Moderate (3-7/wk)", "Frequent (8+/wk)"]} />
        </Field>
        <Field label="Exercise">
          <Select value={draft.exercise || ""} onChange={v => set("exercise", v)}
                  options={["", "Sedentary", "Light (1-2x/wk)", "Moderate (3-4x/wk)", "Heavy (5+/wk)"]} />
        </Field>
        <Field label="Occupation">
          <Input value={draft.occupation || ""} onChange={v => set("occupation", v)} />
        </Field>
      </>
    );
  }

  if (sectionKey === "ros") {
    const systems = [
      "General","Cardiovascular","Respiratory","Gastrointestinal",
      "Musculoskeletal","Neurological","Skin","Endocrine","Psychiatric",
    ];
    return (
      <>
        <div style={{ fontSize:11, color:C.textTertiary, marginBottom:10 }}>
          Note any current symptoms in each area (leave blank if none).
        </div>
        {systems.map(s => (
          <Field key={s} label={s}>
            <Input value={draft[s] || ""} onChange={v => set(s, v)} placeholder="Any symptoms?" />
          </Field>
        ))}
      </>
    );
  }


  if (sectionKey === "womens_health") {
    return (
      <>
        <Field label="Last Menstrual Period (LMP)"><Input type="date" value={draft.lmp || ""} onChange={v => set("lmp", v)} /></Field>
        <Field label="Number of Pregnancies"><Input value={draft.pregnancies || ""} onChange={v => set("pregnancies", v)} type="tel" /></Field>
        <Field label="Number of Live Births"><Input value={draft.births || ""} onChange={v => set("births", v)} type="tel" /></Field>
        <Field label="Last Pap Smear Date"><Input type="date" value={draft.last_pap || ""} onChange={v => set("last_pap", v)} /></Field>
        <Field label="Last Mammogram Date"><Input type="date" value={draft.last_mammo || ""} onChange={v => set("last_mammo", v)} /></Field>
      </>
    );
  }

  if (sectionKey === "pediatrics") {
    return (
      <>
        <Field label="School / Grade Level"><Input value={draft.school || ""} onChange={v => set("school", v)} /></Field>
        <Field label="Immunizations up to date?">
          <Select value={draft.imm || ""} onChange={v => set("imm", v)}
                  options={["", "Yes", "No", "Unsure"]} />
        </Field>
        <Field label="Developmental concerns">
          <TextArea value={draft.dev || ""} onChange={v => set("dev", v)} rows={3} />
        </Field>
      </>
    );
  }

  return <div style={{ fontSize:12, color:C.textTertiary }}>No fields defined for this section.</div>;
}

