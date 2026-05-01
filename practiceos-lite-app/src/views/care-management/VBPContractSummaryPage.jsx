// ═══════════════════════════════════════════════════════════════════════════
// VBPContractSummaryPage.jsx
//
// Read-only summary of a VBP contract. The arrangement-at-a-glance view that
// clinical staff and care managers can land on without risking accidental
// edits. Owners and Managers see an "Edit contract" button that opens the
// existing form page.
//
// Route:
//   /care-management/vbp-contracts/:id/summary
//
// Entry points:
//   - AMH Quality Dashboard "View contract" button (per-measure VBP card)
//   - Future: VBP Contracts list "View" action (alongside Edit)
//
// Layout:
//   1. Header (back, Edit if admin) + identity strip
//   2. Performance at a glance (KPI strip scoped to THIS contract)
//   3. Payment methodology (program type + plain-English summary + notes)
//   4. Eligibility gates (the few that apply)
//   5. Contracted measures (table with target, current rate, status, payment rule)
//   6. Contract notes
//
// Data sources:
//   - cm_vbp_contracts                   (the arrangement)
//   - cm_vbp_contract_measures           (rows in the contract)
//   - cm_hedis_measures                  (measure name lookup, AMH-set flag)
//   - cm_amh_measure_performance_snapshots
//                                        (current rate per measure × plan)
//
// "Current rate" semantics: we display the practice's PLAN-FILTERED rate for
// the contract's payer_short_name, not the practice aggregate rate. The
// arrangement is between the practice and one Health Plan, so the rate that
// matters is the rate among that plan's attributed members.
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../auth/AuthProvider";
import { C } from "../../lib/tokens";
import { Btn, Card, Loader, ErrorBanner, Badge } from "../../components/ui";

// =============================================================================
// Constants
// =============================================================================

// Roles that see the Edit button. Mirrors CareManagementView's ADMIN_ROLES.
const ADMIN_ROLES = new Set(["Owner", "Manager"]);

// Plan label registry. Snapshots store payer_short_name as the canonical
// snake_case key (cch, healthy_blue, etc.); the contract stores the same.
// Keep this map in sync with the dashboard tab's PLAN_LABEL constant.
const PLAN_LABEL = {
  cch:           "Carolina Complete Health",
  healthy_blue:  "Healthy Blue",
  uhc_community: "UHC Community Plan of NC",
  amerihealth:   "Amerihealth Caritas",
  wellcare:      "WellCare (legacy, merged with CCH)",
};

// Program type display labels - human readable, mirrors the form's catalog.
const PROGRAM_TYPE_LABEL = {
  per_gap_closure:     "Per-gap closure",
  per_gap_tiered:      "Per-gap tiered",
  qrt_gate:            "Quality threshold gate",
  shared_savings_pool: "Shared savings pool",
  fee_inflator:        "Fee schedule inflator",
  hybrid:              "Hybrid",
  other:               "Custom",
};

// HCP-LAN APM Framework category labels. Subset shown on the summary - just
// the category code + short name, not the full description.
const HCP_LAN_LABEL = {
  "1":  "1 - FFS",
  "2A": "2A - Foundational",
  "2B": "2B - Pay for reporting",
  "2C": "2C - Pay-for-performance",
  "3A": "3A - Shared savings (upside)",
  "3B": "3B - Shared savings + risk",
  "3N": "3N - Risk, no quality link",
  "4A": "4A - Condition-based pop payment",
  "4B": "4B - Comprehensive pop payment",
  "4C": "4C - Integrated finance + delivery",
  "4N": "4N - Capitated, no quality link",
};

// Lower-is-better measures. Status calculation flips comparison for these.
// Mirrors the compute_amh_measure_performance function's direction logic.
const LOWER_IS_BETTER = new Set(["PCR"]);

// =============================================================================
// Helpers
// =============================================================================

function fmtDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString();
}

function fmtPercent(v) {
  if (v == null) return "--";
  return Number(v).toFixed(1) + "%";
}

function fmtRatio(v) {
  if (v == null) return "--";
  return Number(v).toFixed(2);
}

function fmtRateForMeasure(v, code) {
  if (code === "PCR") return fmtRatio(v);
  return fmtPercent(v);
}

function fmtCurrency(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (isNaN(n)) return null;
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// Find the snapshot row for a given measure code + the contract's plan, with
// preference order: empty/null submeasure (most measures), then "Total*"
// (composite measures like WCV), then first available. Mirrors the headline
// picker in useAmhMeasurePerformance.js so summary + dashboard stay aligned.
function pickHeadlineSnapshot(snapshots, measureCode, plan) {
  const matches = snapshots.filter(s =>
    s.measure_code === measureCode
    && s.scope === "plan_filtered"
    && s.payer_short_name === plan
  );
  if (!matches.length) return null;
  const noSub = matches.find(s => !s.submeasure || s.submeasure === "");
  if (noSub) return noSub;
  const total = matches.find(s =>
    typeof s.submeasure === "string" && /^total/i.test(s.submeasure)
  );
  if (total) return total;
  return matches[0];
}

// Compute contract-status for one measure row. Status semantics here are
// CONTRACT target, not NC reference target - that distinction matters: the
// dashboard cares about NC benchmarks, this page cares about what unlocks
// the practice's incentive payment.
//
// Returns { status, currentValue, currentLabel } where status is one of:
//   "above"   - meets or exceeds contract target
//   "near"    - within 5% relative of target
//   "below"   - meaningfully below target
//   "no_data" - no snapshot, or unsupported target_type for status calc
function computeContractStatus(measureRow, snapshot, contractMy) {
  if (!snapshot) return { status: "no_data", currentValue: null, currentLabel: null };

  const target = measureRow.target_value == null ? null : Number(measureRow.target_value);
  if (target == null || isNaN(target)) {
    return { status: "no_data", currentValue: null, currentLabel: null };
  }

  let currentValue = null;
  let currentLabel = null;
  switch (measureRow.target_type) {
    case "rate":
    case "gap_closure_rate":
      currentValue = snapshot.rate == null ? null : Number(snapshot.rate);
      currentLabel = currentValue == null ? null : fmtRateForMeasure(currentValue, measureRow.measure_code);
      break;
    case "gap_closure_count":
      currentValue = snapshot.gaps_closed ?? 0;
      currentLabel = String(currentValue);
      break;
    case "improvement_count":
      currentValue = snapshot.gaps_closed ?? 0;
      currentLabel = String(currentValue);
      break;
    default:
      // reporting_only, improvement_pct, other - no automatic status calc
      return { status: "no_data", currentValue: null, currentLabel: null };
  }

  if (currentValue == null) {
    return { status: "no_data", currentValue: null, currentLabel: null };
  }

  const direction = LOWER_IS_BETTER.has(measureRow.measure_code) ? "lower_is_better" : "higher_is_better";
  const meets = direction === "lower_is_better" ? currentValue <= target : currentValue >= target;
  if (meets) return { status: "above", currentValue, currentLabel };

  const gapPct = Math.abs(currentValue - target) / target;
  const status = gapPct <= 0.05 ? "near" : "below";
  return { status, currentValue, currentLabel };
}

// Plain-English summary of contract.payment_methodology jsonb. Each branch
// shells out to a per-program-type formatter; unknowns return null and the
// section just hides itself.
function describeMethodology(programType, methodology) {
  const m = methodology || {};
  switch (programType) {
    case "per_gap_closure":
      return "Per-gap closure model. Each contracted measure pays a flat amount per gap closed. See the per-measure rules below for amounts.";
    case "per_gap_tiered": {
      const parts = ["Per-gap tiered model. Members earn payments by reaching tiered targets."];
      if (m.high_priority_designation) parts.push("High Priority designation: " + m.high_priority_designation + ".");
      if (m.retroactive_adjustment_window_days) {
        parts.push("Retroactive eligibility window: " + m.retroactive_adjustment_window_days + " days.");
      }
      return parts.join(" ");
    }
    case "qrt_gate": {
      const parts = ["Quality Rating Threshold (QRT) gate."];
      if (m.quality_threshold_pct != null) {
        parts.push("Threshold: " + m.quality_threshold_pct + "%. Practice must meet or exceed to unlock shared savings.");
      }
      if (m.denominator_min_default != null) parts.push("Default denominator min: " + m.denominator_min_default + ".");
      if (m.shared_savings_terms) parts.push(m.shared_savings_terms);
      return parts.join(" ");
    }
    case "shared_savings_pool": {
      const parts = ["Shared savings pool model."];
      if (m.baseline_pmpm != null) parts.push("Baseline PMPM: $" + m.baseline_pmpm + ".");
      if (m.risk_corridor_pct != null) parts.push("Risk corridor: " + m.risk_corridor_pct + "%.");
      if (m.pool_max_pct_of_baseline != null) parts.push("Pool max: " + m.pool_max_pct_of_baseline + "% of baseline.");
      if (m.case_mix_adjustment_used) parts.push("Case-mix adjustment factor applied by plan.");
      return parts.join(" ");
    }
    case "fee_inflator": {
      const parts = ["Fee schedule inflator model."];
      if (m.applies_to) parts.push("Applies to: " + m.applies_to + ".");
      if (m.fixed_fee_adjustment_pct != null) parts.push("Fixed adjustment: " + m.fixed_fee_adjustment_pct + "%.");
      if (m.measurement_periods?.length) {
        const labels = m.measurement_periods.map(p => p.label).filter(Boolean).join(", ");
        if (labels) parts.push("Measurement periods: " + labels + ".");
      }
      return parts.join(" ");
    }
    case "hybrid":
    case "other":
      return "Custom payment structure. See contract notes for details, or open the contract editor for the full JSON.";
    default:
      return null;
  }
}

// Plain-English summary of cm_vbp_contract_measures.payment_rule jsonb.
// Returns null when the rule has no displayable structure - the row will
// just omit the rule line in that case.
function describePaymentRule(rule) {
  if (!rule || typeof rule !== "object") return null;
  switch (rule.model) {
    case "per_gap": {
      if (rule.amount != null && rule.high_priority_amount != null) {
        return fmtCurrency(rule.amount) + " per closed gap, " + fmtCurrency(rule.high_priority_amount) + " for High Priority members";
      }
      if (rule.amount != null) return fmtCurrency(rule.amount) + " per closed gap";
      return null;
    }
    case "per_gap_tiered": {
      const tiers = rule.tiers || [];
      if (!tiers.length) return null;
      const parts = tiers.map(t => {
        const tierLabel = "T" + (t.tier ?? "?");
        const targetLabel = t.target_pct != null ? t.target_pct + "%" : "?";
        const amtLabel = t.amount != null ? fmtCurrency(t.amount) : "?";
        const hpLabel = t.hp_amount != null ? "/" + fmtCurrency(t.hp_amount) + " HP" : "";
        return tierLabel + " >=" + targetLabel + " -> " + amtLabel + hpLabel;
      });
      return parts.join("  |  ");
    }
    case "weighted_benchmark": {
      const parts = [];
      if (rule.weight != null) parts.push("Weight: " + rule.weight);
      if (rule.benchmark_pct != null) parts.push("Benchmark: " + rule.benchmark_pct + "%");
      if (rule.primary_data_source) parts.push("Source: " + rule.primary_data_source);
      return parts.length ? parts.join(" - ") : null;
    }
    case "improvement_points": {
      const parts = [];
      if (rule.baseline_pct != null) parts.push("Baseline: " + rule.baseline_pct + "%");
      const tiers = rule.tiers || [];
      if (tiers.length) {
        parts.push("Improvement tiers: " + tiers.map(t => "+" + (t.improvement_pp ?? "?") + "pp -> " + (t.points ?? "?") + " pts").join(", "));
      }
      return parts.length ? parts.join(" - ") : null;
    }
    case "fee_inflator":
      if (rule.adjustment_pct != null) return "+" + rule.adjustment_pct + "% rate adjustment when target met";
      return null;
    default:
      return null;
  }
}

// =============================================================================
// Main component
// =============================================================================

export default function VBPContractSummaryPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { practiceId, profile } = useAuth();

  const [contract, setContract] = useState(null);
  const [measures, setMeasures] = useState([]);
  const [measureCatalog, setMeasureCatalog] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const isAdmin = profile?.role && ADMIN_ROLES.has(profile.role);

  const load = useCallback(async () => {
    if (!id || !practiceId) return;
    setLoading(true);
    setError(null);
    try {
      const [cRes, mRes] = await Promise.all([
        supabase.from("cm_vbp_contracts").select("*").eq("id", id).single(),
        supabase.from("cm_vbp_contract_measures")
          .select("*")
          .eq("contract_id", id)
          .order("measurement_period_label", { nullsFirst: true })
          .order("measure_code"),
      ]);
      if (cRes.error) throw cRes.error;
      if (mRes.error) throw mRes.error;

      const contractRow = cRes.data;
      const measureRows = mRes.data || [];

      // Now pull the catalog (for measure names + AMH-set flag) and snapshots
      // (for current rates). We need the contract's measurement_year to scope
      // both queries, which is why this is a second wave.
      const measureCodes = Array.from(new Set(measureRows.map(m => m.measure_code).filter(Boolean)));

      const catPromise = measureCodes.length > 0
        ? supabase.from("cm_hedis_measures")
            .select("measure_code, measure_name, amh_measure_set_year, classification_status")
            .in("measure_code", measureCodes)
        : Promise.resolve({ data: [], error: null });

      const snapPromise = supabase.from("cm_amh_measure_performance_snapshots")
        .select("measure_code, submeasure, scope, payer_short_name, numerator, denominator, rate, gaps_open, gaps_closed, snapshot_date, computed_at")
        .eq("practice_id", practiceId)
        .eq("measurement_year", contractRow.measurement_year)
        .order("snapshot_date", { ascending: false });

      const [catRes, snapRes] = await Promise.all([catPromise, snapPromise]);
      if (catRes.error) throw catRes.error;
      if (snapRes.error) throw snapRes.error;

      setContract(contractRow);
      setMeasures(measureRows);
      setMeasureCatalog(catRes.data || []);
      setSnapshots(snapRes.data || []);
    } catch (e) {
      setError(e.message || "Failed to load contract");
    } finally {
      setLoading(false);
    }
  }, [id, practiceId]);

  useEffect(() => { load(); }, [load]);

  // Assemble per-measure rows: catalog metadata + snapshot rate + status.
  const assembledMeasures = useMemo(() => {
    if (!contract) return [];
    const catByCode = new Map(measureCatalog.map(c => [c.measure_code, c]));
    return measures.map(m => {
      const cat = catByCode.get(m.measure_code);
      const snap = pickHeadlineSnapshot(snapshots, m.measure_code, contract.payer_short_name);
      const { status, currentLabel } = computeContractStatus(m, snap, contract.measurement_year);
      const inAmhSet = !!(cat?.amh_measure_set_year?.includes(contract.measurement_year));
      return {
        ...m,
        measure_name: cat?.measure_name || m.measure_code,
        in_amh_set: inAmhSet,
        classification_status: cat?.classification_status,
        snapshot: snap,
        status,
        current_label: currentLabel,
        payment_rule_summary: describePaymentRule(m.payment_rule),
      };
    });
  }, [contract, measures, measureCatalog, snapshots]);

  // KPI strip scoped to this contract only.
  const kpis = useMemo(() => {
    let above = 0, below = 0, awaiting = 0;
    for (const r of assembledMeasures) {
      if (r.status === "above") above += 1;
      else if (r.status === "below" || r.status === "near") below += 1;
      else awaiting += 1;
    }
    return { total: assembledMeasures.length, above, below, awaiting };
  }, [assembledMeasures]);

  // Eligibility checkboxes - only show ones explicitly set
  const eligibilityFlags = useMemo(() => {
    const e = contract?.eligibility_requirements || {};
    return [
      { label: "EMR data sharing program participation", on: !!e.requires_emr_data_sharing },
      { label: "Monthly data file submission",            on: !!e.monthly_file_required },
      { label: "Provider in good standing",               on: e.good_standing_required !== false },
      { label: "Plan determination is non-disputable",    on: !!e.non_disputable },
    ].filter(f => f.on || Object.prototype.hasOwnProperty.call(e, flagKey(f.label)));
    // Fallback: only include unchecked if the key was explicitly set (rare).
  }, [contract]);

  if (loading) {
    return <div style={{ padding: 40, display: "flex", justifyContent: "center" }}><Loader /></div>;
  }
  if (error) {
    return (
      <div style={{ padding: "20px 24px", maxWidth: 1100, margin: "0 auto" }}>
        <ErrorBanner message={error} />
      </div>
    );
  }
  if (!contract) return null;

  const programLabel = contract.program_type ? (PROGRAM_TYPE_LABEL[contract.program_type] || contract.program_type) : null;
  const planLabel = PLAN_LABEL[contract.payer_short_name] || (contract.payer_short_name || "").toUpperCase();
  const methodologySummary = describeMethodology(contract.program_type, contract.payment_methodology);
  const effectiveStart = fmtDate(contract.effective_start);
  const effectiveEnd = fmtDate(contract.effective_end);

  return (
    <div style={{ padding: "20px 24px", maxWidth: 1100, margin: "0 auto", width: "100%" }}>

      {/* Top bar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 14, flexWrap: "wrap", gap: 12,
      }}>
        <Btn variant="ghost" size="sm" onClick={() => navigate("/care-management", { state: { tab: "vbp" } })}>
          ← Back to contracts
        </Btn>
        {isAdmin ? (
          <Btn variant="outline" size="sm" onClick={() => navigate("/care-management/vbp-contracts/" + contract.id)}>
            Edit contract
          </Btn>
        ) : null}
      </div>

      {/* Identity strip */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: C.textPrimary, margin: 0, lineHeight: 1.2 }}>
          {contract.contract_label || "(unnamed contract)"}
        </h1>
        <div style={{
          display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10,
          marginTop: 8, fontSize: 13, color: C.textSecondary,
        }}>
          <span style={{ color: C.textPrimary, fontWeight: 600 }}>{planLabel}</span>
          <span style={{ color: C.textTertiary }}>·</span>
          <span>MY {contract.measurement_year}</span>
          {contract.status ? (
            <>
              <span style={{ color: C.textTertiary }}>·</span>
              <Badge label={contract.status}
                variant={contract.status === "Active" ? "green" : contract.status === "Draft" ? "neutral" : "blue"}
                size="xs" />
            </>
          ) : null}
          {contract.hcp_lan_category ? (
            <>
              <span style={{ color: C.textTertiary }}>·</span>
              <span title="HCP-LAN APM Framework category">
                HCP-LAN {HCP_LAN_LABEL[contract.hcp_lan_category] || contract.hcp_lan_category}
              </span>
            </>
          ) : null}
          {programLabel ? (
            <>
              <span style={{ color: C.textTertiary }}>·</span>
              <span>{programLabel}</span>
            </>
          ) : null}
        </div>
        {(effectiveStart || effectiveEnd) ? (
          <div style={{ fontSize: 12, color: C.textTertiary, marginTop: 4 }}>
            Effective {effectiveStart || "?"} → {effectiveEnd || "?"}
          </div>
        ) : null}
        {contract.contract_type ? (
          <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 4, fontStyle: "italic" }}>
            {contract.contract_type}
          </div>
        ) : null}
      </div>

      {/* Performance at a glance */}
      <SectionHeading>Performance at a glance</SectionHeading>
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: 12, marginBottom: 20,
      }}>
        <KpiBlock label="Measures in contract" value={kpis.total} hint="rows below" />
        <KpiBlock label="At or above contract target" value={kpis.above}
          hint={kpis.above > 0 ? "earning incentive" : "none yet"}
          accent={kpis.above > 0 ? "green" : "neutral"} />
        <KpiBlock label="Below contract target" value={kpis.below}
          hint={kpis.below > 0 ? "action needed" : "none below"}
          accent={kpis.below > 0 ? "amber" : "neutral"} />
        <KpiBlock label="Awaiting data" value={kpis.awaiting}
          hint={kpis.awaiting > 0 ? "no rate computed yet" : "all measures have rates"}
          accent="neutral" />
      </div>

      {/* Payment methodology */}
      {(programLabel || methodologySummary || contract.notes_payment_methodology) ? (
        <>
          <SectionHeading>Payment methodology</SectionHeading>
          <Card style={{ padding: 14, marginBottom: 20 }}>
            {programLabel ? (
              <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary, marginBottom: 6 }}>
                {programLabel}
              </div>
            ) : null}
            {methodologySummary ? (
              <div style={{ fontSize: 13, color: C.textSecondary, lineHeight: 1.55, marginBottom: contract.notes_payment_methodology ? 10 : 0 }}>
                {methodologySummary}
              </div>
            ) : null}
            {contract.notes_payment_methodology ? (
              <div style={{
                fontSize: 12, color: C.textSecondary, lineHeight: 1.55,
                paddingTop: 10, borderTop: "0.5px solid " + C.borderLight,
                whiteSpace: "pre-wrap",
              }}>
                {contract.notes_payment_methodology}
              </div>
            ) : null}
          </Card>
        </>
      ) : null}

      {/* Eligibility gates - only render section if any flags are set */}
      <EligibilitySectionView contract={contract} />

      {/* Contracted measures */}
      <SectionHeading>Contracted measures</SectionHeading>
      {assembledMeasures.length === 0 ? (
        <Card style={{ padding: 20, marginBottom: 20 }}>
          <div style={{ fontSize: 13, color: C.textSecondary, fontStyle: "italic", textAlign: "center" }}>
            No measures attached to this contract yet.
          </div>
        </Card>
      ) : (
        <Card style={{ padding: 0, marginBottom: 20, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead style={{ background: C.bgSecondary, borderBottom: "0.5px solid " + C.borderLight }}>
              <tr>
                <th style={thStyle}>Measure</th>
                <th style={thStyle}>MP</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Contract target</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Current</th>
                <th style={thStyle}>Status</th>
              </tr>
            </thead>
            <tbody>
              {assembledMeasures.map((m, idx) => (
                <MeasureRow key={m.id || (m.measure_code + ":" + (m.measurement_period_label || "") + ":" + idx)}
                  measure={m}
                  isLast={idx === assembledMeasures.length - 1}
                  onOpenHedis={() =>
                    navigate("/care-management", { state: { tab: "hedis", measureCode: m.measure_code } })
                  } />
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Contract notes */}
      {contract.notes ? (
        <>
          <SectionHeading>Contract notes</SectionHeading>
          <Card style={{ padding: 14, marginBottom: 20 }}>
            <div style={{
              fontSize: 13, color: C.textSecondary, lineHeight: 1.55, whiteSpace: "pre-wrap",
            }}>
              {contract.notes}
            </div>
          </Card>
        </>
      ) : null}

    </div>
  );
}

// =============================================================================
// Eligibility view - extracted because it has its own conditional render logic
// =============================================================================
function EligibilitySectionView({ contract }) {
  const e = contract.eligibility_requirements || {};
  const items = [
    { key: "requires_emr_data_sharing", label: "Requires EMR data-sharing program participation",       value: !!e.requires_emr_data_sharing,  set: "requires_emr_data_sharing" in e },
    { key: "monthly_file_required",     label: "Monthly data file submission required",                  value: !!e.monthly_file_required,      set: "monthly_file_required" in e },
    { key: "good_standing_required",    label: "Provider must remain in good standing",                  value: e.good_standing_required !== false, set: true },
    { key: "non_disputable",            label: "Plan determination of compliance is non-disputable",     value: !!e.non_disputable,             set: "non_disputable" in e },
  ];
  // Only render this section if at least one explicit flag is set OR a numeric default exists.
  const hasContent = items.some(i => i.set)
    || e.denominator_min_default != null
    || e.claims_submission_deadline;
  if (!hasContent) return null;

  return (
    <>
      <SectionHeading>Eligibility gates</SectionHeading>
      <Card style={{ padding: 14, marginBottom: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: items.length ? 0 : 0 }}>
          {items.map(i => (
            <div key={i.key} style={{
              display: "flex", alignItems: "center", gap: 8,
              fontSize: 13, color: i.value ? C.textPrimary : C.textTertiary,
            }}>
              <span style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 16, height: 16, borderRadius: 4,
                background: i.value ? C.tealBg : C.bgSecondary,
                color: i.value ? C.teal : C.textTertiary,
                fontWeight: 700, fontSize: 11,
              }}>
                {i.value ? "✓" : "—"}
              </span>
              <span>{i.label}</span>
            </div>
          ))}
        </div>
        {(e.denominator_min_default != null || e.claims_submission_deadline) ? (
          <div style={{
            marginTop: 12, paddingTop: 10,
            borderTop: "0.5px solid " + C.borderLight,
            fontSize: 12, color: C.textSecondary,
            display: "flex", flexWrap: "wrap", gap: 16,
          }}>
            {e.denominator_min_default != null ? (
              <span>Default denominator min: <strong style={{ color: C.textPrimary }}>{e.denominator_min_default}</strong></span>
            ) : null}
            {e.claims_submission_deadline ? (
              <span>Claims deadline: <strong style={{ color: C.textPrimary }}>{fmtDate(e.claims_submission_deadline)}</strong></span>
            ) : null}
          </div>
        ) : null}
      </Card>
    </>
  );
}

// =============================================================================
// Measure row - rendered once per contracted measure
// =============================================================================
function MeasureRow({ measure, isLast, onOpenHedis }) {
  const m = measure;
  const targetLabel = formatTargetForDisplay(m);

  // Status pill colors keyed off contract status (above/below/near vs contract
  // target). Different from dashboard's "vs NC target" status.
  const statusBadge = m.status === "above" ? { label: "Above target", variant: "green" }
                    : m.status === "near"  ? { label: "Near target",  variant: "amber" }
                    : m.status === "below" ? { label: "Below target", variant: "red" }
                    : { label: "No data",   variant: "neutral" };

  return (
    <>
      <tr style={{ borderBottom: isLast && !m.payment_rule_summary && !m.notes ? "none" : "0.5px solid " + C.borderLight }}>
        <td style={{ ...tdStyle, paddingTop: 12, paddingBottom: m.payment_rule_summary || m.notes ? 4 : 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <code style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: C.teal }}>
              {m.measure_code}
            </code>
            <span style={{ fontSize: 13, color: C.textPrimary }}>{m.measure_name}</span>
            {m.in_amh_set ? <Badge label="AMH" variant="blue" size="xs" /> : <Badge label="Non-AMH" variant="amber" size="xs" />}
            {m.classification_status === "unknown" ? <Badge label="Unknown" variant="amber" size="xs" /> : null}
          </div>
        </td>
        <td style={{ ...tdStyle, fontSize: 12, color: C.textSecondary }}>
          {m.measurement_period_label || "—"}
        </td>
        <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600, color: C.textPrimary, fontFamily: "monospace", fontSize: 13 }}>
          {targetLabel}
        </td>
        <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600, color: m.status === "no_data" ? C.textTertiary : C.textPrimary, fontFamily: "monospace", fontSize: 13 }}>
          {m.current_label || "--"}
        </td>
        <td style={tdStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Badge label={statusBadge.label} variant={statusBadge.variant} size="xs" />
            {m.snapshot && (m.snapshot.gaps_open || 0) > 0 ? (
              <button
                onClick={onOpenHedis}
                style={{
                  fontSize: 11, color: C.teal, background: "transparent",
                  border: "none", cursor: "pointer", textDecoration: "underline",
                  padding: 0, fontFamily: "inherit",
                }}
                title="Open this measure's gaps in HEDIS"
              >
                {m.snapshot.gaps_open} open gap{m.snapshot.gaps_open === 1 ? "" : "s"}
              </button>
            ) : null}
          </div>
        </td>
      </tr>
      {/* Inline payment rule + notes spans the full row width */}
      {(m.payment_rule_summary || m.notes) ? (
        <tr style={{ borderBottom: isLast ? "none" : "0.5px solid " + C.borderLight }}>
          <td colSpan={5} style={{ padding: "0 14px 12px 14px" }}>
            {m.payment_rule_summary ? (
              <div style={{ fontSize: 11, color: C.textSecondary, fontStyle: "italic", marginBottom: m.notes ? 4 : 0 }}>
                Payment rule: {m.payment_rule_summary}
              </div>
            ) : null}
            {m.notes ? (
              <div style={{ fontSize: 11, color: C.textTertiary }}>
                {m.notes}
              </div>
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}

// =============================================================================
// Misc UI primitives - kept inline since they're single-purpose to this file
// =============================================================================
function SectionHeading({ children }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, letterSpacing: "0.08em",
      textTransform: "uppercase", color: C.textTertiary, marginBottom: 10,
    }}>{children}</div>
  );
}

function KpiBlock({ label, value, hint, accent }) {
  const valueColor = accent === "green" ? C.green
                   : accent === "amber" ? C.amberText
                   : accent === "red"   ? C.redText
                   : C.textPrimary;
  return (
    <Card style={{ padding: "14px 16px" }}>
      <div style={{
        fontSize: 11, fontWeight: 600, letterSpacing: "0.06em",
        textTransform: "uppercase", color: C.textSecondary, marginBottom: 6,
      }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: valueColor, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 12, color: C.textTertiary, marginTop: 6 }}>{hint}</div>
    </Card>
  );
}

const thStyle = {
  padding: "10px 14px", textAlign: "left",
  fontSize: 11, fontWeight: 600,
  color: C.textSecondary, letterSpacing: "0.04em",
  textTransform: "uppercase",
};

const tdStyle = {
  padding: "10px 14px",
  verticalAlign: "top",
};

// Format the contract target for display. Combines target_value + target_unit
// in a way that matches the unit semantics (% for rates, $ for currency,
// raw count otherwise).
function formatTargetForDisplay(measureRow) {
  if (measureRow.target_type === "reporting_only") return "—";
  const v = measureRow.target_value;
  if (v == null) return "—";
  const unit = (measureRow.target_unit || "").toLowerCase();
  if (unit === "percent" || unit === "%") return Number(v).toFixed(1) + "%";
  if (unit === "usd" || unit === "$" || unit === "dollars") return fmtCurrency(v) || String(v);
  if (measureRow.measure_code === "PCR") return Number(v).toFixed(2);
  // gap_closure_count - just the number
  if (measureRow.target_type === "gap_closure_count" || measureRow.target_type === "improvement_count") {
    return String(v);
  }
  // Default: show value + unit if any
  return unit ? v + " " + unit : String(v);
}

// Translate a human-readable eligibility flag label to the underlying jsonb
// key. Used by the explicit-flag check that filters items down to ones the
// admin actually set in the form.
function flagKey(label) {
  if (label.startsWith("EMR")) return "requires_emr_data_sharing";
  if (label.startsWith("Monthly")) return "monthly_file_required";
  if (label.startsWith("Provider")) return "good_standing_required";
  if (label.startsWith("Plan determination")) return "non_disputable";
  return "";
}
