import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../auth/AuthProvider";
import { C } from "../lib/tokens";
import {
  Badge, Btn, Card, Modal, Loader, EmptyState, ErrorBanner,
  SectionHead, FL, TabBar
} from "../components/ui";
import { normalizeGoals, goalText, blankGoal, isBlankGoal } from "../lib/cmGoals";
import { GoalEditor, GoalDisplay } from "../components/GoalEditor";
import BatchTouchpointModal from "../components/BatchTouchpointModal";
import CHWTab from "./CHWTab";
import PRLTab from "./care-management/PRLTab";
import RegistryTab from "./care-management/RegistryTab";
import {
  KpiCard, StatusBadge, AcuityBadge, PlanStatusBadge,
  ClaimStatusBadge, VerificationBadge, FilterPill,
  Th, Td, DetailField,
  inputStyle, selectStyle
} from "./care-management/shared";

// ===============================================================================
// CareManagementView - entry point for the Care Management Console (Command tier)
//
// Six tabs:
//   1. Registry            - enrollments list, acuity filter, program breakdown
//   2. Touchpoints         - contact log, role-aware activity filter
//   3. Plans               - care plans with AI-draft review gate indicator
//   4. Billing Readiness   - monthly billing_periods with readiness status
//   5. CHW Coordination    - CHW-to-CM assignments, FTE gauge
//   6. PRL                 - inbound reconciliation queue + outbound builder
//
// THIS FILE ships the shell + fully-wired PRL tab. Other 5 tabs are stubs
// with "Coming next session" content - schema is ready, UX needs design pass.
// ===============================================================================

const TAB_KEYS = ["registry", "touchpoints", "plans", "billing", "chw", "prl"];
const TAB_META = {
  registry:    { label: "Registry",           icon: "\u25A3" },
  touchpoints: { label: "Touchpoints",        icon: "\u25C9" },
  plans:       { label: "Plans",              icon: "\u25A4" },
  billing:     { label: "Billing Readiness",  icon: "\u25A5" },
  chw:         { label: "CHW Coordination",   icon: "\u25C8" },
  prl:         { label: "PRL",                icon: "\u25A6" },
};

const CM_ROLES = new Set([
  "Owner",
  "Manager",
  "Care Manager",
  "Supervising Care Manager",
  "Care Manager Supervisor",
]);

// Admin-only tabs (PRL). Clinical roles (CM, Supervising CM, CHW) don't see
// PRL - it's the health-plan roster exchange and is an administrative/billing
// function, not clinical care work. Owners and Managers can grant a user
// "Manager" role if they need PRL access.
const ADMIN_ROLES = new Set(["Owner", "Manager"]);

export default function CareManagementView() {
  const { profile } = useAuth();
  const role = profile?.role;
  const canAccess = role && (CM_ROLES.has(role) || role === "CHW");
  const isAdmin = role && ADMIN_ROLES.has(role);
  const [tab, setTab] = useState("registry"); // Default to Registry; PRL is admin-only

  // Role-based tab visibility. Computed unconditionally (no hooks below this
  // point can be skipped by the early-return below).
  //   CHW:                              Registry + Touchpoints + CHW
  //   Clinical (CM / Supervising CM):   all clinical tabs, no PRL
  //   Admin (Owner / Manager):          all tabs including PRL
  const visibleTabs = role === "CHW"
    ? ["registry", "touchpoints", "chw"]
    : isAdmin
      ? TAB_KEYS
      : ["registry", "touchpoints", "plans", "billing", "chw"];

  // Keep tab valid for role. MUST run before any conditional return below,
  // or React's hook-ordering check will fire error #310 when auth loads
  // asynchronously (first render no role -> early return -> fewer hooks;
  // next render role loads -> more hooks -> crash).
  useEffect(() => {
    if (!visibleTabs.includes(tab)) setTab(visibleTabs[0]);
  }, [role]); // eslint-disable-line react-hooks/exhaustive-deps

  // Unauthorized roles see a polite block instead of the console
  if (!canAccess) {
    return (
      <div style={{ padding: 32 }}>
        <SectionHead title="Care Management" />
        <Card style={{ marginTop: 16, padding: 24, textAlign: "center" }}>
          <div style={{ fontSize: 15, color: C.textSecondary, marginBottom: 8 }}>
            The Care Management Console is available to Care Managers, Supervising Care Managers, CHWs, Owners, and Managers.
          </div>
          <div style={{ fontSize: 13, color: C.textTertiary }}>
            Current role: {role || "Unknown"}. Contact your practice owner if you believe this is incorrect.
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ padding: "16px 24px 0", borderBottom: "0.5px solid " + C.borderLight, background: C.bgPrimary }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: C.textPrimary, letterSpacing: "-0.01em" }}>
              Care Management
            </div>
            <div style={{ fontSize: 13, color: C.textSecondary, marginTop: 2 }}>
              {role === "CHW"
                ? "Your directed caseload and engagement touchpoints"
                : "Enrollments, touchpoints, plans, billing readiness, and PRL exchange"}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {visibleTabs.map(k => (
            <TabButton key={k} active={tab === k} onClick={() => setTab(k)}>
              <span style={{ marginRight: 6, opacity: 0.7 }}>{TAB_META[k].icon}</span>
              {TAB_META[k].label}
            </TabButton>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 24, background: C.bgTertiary }}>
        {tab === "registry"    && <RegistryTab />}
        {tab === "touchpoints" && <TouchpointsTab />}
        {tab === "plans"       && <PlansTab practiceId={profile?.practice_id} profile={profile} />}
        {tab === "billing"     && <BillingTab practiceId={profile?.practice_id} profile={profile} />}
        {tab === "chw"         && <CHWTab practiceId={profile?.practice_id} profile={profile} />}
        {tab === "prl"         && <PRLTab />}
      </div>
    </div>
  );
}

// --- Local Tab Button ---------------------------------------------------------
function TabButton({ active, children, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "10px 16px",
        fontSize: 13,
        fontWeight: 600,
        fontFamily: "inherit",
        border: "none",
        cursor: "pointer",
        background: "transparent",
        color: active ? C.teal : C.textSecondary,
        borderBottom: active ? "2px solid " + C.teal : "2px solid transparent",
        marginBottom: -1,
        transition: "color 0.15s, border-color 0.15s",
      }}
    >
      {children}
    </button>
  );
}

function TouchpointsTab() {
  const { profile } = useAuth();
  const practiceId = profile?.practice_id;
  const role       = profile?.role;
  const isCHW      = role === "CHW";

  const [loading, setLoading]               = useState(true);
  const [error, setError]                   = useState(null);
  const [touchpoints, setTouchpoints]       = useState([]);
  const [selectedTp, setSelectedTp]         = useState(null);
  const [showLogModal, setShowLogModal]     = useState(false);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [careManagers, setCareManagers]     = useState([]);

  // Filter state
  const [dateRange, setDateRange]           = useState("30d");
  const [patientFilter, setPatientFilter]   = useState("");
  const [cmFilter, setCmFilter]             = useState("all");
  const [programFilter, setProgramFilter]   = useState("all");
  const [successfulOnly, setSuccessfulOnly] = useState(false);

  const load = useCallback(async () => {
    if (!practiceId) return;
    setLoading(true);
    setError(null);
    try {
      // Compute cutoff timestamp for date filter
      let cutoffIso = null;
      const now = new Date();
      if (dateRange === "7d") {
        cutoffIso = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      } else if (dateRange === "30d") {
        cutoffIso = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      } else if (dateRange === "month") {
        cutoffIso = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
      }

      // Single query with embeds: cm_enrollments for program/acuity,
      // patients for name. logged_by_user is pulled separately to avoid
      // RLS issues on the users table cross-scope.
      let query = supabase
        .from("cm_touchpoints")
        .select("id, touchpoint_at, contact_method, successful_contact, delivered_by_role, activity_category_code, notes, enrollment_id, patient_id, delivered_by_user_id, hrsn_domains_addressed, counts_toward_tcm_contact, ai_scribe_model, cm_enrollments(program_type, acuity_tier), patients(first_name, last_name)")
        .eq("practice_id", practiceId)
        .order("touchpoint_at", { ascending: false })
        .limit(200);

      if (cutoffIso)          query = query.gte("touchpoint_at", cutoffIso);
      if (cmFilter !== "all") query = query.eq("delivered_by_user_id", cmFilter);
      if (successfulOnly)     query = query.eq("successful_contact", true);
      // CHW can only see their own touchpoints
      if (isCHW && profile?.id) query = query.eq("delivered_by_user_id", profile.id);

      const { data, error: qErr } = await query;
      if (qErr) throw qErr;

      // Client-side filter for patient name (cannot filter on embedded field server-side cleanly)
      let filtered = data || [];
      if (patientFilter.trim()) {
        const q = patientFilter.trim().toLowerCase();
        filtered = filtered.filter(t => {
          const name = ((t.patients?.first_name || "") + " " + (t.patients?.last_name || "")).toLowerCase();
          return name.includes(q);
        });
      }
      if (programFilter !== "all") {
        filtered = filtered.filter(t => t.cm_enrollments?.program_type === programFilter);
      }

      setTouchpoints(filtered);
    } catch (e) {
      setError(e.message || "Failed to load touchpoints");
    } finally {
      setLoading(false);
    }
  }, [practiceId, isCHW, profile?.id, dateRange, cmFilter, successfulOnly, patientFilter, programFilter]);

  useEffect(() => { load(); }, [load]);

  // Load care managers list for filter dropdown (hidden for CHW)
  useEffect(() => {
    if (!practiceId || isCHW) return;
    supabase
      .from("users")
      .select("id, full_name, role")
      .eq("practice_id", practiceId)
      .in("role", ["Care Manager", "Supervising Care Manager", "Care Manager Supervisor", "CHW"])
      .order("full_name", { ascending: true })
      .then(({ data }) => setCareManagers(data || []));
  }, [practiceId, isCHW]);

  // KPIs computed over the currently loaded/filtered set
  const kpis = useMemo(() => {
    const successful = touchpoints.filter(t => t.successful_contact);
    const uniquePatients = new Set(successful.map(t => t.patient_id));
    return {
      total:      touchpoints.length,
      successful: successful.length,
      attempts:   touchpoints.length - successful.length,
      patients:   uniquePatients.size,
    };
  }, [touchpoints]);

  if (loading && touchpoints.length === 0) return <Loader label="Loading touchpoints..." />;

  return (
    <div>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
        <KpiCard label="Touchpoints shown" value={kpis.total}      hint="Matching current filters" />
        <KpiCard label="Successful"        value={kpis.successful} hint="Qualifying contacts"    variant="blue" />
        <KpiCard label="Attempts only"     value={kpis.attempts}   hint="No-contact attempts"    variant={kpis.attempts > 0 ? "amber" : "neutral"} />
        <KpiCard label="Unique patients"   value={kpis.patients}   hint="Patients touched"       />
      </div>

      {/* Filter bar */}
      <Card style={{ padding: 12, marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textTertiary }}>Period</span>
            {DATE_RANGE_PRESETS.map(p => (
              <FilterPill key={p.key} active={dateRange === p.key} onClick={() => setDateRange(p.key)}>{p.label}</FilterPill>
            ))}
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <Btn variant="outline" size="md" onClick={() => setShowBatchModal(true)}>
              + Batch log
            </Btn>
            <Btn variant="primary" size="md" onClick={() => setShowLogModal(true)}>
              + Log touchpoint
            </Btn>
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 220px", minWidth: 220 }}>
            <input
              type="text"
              value={patientFilter}
              onChange={e => setPatientFilter(e.target.value)}
              placeholder="Search by patient name..."
              style={{ ...inputStyle, width: "100%" }}
            />
          </div>
          {!isCHW && (
            <select value={cmFilter} onChange={e => setCmFilter(e.target.value)} style={{ ...selectStyle, width: "auto", minWidth: 180 }}>
              <option value="all">All team members</option>
              {careManagers.map(cm => (
                <option key={cm.id} value={cm.id}>{cm.full_name} ({cm.role})</option>
              ))}
            </select>
          )}
          <select value={programFilter} onChange={e => setProgramFilter(e.target.value)} style={{ ...selectStyle, width: "auto", minWidth: 150 }}>
            <option value="all">All programs</option>
            <option value="TCM">TCM</option>
            <option value="AMH Plus">AMH Plus</option>
            <option value="AMH Tier 3">AMH Tier 3</option>
            <option value="CMA">CMA</option>
            <option value="CIN CM">CIN CM</option>
            <option value="General Engagement">General Engagement</option>
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.textSecondary, cursor: "pointer" }}>
            <input type="checkbox" checked={successfulOnly} onChange={e => setSuccessfulOnly(e.target.checked)} />
            Successful only
          </label>
          <Btn variant="outline" size="sm" onClick={load}>Refresh</Btn>
        </div>
      </Card>

      {/* Touchpoints table */}
      {touchpoints.length === 0 ? (
        <EmptyState
          title="No touchpoints found"
          message={isCHW
            ? "You have not logged any touchpoints in this period yet. Use + Log touchpoint to record your first contact."
            : "No touchpoints match the current filters. Try a wider date range, or relax the filters above."}
        />
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead style={{ background: C.bgSecondary, borderBottom: "0.5px solid " + C.borderLight }}>
              <tr>
                <Th>Date/Time</Th>
                <Th>Patient</Th>
                <Th>Program</Th>
                <Th>Method</Th>
                <Th>Activity</Th>
                <Th>Role</Th>
                <Th>Outcome</Th>
              </tr>
            </thead>
            <tbody>
              {touchpoints.map((tp, idx) => (
                <tr
                  key={tp.id}
                  onClick={() => setSelectedTp(tp)}
                  style={{
                    borderBottom: idx < touchpoints.length - 1 ? "0.5px solid " + C.borderLight : "none",
                    cursor: "pointer",
                    background: selectedTp?.id === tp.id ? C.tealBg : "transparent",
                  }}
                >
                  <Td style={{ fontSize: 12 }}>{formatTouchpointTime(tp.touchpoint_at)}</Td>
                  <Td>
                    <div style={{ fontWeight: 600 }}>
                      {(tp.patients?.last_name || "") + ", " + (tp.patients?.first_name || "")}
                    </div>
                  </Td>
                  <Td style={{ fontSize: 12 }}>{tp.cm_enrollments?.program_type || "-"}</Td>
                  <Td><Badge label={tp.contact_method} variant="teal" size="xs" /></Td>
                  <Td style={{ fontSize: 12, color: C.textSecondary }}>
                    {tp.activity_category_code || "-"}
                  </Td>
                  <Td><Badge label={tp.delivered_by_role || "-"} variant="purple" size="xs" /></Td>
                  <Td>
                    {tp.successful_contact
                      ? <Badge label="Successful" variant="green" size="xs" />
                      : <Badge label="Attempt" variant="amber" size="xs" />}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {selectedTp && (
        <TouchpointDetailModal touchpoint={selectedTp} onClose={() => setSelectedTp(null)} />
      )}
      {showLogModal && (
        <LogTouchpointModal
          practiceId={practiceId}
          userId={profile?.id}
          userRole={role}
          onClose={() => setShowLogModal(false)}
          onLogged={() => { setShowLogModal(false); load(); }}
        />
      )}
      {showBatchModal && (
        <BatchTouchpointModal
          practiceId={practiceId}
          userId={profile?.id}
          userRole={role}
          onClose={() => setShowBatchModal(false)}
          onLogged={() => { setShowBatchModal(false); load(); }}
        />
      )}
    </div>
  );
}

// Formatting helper: if touchpoint is today, show time only; else show date.
function formatTouchpointTime(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return "Today " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// ---------------------------------------------------------------------------
// LogTouchpointModal - the "Log touchpoint" form.
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
// ---------------------------------------------------------------------------

function LogTouchpointModal({ practiceId, userId, userRole, onClose, onLogged }) {
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

function TouchpointDetailModal({ touchpoint, onClose }) {
  const tp = touchpoint;
  const patientName = (tp.patients?.first_name || "") + " " + (tp.patients?.last_name || "");

  return (
    <Modal title={"Touchpoint: " + patientName} onClose={onClose} width={600}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, marginBottom: 16 }}>
        <DetailField label="When"     value={new Date(tp.touchpoint_at).toLocaleString()} />
        <DetailField label="Outcome"  value={tp.successful_contact ? "Successful contact" : "Attempt only"} />
        <DetailField label="Method"   value={<Badge label={tp.contact_method} variant="teal" size="xs" />} />
        <DetailField label="Role"     value={<Badge label={tp.delivered_by_role} variant="purple" size="xs" />} />
        <DetailField label="Program"  value={tp.cm_enrollments?.program_type || "-"} />
        <DetailField label="Acuity"   value={<AcuityBadge tier={tp.cm_enrollments?.acuity_tier} />} />
        <DetailField label="Activity" value={tp.activity_category_code || "-"} />
      </div>

      {tp.notes && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textTertiary, marginBottom: 6 }}>Notes</div>
          <div style={{ padding: 12, background: C.bgSecondary, border: "0.5px solid " + C.borderLight, borderRadius: 8, fontSize: 13, color: C.textPrimary, whiteSpace: "pre-wrap" }}>
            {tp.notes}
          </div>
        </div>
      )}

      <div style={{ marginTop: 16, fontSize: 11, color: C.textTertiary, fontStyle: "italic" }}>
        Touchpoints are append-only. To correct this record, log a new touchpoint referencing this one in notes.
      </div>
    </Modal>
  );
}
// ===============================================================================
// Plans tab
// ===============================================================================
//
// Manages cm_care_plans - formal care plans linked to enrollments. Five plan
// types per cm_plan_type enum:
//   - Care Plan (generic TCM)
//   - Individual Support Plan (IDD populations)
//   - AMH Tier 3 Care Plan (Standard Plan)
//   - Comprehensive Assessment (intake-era)
//   - 90-Day Transition Plan (institutional discharge)
//
// Plans have status (Draft/Active/Archived/Superseded) and track review cadence
// via next_review_due. "Overdue review" = status='Active' AND next_review_due is
// in the past.
//
// v1 scope: list + create + detail. NOT in v1:
//   - Structured goals editor (goals kept as free-text JSONB array)
//   - Member acknowledgment workflow
//   - Document generation (PDF export)
//   - AI draft assistance (schema-level AI review gate is ready but UI is not)
//   - Automated review reminders
// ===============================================================================

function PlansTab({ practiceId, profile }) {
  const [plans, setPlans]                 = useState([]);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState(null);
  const [statusFilter, setStatusFilter]   = useState("all");
  const [planTypeFilter, setPlanTypeFilter] = useState("all");
  const [selected, setSelected]           = useState(null);
  const [showNewPlan, setShowNewPlan]     = useState(false);

  const role = profile?.role;
  const canCreate = role && role !== "CHW";

  const load = () => {
    if (!practiceId) return;
    setLoading(true);
    supabase
      .from("cm_care_plans")
      .select("id, patient_id, enrollment_id, plan_type, plan_status, version, assessment_date, last_reviewed_at, next_review_due, effective_date, expires_at, goals, interventions, unmet_needs, risk_factors, strengths, supports, medications_reviewed, ai_drafted, ai_draft_model, ai_draft_at, ai_draft_prompt_version, human_reviewed_at, human_reviewed_by, human_reviewer_role, prior_plan_id, review_summary, member_ack_at, member_ack_method, member_ack_notes, member_ack_by, member_ack_role, document_url, document_storage_path, document_generated_at, portal_shared_at, portal_shared_by, notes, created_at, patients(first_name, last_name, mrn), cm_enrollments(program_type, health_plan_type, cm_provider_type)")
      .eq("practice_id", practiceId)
      .order("created_at", { ascending: false })
      .then(({ data, error: e }) => {
        if (e) setError(e.message);
        else setPlans(data || []);
        setLoading(false);
      });
  };

  useEffect(() => { load(); }, [practiceId]);

  const today = new Date().toISOString().split("T")[0];

  const kpis = useMemo(() => {
    const active = plans.filter(p => p.plan_status === "Active");
    const drafts = plans.filter(p => p.plan_status === "Draft");
    const overdueReview = active.filter(p => p.next_review_due && p.next_review_due < today);
    return {
      total:         plans.length,
      active:        active.length,
      drafts:        drafts.length,
      overdueReview: overdueReview.length,
    };
  }, [plans, today]);

  const filtered = useMemo(() => {
    return plans.filter(p => {
      if (statusFilter !== "all" && p.plan_status !== statusFilter) return false;
      if (planTypeFilter !== "all" && p.plan_type !== planTypeFilter) return false;
      return true;
    });
  }, [plans, statusFilter, planTypeFilter]);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
        <KpiCard label="Total plans"    value={kpis.total} />
        <KpiCard label="Active"         value={kpis.active}        hint="Active care plans" />
        <KpiCard label="Drafts"         value={kpis.drafts}        hint="Not yet activated" variant={kpis.drafts > 0 ? "amber" : "neutral"} />
        <KpiCard label="Review overdue" value={kpis.overdueReview} hint="Active plans past next_review_due" variant={kpis.overdueReview > 0 ? "amber" : "neutral"} />
      </div>

      <Card style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, padding: 12 }}>
        <div style={{ display: "flex", gap: 6 }}>
          {["all", "Draft", "Active", "Archived", "Superseded"].map(s => (
            <Btn key={s} size="sm" variant={statusFilter === s ? "primary" : "ghost"} onClick={() => setStatusFilter(s)}>
              {s === "all" ? "All statuses" : s}
            </Btn>
          ))}
        </div>
        <select value={planTypeFilter} onChange={e => setPlanTypeFilter(e.target.value)} style={{ ...selectStyle, width: 240 }}>
          <option value="all">All plan types</option>
          <option value="Care Plan">Care Plan</option>
          <option value="Individual Support Plan">Individual Support Plan</option>
          <option value="AMH Tier 3 Care Plan">AMH Tier 3 Care Plan</option>
          <option value="Comprehensive Assessment">Comprehensive Assessment</option>
          <option value="90-Day Transition Plan">90-Day Transition Plan</option>
        </select>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {canCreate && (
            <Btn variant="primary" size="sm" onClick={() => setShowNewPlan(true)}>+ New plan</Btn>
          )}
          <Btn variant="outline" size="sm" onClick={load}>Refresh</Btn>
        </div>
      </Card>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <Card>
        {loading ? (
          <Loader label="Loading care plans..." />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No care plans yet"
            message={plans.length === 0 ? "Create the first care plan from an active enrollment." : "No plans match the current filters."}
          />
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                <Th>Patient</Th>
                <Th>Plan type</Th>
                <Th>Status</Th>
                <Th align="right">Version</Th>
                <Th align="right">Assessment</Th>
                <Th align="right">Last reviewed</Th>
                <Th align="right">Next review</Th>
                <Th align="right">Goals</Th>
                <Th>Flags</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(plan => {
                const overdueReview = plan.plan_status === "Active" && plan.next_review_due && plan.next_review_due < today;
                const goalsCount = Array.isArray(plan.goals) ? plan.goals.length : 0;
                return (
                  <tr key={plan.id} onClick={() => setSelected(plan)} style={{ cursor: "pointer" }}>
                    <Td>
                      <div style={{ fontWeight: 600 }}>
                        {plan.patients?.last_name || ""}, {plan.patients?.first_name || ""}
                      </div>
                      {plan.patients?.mrn && (
                        <div style={{ fontSize: 11, color: C.textTertiary, fontFamily: "monospace", marginTop: 2 }}>{plan.patients.mrn}</div>
                      )}
                    </Td>
                    <Td>{plan.plan_type}</Td>
                    <Td><PlanStatusBadge status={plan.plan_status} /></Td>
                    <Td align="right" style={{ color: C.textSecondary }}>v{plan.version}</Td>
                    <Td align="right" style={{ color: C.textSecondary }}>
                      {plan.assessment_date ? new Date(plan.assessment_date).toLocaleDateString() : "-"}
                    </Td>
                    <Td align="right" style={{ color: C.textSecondary }}>
                      {plan.last_reviewed_at ? new Date(plan.last_reviewed_at).toLocaleDateString() : "-"}
                    </Td>
                    <Td align="right" style={{ color: overdueReview ? C.red : C.textSecondary, fontWeight: overdueReview ? 700 : 400 }}>
                      {plan.next_review_due ? new Date(plan.next_review_due).toLocaleDateString() : "-"}
                    </Td>
                    <Td align="right">{goalsCount}</Td>
                    <Td>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {overdueReview && <Badge label="REVIEW DUE" variant="red" size="xs" />}
                        {plan.ai_drafted && !plan.human_reviewed_at && <Badge label="AI DRAFT" variant="amber" size="xs" />}
                        {plan.member_ack_at && <Badge label="MEMBER ACK" variant="green" size="xs" />}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {selected && (
        <PlanDetailModal plan={selected} profile={profile} onClose={() => setSelected(null)} onUpdated={() => { setSelected(null); load(); }} />
      )}
      {showNewPlan && (
        <NewPlanModal
          practiceId={practiceId}
          userId={profile?.id}
          onClose={() => setShowNewPlan(false)}
          onCreated={() => { setShowNewPlan(false); load(); }}
        />
      )}
    </div>
  );
}


// ---------------------------------------------------------------------------
// PlanDetailModal - read-only view of a care plan with all JSONB collections
// rendered as plain lists. Quick-action buttons for status transitions.
// ---------------------------------------------------------------------------

function PlanDetailModal({ plan, profile, onClose, onUpdated }) {
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [sharingPortal,  setSharingPortal]  = useState(false);
  // Sub-mode: "view" (default) | "draftReview" (annual review) | "captureAck"
  // (staff-captured member acknowledgment). All nested flows render INSIDE the
  // existing Modal wrapper to avoid double-Modal stacking.
  const [mode, setMode] = useState("view");
  // Edit-goals mode: toggles the Goals section from read-only GoalDisplay to
  // editable GoalEditor with Save/Cancel buttons. Used to add structured
  // metadata (domain, target_date, measure, rationale, status) to goals on
  // existing plans - particularly useful for legacy plans that were migrated
  // from string-array goals to the canonical shape and now need metadata
  // filled in after the fact.
  const [editingGoals, setEditingGoals] = useState(false);
  const [editedGoals, setEditedGoals]   = useState([]);
  const [savingGoals, setSavingGoals]   = useState(false);
  const [goalsError, setGoalsError]     = useState(null);

  // Role gate for the Annual Review AI button. Tier gating is enforced
  // server-side in cmp-draft-annual-review; a 403 surfaces in the error
  // banner if the practice isn't on Command tier.
  const role = profile?.role;
  const canDraftReview =
    plan.plan_status === "Active"
    && role
    && role !== "CHW";

  const title = (plan.patients?.first_name || "") + " " + (plan.patients?.last_name || "") + " - " + plan.plan_type;

  // Map the in-app user role to the cm_delivery_role enum used in the
  // human_reviewer_role column. Falls back to "Other" for roles that don't
  // have a clean clinical equivalent (e.g. Owner, Billing).
  const roleToDeliveryRole = (r) => {
    if (r === "Supervising Care Manager" || r === "Supervising CM") return "Supervising Care Manager";
    if (r === "Care Manager") return "Care Manager";
    if (r === "CHW" || r === "Extender") return "CHW";
    if (r === "Provider") return "Provider";
    return "Other";
  };

  const transitionStatus = async (newStatus, opts = {}) => {
    setSaving(true); setError(null);
    const nowIso = new Date().toISOString();
    const patch = { plan_status: newStatus, updated_at: nowIso };
    if (newStatus === "Active" && !plan.effective_date) {
      patch.effective_date = new Date().toISOString().split("T")[0];
    }
    // When activating an AI-drafted plan, we must also record the human
    // reviewer to satisfy cm_care_plans_ai_review_gate. Gate definition:
    //   NOT (ai_drafted=true AND plan_status='Active' AND human_reviewed_by IS NULL)
    // The reviewer is the current user clicking Activate. This is a single-
    // click attestation - the person hitting "Mark reviewed + activate" is
    // the human whose review we're recording.
    if (newStatus === "Active" && opts.markReviewed) {
      patch.human_reviewed_by    = profile?.id || null;
      patch.human_reviewed_at    = nowIso;
      patch.human_reviewer_role  = roleToDeliveryRole(profile?.role);
      patch.updated_by           = profile?.id || null;
    }
    try {
      const { error: updErr } = await supabase
        .from("cm_care_plans")
        .update(patch)
        .eq("id", plan.id);
      if (updErr) throw updErr;
      onUpdated();
    } catch (e) { setError(e.message); setSaving(false); }
  };

  // Generate (or regenerate) the PDF and open it in a new tab. Each call
  // produces a fresh artifact so the download always reflects the current
  // plan state. The edge function also writes document_url/path/at to the
  // plan row.
  const handleDownloadPdf = async () => {
    setGeneratingPdf(true); setError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) throw new Error("Not signed in");
      const url = supabase.supabaseUrl + "/functions/v1/cmp-generate-plan-pdf";
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": "Bearer " + token,
        },
        body: JSON.stringify({ plan_id: plan.id }),
      });
      const body = await res.json();
      if (!res.ok || !body?.signed_url) {
        throw new Error(body?.error || "PDF generation failed");
      }
      window.open(body.signed_url, "_blank", "noopener,noreferrer");
      if (onUpdated) onUpdated();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setGeneratingPdf(false);
    }
  };

  // Push the plan to the patient portal and queue a notification email.
  // Requires a PDF on file (edge function also enforces this).
  const handleSharePortal = async () => {
    if (!plan.document_storage_path) {
      setError("Generate the PDF first, then share to portal.");
      return;
    }
    setSharingPortal(true); setError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) throw new Error("Not signed in");
      const url = supabase.supabaseUrl + "/functions/v1/cmp-share-plan-portal";
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": "Bearer " + token,
        },
        body: JSON.stringify({ plan_id: plan.id }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Portal share failed");
      if (onUpdated) onUpdated();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setSharingPortal(false);
    }
  };

  // Goals editor handlers. Start copies the current normalized goals into
  // editing state so the user can mutate without affecting the rendered
  // view. Cancel discards changes. Save writes canonicalized, non-blank
  // goals back to cm_care_plans and refreshes the parent list.
  const handleStartEditGoals = () => {
    setEditedGoals(normalizeGoals(Array.isArray(plan.goals) ? plan.goals : []));
    setGoalsError(null);
    setEditingGoals(true);
  };

  const handleCancelEditGoals = () => {
    setEditedGoals([]);
    setGoalsError(null);
    setEditingGoals(false);
  };

  const handleSaveGoals = async () => {
    const cleaned = normalizeGoals(editedGoals).filter(g => !isBlankGoal(g));
    if (cleaned.length === 0) {
      setGoalsError("Add at least one goal before saving");
      return;
    }
    setSavingGoals(true);
    setGoalsError(null);
    try {
      const { error: updErr } = await supabase
        .from("cm_care_plans")
        .update({ goals: cleaned, updated_at: new Date().toISOString() })
        .eq("id", plan.id);
      if (updErr) throw updErr;
      setEditingGoals(false);
      setEditedGoals([]);
      if (onUpdated) onUpdated();
    } catch (e) {
      setGoalsError(e.message || "Failed to save goals");
    } finally {
      setSavingGoals(false);
    }
  };

  const goals         = Array.isArray(plan.goals)         ? plan.goals         : [];
  const interventions = Array.isArray(plan.interventions) ? plan.interventions : [];
  const unmetNeeds    = Array.isArray(plan.unmet_needs)   ? plan.unmet_needs   : [];
  const riskFactors   = Array.isArray(plan.risk_factors)  ? plan.risk_factors  : [];
  const strengths     = Array.isArray(plan.strengths)     ? plan.strengths     : [];
  const supports      = Array.isArray(plan.supports)      ? plan.supports      : [];

  // Annual review drafting mode: swap the whole body for the draft flow.
  // Same Modal wrapper; different title and content. Accept here means a new
  // plan version was inserted - we propagate onUpdated() to refresh the list.
  if (mode === "draftReview") {
    return (
      <Modal title={"Annual review: " + title} onClose={onClose} width={900}>
        <AnnualReviewDrafter
          priorPlan={plan}
          userId={profile?.id}
          onCancel={() => setMode("view")}
          onSaved={() => { if (onUpdated) onUpdated(); }}
        />
      </Modal>
    );
  }

  if (mode === "captureAck") {
    return (
      <Modal title={"Capture acknowledgment: " + title} onClose={onClose} width={560}>
        <CaptureAckForm
          plan={plan}
          onCancel={() => setMode("view")}
          onSaved={() => { setMode("view"); if (onUpdated) onUpdated(); }}
        />
      </Modal>
    );
  }

  return (
    <Modal title={title} onClose={onClose} width={820}>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div style={{ display: "flex", gap: 8, marginBottom: 16, paddingBottom: 12, borderBottom: "0.5px solid " + C.borderLight, flexWrap: "wrap" }}>
        {plan.plan_status === "Draft" && plan.ai_drafted && !plan.human_reviewed_by && (
          role && role !== "CHW" ? (
            <Btn variant="primary" size="sm" disabled={saving} onClick={() => transitionStatus("Active", { markReviewed: true })}>
              {saving ? "Activating..." : "Mark reviewed + activate"}
            </Btn>
          ) : (
            <div style={{ fontSize: 12, color: C.textTertiary, fontStyle: "italic", padding: "6px 0" }}>
              Awaiting review by Care Manager or Supervisor before activation
            </div>
          )
        )}
        {plan.plan_status === "Draft" && (!plan.ai_drafted || plan.human_reviewed_by) && (
          <Btn variant="primary" size="sm" disabled={saving} onClick={() => transitionStatus("Active")}>
            {saving ? "Activating..." : "Activate plan"}
          </Btn>
        )}
        {plan.plan_status === "Active" && (
          <Btn variant="outline" size="sm" disabled={saving} onClick={() => transitionStatus("Archived")}>
            {saving ? "Archiving..." : "Archive plan"}
          </Btn>
        )}
        {plan.plan_status === "Archived" && (
          <Btn variant="outline" size="sm" disabled={saving} onClick={() => transitionStatus("Active")}>
            Re-activate
          </Btn>
        )}
        {canDraftReview && (
          <Btn variant="primary" size="sm" onClick={() => setMode("draftReview")}>
            Draft annual review with AI
          </Btn>
        )}
        {plan.plan_status === "Active" && role && role !== "CHW" && (
          <Btn variant="outline" size="sm" disabled={generatingPdf} onClick={handleDownloadPdf}>
            {generatingPdf ? "Generating..." : (plan.document_generated_at ? "Download PDF" : "Generate PDF")}
          </Btn>
        )}
        {plan.plan_status === "Active" && role && role !== "CHW" && !plan.member_ack_at && (
          <Btn variant="outline" size="sm" onClick={() => setMode("captureAck")}>
            Capture acknowledgment
          </Btn>
        )}
        {plan.plan_status === "Active" && role && role !== "CHW" && plan.document_storage_path && !plan.portal_shared_at && (
          <Btn variant="outline" size="sm" disabled={sharingPortal} onClick={handleSharePortal}>
            {sharingPortal ? "Sharing..." : "Share to portal"}
          </Btn>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        <DetailField label="Status"      value={
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <PlanStatusBadge status={plan.plan_status} />
            {plan.ai_drafted && <Badge label="AI DRAFTED" variant="blue" size="xs" />}
            {plan.ai_drafted && plan.human_reviewed_by && (
              <Badge label="REVIEWED" variant="green" size="xs" />
            )}
          </div>
        } />
        <DetailField label="Version"     value={"v" + plan.version} />
        <DetailField label="Assessment"  value={plan.assessment_date ? new Date(plan.assessment_date).toLocaleDateString() : "-"} />
        <DetailField label="Effective"   value={plan.effective_date ? new Date(plan.effective_date).toLocaleDateString() : "-"} />
        <DetailField label="Last reviewed" value={plan.last_reviewed_at ? new Date(plan.last_reviewed_at).toLocaleDateString() : "-"} />
        <DetailField label="Next review" value={plan.next_review_due ? new Date(plan.next_review_due).toLocaleDateString() : "-"} />
        <DetailField label="Meds reviewed" value={plan.medications_reviewed ? "Yes" : "No"} />
        <DetailField label="PDF generated" value={plan.document_generated_at ? new Date(plan.document_generated_at).toLocaleDateString() : "-"} />
      </div>

      {/* Lifecycle panel: PDF + portal share + member ack status. Only
          surfaces on Active plans where lifecycle is meaningful. */}
      {plan.plan_status === "Active" && (plan.portal_shared_at || plan.member_ack_at || plan.document_storage_path) && (
        <div style={{ padding: 12, marginBottom: 20, border: "0.5px solid " + C.borderLight, borderRadius: 8, background: C.bgSecondary }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 10 }}>
            Lifecycle
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.textTertiary, textTransform: "uppercase", marginBottom: 4 }}>PDF</div>
              {plan.document_storage_path ? (
                <div style={{ fontSize: 13, color: C.textPrimary }}>
                  <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: C.green, marginRight: 6, verticalAlign: "middle" }}></span>
                  Generated
                </div>
              ) : (
                <div style={{ fontSize: 13, color: C.textTertiary, fontStyle: "italic" }}>Not yet generated</div>
              )}
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.textTertiary, textTransform: "uppercase", marginBottom: 4 }}>Portal share</div>
              {plan.portal_shared_at ? (
                <div style={{ fontSize: 13, color: C.textPrimary }}>
                  <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: C.green, marginRight: 6, verticalAlign: "middle" }}></span>
                  {new Date(plan.portal_shared_at).toLocaleDateString()}
                </div>
              ) : (
                <div style={{ fontSize: 13, color: C.textTertiary, fontStyle: "italic" }}>Not shared</div>
              )}
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.textTertiary, textTransform: "uppercase", marginBottom: 4 }}>Member ack</div>
              {plan.member_ack_at ? (
                <div style={{ fontSize: 13, color: C.textPrimary }}>
                  <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: C.green, marginRight: 6, verticalAlign: "middle" }}></span>
                  {new Date(plan.member_ack_at).toLocaleDateString()}
                  {plan.member_ack_method && (
                    <span style={{ fontSize: 11, color: C.textTertiary, marginLeft: 6 }}>
                      ({plan.member_ack_method}{plan.member_ack_role ? ", " + plan.member_ack_role.toLowerCase() : ""})
                    </span>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: 13, color: C.textTertiary, fontStyle: "italic" }}>Pending</div>
              )}
            </div>
          </div>
          {plan.member_ack_notes && (
            <div style={{ marginTop: 10, padding: "8px 10px", background: C.bgPrimary, borderRadius: 6, fontSize: 12, color: C.textSecondary, borderLeft: "2px solid " + C.borderLight }}>
              <span style={{ fontWeight: 600, color: C.textTertiary }}>Ack notes: </span>{plan.member_ack_notes}
            </div>
          )}
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary }}>
            Goals ({normalizeGoals(editingGoals ? editedGoals : goals).length})
          </div>
          {!editingGoals && (plan.plan_status === "Draft" || plan.plan_status === "Active") && role && role !== "CHW" && (
  <Btn variant="outline" size="sm" onClick={handleStartEditGoals}>
    Edit goals
  </Btn>
)}
        </div>
        {editingGoals ? (
          <div>
            <GoalEditor goals={editedGoals} onChange={setEditedGoals} label={null} />
            {goalsError && (
              <div style={{ marginTop: 8, padding: "8px 10px", background: C.redBg, border: "0.5px solid " + C.redBorder, borderRadius: 6, fontSize: 12, color: C.red }}>
                {goalsError}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <Btn variant="primary" size="sm" onClick={handleSaveGoals} disabled={savingGoals}>
                {savingGoals ? "Saving..." : "Save goals"}
              </Btn>
              <Btn variant="ghost" size="sm" onClick={handleCancelEditGoals} disabled={savingGoals}>
                Cancel
              </Btn>
            </div>
          </div>
        ) : (
          <GoalDisplay goals={goals} emptyMsg="No goals recorded" />
        )}
      </div>
      <PlanSection title="Interventions" items={interventions} emptyMsg="No interventions recorded" />
      <PlanSection title="Unmet needs"   items={unmetNeeds}    emptyMsg="No unmet needs recorded" />
      <PlanSection title="Risk factors"  items={riskFactors}   emptyMsg="No risk factors recorded" />
      <PlanSection title="Strengths"     items={strengths}     emptyMsg="No strengths recorded" />
      <PlanSection title="Supports"      items={supports}      emptyMsg="No supports recorded" />

      {/* Review summary - rendered when this plan is the output of an
          annual/interim review. Shows what changed vs. the prior version. */}
      {plan.review_summary && (
        <ReviewSummaryPanel summary={plan.review_summary} priorPlanId={plan.prior_plan_id} />
      )}
    </Modal>
  );
}

// Staff-captured member acknowledgment. Records that a CM walked the member
// through their plan via phone/in-person/video. The edge function handles
// server-side validation (Command tier, Active plan, non-CHW role, method
// in the accepted set).
function CaptureAckForm({ plan, onCancel, onSaved }) {
  const [method, setMethod] = useState("Telephonic");
  const [notes,  setNotes]  = useState("");
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState(null);

  const METHOD_OPTIONS = [
    { value: "Telephonic", label: "By phone" },
    { value: "In Person",  label: "In person" },
    { value: "Video",      label: "Video visit" },
  ];

  const handleSubmit = async () => {
    setSaving(true); setError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) throw new Error("Not signed in");
      const url = supabase.supabaseUrl + "/functions/v1/cmp-member-ack-plan";
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": "Bearer " + token,
        },
        body: JSON.stringify({
          plan_id: plan.id,
          method:  method,
          notes:   notes || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Acknowledgment failed");
      onSaved();
    } catch (e) {
      setError(e.message || String(e));
      setSaving(false);
    }
  };

  return (
    <div>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      <div style={{ fontSize: 13, color: C.textSecondary, marginBottom: 16, lineHeight: 1.5 }}>
        Record that you walked the member through this care plan and they acknowledged it verbally.
        This attestation becomes part of the audit trail for NC Medicaid compliance.
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 8 }}>
          How did you confirm?
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {METHOD_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setMethod(opt.value)}
              style={{
                padding: "8px 14px",
                border: "0.5px solid " + (method === opt.value ? C.teal : C.borderLight),
                background: method === opt.value ? C.teal : C.bgPrimary,
                color: method === opt.value ? "#ffffff" : C.textPrimary,
                borderRadius: 6,
                fontSize: 13,
                fontWeight: method === opt.value ? 600 : 400,
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <FL>Notes (optional)</FL>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Any questions the member raised, or changes they requested..."
          rows={4}
          style={{
            width: "100%",
            padding: "10px 12px",
            border: "1px solid " + C.borderMid,
            borderRadius: 8,
            fontSize: 13,
            fontFamily: "inherit",
            resize: "vertical",
            boxSizing: "border-box",
            background: C.bgPrimary,
            color: C.textPrimary,
          }}
        />
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", paddingTop: 12, borderTop: "0.5px solid " + C.borderLight }}>
        <Btn variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Btn>
        <Btn variant="primary" size="sm" onClick={handleSubmit} disabled={saving}>
          {saving ? "Recording..." : "Record acknowledgment"}
        </Btn>
      </div>
    </div>
  );
}

function PlanSection({ title, items, emptyMsg }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 8 }}>
        {title} ({items.length})
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: 12, color: C.textTertiary, fontStyle: "italic", padding: "6px 0" }}>{emptyMsg}</div>
      ) : (
        <div style={{ border: "0.5px solid " + C.borderLight, borderRadius: 8 }}>
          {items.map((item, i) => {
            const text = typeof item === "string" ? item : (item.text || item.description || item.name || JSON.stringify(item));
            return (
              <div key={i} style={{ padding: "8px 12px", borderBottom: i < items.length - 1 ? "0.5px solid " + C.borderLight : "none", fontSize: 13 }}>
                {text}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NewPlanModal - create a new care plan linked to an active enrollment.
//
// Plan type defaults based on enrollment health_plan_type:
//   Tailored Plan -> "Care Plan"
//   Standard Plan -> "AMH Tier 3 Care Plan"
//   Other/null    -> "Care Plan" as generic default
//
// v1 goals entry: simple multi-line textarea, one goal per line. Saves as
// a JSONB array of strings.
// ---------------------------------------------------------------------------

function NewPlanModal({ practiceId, userId, onClose, onCreated }) {
  const [enrollments, setEnrollments] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState(null);

  const [enrollmentId, setEnrollmentId]   = useState("");
  const [planType, setPlanType]           = useState("");
  const [assessmentDate, setAssessmentDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [nextReviewDue, setNextReviewDue]   = useState("");
  // Structured goals array (canonical shape). Replaces the old goalsText string.
  // Always at least one blank row so there's always somewhere to type.
  const [structuredGoals, setStructuredGoals] = useState([blankGoal()]);
  const [medsReviewed, setMedsReviewed]     = useState(false);
  const [notes, setNotes]                   = useState("");

  // AI draft state. Only structure-level draft data here now - goals live in
  // structuredGoals above. aiDraft.goals is merged into structuredGoals on
  // "Draft with AI" so the editor shows the AI output immediately.
  const [aiDrafting, setAiDrafting]     = useState(false);
  const [aiError, setAiError]           = useState(null);
  const [aiDraft, setAiDraft]           = useState(null);
  const [aiMeta, setAiMeta]             = useState(null);
  useEffect(() => {
    if (!practiceId) return;
    supabase
      .from("cm_enrollments")
      .select("id, patient_id, program_type, enrollment_status, health_plan_type, patients(first_name, last_name, mrn)")
      .eq("practice_id", practiceId)
      .in("enrollment_status", ["Active", "Pending"])
      .order("enrollment_status", { ascending: true })
      .then(({ data }) => { setEnrollments(data || []); setLoading(false); });
  }, [practiceId]);

  const selectedEnrollment = useMemo(
    () => enrollments.find(e => e.id === enrollmentId) || null,
    [enrollments, enrollmentId]
  );

  useEffect(() => {
    if (!selectedEnrollment) return;
    if (selectedEnrollment.health_plan_type === "Standard Plan") setPlanType("AMH Tier 3 Care Plan");
    else setPlanType("Care Plan");
    // Clear any prior AI draft when the enrollment changes
    setAiDraft(null);
    setAiMeta(null);
    setAiError(null);
  }, [selectedEnrollment?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!assessmentDate || nextReviewDue) return;
    const d = new Date(assessmentDate + "T12:00:00Z");
    d.setUTCFullYear(d.getUTCFullYear() + 1);
    setNextReviewDue(d.toISOString().split("T")[0]);
  }, [assessmentDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------------------------------------------------------
  // AI draft call - invokes the cmp-draft-care-plan edge function with the
  // current enrollment. Populates the goals textarea + captures structured
  // sections that will be written on save.
  // -------------------------------------------------------------------------
  const handleAiDraft = async () => {
    if (!enrollmentId) { setAiError("Pick an enrollment first"); return; }
    setAiDrafting(true);
    setAiError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const url = supabase.supabaseUrl + "/functions/v1/cmp-draft-care-plan";
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": "Bearer " + token,
        },
        body: JSON.stringify({ enrollment_id: enrollmentId }),
      });
      const body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || "HTTP " + res.status);

      // Populate structuredGoals directly from the AI output. normalizeGoals
      // handles the legacy {text, ...} shape from cmp-draft-care-plan v1 by
      // renaming text -> goal.
      const aiGoals = Array.isArray(body.structured?.goals) ? body.structured.goals : [];
      setStructuredGoals(normalizeGoals(aiGoals));

      setAiDraft(body.structured || null);
      setAiMeta({
        model_used:     body.model_used,
        prompt_version: body.prompt_version,
        generated_at:   body.generated_at,
      });

      // If AI recommends 6-month review cadence, override the 12-month default
      const cadence = body.structured?.recommended_review_cadence_months;
      if (cadence === 6 && assessmentDate) {
        const d = new Date(assessmentDate + "T12:00:00Z");
        d.setUTCMonth(d.getUTCMonth() + 6);
        setNextReviewDue(d.toISOString().split("T")[0]);
      }
    } catch (e) {
      setAiError(e.message || "AI draft failed");
    } finally {
      setAiDrafting(false);
    }
  };
  const save = async () => {
    if (!enrollmentId) { setError("Pick an enrollment"); return; }
    if (!planType)     { setError("Pick a plan type"); return; }

    // Goals: filter blanks, normalize, then require at least one non-blank.
    const goals = normalizeGoals(structuredGoals).filter(g => !isBlankGoal(g));
    if (goals.length === 0) { setError("Add at least one goal"); return; }

    setSaving(true); setError(null);

    const nowIso = new Date().toISOString();
    const payload = {
      practice_id:   practiceId,
      patient_id:    selectedEnrollment.patient_id,
      enrollment_id: enrollmentId,
      plan_type:     planType,
      plan_status:   "Draft",
      assessment_date: assessmentDate || null,
      next_review_due: nextReviewDue || null,
      goals:         goals,
      medications_reviewed: medsReviewed,
      medications_reviewed_at: medsReviewed ? nowIso : null,
      medications_reviewed_by: medsReviewed ? (userId || null) : null,
      notes:         notes.trim() || null,
      created_by:    userId || null,
    };

    // When AI drafted, attach all the other structured sections + audit flags.
    // goals is already canonical-shaped above (came from structuredGoals which
    // is kept in canonical form via normalizeGoals on every AI draft call).
    if (aiDraft) {
      payload.interventions = Array.isArray(aiDraft.interventions) ? aiDraft.interventions : [];
      payload.unmet_needs   = Array.isArray(aiDraft.unmet_needs)   ? aiDraft.unmet_needs   : [];
      payload.risk_factors  = Array.isArray(aiDraft.risk_factors)  ? aiDraft.risk_factors  : [];
      payload.strengths     = Array.isArray(aiDraft.strengths)     ? aiDraft.strengths     : [];
      payload.supports      = Array.isArray(aiDraft.supports)      ? aiDraft.supports      : [];
      payload.ai_drafted            = true;
      payload.ai_draft_model        = aiMeta?.model_used || null;
      payload.ai_draft_at           = aiMeta?.generated_at || nowIso;
      payload.ai_draft_prompt_version = aiMeta?.prompt_version || null;
    }

    try {
      const { error: insErr } = await supabase.from("cm_care_plans").insert(payload);
      if (insErr) throw insErr;
      onCreated();
    } catch (e) { setError(e.message || "Failed to create plan"); setSaving(false); }
  };
  if (loading) {
    return (
      <Modal title="New care plan" onClose={onClose} width={900}>
        <Loader label="Loading enrollments..." />
      </Modal>
    );
  }

  return (
    <Modal title="New care plan" onClose={onClose} width={900}>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={{ gridColumn: "1 / -1" }}>
          <FL>Enrollment</FL>
          <select value={enrollmentId} onChange={e => setEnrollmentId(e.target.value)} style={selectStyle}>
            <option value="">-- Pick an enrollment --</option>
            {enrollments.map(e => (
              <option key={e.id} value={e.id}>
                {e.patients?.last_name || ""}, {e.patients?.first_name || ""}
                {e.patients?.mrn ? " (" + e.patients.mrn + ")" : ""} - {e.program_type}{e.health_plan_type ? " / " + e.health_plan_type : ""} [{e.enrollment_status}]
              </option>
            ))}
          </select>
        </div>

        {/* AI Draft call-to-action - appears once an enrollment is picked */}
        {enrollmentId && (
          <div style={{ gridColumn: "1 / -1", padding: 12, background: C.bgSecondary, border: "0.5px solid " + C.borderLight, borderRadius: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary }}>AI draft assistant</div>
                <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 2 }}>
                  {aiDraft
                    ? "Draft generated. Review each section below before saving."
                    : "Pull the member's record (enrollment, touchpoints, HRSN, problem list) and draft SMART goals + interventions + barriers for your review."}
                </div>
              </div>
              <Btn
                variant={aiDraft ? "outline" : "primary"}
                size="sm"
                disabled={aiDrafting}
                onClick={handleAiDraft}
              >
                {aiDrafting ? "Drafting..." : (aiDraft ? "Re-draft" : "Draft with AI")}
              </Btn>
            </div>
            {aiError && (
              <div style={{ marginTop: 8, fontSize: 12, color: C.red, background: C.redBg, padding: "6px 10px", borderRadius: 6, border: "0.5px solid " + C.redBorder }}>
                {aiError}
              </div>
            )}
          </div>
        )}

        <div>
          <FL>Plan type</FL>
          <select value={planType} onChange={e => setPlanType(e.target.value)} style={selectStyle}>
            <option value="">-- Select plan type --</option>
            <option value="Care Plan">Care Plan (TCM)</option>
            <option value="Individual Support Plan">Individual Support Plan</option>
            <option value="AMH Tier 3 Care Plan">AMH Tier 3 Care Plan (Standard Plan)</option>
            <option value="Comprehensive Assessment">Comprehensive Assessment</option>
            <option value="90-Day Transition Plan">90-Day Transition Plan</option>
          </select>
        </div>

        <div>
          <FL>Assessment date</FL>
          <input type="date" value={assessmentDate} onChange={e => setAssessmentDate(e.target.value)} style={inputStyle} />
        </div>

        <div>
          <FL>Next review due</FL>
          <input type="date" value={nextReviewDue} onChange={e => setNextReviewDue(e.target.value)} style={inputStyle} />
          <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 4 }}>
            {aiDraft && aiDraft.recommended_review_cadence_months === 6
              ? "AI recommends 6-month review based on this member's profile"
              : "Default: 1 year after assessment"}
          </div>
        </div>

        <div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginTop: 28 }}>
            <input type="checkbox" checked={medsReviewed} onChange={e => setMedsReviewed(e.target.checked)} />
            <span style={{ fontSize: 13 }}>Medications reviewed</span>
          </label>
        </div>

        {/* Assessment summary - shown when AI drafted */}
        {aiDraft?.assessment_summary && (
          <div style={{ gridColumn: "1 / -1", padding: 12, background: "#f0f9ff", border: "0.5px solid #bae6fd", borderRadius: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#075985", marginBottom: 4 }}>
              AI Assessment Summary
            </div>
            <div style={{ fontSize: 13, color: C.textPrimary, lineHeight: 1.5 }}>
              {aiDraft.assessment_summary}
            </div>
          </div>
        )}

        <div style={{ gridColumn: "1 / -1" }}>
          <GoalEditor
            goals={structuredGoals}
            onChange={setStructuredGoals}
            label="Goals"
          />
          <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 4 }}>
            {aiDraft
              ? "AI-drafted goals load structured. Edit the text, adjust priority, add target dates - all fields persist."
              : "Add one or more goals. Expand each row to set domain, target date, measure, and rationale."}
          </div>
        </div>

        {/* AI draft preview - read-only cards for the sections that aren't editable in v1 */}
        {aiDraft && (
          <div style={{ gridColumn: "1 / -1" }}>
            <AiDraftPreview draft={aiDraft} />
          </div>
        )}

        <div style={{ gridColumn: "1 / -1" }}>
          <FL>Notes (optional)</FL>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" disabled={saving || !enrollmentId || !planType} onClick={save}>
          {saving ? "Creating..." : "Create as Draft"}
        </Btn>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// AiDraftPreview - read-only preview of the sections the AI drafted.
// For v1 users cannot edit these in the creation modal (they edit post-save
// via MCP or future PlanDetailModal enhancements). Visible tells the CM what
// context the AI included so they can course-correct with a Re-draft.
// ---------------------------------------------------------------------------
function AiDraftPreview({ draft }) {
  const interventions = Array.isArray(draft.interventions) ? draft.interventions : [];
  const unmetNeeds    = Array.isArray(draft.unmet_needs)   ? draft.unmet_needs   : [];
  const riskFactors   = Array.isArray(draft.risk_factors)  ? draft.risk_factors  : [];
  const strengths     = Array.isArray(draft.strengths)     ? draft.strengths     : [];
  const supports      = Array.isArray(draft.supports)      ? draft.supports      : [];
  const quality       = draft.quality_notes || {};

  return (
    <div style={{ padding: 12, background: "#fafafa", border: "0.5px solid " + C.borderLight, borderRadius: 8 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary }}>
          AI draft sections
        </div>
        {quality.data_completeness && (
          <Badge
            label={"DATA " + String(quality.data_completeness).toUpperCase()}
            variant={quality.data_completeness === "high" ? "green" : quality.data_completeness === "medium" ? "amber" : "red"}
            size="xs"
          />
        )}
      </div>

      <AiDraftChunk title="Interventions" items={interventions} render={(i) => (
        <div>
          <div style={{ fontSize: 13, color: C.textPrimary }}>{i.description}</div>
          <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>
            {[i.cadence, i.responsible_party].filter(Boolean).join(" \u00B7 ")}
          </div>
        </div>
      )} />

      <AiDraftChunk title="Unmet needs / barriers" items={unmetNeeds} render={(u) => (
        <div>
          <div style={{ fontSize: 13, color: C.textPrimary, display: "flex", gap: 6, alignItems: "baseline" }}>
            <span>{u.description}</span>
            {u.urgency && <Badge label={String(u.urgency).toUpperCase()} variant={u.urgency === "urgent" ? "red" : u.urgency === "high" ? "amber" : "neutral"} size="xs" />}
          </div>
          {u.mitigation_idea && (
            <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2, fontStyle: "italic" }}>Idea: {u.mitigation_idea}</div>
          )}
        </div>
      )} />

      <AiDraftChunk title="Risk factors" items={riskFactors} render={(r) => (
        <div style={{ fontSize: 13, color: C.textPrimary }}>{r.description}</div>
      )} />

      <AiDraftChunk title="Strengths" items={strengths} render={(s) => (
        <div style={{ fontSize: 13, color: C.textPrimary }}>{typeof s === "string" ? s : (s.text || JSON.stringify(s))}</div>
      )} />

      <AiDraftChunk title="Supports" items={supports} render={(s) => (
        <div>
          <div style={{ fontSize: 13, color: C.textPrimary }}>{s.name}{s.relationship ? " (" + s.relationship + ")" : ""}</div>
          {s.role && <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>{s.role}</div>}
        </div>
      )} />

      {Array.isArray(quality.missing_data_elements) && quality.missing_data_elements.length > 0 && (
        <div style={{ marginTop: 12, padding: 10, background: C.amberBg, border: "0.5px solid " + C.amberBorder, borderRadius: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 4 }}>
            Missing data that would improve this draft
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: C.textPrimary }}>
            {quality.missing_data_elements.map((el, i) => <li key={i}>{el}</li>)}
          </ul>
        </div>
      )}

      <div style={{ marginTop: 10, fontSize: 10, color: C.textTertiary, fontStyle: "italic" }}>
        Clinical review required before finalization.
      </div>
    </div>
  );
}

function AiDraftChunk({ title, items, render }) {
  if (!items || items.length === 0) return null;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.textSecondary, marginBottom: 4 }}>
        {title} ({items.length})
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {items.map((it, i) => (
          <div key={i} style={{ padding: "8px 10px", background: C.bgPrimary, border: "0.5px solid " + C.borderLight, borderRadius: 6 }}>
            {render(it)}
          </div>
        ))}
      </div>
    </div>
  );
}

// ===============================================================================
// Billing Readiness tab
// ===============================================================================
//
// Displays cm_billing_periods - one row per (enrollment, billing_month).
//
// Data pipeline: supabase.rpc("cm_rollup_practice_billing", { practice, month })
// aggregates qualifying touchpoints (counts_toward_tcm_contact) into billing
// period rows, computing readiness flags and claim_status.
//
// v1 simplified rules:
//   - required_contacts_total = 1 for any Active TCM or AMH enrollment
//   - meets_contact_requirements = actual >= required
//   - has_care_manager_majority = care_manager_count >= ceil(total / 2)
//   - Ready when: meets + CM majority + no duplicative
//
// Claim lifecycle (simplified): Not Ready -> Ready (auto) -> Submitted (manual)
//   -> Paid / Denied. No appeal/void UI in v1.
//
// Month is normalized to first-of-month. Prev/next buttons shift by calendar
// month. "Recompute this month" calls the rollup RPC and reloads.
// ===============================================================================

function BillingTab({ practiceId, profile }) {
  const [month, setMonth]             = useState(() => firstOfCurrentMonth());
  const [periods, setPeriods]         = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected]       = useState(null);
  const [rollingUp, setRollingUp]     = useState(false);

  const role = profile?.role;
  const canRecompute  = role && role !== "CHW";
  const canSubmitClaim = role && role !== "CHW";

  const load = () => {
    if (!practiceId) return;
    setLoading(true);
    supabase
      .from("cm_billing_periods")
      .select("id, patient_id, enrollment_id, billing_month, acuity_tier_snapshot, program_type_snapshot, required_contacts_total, actual_contacts_total, actual_in_person, actual_telephonic, actual_video, actual_care_manager_contacts, actual_supervising_contacts, actual_extender_contacts, actual_provider_contacts, meets_contact_requirements, has_care_manager_majority, has_duplicative_service, claim_status, claim_external_id, claim_ready_at, claim_submitted_at, claim_paid_at, claim_paid_amount, claim_denial_code, claim_denial_reason, verification_status, verified_at, flagged_issues, notes, patients(first_name, last_name, mrn), cm_enrollments(health_plan_type, cm_provider_type, payer_name)")
      .eq("practice_id", practiceId)
      .eq("billing_month", month)
      .order("claim_status", { ascending: true })
      .then(({ data, error: e }) => {
        if (e) setError(e.message);
        else setPeriods(data || []);
        setLoading(false);
      });
  };

  useEffect(() => { load(); }, [practiceId, month]);

  const recompute = async () => {
    if (!practiceId) return;
    setRollingUp(true);
    setError(null);
    try {
      const { error: rpcErr } = await supabase.rpc("cm_rollup_practice_billing", {
        p_practice_id: practiceId,
        p_month: month,
      });
      if (rpcErr) throw rpcErr;
      load();
    } catch (e) {
      setError(e.message || "Recompute failed");
    } finally {
      setRollingUp(false);
    }
  };

  // KPIs
  const kpis = useMemo(() => {
    const counts = {
      total:     periods.length,
      ready:     0,
      notReady:  0,
      submitted: 0,
      paid:      0,
      denied:    0,
    };
    for (const p of periods) {
      if (p.claim_status === "Ready")     counts.ready++;
      else if (p.claim_status === "Not Ready") counts.notReady++;
      else if (p.claim_status === "Submitted") counts.submitted++;
      else if (p.claim_status === "Paid")      counts.paid++;
      else if (p.claim_status === "Denied")    counts.denied++;
    }
    return counts;
  }, [periods]);

  const filtered = useMemo(() => {
    if (statusFilter === "all") return periods;
    return periods.filter(p => p.claim_status === statusFilter);
  }, [periods, statusFilter]);

  const monthLabel = new Date(month + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  const shiftMonth = (deltaMonths) => {
    const d = new Date(month + "T12:00:00Z");
    d.setUTCMonth(d.getUTCMonth() + deltaMonths);
    setMonth(d.toISOString().split("T")[0].substring(0, 8) + "01");
  };

  return (
    <div>
      {/* Month selector + recompute */}
      <Card style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, padding: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Btn variant="outline" size="sm" onClick={() => shiftMonth(-1)}>&larr; Prev</Btn>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary, minWidth: 160, textAlign: "center" }}>
            {monthLabel}
          </div>
          <Btn variant="outline" size="sm" onClick={() => shiftMonth(1)}>Next &rarr;</Btn>
          <Btn variant="ghost" size="sm" onClick={() => setMonth(firstOfCurrentMonth())}>Current</Btn>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {canRecompute && (
            <Btn variant="primary" size="sm" disabled={rollingUp} onClick={recompute}>
              {rollingUp ? "Recomputing..." : "Recompute this month"}
            </Btn>
          )}
          <Btn variant="outline" size="sm" onClick={load}>Refresh</Btn>
        </div>
      </Card>

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 20 }}>
        <KpiCard label="Billable periods" value={kpis.total}     hint="Enrollments this month" />
        <KpiCard label="Ready to bill"    value={kpis.ready}     hint="Meet floor + CM majority" variant={kpis.ready > 0 ? "green" : "neutral"} />
        <KpiCard label="Not ready"        value={kpis.notReady}  hint="Missing contacts" variant={kpis.notReady > 0 ? "amber" : "neutral"} />
        <KpiCard label="Submitted"        value={kpis.submitted} hint="Awaiting payment" variant="blue" />
        <KpiCard label="Paid"             value={kpis.paid}      hint="Revenue collected" variant="green" />
        {kpis.denied > 0 && (
          <KpiCard label="Denied"         value={kpis.denied}    hint="Needs follow-up" variant="red" />
        )}
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {/* Filter bar */}
      <Card style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, padding: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textTertiary, marginRight: 4 }}>Status</span>
        {["all", "Ready", "Not Ready", "Submitted", "Paid", "Denied"].map(s => (
          <FilterPill key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)}>
            {s === "all" ? "All" : s}
          </FilterPill>
        ))}
      </Card>

      {/* Table */}
      <Card>
        {loading ? (
          <Loader label="Loading billing periods..." />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={periods.length === 0 ? "No billing periods for " + monthLabel : "No periods match filter"}
            message={periods.length === 0 ? "Click \"Recompute this month\" to aggregate touchpoints into billing periods." : "Change the status filter to see more results."}
          />
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                <Th>Patient</Th>
                <Th>Program</Th>
                <Th align="right">Contacts</Th>
                <Th>Methods</Th>
                <Th>Flags</Th>
                <Th>Claim</Th>
                <Th>Verification</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(bp => {
                const met  = bp.meets_contact_requirements;
                const maj  = bp.has_care_manager_majority;
                const dup  = bp.has_duplicative_service;
                return (
                  <tr key={bp.id} onClick={() => setSelected(bp)} style={{ cursor: "pointer" }}>
                    <Td>
                      <div style={{ fontWeight: 600 }}>
                        {bp.patients?.last_name || ""}, {bp.patients?.first_name || ""}
                      </div>
                      {bp.patients?.mrn && (
                        <div style={{ fontSize: 11, color: C.textTertiary, fontFamily: "monospace", marginTop: 2 }}>{bp.patients.mrn}</div>
                      )}
                    </Td>
                    <Td>
                      <div>{bp.program_type_snapshot}</div>
                      <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>
                        {bp.cm_enrollments?.health_plan_type || "-"}
                        {bp.acuity_tier_snapshot ? " | " + bp.acuity_tier_snapshot : ""}
                      </div>
                    </Td>
                    <Td align="right">
                      <span style={{ color: met ? C.green : C.red, fontWeight: 700 }}>
                        {bp.actual_contacts_total}
                      </span>
                      <span style={{ color: C.textTertiary }}> / {bp.required_contacts_total}</span>
                    </Td>
                    <Td>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", fontSize: 11 }}>
                        {bp.actual_in_person  > 0 && <span style={{ color: C.textSecondary }}>IP:{bp.actual_in_person}</span>}
                        {bp.actual_telephonic > 0 && <span style={{ color: C.textSecondary }}>Tel:{bp.actual_telephonic}</span>}
                        {bp.actual_video      > 0 && <span style={{ color: C.textSecondary }}>Vid:{bp.actual_video}</span>}
                        {bp.actual_contacts_total === 0 && <span style={{ color: C.textTertiary }}>none</span>}
                      </div>
                    </Td>
                    <Td>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {!met && <Badge label="UNDER FLOOR" variant="red" size="xs" />}
                        {met && !maj && <Badge label="NO CM MAJORITY" variant="amber" size="xs" />}
                        {dup && <Badge label="DUPLICATIVE" variant="red" size="xs" />}
                      </div>
                    </Td>
                    <Td><ClaimStatusBadge status={bp.claim_status} /></Td>
                    <Td><VerificationBadge status={bp.verification_status} /></Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {selected && (
        <BillingPeriodDetailModal
          period={selected}
          userId={profile?.id}
          canSubmitClaim={canSubmitClaim}
          onClose={() => setSelected(null)}
          onUpdated={() => { setSelected(null); load(); }}
        />
      )}
    </div>
  );
}

// Helper: first of current calendar month as YYYY-MM-DD
function firstOfCurrentMonth() {
  const now = new Date();
  return now.getUTCFullYear() + "-" + String(now.getUTCMonth() + 1).padStart(2, "0") + "-01";
}


// ---------------------------------------------------------------------------
// BillingPeriodDetailModal - breakdown of a billing period with claim
// lifecycle actions and verification controls.
// ---------------------------------------------------------------------------

function BillingPeriodDetailModal({ period, userId, canSubmitClaim, onClose, onUpdated }) {
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);
  const [showSubmit, setShowSubmit]   = useState(false);
  const [showPaid, setShowPaid]       = useState(false);
  const [showDenied, setShowDenied]   = useState(false);
  const [claimExtId, setClaimExtId]   = useState("");
  const [paidAmount, setPaidAmount]   = useState("");
  const [denialCode, setDenialCode]   = useState("");
  const [denialReason, setDenialReason] = useState("");

  // AI explainer state. The edge function returns a structured analysis with
  // status assessment, path-to-ready steps, audit risks, and recommended
  // actions. `aiContext` holds the small metadata packet (billing_month,
  // days_remaining, etc.) so the UI can show deadlines without recomputing.
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiAnalysis, setAiAnalysis]   = useState(null);
  const [aiContext, setAiContext]     = useState(null);
  const [aiError, setAiError]         = useState(null);

  const title = (period.patients?.first_name || "") + " " + (period.patients?.last_name || "")
    + " - " + new Date(period.billing_month + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  const patchBillingPeriod = async (patch) => {
    setSaving(true); setError(null);
    try {
      const { error: updErr } = await supabase
        .from("cm_billing_periods")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", period.id);
      if (updErr) throw updErr;
      onUpdated();
    } catch (e) {
      setError(e.message || "Update failed");
      setSaving(false);
    }
  };

  const submitClaim = async () => {
    if (!claimExtId.trim()) { setError("External claim ID required"); return; }
    await patchBillingPeriod({
      claim_status:        "Submitted",
      claim_external_id:   claimExtId.trim(),
      claim_submitted_at:  new Date().toISOString(),
      claim_submitted_by:  userId || null,
      claim_ready_at:      period.claim_ready_at || new Date().toISOString(),
    });
  };

  const markPaid = async () => {
    const amt = parseFloat(paidAmount);
    if (isNaN(amt) || amt < 0) { setError("Valid paid amount required"); return; }
    await patchBillingPeriod({
      claim_status:      "Paid",
      claim_paid_at:     new Date().toISOString(),
      claim_paid_amount: amt,
    });
  };

  const markDenied = async () => {
    if (!denialReason.trim()) { setError("Denial reason required"); return; }
    await patchBillingPeriod({
      claim_status:        "Denied",
      claim_denial_code:   denialCode.trim() || null,
      claim_denial_reason: denialReason.trim(),
    });
  };

  const approveVerification = async () => {
    await patchBillingPeriod({
      verification_status: "Approved",
      verified_at:         new Date().toISOString(),
      verified_by:         userId || null,
    });
  };

  // -------------------------------------------------------------------------
  // AI explainer - calls cmp-billing-explainer and renders the structured
  // analysis inline. Works for all claim statuses; the edge function returns
  // different sections based on status (path_to_ready vs audit_risks vs
  // denial_analysis). Re-runnable by clicking again.
  // -------------------------------------------------------------------------
  const handleAiAnalyze = async () => {
    setAiAnalyzing(true);
    setAiError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const url = supabase.supabaseUrl + "/functions/v1/cmp-billing-explainer";
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": "Bearer " + token,
        },
        body: JSON.stringify({ billing_period_id: period.id }),
      });
      const body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || "HTTP " + res.status);

      setAiAnalysis(body.analysis || null);
      setAiContext(body.context || null);
    } catch (e) {
      setAiError(e.message || "AI analysis failed");
    } finally {
      setAiAnalyzing(false);
    }
  };

  const roleRows = [
    ["Care Manager",             period.actual_care_manager_contacts],
    ["Supervising Care Manager", period.actual_supervising_contacts],
    ["Extender",                 period.actual_extender_contacts],
    ["Provider",                 period.actual_provider_contacts],
  ].filter(r => r[1] > 0);

  const methodRows = [
    ["In Person",  period.actual_in_person],
    ["Telephonic", period.actual_telephonic],
    ["Video",      period.actual_video],
  ].filter(r => r[1] > 0);

  const flags = Array.isArray(period.flagged_issues) ? period.flagged_issues : [];

  // Which action buttons should be shown. Precomputed so the action row
  // only renders when at least one is available (avoids empty bordered row).
  const showReady     = period.claim_status === "Ready"     && canSubmitClaim && !showSubmit;
  const showSubmitted = period.claim_status === "Submitted" && canSubmitClaim && !showPaid && !showDenied;
  const showVerify    = period.verification_status !== "Approved" && canSubmitClaim;

  return (
    <Modal title={title} onClose={onClose} width={760}>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {/* Toolbar: Explain with AI always available; claim lifecycle actions conditional */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, paddingBottom: 12, borderBottom: "0.5px solid " + C.borderLight, flexWrap: "wrap" }}>
        <Btn
          variant={aiAnalysis ? "outline" : "primary"}
          size="sm"
          disabled={aiAnalyzing}
          onClick={handleAiAnalyze}
        >
          {aiAnalyzing ? "Analyzing..." : (aiAnalysis ? "Re-analyze" : "Explain with AI")}
        </Btn>
        {showReady && (
          <Btn variant="primary" size="sm" onClick={() => setShowSubmit(true)}>Submit claim</Btn>
        )}
        {showSubmitted && (
          <>
            <Btn variant="primary" size="sm" onClick={() => setShowPaid(true)}>Mark paid</Btn>
            <Btn variant="outline" size="sm" onClick={() => setShowDenied(true)} style={{ color: C.red, borderColor: C.redBorder }}>Mark denied</Btn>
          </>
        )}
        {showVerify && (
          <Btn variant="outline" size="sm" disabled={saving} onClick={approveVerification}>
            {saving ? "Approving..." : "Mark verified"}
          </Btn>
        )}
      </div>

      {/* AI analysis error + result */}
      {aiError && (
        <div style={{ marginBottom: 16, fontSize: 12, color: C.red, background: C.redBg, padding: "10px 12px", borderRadius: 8, border: "0.5px solid " + C.redBorder }}>
          {aiError}
        </div>
      )}
      {aiAnalysis && (
        <BillingAnalysisCard analysis={aiAnalysis} context={aiContext} claimStatus={period.claim_status} />
      )}

      {/* Inline submit claim form */}
      {showSubmit && (
        <div style={{ padding: 12, marginBottom: 16, background: C.bgSecondary, borderRadius: 8 }}>
          <FL>External claim ID (from billing system)</FL>
          <input type="text" value={claimExtId} onChange={e => setClaimExtId(e.target.value)} placeholder="e.g. CLM-2026-04-00123" style={{ ...inputStyle, fontFamily: "monospace" }} />
          <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
            <Btn variant="ghost" size="sm" onClick={() => { setShowSubmit(false); setClaimExtId(""); }}>Cancel</Btn>
            <Btn variant="primary" size="sm" disabled={saving || !claimExtId.trim()} onClick={submitClaim}>
              {saving ? "Submitting..." : "Confirm submission"}
            </Btn>
          </div>
        </div>
      )}

      {/* Inline mark paid form */}
      {showPaid && (
        <div style={{ padding: 12, marginBottom: 16, background: C.bgSecondary, borderRadius: 8 }}>
          <FL>Paid amount (USD)</FL>
          <input type="number" step="0.01" value={paidAmount} onChange={e => setPaidAmount(e.target.value)} placeholder="0.00" style={inputStyle} />
          <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
            <Btn variant="ghost" size="sm" onClick={() => { setShowPaid(false); setPaidAmount(""); }}>Cancel</Btn>
            <Btn variant="primary" size="sm" disabled={saving || !paidAmount} onClick={markPaid}>
              {saving ? "Saving..." : "Confirm payment"}
            </Btn>
          </div>
        </div>
      )}

      {/* Inline mark denied form */}
      {showDenied && (
        <div style={{ padding: 12, marginBottom: 16, background: C.bgSecondary, borderRadius: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
            <div>
              <FL>Denial code (optional)</FL>
              <input type="text" value={denialCode} onChange={e => setDenialCode(e.target.value)} placeholder="e.g. CO-97" style={{ ...inputStyle, fontFamily: "monospace" }} />
            </div>
            <div>
              <FL>Denial reason</FL>
              <input type="text" value={denialReason} onChange={e => setDenialReason(e.target.value)} placeholder="e.g. Duplicate service" style={inputStyle} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
            <Btn variant="ghost" size="sm" onClick={() => { setShowDenied(false); setDenialCode(""); setDenialReason(""); }}>Cancel</Btn>
            <Btn variant="primary" size="sm" disabled={saving || !denialReason.trim()} onClick={markDenied} style={{ background: C.red, borderColor: C.red }}>
              {saving ? "Saving..." : "Confirm denial"}
            </Btn>
          </div>
        </div>
      )}

      {/* Summary row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        <DetailField label="Program"          value={period.program_type_snapshot} />
        <DetailField label="Plan"             value={period.cm_enrollments?.health_plan_type || "-"} />
        <DetailField label="Acuity"           value={period.acuity_tier_snapshot || "-"} />
        <DetailField label="Provider"         value={period.cm_enrollments?.cm_provider_type || "-"} />
        <DetailField label="Claim status"     value={<ClaimStatusBadge status={period.claim_status} />} />
        <DetailField label="Verification"     value={<VerificationBadge status={period.verification_status} />} />
        <DetailField label="Contacts"         value={period.actual_contacts_total + " / " + period.required_contacts_total} />
        <DetailField label="CM majority"      value={period.has_care_manager_majority ? "Yes" : "No"} />
      </div>

      {/* Claim lifecycle audit */}
      {(period.claim_ready_at || period.claim_submitted_at || period.claim_paid_at) && (
        <div style={{ marginBottom: 20, padding: 12, background: C.bgSecondary, borderRadius: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 8 }}>
            Claim lifecycle
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.8 }}>
            {period.claim_ready_at && <div>Ready: {new Date(period.claim_ready_at).toLocaleString()}</div>}
            {period.claim_submitted_at && (
              <div>
                Submitted: {new Date(period.claim_submitted_at).toLocaleString()}
                {period.claim_external_id && <span style={{ fontFamily: "monospace", color: C.textSecondary }}> ({period.claim_external_id})</span>}
              </div>
            )}
            {period.claim_paid_at && (
              <div style={{ color: C.green }}>
                Paid: {new Date(period.claim_paid_at).toLocaleString()}
                {period.claim_paid_amount && <span> - ${Number(period.claim_paid_amount).toFixed(2)}</span>}
              </div>
            )}
            {period.claim_denial_reason && (
              <div style={{ color: C.red }}>
                Denied: {period.claim_denial_code ? "[" + period.claim_denial_code + "] " : ""}{period.claim_denial_reason}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Contact breakdown */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 8 }}>
          Qualifying contacts ({period.actual_contacts_total})
        </div>
        {period.actual_contacts_total === 0 ? (
          <div style={{ fontSize: 12, color: C.textTertiary, fontStyle: "italic", padding: "6px 0" }}>
            No qualifying contacts logged this month. Log touchpoints from the Touchpoints tab - only successful contacts via In Person, Telephonic, or Video count toward the billing floor.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <div style={{ fontSize: 11, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>By method</div>
              {methodRows.map(([label, count]) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13 }}>
                  <span>{label}</span>
                  <span style={{ fontWeight: 600 }}>{count}</span>
                </div>
              ))}
            </div>
            <div>
              <div style={{ fontSize: 11, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>By role</div>
              {roleRows.map(([label, count]) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13 }}>
                  <span>{label}</span>
                  <span style={{ fontWeight: 600 }}>{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Flagged issues */}
      {flags.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 8 }}>
            Flagged issues ({flags.length})
          </div>
          <div style={{ border: "0.5px solid " + C.redBorder, borderRadius: 8, background: C.redBg }}>
            {flags.map((f, i) => {
              const text = typeof f === "string" ? f : (f.message || f.description || JSON.stringify(f));
              return (
                <div key={i} style={{ padding: "8px 12px", borderBottom: i < flags.length - 1 ? "0.5px solid " + C.redBorder : "none", fontSize: 13 }}>
                  {text}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {period.notes && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 8 }}>
            Notes
          </div>
          <div style={{ fontSize: 13, padding: "8px 12px", background: C.bgSecondary, borderRadius: 8 }}>
            {period.notes}
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// NewEnrollmentModal - create a new Care Management enrollment.
//
// Enrollment has three plan-related dimensions:
//   1. health_plan_type - Tailored Plan / Standard Plan / Other (or null for informal)
//   2. program_type     - TCM / AMH / General Engagement / Other
//   3. cm_provider_type - AMH+ / AMH Tier 3 / CMA / CIN / Other
//      (Plan-based excluded: practices do not enroll plan-managed members)
//
// Valid combinations are enforced by PLAN_PROGRAM_MATRIX in cmCadence.js:
//   Tailored Plan -> TCM, delivered by AMH+ / CMA / CIN
//   Standard Plan -> AMH, delivered by AMH Tier 3 / CIN
//   Other         -> General Engagement or Other, any provider
//   (null plan)   -> informal, no constraint
//
// The "Allow nonstandard combination" override exists for edge cases
// (plan transitions, dual enrollment, etc.) that do not fit the matrix.
//
// Acuity tier only applies to Tailored Plan (TCM) enrollments.
//
// Partial-unique index on (patient_id, program_type) WHERE status='Active'
// prevents duplicate active enrollments. Surfaced as UX warning before save.
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// BillingAnalysisCard - renders the structured output from cmp-billing-explainer.
// Sections shown adapt to claim_status: Not Ready gets path_to_ready, Ready/
// Submitted get audit_risks, Denied gets denial_analysis. All statuses get
// the narrative summary + recommended_next_actions + add_on_opportunities.
// ---------------------------------------------------------------------------
function BillingAnalysisCard({ analysis, context, claimStatus }) {
  if (!analysis) return null;

  const pathToReady     = Array.isArray(analysis.path_to_ready)          ? analysis.path_to_ready          : [];
  const auditRisks      = Array.isArray(analysis.audit_risks)            ? analysis.audit_risks            : [];
  const nextActions     = Array.isArray(analysis.recommended_next_actions) ? analysis.recommended_next_actions : [];
  const addOns          = Array.isArray(analysis.add_on_opportunities)   ? analysis.add_on_opportunities   : [];
  const denial          = analysis.denial_analysis || null;
  const caveats         = Array.isArray(analysis.confidence_caveats)     ? analysis.confidence_caveats     : [];

  const statusLabel = (s) => {
    if (!s) return "Analysis";
    return s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  };

  const statusColor = (s) => {
    if (s === "ready_strong" || s === "paid" || s === "on_track") return "#047857"; // green
    if (s === "ready_audit_risk" || s === "at_risk" || s === "submitted_waiting") return "#d97706"; // amber
    if (s === "blocked" || s === "denied_resubmittable" || s === "denied_terminal") return "#dc2626"; // red
    return "#0369a1"; // blue
  };

  const priorityColor = (p) => p === "urgent" ? "red" : p === "high" ? "red" : p === "medium" ? "amber" : "neutral";
  const severityColor = (s) => s === "high" ? "red" : s === "medium" ? "amber" : "neutral";

  const deadlineLabel = (d) => {
    if (!d) return null;
    if (d === "asap")         return "ASAP";
    if (d === "end_of_month") return "End of month";
    // Try to parse as ISO date
    try {
      const dt = new Date(d + "T12:00:00Z");
      return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    } catch (e) { return d; }
  };

  return (
    <div style={{ marginBottom: 20, padding: 14, background: "#f0f9ff", border: "0.5px solid #bae6fd", borderRadius: 10 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10, gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#075985" }}>
            AI Analysis
          </div>
          {analysis.status_assessment && (
            <div style={{ fontSize: 12, fontWeight: 700, color: statusColor(analysis.status_assessment) }}>
              {statusLabel(analysis.status_assessment)}
            </div>
          )}
          {context?.days_remaining_in_month > 0 && context?.month_status === "current" && (
            <div style={{ fontSize: 11, color: C.textTertiary }}>
              {context.days_remaining_in_month} day{context.days_remaining_in_month === 1 ? "" : "s"} left this month
            </div>
          )}
        </div>
        {analysis.confidence && (
          <Badge
            label={"CONFIDENCE " + String(analysis.confidence).toUpperCase()}
            variant={analysis.confidence === "high" ? "green" : analysis.confidence === "medium" ? "amber" : "red"}
            size="xs"
          />
        )}
      </div>

      {/* Narrative */}
      {analysis.narrative_summary && (
        <div style={{ fontSize: 13, color: C.textPrimary, lineHeight: 1.55, marginBottom: 14 }}>
          {analysis.narrative_summary}
        </div>
      )}

      {/* Path to ready (Not Ready periods) */}
      {pathToReady.length > 0 && (
        <AnalysisSection title="Path to ready" tone="amber">
          {pathToReady.map((step, i) => (
            <div key={i} style={{ padding: "8px 10px", background: C.bgPrimary, border: "0.5px solid " + C.borderLight, borderRadius: 6, marginBottom: i < pathToReady.length - 1 ? 6 : 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 2 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>{step.action}</div>
                {deadlineLabel(step.deadline) && (
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.red, whiteSpace: "nowrap" }}>
                    By {deadlineLabel(step.deadline)}
                  </div>
                )}
              </div>
              {step.reason && (
                <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>{step.reason}</div>
              )}
            </div>
          ))}
        </AnalysisSection>
      )}

      {/* Audit risks (Ready/Submitted periods) */}
      {auditRisks.length > 0 && (
        <AnalysisSection title="Audit durability risks" tone="amber">
          {auditRisks.map((risk, i) => (
            <div key={i} style={{ padding: "8px 10px", background: C.bgPrimary, border: "0.5px solid " + C.borderLight, borderRadius: 6, marginBottom: i < auditRisks.length - 1 ? 6 : 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap", marginBottom: 2 }}>
                <Badge label={String(risk.severity || "medium").toUpperCase()} variant={severityColor(risk.severity)} size="xs" />
                <div style={{ fontSize: 13, color: C.textPrimary }}>{risk.risk}</div>
              </div>
              {risk.mitigation && (
                <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2, fontStyle: "italic" }}>Mitigation: {risk.mitigation}</div>
              )}
            </div>
          ))}
        </AnalysisSection>
      )}

      {/* Denial analysis (Denied periods) */}
      {claimStatus === "Denied" && denial && denial.root_cause_hypothesis && (
        <AnalysisSection title="Denial analysis" tone="red">
          <div style={{ padding: 10, background: C.bgPrimary, border: "0.5px solid " + C.borderLight, borderRadius: 6 }}>
            <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 4 }}>
              <strong style={{ color: C.textPrimary }}>Likely root cause:</strong> {denial.root_cause_hypothesis}
            </div>
            {Array.isArray(denial.evidence) && denial.evidence.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.textSecondary, marginBottom: 2 }}>Evidence</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: C.textPrimary }}>
                  {denial.evidence.map((ev, i) => <li key={i}>{ev}</li>)}
                </ul>
              </div>
            )}
            {denial.resubmission_viability && (
              <div style={{ marginTop: 8, fontSize: 12 }}>
                <strong style={{ color: C.textPrimary }}>Resubmission viability:</strong>{" "}
                <Badge
                  label={String(denial.resubmission_viability).replace(/_/g, " ").toUpperCase()}
                  variant={denial.resubmission_viability === "viable" ? "green" : denial.resubmission_viability === "partially_viable" ? "amber" : "red"}
                  size="xs"
                />
              </div>
            )}
            {Array.isArray(denial.resubmission_steps) && denial.resubmission_steps.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.textSecondary, marginBottom: 2 }}>Resubmission steps</div>
                <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: C.textPrimary }}>
                  {denial.resubmission_steps.map((st, i) => <li key={i}>{st}</li>)}
                </ol>
              </div>
            )}
          </div>
        </AnalysisSection>
      )}

      {/* Add-on opportunities */}
      {addOns.length > 0 && (
        <AnalysisSection title="Add-on code opportunities" tone="green">
          {addOns.map((a, i) => (
            <div key={i} style={{ padding: "8px 10px", background: C.bgPrimary, border: "0.5px solid " + C.borderLight, borderRadius: 6, marginBottom: i < addOns.length - 1 ? 6 : 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap", marginBottom: 2 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>{String(a.code || "").toUpperCase()}</div>
                <Badge
                  label={String(a.eligibility || "").replace(/_/g, " ").toUpperCase()}
                  variant={a.eligibility === "likely_eligible" ? "green" : a.eligibility === "needs_verification" ? "amber" : "neutral"}
                  size="xs"
                />
              </div>
              {a.reasoning && <div style={{ fontSize: 11, color: C.textTertiary }}>{a.reasoning}</div>}
            </div>
          ))}
        </AnalysisSection>
      )}

      {/* Recommended next actions (always shown) */}
      {nextActions.length > 0 && (
        <AnalysisSection title="Recommended next actions" tone="blue">
          {nextActions.map((a, i) => (
            <div key={i} style={{ padding: "8px 10px", background: C.bgPrimary, border: "0.5px solid " + C.borderLight, borderRadius: 6, marginBottom: i < nextActions.length - 1 ? 6 : 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap", marginBottom: 2 }}>
                <Badge label={String(a.priority || "medium").toUpperCase()} variant={priorityColor(a.priority)} size="xs" />
                <div style={{ fontSize: 13, color: C.textPrimary, flex: 1 }}>{a.action}</div>
              </div>
              <div style={{ fontSize: 10, color: C.textTertiary, marginTop: 4, display: "flex", gap: 10 }}>
                {a.owner && <span>Owner: {String(a.owner).replace(/_/g, " ")}</span>}
                {a.estimated_impact && <span>Impact: {String(a.estimated_impact).replace(/_/g, " ")}</span>}
              </div>
            </div>
          ))}
        </AnalysisSection>
      )}

      {/* Confidence caveats */}
      {caveats.length > 0 && (
        <div style={{ marginTop: 10, padding: 8, fontSize: 11, color: C.textTertiary, fontStyle: "italic" }}>
          Caveats: {caveats.join(" / ")}
        </div>
      )}
    </div>
  );
}

function AnalysisSection({ title, tone, children }) {
  const borderColor = tone === "amber" ? "#fbbf24" : tone === "red" ? "#f87171" : tone === "green" ? "#34d399" : "#60a5fa";
  return (
    <div style={{ marginBottom: 12, paddingLeft: 10, borderLeft: "2px solid " + borderColor }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 6 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AnnualReviewDrafter - calls cmp-draft-annual-review, presents the draft
// for human review (edit/accept/reject), and on accept inserts a new
// cm_care_plans row with prior_plan_id set. The DB trigger auto-supersedes
// the prior plan. This keeps the workflow fully auditable: every review
// produces a new plan version, and the review_summary jsonb captures the
// AI's analysis of what changed, which the reviewer can edit before saving.
// ---------------------------------------------------------------------------
function AnnualReviewDrafter({ priorPlan, userId, onCancel, onSaved }) {
  const [drafting, setDrafting]   = useState(false);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState(null);
  const [draft, setDraft]         = useState(null);
  const [context, setContext]     = useState(null);
  const [modelMeta, setModelMeta] = useState(null);

  // Editable overrides. The AI's draft goes into these on generation; the
  // reviewer can then edit before saving. On save we combine the edited
  // review_summary/refreshed_plan with the AI metadata.
  const [overallAssessment, setOverallAssessment] = useState("");
  const [reviewerNotes, setReviewerNotes]         = useState("");
  const [nextReviewDue, setNextReviewDue]         = useState("");

  const handleDraft = async () => {
    setDrafting(true);
    setError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const url = supabase.supabaseUrl + "/functions/v1/cmp-draft-annual-review";
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": "Bearer " + token,
        },
        body: JSON.stringify({ prior_plan_id: priorPlan.id }),
      });
      const body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || "HTTP " + res.status);

      setDraft(body.draft || null);
      setContext(body.context || null);
      setModelMeta({
        model: body.model_used,
        prompt_version: body.prompt_version,
        generated_at: body.generated_at,
      });
      // Seed editable fields from AI output
      setOverallAssessment(body.draft?.review_summary?.overall_assessment || "");
      setNextReviewDue(body.draft?.refreshed_plan?.suggested_next_review_due || "");
      setReviewerNotes("");
    } catch (e) {
      setError(e.message || "Draft failed");
    } finally {
      setDrafting(false);
    }
  };

  // Accept + save: insert a new cm_care_plans row as a new version.
  // The DB trigger flips the prior plan to Superseded automatically.
  const handleAccept = async () => {
    if (!draft) { setError("No draft to save"); return; }
    setSaving(true);
    setError(null);
    try {
      // Compose the review_summary jsonb: mostly AI output, but with any
      // reviewer overrides applied on top.
      const finalSummary = {
        ...draft.review_summary,
        overall_assessment: overallAssessment || draft.review_summary?.overall_assessment || "",
        reviewer_notes:     reviewerNotes.trim() || null,
        ai_generated:       true,
        ai_model:           modelMeta?.model,
        ai_prompt_version:  modelMeta?.prompt_version,
        ai_generated_at:    modelMeta?.generated_at,
      };

      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const url = supabase.supabaseUrl + "/functions/v1/cmp-save-annual-review";
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": "Bearer " + token,
        },
        body: JSON.stringify({
          prior_plan_id:   priorPlan.id,
          refreshed_plan:  draft.refreshed_plan || {},
          review_summary:  { ...draft.review_summary, overall_assessment: overallAssessment || draft.review_summary?.overall_assessment || "" },
          next_review_due: nextReviewDue || null,
          reviewer_notes:  reviewerNotes.trim() || null,
          model_meta:      modelMeta || {},
        }),
      });
      const body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || "HTTP " + res.status);
      if (onSaved) onSaved();
    } catch (e) {
      setError(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  // Initial state: no draft yet. Show kickoff CTA + prior plan summary.
  if (!draft) {
    const priorGoalCount = Array.isArray(priorPlan.goals) ? priorPlan.goals.length : 0;
    const priorAssessmentDate = priorPlan.assessment_date || priorPlan.created_at;
    return (
      <div>
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
        <div style={{ padding: 14, marginBottom: 16, background: "#f0f9ff", border: "0.5px solid #bae6fd", borderRadius: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#075985", marginBottom: 6 }}>
            Ready to draft annual review
          </div>
          <div style={{ fontSize: 13, color: C.textPrimary, lineHeight: 1.55 }}>
            This will review <strong>v{priorPlan.version}</strong> (assessed {priorAssessmentDate ? new Date(priorAssessmentDate).toLocaleDateString() : "-"}) with
            <strong> {priorGoalCount} goal{priorGoalCount === 1 ? "" : "s"}</strong>.
            Claude will pull every touchpoint, HRSN screening, billing month, and risk assessment since that date and draft a review for your approval. You'll edit before saving. Approximate cost: 3-5 cents.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Btn variant="ghost" size="sm" onClick={onCancel}>Back</Btn>
          <Btn variant="primary" size="sm" disabled={drafting} onClick={handleDraft}>
            {drafting ? "Drafting (~30 seconds)..." : "Draft review"}
          </Btn>
        </div>
      </div>
    );
  }

  // Draft is ready. Show preview + editable fields + save/cancel.
  const rs = draft.review_summary || {};
  const rp = draft.refreshed_plan || {};
  const goalsMet        = Array.isArray(rs.goals_met)         ? rs.goals_met         : [];
  const goalsNotMet     = Array.isArray(rs.goals_not_met)     ? rs.goals_not_met     : [];
  const goalsCarried    = Array.isArray(rs.goals_carried_over) ? rs.goals_carried_over : [];
  const goalsRemoved    = Array.isArray(rs.goals_removed)     ? rs.goals_removed     : [];
  const keyEvents       = Array.isArray(rs.key_events)        ? rs.key_events        : [];
  const refreshedGoals  = Array.isArray(rp.goals)             ? rp.goals             : [];
  const refreshedInts   = Array.isArray(rp.interventions)     ? rp.interventions     : [];
  const refreshedNeeds  = Array.isArray(rp.unmet_needs)       ? rp.unmet_needs       : [];
  const confCaveats     = Array.isArray(draft.confidence_caveats) ? draft.confidence_caveats : [];

  return (
    <div>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {/* Draft header with confidence + reassess */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textSecondary }}>
            Review draft
          </div>
          {rs.period_covered && (
            <div style={{ fontSize: 13, color: C.textPrimary, marginTop: 2 }}>{rs.period_covered}</div>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {draft.confidence && (
            <Badge label={"CONFIDENCE " + String(draft.confidence).toUpperCase()} variant={draft.confidence === "high" ? "green" : draft.confidence === "medium" ? "amber" : "red"} size="xs" />
          )}
          {rs.interim_review_recommended && (
            <Badge label="INTERIM REVIEW RECOMMENDED" variant="amber" size="xs" />
          )}
          {rs.medications_need_review && (
            <Badge label="MED REVIEW" variant="amber" size="xs" />
          )}
          <Btn variant="outline" size="sm" disabled={drafting} onClick={handleDraft}>
            {drafting ? "..." : "Re-draft"}
          </Btn>
        </div>
      </div>

      {/* Overall assessment - editable */}
      <div style={{ marginBottom: 16 }}>
        <FL>Overall assessment</FL>
        <textarea
          value={overallAssessment}
          onChange={e => setOverallAssessment(e.target.value)}
          rows={3}
          style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical" }}
        />
      </div>

      {/* Two-column summary: left = what happened (met/not met/carried/removed), right = what's next */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 6 }}>
            Prior period review
          </div>
          {goalsMet.length > 0 && (
            <ReviewGroup title={"Goals met (" + goalsMet.length + ")"} tone="green">
              {goalsMet.map((g, i) => (
                <div key={i} style={{ fontSize: 12, color: C.textPrimary, marginBottom: 4 }}>
                  <strong>{g.goal}</strong>
                  {g.evidence && <div style={{ fontSize: 11, color: C.textTertiary }}>{g.evidence}</div>}
                </div>
              ))}
            </ReviewGroup>
          )}
          {goalsNotMet.length > 0 && (
            <ReviewGroup title={"Goals not met (" + goalsNotMet.length + ")"} tone="red">
              {goalsNotMet.map((g, i) => (
                <div key={i} style={{ fontSize: 12, color: C.textPrimary, marginBottom: 4 }}>
                  <strong>{g.goal}</strong>
                  {g.reason && <div style={{ fontSize: 11, color: C.textTertiary }}>Reason: {g.reason}</div>}
                  {g.recommendation && <div style={{ fontSize: 11, color: C.textTertiary }}>Rec: {String(g.recommendation).replace(/_/g, " ")}</div>}
                </div>
              ))}
            </ReviewGroup>
          )}
          {goalsCarried.length > 0 && (
            <ReviewGroup title={"Carry over (" + goalsCarried.length + ")"} tone="blue">
              {goalsCarried.map((g, i) => (
                <div key={i} style={{ fontSize: 12, color: C.textPrimary, marginBottom: 4 }}>
                  <strong>{g.goal}</strong>
                  {g.rationale && <div style={{ fontSize: 11, color: C.textTertiary }}>{g.rationale}</div>}
                </div>
              ))}
            </ReviewGroup>
          )}
          {goalsRemoved.length > 0 && (
            <ReviewGroup title={"Removed (" + goalsRemoved.length + ")"} tone="neutral">
              {goalsRemoved.map((g, i) => (
                <div key={i} style={{ fontSize: 12, color: C.textPrimary, marginBottom: 4 }}>
                  <strong>{g.goal}</strong>
                  {g.reason && <div style={{ fontSize: 11, color: C.textTertiary }}>{g.reason}</div>}
                </div>
              ))}
            </ReviewGroup>
          )}
          {keyEvents.length > 0 && (
            <ReviewGroup title={"Key events (" + keyEvents.length + ")"} tone="amber">
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: C.textPrimary }}>
                {keyEvents.map((ev, i) => <li key={i}>{ev}</li>)}
              </ul>
            </ReviewGroup>
          )}
        </div>

        <div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 6 }}>
            Refreshed plan
          </div>
          {refreshedGoals.length > 0 && (
            <ReviewGroup title={"Goals (" + refreshedGoals.length + ")"} tone="blue">
              {refreshedGoals.map((g, i) => (
                <div key={i} style={{ fontSize: 12, color: C.textPrimary, marginBottom: 6 }}>
                  <div style={{ display: "flex", gap: 4, alignItems: "baseline", flexWrap: "wrap", marginBottom: 2 }}>
                    {g.priority && <Badge label={String(g.priority).toUpperCase()} variant={g.priority === "high" ? "red" : g.priority === "medium" ? "amber" : "neutral"} size="xs" />}
                    {g.source && <Badge label={String(g.source).replace(/_/g, " ").toUpperCase()} variant="neutral" size="xs" />}
                    {g.domain && <span style={{ fontSize: 10, color: C.textTertiary }}>{g.domain}</span>}
                  </div>
                  <strong>{g.goal}</strong>
                  {g.target_date && <div style={{ fontSize: 11, color: C.textTertiary }}>Target: {g.target_date}</div>}
                  {g.rationale && <div style={{ fontSize: 11, color: C.textTertiary }}>{g.rationale}</div>}
                </div>
              ))}
            </ReviewGroup>
          )}
          {refreshedInts.length > 0 && (
            <ReviewGroup title={"Interventions (" + refreshedInts.length + ")"} tone="neutral">
              {refreshedInts.map((iv, i) => (
                <div key={i} style={{ fontSize: 12, color: C.textPrimary, marginBottom: 4 }}>
                  <strong>{iv.intervention}</strong>
                  <div style={{ fontSize: 11, color: C.textTertiary }}>
                    {iv.owner && <span>Owner: {String(iv.owner).replace(/_/g, " ")} </span>}
                    {iv.frequency && <span>/ {iv.frequency}</span>}
                  </div>
                </div>
              ))}
            </ReviewGroup>
          )}
          {refreshedNeeds.length > 0 && (
            <ReviewGroup title={"Unmet needs (" + refreshedNeeds.length + ")"} tone="amber">
              {refreshedNeeds.map((n, i) => (
                <div key={i} style={{ fontSize: 12, color: C.textPrimary, marginBottom: 4 }}>
                  <strong>{n.need}</strong>
                  {n.category && <span style={{ fontSize: 10, color: C.textTertiary }}> ({n.category})</span>}
                  {n.plan_to_address && <div style={{ fontSize: 11, color: C.textTertiary }}>{n.plan_to_address}</div>}
                </div>
              ))}
            </ReviewGroup>
          )}
        </div>
      </div>

      {/* Reviewer overrides */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <div>
          <FL>Next review due</FL>
          <input type="date" value={nextReviewDue} onChange={e => setNextReviewDue(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <FL>Reviewer notes (optional)</FL>
          <input type="text" value={reviewerNotes} onChange={e => setReviewerNotes(e.target.value)} placeholder="Anything worth flagging to supervising CM" style={inputStyle} />
        </div>
      </div>

      {/* Confidence caveats */}
      {confCaveats.length > 0 && (
        <div style={{ marginBottom: 14, padding: 8, background: C.amberBg, border: "0.5px solid " + C.amberBorder, borderRadius: 6, fontSize: 11, color: C.textSecondary }}>
          <strong>Caveats:</strong> {confCaveats.join(" / ")}
        </div>
      )}

      {/* Model footer */}
      {modelMeta && (
        <div style={{ fontSize: 10, color: C.textTertiary, textAlign: "right", marginBottom: 10 }}>
          Drafted {new Date(modelMeta.generated_at).toLocaleString()} / {modelMeta.model}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", paddingTop: 12, borderTop: "0.5px solid " + C.borderLight }}>
        <Btn variant="ghost" size="sm" onClick={onCancel}>Cancel</Btn>
        <Btn variant="primary" size="sm" disabled={saving} onClick={handleAccept}>
          {saving ? "Saving..." : "Accept + create v" + ((priorPlan.version || 1) + 1)}
        </Btn>
      </div>
    </div>
  );
}

// Small helper for AnnualReviewDrafter's review-group tiles.
function ReviewGroup({ title, tone, children }) {
  const border = tone === "green" ? "#86efac" : tone === "red" ? "#fca5a5" : tone === "amber" ? "#fcd34d" : tone === "blue" ? "#7dd3fc" : C.borderLight;
  return (
    <div style={{ marginBottom: 10, paddingLeft: 10, borderLeft: "2px solid " + border }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 4 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReviewSummaryPanel - compact display of a plan's review_summary jsonb.
// Used in PlanDetailModal when looking at a reviewed (v2+) plan to show
// what changed from the prior version. Link to prior plan is informational
// only - the reviewer can navigate by filtering the Plans list.
// ---------------------------------------------------------------------------
function ReviewSummaryPanel({ summary, priorPlanId }) {
  if (!summary || typeof summary !== "object") return null;
  const met       = Array.isArray(summary.goals_met) ? summary.goals_met : [];
  const notMet    = Array.isArray(summary.goals_not_met) ? summary.goals_not_met : [];
  const carried   = Array.isArray(summary.goals_carried_over) ? summary.goals_carried_over : [];
  const removed   = Array.isArray(summary.goals_removed) ? summary.goals_removed : [];
  const keyEvents = Array.isArray(summary.key_events) ? summary.key_events : [];

  return (
    <div style={{ marginTop: 4, marginBottom: 16, padding: 14, background: "#f8fafc", border: "0.5px solid " + C.borderLight, borderRadius: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 8 }}>
        Review summary
        {priorPlanId && (
          <span style={{ marginLeft: 8, fontSize: 10, color: C.textTertiary, fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>
            (superseded prior plan)
          </span>
        )}
      </div>
      {summary.period_covered && (
        <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 6 }}>{summary.period_covered}</div>
      )}
      {summary.overall_assessment && (
        <div style={{ fontSize: 13, color: C.textPrimary, lineHeight: 1.55, marginBottom: 10 }}>
          {summary.overall_assessment}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, marginBottom: 10 }}>
        <ReviewStat label="Met"      value={met.length}     tone="green" />
        <ReviewStat label="Not met"  value={notMet.length}  tone="red" />
        <ReviewStat label="Carried"  value={carried.length} tone="blue" />
        <ReviewStat label="Removed"  value={removed.length} tone="neutral" />
      </div>
      {keyEvents.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 4 }}>
            Key events during period
          </div>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: C.textPrimary }}>
            {keyEvents.map((ev, i) => <li key={i}>{ev}</li>)}
          </ul>
        </div>
      )}
      {summary.reviewer_notes && (
        <div style={{ marginTop: 10, fontSize: 12, color: C.textSecondary, fontStyle: "italic" }}>
          Reviewer notes: {summary.reviewer_notes}
        </div>
      )}
      {summary.ai_generated && (
        <div style={{ marginTop: 10, fontSize: 10, color: C.textTertiary, borderTop: "0.5px solid " + C.borderLight, paddingTop: 6 }}>
          AI-drafted {summary.ai_generated_at ? new Date(summary.ai_generated_at).toLocaleDateString() : ""}
          {summary.ai_model ? " / " + summary.ai_model : ""}
        </div>
      )}
    </div>
  );
}

function ReviewStat({ label, value, tone }) {
  const color = tone === "green" ? "#047857" : tone === "red" ? "#dc2626" : tone === "blue" ? "#0369a1" : C.textSecondary;
  return (
    <div style={{ padding: "6px 10px", background: C.bgPrimary, border: "0.5px solid " + C.borderLight, borderRadius: 6 }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textTertiary }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: color, lineHeight: 1 }}>{value}</div>
    </div>
  );
}

