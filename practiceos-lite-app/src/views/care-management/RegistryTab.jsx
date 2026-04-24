import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../auth/AuthProvider";
import { C } from "../../lib/tokens";
import { Badge, Btn, Card, Loader, EmptyState, ErrorBanner } from "../../components/ui";
import { stalenessBand, isBillableByPlan, isPastBillingRiskDay } from "../../lib/cmCadence";
import {
  KpiCard, StatusBadge, AcuityBadge, PlanTypeBadge, RiskBadge,
  FilterPill, Th, Td, StaleDaysBadge, selectStyle
} from "./shared";
import EnrollmentDetail from "./EnrollmentDetail";
import NewEnrollmentModal from "./NewEnrollmentModal";

// ===============================================================================
// RegistryTab - caseload view for Care Managers
//
// Shows active enrollments with acuity tier, program, assigned CM, last
// touchpoint date, HOP flag, and a "days since last contact" computed column
// that flags stale engagement. Filterable by acuity, program, status, and
// clinical risk level (including the derived UTR state).
//
// Data merging: pulls cm_enrollments + latest cm_touchpoints per enrollment
// + active cm_enrollment_risk_assessments + cm_enrollment_utr_status view in
// parallel, then composes the row model used by the table and KPIs.
// ===============================================================================

export default function RegistryTab() {
  const { profile } = useAuth();
  const practiceId = profile?.practice_id;

  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [rows, setRows]         = useState([]);
  const [acuityFilter, setAcuityFilter]   = useState("all");
  const [programFilter, setProgramFilter] = useState("all");
  const [statusFilter, setStatusFilter]   = useState("Active");
  const [riskFilter, setRiskFilter]       = useState("all"); // all | attention | critical
  const [selected, setSelected]           = useState(null);
  const [showNewEnroll, setShowNewEnroll] = useState(false);

  // Role gate for enrollment creation. CHW cannot create; Owner/Manager/CM can.
  const role = profile?.role;
  const canCreateEnroll = role && role !== "CHW";

  const load = useCallback(async () => {
    if (!practiceId) return;
    setLoading(true);
    setError(null);
    try {
      // Fetch enrollments + patient names in one call via the embedded FK select.
      const { data: enrollments, error: e1 } = await supabase
        .from("cm_enrollments")
        .select("id, patient_id, program_type, enrollment_status, acuity_tier, health_plan_type, cm_provider_type, payer_name, plan_member_id, enrolled_at, assigned_at, disenrolled_at, disenrollment_reason_code, assigned_care_manager_id, hop_eligible, hop_active, patients(first_name, last_name, date_of_birth)")
        .eq("practice_id", practiceId)
        .order("enrollment_status", { ascending: true })
        .order("acuity_tier",        { ascending: true })
        .order("enrolled_at",        { ascending: false });
      if (e1) throw e1;

      // For each enrollment, pull the max touchpoint_at. Single aggregate query
      // rather than per-row fetches - cheap and keeps the UI snappy.
      const enrIds = (enrollments || []).map(e => e.id);
      let lastTpMap = {};
      let riskMap = {};
      let utrMap = {};
      if (enrIds.length > 0) {
        const { data: tps, error: e2 } = await supabase
          .from("cm_touchpoints")
          .select("enrollment_id, touchpoint_at, successful_contact")
          .in("enrollment_id", enrIds)
          .order("touchpoint_at", { ascending: false });
        if (e2) throw e2;
        // Group manually - pick latest successful per enrollment, fall back to
        // latest attempt if no successful exists.
        // Compute first day of current calendar month (for billing-floor tracking)
        const now0 = new Date();
        const monthStart = new Date(Date.UTC(now0.getUTCFullYear(), now0.getUTCMonth(), 1));

        for (const tp of tps || []) {
          const cur = lastTpMap[tp.enrollment_id];
          if (!cur) {
            lastTpMap[tp.enrollment_id] = {
              last_at: tp.touchpoint_at,
              last_successful_at: tp.successful_contact ? tp.touchpoint_at : null,
              successful_this_month: tp.successful_contact && new Date(tp.touchpoint_at) >= monthStart,
            };
          } else {
            if (tp.successful_contact && !cur.last_successful_at) {
              cur.last_successful_at = tp.touchpoint_at;
            }
            if (tp.successful_contact && new Date(tp.touchpoint_at) >= monthStart) {
              cur.successful_this_month = true;
            }
          }
        }

        // Risk assessments - fetch only active (non-superseded) assessments.
        // Each enrollment has at most one active assessment due to DB trigger.
        const { data: risks, error: e3 } = await supabase
          .from("cm_enrollment_risk_assessments")
          .select("id, enrollment_id, risk_level, risk_score, headline, narrative, risk_factors, protective_factors, recommended_interventions, suggested_next_contact_by, confidence, assessed_at, acknowledged_at, acknowledged_by, dismissed_at, dismissed_by, dismissed_reason, trigger_reason, model, prompt_version")
          .in("enrollment_id", enrIds)
          .is("superseded_at", null);
        if (e3) throw e3;
        for (const r of risks || []) {
          riskMap[r.enrollment_id] = r;
        }

        // UTR (Unable to Reach) derived state - 3+ unsuccessful attempts with
        // no successful contact in between. Computed by cm_enrollment_utr_status
        // view. Threshold hardcoded 3 in v1; onboarding wizard will make this
        // practice-configurable later.
        const { data: utrs, error: e4 } = await supabase
          .from("cm_enrollment_utr_status")
          .select("enrollment_id, is_utr, unsuccessful_attempts, first_attempt_at, last_attempt_at, last_success_at")
          .in("enrollment_id", enrIds);
        if (e4) throw e4;
        for (const u of utrs || []) {
          utrMap[u.enrollment_id] = u;
        }
      }

      // Merge and compute days-since + enrollment-age (for Pending staleness rule)
      const now = new Date();
      const merged = (enrollments || []).map(e => {
        const tp = lastTpMap[e.id] || {};
        const lastAt = tp.last_successful_at || tp.last_at || null;
        const days = lastAt ? Math.floor((now - new Date(lastAt)) / (1000 * 60 * 60 * 24)) : null;
        // Days since enrollment was created - used for Pending staleness.
        const enrolledAt = e.enrolled_at ? new Date(e.enrolled_at) : null;
        const daysSinceEnrolled = enrolledAt ? Math.floor((now - enrolledAt) / (1000 * 60 * 60 * 24)) : null;
        return {
          ...e,
          last_touchpoint_at: lastAt,
          days_since_contact: days,
          days_since_enrolled: daysSinceEnrolled,
          has_contact_this_month: !!tp.successful_this_month,
          risk: riskMap[e.id] || null,
          utr: utrMap[e.id] || null,
        };
      });
      setRows(merged);
    } catch (err) {
      setError(err.message || "Failed to load registry");
    } finally {
      setLoading(false);
    }
  }, [practiceId]);

  useEffect(() => { load(); }, [load]);

  // Helper: is an enrollment currently "flagged at risk"?
  // Definition: has an active risk assessment at medium+ AND not dismissed.
  // Acknowledged assessments still count as flagged (they're on the queue
  // until dismissed or superseded with a lower-risk reassessment).
  const isRiskFlagged = (r) => {
    const risk = r.risk;
    if (!risk) return false;
    if (risk.dismissed_at) return false;
    return risk.risk_level === "medium" || risk.risk_level === "high" || risk.risk_level === "critical";
  };

  // Compute filter + KPI values against the loaded rows
  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (statusFilter  !== "all" && r.enrollment_status !== statusFilter)  return false;
      if (acuityFilter  !== "all" && r.acuity_tier       !== acuityFilter)  return false;
      if (programFilter !== "all" && r.program_type      !== programFilter) return false;
      if (riskFilter === "attention") {
        if (!isRiskFlagged(r)) return false;
      } else if (riskFilter === "critical") {
        if (!r.risk || r.risk.dismissed_at || r.risk.risk_level !== "critical") return false;
      } else if (riskFilter === "utr") {
        if (!r.utr || !r.utr.is_utr) return false;
      }
      return true;
    });
  }, [rows, statusFilter, acuityFilter, programFilter, riskFilter]);

  const kpis = useMemo(() => {
    const active  = rows.filter(r => r.enrollment_status === "Active");
    const pending = rows.filter(r => r.enrollment_status === "Pending");

    // needsAttention = Active rows in Amber or Red band per acuity-aware thresholds
    //                  UNION Pending rows 14+ days old with no successful contact (Rule B)
    //                  UNION Active rows with 0 successful contacts this calendar month
    //                        once we are past day 20 of the month (billing at risk).
    // See stalenessBand() for threshold rationale. These numbers are calibrated against
    // the TCM Provider Manual (monthly billing floor + 3-contacts/month rate assumption).
    const pastDay20 = isPastBillingRiskDay();
    const needsAttention = new Set();

    for (const r of active) {
      const band = stalenessBand(r.acuity_tier, r.days_since_contact, r.health_plan_type);
      if (band === "amber" || band === "red") needsAttention.add(r.id);
      // BILL RISK only counts for Tailored Plan (monthly billing floor).
      if (pastDay20 && !r.has_contact_this_month && isBillableByPlan(r.health_plan_type)) {
        needsAttention.add(r.id);
      }
    }
    for (const r of pending) {
      const tooOld = r.days_since_enrolled !== null && r.days_since_enrolled >= 14;
      const noSuccess = !r.last_touchpoint_at || r.days_since_contact === null;
      // If pending 14+ days AND no last contact at all, flag as outreach overdue.
      // (If they have any contact, even an attempt, we respect that and do not flag yet.)
      if (tooOld && noSuccess) needsAttention.add(r.id);
    }

    const billingAtRisk = active.filter(r => pastDay20 && !r.has_contact_this_month && isBillableByPlan(r.health_plan_type)).length;

    // AI risk counts - only count non-dismissed active-enrollment members
    const aiFlagged  = active.filter(r => isRiskFlagged(r));
    const aiCritical = aiFlagged.filter(r => r.risk && r.risk.risk_level === "critical").length;

    // UTR count - Active or Pending members with 3+ unsuccessful attempts
    // and no successful contact in that window. Signals practice can't reach.
    const utrCount = rows.filter(r => r.utr && r.utr.is_utr).length;

    return {
      total:           rows.length,
      active:          active.length,
      high:            active.filter(r => r.acuity_tier === "High").length,
      moderate:        active.filter(r => r.acuity_tier === "Moderate").length,
      low:             active.filter(r => r.acuity_tier === "Low").length,
      pending:         pending.length,
      stale:           needsAttention.size,
      billing_at_risk: billingAtRisk,
      ai_flagged:      aiFlagged.length,
      ai_critical:     aiCritical,
      utr:             utrCount,
      hop:             active.filter(r => r.hop_active).length,
    };
  }, [rows]);

  if (loading) return <Loader label="Loading caseload..." />;

  return (
    <div>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
        <KpiCard label="Active caseload"  value={kpis.active}   hint={kpis.pending + " pending enrollment"} />
        <KpiCard label="High acuity"      value={kpis.high}     hint="Active enrollments"  variant="amber" />
        <KpiCard label="Needs attention"  value={kpis.stale}    hint={kpis.billing_at_risk > 0 ? (kpis.billing_at_risk + " at billing risk this month") : "Overdue vs acuity-tier cadence"} variant={kpis.stale > 0 ? "amber" : "neutral"} />
        <KpiCard label="AI flagged"       value={kpis.ai_flagged} hint={kpis.ai_critical > 0 ? (kpis.ai_critical + " critical") : "Medium+ risk, not dismissed"} variant={kpis.ai_critical > 0 ? "red" : (kpis.ai_flagged > 0 ? "amber" : "neutral")} />
        <KpiCard label="HOP active"       value={kpis.hop}      hint="HRSN interventions"  variant="blue" />
      </div>

      {/* Filter bar */}
      <Card style={{ padding: 12, marginBottom: 16, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textTertiary }}>Status</span>
          <FilterPill active={statusFilter === "Active"}      onClick={() => setStatusFilter("Active")}>Active</FilterPill>
          <FilterPill active={statusFilter === "Pending"}     onClick={() => setStatusFilter("Pending")}>Pending</FilterPill>
          <FilterPill active={statusFilter === "Disenrolled"} onClick={() => setStatusFilter("Disenrolled")}>Disenrolled</FilterPill>
          <FilterPill active={statusFilter === "all"}         onClick={() => setStatusFilter("all")}>All</FilterPill>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textTertiary }}>Acuity</span>
          <FilterPill active={acuityFilter === "all"}      onClick={() => setAcuityFilter("all")}>All</FilterPill>
          <FilterPill active={acuityFilter === "High"}     onClick={() => setAcuityFilter("High")}>High</FilterPill>
          <FilterPill active={acuityFilter === "Moderate"} onClick={() => setAcuityFilter("Moderate")}>Moderate</FilterPill>
          <FilterPill active={acuityFilter === "Low"}      onClick={() => setAcuityFilter("Low")}>Low</FilterPill>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textTertiary }}>Program</span>
          <select value={programFilter} onChange={e => setProgramFilter(e.target.value)} style={{ ...selectStyle, width: "auto", minWidth: 150 }}>
            <option value="all">All programs</option>
            <option value="TCM">TCM</option>
            <option value="AMH Plus">AMH Plus</option>
            <option value="AMH Tier 3">AMH Tier 3</option>
            <option value="CMA">CMA</option>
            <option value="CIN CM">CIN CM</option>
            <option value="General Engagement">General Engagement</option>
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textTertiary }}>Risk</span>
          <FilterPill active={riskFilter === "all"}       onClick={() => setRiskFilter("all")}>All</FilterPill>
          <FilterPill active={riskFilter === "attention"} onClick={() => setRiskFilter("attention")}>At risk</FilterPill>
          <FilterPill active={riskFilter === "critical"}  onClick={() => setRiskFilter("critical")}>Critical</FilterPill>
          <FilterPill active={riskFilter === "utr"}       onClick={() => setRiskFilter("utr")}>UTR</FilterPill>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {canCreateEnroll && (
            <Btn variant="primary" size="sm" onClick={() => setShowNewEnroll(true)}>+ New enrollment</Btn>
          )}
          <Btn variant="outline" size="sm" onClick={load}>Refresh</Btn>
        </div>
      </Card>

      {/* Registry table */}
      {filtered.length === 0 ? (
        <EmptyState
          title={rows.length === 0 ? "No enrollments yet" : "No matching enrollments"}
          message={rows.length === 0
            ? "Create your first Care Management enrollment to build the caseload. Enrollment creation UI is on the roadmap - for now, enrollments are seeded via database or PRL import."
            : "Try relaxing the filters above. You can also view Disenrolled records for historical context."}
        />
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead style={{ background: C.bgSecondary, borderBottom: "0.5px solid " + C.borderLight }}>
              <tr>
                <Th>Patient</Th>
                <Th>Plan</Th>
                <Th>Program</Th>
                <Th>Acuity</Th>
                <Th>Status</Th>
                <Th>Risk</Th>
                <Th>Payer</Th>
                <Th align="right">Last contact</Th>
                <Th align="right">Days</Th>
                <Th>Flags</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, idx) => (
                <tr key={r.id} onClick={() => setSelected(r)} style={{
                  borderBottom: idx < filtered.length - 1 ? "0.5px solid " + C.borderLight : "none",
                  cursor: "pointer",
                  background: selected?.id === r.id ? C.tealBg : "transparent",
                }}>
                  <Td>
                    <div style={{ fontWeight: 600 }}>{r.patients?.last_name || ""}, {r.patients?.first_name || ""}</div>
                    {r.plan_member_id && <div style={{ fontSize: 11, color: C.textTertiary, fontFamily: "monospace", marginTop: 2 }}>{r.plan_member_id}</div>}
                  </Td>
                  <Td><PlanTypeBadge planType={r.health_plan_type} /></Td>
                  <Td>
                    <div>{r.program_type}</div>
                    {r.cm_provider_type && <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>{r.cm_provider_type}</div>}
                  </Td>
                  <Td><AcuityBadge tier={r.acuity_tier} /></Td>
                  <Td><StatusBadge status={r.enrollment_status} /></Td>
                  <Td><RiskBadge risk={r.risk} /></Td>
                  <Td style={{ fontSize: 12 }}>{r.payer_name}</Td>
                  <Td align="right" style={{ fontSize: 12, color: C.textSecondary }}>
                    {r.last_touchpoint_at ? new Date(r.last_touchpoint_at).toLocaleDateString() : "-"}
                  </Td>
                  <Td align="right">
                    <StaleDaysBadge days={r.days_since_contact} status={r.enrollment_status} acuity={r.acuity_tier} planType={r.health_plan_type} />
                  </Td>
                  <Td>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {r.utr && r.utr.is_utr && (
                        <span title={r.utr.unsuccessful_attempts + " unsuccessful attempts" + (r.utr.first_attempt_at ? " since " + new Date(r.utr.first_attempt_at).toLocaleDateString() : "")}>
                          <Badge label="UTR" variant="red" size="xs" />
                        </span>
                      )}
                      {r.enrollment_status === "Active" && !r.has_contact_this_month && isPastBillingRiskDay() && isBillableByPlan(r.health_plan_type) && (
                        <Badge label="BILL RISK" variant="red" size="xs" />
                      )}
                      {r.hop_active && <Badge label="HOP" variant="blue" size="xs" />}
                      {r.hop_eligible && !r.hop_active && <Badge label="HOP eligible" variant="neutral" size="xs" />}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {selected && (
        <EnrollmentDetail
          enrollment={selected}
          onClose={() => setSelected(null)}
          onUpdated={() => { setSelected(null); load(); }}
          onRiskChanged={load}
        />
      )}
      {showNewEnroll && (
        <NewEnrollmentModal
          practiceId={practiceId}
          userId={profile?.id}
          onClose={() => setShowNewEnroll(false)}
          onCreated={() => { setShowNewEnroll(false); load(); }}
        />
      )}
    </div>
  );
}
