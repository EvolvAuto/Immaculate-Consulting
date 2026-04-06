/**
 * ICBOSForms.jsx
 * Slide-in form panels for IC-BOS data entry.
 * Supports manual typing AND voice-to-form via Vapi assistant.
 *
 * Forms included:
 *   AddClientPanel    — writes to: clients table
 *   AddDealPanel      — writes to: pipeline_deals table
 *   AddTaskPanel      — writes to: tasks table
 *   AddInvoicePanel   — writes to: invoices table
 *   AddCommPanel      — writes to: communications table
 *
 * Voice pattern:
 *   User speaks → Vapi extracts fields → JSON returned →
 *   fields auto-populate → user reviews → Save writes to Supabase
 */

import { useState, useEffect, useRef, useCallback } from "react";
import Vapi from "@vapi-ai/web";

const VAPI_PUBLIC_KEY = import.meta.env.VITE_VAPI_PUBLIC_KEY;
const ASSISTANT_ID    = import.meta.env.VITE_VAPI_ASSISTANT_ID;
const M = "var(--mono)";

// ─── Shared style tokens ────────────────────────────────────────────────────
const S = {
  overlay: {
    position: "fixed", inset: 0, zIndex: 200,
    background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
    display: "flex", justifyContent: "flex-end",
    animation: "fu 0.2s ease both",
  },
  panel: {
    width: 480, height: "100vh", overflowY: "auto",
    background: "#0f1117", borderLeft: "1px solid rgba(255,255,255,0.06)",
    display: "flex", flexDirection: "column",
    animation: "slideIn 0.25s ease both",
  },
  header: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "20px 24px 16px",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    position: "sticky", top: 0, background: "#0f1117", zIndex: 10,
  },
  title: { fontSize: 15, fontWeight: 700, color: "#f0f0f0" },
  close: {
    width: 28, height: 28, borderRadius: 6, border: "1px solid rgba(255,255,255,0.08)",
    background: "transparent", color: "#6b7280", cursor: "pointer",
    fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center",
  },
  body: { padding: "20px 24px", display: "flex", flexDirection: "column", gap: 14, flex: 1 },
  footer: {
    padding: "16px 24px", borderTop: "1px solid rgba(255,255,255,0.06)",
    display: "flex", gap: 8, position: "sticky", bottom: 0, background: "#0f1117",
  },
  label: { fontSize: 11, fontWeight: 600, color: "#9ca3af", marginBottom: 4, display: "block" },
  input: {
    width: "100%", background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)", borderRadius: 7,
    padding: "9px 12px", color: "#f0f0f0", fontSize: 13,
    fontFamily: "inherit", outline: "none", boxSizing: "border-box",
    transition: "border-color 0.15s",
  },
  select: {
    width: "100%", background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)", borderRadius: 7,
    padding: "9px 12px", color: "#f0f0f0", fontSize: 13,
    fontFamily: "inherit", outline: "none", boxSizing: "border-box",
    appearance: "none", cursor: "pointer",
  },
  textarea: {
    width: "100%", background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)", borderRadius: 7,
    padding: "9px 12px", color: "#f0f0f0", fontSize: 13,
    fontFamily: "inherit", outline: "none", boxSizing: "border-box",
    resize: "vertical", minHeight: 72,
  },
  row: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
  saveBtn: {
    flex: 1, background: "#6366f1", color: "#fff", border: "none",
    borderRadius: 7, padding: "10px 0", fontSize: 13, fontWeight: 600,
    cursor: "pointer", transition: "opacity 0.15s",
  },
  cancelBtn: {
    background: "rgba(255,255,255,0.04)", color: "#9ca3af",
    border: "1px solid rgba(255,255,255,0.08)", borderRadius: 7,
    padding: "10px 16px", fontSize: 13, cursor: "pointer",
  },
  voiceBar: {
    margin: "0 0 4px", padding: "10px 14px",
    background: "rgba(99,102,241,0.05)", border: "1px solid rgba(99,102,241,0.12)",
    borderRadius: 9, display: "flex", alignItems: "center", gap: 10,
  },
  voiceOrb: {
    width: 32, height: 32, borderRadius: "50%", border: "none",
    cursor: "pointer", flexShrink: 0, display: "flex",
    alignItems: "center", justifyContent: "center", transition: "all 0.3s",
  },
  voiceText: { fontSize: 11, color: "#a5b4fc", flex: 1, lineHeight: 1.4 },
  fieldGroup: { display: "flex", flexDirection: "column", gap: 4 },
  errorMsg: { fontSize: 11, color: "#f87171", marginTop: 2 },
  successMsg: {
    fontSize: 12, color: "#4ade80", background: "rgba(74,222,128,0.06)",
    border: "1px solid rgba(74,222,128,0.12)", borderRadius: 7,
    padding: "8px 12px", textAlign: "center",
  },
};

// ─── Voice-to-form hook ─────────────────────────────────────────────────────
// Starts a Vapi call scoped to a single form. Returns { listening, transcript,
// startListening, stopListening } and calls onFields(parsedFields) when done.

function useVoiceForm(formName, onFields) {
  const vapiRef  = useRef(null);
  const [state,  setState]  = useState("idle"); // idle | listening | thinking | error
  const [hint,   setHint]   = useState("");

  useEffect(() => {
    if (!VAPI_PUBLIC_KEY) return;
    const vapi = new Vapi(VAPI_PUBLIC_KEY);
    vapiRef.current = vapi;

    vapi.on("call-start", () => {
      setState("listening");
      setHint("Listening... speak the field values now.");
    });
    vapi.on("call-end", () => { setState("idle"); setHint(""); });
    vapi.on("error",    () => { setState("error"); setHint("Connection failed — try again."); });

    vapi.on("message", (msg) => {
      if (msg.type === "transcript" && msg.role === "assistant" && msg.transcriptType === "final") {
        // Try to parse JSON field values from assistant response
        try {
          const raw  = msg.transcript;
          const json = raw.match(/\{[\s\S]*\}/)?.[0];
          if (json) {
            const fields = JSON.parse(json);
            onFields(fields);
            setState("idle");
            setHint("Fields populated — review and save.");
            vapi.stop();
          }
        } catch {
          setHint(msg.transcript);
        }
      }
    });

    return () => { vapi.stop(); };
  }, []); // eslint-disable-line

  const startListening = useCallback(async () => {
    const vapi = vapiRef.current;
    if (!vapi) return;
    setState("listening");
    setHint("Connecting...");

    // Override assistant system prompt to extract form fields as JSON
    await vapi.start({
      model: {
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        systemPrompt: `You are an IC-BOS data entry assistant helping Leonard fill in the "${formName}" form.
The user will speak field values in natural language.
Extract ALL field values mentioned and return ONLY a valid JSON object with the field names as keys.
Do not add any explanation — respond with ONLY the JSON object.
Field names to extract: ${getFieldNames(formName)}.
Example: if user says "New client Sunrise Pediatrics, Tier 2, athenahealth, Dr. Webb, 6 providers, $5000 a month"
Return: {"name":"Sunrise Pediatrics","tier":"2","ehr":"athenahealth","primary_contact":"Dr. Webb","providers":6,"monthly_fee":5000}`,
        messages: [],
      },
      voice: { provider: "11labs", voiceId: "adam" },
    });
  }, [formName]);

  const stopListening = useCallback(() => {
    vapiRef.current?.stop();
    setState("idle");
    setHint("");
  }, []);

  return { state, hint, startListening, stopListening };
}

function getFieldNames(formName) {
  const map = {
    "Add Client":   "name, tier, status, ehr, monthly_fee, providers, primary_contact, contact_email, contact_phone, go_live_date, renewal_date, notes",
    "Add Deal":     "practice_name, specialty, ehr, stage, tier, estimated_value, contact_name, contact_email, next_action, next_action_date, notes",
    "Add Task":     "text, due, priority, category",
    "Add Invoice":  "client_name, invoice_type, amount, due_date, notes",
    "Log Comms":    "client_name, date, type, note",
  };
  return map[formName] ?? "all fields";
}

// ─── VoiceBar shared UI ─────────────────────────────────────────────────────
function VoiceBar({ formName, onFields }) {
  const { state, hint, startListening, stopListening } = useVoiceForm(formName, onFields);
  const active = state === "listening";

  const orbStyle = {
    ...S.voiceOrb,
    background: active
      ? "radial-gradient(circle at 40% 40%,#6366f1,#4f46e5)"
      : "rgba(255,255,255,0.06)",
    boxShadow: active ? "0 0 0 3px rgba(99,102,241,0.2)" : "none",
  };

  return (
    <div style={S.voiceBar}>
      <button onClick={active ? stopListening : startListening} style={orbStyle} title="Voice fill">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke={active ? "#e0e7ff" : "#9ca3af"} strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
          <line x1="12" y1="19" x2="12" y2="22"/>
        </svg>
      </button>
      <span style={S.voiceText}>
        {hint || `Tap mic and speak to auto-fill this ${formName} form`}
      </span>
    </div>
  );
}

// ─── Shared panel wrapper ────────────────────────────────────────────────────
function SlidePanel({ title, onClose, onSave, saving, saved, children, voiceBar }) {
  // Close on Escape key
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div style={S.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <style>{`
        @keyframes slideIn { from { transform: translateX(100%) } to { transform: translateX(0) } }
        .ic-input:focus { border-color: rgba(99,102,241,0.4) !important; }
      `}</style>
      <div style={S.panel}>
        <div style={S.header}>
          <span style={S.title}>{title}</span>
          <button onClick={onClose} style={S.close}>✕</button>
        </div>
        <div style={S.body}>
          {voiceBar}
          {saved && <div style={S.successMsg}>✓ Saved successfully!</div>}
          {children}
        </div>
        <div style={S.footer}>
          <button onClick={onClose} style={S.cancelBtn}>Cancel</button>
          <button onClick={onSave} disabled={saving} style={{ ...S.saveBtn, opacity: saving ? 0.6 : 1 }}>
            {saving ? "Saving..." : "Save to IC-BOS"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Field components ────────────────────────────────────────────────────────
function Field({ label, children }) {
  return (
    <div style={S.fieldGroup}>
      <label style={S.label}>{label}</label>
      {children}
    </div>
  );
}

function Input({ value, onChange, placeholder, type = "text" }) {
  return (
    <input className="ic-input" type={type} value={value ?? ""}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder} style={S.input} />
  );
}

function Select({ value, onChange, options, labels }) {
  return (
    <select className="ic-input" value={value ?? ""} onChange={e => onChange(e.target.value)} style={S.select}>
      <option value="">Select...</option>
      {options.map((o, i) => (
        <option key={o.value ?? o} value={o.value ?? o}>
          {labels ? labels[i] : (o.label ?? o)}
        </option>
      ))}
    </select>
  );
}


function Textarea({ value, onChange, placeholder }) {
  return (
    <textarea className="ic-input" value={value ?? ""} onChange={e => onChange(e.target.value)}
      placeholder={placeholder} style={S.textarea} />
  );
}


// =============================================================================
// FORM 1: ADD CLIENT PANEL
// =============================================================================

export function AddClientPanel({ onClose, onSaved, supabase, initialData = null }) {
  const blank = {
    name: "", tier: "2", status: "Active", ehr: "athenahealth",
    monthly_fee: "", platform_cost: "", providers: "",
    appts_per_week: "", avg_visit_value: "65", staff_hourly_rate: "18",
    no_show_before: "", no_show_current: "",
    weekly_hours_saved: "", weekly_hours_spent: "",
    go_live_date: "", renewal_date: "",
    primary_contact: "", contact_email: "", contact_phone: "",
    city: "", state: "NC", notes: "",
    engagement_type: "managed", selected_services: [],
  };

  // Pre-fill from pipeline deal when converting closed-won to active client
  const prefill = initialData ? {
    name:            initialData.practice        || "",
    tier:            String(initialData.tier     || "2"),
    ehr:             initialData.ehr             || "athenahealth",
    monthly_fee:     String(initialData.value    || ""),
    providers:       String(initialData.providers|| ""),
    no_show_before:  String(initialData.noShowBaseline || ""),
    primary_contact: initialData.contact         || "",
    notes:           `Converted from pipeline.${initialData.nextAction ? " Next action: " + initialData.nextAction : ""}`,
  } : null;

  const [fields, setFields] = useState(prefill ? { ...blank, ...prefill } : blank);
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [error,  setError]  = useState("");

  const set = (key) => (val) => setFields(p => ({ ...p, [key]: val }));

  // Voice fills any subset of fields
  const onVoiceFields = (parsed) => {
    setFields(p => ({ ...p, ...parsed }));
  };

  const handleSave = async () => {
    if (!fields.name.trim()) { setError("Client name is required."); return; }
    setError(""); setSaving(true);

    const payload = {
      name:               fields.name.trim(),
      tier:               fields.tier,
      status:             fields.status,
      ehr:                fields.ehr,
      monthly_fee:        Number(fields.monthly_fee) || 0,
      platform_cost:      Number(fields.platform_cost) || 0,
      providers:          Number(fields.providers) || 1,
      appts_per_week:     Number(fields.appts_per_week) || 0,
      avg_visit_value:    Number(fields.avg_visit_value) || 65,
      staff_hourly_rate:  Number(fields.staff_hourly_rate) || 18,
      no_show_before:     Number(fields.no_show_before) / 100 || 0,
      no_show_current:    Number(fields.no_show_current) / 100 || 0,
      weekly_hours_saved: Number(fields.weekly_hours_saved) || 0,
      weekly_hours_spent: Number(fields.weekly_hours_spent) || 0,
      go_live_date:       fields.go_live_date || null,
      renewal_date:       fields.renewal_date || null,
      primary_contact:    fields.primary_contact || null,
      contact_email:      fields.contact_email || null,
      contact_phone:      fields.contact_phone || null,
      city:               fields.city || null,
      state:              fields.state || "NC",
      notes:              fields.notes || null,
      engagement_type:    fields.engagement_type,
      selected_services:  fields.selected_services,
    };

    const { error: err } = await supabase.from("clients").insert([payload]);
    setSaving(false);
    if (err) { setError(err.message); return; }
    setSaved(true);
    setTimeout(() => { onSaved?.(); onClose(); }, 1200);
  };

  const ehrOptions = [
    "athenahealth","eClinicalWorks","NextGen","Epic",
    "Cerner","Allscripts","Practice Fusion","Meditech","Other",
  ];

  return (
    <SlidePanel
      title="Add New Client"
      onClose={onClose}
      onSave={handleSave}
      saving={saving}
      saved={saved}
      voiceBar={<VoiceBar formName="Add Client" onFields={onVoiceFields} />}
    >
      {error && <div style={S.errorMsg}>⚠ {error}</div>}

      {initialData && (
        <div style={{ background:"#f0fdf4", border:"1px solid #bbf7d0", borderRadius:7, padding:"10px 12px", fontSize:11, color:"#15803d", display:"flex", alignItems:"flex-start", gap:8, marginBottom:4 }}>
          <span>✓</span>
          <div>
            <strong>Converting from pipeline: {initialData?.practice}</strong>
            <div style={{ fontSize:10, color:"#6b7280", marginTop:2 }}>Key fields pre-filled. Complete remaining fields and save to add as an active client.</div>
          </div>
        </div>
      )}

      <Field label="Practice Name *">
        <Input value={fields.name} onChange={set("name")} placeholder="e.g. Sunrise Family Medicine" />
      </Field>

      <div style={S.row}>
        <Field label="Engagement Type">
          <Select value={fields.engagement_type} onChange={set("engagement_type")}
            options={["managed","individual","mixed"]}
            labels={["Managed Package","Individual Services","Package + Services"]} />
        </Field>

        {fields.engagement_type !== "individual" && (
          <Field label="Managed Tier">
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {[{t:"1",n:"AI Foundations",p:"$2,500/mo",d:"1-3 providers"},{t:"2",n:"AI Operations Suite",p:"$5,000/mo",d:"4-10 providers"},{t:"3",n:"AI Transformation",p:"$10,000+/mo",d:"10+ providers"}].map(opt => (
                <button key={opt.t} onClick={() => set("tier")(opt.t)} style={{ padding:"8px 12px", borderRadius:7, border:`1px solid ${fields.tier===opt.t?"#374151":"#e5e7eb"}`, background:fields.tier===opt.t?"#f3f4f6":"#ffffff", cursor:"pointer", textAlign:"left", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <div><span style={{ fontSize:12, fontWeight:600, color:fields.tier===opt.t?"#111827":"#6b7280" }}>Tier {opt.t}: {opt.n}</span><span style={{ fontSize:10, color:"#9ca3af", marginLeft:8 }}>{opt.d}</span></div>
                  <span style={{ fontSize:12, fontWeight:700, color:fields.tier===opt.t?"#111827":"#9ca3af", fontFamily:"monospace" }}>{opt.p}</span>
                </button>
              ))}
            </div>
          </Field>
        )}

        {fields.engagement_type !== "managed" && (
          <Field label="Individual Services">
            <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
              {["Prompt Engineering","AI Staff Training","Web App Development","AI Strategy Consultation","Document & SOP Creation","Forms & Templates"].map(svc => {
                const active = fields.selected_services.includes(svc);
                return (
                  <button key={svc} onClick={() => set("selected_services")(active ? fields.selected_services.filter(s=>s!==svc) : [...fields.selected_services, svc])} style={{ padding:"7px 12px", borderRadius:6, border:`1px solid ${active?"#374151":"#e5e7eb"}`, background:active?"#f3f4f6":"#ffffff", cursor:"pointer", textAlign:"left", color:active?"#111827":"#6b7280", fontSize:12, display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ width:14, height:14, borderRadius:3, border:`2px solid ${active?"#374151":"#d1d5db"}`, background:active?"#374151":"transparent", display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, color:"white", flexShrink:0 }}>{active?"✓":""}</span>
                    {svc}
                  </button>
                );
              })}
            </div>
          </Field>
        )}
        <Field label="Status">
          <Select value={fields.status} onChange={set("status")}
            options={["Active","Onboarding","Paused","Churned"]} />
        </Field>
      </div>

      <Field label="EHR Platform">
        <Select value={fields.ehr} onChange={set("ehr")} options={ehrOptions} />
      </Field>

      <div style={S.row}>
        <Field label="Monthly Fee ($)">
          <Input value={fields.monthly_fee} onChange={set("monthly_fee")} placeholder="5000" type="number" />
        </Field>
        <Field label="Platform Cost ($)">
          <Input value={fields.platform_cost} onChange={set("platform_cost")} placeholder="48" type="number" />
        </Field>
      </div>

      <div style={S.row}>
        <Field label="Providers">
          <Input value={fields.providers} onChange={set("providers")} placeholder="6" type="number" />
        </Field>
        <Field label="Appts / Week">
          <Input value={fields.appts_per_week} onChange={set("appts_per_week")} placeholder="180" type="number" />
        </Field>
      </div>

      <div style={S.row}>
        <Field label="No-Show Before (%)">
          <Input value={fields.no_show_before} onChange={set("no_show_before")} placeholder="18" type="number" />
        </Field>
        <Field label="No-Show Current (%)">
          <Input value={fields.no_show_current} onChange={set("no_show_current")} placeholder="7.2" type="number" />
        </Field>
      </div>

      <div style={S.row}>
        <Field label="Hrs Saved / Week">
          <Input value={fields.weekly_hours_saved} onChange={set("weekly_hours_saved")} placeholder="12" type="number" />
        </Field>
        <Field label="Hrs Spent / Week">
          <Input value={fields.weekly_hours_spent} onChange={set("weekly_hours_spent")} placeholder="6" type="number" />
        </Field>
      </div>

      <div style={S.row}>
        <Field label="Go-Live Date">
          <Input value={fields.go_live_date} onChange={set("go_live_date")} type="date" />
        </Field>
        <Field label="Renewal Date">
          <Input value={fields.renewal_date} onChange={set("renewal_date")} type="date" />
        </Field>
      </div>

      <Field label="Primary Contact">
        <Input value={fields.primary_contact} onChange={set("primary_contact")} placeholder="Dr. Sarah Johnson" />
      </Field>

      <div style={S.row}>
        <Field label="Contact Email">
          <Input value={fields.contact_email} onChange={set("contact_email")} placeholder="dr@practice.com" type="email" />
        </Field>
        <Field label="Contact Phone">
          <Input value={fields.contact_phone} onChange={set("contact_phone")} placeholder="(919) 555-1234" />
        </Field>
      </div>

      <div style={S.row}>
        <Field label="City">
          <Input value={fields.city} onChange={set("city")} placeholder="Raleigh" />
        </Field>
        <Field label="State">
          <Input value={fields.state} onChange={set("state")} placeholder="NC" />
        </Field>
      </div>

      <Field label="Notes">
        <Textarea value={fields.notes} onChange={set("notes")} placeholder="NC Medicaid referral, known through..." />
      </Field>
    </SlidePanel>
  );
}


// =============================================================================
// FORM 2: ADD PIPELINE DEAL PANEL
// =============================================================================

export function AddDealPanel({ onClose, onSaved, supabase }) {
  const blank = {
    practice_name: "", specialty: "", ehr: "athenahealth",
    stage: "Cold", tier: "2", estimated_value: "",
    close_probability: "", contact_name: "", contact_email: "", contact_phone: "",
    next_action: "", next_action_date: "",
    providers: "", payer_mix: "", no_show_baseline: "",
    ehr_difficulty: "", ehr_timeline: "", ehr_notes: "", notes: "",
    engagement_type: "managed", selected_services: [],
  };

  const [fields, setFields] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [error,  setError]  = useState("");

  const set = (key) => (val) => setFields(p => ({ ...p, [key]: val }));
  const onVoiceFields = (parsed) => setFields(p => ({ ...p, ...parsed }));

  const handleSave = async () => {
    if (!fields.practice_name.trim()) { setError("Practice name is required."); return; }
    setError(""); setSaving(true);

    const payload = {
      practice_name:     fields.practice_name.trim(),
      specialty:         fields.specialty || null,
      ehr:               fields.ehr,
      stage:             fields.stage,
      tier:              fields.tier,
      estimated_value:   Number(fields.estimated_value) || 0,
      close_probability: Number(fields.close_probability) || 0,
      contact_name:      fields.contact_name || null,
      next_action:       fields.next_action || null,
      next_action_date:  fields.next_action_date || null,
      providers:         Number(fields.providers) || 1,
      payer_mix:         fields.payer_mix || null,
      no_show_baseline:  Number(fields.no_show_baseline) || 0,
      ehr_difficulty:    fields.ehr_difficulty || null,
      ehr_timeline:      fields.ehr_timeline || null,
      ehr_notes:         fields.ehr_notes || null,
      notes:             fields.notes || null,
      days_in_stage:     0,
      engagement_type:   fields.engagement_type,
      selected_services: fields.selected_services,
    };

    const { error: err } = await supabase.from("pipeline_deals").insert([payload]);
    setSaving(false);
    if (err) { setError(err.message); return; }
    setSaved(true);
    setTimeout(() => { onSaved?.(); onClose(); }, 1200);
  };

  const stageOptions = ["Cold","Discovery","Proposal","Negotiation","Closed Won","Closed Lost"];
  const ehrOptions   = ["athenahealth","eClinicalWorks","NextGen","Epic","Cerner","Allscripts","Practice Fusion","Meditech","Other"];

  return (
    <SlidePanel
      title="Add Pipeline Deal"
      onClose={onClose}
      onSave={handleSave}
      saving={saving}
      saved={saved}
      voiceBar={<VoiceBar formName="Add Deal" onFields={onVoiceFields} />}
    >
      {error && <div style={S.errorMsg}>⚠ {error}</div>}

      <Field label="Practice Name *">
        <Input value={fields.practice_name} onChange={set("practice_name")} placeholder="e.g. Blue Ridge Orthopedics" />
      </Field>

      <div style={S.row}>
        <Field label="Specialty">
          <Input value={fields.specialty} onChange={set("specialty")} placeholder="Family Medicine" />
        </Field>
        <Field label="EHR Platform">
          <Select value={fields.ehr} onChange={set("ehr")} options={ehrOptions} />
        </Field>
      </div>

      <div style={S.row}>
        <Field label="Stage">
          <Select value={fields.stage} onChange={set("stage")} options={stageOptions} />
        </Field>
      </div>

      <div style={S.row}>
        <Field label="Est. Monthly Value ($)">
         <Input value={fields.estimated_value} onChange={set("estimated_value")} placeholder="5000" type="number" />
        </Field>
        <Field label="Close Probability (%)">
          <Input value={fields.close_probability} onChange={set("close_probability")} placeholder="60" type="number" />
        </Field>
      </div>

      <div style={S.row}>
        <Field label="Contact Name">
          <Input value={fields.contact_name} onChange={set("contact_name")} placeholder="Dr. Patel" />
        </Field>
      </div>

      <Field label="Next Action">
        <Input value={fields.next_action} onChange={set("next_action")} placeholder="Send proposal by Friday" />
      </Field>

      <div style={S.row}>
        <Field label="Next Action Date">
          <Input value={fields.next_action_date} onChange={set("next_action_date")} type="date" />
        </Field>
        <Field label="Providers">
          <Input value={fields.providers} onChange={set("providers")} placeholder="6" type="number" />
        </Field>
      </div>

      <div style={S.row}>
        <Field label="Payer Mix">
          <Input value={fields.payer_mix} onChange={set("payer_mix")} placeholder="NC Medicaid + BCBS" />
        </Field>
        <Field label="No-Show Baseline (%)">
          <Input value={fields.no_show_baseline} onChange={set("no_show_baseline")} placeholder="19" type="number" />
        </Field>
      </div>

      <div style={S.row}>
        <Field label="EHR Difficulty">
          <Input value={fields.ehr_difficulty} onChange={set("ehr_difficulty")} placeholder="2/5" />
        </Field>
        <Field label="EHR Timeline">
          <Input value={fields.ehr_timeline} onChange={set("ehr_timeline")} placeholder="1-2 weeks" />
        </Field>
      </div>

      <Field label="EHR Notes">
        <Textarea value={fields.ehr_notes} onChange={set("ehr_notes")} placeholder="Integration complexity notes..." />
      </Field>

      <Field label="Engagement Type">
        <Select value={fields.engagement_type} onChange={set("engagement_type")}
          options={["managed","individual","mixed"]}
          labels={["Managed Package","Individual Services","Package + Services"]} />
      </Field>

      {fields.engagement_type !== "individual" && (
        <Field label="Managed Tier">
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
           {[{t:"1",n:"AI Foundations",p:"$2,500/mo",d:"1-3 providers"},{t:"2",n:"AI Operations Suite",p:"$5,000/mo",d:"4-10 providers"},{t:"3",n:"AI Transformation",p:"$10,000+/mo",d:"10+ providers"}].map(opt => (
              <button key={opt.t} onClick={() => set("tier")(opt.t)} style={{ padding:"8px 12px", borderRadius:7, border:`1px solid ${fields.tier===opt.t?"#374151":"#e5e7eb"}`, background:fields.tier===opt.t?"#f3f4f6":"#ffffff", cursor:"pointer", textAlign:"left", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div><span style={{ fontSize:12, fontWeight:600, color:fields.tier===opt.t?"#111827":"#6b7280" }}>Tier {opt.t}: {opt.n}</span><span style={{ fontSize:10, color:"#9ca3af", marginLeft:8 }}>{opt.d}</span></div>
                <span style={{ fontSize:12, fontWeight:700, color:fields.tier===opt.t?"#111827":"#9ca3af", fontFamily:"monospace" }}>{opt.p}</span>
              </button>
            ))}
          </div>
        </Field>
      )}

      {fields.engagement_type !== "managed" && (
        <Field label="Individual Services">
          <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
            {["Prompt Engineering","AI Staff Training","Web App Development","AI Strategy Consultation","Document & SOP Creation","Forms & Templates"].map(svc => {
              const active = fields.selected_services.includes(svc);
              return (
                <button key={svc} onClick={() => set("selected_services")(active ? fields.selected_services.filter(s=>s!==svc) : [...fields.selected_services, svc])} style={{ padding:"7px 12px", borderRadius:6, border:`1px solid ${active?"#374151":"#e5e7eb"}`, background:active?"#f3f4f6":"#ffffff", cursor:"pointer", textAlign:"left", color:active?"#111827":"#6b7280", fontSize:12, display:"flex", alignItems:"center", gap:8 }}>
                  <span style={{ width:14, height:14, borderRadius:3, border:`2px solid ${active?"#374151":"#d1d5db"}`, background:active?"#374151":"transparent", display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, color:"white", flexShrink:0 }}>{active?"✓":""}</span>
                  {svc}
                </button>
              );
            })}
          </div>
        </Field>
      )}

      <Field label="General Notes">
        <Textarea value={fields.notes} onChange={set("notes")} placeholder="How we found them, context..." />
      </Field>
    </SlidePanel>
  );
}


// =============================================================================
// FORM 3: ADD TASK PANEL
// =============================================================================

export function AddTaskPanel({ onClose, onSaved, supabase }) {
  const blank = { text: "", due: "", priority: "Medium", category: "Client" };
  const [fields, setFields] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [error,  setError]  = useState("");

  const set = (key) => (val) => setFields(p => ({ ...p, [key]: val }));
  const onVoiceFields = (parsed) => setFields(p => ({ ...p, ...parsed }));

  const handleSave = async () => {
    if (!fields.text.trim()) { setError("Task description is required."); return; }
    setError(""); setSaving(true);

    const { error: err } = await supabase.from("tasks").insert([{
      text:      fields.text.trim(),
      due:       fields.due || null,
      priority:  fields.priority,
      category:  fields.category,
      completed: false,
    }]);

    setSaving(false);
    if (err) { setError(err.message); return; }
    setSaved(true);
    setTimeout(() => { onSaved?.(); onClose(); }, 1200);
  };

  return (
    <SlidePanel
      title="Add Task"
      onClose={onClose}
      onSave={handleSave}
      saving={saving}
      saved={saved}
      voiceBar={<VoiceBar formName="Add Task" onFields={onVoiceFields} />}
    >
      {error && <div style={S.errorMsg}>⚠ {error}</div>}

      <Field label="Task Description *">
        <Textarea value={fields.text} onChange={set("text")}
          placeholder="e.g. Send Sunrise Family Medicine proposal by Friday" />
      </Field>

      <div style={S.row}>
        <Field label="Priority">
          <Select value={fields.priority} onChange={set("priority")}
            options={["Critical","High","Medium","Low"]} />
        </Field>
        <Field label="Category">
          <Select value={fields.category} onChange={set("category")}
            options={["Client","Sales","Operations","Finance","Admin"]} />
        </Field>
      </div>

      <Field label="Due Date">
        <Input value={fields.due} onChange={set("due")} type="date" />
      </Field>
    </SlidePanel>
  );
}


// =============================================================================
// FORM 4: ADD INVOICE PANEL
// =============================================================================

export function AddInvoicePanel({ onClose, onSaved, supabase, clients = [] }) {
  const blank = {
    client_id: "", invoice_type: "Monthly Retainer",
    amount: "", due_date: "", notes: "",
  };
  const [fields, setFields] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [error,  setError]  = useState("");

  const set = (key) => (val) => setFields(p => ({ ...p, [key]: val }));

  const onVoiceFields = (parsed) => {
    // If voice says client name, try to match to client id
    if (parsed.client_name) {
      const match = clients.find(c =>
        c.name.toLowerCase().includes(parsed.client_name.toLowerCase())
      );
      if (match) parsed.client_id = match.id;
      delete parsed.client_name;
    }
    setFields(p => ({ ...p, ...parsed }));
  };

  const handleSave = async () => {
    if (!fields.client_id) { setError("Please select a client."); return; }
    if (!fields.amount)    { setError("Amount is required."); return; }
    setError(""); setSaving(true);

    const invoiceNum = `INV-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`;

    const { error: err } = await supabase.from("invoices").insert([{
      invoice_number: invoiceNum,
      client_id:      fields.client_id,
      invoice_type:   fields.invoice_type,
      amount:         Number(fields.amount),
      total_amount:   Number(fields.amount),
      due_date:       fields.due_date || null,
      status:         "Pending",
      notes:          fields.notes || null,
      issued_date:    new Date().toISOString().split("T")[0],
    }]);

    setSaving(false);
    if (err) { setError(err.message); return; }
    setSaved(true);
    setTimeout(() => { onSaved?.(); onClose(); }, 1200);
  };

  const clientOptions = clients.map(c => ({ value: c.id, label: c.name }));
  const typeOptions   = ["Monthly Retainer","Project Milestone","Usage Passthrough","One-Time Service"];

  return (
    <SlidePanel
      title="Add Invoice"
      onClose={onClose}
      onSave={handleSave}
      saving={saving}
      saved={saved}
      voiceBar={<VoiceBar formName="Add Invoice" onFields={onVoiceFields} />}
    >
      {error && <div style={S.errorMsg}>⚠ {error}</div>}

      <Field label="Client *">
        <Select value={fields.client_id} onChange={set("client_id")} options={clientOptions} />
      </Field>

      <Field label="Invoice Type">
        <Select value={fields.invoice_type} onChange={set("invoice_type")} options={typeOptions} />
      </Field>

      <div style={S.row}>
        <Field label="Amount ($) *">
          <Input value={fields.amount} onChange={set("amount")} placeholder="5000" type="number" />
        </Field>
        <Field label="Due Date">
          <Input value={fields.due_date} onChange={set("due_date")} type="date" />
        </Field>
      </div>

      <Field label="Notes">
        <Textarea value={fields.notes} onChange={set("notes")} placeholder="March managed service retainer..." />
      </Field>
    </SlidePanel>
  );
}


// =============================================================================
// FORM 5: LOG COMMUNICATION PANEL
// =============================================================================

export function AddCommPanel({ onClose, onSaved, supabase, clients = [] }) {
  const blank = {
    client_id: "", date: new Date().toISOString().split("T")[0],
    type: "Call", note: "",
  };
  const [fields, setFields] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [error,  setError]  = useState("");

  const set = (key) => (val) => setFields(p => ({ ...p, [key]: val }));

  const onVoiceFields = (parsed) => {
    if (parsed.client_name) {
      const match = clients.find(c =>
        c.name.toLowerCase().includes(parsed.client_name.toLowerCase())
      );
      if (match) parsed.client_id = match.id;
      delete parsed.client_name;
    }
    setFields(p => ({ ...p, ...parsed }));
  };

  const handleSave = async () => {
    if (!fields.client_id) { setError("Please select a client."); return; }
    if (!fields.note.trim()) { setError("Note is required."); return; }
    setError(""); setSaving(true);

    const { data: { user } } = await supabase.auth.getUser();

    const { error: err } = await supabase.from("communications").insert([{
      client_id: fields.client_id,
      date:      fields.date,
      type:      fields.type,
      note:      fields.note.trim(),
      user_id:   user?.id ?? null,
    }]);

    setSaving(false);
    if (err) { setError(err.message); return; }
    setSaved(true);
    setTimeout(() => { onSaved?.(); onClose(); }, 1200);
  };

  const clientOptions = clients.map(c => ({ value: c.id, label: c.name }));
  const typeOptions   = ["Email","Call","Meeting","SMS","Note","Proposal Sent","Invoice Sent"];

  return (
    <SlidePanel
      title="Log Communication"
      onClose={onClose}
      onSave={handleSave}
      saving={saving}
      saved={saved}
      voiceBar={<VoiceBar formName="Log Comms" onFields={onVoiceFields} />}
    >
      {error && <div style={S.errorMsg}>⚠ {error}</div>}

      <Field label="Client *">
        <Select value={fields.client_id} onChange={set("client_id")} options={clientOptions} />
      </Field>

      <div style={S.row}>
        <Field label="Type">
          <Select value={fields.type} onChange={set("type")} options={typeOptions} />
        </Field>
        <Field label="Date">
          <Input value={fields.date} onChange={set("date")} type="date" />
        </Field>
      </div>

      <Field label="Note *">
        <Textarea value={fields.note} onChange={set("note")}
          placeholder="e.g. Discussed Q2 renewal pricing. Client very positive about ROI results..." />
      </Field>
    </SlidePanel>
  );
}


// =============================================================================
// FORM 6: ADD ONBOARDING PROJECT PANEL
// =============================================================================

export function AddOnboardingPanel({ onClose, onSaved, supabase, clients = [] }) {
  const blank = {
    client_id: "", kickoff_date: new Date().toISOString().split("T")[0],
    target_go_live: "", notes: "",
  };
  const [fields, setFields] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [error,  setError]  = useState("");

  const set = (key) => (val) => setFields(p => ({ ...p, [key]: val }));

  const handleSave = async () => {
    if (!fields.client_id)      { setError("Please select a client."); return; }
    if (!fields.target_go_live) { setError("Target go-live date is required."); return; }
    setError(""); setSaving(true);

    const kickoff   = new Date(fields.kickoff_date);
    const goLive    = new Date(fields.target_go_live);
    const totalDays = Math.ceil((goLive - kickoff) / 86400000);
    const phaseLen  = Math.floor(totalDays / 5);

    const phases = ["Discovery","Build","Testing","Training & Go-Live","Optimize"].map((name, i) => {
      const end = new Date(kickoff);
      end.setDate(end.getDate() + (i + 1) * phaseLen - 1);
      return { name, phase: i+1, status: i===0 ? "in-progress" : "upcoming", progress: 0, target_date: end.toISOString().split("T")[0], completed_date: null };
    });

    const { error: err } = await supabase.from("onboarding_projects").insert([{
      client_id: fields.client_id, kickoff_date: fields.kickoff_date,
      target_go_live: fields.target_go_live, notes: fields.notes || null,
      phases, risks: [], blockers: [], current_phase: 1, overall_progress: 0,
    }]);

    setSaving(false);
    if (err) { setError(err.message); return; }
    setSaved(true);
    setTimeout(() => { onSaved?.(); onClose(); }, 1200);
  };

  const clientOptions = clients.map(c => ({ value: c.id, label: c.name }));

  return (
    <SlidePanel title="Start Onboarding Project" onClose={onClose} onSave={handleSave} saving={saving} saved={saved}>
      {error && <div style={S.errorMsg}>⚠ {error}</div>}
      <Field label="Client *">
        <Select value={fields.client_id} onChange={set("client_id")} options={clientOptions} />
      </Field>
      <div style={S.row}>
        <Field label="Kickoff Date">
          <Input value={fields.kickoff_date} onChange={set("kickoff_date")} type="date" />
        </Field>
        <Field label="Target Go-Live *">
          <Input value={fields.target_go_live} onChange={set("target_go_live")} type="date" />
        </Field>
      </div>
      <Field label="Notes">
        <Textarea value={fields.notes} onChange={set("notes")} placeholder="Key context, EHR access status, special considerations..." />
      </Field>
      <div style={{ fontSize:11, color:"#6b7280", padding:"10px 12px", background:"#f9fafb", border:"1px solid #e5e7eb", borderRadius:7, lineHeight:1.6 }}>
        5 phases auto-generated: Discovery, Build, Testing, Training & Go-Live, Optimize — evenly distributed between kickoff and go-live.
      </div>
    </SlidePanel>
  );
}
