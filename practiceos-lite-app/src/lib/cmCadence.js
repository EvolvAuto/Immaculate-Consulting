// src/lib/cmCadence.js
//
// Care Management cadence logic - thresholds, staleness banding, and
// billing-floor gating. Used by Registry, Touchpoints, Billing Readiness,
// and any future CM surface that cares about "is this patient overdue for
// a contact?"
//
// These defaults are calibrated against published NC Medicaid provider
// manuals where numbers exist, and against defensible-but-not-policy
// defaults where they do not. See per-program comments below. All values
// here are expected to be overrideable per-practice via
// practice_preferences.cm_cadence_thresholds JSONB in v2 (onboarding
// wizard scope).
//
// Policy sources referenced:
//   - TCM Provider Manual (Dec 31, 2024), Section 4.2 + footnote 35
//   - AMH Provider Manual (May 2024) + Draft AMH Provider Manual 2026
//   - PHP Risk Stratification Communication Standardization Guidance
//
// Maintainer note: any time NC DHHS publishes a rate-setting update or
// revised provider manual, revisit the per-program thresholds below.

// ---------------------------------------------------------------------------
// Thresholds by program + acuity.
//
// Each entry is { amberAt, redAt } in days-since-last-successful-contact.
// Green = below amberAt. Amber = warning. Red = overdue.
//
// Keys must match values in the cm_program_type Postgres enum:
//   TCM, AMH Plus, AMH Tier 3, CIN CM, CMA, General Engagement, Other
// ---------------------------------------------------------------------------

export const CADENCE_THRESHOLDS = {
  // TCM (Tailored Care Management).
  // Policy grounding:
  //   - Section 4.2: monthly billing floor - 1 qualifying contact per
  //     calendar month required to submit claim.
  //   - Footnote 35: rate assumption is 3 contacts/month + 1 in-person
  //     per quarter for consented+engaged members.
  // Red bands designed to fire BEFORE the billing floor slips. High
  // acuity tighter to visibly track the 3/month rate assumption.
  "TCM": {
    "High":     { amberAt: 11, redAt: 21 },
    "Moderate": { amberAt: 15, redAt: 26 },
    "Low":      { amberAt: 31, redAt: 46 },
  },

  // AMH+ (Advanced Medical Home Plus). TCM-eligible AMH variant.
  // Operates under TCM billing model. Same thresholds as TCM.
  "AMH Plus": {
    "High":     { amberAt: 11, redAt: 21 },
    "Moderate": { amberAt: 15, redAt: 26 },
    "Low":      { amberAt: 31, redAt: 46 },
  },

  // CMA (Care Management Agency). TCM billing model applies.
  // Same thresholds as TCM.
  "CMA": {
    "High":     { amberAt: 11, redAt: 21 },
    "Moderate": { amberAt: 15, redAt: 26 },
    "Low":      { amberAt: 31, redAt: 46 },
  },

  // AMH Tier 3 (Advanced Medical Home primary care).
  // Different payment model - PMPM, not per-contact monthly. AMH Provider
  // Manual does not prescribe cadence minimums; it prescribes capabilities
  // (risk stratification, care management for high-needs patients,
  // transitional care management).
  //
  // These thresholds are DEFENSIBLE DEFAULTS, not policy-grounded. When
  // the first primary care AMH Tier 3 client signs, calibrate against
  // their actual care management philosophy and contract language.
  //
  // Reasoning for the defaults:
  //   - No monthly billing floor = less time pressure than TCM
  //   - But high-needs patients still need reliable touch cadence
  //   - Low acuity = quarterly-ish touch is reasonable for primary care
  //     patients who are essentially on maintenance
  "AMH Tier 3": {
    "High":     { amberAt: 21, redAt: 45 },
    "Moderate": { amberAt: 45, redAt: 75 },
    "Low":      { amberAt: 90, redAt: 120 },
  },

  // CIN CM (Clinically Integrated Network care management).
  // CINs contract with PHPs and typically bill under TCM or AMH+ codes
  // depending on attributed members. Use TCM thresholds as safest default
  // since most CIN arrangements are contract-to-PHP.
  "CIN CM": {
    "High":     { amberAt: 11, redAt: 21 },
    "Moderate": { amberAt: 15, redAt: 26 },
    "Low":      { amberAt: 31, redAt: 46 },
  },

  // General Engagement. Catch-all for light-touch check-ins, CHW-led
  // outreach, pre-enrollment engagement. No contractual cadence.
  // These thresholds prioritize "have we lost touch entirely?" over
  // "are we hitting a rate assumption?"
  "General Engagement": {
    "High":     { amberAt: 30, redAt: 60 },
    "Moderate": { amberAt: 60, redAt: 90 },
    "Low":      { amberAt: 120, redAt: 180 },
  },

  // Other / fallback. If program_type is unknown or new, default to
  // the most conservative billable-program thresholds (TCM Moderate).
  "Other": {
    "High":     { amberAt: 15, redAt: 26 },
    "Moderate": { amberAt: 15, redAt: 26 },
    "Low":      { amberAt: 31, redAt: 46 },
  },
};

// ---------------------------------------------------------------------------
// Billable programs. Programs where monthly billing floor applies (at least
// one qualifying contact per calendar month required to submit a claim).
//
// Used to gate the "BILL RISK" badge so it only surfaces where a missed
// monthly contact has actual financial consequences.
//
// AMH Tier 3 is PMPM based - missing a monthly contact does not lose a
// claim, so BILL RISK is not shown.
// General Engagement has no billing model - BILL RISK not applicable.
// ---------------------------------------------------------------------------

export const BILLABLE_PROGRAMS = new Set([
  "TCM",
  "AMH Plus",
  "CMA",
  "CIN CM",
]);

export function isBillableProgram(programType) {
  return BILLABLE_PROGRAMS.has(programType);
}

// ---------------------------------------------------------------------------
// stalenessBand: resolve (acuity, days, programType) into a color band.
//
// Returns "green" | "amber" | "red".
// - Disenrolled / null days handling is done by the caller (StaleDaysBadge).
// - Defaults to "Other" thresholds if programType is unrecognized.
// - Defaults to "Moderate" acuity if acuity is unrecognized.
// ---------------------------------------------------------------------------

export function stalenessBand(acuity, days, programType) {
  if (days === null || days === undefined) return "amber";
  const programTable = CADENCE_THRESHOLDS[programType] || CADENCE_THRESHOLDS["Other"];
  const t = programTable[acuity] || programTable["Moderate"];
  if (days >= t.redAt)   return "red";
  if (days >= t.amberAt) return "amber";
  return "green";
}

// ---------------------------------------------------------------------------
// getThresholds: return the amber/red thresholds for a specific
// (practiceId, programType, acuity) triple.
//
// Currently returns defaults. This is the hook point for per-practice
// overrides once practice_preferences.cm_cadence_thresholds is wired up
// by the onboarding wizard.
//
// Returning a Promise-like shape even though current impl is sync, so
// callers can await without refactoring when DB lookup lands.
// ---------------------------------------------------------------------------

export function getThresholds(practiceId, programType, acuity) {
  // TODO(onboarding-wizard): query practice_preferences.cm_cadence_thresholds
  // JSONB and merge over defaults. For now, defaults only.
  const programTable = CADENCE_THRESHOLDS[programType] || CADENCE_THRESHOLDS["Other"];
  return programTable[acuity] || programTable["Moderate"];
}

// ---------------------------------------------------------------------------
// BILLING_RISK_DAY_OF_MONTH: day of the calendar month at which an Active
// enrollment with zero successful contacts this month starts flagging as
// billing-risk.
//
// Defaults to 20 = two-thirds through a 30-day month. Calibration rationale:
//   - Day 15 = half-month, some practices want this to flag earlier
//   - Day 20 = now (current default)
//   - Day 25 = too late; Care Manager has only 5 days to act
//
// Also candidate for practice_preferences override via onboarding wizard.
// ---------------------------------------------------------------------------

export const BILLING_RISK_DAY_OF_MONTH = 20;

export function isPastBillingRiskDay(date) {
  const d = date || new Date();
  return d.getUTCDate() >= BILLING_RISK_DAY_OF_MONTH;
}
