import { useState, useEffect, useMemo } from "react";
import { supabase } from "../../lib/supabaseClient";
import { C } from "../../lib/tokens";
import { Badge, Btn, Card, Loader, EmptyState, ErrorBanner } from "../../components/ui";
import { KpiCard, ClaimStatusBadge, VerificationBadge, FilterPill, Th, Td } from "./shared";
import BillingPeriodDetailModal from "./BillingPeriodDetailModal";
import BillingProjectionSection from "./BillingProjectionSection";

// ===============================================================================
// BillingTab - displays cm_billing_periods (one row per enrollment x month).
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
// Claim lifecycle (simplified): Not Ready -> Ready (auto) -> Submitted
//   (manual) -> Paid / Denied. No appeal/void UI in v1.
// ===============================================================================

export default function BillingTab({ practiceId, profile }) {
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

      <BillingProjectionSection practiceId={practiceId} viewedMonth={month} />

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
