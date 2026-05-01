// ═══════════════════════════════════════════════════════════════════════════
// src/views/care-management/constants.js
//
// Shared constants for the Care Management module.
//
// NC_HEALTH_PLANS_GROUPED:
//   Master list of NC-area health plans, organized into <optgroup>-friendly
//   sections. Use anywhere the user picks a plan from a <select>: Plan
//   Connections form, Outbound new-submission modal, VBP contract form,
//   future onboarding wizard.
//
//   Labels are intentionally formal/long-form (e.g. "UnitedHealthcare" not
//   "UHC", "Medicare Advantage" not "MA") to disambiguate the multiple UHC
//   products and to read like contract language. The underlying short codes
//   (wellcare, cch, uhc_ma, etc) are stable and never displayed; rename
//   labels here without touching anything else.
//
// PLAN_LABEL:
//   Flat lookup { short_code -> display_label } derived from the grouped
//   list at module load. Use this anywhere you have a payer_short_name
//   string and need the human-readable label for display. Don't re-derive
//   in consumers - import directly.
//
// To add a plan: edit NC_HEALTH_PLANS_GROUPED here once. PLAN_LABEL picks
// it up automatically. All consumer files inherit the new option.
// ═══════════════════════════════════════════════════════════════════════════

export const NC_HEALTH_PLANS_GROUPED = [
  {
    group: "NC Medicaid - Standard Plan PHPs",
    options: [
      { short: "wellcare",      label: "WellCare of North Carolina" },
      { short: "amerihealth",   label: "AmeriHealth Caritas North Carolina" },
      { short: "healthy_blue",  label: "Healthy Blue (BCBS NC Medicaid)" },
      { short: "uhc_community", label: "UnitedHealthcare Community Plan of NC" },
      { short: "cch",           label: "Carolina Complete Health" },
    ],
  },
  {
    group: "NC Medicaid - Tailored Plan PHPs (BH/I-DD/TBI)",
    options: [
      { short: "alliance", label: "Alliance Health" },
      { short: "partners", label: "Partners Health Management" },
      { short: "trillium", label: "Trillium Health Resources" },
      { short: "vaya",     label: "Vaya Health" },
    ],
  },
  {
    group: "NC Medicaid - Other",
    options: [
      { short: "ebci",               label: "EBCI Tribal Option" },
      { short: "nc_medicaid_direct", label: "NC Medicaid Direct (FFS)" },
    ],
  },
  {
    group: "Behavioral Health Carve-out",
    options: [
      { short: "ubh", label: "United Behavioral Health (Optum)" },
    ],
  },
  {
    group: "Commercial",
    options: [
      { short: "bcbs_nc",        label: "Blue Cross Blue Shield of NC (Commercial)" },
      { short: "aetna",          label: "Aetna" },
      { short: "cigna",          label: "Cigna" },
      { short: "uhc_commercial", label: "UnitedHealthcare (Commercial)" },
      { short: "humana",         label: "Humana" },
    ],
  },
  {
    group: "Medicare Advantage",
    options: [
      { short: "wellcare_ma",          label: "WellCare Medicare Advantage" },
      { short: "humana_ma",            label: "Humana Medicare Advantage" },
      { short: "uhc_ma",               label: "UnitedHealthcare Medicare Advantage" },
      { short: "aetna_ma",             label: "Aetna Medicare Advantage" },
      { short: "bcbs_nc_ma",           label: "BCBS NC Medicare Advantage" },
      { short: "healthteam_advantage", label: "HealthTeam Advantage" },
      { short: "alignment",            label: "Alignment Healthcare" },
    ],
  },
  {
    group: "Medicare",
    options: [
      { short: "medicare_ffs", label: "Original Medicare (FFS)" },
      { short: "mssp",         label: "Medicare Shared Savings Program (MSSP) ACO" },
    ],
  },
  {
    group: "Other",
    options: [
      { short: "other", label: "Other (specify in contract notes)" },
    ],
  },
];

export const PLAN_LABEL = {};
for (const g of NC_HEALTH_PLANS_GROUPED) for (const o of g.options) PLAN_LABEL[o.short] = o.label;
