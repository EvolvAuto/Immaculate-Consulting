// src/lib/cmCadence.js
//
// Care Management cadence logic - thresholds, staleness banding, and
// billing-floor gating. Used by Registry, Touchpoints, Billing Readiness,
// and any future CM surface that cares about "is this patient overdue for
// a contact?"
//
// KEY DESIGN POINT: cadence rules are driven by NC Medicaid health plan type,
// NOT by program name or CM provider type.
//
//   - Tailored Plan patients receive Tailored Care Management (TCM),
//     billed monthly, with explicit acuity tiering (High / Moderate / Low).
//     Per-acuity cadence thresholds apply.
//
//   - Standard Plan patients receive care management under the AMH program,
//     paid PMPM (not per-contact), with qualitative "medium to high needs"
//     identification rather than formal acuity tiers.
//     A single threshold set applies regardless of "tier".
//
// Sources:
//   - TCM Provider Manual (Dec 31, 2024), Section 4.2 + footnote 35
//     [monthly billing floor + 3-contacts/month rate assumption]
//   - AMH Provider Manual (May 2024) + Draft AMH Provider Manual 2026
//     [identification of high-needs patients; no prescribed cadence minimums]
//   - PHP Risk Stratification Communication Standardization Guidance (Feb 2025)
//     [PHPs own risk scoring; practices may return their own stratification]
//
// Per-practice overrides will come from practice_preferences.cm_cadence_thresholds
// JSONB via the onboarding wizard. getThresholds() is the hook point.

// ---------------------------------------------------------------------------
// TAILORED PLAN thresholds: acuity-keyed.
//
// Calibrated from TCM Provider Manual:
//   - Red band fires BEFORE the monthly billing floor would slip
//   - High acuity tighter to visibly track 3/month rate assumption
//   - Low acuity uses the full month window before overdue
// ---------------------------------------------------------------------------

export const TAILORED_PLAN_THRESHOLDS = {
  "High":     { amberAt: 11, redAt: 21 },
  "Moderate": { amberAt: 15, redAt: 26 },
  "Low":      { amberAt: 31, redAt: 46 },
};

// ---------------------------------------------------------------------------
// STANDARD PLAN thresholds: single set, acuity not applicable.
//
// AMH Provider Manual does not prescribe cadence minimums. These defaults
// reflect primary-care CM reality: monthly or quarterly touch for engaged
// patients, with red flag if we have completely lost contact.
//
// Calibrated conservatively - a Standard Plan practice onboarding in v2
// should override these via practice_preferences based on their own
// care management philosophy and any health plan contract language.
// ---------------------------------------------------------------------------

export const STANDARD_PLAN_THRESHOLDS = {
  amberAt: 45,
  redAt:   75,
};

// ---------------------------------------------------------------------------
// FALLBACK thresholds for enrollments without a known plan type.
// Applies to General Engagement and Other program types.
// Most lenient - "are we still engaged at all?"
// ---------------------------------------------------------------------------

export const FALLBACK_THRESHOLDS = {
  amberAt: 60,
  redAt:   90,
};

// ---------------------------------------------------------------------------
// Billing-floor gating.
//
// Tailored Plan: monthly billing floor applies. Miss a month of qualifying
//   contact, lose the claim. BILL RISK is meaningful.
// Standard Plan: PMPM payment model. No per-member per-contact threshold.
//   BILL RISK does not apply.
// Other/null: no billing framework - BILL RISK does not apply.
// ---------------------------------------------------------------------------

export function isBillableByPlan(planType) {
  return planType === "Tailored Plan";
}

// ---------------------------------------------------------------------------
// stalenessBand: resolve (acuity, days, planType) into a color band.
//
// Returns "green" | "amber" | "red".
// - Disenrolled / null days handling is done by the caller (StaleDaysBadge).
// - Tailored Plan: per-acuity lookup. Falls back to Moderate if acuity null.
// - Standard Plan: single threshold, acuity ignored.
// - Other/null plan type: fallback thresholds.
// ---------------------------------------------------------------------------

export function stalenessBand(acuity, days, planType) {
  if (days === null || days === undefined) return "amber";

  let thresholds;
  if (planType === "Tailored Plan") {
    thresholds = TAILORED_PLAN_THRESHOLDS[acuity] || TAILORED_PLAN_THRESHOLDS["Moderate"];
  } else if (planType === "Standard Plan") {
    thresholds = STANDARD_PLAN_THRESHOLDS;
  } else {
    thresholds = FALLBACK_THRESHOLDS;
  }

  if (days >= thresholds.redAt)   return "red";
  if (days >= thresholds.amberAt) return "amber";
  return "green";
}

// ---------------------------------------------------------------------------
// getThresholds: return the amber/red thresholds for a specific
// (practiceId, planType, acuity) triple.
//
// Currently returns defaults. Hook point for per-practice overrides once
// practice_preferences.cm_cadence_thresholds JSONB is wired up via the
// onboarding wizard.
// ---------------------------------------------------------------------------

export function getThresholds(practiceId, planType, acuity) {
  // TODO(onboarding-wizard): query practice_preferences.cm_cadence_thresholds
  // JSONB and merge over defaults. For now, defaults only.
  if (planType === "Tailored Plan") {
    return TAILORED_PLAN_THRESHOLDS[acuity] || TAILORED_PLAN_THRESHOLDS["Moderate"];
  }
  if (planType === "Standard Plan") {
    return STANDARD_PLAN_THRESHOLDS;
  }
  return FALLBACK_THRESHOLDS;
}

// ---------------------------------------------------------------------------
// BILLING_RISK_DAY_OF_MONTH: day of the calendar month at which an Active
// Tailored Plan enrollment with zero successful contacts this month starts
// flagging as billing-risk.
//
// Defaults to 20 = two-thirds through a 30-day month.
// Calibration rationale:
//   - Day 15 = half-month, some practices want this to flag earlier
//   - Day 20 = current default
//   - Day 25 = too late; Care Manager has only 5 days to act
//
// Candidate for practice_preferences override via onboarding wizard.
// ---------------------------------------------------------------------------

export const BILLING_RISK_DAY_OF_MONTH = 20;

export function isPastBillingRiskDay(date) {
  const d = date || new Date();
  return d.getUTCDate() >= BILLING_RISK_DAY_OF_MONTH;
}

// ---------------------------------------------------------------------------
// Valid combinations of (health_plan_type, program_type, cm_provider_type).
// Used by NewEnrollmentModal to cascade/filter dropdowns and enforce the
// hard constraint.
//
// Standard Plan only pairs with AMH program, delivered by AMH Tier 3 or CIN.
// Tailored Plan only pairs with TCM program, delivered by Plan-based, AMH+,
//   CMA, or CIN.
// Other plan / null pairs with General Engagement or Other program, any
//   provider or none.
// ---------------------------------------------------------------------------

export const PLAN_PROGRAM_MATRIX = {
  "Tailored Plan": {
    program: "TCM",
    providers: ["AMH+", "CMA", "CIN"],
  },
  "Standard Plan": {
    program: "AMH",
    providers: ["AMH Tier 3", "CIN"],
  },
  "Other": {
    program: null, // user picks: General Engagement or Other
    providers: ["Other", "CIN"],
  },
};

// Validate a (planType, programType, providerType) triple.
// Returns null if valid, or a string describing why not.
export function validatePlanProgramProvider(planType, programType, providerType) {
  if (!planType) return null; // informal arrangement, no constraint
  const rule = PLAN_PROGRAM_MATRIX[planType];
  if (!rule) return null;

  if (rule.program && programType && programType !== rule.program) {
    return planType + " enrollments must use program " + rule.program + " (got " + programType + ")";
  }
  if (rule.providers && providerType && !rule.providers.includes(providerType)) {
    return planType + " does not allow provider type " + providerType +
      " (allowed: " + rule.providers.join(", ") + ")";
  }
  return null;
}
