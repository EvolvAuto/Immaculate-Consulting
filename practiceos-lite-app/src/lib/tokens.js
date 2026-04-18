// ═══════════════════════════════════════════════════════════════════════════════
// src/lib/tokens.js
// Design tokens for PracticeOS Lite. Imported as `import { C } from "../lib/tokens"`.
// Keeps the exact palette from PracticeOSLite_Full.jsx so the refactor is visual-identity-preserving.
// ═══════════════════════════════════════════════════════════════════════════════

export const C = {
  // Brand - teal family
  teal:        "#0F6E56",
  tealMid:     "#1D9E75",
  tealLight:   "#5DCAA5",
  tealBg:      "#E1F5EE",
  tealBorder:  "#9FE1CB",
  tealDark:    "#085041",

  // Amber family
  amber:       "#854F0B",
  amberBg:     "#FAEEDA",
  amberBorder: "#FAC775",
  amberMid:    "#D08A2E",

  // Red
  red:         "#A32D2D",
  redBg:       "#FCEBEB",
  redBorder:   "#F5B8B8",

  // Blue
  blue:        "#1D4ED8",
  blueBg:      "#EFF6FF",
  blueBorder:  "#BFDBFE",

  // Purple
  purple:      "#6D28D9",
  purpleBg:    "#EDE9FE",
  purpleBorder:"#C4B5FD",

  // Green
  green:       "#065F46",
  greenBg:     "#D1FAE5",
  greenBorder: "#6EE7B7",

  // Surfaces
  bgPrimary:   "#ffffff",
  bgSecondary: "#f7f7f5",
  bgTertiary:  "#f0efeb",

  // Text
  textPrimary:   "#1a1a18",
  textSecondary: "#6b6a63",
  textTertiary:  "#9c9b94",

  // Borders
  borderLight: "rgba(0,0,0,0.08)",
  borderMid:   "rgba(0,0,0,0.18)",

  // Nav
  navBg:       "#0a2218",
};

// Role visual-identity map -----------------------------------------------------
// Mirrors the ROLES const from PracticeOSLite_Full.jsx but keyed by the new
// Title Case enum values that match public.user_role in Postgres.
export const ROLE_STYLES = {
  "Owner":             { label: "Owner",             color: C.tealDark, bg: C.tealBg,   border: C.tealBorder  },
  "Manager":           { label: "Practice Manager",  color: C.purple,   bg: C.purpleBg, border: C.purpleBorder },
  "Provider":          { label: "Provider",          color: C.green,    bg: C.greenBg,  border: C.greenBorder  },
  "Medical Assistant": { label: "Medical Assistant", color: C.teal,     bg: C.tealBg,   border: C.tealBorder   },
  "Front Desk":        { label: "Front Desk",        color: C.blue,     bg: C.blueBg,   border: C.blueBorder   },
  "Billing":           { label: "Billing",           color: C.amber,    bg: C.amberBg,  border: C.amberBorder  },
  "Patient":           { label: "Patient",           color: C.textSecondary, bg: C.bgSecondary, border: C.borderLight },
};

// Which nav tabs each role can see. Matches the schema's role-based RLS.
// 'kiosk' and 'compliance' and 'insights' are the new modules.
export const NAV_BY_ROLE = {
  "Owner":             ["dashboard","schedule","patients","queue","tasks","clinical","inbox","staff","eligibility","waitlist","insights","compliance","reports","settings"],
  "Manager":           ["dashboard","schedule","patients","queue","tasks","inbox","staff","eligibility","waitlist","insights","compliance","reports","settings"],
  "Provider":          ["dashboard","schedule","patients","clinical","inbox","insights"],
  "Medical Assistant": ["dashboard","schedule","patients","queue","tasks","inbox"],
  "Front Desk":        ["dashboard","schedule","patients","queue","tasks","waitlist","eligibility"],
  "Billing":           ["dashboard","eligibility","reports","compliance"],
  "Patient":           ["portal"],
};

export const NAV_META = {
  dashboard:   { icon: "⊞",  label: "Dashboard"   },
  schedule:    { icon: "📅", label: "Schedule"    },
  patients:    { icon: "👥", label: "Patients"    },
  queue:       { icon: "⬡",  label: "Queue"       },
  tasks:       { icon: "✓",  label: "Tasks"       },
  clinical:    { icon: "🩺", label: "Clinical"    },
  inbox:       { icon: "✉",  label: "Inbox"       },
  staff:       { icon: "👤", label: "Staff"       },
  eligibility: { icon: "◈",  label: "Eligibility" },
  waitlist:    { icon: "⌛", label: "Waitlist"    },
  insights:    { icon: "📊", label: "IC Insights" },
  compliance:  { icon: "🛡", label: "Compliance"  },
  reports:     { icon: "📈", label: "Reports"     },
  settings:    { icon: "⚙",  label: "Settings"    },
  portal:      { icon: "☰",  label: "My Health"   },
};

// 15-min slot constants (preserved from existing UI)
export const SLOT_H = 22;
export const TIME_COL_W = 64;

export const DAYS_OF_WEEK = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
