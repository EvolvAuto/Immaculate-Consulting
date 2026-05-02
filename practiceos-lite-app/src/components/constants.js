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

// ─── ICD-10 common codes for primary care / pediatrics / NC Medicaid ────────
// Curated for family medicine, pediatrics, and the AMH/TCM NC Medicaid market.
// Order is roughly clinical-frequency-weighted within each category. Future
// UIs can group by `category` without parsing the description string.
// Phase 2 (onboarding wizard) will let practices curate per-practice favorites.
export const ICD10_COMMON = [
  // Wellness / encounters
  { code: "Z00.00",   description: "Encounter for general adult medical exam without abnormal findings", category: "Wellness" },
  { code: "Z00.01",   description: "Encounter for general adult medical exam with abnormal findings",    category: "Wellness" },
  { code: "Z00.121",  description: "Encounter for routine child health exam with abnormal findings",     category: "Wellness" },
  { code: "Z00.129",  description: "Encounter for routine child health exam without abnormal findings",  category: "Wellness" },
  { code: "Z23",      description: "Encounter for immunization",                                         category: "Wellness" },
  { code: "Z01.411",  description: "Gynecological exam (general) with abnormal findings",                category: "Wellness" },
  { code: "Z01.419",  description: "Gynecological exam (general) without abnormal findings",             category: "Wellness" },
  { code: "Z71.3",    description: "Dietary counseling and surveillance",                                category: "Wellness" },
  { code: "Z68.30",   description: "BMI 30.0-30.9, adult",                                               category: "Wellness" },
  { code: "Z68.35",   description: "BMI 35.0-35.9, adult",                                               category: "Wellness" },

  // Cardiovascular / metabolic
  { code: "I10",      description: "Essential (primary) hypertension",                                   category: "Cardiovascular" },
  { code: "I25.10",   description: "Atherosclerotic heart disease of native coronary artery",            category: "Cardiovascular" },
  { code: "I48.91",   description: "Unspecified atrial fibrillation",                                    category: "Cardiovascular" },
  { code: "I50.9",    description: "Heart failure, unspecified",                                         category: "Cardiovascular" },
  { code: "E11.9",    description: "Type 2 diabetes mellitus without complications",                     category: "Endocrine" },
  { code: "E11.65",   description: "Type 2 diabetes with hyperglycemia",                                 category: "Endocrine" },
  { code: "E11.40",   description: "Type 2 diabetes with diabetic neuropathy, unspecified",              category: "Endocrine" },
  { code: "E78.5",    description: "Hyperlipidemia, unspecified",                                        category: "Endocrine" },
  { code: "E66.9",    description: "Obesity, unspecified",                                               category: "Endocrine" },
  { code: "E66.01",   description: "Morbid (severe) obesity due to excess calories",                     category: "Endocrine" },
  { code: "E03.9",    description: "Hypothyroidism, unspecified",                                        category: "Endocrine" },

  // Respiratory
  { code: "J06.9",    description: "Acute upper respiratory infection, unspecified",                     category: "Respiratory" },
  { code: "J20.9",    description: "Acute bronchitis, unspecified",                                      category: "Respiratory" },
  { code: "J18.9",    description: "Pneumonia, unspecified organism",                                    category: "Respiratory" },
  { code: "J45.909",  description: "Unspecified asthma, uncomplicated",                                  category: "Respiratory" },
  { code: "J45.901",  description: "Unspecified asthma with (acute) exacerbation",                       category: "Respiratory" },
  { code: "J44.9",    description: "Chronic obstructive pulmonary disease, unspecified",                 category: "Respiratory" },
  { code: "J30.9",    description: "Allergic rhinitis, unspecified",                                     category: "Respiratory" },

  // GI / GU
  { code: "K21.9",    description: "Gastro-esophageal reflux disease without esophagitis",               category: "Gastrointestinal" },
  { code: "K58.9",    description: "Irritable bowel syndrome without diarrhea",                          category: "Gastrointestinal" },
  { code: "K59.00",   description: "Constipation, unspecified",                                          category: "Gastrointestinal" },
  { code: "R10.9",    description: "Unspecified abdominal pain",                                         category: "Gastrointestinal" },
  { code: "N39.0",    description: "Urinary tract infection, site not specified",                        category: "Genitourinary" },
  { code: "N18.3",    description: "Chronic kidney disease, stage 3 (moderate)",                         category: "Genitourinary" },

  // Musculoskeletal / pain
  { code: "M25.511",  description: "Pain in right shoulder",                                             category: "Musculoskeletal" },
  { code: "M25.512",  description: "Pain in left shoulder",                                              category: "Musculoskeletal" },
  { code: "M54.50",   description: "Low back pain, unspecified",                                         category: "Musculoskeletal" },
  { code: "M54.2",    description: "Cervicalgia (neck pain)",                                            category: "Musculoskeletal" },
  { code: "M79.7",    description: "Fibromyalgia",                                                       category: "Musculoskeletal" },
  { code: "M17.11",   description: "Unilateral primary osteoarthritis, right knee",                      category: "Musculoskeletal" },
  { code: "M17.12",   description: "Unilateral primary osteoarthritis, left knee",                       category: "Musculoskeletal" },

  // Mental health / behavioral (high frequency in AMH/TCM populations)
  { code: "F32.9",    description: "Major depressive disorder, single episode, unspecified",             category: "Behavioral Health" },
  { code: "F33.1",    description: "Major depressive disorder, recurrent, moderate",                     category: "Behavioral Health" },
  { code: "F41.1",    description: "Generalized anxiety disorder",                                       category: "Behavioral Health" },
  { code: "F41.9",    description: "Anxiety disorder, unspecified",                                      category: "Behavioral Health" },
  { code: "F43.10",   description: "Post-traumatic stress disorder, unspecified",                        category: "Behavioral Health" },
  { code: "F43.23",   description: "Adjustment disorder with mixed anxiety and depressed mood",          category: "Behavioral Health" },
  { code: "F90.2",    description: "Attention-deficit hyperactivity disorder, combined type",            category: "Behavioral Health" },
  { code: "F11.20",   description: "Opioid dependence, uncomplicated",                                   category: "Behavioral Health" },
  { code: "F10.20",   description: "Alcohol dependence, uncomplicated",                                  category: "Behavioral Health" },
  { code: "F17.210",  description: "Nicotine dependence, cigarettes, uncomplicated",                     category: "Behavioral Health" },

  // Pediatric-common
  { code: "H66.90",   description: "Otitis media, unspecified, unspecified ear",                         category: "Pediatric" },
  { code: "J02.9",    description: "Acute pharyngitis, unspecified",                                     category: "Pediatric" },
  { code: "B34.9",    description: "Viral infection, unspecified",                                       category: "Pediatric" },
  { code: "L20.9",    description: "Atopic dermatitis, unspecified",                                     category: "Pediatric" },
  { code: "R50.9",    description: "Fever, unspecified",                                                 category: "Pediatric" },

  // Symptoms / signs
  { code: "R51.9",    description: "Headache, unspecified",                                              category: "Symptoms" },
  { code: "R05.9",    description: "Cough, unspecified",                                                 category: "Symptoms" },
  { code: "R07.9",    description: "Chest pain, unspecified",                                            category: "Symptoms" },
  { code: "R42",      description: "Dizziness and giddiness",                                            category: "Symptoms" },
  { code: "R53.83",   description: "Fatigue, other",                                                     category: "Symptoms" },
  { code: "R63.4",    description: "Abnormal weight loss",                                               category: "Symptoms" },
  { code: "G47.00",   description: "Insomnia, unspecified",                                              category: "Symptoms" },

  // Long-term medication / status (Z79 family - claims expect these for refills)
  { code: "Z79.4",    description: "Long term (current) use of insulin",                                 category: "Status" },
  { code: "Z79.84",   description: "Long term (current) use of oral hypoglycemic drugs",                 category: "Status" },
  { code: "Z79.899",  description: "Other long term (current) drug therapy",                             category: "Status" },
  { code: "Z79.01",   description: "Long term (current) use of anticoagulants",                          category: "Status" },

  // HRSN / SDOH (Z55-Z65 family - required for HOP attribution and care plan tracking)
  { code: "Z59.00",   description: "Homelessness, unspecified",                                          category: "Social Determinants" },
  { code: "Z59.41",   description: "Food insecurity",                                                    category: "Social Determinants" },
  { code: "Z59.48",   description: "Other specified lack of adequate food",                              category: "Social Determinants" },
  { code: "Z59.86",   description: "Financial insecurity",                                               category: "Social Determinants" },
  { code: "Z59.87",   description: "Material hardship, unspecified",                                     category: "Social Determinants" },
  { code: "Z59.811",  description: "Housing instability, housed, with risk of homelessness",             category: "Social Determinants" },
  { code: "Z59.819",  description: "Housing instability, housed, unspecified",                           category: "Social Determinants" },
  { code: "Z65.8",    description: "Other specified problems related to psychosocial circumstances",     category: "Social Determinants" },
  { code: "Z63.0",    description: "Problems in relationship with spouse or partner",                    category: "Social Determinants" },
  { code: "Z63.4",    description: "Disappearance and death of family member",                           category: "Social Determinants" },
  { code: "Z62.819",  description: "Personal history of unspecified abuse in childhood",                 category: "Social Determinants" },
];

// ─── CPT codes common ────────────────────────────────────────────────────────
// Curated set covering ~95% of NC Medicaid primary care + AMH/TCM billing.
// Phase 2 (onboarding wizard) will let practices curate per-practice favorites.
// Full AMA CPT licensing is deferred until scale justifies the per-user fee.
export const CPT_COMMON = [
  // ─── E&M Office Visits ──
  { code: "99202", description: "Office visit, new, straightforward (15-29 min)",                       category: "E&M Office Visit" },
  { code: "99203", description: "Office visit, new, low complexity (30-44 min)",                        category: "E&M Office Visit" },
  { code: "99204", description: "Office visit, new, moderate complexity (45-59 min)",                   category: "E&M Office Visit" },
  { code: "99205", description: "Office visit, new, high complexity (60-74 min)",                       category: "E&M Office Visit" },
  { code: "99212", description: "Office visit, established, straightforward (10-19 min)",               category: "E&M Office Visit" },
  { code: "99213", description: "Office visit, established, low-to-moderate (20-29 min)",               category: "E&M Office Visit" },
  { code: "99214", description: "Office visit, established, moderate (30-39 min)",                      category: "E&M Office Visit" },
  { code: "99215", description: "Office visit, established, high (40-54 min)",                          category: "E&M Office Visit" },

  // ─── Preventive Visits ──
  { code: "99381", description: "Initial preventive exam, infant (under 1 yr)",                         category: "Preventive" },
  { code: "99382", description: "Initial preventive exam, early childhood (1-4 yr)",                    category: "Preventive" },
  { code: "99383", description: "Initial preventive exam, late childhood (5-11 yr)",                    category: "Preventive" },
  { code: "99384", description: "Initial preventive exam, adolescent (12-17 yr)",                       category: "Preventive" },
  { code: "99385", description: "Initial preventive exam, ages 18-39",                                  category: "Preventive" },
  { code: "99386", description: "Initial preventive exam, ages 40-64",                                  category: "Preventive" },
  { code: "99391", description: "Periodic preventive exam, established, infant (under 1 yr)",           category: "Preventive" },
  { code: "99392", description: "Periodic preventive exam, established, early childhood (1-4 yr)",      category: "Preventive" },
  { code: "99393", description: "Periodic preventive exam, established, late childhood (5-11 yr)",      category: "Preventive" },
  { code: "99394", description: "Periodic preventive exam, established, adolescent (12-17 yr)",         category: "Preventive" },
  { code: "99395", description: "Periodic preventive exam, established, 18-39",                         category: "Preventive" },
  { code: "99396", description: "Periodic preventive exam, established, 40-64",                         category: "Preventive" },
  { code: "G0438", description: "Annual Wellness Visit, initial (Medicare)",                            category: "Preventive" },
  { code: "G0439", description: "Annual Wellness Visit, subsequent (Medicare)",                         category: "Preventive" },
  { code: "G0402", description: "Welcome to Medicare preventive visit (IPPE)",                          category: "Preventive" },

  // ─── Telehealth-Specific ──
  { code: "99421", description: "Online digital E&M, established, 5-10 min over 7 days",                category: "Telehealth" },
  { code: "99422", description: "Online digital E&M, established, 11-20 min over 7 days",               category: "Telehealth" },
  { code: "99423", description: "Online digital E&M, established, 21+ min over 7 days",                 category: "Telehealth" },
  { code: "99441", description: "Telephone E&M by physician, 5-10 min",                                 category: "Telehealth" },
  { code: "99442", description: "Telephone E&M by physician, 11-20 min",                                category: "Telehealth" },
  { code: "99443", description: "Telephone E&M by physician, 21-30 min",                                category: "Telehealth" },
  { code: "G2010", description: "Remote evaluation of recorded video/images submitted by patient",      category: "Telehealth" },
  { code: "G2012", description: "Brief virtual check-in, 5-10 min",                                     category: "Telehealth" },

  // ─── Care Management (CCM, BHI, PCM) ──
  { code: "99490", description: "Chronic care management, 20+ min/month, clinical staff",               category: "Care Management" },
  { code: "99491", description: "Chronic care management, 30+ min/month, physician",                    category: "Care Management" },
  { code: "99437", description: "Chronic care management, each additional 30 min, physician",           category: "Care Management" },
  { code: "99439", description: "Chronic care management, each additional 20 min, clinical staff",      category: "Care Management" },
  { code: "99487", description: "Complex CCM, 60+ min/month, moderate-to-high MDM",                     category: "Care Management" },
  { code: "99489", description: "Complex CCM, each additional 30 min/month",                            category: "Care Management" },
  { code: "99483", description: "Cognitive assessment and care plan, 50 min",                           category: "Care Management" },
  { code: "99492", description: "Behavioral health collaborative care, initial 70 min/month",           category: "Care Management" },
  { code: "99493", description: "Behavioral health collaborative care, subsequent 60 min/month",        category: "Care Management" },
  { code: "99494", description: "Behavioral health collaborative care, each additional 30 min",         category: "Care Management" },
  { code: "99424", description: "Principal care management, physician, first 30 min/month",             category: "Care Management" },
  { code: "99426", description: "Principal care management, clinical staff, first 30 min/month",        category: "Care Management" },

  // ─── NC Tailored Care Management & Medicaid-specific ──
  { code: "G9007", description: "TCM coordinated care fee, scheduled team conference",                  category: "NC Medicaid TCM/AMH" },
  { code: "T1016", description: "Case management, each 15 minutes",                                     category: "NC Medicaid TCM/AMH" },
  { code: "T2022", description: "Case management, monthly bundle",                                      category: "NC Medicaid TCM/AMH" },
  { code: "T1017", description: "Targeted case management, each 15 min",                                category: "NC Medicaid TCM/AMH" },
  { code: "H0023", description: "Behavioral health outreach service",                                   category: "NC Medicaid TCM/AMH" },
  { code: "H0025", description: "Behavioral health prevention education service",                       category: "NC Medicaid TCM/AMH" },

  // ─── HRSN / Behavioral Screening ──
  { code: "G0136", description: "SDOH risk assessment, 5-15 min (twice yearly per beneficiary)",        category: "Screening" },
  { code: "96127", description: "Brief emotional/behavioral assessment with scoring",                   category: "Screening" },
  { code: "96160", description: "Health risk assessment, patient-focused",                              category: "Screening" },
  { code: "96161", description: "Health risk assessment, caregiver-focused",                            category: "Screening" },
  { code: "G0444", description: "Annual depression screening, 15 min",                                  category: "Screening" },
  { code: "G0442", description: "Annual alcohol misuse screening, 15 min",                              category: "Screening" },
  { code: "G0443", description: "Brief alcohol misuse counseling, 15 min",                              category: "Screening" },
  { code: "99406", description: "Smoking cessation counseling, 3-10 min",                               category: "Screening" },
  { code: "99407", description: "Smoking cessation counseling, intensive (over 10 min)",                category: "Screening" },

  // ─── In-Office Procedures ──
  { code: "36415", description: "Routine venipuncture (blood draw)",                                    category: "Procedure" },
  { code: "96372", description: "Therapeutic/diagnostic injection, IM/SubQ",                            category: "Procedure" },
  { code: "20610", description: "Major joint injection/aspiration (knee, shoulder, hip)",               category: "Procedure" },
  { code: "20605", description: "Intermediate joint injection/aspiration (wrist, elbow, ankle)",        category: "Procedure" },
  { code: "20600", description: "Small joint injection/aspiration (fingers, toes)",                     category: "Procedure" },
  { code: "17000", description: "Destruction of premalignant lesion, first",                            category: "Procedure" },
  { code: "17003", description: "Destruction of premalignant lesion, each additional (2-14)",           category: "Procedure" },
  { code: "17110", description: "Destruction of benign lesions, up to 14",                              category: "Procedure" },
  { code: "11200", description: "Removal of skin tags, up to 15 lesions",                               category: "Procedure" },
  { code: "12001", description: "Simple wound repair, 2.5 cm or less",                                  category: "Procedure" },
  { code: "10060", description: "Incision and drainage of abscess, simple",                             category: "Procedure" },

  // ─── Immunization Admin ──
  { code: "90471", description: "Immunization administration, first injection",                         category: "Immunization" },
  { code: "90472", description: "Immunization administration, each additional injection",               category: "Immunization" },
  { code: "90473", description: "Immunization administration, intranasal/oral, first",                  category: "Immunization" },
  { code: "90474", description: "Immunization administration, intranasal/oral, each additional",        category: "Immunization" },
  { code: "90460", description: "Immunization admin with counseling, under 19, first component",        category: "Immunization" },
  { code: "90461", description: "Immunization admin with counseling, under 19, each additional",        category: "Immunization" },

  // ─── In-Office Lab/POC ──
  { code: "81002", description: "Urinalysis, non-automated, without microscopy",                        category: "Lab/POC" },
  { code: "81025", description: "Urine pregnancy test",                                                 category: "Lab/POC" },
  { code: "82947", description: "Glucose, blood, quantitative",                                         category: "Lab/POC" },
  { code: "82962", description: "Glucose, blood, fingerstick (POC)",                                    category: "Lab/POC" },
  { code: "85018", description: "Hemoglobin",                                                           category: "Lab/POC" },
  { code: "87880", description: "Strep A direct optical observation",                                   category: "Lab/POC" },
  { code: "87804", description: "Influenza assay, direct optical",                                      category: "Lab/POC" },
  { code: "87811", description: "SARS-CoV-2 antigen, direct optical",                                   category: "Lab/POC" },

  // ─── EKG / Spirometry ──
  { code: "93000", description: "EKG, 12-lead, with interpretation and report",                         category: "Diagnostic" },
  { code: "93005", description: "EKG, 12-lead, tracing only",                                           category: "Diagnostic" },
  { code: "94010", description: "Spirometry",                                                           category: "Diagnostic" },
  { code: "94060", description: "Bronchodilation responsiveness, spirometry pre/post",                  category: "Diagnostic" },
  { code: "94640", description: "Inhaled bronchodilator treatment",                                     category: "Diagnostic" },
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
