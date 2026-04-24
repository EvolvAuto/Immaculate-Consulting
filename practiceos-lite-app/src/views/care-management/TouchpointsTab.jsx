import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../auth/AuthProvider";
import { C } from "../../lib/tokens";
import { Badge, Btn, Card, Modal, Loader, EmptyState, ErrorBanner } from "../../components/ui";
import BatchTouchpointModal from "../../components/BatchTouchpointModal";
import { KpiCard, FilterPill, Th, Td, AcuityBadge, DetailField } from "./shared";
import LogTouchpointModal from "./LogTouchpointModal";

// ===============================================================================
// TouchpointsTab - contact log view for Care Managers and CHWs.
//
// Shows all touchpoints logged for the practice, filterable by date range,
// patient name, care manager, program, and success status. Role-aware:
//   - CHW sees only their own touchpoints (delivered_by_user_id = self)
//   - Care Managers / Supervisors see all practice touchpoints
//
// Append-only: v1 does not allow edit or delete. This matches TCM Provider
// Manual audit expectations (records retention + HIPAA) - mutating touchpoint
// history would break the billing trail.
// ===============================================================================

// Period filter options. Values interpreted in the load() effect:
//   "7d" / "30d" - cutoff = now minus N days
//   "month"      - cutoff = first-of-month (UTC)
//   "all"        - no cutoff
const DATE_RANGE_PRESETS = [
  { key: "7d",    label: "Last 7 days",  days: 7 },
  { key: "30d",   label: "Last 30 days", days: 30 },
  { key: "month", label: "This month",   days: null },
  { key: "all",   label: "All time",     days: null },
];

export default function TouchpointsTab() {
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
