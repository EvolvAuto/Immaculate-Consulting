import { useState, useEffect, useMemo } from "react";
import { supabase } from "../../lib/supabaseClient";
import { C } from "../../lib/tokens";
import { Badge, Btn, Modal, ErrorBanner, FL } from "../../components/ui";
import { inputStyle, selectStyle } from "./shared";

// ===============================================================================
// LogTouchpointModal - the "Log touchpoint" form rendered from TouchpointsTab.
//
// Field-by-field policy rationale:
//   - Patient picker: filters to patients with at least one Active or
//     Pending enrollment in this practice. Scopes enrollment automatically
//     if patient has one active enrollment; prompts if multiple.
//   - Contact Method: from cm_contact_method enum (hardcoded list here).
//     "Attempt - No Contact" forces successful=false and disables toggle.
//   - Activity Category: fetched live from cm_reference_codes where
//     category='activity_category'. Enforced by DB FK trigger so this
//     cannot be bypassed client-side anyway.
//   - HRSN Domains: optional multi-select. Shown always - lets CM tag
//     proactive HRSN discussions even outside a formal referral.
//   - Notes: 500 char max. Stored in cm_touchpoints.notes.
//   - Delivered By Role: auto-filled from user's role. No UI field.
//
// TouchpointAiPreview (internal to this file) renders the structured AI
// output strip that appears after the CM clicks "Polish with AI".
// ===============================================================================

// Values must match the cm_contact_method Postgres enum exactly.
const CONTACT_METHODS = [
  "In Person",
  "Telephonic",
  "Video",
  "Secure Message",
  "Letter",
  "Email",
  "Attempt - No Contact",
];

// Methods that count toward the TCM monthly billing floor when successful.
// Per TCM Provider Manual Section 4.2: qualifying contacts are member-facing
// interactions (in-person, telephonic, or two-way audio/video). Letter, email,
// and secure message do not qualify; attempts with no contact never qualify.
const TCM_QUALIFYING_METHODS = new Set(["In Person", "Telephonic", "Video"]);

// HOP HRSN domains used across PracticeOS (matches hrsn_referral_drafts.domain
// values). These are stored in cm_touchpoints.hrsn_domains_addressed as text[].
const HOP_DOMAINS = [
  { code: "food_insecurity",     label: "Food insecurity" },
  { code: "housing_instability", label: "Housing instability" },
  { code: "housing_quality",     label: "Housing quality" },
  { code: "transportation",      label: "Transportation" },
  { code: "utilities",           label: "Utilities" },
  { code: "interpersonal_safety", label: "Interpersonal safety" },
];

export default function LogTouchpointModal({ practiceId, userId, userRole, onClose, onLogged }) {
  const [enrolledPatients, setEnrolledPatients] = useState([]);
  const [activityCodes, setActivityCodes]       = useState([]);
  // HRSN domains are hardcoded from HOP spec, not fetched (no reference_codes category for them).
  const hrsnDomains = HOP_DOMAINS;

  const [patientId, setPatientId]           = useState("");
  const [enrollmentId, setEnrollmentId]     = useState("");
  const [availableEnrollments, setAvailableEnrollments] = useState([]);
  const [touchpointAt, setTouchpointAt]     = useState(() => {
    // Default to now, formatted for datetime-local input (YYYY-MM-DDTHH:MM)
    const d = new Date();
    const pad = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  });
  const [contactMethod, setContactMethod]   = useState("Telephonic");
  const [activityCode, setActivityCode]     = useState("");
  const [selectedHrsn, setSelectedHrsn]     = useState([]);
  const [notes, setNotes]                   = useState("");
  const [successful, setSuccessful]         = useState(true);

  const [saving, setSaving]                 = useState(false);
  const [error, setError]                   = useState(null);

  // AI polish state. `aiResult` holds the normalized response from the
  // cmp-summarize-touchpoint edge function; when present we render a preview
  // strip showing action items, detected concerns, and the TCM-countability
  // rationale. `aiMeta` captures model/version for the DB audit fields so we
  // can mark the touchpoint as AI-polished on save. `notesBaseline` captures
  // what polished_notes looked like right after the AI populated the textarea
  // so we can detect user edits - if the user diverged, we still write their
  // text but leave ai_scribe_summary NULL to avoid claiming AI content they
  // didn't actually keep.
  const [aiPolishing, setAiPolishing]   = useState(false);
  const [aiError, setAiError]           = useState(null);
  const [aiResult, setAiResult]         = useState(null);
  const [aiMeta, setAiMeta]             = useState(null);
  const [notesBaseline, setNotesBaseline] = useState("");

  // Derive: if Attempt - No Contact, force successful=false
  useEffect(() => {
    if (contactMethod === "Attempt - No Contact") {
      setSuccessful(false);
    }
  }, [contactMethod]);

  // Load enrolled patients (Active + Pending enrollments in practice)
  useEffect(() => {
    if (!practiceId) return;
    supabase
      .from("cm_enrollments")
      .select("id, patient_id, program_type, acuity_tier, enrollment_status, patients(first_name, last_name, date_of_birth, mrn)")
      .eq("practice_id", practiceId)
      .in("enrollment_status", ["Active", "Pending"])
      .order("enrollment_status", { ascending: true })
      .then(({ data }) => setEnrolledPatients(data || []));
  }, [practiceId]);

  // Load activity codes
  useEffect(() => {
    supabase
      .from("cm_reference_codes")
      .select("code, label, metadata, sort_order")
      .eq("category", "activity_category")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .then(({ data, error }) => {
        if (!error && data) setActivityCodes(data);
      });
  }, []);

  // When patient changes, compute available enrollments for that patient
  useEffect(() => {
    if (!patientId) {
      setAvailableEnrollments([]);
      setEnrollmentId("");
      return;
    }
    const matching = enrolledPatients.filter(e => e.patient_id === patientId);
    setAvailableEnrollments(matching);
    if (matching.length === 1) {
      setEnrollmentId(matching[0].id);
    } else {
      setEnrollmentId("");
    }
  }, [patientId, enrolledPatients]);

  // Deduplicated patient list for the picker
  const patientOptions = useMemo(() => {
    const seen = new Map();
    for (const e of enrolledPatients) {
      if (!seen.has(e.patient_id)) {
        seen.set(e.patient_id, {
          id: e.patient_id,
          first_name: e.patients?.first_name || "",
          last_name:  e.patients?.last_name || "",
          mrn:        e.patients?.mrn || "",
        });
      }
    }
    return Array.from(seen.values()).sort((a, b) => (a.last_name + a.first_name).localeCompare(b.last_name + b.first_name));
  }, [enrolledPatients]);

  // Group activity codes by metadata.group if present; otherwise flat.
  const groupedActivities = useMemo(() => {
    const groups = {};
    let hasGrouping = false;
    for (const c of activityCodes) {
      const g = (c.metadata && c.metadata.group) || null;
      if (g) hasGrouping = true;
      const key = g || "All activities";
      if (!groups[key]) groups[key] = [];
      groups[key].push(c);
    }
    return { groups, hasGrouping };
  }, [activityCodes]);

  const toggleHrsn = (code) => {
    setSelectedHrsn(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]);
  };

  // -------------------------------------------------------------------------
  // AI polish handler - invokes cmp-summarize-touchpoint with the CM's raw
  // notes and auto-populates form fields with suggestions. Never overwrites
  // fields the user has already set meaningfully.
  // -------------------------------------------------------------------------
  const handleAiPolish = async () => {
    if (!notes.trim())    { setAiError("Type some raw notes first, then polish"); return; }
    if (!enrollmentId)    { setAiError("Pick a patient/enrollment first"); return; }
    if (!contactMethod)   { setAiError("Pick a contact method first"); return; }

    setAiPolishing(true);
    setAiError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const url = supabase.supabaseUrl + "/functions/v1/cmp-summarize-touchpoint";
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": "Bearer " + token,
        },
        body: JSON.stringify({
          raw_notes: notes,
          contact_method: contactMethod,
          enrollment_id: enrollmentId,
          current_activity_category_code: activityCode || null,
        }),
      });
      const body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || "HTTP " + res.status);

      // Replace notes textarea with polished version, record baseline so we
      // can detect later edits. Suggest activity code only if user hadn't
      // already picked one. Merge suggested HRSN domains with any the user
      // manually toggled.
      const polished = body.polished_notes || notes;
      setNotes(polished);
      setNotesBaseline(polished);

      if (!activityCode && body.suggested_activity_category_code) {
        setActivityCode(body.suggested_activity_category_code);
      }
      if (Array.isArray(body.suggested_hrsn_domains) && body.suggested_hrsn_domains.length > 0) {
        setSelectedHrsn(prev => {
          const merged = new Set(prev);
          for (const d of body.suggested_hrsn_domains) merged.add(d);
          return Array.from(merged);
        });
      }

      setAiResult(body);
      setAiMeta({
        model_used:     body.model_used,
        prompt_version: body.prompt_version,
        generated_at:   body.generated_at,
      });
    } catch (e) {
      setAiError(e.message || "AI polish failed");
    } finally {
      setAiPolishing(false);
    }
  };

  const save = async () => {
    if (!patientId)       { setError("Select a patient"); return; }
    if (!enrollmentId)    { setError("Select an enrollment (patient has multiple)"); return; }
    if (!touchpointAt)    { setError("Set the contact date/time"); return; }
    if (!contactMethod)   { setError("Select a contact method"); return; }
    if (!activityCode)    { setError("Select an activity category"); return; }
    if (notes.length > 500) { setError("Notes must be 500 characters or fewer"); return; }

    // No future-dated touchpoints
    const when = new Date(touchpointAt);
    if (when.getTime() > Date.now()) { setError("Touchpoints cannot be dated in the future"); return; }

    setSaving(true);
    setError(null);

    // Role mapping to cm_delivered_by_role enum. Best-effort; if user's role
    // does not map cleanly, we default to "Care Manager" since that is the
    // baseline for the cm_touchpoints.delivered_by_role scope trigger.
    // Maps public.users.role to cm_delivery_role enum values.
    // cm_delivery_role values: Care Manager, Supervising Care Manager, Extender,
    // Provider, Pharmacist, Other, CHW.
    const roleMap = {
      "Care Manager":             "Care Manager",
      "Supervising Care Manager": "Supervising Care Manager",
      "Care Manager Supervisor":  "Supervising Care Manager",
      "CHW":                      "CHW",
      "Owner":                    "Other",
      "Manager":                  "Other",
      "Provider":                 "Provider",
    };
    const deliveredByRole = roleMap[userRole] || "Other";

    // Compute derived billing flags.
    // successful_contact: user-specified, forced false if Attempt.
    // counts_toward_tcm_contact: must be a member-facing successful contact.
    //   Per TCM Provider Manual, Secure Message / Letter / Email do NOT count.
    const isSuccessful = contactMethod === "Attempt - No Contact" ? false : successful;
    const countsTowardTcm = isSuccessful && TCM_QUALIFYING_METHODS.has(contactMethod);

    // Build insert payload. All NOT NULL columns must be either provided or
    // have DB defaults. hrsn_domains_addressed is NOT NULL with default '{}',
    // but we always send the array to be explicit about the user's intent.
    const payload = {
      practice_id:               practiceId,
      enrollment_id:             enrollmentId,
      patient_id:                patientId,
      delivered_by_user_id:      userId,
      touchpoint_at:             when.toISOString(),
      contact_method:            contactMethod,
      successful_contact:        isSuccessful,
      counts_toward_tcm_contact: countsTowardTcm,
      delivered_by_role:         deliveredByRole,
      activity_category_code:    activityCode,
      hrsn_domains_addressed:    selectedHrsn,
      notes:                     notes.trim() || null,
      source:                    "Manual",
    };

    // AI audit trail: only mark ai_scribe_summary / ai_scribe_model when the
    // user actually kept the AI-polished text (baseline match). If they
    // edited the polished version, write just their text and leave the AI
    // columns null - we don't want to claim AI content the user rewrote.
    if (aiResult && notes === notesBaseline) {
      payload.ai_scribe_summary = notes.trim();
      payload.ai_scribe_model   = aiMeta?.model_used || null;
      payload.source            = "Manual-AI-Polished";
    }

    try {
      const { error: insErr } = await supabase.from("cm_touchpoints").insert(payload);
      if (insErr) throw insErr;
      onLogged();
    } catch (e) {
      setError(e.message || "Failed to log touchpoint");
      setSaving(false);
    }
  };

  const mustPickEnrollment = availableEnrollments.length > 1 && !enrollmentId;

  return (
    <Modal title="Log touchpoint" onClose={onClose} width={720}>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={{ gridColumn: "1 / -1" }}>
          <FL>Patient</FL>
          <select value={patientId} onChange={e => setPatientId(e.target.value)} style={selectStyle}>
            <option value="">-- Select patient --</option>
            {patientOptions.map(p => (
              <option key={p.id} value={p.id}>
                {p.last_name}, {p.first_name}{p.mrn ? " (" + p.mrn + ")" : ""}
              </option>
            ))}
          </select>
          {enrolledPatients.length === 0 && (
            <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 4 }}>
              No Active or Pending enrollments in this practice yet. Seed enrollments first.
            </div>
          )}
        </div>

        {mustPickEnrollment && (
          <div style={{ gridColumn: "1 / -1" }}>
            <FL>Which enrollment? (This patient has multiple)</FL>
            <select value={enrollmentId} onChange={e => setEnrollmentId(e.target.value)} style={selectStyle}>
              <option value="">-- Select enrollment --</option>
              {availableEnrollments.map(e => (
                <option key={e.id} value={e.id}>
                  {e.program_type} ({e.acuity_tier}) - {e.enrollment_status}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <FL>Contact date/time</FL>
          <input type="datetime-local" value={touchpointAt} onChange={e => setTouchpointAt(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <FL>Contact method</FL>
          <select value={contactMethod} onChange={e => setContactMethod(e.target.value)} style={selectStyle}>
            {CONTACT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        <div style={{ gridColumn: "1 / -1" }}>
          <FL>Activity category</FL>
          <select value={activityCode} onChange={e => setActivityCode(e.target.value)} style={selectStyle}>
            <option value="">-- Select activity --</option>
            {groupedActivities.hasGrouping
              ? Object.entries(groupedActivities.groups).map(([groupName, codes]) => (
                  <optgroup key={groupName} label={groupName}>
                    {codes.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                  </optgroup>
                ))
              : activityCodes.map(c => <option key={c.code} value={c.code}>{c.label}</option>)
            }
          </select>
          {activityCodes.length === 0 && (
            <div style={{ fontSize: 11, color: C.amber, marginTop: 4 }}>
              Warning: no activity codes loaded. Check that cm_reference_codes has category='activity_category' rows.
            </div>
          )}
        </div>

        {hrsnDomains.length > 0 && (
          <div style={{ gridColumn: "1 / -1" }}>
            <FL>HRSN domains (optional)</FL>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {hrsnDomains.map(d => (
                <button
                  key={d.code}
                  type="button"
                  onClick={() => toggleHrsn(d.code)}
                  style={{
                    padding: "5px 12px",
                    fontSize: 12,
                    fontWeight: 600,
                    fontFamily: "inherit",
                    border: "0.5px solid " + (selectedHrsn.includes(d.code) ? C.teal : C.borderLight),
                    background: selectedHrsn.includes(d.code) ? C.tealBg : C.bgPrimary,
                    color: selectedHrsn.includes(d.code) ? C.teal : C.textSecondary,
                    borderRadius: 16,
                    cursor: "pointer",
                  }}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ gridColumn: "1 / -1" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <FL>Notes ({notes.length}/500)</FL>
            {enrollmentId && contactMethod && notes.trim().length >= 5 && (
              <Btn
                variant={aiResult ? "outline" : "primary"}
                size="sm"
                disabled={aiPolishing}
                onClick={handleAiPolish}
                style={{ marginBottom: 4 }}
              >
                {aiPolishing ? "Polishing..." : (aiResult ? "Re-polish" : "Polish with AI")}
              </Btn>
            )}
          </div>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value.slice(0, 500))}
            rows={4}
            placeholder="Clinical observations, topics discussed, follow-up needed..."
            style={{ ...inputStyle, resize: "vertical" }}
          />
          {aiError && (
            <div style={{ marginTop: 6, fontSize: 12, color: C.red, background: C.redBg, padding: "6px 10px", borderRadius: 6, border: "0.5px solid " + C.redBorder }}>
              {aiError}
            </div>
          )}
          {aiResult && (
            <TouchpointAiPreview aiResult={aiResult} notesEdited={notes !== notesBaseline} />
          )}
        </div>

        <div style={{ gridColumn: "1 / -1", padding: 12, background: C.bgSecondary, border: "0.5px solid " + C.borderLight, borderRadius: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 8 }}>
            Outcome
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              disabled={contactMethod === "Attempt - No Contact"}
              onClick={() => setSuccessful(true)}
              style={{
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: 600,
                fontFamily: "inherit",
                border: "0.5px solid " + (successful && contactMethod !== "Attempt - No Contact" ? "#86efac" : C.borderLight),
                background: successful && contactMethod !== "Attempt - No Contact" ? "#ecfdf5" : C.bgPrimary,
                color: contactMethod === "Attempt - No Contact" ? C.textTertiary : (successful ? "#047857" : C.textSecondary),
                borderRadius: 6,
                cursor: contactMethod === "Attempt - No Contact" ? "not-allowed" : "pointer",
                opacity: contactMethod === "Attempt - No Contact" ? 0.5 : 1,
              }}
            >
              Successful
            </button>
            <button
              type="button"
              onClick={() => setSuccessful(false)}
              style={{
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: 600,
                fontFamily: "inherit",
                border: "0.5px solid " + (!successful ? "#fcd34d" : C.borderLight),
                background: !successful ? "#fffbeb" : C.bgPrimary,
                color: !successful ? "#b45309" : C.textSecondary,
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              Unsuccessful
            </button>
          </div>
          <div style={{ fontSize: 11, color: C.textSecondary, marginTop: 8 }}>
            {contactMethod === "Attempt - No Contact"
              ? "Attempt - No Contact is always Unsuccessful (not billable)."
              : successful
                ? "Successful contacts count toward TCM billing floor (if method qualifies) and acuity-tier cadence."
                : "Unsuccessful attempts do not count toward billing. 3+ unsuccessful attempts with no success surface the member as UTR on the Registry."}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" disabled={saving} onClick={save}>
          {saving ? "Saving..." : "Log touchpoint"}
        </Btn>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// TouchpointAiPreview - preview strip shown inside LogTouchpointModal after
// the CM clicks "Polish with AI". Surfaces the AI's suggestions that don't
// map cleanly to form fields (action items, detected safety concerns, TCM
// countability rationale) so the CM sees everything the AI picked up on.
// v1: read-only. Action items displayed but not auto-converted to tasks;
// that's a future enhancement.
// ---------------------------------------------------------------------------
function TouchpointAiPreview({ aiResult, notesEdited }) {
  const actions    = Array.isArray(aiResult.action_items)     ? aiResult.action_items     : [];
  const concerns   = Array.isArray(aiResult.detected_concerns) ? aiResult.detected_concerns : [];
  const hrsnCount  = Array.isArray(aiResult.suggested_hrsn_domains) ? aiResult.suggested_hrsn_domains.length : 0;

  const dueLabel = (v) => {
    if (v === "today")      return "Today";
    if (v === "tomorrow")   return "Tomorrow";
    if (v === "this_week")  return "This week";
    if (v === "next_week")  return "Next week";
    return null;
  };

  return (
    <div style={{ marginTop: 10, padding: 12, background: "#fafafa", border: "0.5px solid " + C.borderLight, borderRadius: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary }}>
          AI polish applied
        </div>
        {notesEdited && (
          <Badge label="NOTES EDITED AFTER POLISH" variant="amber" size="xs" />
        )}
      </div>

      {/* Critical concerns block first - highest attention */}
      {concerns.length > 0 && (
        <div style={{ marginBottom: 10, padding: 10, background: C.redBg, border: "0.5px solid " + C.redBorder, borderRadius: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.red, marginBottom: 6 }}>
            Detected concerns - review before saving
          </div>
          {concerns.map((c, i) => (
            <div key={i} style={{ fontSize: 13, color: C.textPrimary, marginBottom: i < concerns.length - 1 ? 6 : 0 }}>
              <Badge label={String(c.type || "concern").replace(/_/g, " ").toUpperCase()} variant={c.severity === "critical" ? "red" : c.severity === "high" ? "red" : "amber"} size="xs" />
              <span style={{ marginLeft: 6 }}>{c.description}</span>
            </div>
          ))}
        </div>
      )}

      {/* TCM countability rationale */}
      {aiResult.counts_reasoning && (
        <div style={{ marginBottom: 10, fontSize: 12, color: C.textSecondary }}>
          <strong style={{ color: C.textPrimary }}>TCM count:</strong> {aiResult.suggested_counts_toward_tcm_contact ? "Yes" : "No"} - {aiResult.counts_reasoning}
        </div>
      )}

      {/* Activity category suggestion rationale */}
      {aiResult.activity_category_rationale && aiResult.suggested_activity_category_code && (
        <div style={{ marginBottom: 10, fontSize: 12, color: C.textSecondary }}>
          <strong style={{ color: C.textPrimary }}>Category rationale:</strong> {aiResult.activity_category_rationale}
        </div>
      )}

      {/* HRSN domains addressed */}
      {hrsnCount > 0 && (
        <div style={{ marginBottom: 10, fontSize: 12, color: C.textSecondary }}>
          <strong style={{ color: C.textPrimary }}>HRSN domains detected:</strong> {aiResult.suggested_hrsn_domains.join(", ")}
        </div>
      )}

      {/* Action items */}
      {actions.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 6 }}>
            Extracted action items ({actions.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {actions.map((a, i) => (
              <div key={i} style={{ fontSize: 12, padding: "6px 10px", background: C.bgPrimary, border: "0.5px solid " + C.borderLight, borderRadius: 6 }}>
                <div style={{ color: C.textPrimary }}>{a.description}</div>
                <div style={{ fontSize: 10, color: C.textTertiary, marginTop: 2, display: "flex", gap: 8 }}>
                  {dueLabel(a.suggested_due) && <span>Due: {dueLabel(a.suggested_due)}</span>}
                  {a.suggested_owner && <span>Owner: {String(a.suggested_owner).replace(/_/g, " ")}</span>}
                </div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 10, color: C.textTertiary, marginTop: 6, fontStyle: "italic" }}>
            Action items shown for reference. Auto-converting to tasks is a future enhancement.
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TouchpointDetailModal - read-only view of a single touchpoint.
// Kept minimal for v1. If future needs require editable touchpoints
// (e.g. addendum/correction workflows), build as a separate modal with a
// clear audit trail rather than mutating in place.
// ---------------------------------------------------------------------------
