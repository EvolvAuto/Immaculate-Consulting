// ═══════════════════════════════════════════════════════════════════════════════
// src/components/hrsn/StartScreeningModal.jsx
//
// Staff-initiated HRSN screening flow. Wraps HOPScreenerForm in a modal with:
//   - Completion-mode selector (Tablet Self / Tablet Staff Assisted / Paper)
//   - Patient picker (if not pre-selected)
//   - Submission as staff user, setting completed_by_user_id for audit
//
// Entry points:
//   - Due for Screening tab (patient pre-selected)
//   - Ad-hoc "Start a screening" button on HRSN view header (picker shown)
//   - Patient chart view (patient pre-selected) - future, Step 2b follow-up
//
// The clinical stakes of completion mode are explained in the UI because this
// is not a configuration dropdown - 'Tablet Staff Assisted' + negative IPV
// screen triggers an AI caveat that providers need to know about.
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import HOPScreenerForm from "./HOPScreenerForm";

const C = {
  teal: "#0F6E56", tealBg: "#E1F5EE", tealBorder: "#9FE1CB",
  amber: "#854F0B", amberBg: "#FAEEDA", amberBorder: "#FAC775",
  red: "#A32D2D", redBg: "#FCEBEB", redBorder: "#F5B8B8",
  bgPrimary: "#ffffff", bgSecondary: "#f7f7f5",
  textPrimary: "#1a1a18", textSecondary: "#6b6a63", textTertiary: "#9c9b94",
  borderLight: "rgba(0,0,0,0.08)", borderMid: "rgba(0,0,0,0.18)",
};

const COMPLETION_MODES = [
  {
    value: "Tablet Self",
    label: "Patient will complete on tablet",
    blurb: "Hand the tablet to the patient. They answer privately. Valid for IPV / safety screen.",
    recommended: true,
  },
  {
    value: "Tablet Staff Assisted",
    label: "I will read questions and enter answers",
    blurb: "For patients who need language, literacy, or accessibility support. The safety / IPV section is less reliable - the AI summary will note this caveat.",
  },
  {
    value: "Paper Transcribed",
    label: "I'm transcribing from a paper form",
    blurb: "Edge case. Use only when a patient completed a paper form privately and you're entering their answers.",
  },
];

export default function StartScreeningModal(props) {
  const onClose        = props.onClose;
  const onSubmitted    = props.onSubmitted;
  const practiceId     = props.practiceId;
  const currentUser    = props.currentUser;
  const initialPatient = props.initialPatient || null; // { id, first_name, last_name, mrn } | null

  // Flow: pick patient (optional) -> pick completion mode -> form -> submit
  const [step, setStep]                 = useState(initialPatient ? "mode" : "patient");
  const [patient, setPatient]           = useState(initialPatient);
  const [completionMode, setMode]       = useState("Tablet Self");
  const [submitError, setSubmitError]   = useState(null);

  const handleBack = () => {
    if (step === "form") setStep("mode");
    else if (step === "mode" && !initialPatient) setStep("patient");
  };

  const handleSubmit = async (payload) => {
    setSubmitError(null);
    const insertRow = {
      practice_id:       practiceId,
      patient_id:        patient.id,
      screener_type:     "HRSN",
      administered_via:  completionMode === "Paper Transcribed" ? "Paper" : "Staff Tablet",
      completion_mode:   completionMode,
      completed_by_user_id: currentUser && currentUser.id ? currentUser.id : null,
      responses:         payload.responses,
      flags:             payload.flags,
      total_score:       payload.total_score,
      severity:          payload.severity,
      requires_followup: payload.requires_followup,
      completed_at:      new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("screener_responses")
      .insert(insertRow)
      .select("id, ai_summary_status")
      .single();

    if (error) {
      setSubmitError(error.message || String(error));
      throw error;
    }

    if (onSubmitted) onSubmitted(data);
    // Let the success banner render for a beat before auto-closing
    setTimeout(function() { if (onClose) onClose(); }, 1800);
    return data;
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "40px 16px", overflowY: "auto",
        zIndex: 1000,
      }}
    >
      <div
        onClick={function(e) { e.stopPropagation(); }}
        style={{
          background: "#fff", borderRadius: 10,
          maxWidth: 780, width: "100%",
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          overflow: "hidden",
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        <ModalHeader
          step={step}
          patient={patient}
          onBack={step === "patient" ? null : handleBack}
          onClose={onClose}
        />

        <div style={{ padding: "20px 24px" }}>
          {step === "patient" && (
            <PatientPickerStep
              practiceId={practiceId}
              onPick={function(p) { setPatient(p); setStep("mode"); }}
            />
          )}

          {step === "mode" && patient && (
            <CompletionModeStep
              patient={patient}
              selected={completionMode}
              onSelect={setMode}
              onNext={function() { setStep("form"); }}
            />
          )}

          {step === "form" && patient && (
            <FormStep
              patient={patient}
              completionMode={completionMode}
              onSubmit={handleSubmit}
              onCancel={onClose}
              submitError={submitError}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
// Header
// ───────────────────────────────────────────────────────────────────────────────

function ModalHeader({ step, patient, onBack, onClose }) {
  const title =
    step === "patient" ? "Start HRSN screening" :
    step === "mode"    ? "How will this be completed?" :
                         "Social Needs Screening";

  return (
    <div style={{
      padding: "14px 20px",
      borderBottom: "0.5px solid " + C.borderLight,
      background: C.bgSecondary,
      display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        {onBack && (
          <button
            onClick={onBack}
            title="Back"
            style={{
              background: "transparent", border: "none",
              color: C.textSecondary, fontSize: 16,
              cursor: "pointer", padding: 4, lineHeight: 1,
              fontFamily: "inherit",
            }}
          >
            {"\u2039"}
          </button>
        )}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary }}>
            {title}
          </div>
          {patient && (
            <div style={{
              fontSize: 11, color: C.textSecondary, marginTop: 2,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>
              {(patient.first_name || "") + " " + (patient.last_name || "")}
              {patient.mrn ? (" \u00B7 MRN " + patient.mrn) : ""}
            </div>
          )}
        </div>
      </div>
      <button
        onClick={onClose}
        title="Close"
        style={{
          background: "transparent", border: "none",
          color: C.textSecondary, fontSize: 18,
          cursor: "pointer", padding: 4, lineHeight: 1,
          fontFamily: "inherit",
        }}
      >
        {"\u00D7"}
      </button>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
// Step 1: Patient picker
// ───────────────────────────────────────────────────────────────────────────────

function PatientPickerStep({ practiceId, onPick }) {
  const [query, setQuery]     = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  useEffect(() => {
    if (!practiceId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        // Load a reasonable recent window; client-side filter handles typeahead
        const { data, error } = await supabase
          .from("patients")
          .select("id, first_name, last_name, mrn, date_of_birth")
          .eq("practice_id", practiceId)
          .order("last_name", { ascending: true })
          .limit(200);
        if (cancelled) return;
        if (error) throw error;
        setResults(data || []);
      } catch (e) {
        if (!cancelled) setError(e && e.message ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return function() { cancelled = true; };
  }, [practiceId]);

  const filtered = useMemo(function() {
    const q = query.trim().toLowerCase();
    if (!q) return results.slice(0, 50);
    return results.filter(function(p) {
      const full = ((p.first_name || "") + " " + (p.last_name || "")).toLowerCase();
      const mrn  = String(p.mrn || "").toLowerCase();
      return full.includes(q) || mrn.includes(q);
    }).slice(0, 50);
  }, [query, results]);

  return (
    <div>
      <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 10, lineHeight: 1.5 }}>
        Choose the patient for this screening. Search by name or MRN.
      </div>

      <input
        type="text"
        value={query}
        onChange={function(e) { setQuery(e.target.value); }}
        placeholder="Search by name or MRN..."
        autoFocus
        style={{
          width: "100%", padding: "10px 12px",
          border: "0.5px solid " + C.borderMid, borderRadius: 6,
          fontSize: 13, fontFamily: "inherit", color: C.textPrimary,
          marginBottom: 12,
        }}
      />

      {loading && (
        <div style={{ padding: 24, textAlign: "center", color: C.textTertiary, fontSize: 12 }}>
          Loading patients...
        </div>
      )}

      {error && (
        <div style={{
          padding: "10px 12px", background: C.redBg, border: "0.5px solid " + C.redBorder,
          color: C.red, borderRadius: 6, fontSize: 12, marginBottom: 10,
        }}>
          {error}
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div style={{ padding: 24, textAlign: "center", color: C.textTertiary, fontSize: 12 }}>
          No patients match.
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div style={{
          maxHeight: 360, overflowY: "auto",
          border: "0.5px solid " + C.borderLight, borderRadius: 6,
        }}>
          {filtered.map(function(p, i) {
            return (
              <button
                key={p.id}
                onClick={function() { onPick(p); }}
                style={{
                  display: "flex", width: "100%", textAlign: "left",
                  padding: "10px 14px",
                  borderTop: i > 0 ? ("0.5px solid " + C.borderLight) : "none",
                  border: "none", background: "#fff",
                  cursor: "pointer", fontFamily: "inherit",
                  justifyContent: "space-between", alignItems: "center",
                }}
                onMouseEnter={function(e) { e.currentTarget.style.background = C.bgSecondary; }}
                onMouseLeave={function(e) { e.currentTarget.style.background = "#fff"; }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>
                    {(p.first_name || "") + " " + (p.last_name || "")}
                  </div>
                  <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>
                    {p.mrn ? ("MRN " + p.mrn) : "No MRN"}
                    {p.date_of_birth ? (" \u00B7 DOB " + new Date(p.date_of_birth).toLocaleDateString("en-US")) : ""}
                  </div>
                </div>
                <span style={{ fontSize: 12, color: C.textTertiary }}>{"\u203A"}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
// Step 2: Completion mode
// ───────────────────────────────────────────────────────────────────────────────

function CompletionModeStep({ patient, selected, onSelect, onNext }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 14, lineHeight: 1.55 }}>
        Choose how this screening will be completed. This matters clinically - it affects how the
        AI summary interprets the interpersonal safety section.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
        {COMPLETION_MODES.map(function(m) {
          const isSelected = selected === m.value;
          return (
            <button
              key={m.value}
              onClick={function() { onSelect(m.value); }}
              style={{
                display: "flex", textAlign: "left",
                padding: "14px 16px",
                background: isSelected ? C.tealBg : "#fff",
                border: "0.5px solid " + (isSelected ? C.teal : C.borderMid),
                borderRadius: 8,
                cursor: "pointer", fontFamily: "inherit",
                gap: 12,
              }}
            >
              <span style={{
                width: 18, height: 18, flexShrink: 0, borderRadius: "50%",
                border: "1.5px solid " + (isSelected ? C.teal : C.borderMid),
                display: "flex", alignItems: "center", justifyContent: "center",
                marginTop: 2,
              }}>
                {isSelected && (
                  <span style={{
                    width: 8, height: 8, borderRadius: "50%", background: C.teal,
                  }} />
                )}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 8, marginBottom: 4,
                }}>
                  <span style={{
                    fontSize: 13, fontWeight: 600,
                    color: isSelected ? C.teal : C.textPrimary,
                  }}>
                    {m.label}
                  </span>
                  {m.recommended && (
                    <span style={{
                      background: C.tealBg, color: C.teal,
                      border: "0.5px solid " + C.tealBorder,
                      fontSize: 9, fontWeight: 700, letterSpacing: "0.05em",
                      padding: "1px 7px", borderRadius: 3, textTransform: "uppercase",
                    }}>
                      Recommended
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: C.textSecondary, lineHeight: 1.5 }}>
                  {m.blurb}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div style={{
        paddingTop: 12, borderTop: "0.5px solid " + C.borderLight,
        display: "flex", justifyContent: "flex-end",
      }}>
        <button
          onClick={onNext}
          style={{
            background: C.teal, color: "#fff", border: "none",
            borderRadius: 6, padding: "10px 20px", fontSize: 13, fontWeight: 600,
            cursor: "pointer", fontFamily: "inherit",
          }}
        >
          Continue to screening {"\u203A"}
        </button>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
// Step 3: Form
// ───────────────────────────────────────────────────────────────────────────────

function FormStep({ patient, completionMode, onSubmit, onCancel, submitError }) {
  const [submittedId, setSubmittedId] = useState(null);

  const handleSubmit = async function(payload) {
    const result = await onSubmit(payload);
    if (result && result.id) setSubmittedId(result.id);
  };

  if (submittedId) {
    return (
      <div style={{
        padding: "28px 20px", textAlign: "center",
        background: C.tealBg, border: "0.5px solid " + C.tealBorder,
        borderRadius: 8,
      }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>{"\u2713"}</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.teal, marginBottom: 6 }}>
          Screening submitted
        </div>
        <div style={{ fontSize: 12, color: C.textPrimary, lineHeight: 1.5 }}>
          The AI summary is being generated. It will appear in the Recent Screenings list within a few seconds.
        </div>
      </div>
    );
  }

  return (
    <>
      {submitError && (
        <div style={{
          padding: "10px 12px", background: C.redBg, border: "0.5px solid " + C.redBorder,
          color: C.red, borderRadius: 6, fontSize: 12, marginBottom: 14,
        }}>
          {submitError}
        </div>
      )}
      <HOPScreenerForm
        patientName={(patient.first_name || "") + " " + (patient.last_name || "")}
        completionMode={completionMode}
        onSubmit={handleSubmit}
        onCancel={onCancel}
      />
    </>
  );
}
