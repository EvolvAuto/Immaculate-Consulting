// ═══════════════════════════════════════════════════════════════════════════════
// src/components/hrsn/HOPScreenerForm.jsx
//
// Healthy Opportunities Pilots (NC Medicaid HRSN core) screener form.
// Shared between patient portal and staff tablet entry points.
//
// 10 items across 5 domains + optional free-text. Scoring and flag derivation
// run client-side and are passed to onSubmit, but the Pro AI summarize edge
// function is the clinical source of truth - we send the raw responses and
// let Claude re-compute.
//
// Props:
//   - onSubmit(payload)  : async callback; payload = { responses, flags,
//                                                      total_score, severity,
//                                                      requires_followup }
//   - onCancel?          : optional; shows a Cancel button
//   - readOnly?          : preview mode, disables inputs
//   - completionMode?    : display-only badge indicating who is completing
//                          ("Portal Self" / "Tablet Self" / "Tablet Staff Assisted")
//   - patientName?       : shown in header when staff-administering
// ═══════════════════════════════════════════════════════════════════════════════

import { useMemo, useState } from "react";

// Palette is local to keep this component self-contained across portal + staff
// shells (the portal uses its own C object, not lib/tokens).
const C = {
  teal: "#0F6E56", tealBg: "#E1F5EE", tealBorder: "#9FE1CB",
  amber: "#854F0B", amberBg: "#FAEEDA", amberBorder: "#FAC775",
  red: "#A32D2D", redBg: "#FCEBEB", redBorder: "#F5B8B8",
  bgPrimary: "#ffffff", bgSecondary: "#f7f7f5",
  textPrimary: "#1a1a18", textSecondary: "#6b6a63", textTertiary: "#9c9b94",
  borderLight: "rgba(0,0,0,0.08)", borderMid: "rgba(0,0,0,0.18)",
};

// ───────────────────────────────────────────────────────────────────────────────
// Instrument definition - NC Medicaid HOP core items
// ───────────────────────────────────────────────────────────────────────────────

const FREQUENCY_LIKERT = ["Often", "Sometimes", "Never"];
const HITS_LIKERT      = ["Never", "Rarely", "Sometimes", "Fairly often", "Frequently"];

const HOUSING_PROBLEMS = [
  "Pests (bugs, ants, mice)",
  "Mold",
  "Lead paint or pipes",
  "Lack of heat",
  "Oven or stove not working",
  "Smoke detectors missing or not working",
  "Water leaks",
  "None of the above",
];

const ITEMS = [
  {
    key: "food_q1_worried_run_out",
    domain: "food_insecurity",
    domainLabel: "Food",
    type: "single",
    options: FREQUENCY_LIKERT,
    question: "Within the past 12 months, we worried whether our food would run out before we got money to buy more.",
  },
  {
    key: "food_q2_didnt_last",
    domain: "food_insecurity",
    domainLabel: "Food",
    type: "single",
    options: FREQUENCY_LIKERT,
    question: "Within the past 12 months, the food we bought just didn't last and we didn't have money to get more.",
  },
  {
    key: "housing_q3_status",
    domain: "housing_instability",
    domainLabel: "Housing",
    type: "single",
    options: [
      "I have housing",
      "I am worried about losing my housing",
      "I do not have housing",
    ],
    question: "What is your housing situation today?",
  },
  {
    key: "housing_q4_problems",
    domain: "housing_quality",
    domainLabel: "Housing quality",
    type: "multi",
    options: HOUSING_PROBLEMS,
    question: "Think about the place you live. Do you have any of the following problems? (Check all that apply)",
    helper: "Selecting 'None of the above' clears the other choices.",
  },
  {
    key: "transportation_q5",
    domain: "transportation",
    domainLabel: "Transportation",
    type: "multi",
    options: [
      "Yes - medical appointments",
      "Yes - work or school",
      "Yes - things for daily living",
      "No",
    ],
    question: "In the past 12 months, has lack of reliable transportation kept you from any of the following? (Check all that apply)",
    helper: "Selecting 'No' clears the other choices.",
  },
  {
    key: "utilities_q6",
    domain: "utilities",
    domainLabel: "Utilities",
    type: "single",
    options: [
      "Yes",
      "No",
      "Already shut off",
    ],
    question: "In the past 12 months, has the electric, gas, oil, or water company threatened to shut off services in your home?",
  },
  {
    key: "hits_q7_physical_hurt",
    domain: "interpersonal_safety",
    domainLabel: "Safety",
    type: "single",
    options: HITS_LIKERT,
    question: "How often does anyone, including family, physically hurt you?",
    hits: true,
  },
  {
    key: "hits_q8_insult",
    domain: "interpersonal_safety",
    domainLabel: "Safety",
    type: "single",
    options: HITS_LIKERT,
    question: "How often does anyone, including family, insult or talk down to you?",
    hits: true,
  },
  {
    key: "hits_q9_threaten",
    domain: "interpersonal_safety",
    domainLabel: "Safety",
    type: "single",
    options: HITS_LIKERT,
    question: "How often does anyone, including family, threaten you with harm?",
    hits: true,
  },
  {
    key: "hits_q10_scream_curse",
    domain: "interpersonal_safety",
    domainLabel: "Safety",
    type: "single",
    options: HITS_LIKERT,
    question: "How often does anyone, including family, scream or curse at you?",
    hits: true,
  },
];

const HITS_SCORE = { "Never": 1, "Rarely": 2, "Sometimes": 3, "Fairly often": 4, "Frequently": 5 };

// ───────────────────────────────────────────────────────────────────────────────
// Scoring helper - exported so hrsnApi can reuse
// ───────────────────────────────────────────────────────────────────────────────

export function scoreHOPResponses(responses) {
  const flags = [];

  const foodPositive =
    ["Often", "Sometimes"].includes(responses.food_q1_worried_run_out) ||
    ["Often", "Sometimes"].includes(responses.food_q2_didnt_last);
  if (foodPositive) flags.push("food_insecurity_positive");

  if (responses.housing_q3_status && responses.housing_q3_status !== "I have housing") {
    flags.push("housing_instability_positive");
  }

  const problems = Array.isArray(responses.housing_q4_problems) ? responses.housing_q4_problems : [];
  const hasQualityIssue = problems.filter(function(p) { return p && p !== "None of the above"; }).length > 0;
  if (hasQualityIssue) flags.push("housing_quality_positive");

  if (responses.transportation_q5 && responses.transportation_q5 !== "No") {
    flags.push("transportation_positive");
  }

  if (responses.utilities_q6 === "Yes" || responses.utilities_q6 === "Already shut off") {
    flags.push("utilities_positive");
  }

  const hitsKeys = ["hits_q7_physical_hurt", "hits_q8_insult", "hits_q9_threaten", "hits_q10_scream_curse"];
  const hitsValues = hitsKeys.map(function(k) { return responses[k]; });
  const hitsTotal = hitsValues.reduce(function(sum, v) {
    return sum + (HITS_SCORE[v] || 0);
  }, 0);
  const hitsHasSevere = hitsValues.some(function(v) {
    return v === "Fairly often" || v === "Frequently";
  });
  const safetyPositive = hitsTotal >= 11 || hitsHasSevere;
  if (safetyPositive) flags.push("interpersonal_safety_positive");

  // Derive a coarse severity - the AI summary is the real source of nuance
  let severity = "None";
  if (flags.length >= 3 || hitsHasSevere) severity = "Severe";
  else if (flags.length === 2) severity = "Moderate";
  else if (flags.length === 1) severity = "Mild";

  return {
    flags: flags,
    total_score: hitsTotal,          // HITS subscale, 4-20
    severity: severity,
    requires_followup: flags.length > 0,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
// Form component
// ───────────────────────────────────────────────────────────────────────────────

export default function HOPScreenerForm(props) {
  const onSubmit       = props.onSubmit;
  const onCancel       = props.onCancel;
  const readOnly       = props.readOnly || false;
  const completionMode = props.completionMode;
  const patientName    = props.patientName;
  const initialValues  = props.initialValues || {};

  const [responses, setResponses] = useState(function() {
    const init = {
      instrument: "Healthy Opportunities Pilots",
      version: "1.0",
      housing_q4_problems: [],
      free_text_other: "",
    };
    return Object.assign(init, initialValues);
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState(null);
  const [touched, setTouched]       = useState({});

  const scoring = useMemo(function() {
    return scoreHOPResponses(responses);
  }, [responses]);

  const answeredCount = useMemo(function() {
    return ITEMS.filter(function(item) {
      const v = responses[item.key];
      if (item.type === "multi") return Array.isArray(v) && v.length > 0;
      return v !== undefined && v !== null && v !== "";
    }).length;
  }, [responses]);

  const allAnswered = answeredCount === ITEMS.length;

  const setSingle = function(key, value) {
    setResponses(function(r) { return Object.assign({}, r, { [key]: value }); });
    setTouched(function(t) { return Object.assign({}, t, { [key]: true }); });
  };

  const toggleMulti = function(key, value) {
    setResponses(function(r) {
      const current = Array.isArray(r[key]) ? r[key] : [];
      let next;
      if (value === "None of the above") {
        // Selecting None clears other choices
        next = current.includes("None of the above") ? [] : ["None of the above"];
      } else {
        if (current.includes(value)) {
          next = current.filter(function(x) { return x !== value; });
        } else {
          next = current.filter(function(x) { return x !== "None of the above"; }).concat(value);
        }
      }
      return Object.assign({}, r, { [key]: next });
    });
    setTouched(function(t) { return Object.assign({}, t, { [key]: true }); });
  };

  const handleSubmit = async function() {
    if (submitting) return;
    if (!allAnswered) {
      setError("Please answer all questions before submitting. You can skip the final comment box if you like.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({
        responses: responses,
        flags: scoring.flags,
        total_score: scoring.total_score,
        severity: scoring.severity,
        requires_followup: scoring.requires_followup,
      });
    } catch (e) {
      setError(e && e.message ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      maxWidth: 720, margin: "0 auto",
      fontFamily: "Inter, system-ui, sans-serif", color: C.textPrimary,
    }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>
          Pre-Visit Social Needs Screening
        </div>
        <div style={{ fontSize: 13, color: C.textSecondary, lineHeight: 1.6 }}>
          Your answers help your care team understand your whole life, not just
          your medical history. This information is private and shared only with
          your care team. It takes about 3 minutes.
        </div>
        {(completionMode || patientName) && (
          <div style={{
            marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap",
            fontSize: 11,
          }}>
            {patientName && (
              <span style={{
                background: C.tealBg, color: C.teal,
                border: "0.5px solid " + C.tealBorder,
                padding: "3px 10px", borderRadius: 10, fontWeight: 600,
              }}>
                Screening: {patientName}
              </span>
            )}
            {completionMode && (
              <span style={{
                background: C.bgSecondary, color: C.textSecondary,
                border: "0.5px solid " + C.borderLight,
                padding: "3px 10px", borderRadius: 10, fontWeight: 600,
              }}>
                Completion mode: {completionMode}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Progress */}
      <div style={{
        position: "sticky", top: 0, zIndex: 10,
        background: C.bgPrimary, paddingBottom: 8, marginBottom: 16,
        borderBottom: "0.5px solid " + C.borderLight,
      }}>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          fontSize: 11, color: C.textTertiary, marginBottom: 6,
        }}>
          <span>{answeredCount} of {ITEMS.length} questions answered</span>
          <span>{Math.round((answeredCount / ITEMS.length) * 100)}%</span>
        </div>
        <div style={{
          height: 4, background: C.bgSecondary, borderRadius: 2, overflow: "hidden",
        }}>
          <div style={{
            width: ((answeredCount / ITEMS.length) * 100) + "%",
            height: "100%", background: C.teal,
            transition: "width 0.2s ease",
          }} />
        </div>
      </div>

      {/* Questions */}
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {ITEMS.map(function(item, idx) {
          return (
            <QuestionRow
              key={item.key}
              item={item}
              index={idx + 1}
              value={responses[item.key]}
              readOnly={readOnly}
              onSelect={setSingle}
              onToggle={toggleMulti}
            />
          );
        })}

        {/* Free-text */}
        <div style={{
          padding: "14px 16px",
          background: C.bgSecondary,
          border: "0.5px solid " + C.borderLight,
          borderRadius: 8,
        }}>
          <div style={{
            fontSize: 12, fontWeight: 700, marginBottom: 6, color: C.textPrimary,
          }}>
            Is there anything else you would like to share?
          </div>
          <div style={{ fontSize: 11, color: C.textTertiary, marginBottom: 10 }}>
            Optional. Anything about your life situation that affects your health
            or what your care team should know.
          </div>
          <textarea
            value={responses.free_text_other || ""}
            onChange={function(e) { setSingle("free_text_other", e.target.value); }}
            placeholder="E.g. 'My daughter used to drive me to appointments but started a new job...'"
            disabled={readOnly || submitting}
            style={{
              width: "100%", minHeight: 80, padding: 10,
              border: "0.5px solid " + C.borderMid, borderRadius: 6,
              fontSize: 13, fontFamily: "inherit", color: C.textPrimary,
              lineHeight: 1.5, resize: "vertical",
            }}
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          marginTop: 16, padding: "10px 14px",
          background: C.redBg, border: "0.5px solid " + C.redBorder,
          color: C.red, fontSize: 12, borderRadius: 6,
        }}>
          {error}
        </div>
      )}

      {/* Actions */}
      {!readOnly && (
        <div style={{
          marginTop: 24, paddingTop: 16,
          borderTop: "0.5px solid " + C.borderLight,
          display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap",
        }}>
          {onCancel && (
            <button
              onClick={onCancel}
              disabled={submitting}
              style={{
                background: "#fff", color: C.textSecondary,
                border: "0.5px solid " + C.borderMid,
                borderRadius: 6, padding: "9px 16px", fontSize: 13, fontWeight: 600,
                cursor: submitting ? "wait" : "pointer", fontFamily: "inherit",
                opacity: submitting ? 0.6 : 1,
              }}
            >
              Cancel
            </button>
          )}
          <button
            onClick={handleSubmit}
            disabled={submitting || !allAnswered}
            style={{
              background: allAnswered ? C.teal : C.textTertiary,
              color: "#fff", border: "none",
              borderRadius: 6, padding: "9px 20px", fontSize: 13, fontWeight: 600,
              cursor: submitting ? "wait" : (allAnswered ? "pointer" : "not-allowed"),
              fontFamily: "inherit",
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? "Submitting..." : "Submit screening"}
          </button>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
// Question row
// ───────────────────────────────────────────────────────────────────────────────

function QuestionRow({ item, index, value, readOnly, onSelect, onToggle }) {
  return (
    <div style={{
      padding: "16px 18px",
      background: C.bgPrimary,
      border: "0.5px solid " + C.borderLight,
      borderRadius: 8,
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between",
        alignItems: "flex-start", gap: 12, marginBottom: 12,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
            textTransform: "uppercase", color: C.textTertiary, marginBottom: 4,
          }}>
            Question {index} of {ITEMS.length} - {item.domainLabel}
          </div>
          <div style={{ fontSize: 14, fontWeight: 500, color: C.textPrimary, lineHeight: 1.5 }}>
            {item.question}
          </div>
          {item.helper && (
            <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 4 }}>
              {item.helper}
            </div>
          )}
        </div>
      </div>

      {item.type === "single" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {item.options.map(function(opt) {
            const selected = value === opt;
            return (
              <OptionButton
                key={opt}
                label={opt}
                selected={selected}
                disabled={readOnly}
                onClick={function() { onSelect(item.key, opt); }}
                type="radio"
              />
            );
          })}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {item.options.map(function(opt) {
            const arr = Array.isArray(value) ? value : [];
            const selected = arr.includes(opt);
            return (
              <OptionButton
                key={opt}
                label={opt}
                selected={selected}
                disabled={readOnly}
                onClick={function() { onToggle(item.key, opt); }}
                type="checkbox"
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function OptionButton({ label, selected, disabled, onClick, type }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        width: "100%", textAlign: "left",
        padding: "10px 12px",
        background: selected ? C.tealBg : "#fff",
        border: "0.5px solid " + (selected ? C.tealBorder : C.borderMid),
        borderRadius: 6,
        cursor: disabled ? "default" : "pointer",
        fontFamily: "inherit", fontSize: 13,
        color: selected ? C.teal : C.textPrimary,
        fontWeight: selected ? 600 : 400,
        transition: "background 0.1s, border-color 0.1s",
      }}
    >
      <Indicator selected={selected} type={type} />
      <span>{label}</span>
    </button>
  );
}

function Indicator({ selected, type }) {
  const size = 16;
  if (type === "checkbox") {
    return (
      <span style={{
        width: size, height: size, flexShrink: 0,
        borderRadius: 3,
        border: "1.5px solid " + (selected ? C.teal : C.borderMid),
        background: selected ? C.teal : "#fff",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#fff", fontSize: 11, fontWeight: 700,
      }}>{selected ? "\u2713" : ""}</span>
    );
  }
  return (
    <span style={{
      width: size, height: size, flexShrink: 0,
      borderRadius: "50%",
      border: "1.5px solid " + (selected ? C.teal : C.borderMid),
      background: "#fff",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      {selected && (
        <span style={{
          width: 7, height: 7, borderRadius: "50%", background: C.teal,
        }} />
      )}
    </span>
  );
}
