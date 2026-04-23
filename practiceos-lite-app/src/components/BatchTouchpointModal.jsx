import { useState, useEffect, useMemo } from "react";
import { supabase } from "../lib/supabaseClient";
import { C } from "../lib/tokens";
import { Btn, Modal, Loader, ErrorBanner, FL } from "./ui";

// ---------------------------------------------------------------------------
// BatchTouchpointModal
//
// Logs a single outreach activity across N selected members in one save.
// Optimized for common CM workflows:
//   - Outreach sweep ("I called 8 High-acuity members this afternoon")
//   - Group session ("I ran a diabetes education session for 10 members")
//   - Weekly check-in batch ("I sent secure messages to 12 members")
//
// Design choices:
//   - Shared mode only (no per-member tabs). If a touchpoint needs materially
//     different fields per member, user logs individually.
//   - Shared: date/time, contact method, activity, HRSN domains, notes
//   - Per-member override: outcome (Successful / Unsuccessful) + optional note
//   - Default outcome set at top; applied to all selected on selection change
//   - source='Manual-Batch' so analytics can segment batch-logged entries
//
// UTR (Unable to Reach) is NOT a button here. UTR is derived from touchpoint
// history via cm_enrollment_utr_status view - once a member accumulates 3
// unsuccessful touchpoints since their last success, they surface as UTR on
// the Registry. Batch logging just produces touchpoints; UTR emerges from them.
//
// Access: same as individual LogTouchpointModal. CHW allowed.
// ---------------------------------------------------------------------------

const CONTACT_METHODS = [
  "In Person",
  "Telephonic",
  "Video",
  "Secure Message",
  "Letter",
  "Email",
  "Attempt - No Contact",
];

const TCM_QUALIFYING_METHODS = new Set(["In Person", "Telephonic", "Video"]);

const HOP_DOMAINS = [
  { code: "food_insecurity",     label: "Food insecurity" },
  { code: "housing_instability", label: "Housing instability" },
  { code: "housing_quality",     label: "Housing quality" },
  { code: "transportation",      label: "Transportation" },
  { code: "utilities",           label: "Utilities" },
  { code: "interpersonal_safety", label: "Interpersonal safety" },
];

export default function BatchTouchpointModal({ practiceId, userId, userRole, onClose, onLogged }) {
  // Data loaded on mount
  const [enrollments, setEnrollments]     = useState([]);
  const [activityCodes, setActivityCodes] = useState([]);
  const [loading, setLoading]             = useState(true);

  // Filter + selection state
  const [search, setSearch]               = useState("");
  const [programFilter, setProgramFilter] = useState("all");
  const [selectedIds, setSelectedIds]     = useState(() => new Set());

  // Shared touchpoint details
  const [touchpointAt, setTouchpointAt] = useState(() => {
    const d = new Date();
    const pad = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate())
      + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  });
  const [contactMethod, setContactMethod] = useState("Telephonic");
  const [activityCode, setActivityCode]   = useState("");
  const [selectedHrsn, setSelectedHrsn]   = useState([]);
  const [sharedNotes, setSharedNotes]     = useState("");
  const [defaultOutcome, setDefaultOutcome] = useState("successful"); // "successful" | "unsuccessful"

  // Per-member overrides: { [enrollmentId]: { outcome, note } }
  const [perMember, setPerMember] = useState({});

  // Save state
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);
  const [results, setResults] = useState(null); // { ok: n, failed: [{name, error}] }

  // Load enrollments + activity codes in parallel
  useEffect(() => {
    if (!practiceId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      supabase
        .from("cm_enrollments")
        .select("id, patient_id, program_type, acuity_tier, enrollment_status, patients(first_name, last_name, mrn)")
        .eq("practice_id", practiceId)
        .in("enrollment_status", ["Active", "Pending"])
        .order("enrollment_status", { ascending: true }),
      supabase
        .from("cm_reference_codes")
        .select("code, label, metadata, sort_order")
        .eq("category", "activity_category")
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
    ]).then(([eRes, acRes]) => {
      if (cancelled) return;
      setEnrollments(eRes.data || []);
      setActivityCodes(acRes.data || []);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [practiceId]);

  // Filtered list for the picker
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enrollments.filter(e => {
      if (programFilter !== "all" && e.program_type !== programFilter) return false;
      if (q) {
        const name = ((e.patients?.first_name || "") + " " + (e.patients?.last_name || "")).toLowerCase();
        const mrn  = (e.patients?.mrn || "").toLowerCase();
        if (!name.includes(q) && !mrn.includes(q)) return false;
      }
      return true;
    });
  }, [enrollments, search, programFilter]);

  // Selected enrollments as objects (for the per-member override section)
  const selectedEnrollments = useMemo(
    () => enrollments.filter(e => selectedIds.has(e.id)),
    [enrollments, selectedIds]
  );

  // When default outcome changes, reset all per-member outcomes to the new default.
  // Preserves any per-member notes the user already typed.
  useEffect(() => {
    setPerMember(prev => {
      const next = { ...prev };
      for (const e of selectedEnrollments) {
        next[e.id] = { outcome: defaultOutcome, note: next[e.id]?.note || "" };
      }
      return next;
    });
  }, [defaultOutcome, selectedEnrollments.length]); // length, not array itself, to avoid loops

  // When a member is newly selected, seed their per-member entry with the default outcome
  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        setPerMember(pm => ({ ...pm, [id]: { outcome: defaultOutcome, note: pm[id]?.note || "" } }));
      }
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      for (const e of filtered) next.add(e.id);
      return next;
    });
    setPerMember(pm => {
      const next = { ...pm };
      for (const e of filtered) {
        if (!next[e.id]) next[e.id] = { outcome: defaultOutcome, note: "" };
      }
      return next;
    });
  };

  const clearAll = () => {
    setSelectedIds(new Set());
  };

  const toggleHrsn = (code) => {
    setSelectedHrsn(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]);
  };

  const setMemberOutcome = (id, outcome) => {
    setPerMember(pm => ({ ...pm, [id]: { ...pm[id], outcome } }));
  };

  const setMemberNote = (id, note) => {
    setPerMember(pm => ({ ...pm, [id]: { ...pm[id], note } }));
  };

  // Group activity codes the same way LogTouchpointModal does
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

  const save = async () => {
    if (selectedIds.size === 0) { setError("Select at least one member"); return; }
    if (!touchpointAt)    { setError("Set the contact date/time"); return; }
    if (!contactMethod)   { setError("Pick a contact method"); return; }
    if (!activityCode)    { setError("Pick an activity category"); return; }

    const when = new Date(touchpointAt);
    if (when.getTime() > Date.now()) { setError("Touchpoints cannot be dated in the future"); return; }

    setSaving(true);
    setError(null);

    // Role mapping matches LogTouchpointModal
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

    // Build one insert payload per selected enrollment
    const rows = selectedEnrollments.map(enr => {
      const pm = perMember[enr.id] || { outcome: defaultOutcome, note: "" };
      const isSuccessful = pm.outcome === "successful";
      // Countability: must be successful AND a qualifying method
      const countsTowardTcm = isSuccessful && TCM_QUALIFYING_METHODS.has(contactMethod);

      // Compose notes: shared + per-member, separated by newline if both
      const combinedNotes = [sharedNotes.trim(), (pm.note || "").trim()]
        .filter(Boolean)
        .join("\n")
        .slice(0, 500) || null;

      return {
        enrollment_id: enr.id,
        patient_id:    enr.patient_id,
        practice_id:   practiceId,
        delivered_by_user_id:      userId,
        touchpoint_at:             when.toISOString(),
        contact_method:            contactMethod,
        successful_contact:        isSuccessful,
        counts_toward_tcm_contact: countsTowardTcm,
        delivered_by_role:         deliveredByRole,
        activity_category_code:    activityCode,
        hrsn_domains_addressed:    selectedHrsn,
        notes:                     combinedNotes,
        source:                    "Manual-Batch",
      };
    });

    // Use allSettled so one bad row doesn't block others. Report summary.
    const outcomes = await Promise.allSettled(
      rows.map(r => supabase.from("cm_touchpoints").insert(r))
    );

    let okCount = 0;
    const failed = [];
    outcomes.forEach((result, i) => {
      const enr = selectedEnrollments[i];
      const name = (enr?.patients?.last_name || "") + ", " + (enr?.patients?.first_name || "");
      if (result.status === "fulfilled" && !result.value.error) {
        okCount++;
      } else {
        const msg = result.status === "rejected"
          ? (result.reason?.message || String(result.reason))
          : (result.value?.error?.message || "Insert failed");
        failed.push({ name: name.trim() || enr?.id || "unknown", error: msg });
      }
    });

    setResults({ ok: okCount, failed });
    setSaving(false);

    // If all succeeded, close immediately and refresh
    if (failed.length === 0) {
      onLogged();
    }
    // Otherwise leave modal open so user sees which ones failed
  };

  if (loading) {
    return (
      <Modal title="Batch log touchpoints" onClose={onClose} width={900}>
        <Loader label="Loading caseload..." />
      </Modal>
    );
  }

  // Partial-failure view after save
  if (results && results.failed.length > 0) {
    return (
      <Modal title="Batch save: partial failure" onClose={onClose} width={640}>
        <div style={{ padding: 12, marginBottom: 16, background: C.amberBg, border: "0.5px solid " + C.amberBorder, borderRadius: 8 }}>
          <div style={{ fontSize: 13, color: C.textPrimary, marginBottom: 4 }}>
            <strong>{results.ok}</strong> touchpoint{results.ok === 1 ? "" : "s"} logged successfully.
          </div>
          <div style={{ fontSize: 13, color: C.red }}>
            <strong>{results.failed.length}</strong> failed:
          </div>
        </div>
        <div style={{ border: "0.5px solid " + C.borderLight, borderRadius: 8, maxHeight: 280, overflow: "auto" }}>
          {results.failed.map((f, i) => (
            <div key={i} style={{
              padding: "8px 12px",
              borderBottom: i < results.failed.length - 1 ? "0.5px solid " + C.borderLight : "none",
              fontSize: 12,
            }}>
              <div style={{ fontWeight: 600, color: C.textPrimary }}>{f.name}</div>
              <div style={{ color: C.red, marginTop: 2 }}>{f.error}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <Btn variant="primary" onClick={onLogged}>Done</Btn>
        </div>
      </Modal>
    );
  }

  const allFilteredSelected = filtered.length > 0 && filtered.every(e => selectedIds.has(e.id));

  return (
    <Modal title={"Batch log touchpoints" + (selectedIds.size > 0 ? " (" + selectedIds.size + " selected)" : "")} onClose={onClose} width={900}>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {/* Section 1: Member picker */}
      <SectionHeader n={1} title="Members" />
      <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or MRN..."
          style={{ ...inputStyle, flex: "1 1 220px", minWidth: 220, width: "auto" }}
        />
        <select value={programFilter} onChange={e => setProgramFilter(e.target.value)} style={{ ...selectStyle, width: "auto", minWidth: 150 }}>
          <option value="all">All programs</option>
          <option value="TCM">TCM</option>
          <option value="AMH">AMH</option>
          <option value="AMH Plus">AMH Plus</option>
          <option value="AMH Tier 3">AMH Tier 3</option>
          <option value="CMA">CMA</option>
          <option value="CIN CM">CIN CM</option>
          <option value="General Engagement">General Engagement</option>
        </select>
        <Btn size="sm" variant="outline" onClick={allFilteredSelected ? clearAll : selectAllFiltered}>
          {allFilteredSelected ? "Clear all" : ("Select all " + filtered.length)}
        </Btn>
      </div>
      <div style={{
        border: "0.5px solid " + C.borderLight,
        borderRadius: 8,
        maxHeight: 220,
        overflow: "auto",
        marginBottom: 20,
      }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 20, textAlign: "center", fontSize: 12, color: C.textTertiary }}>
            {enrollments.length === 0
              ? "No Active or Pending enrollments in this practice."
              : "No members match the current search/filter."}
          </div>
        ) : filtered.map((e, i) => {
          const selected = selectedIds.has(e.id);
          return (
            <label key={e.id} style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 12px",
              borderBottom: i < filtered.length - 1 ? "0.5px solid " + C.borderLight : "none",
              background: selected ? C.tealBg : "transparent",
              cursor: "pointer",
            }}>
              <input type="checkbox" checked={selected} onChange={() => toggleSelect(e.id)} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>
                  {(e.patients?.last_name || "") + ", " + (e.patients?.first_name || "")}
                  <span style={{ fontSize: 11, color: C.textTertiary, fontFamily: "monospace", marginLeft: 8, fontWeight: 400 }}>
                    {e.patients?.mrn || ""}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: C.textSecondary, marginTop: 1 }}>
                  {e.program_type}{e.acuity_tier ? " / " + e.acuity_tier : ""} - {e.enrollment_status}
                </div>
              </div>
            </label>
          );
        })}
      </div>

      {/* Section 2: Shared details */}
      <SectionHeader n={2} title="Shared details" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
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
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <FL>HRSN domains (optional)</FL>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {HOP_DOMAINS.map(d => {
              const on = selectedHrsn.includes(d.code);
              return (
                <button key={d.code} type="button" onClick={() => toggleHrsn(d.code)} style={{
                  padding: "5px 12px",
                  fontSize: 12,
                  fontWeight: 600,
                  fontFamily: "inherit",
                  border: "0.5px solid " + (on ? C.teal : C.borderLight),
                  background: on ? C.tealBg : C.bgPrimary,
                  color: on ? C.teal : C.textSecondary,
                  borderRadius: 16,
                  cursor: "pointer",
                }}>
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <FL>Shared notes (optional, applies to all)</FL>
          <textarea
            value={sharedNotes}
            onChange={e => setSharedNotes(e.target.value.slice(0, 300))}
            rows={2}
            placeholder="Notes added to every touchpoint in this batch..."
            style={{ ...inputStyle, resize: "vertical" }}
          />
          <div style={{ fontSize: 10, color: C.textTertiary, marginTop: 2, textAlign: "right" }}>
            {sharedNotes.length}/300
          </div>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <FL>Default outcome</FL>
          <div style={{ display: "flex", gap: 8 }}>
            <OutcomeBtn active={defaultOutcome === "successful"} onClick={() => setDefaultOutcome("successful")} tone="green">
              Successful
            </OutcomeBtn>
            <OutcomeBtn active={defaultOutcome === "unsuccessful"} onClick={() => setDefaultOutcome("unsuccessful")} tone="amber">
              Unsuccessful
            </OutcomeBtn>
          </div>
          <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 4 }}>
            Applied to all selected below. Override per member as needed.
            After 3 unsuccessful attempts with no success, the member surfaces as UTR on the Registry.
          </div>
        </div>
      </div>

      {/* Section 3: Per-member outcomes */}
      {selectedEnrollments.length > 0 && (
        <>
          <SectionHeader n={3} title={"Per-member outcomes (" + selectedEnrollments.length + ")"} />
          <div style={{
            border: "0.5px solid " + C.borderLight,
            borderRadius: 8,
            maxHeight: 280,
            overflow: "auto",
            marginBottom: 16,
          }}>
            {selectedEnrollments.map((e, i) => {
              const pm = perMember[e.id] || { outcome: defaultOutcome, note: "" };
              return (
                <div key={e.id} style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 12px",
                  borderBottom: i < selectedEnrollments.length - 1 ? "0.5px solid " + C.borderLight : "none",
                }}>
                  <div style={{ flex: "0 0 200px", minWidth: 200 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.textPrimary }}>
                      {(e.patients?.last_name || "") + ", " + (e.patients?.first_name || "")}
                    </div>
                    <div style={{ fontSize: 10, color: C.textTertiary }}>
                      {e.program_type}{e.acuity_tier ? " / " + e.acuity_tier : ""}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <OutcomeBtn small active={pm.outcome === "successful"} onClick={() => setMemberOutcome(e.id, "successful")} tone="green">
                      Success
                    </OutcomeBtn>
                    <OutcomeBtn small active={pm.outcome === "unsuccessful"} onClick={() => setMemberOutcome(e.id, "unsuccessful")} tone="amber">
                      Unsuccessful
                    </OutcomeBtn>
                  </div>
                  <input
                    type="text"
                    value={pm.note || ""}
                    onChange={ev => setMemberNote(e.id, ev.target.value.slice(0, 200))}
                    placeholder="Optional per-member note..."
                    style={{ ...inputStyle, flex: 1, fontSize: 12, padding: "6px 10px" }}
                  />
                  <Btn size="sm" variant="ghost" onClick={() => toggleSelect(e.id)}>Remove</Btn>
                </div>
              );
            })}
          </div>
        </>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 12, borderTop: "0.5px solid " + C.borderLight }}>
        <div style={{ fontSize: 12, color: C.textTertiary }}>
          Logged as {userRole || "staff"}. Source: Manual-Batch.
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn variant="ghost" onClick={onClose} disabled={saving}>Cancel</Btn>
          <Btn variant="primary" onClick={save} disabled={saving || selectedIds.size === 0}>
            {saving
              ? ("Logging " + selectedIds.size + "...")
              : ("Log " + selectedIds.size + " touchpoint" + (selectedIds.size === 1 ? "" : "s"))}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

// Small local helpers -----------------------------------------------------

function SectionHeader({ n, title }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      marginBottom: 8,
      marginTop: 4,
    }}>
      <div style={{
        width: 20, height: 20, borderRadius: 10,
        background: C.teal, color: "#ffffff",
        fontSize: 11, fontWeight: 700,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>{n}</div>
      <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary }}>
        {title}
      </div>
    </div>
  );
}

function OutcomeBtn({ active, tone, onClick, small, children }) {
  const palette = tone === "green"
    ? { on: "#047857", onBg: "#ecfdf5", border: "#86efac" }
    : { on: "#b45309", onBg: "#fffbeb", border: "#fcd34d" };
  return (
    <button type="button" onClick={onClick} style={{
      padding: small ? "4px 10px" : "7px 14px",
      fontSize: small ? 11 : 12,
      fontWeight: 600,
      fontFamily: "inherit",
      border: "0.5px solid " + (active ? palette.border : C.borderLight),
      background: active ? palette.onBg : C.bgPrimary,
      color: active ? palette.on : C.textSecondary,
      borderRadius: 6,
      cursor: "pointer",
    }}>
      {children}
    </button>
  );
}

const inputStyle = {
  width: "100%",
  padding: "9px 12px",
  border: "1px solid " + C.borderMid,
  borderRadius: 8,
  fontSize: 13,
  fontFamily: "inherit",
  outline: "none",
  color: C.textPrimary,
  background: C.bgPrimary,
  boxSizing: "border-box",
  resize: "vertical",
};

const selectStyle = {
  ...inputStyle,
  WebkitAppearance: "none",
  paddingRight: 32,
};
