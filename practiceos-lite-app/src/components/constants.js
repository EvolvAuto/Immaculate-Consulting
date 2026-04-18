// ═══════════════════════════════════════════════════════════════════════════════
// PracticeOS Lite — Shared Constants
// Enums mirror live Supabase schema exactly (Title Case matters)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Appointment Types (align with DB enum appt_type) ─────────────────────────
export const DEFAULT_APPT_TYPES = [
  { name: "New Patient",  dot: "#3B82F6", bg: "#EFF6FF", border: "#BFDBFE", color: "#1D4ED8", defaultDuration: 60 },
  { name: "Follow-up",    dot: "#1D9E75", bg: "#E1F5EE", border: "#9FE1CB", color: "#0F6E56", defaultDuration: 30 },
  { name: "Annual Exam",  dot: "#10B981", bg: "#D1FAE5", border: "#6EE7B7", color: "#065F46", defaultDuration: 45 },
  { name: "Procedure",    dot: "#8B5CF6", bg: "#EDE9FE", border: "#C4B5FD", color: "#6D28D9", defaultDuration: 90 },
  { name: "Telehealth",   dot: "#D08A2E", bg: "#FAEEDA", border: "#FAC775", color: "#854F0B", defaultDuration: 30 },
  { name: "Walk-in",      dot: "#F59E0B", bg: "#FEF3C7", border: "#FCD34D", color: "#92400E", defaultDuration: 20 },
  { name: "Admin / Block", dot: "#9c9b94", bg: "#f7f7f5", border: "rgba(0,0,0,0.18)", color: "#6b6a63", defaultDuration: 60 },
];

// ─── NC Payers (mirrors DB enum payer_category) ───────────────────────────────
export const NC_PAYER_GROUPS = [
  { group: "NC Medicaid - Standard", options: ["AmeriHealth Caritas NC", "Carolina Complete Health", "Healthy Blue", "UnitedHealthcare Community Plan", "WellCare of NC"] },
  { group: "NC Medicaid - Tailored", options: ["Alliance Health", "Partners Health Management", "Trillium Health Resources", "Vaya Health"] },
  { group: "NC Medicaid - Other", options: ["NC Medicaid Direct", "EBCI Tribal Option", "Healthy Blue Care Together"] },
  { group: "Medicare", options: ["Medicare (Traditional)", "Medicare Advantage - BCBS NC", "Medicare Advantage - Aetna", "Medicare Advantage - Humana", "Medicare Advantage - UnitedHealthcare", "Medicare Advantage - WellCare"] },
  { group: "Commercial", options: ["BCBS NC", "Aetna", "Cigna", "UnitedHealthcare", "Humana", "Ambetter NC", "Molina Healthcare", "NC State Health Plan"] },
  { group: "Other", options: ["Tricare / Military", "Veterans Affairs (VA)", "Workers Compensation", "Self-Pay", "Other"] },
];

export const PAYER_CATEGORY_MAP = {
  "NC Medicaid - Standard": "NC Medicaid - Standard",
  "NC Medicaid - Tailored": "NC Medicaid - Tailored",
  "NC Medicaid - Other": "NC Medicaid - Other",
  "Medicare": "Medicare",
  "Commercial": "Commercial",
  "Other": "Other",
};

// ─── ICD-10 Common Codes ──────────────────────────────────────────────────────
export const ICD10_COMMON = [
  { code: "Z00.00", description: "General adult medical exam, no abnormal findings" },
  { code: "I10",    description: "Essential (primary) hypertension" },
  { code: "E11.9",  description: "Type 2 diabetes mellitus without complications" },
  { code: "J06.9",  description: "Acute upper respiratory infection, unspecified" },
  { code: "M54.5",  description: "Low back pain" },
  { code: "F41.1",  description: "Generalized anxiety disorder" },
  { code: "F32.9",  description: "Major depressive disorder, single episode, unspecified" },
  { code: "Z23",    description: "Immunization encounter" },
  { code: "Z71.3",  description: "Dietary counseling and surveillance" },
  { code: "E78.5",  description: "Hyperlipidemia, unspecified" },
  { code: "N39.0",  description: "Urinary tract infection, unspecified" },
  { code: "J45.20", description: "Mild intermittent asthma, uncomplicated" },
  { code: "K21.0",  description: "Gastro-esophageal reflux disease with esophagitis" },
  { code: "R05.9",  description: "Cough, unspecified" },
  { code: "Z13.88", description: "Encounter for screening for disorder" },
];

// ─── CPT Common Codes ─────────────────────────────────────────────────────────
export const CPT_COMMON = [
  { code: "99202", description: "New patient, straightforward MDM, 15-29 min" },
  { code: "99203", description: "New patient, low MDM, 30-44 min" },
  { code: "99204", description: "New patient, moderate MDM, 45-59 min" },
  { code: "99205", description: "New patient, high MDM, 60-74 min" },
  { code: "99212", description: "Established patient, straightforward, 10-19 min" },
  { code: "99213", description: "Established patient, low, 20-29 min" },
  { code: "99214", description: "Established patient, moderate, 30-39 min" },
  { code: "99215", description: "Established patient, high, 40-54 min" },
  { code: "99395", description: "Annual preventive visit, 18-39 years" },
  { code: "99396", description: "Annual preventive visit, 40-64 years" },
  { code: "99397", description: "Annual preventive visit, 65+ years" },
  { code: "G0444", description: "Annual depression screening, 15 min" },
  { code: "G0442", description: "Annual alcohol misuse screening, 15 min" },
  { code: "99406", description: "Smoking cessation counseling, 3-10 min" },
  { code: "96160", description: "Patient-focused health risk assessment" },
];

// ─── Role Metadata ────────────────────────────────────────────────────────────
export const ROLE_META = {
  "Owner":              { color: "#6D28D9", bg: "#EDE9FE", border: "#C4B5FD" },
  "Manager":            { color: "#6D28D9", bg: "#EDE9FE", border: "#C4B5FD" },
  "Provider":           { color: "#065F46", bg: "#D1FAE5", border: "#6EE7B7" },
  "Medical Assistant":  { color: "#0F6E56", bg: "#E1F5EE", border: "#9FE1CB" },
  "Front Desk":         { color: "#1D4ED8", bg: "#EFF6FF", border: "#BFDBFE" },
  "Billing":            { color: "#854F0B", bg: "#FAEEDA", border: "#FAC775" },
  "Patient":            { color: "#1a1a18", bg: "#f7f7f5", border: "rgba(0,0,0,0.08)" },
};

// ─── Time / Slot Helpers ──────────────────────────────────────────────────────
// Slots are 15-min increments: 0 = 12:00 AM, 28 = 7:00 AM, 48 = 12:00 PM, 72 = 6:00 PM
export const SLOT_H = 22;        // px per slot in Schedule grid
export const TIME_COL_W = 64;
export const DAYS_OF_WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const DAY_KEY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const slotToTime = (slot) => {
  const h = Math.floor(slot / 4);
  const m = (slot % 4) * 15;
  const period = h >= 12 ? "PM" : "AM";
  const hh = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hh}:${String(m).padStart(2, "0")} ${period}`;
};

export const timeToSlot = (h24, m = 0) => h24 * 4 + Math.floor(m / 15);

export const formatTime = (slot) => slotToTime(slot);

// Phone format: (919) 555-0180
export const formatPhone = (raw) => {
  if (!raw) return "";
  const d = String(raw).replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === "1") return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return raw;
};

// DOB → age
export const ageFromDOB = (dob) => {
  if (!dob) return "—";
  const b = new Date(dob);
  const n = new Date();
  let a = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
  return a;
};

// YYYY-MM-DD for DB date columns
export const toISODate = (d = new Date()) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
};

// Initials from name (safe on nulls)
export const initialsOf = (first, last) => `${(first || "").charAt(0)}${(last || "").charAt(0)}`.toUpperCase() || "?";

// Appt status → Badge variant
export const APPT_STATUS_VARIANT = {
  "Scheduled":   "neutral",
  "Confirmed":   "teal",
  "Checked In":  "amber",
  "Roomed":      "blue",
  "In Progress": "purple",
  "Completed":   "green",
  "No Show":     "red",
  "Cancelled":   "neutral",
  "Rescheduled": "neutral",
};

export const QUEUE_STATUS_VARIANT = {
  "Waiting":                "amber",
  "Roomed":                 "blue",
  "In Progress":            "purple",
  "Ready":                  "teal",
  "Checked Out":            "green",
  "Left Without Being Seen": "red",
};

export const TASK_PRIORITY_VARIANT = {
  "Urgent": "red",
  "High":   "amber",
  "Normal": "teal",
  "Low":    "neutral",
};

export const NAV_BY_ROLE = {
  "Owner":             ["dashboard","schedule","patients","queue","tasks","inbox","clinical","eligibility","waitlist","insights","compliance","staff","reports","settings"],
  "Manager":           ["dashboard","schedule","patients","queue","tasks","inbox","eligibility","waitlist","insights","compliance","staff","reports","settings"],
  "Provider":          ["dashboard","schedule","patients","clinical","inbox","tasks"],
  "Medical Assistant": ["dashboard","schedule","patients","queue","tasks","eligibility"],
  "Front Desk":        ["dashboard","schedule","patients","queue","tasks","eligibility","waitlist"],
  "Billing":           ["dashboard","patients","eligibility","reports"],
  "Patient":           ["portal"],
};
