// ═══════════════════════════════════════════════════════════════════════════════
// src/components/constants.js — shared enums, helpers, and config
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Appointment type fallback (if DB table is empty, use these) ─────────────
export const DEFAULT_APPT_TYPES = [
  { name: "New Patient",   dot: "#3B82F6", bg: "#EFF6FF", border: "#BFDBFE", color: "#1D4ED8", defaultDuration: 60 },
  { name: "Follow-up",     dot: "#1D9E75", bg: "#E1F5EE", border: "#9FE1CB", color: "#0F6E56", defaultDuration: 30 },
  { name: "Annual Exam",   dot: "#8B5CF6", bg: "#EDE9FE", border: "#C4B5FD", color: "#6D28D9", defaultDuration: 45 },
  { name: "Procedure",     dot: "#D08A2E", bg: "#FAEEDA", border: "#FAC775", color: "#854F0B", defaultDuration: 60 },
  { name: "Telehealth",    dot: "#06B6D4", bg: "#ECFEFF", border: "#67E8F9", color: "#0E7490", defaultDuration: 20 },
  { name: "Walk-in",       dot: "#EF4444", bg: "#FEE2E2", border: "#FCA5A5", color: "#991B1B", defaultDuration: 20 },
  { name: "Physical Exam", dot: "#10B981", bg: "#D1FAE5", border: "#6EE7B7", color: "#065F46", defaultDuration: 45 },
];

// Lighten a hex color to derive a badge background if one isn't provided
export const hexToBg = (hex, alpha = 0.12) => {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

// ─── NC Insurance Payers (official as of April 2026) ─────────────────────────
export const NC_PAYERS = [
  { group: "NC Medicaid — Standard Plans", category: "NC Medicaid - Standard", options: [
    "AmeriHealth Caritas North Carolina (Medicaid)",
    "Carolina Complete Health (Medicaid)",
    "Healthy Blue (Medicaid)",
    "UnitedHealthcare Community Plan (Medicaid)",
    "WellCare of North Carolina (Medicaid)",
  ]},
  { group: "NC Medicaid — Tailored Plans", category: "NC Medicaid - Tailored", options: [
    "Alliance Health (Medicaid Tailored Plan)",
    "Partners Health Management (Medicaid Tailored Plan)",
    "Trillium Health Resources (Medicaid Tailored Plan)",
    "Vaya Health (Medicaid Tailored Plan)",
  ]},
  { group: "NC Medicaid — Other", category: "NC Medicaid - Other", options: [
    "NC Medicaid Direct",
    "EBCI Tribal Option (Medicaid)",
    "Healthy Blue Care Together (Medicaid)",
  ]},
  { group: "Medicare", category: "Medicare", options: [
    "Medicare (Traditional / Original)",
    "Medicare Advantage — Blue Cross NC",
    "Medicare Advantage — Aetna",
    "Medicare Advantage — Humana",
    "Medicare Advantage — UnitedHealthcare",
    "Medicare Advantage — WellCare",
    "Medicare Advantage — Other",
  ]},
  { group: "NC State Health Plan", category: "Commercial", options: [
    "NC State Health Plan (Aetna)",
  ]},
  { group: "Commercial Insurance", category: "Commercial", options: [
    "Blue Cross Blue Shield NC (Commercial)",
    "Aetna",
    "Cigna",
    "UnitedHealthcare",
    "Humana",
    "Ambetter (NC)",
    "Molina Healthcare",
  ]},
  { group: "Other Coverage", category: "Other", options: [
    "Tricare / Military",
    "Veterans Affairs (VA)",
    "Workers' Compensation",
    "Self-Pay / No Insurance",
    "Other — not listed",
  ]},
];

// Given a payer NAME string, return the payer_category enum value
export const lookupPayerCategory = (payerName) => {
  for (const grp of NC_PAYERS) {
    if (grp.options.includes(payerName)) return grp.category;
  }
  return "Other";
};

// Flat list for search / filter dropdowns
export const ALL_PAYER_OPTIONS = NC_PAYERS.flatMap((g) => g.options);

export const NC_PAYER_GROUPS = [
  "NC Medicaid - Standard",
  "NC Medicaid - Tailored",
  "NC Medicaid - Other",
  "Medicare",
  "Commercial",
  "Other",
];

// ─── Timezones (common US + key international for NC practices) ──────────────
export const TIMEZONES = [
  { value: "America/New_York",    label: "Eastern (New York)" },
  { value: "America/Chicago",     label: "Central (Chicago)" },
  { value: "America/Denver",      label: "Mountain (Denver)" },
  { value: "America/Phoenix",     label: "Mountain - no DST (Phoenix)" },
  { value: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { value: "America/Anchorage",   label: "Alaska (Anchorage)" },
  { value: "Pacific/Honolulu",    label: "Hawaii (Honolulu)" },
  { value: "America/Puerto_Rico", label: "Atlantic (Puerto Rico)" },
];

// ─── ICD-10 common codes for family medicine / pediatrics / NC Medicaid ─────
export const ICD10_COMMON = [
  { code: "Z00.00",   description: "Encounter for general adult medical exam without abnormal findings" },
  { code: "Z00.129",  description: "Encounter for routine child health exam without abnormal findings" },
  { code: "Z23",      description: "Encounter for immunization" },
  { code: "E11.9",    description: "Type 2 diabetes mellitus without complications" },
  { code: "E78.5",    description: "Hyperlipidemia, unspecified" },
  { code: "I10",      description: "Essential (primary) hypertension" },
  { code: "J06.9",    description: "Acute upper respiratory infection, unspecified" },
  { code: "J45.909",  description: "Unspecified asthma, uncomplicated" },
  { code: "K21.9",    description: "Gastro-esophageal reflux disease without esophagitis" },
  { code: "M25.511",  description: "Pain in right shoulder" },
  { code: "N39.0",    description: "Urinary tract infection, site not specified" },
  { code: "F32.9",    description: "Major depressive disorder, single episode, unspecified" },
  { code: "F41.1",    description: "Generalized anxiety disorder" },
  { code: "R51.9",    description: "Headache, unspecified" },
  { code: "Z79.4",    description: "Long term (current) use of insulin" },
];

// ─── CPT codes common ────────────────────────────────────────────────────────
export const CPT_COMMON = [
  { code: "99202", description: "Office visit, new, straightforward (15-29 min)" },
  { code: "99203", description: "Office visit, new, low complexity (30-44 min)" },
  { code: "99204", description: "Office visit, new, moderate complexity (45-59 min)" },
  { code: "99205", description: "Office visit, new, high complexity (60-74 min)" },
  { code: "99212", description: "Office visit, established, straightforward (10-19 min)" },
  { code: "99213", description: "Office visit, established, low-to-moderate (20-29 min)" },
  { code: "99214", description: "Office visit, established, moderate (30-39 min)" },
  { code: "99215", description: "Office visit, established, high (40-54 min)" },
  { code: "99385", description: "Periodic preventive exam, ages 18-39" },
  { code: "99386", description: "Periodic preventive exam, ages 40-64" },
  { code: "99395", description: "Periodic preventive exam, established, 40-64" },
  { code: "99406", description: "Smoking cessation counseling 3-10 min" },
  { code: "96127", description: "Brief emotional/behavioral assessment with scoring" },
  { code: "90471", description: "Immunization administration, first" },
  { code: "90472", description: "Immunization administration, each additional" },
];

// ─── Layout constants (schedule grid) ────────────────────────────────────────
export const SLOT_MIN = 15;                        // minutes per slot
export const SLOT_H = 22;                          // pixel height of one 15-min slot
export const TIME_COL_W = 64;                      // pixel width of left time column
export const DAY_START_SLOT = 28;                  // 7:00 AM
export const DAY_END_SLOT = 76;                    // 7:00 PM
export const DAYS_OF_WEEK = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

// ─── Helpers ─────────────────────────────────────────────────────────────────
export const slotToTime = (slot) => {
  const h24 = Math.floor(slot / 4);
  const m   = (slot % 4) * 15;
  const h12 = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24;
  const ampm = h24 < 12 ? "AM" : "PM";
  return `${h12}:${m.toString().padStart(2, "0")} ${ampm}`;
};

export const timeToSlot = (time) => {
  // accepts "HH:MM" 24-hour, "h:mm AM/PM", or "HH:MM AM/PM"
  if (!time) return 0;
  const am = /am/i.test(time);
  const pm = /pm/i.test(time);
  const [hStr, mStr] = time.replace(/\s?(am|pm)/i, "").split(":");
  let h = parseInt(hStr, 10) || 0;
  const m = parseInt(mStr, 10) || 0;
  if (pm && h < 12) h += 12;
  if (am && h === 12) h = 0;
  return h * 4 + Math.floor(m / 15);
};

// "14:30" <-> slot (for <input type="time">)
export const time24ToSlot = (time24) => {
  if (!time24) return 0;
  const [h, m] = time24.split(":").map((v) => parseInt(v, 10) || 0);
  return h * 4 + Math.floor(m / 15);
};
export const slotToTime24 = (slot) => {
  const h = Math.floor(slot / 4);
  const m = (slot % 4) * 15;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
};

// Minutes <-> slots (duration)
export const minutesToSlots = (min) => Math.max(1, Math.round(min / 15));
export const slotsToMinutes = (slots) => slots * 15;

// "14:30" -> "2:30 PM"
export const time24To12 = (time24) => {
  if (!time24) return "";
  const [h, m] = time24.split(":").map((v) => parseInt(v, 10) || 0);
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const ampm = h < 12 ? "AM" : "PM";
  return `${h12}:${m.toString().padStart(2, "0")} ${ampm}`;
};

export const formatPhone = (phone) => {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits[0] === "1") return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return phone;
};

export const ageFromDOB = (dob) => {
  if (!dob) return "";
  const b = new Date(dob);
  const d = new Date();
  let age = d.getFullYear() - b.getFullYear();
  const m = d.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && d.getDate() < b.getDate())) age--;
  return age;
};

export const toISODate = (date = new Date()) => {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const dd = d.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${dd}`;
};

export const initialsOf = (first, last) => {
  const f = (first || "").trim()[0] || "";
  const l = (last || "").trim()[0] || "";
  return (f + l).toUpperCase() || "?";
};

// ─── Status variant lookup tables ────────────────────────────────────────────
export const APPT_STATUS_VARIANT = {
  "Scheduled": "neutral",
  "Confirmed": "blue",
  "Checked In": "teal",
  "Roomed": "blue",
  "In Progress": "purple",
  "Completed": "green",
  "No Show": "red",
  "Cancelled": "neutral",
  "Rescheduled": "amber",
};
export const QUEUE_STATUS_VARIANT = {
  "Waiting": "amber",
  "Roomed": "blue",
  "In Progress": "purple",
  "Ready": "teal",
  "Checked Out": "green",
  "Left Without Being Seen": "red",
};
export const TASK_PRIORITY_VARIANT = {
  "Urgent": "red",
  "High": "amber",
  "Normal": "blue",
  "Low": "neutral",
};

// ─── Role metadata ───────────────────────────────────────────────────────────
export const ROLE_META = {
  Owner:              { color: "#6D28D9" },
  Manager:            { color: "#1D4ED8" },
  Provider:           { color: "#0F6E56" },
  "Medical Assistant":{ color: "#D08A2E" },
  "Front Desk":       { color: "#0E7490" },
  Billing:            { color: "#991B1B" },
  Patient:            { color: "#9c9b94" },
};

// ─── Navigation config per role (for sidebar rendering) ──────────────────────
export const NAV_BY_ROLE = {
  Owner: ["dashboard","schedule","patients","queue","clinical","inbox","tasks","staff","eligibility","waitlist","insights","compliance","reports","settings"],
  Manager: ["dashboard","schedule","patients","queue","clinical","inbox","tasks","staff","eligibility","waitlist","insights","compliance","reports","settings"],
  Provider: ["dashboard","schedule","patients","queue","clinical","inbox","tasks","eligibility"],
  "Medical Assistant": ["dashboard","schedule","patients","queue","inbox","tasks"],
  "Front Desk": ["dashboard","schedule","patients","queue","inbox","tasks","eligibility","waitlist"],
  Billing: ["dashboard","patients","tasks","eligibility","reports"],
  Patient: ["portal"],
};

// ─── HRSN / SDOH screening questions (NC Medicaid required) ──────────────────
export const HRSN_QUESTIONS = [
  { key: "food",      question: "Within the past 12 months, did you worry your food would run out before you got money to buy more?" },
  { key: "housing",   question: "Are you worried about losing your housing, or do you currently lack stable housing?" },
  { key: "utilities", question: "In the past 12 months, has the electric, gas, oil, or water company threatened to shut off services in your home?" },
  { key: "transport", question: "In the past 12 months, has a lack of transportation kept you from medical appointments, meetings, work, or getting things needed for daily living?" },
  { key: "safety",    question: "Do you ever feel unsafe in your current living situation or in a relationship?" },
];
