// ═══════════════════════════════════════════════════════════════════════════════
// src/views/portal/PediatricIntakeSection.jsx
//
// Specialized intake for pediatric patients (under 18). Replaces the basic
// pediatrics block in PortalForms.jsx. Covers the six areas a pediatrician
// actually cares about at intake:
//   1. Birth history (pregnancy, delivery, NICU stay)
//   2. Developmental milestones (self-report checklist)
//   3. Immunizations (status + most recent)
//   4. School / daycare / learning concerns
//   5. Custody and legal guardianship (critical for consent/release)
//   6. Behavioral and social notes
//
// Writes to portal_form_submissions with form_type='pediatric_intake' so it's
// distinct from the pre_visit_intake row and can be reviewed by the pediatric
// provider in one place.
// ═══════════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { C } from "../../lib/tokens";

const DELIVERY_METHODS = ["Vaginal - full term", "Vaginal - preterm", "C-section - planned", "C-section - emergency", "Unknown"];
const NICU_STAY        = ["No NICU stay", "Less than 1 day (observation)", "1-7 days", "8-30 days", "More than 30 days"];
const IMM_STATUS       = ["Up to date per pediatrician", "Behind on some vaccines", "Not vaccinated by choice", "Unsure"];
const SCHOOL_STATUS    = ["Not yet in school", "Daycare / Preschool", "Kindergarten", "Elementary (grades 1-5)", "Middle School (grades 6-8)", "High School (grades 9-12)", "Homeschooled"];
const CUSTODY_TYPES    = ["Both biological parents - married", "Both biological parents - unmarried", "Joint custody (divorced/separated)", "Sole custody - mother", "Sole custody - father", "Legal guardian (not parent)", "Foster care", "Other"];

const MILESTONES_BY_AGE = {
  "0-12mo":   ["Smiles responsively", "Holds head up", "Rolls over", "Sits without support", "Crawls", "Pulls to stand", "Says first word", "Waves bye-bye"],
  "1-3yr":    ["Walks independently", "Uses 2-3 word phrases", "Follows simple instructions", "Identifies body parts", "Uses utensils", "Runs without falling often"],
  "3-5yr":    ["Speaks in full sentences", "Knows name and age", "Counts to 10", "Identifies colors", "Puts on own shoes", "Catches a ball"],
  "5-12yr":   ["Reads at grade level", "Rides a bicycle", "Ties shoelaces", "Tells time on analog clock", "Writes full sentences"],
  "12-18yr":  ["Performs well in school", "Has age-appropriate friendships", "Participates in sports/activities", "Shows independence in daily tasks"],
};

function pickMilestoneSet(age) {
  if (age == null) return MILESTONES_BY_AGE["5-12yr"];
  if (age < 1)  return MILESTONES_BY_AGE["0-12mo"];
  if (age < 3)  return MILESTONES_BY_AGE["1-3yr"];
  if (age < 5)  return MILESTONES_BY_AGE["3-5yr"];
  if (age < 12) return MILESTONES_BY_AGE["5-12yr"];
  return MILESTONES_BY_AGE["12-18yr"];
}

export default function PediatricIntakeSection({ patientId, practiceId, appointmentId, patient, onComplete, onClose }) {
  const age = patient && patient.date_of_birth ? calcAge(patient.date_of_birth) : null;
  const milestones = pickMilestoneSet(age);

  const [form, setForm] = useState({
    // Birth history
    delivery_method:      "",
    birth_weight_lbs:     "",
    gestational_age_wks:  "",
    nicu_stay:            "",
    birth_complications:  "",

    // Milestones - checkboxes for each milestone
    milestones_met: {},
    milestones_concerns: "",

    // Immunizations
    imm_status:           "",
    last_well_visit:      "",
    imm_concerns:         "",

    // School
    school_status:        "",
    school_name:          "",
    learning_concerns:    "",
    iep_504:              "",  // "Yes" / "No"

    // Custody / guardianship
    custody_type:         "",
    lives_with:           "",
    legal_consent_person: "",  // Name of person authorized to consent to treatment

    // Behavior / social
    behavior_concerns:    "",
    sleep_hours:          "",
    screen_time_hrs:      "",
    diet_notes:           "",
  });
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState(null);

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));
  const toggleMilestone = (ms) => setForm(prev => ({
    ...prev,
    milestones_met: { ...prev.milestones_met, [ms]: !prev.milestones_met[ms] },
  }));

  const submit = async () => {
    setBanner(null);
    if (!form.custody_type) {
      setBanner({ kind: "error", msg: "Please select a custody/guardianship arrangement - this is required for consent purposes." });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        practice_id:    practiceId,
        patient_id:     patientId,
        appointment_id: appointmentId || null,
        form_type:      "pediatric_intake",
        data:           form,
        status:         "Submitted",
        submitted_at:   new Date().toISOString(),
      };
      const { error } = await supabase.from("portal_form_submissions").insert(payload);
      if (error) throw error;
      setBanner({ kind: "ok", msg: "Pediatric intake submitted. Your provider will review before the visit." });
      if (onComplete) onComplete();
    } catch (e) {
      setBanner({ kind: "error", msg: "Could not save: " + (e.message || e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div style={st.intro}>
        This intake asks about your child's growth, development, health history, and legal
        guardianship. All information is confidential and only reviewed by their care team.
        {age !== null && <> - Age on file: <strong>{age} {age === 1 ? "year" : "years"}</strong></>}
      </div>

      {banner && (
        <div style={banner.kind === "error" ? st.bannerErr : st.bannerOk}>{banner.msg}</div>
      )}

      <Section title="Birth history">
        <Field label="Delivery method">
          <Select value={form.delivery_method} onChange={v => set("delivery_method", v)} options={["", ...DELIVERY_METHODS]} />
        </Field>
        <div style={st.grid2}>
          <Field label="Birth weight (lbs)">
            <Input value={form.birth_weight_lbs} onChange={v => set("birth_weight_lbs", v)} placeholder="e.g. 7.5" />
          </Field>
          <Field label="Gestational age (weeks)">
            <Input value={form.gestational_age_wks} onChange={v => set("gestational_age_wks", v)} placeholder="e.g. 40" />
          </Field>
        </div>
        <Field label="NICU stay">
          <Select value={form.nicu_stay} onChange={v => set("nicu_stay", v)} options={["", ...NICU_STAY]} />
        </Field>
        <Field label="Birth complications (if any)">
          <TextArea value={form.birth_complications} onChange={v => set("birth_complications", v)} rows={2}
                    placeholder="e.g. jaundice treated under lights, low birth weight" />
        </Field>
      </Section>

      <Section title="Developmental milestones">
        <div style={{ fontSize: 11, color: C.textTertiary, marginBottom: 10 }}>
          Check all milestones your child has met. It's normal for some children to develop
          at different paces. The provider will review these together with you.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {milestones.map(ms => (
            <label key={ms} style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "7px 10px", background: C.bgSecondary,
              borderRadius: 5, fontSize: 12, cursor: "pointer",
            }}>
              <input type="checkbox"
                     checked={!!form.milestones_met[ms]}
                     onChange={() => toggleMilestone(ms)}
                     style={{ accentColor: C.teal, width: 14, height: 14 }} />
              {ms}
            </label>
          ))}
        </div>
        <Field label="Any developmental concerns (optional)">
          <TextArea value={form.milestones_concerns} onChange={v => set("milestones_concerns", v)} rows={2}
                    placeholder="Describe anything you'd like to discuss" />
        </Field>
      </Section>

      <Section title="Immunizations & well-visits">
        <Field label="Immunization status">
          <Select value={form.imm_status} onChange={v => set("imm_status", v)} options={["", ...IMM_STATUS]} />
        </Field>
        <Field label="Date of last well-child visit">
          <Input type="date" value={form.last_well_visit} onChange={v => set("last_well_visit", v)} />
        </Field>
        <Field label="Any questions or concerns about vaccines">
          <TextArea value={form.imm_concerns} onChange={v => set("imm_concerns", v)} rows={2} />
        </Field>
      </Section>

      <Section title="School / daycare">
        <Field label="Current school setting">
          <Select value={form.school_status} onChange={v => set("school_status", v)} options={["", ...SCHOOL_STATUS]} />
        </Field>
        <Field label="School or daycare name (optional)">
          <Input value={form.school_name} onChange={v => set("school_name", v)} />
        </Field>
        <div style={st.grid2}>
          <Field label="Does your child have an IEP or 504 plan?">
            <Select value={form.iep_504} onChange={v => set("iep_504", v)} options={["", "Yes", "No", "Unsure"]} />
          </Field>
          <Field label="Learning concerns (optional)">
            <Input value={form.learning_concerns} onChange={v => set("learning_concerns", v)}
                   placeholder="e.g. reading, attention" />
          </Field>
        </div>
      </Section>

      <Section title="Custody & legal guardianship">
        <div style={{ fontSize: 11, color: C.amber, background: C.amberBg, border: "0.5px solid " + C.amberBorder, padding: "8px 10px", borderRadius: 5, marginBottom: 10 }}>
          <strong>Required.</strong> We need this to know who can legally consent to treatment
          and receive medical information.
        </div>
        <Field label="Family / custody arrangement *">
          <Select value={form.custody_type} onChange={v => set("custody_type", v)} options={["", ...CUSTODY_TYPES]} />
        </Field>
        <Field label="Who does your child primarily live with?">
          <Input value={form.lives_with} onChange={v => set("lives_with", v)}
                 placeholder="e.g. Both parents, Mother full-time, Alternating weeks" />
        </Field>
        <Field label="Name of person(s) authorized to consent to medical treatment">
          <Input value={form.legal_consent_person} onChange={v => set("legal_consent_person", v)}
                 placeholder="Full legal name" />
        </Field>
      </Section>

      <Section title="Behavior, sleep, diet">
        <div style={st.grid2}>
          <Field label="Average hours of sleep per night">
            <Input value={form.sleep_hours} onChange={v => set("sleep_hours", v)} placeholder="e.g. 10" />
          </Field>
          <Field label="Average screen time per day (hours)">
            <Input value={form.screen_time_hrs} onChange={v => set("screen_time_hrs", v)} placeholder="e.g. 2" />
          </Field>
        </div>
        <Field label="Behavior concerns (optional)">
          <TextArea value={form.behavior_concerns} onChange={v => set("behavior_concerns", v)} rows={2}
                    placeholder="e.g. temper tantrums, trouble sleeping, anxiety" />
        </Field>
        <Field label="Diet notes (optional)">
          <TextArea value={form.diet_notes} onChange={v => set("diet_notes", v)} rows={2}
                    placeholder="e.g. picky eater, vegetarian, food allergies" />
        </Field>
      </Section>

      <div style={st.actions}>
        <button type="button" onClick={submit} disabled={saving} style={saving ? st.primaryBtnDisabled : st.primaryBtn}>
          {saving ? "Saving..." : "Save and Mark Complete"}
        </button>
        <button type="button" onClick={onClose} style={st.ghostBtn}>Close</button>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{
        fontSize: 11, fontWeight: 700, color: C.teal,
        textTransform: "uppercase", letterSpacing: 0.5,
        marginBottom: 8, borderBottom: "0.5px solid " + C.tealBorder, paddingBottom: 4,
      }}>{title}</div>
      {children}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

function Input({ value, onChange, placeholder, type = "text" }) {
  return (
    <input type={type} value={value || ""} onChange={e => onChange(e.target.value)} placeholder={placeholder}
           style={st.input} />
  );
}

function Select({ value, onChange, options }) {
  return (
    <select value={value || ""} onChange={e => onChange(e.target.value)} style={st.input}>
      {options.map(o => <option key={o} value={o}>{o || "Select..."}</option>)}
    </select>
  );
}

function TextArea({ value, onChange, rows = 3, placeholder }) {
  return (
    <textarea value={value || ""} onChange={e => onChange(e.target.value)} rows={rows} placeholder={placeholder}
              style={{ ...st.input, resize: "vertical", fontFamily: "inherit" }} />
  );
}

function calcAge(dob) {
  if (!dob) return null;
  const d = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

const st = {
  intro:     { fontSize: 12, color: C.textSecondary, background: C.tealBg, border: "0.5px solid " + C.tealBorder, borderRadius: 6, padding: "10px 14px", marginBottom: 14, lineHeight: 1.6 },
  bannerErr: { fontSize: 12, color: C.red,   background: C.redBg,   border: "0.5px solid " + C.redBorder,   borderRadius: 6, padding: "8px 12px", marginBottom: 12 },
  bannerOk:  { fontSize: 12, color: C.green, background: C.greenBg, border: "0.5px solid " + C.greenBorder, borderRadius: 6, padding: "8px 12px", marginBottom: 12 },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  input: { width: "100%", padding: "8px 10px", fontSize: 13, fontFamily: "inherit", border: "0.5px solid " + C.borderLight, borderRadius: 5, boxSizing: "border-box", background: "#fff" },
  actions: { display: "flex", gap: 8, marginTop: 18, alignItems: "center" },
  primaryBtn:         { fontSize: 12, fontWeight: 700, padding: "9px 18px", borderRadius: 6, background: C.teal, color: "#fff", border: "none", cursor: "pointer", fontFamily: "inherit" },
  primaryBtnDisabled: { fontSize: 12, fontWeight: 700, padding: "9px 18px", borderRadius: 6, background: C.textTertiary, color: "#fff", border: "none", cursor: "not-allowed", fontFamily: "inherit", opacity: 0.7 },
  ghostBtn:           { fontSize: 12, fontWeight: 600, padding: "9px 16px", borderRadius: 6, background: "transparent", color: C.textSecondary, border: "0.5px solid " + C.borderLight, cursor: "pointer", fontFamily: "inherit" },
};
