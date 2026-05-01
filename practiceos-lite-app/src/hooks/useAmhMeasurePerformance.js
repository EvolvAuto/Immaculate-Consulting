// src/hooks/useAmhMeasurePerformance.js
//
// Data hook for the AMH Quality Measure Dashboard tab.
//
// Loads in parallel:
//   1. cm_hedis_measures filtered to AMH measure set for the year (catalog)
//   2. cm_amh_measure_performance_snapshots for practice + MY (rates)
//   3. nc_amh_reference_targets for the year (NC benchmarks + disparity targets)
//   4. cm_vbp_contracts + cm_vbp_contract_measures for practice + MY (enrichment)
//
// Returns an "assembled" array of per-measure objects with everything the UI
// needs to render a card and its drill-in panel - practice rate, plan rates,
// stratum rates, NC targets, and any VBP contract attachments.
//
// refresh() calls public.refresh_amh_dashboard_for_caller() which recomputes
// the snapshot rows for the caller's practice + current calendar year, then
// refetches.
//
// Keep snapshot reads scoped tight - we filter on (practice_id, measurement_year)
// and let the idx_cm_amh_perf_unique index do the heavy lifting. The full snapshot
// set for one practice + one MY is at most ~200 rows (13 measures x ~15 scopes),
// so client-side assembly is cheap.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

// What we read from each table. Joined as comma-separated strings since
// supabase-js treats them as PostgREST select expressions.
const MEASURE_COLS = [
  "measure_code",
  "measure_name",
  "measure_kind",
  "classification_status",
  "amh_measure_set_year",
  "sub_components",
  "active",
].join(", ");

const SNAPSHOT_COLS = [
  "measure_code",
  "submeasure",
  "scope",
  "payer_short_name",
  "priority_population",
  "numerator",
  "denominator",
  "rate",
  "gaps_open",
  "gaps_closed",
  "direction",
  "snapshot_date",
  "computed_at",
].join(", ");

const TARGET_COLS = [
  "measure_code",
  "submeasure",
  "scope",
  "payer_short_name",
  "priority_population",
  "baseline_rate",
  "target_rate",
  "goal_benchmark",
  "direction",
  "has_disparity",
  "relative_difference_pct",
  "reference_group_rate",
  "notes",
].join(", ");

// Measures whose rates are calculated by the Health Plan or EQRO, NOT by the
// practice. The dashboard renders an "Awaiting Plan Report" badge for these
// when no data has been received via HEDIS gap files yet.
//   AAP - plan-reported starting MY2025
//   PCR - EQRO-calculated, observed/expected ratio
const PLAN_REPORTED_MEASURES = new Set(["AAP", "PCR"]);

// Measures that require clinical data NC has flagged as not yet collectible
// at the AMH level via current data flows. The dashboard renders an
// "Awaiting Clinical Data" badge.
//   CDF - depression screening (PHQ-2/PHQ-9), needs chart capture
const AWAITING_CLINICAL_MEASURES = new Set(["CDF"]);

// Measures using NC's "beat-the-trend" methodology. No fixed target rate -
// the goal is to beat declining national trends. UI shows trajectory only,
// no delta vs target.
const BEAT_THE_TREND_MEASURES = new Set(["CIS-E"]);

export function useAmhMeasurePerformance(practiceId, measurementYear) {
  const [measures, setMeasures]                       = useState([]);
  const [snapshots, setSnapshots]                     = useState([]);
  const [targets, setTargets]                         = useState([]);
  const [vbpContracts, setVbpContracts]               = useState([]);
  const [vbpContractMeasures, setVbpContractMeasures] = useState([]);
  const [loading, setLoading]                         = useState(true);
  const [error, setError]                             = useState(null);
  const [refreshing, setRefreshing]                   = useState(false);

  const fetchAll = useCallback(async () => {
    if (!practiceId || !measurementYear) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    try {
      // Run the four core reads in parallel
      const [mRes, sRes, tRes, cRes] = await Promise.all([
        supabase
          .from("cm_hedis_measures")
          .select(MEASURE_COLS)
          .contains("amh_measure_set_year", [measurementYear])
          .eq("active", true)
          .order("measure_code"),
        supabase
          .from("cm_amh_measure_performance_snapshots")
          .select(SNAPSHOT_COLS)
          .eq("practice_id", practiceId)
          .eq("measurement_year", measurementYear)
          .order("snapshot_date", { ascending: false }),
        supabase
          .from("nc_amh_reference_targets")
          .select(TARGET_COLS)
          .eq("measurement_year", measurementYear),
        supabase
          .from("cm_vbp_contracts")
          .select("id, payer_short_name, measurement_year, status, contract_label, program_type, payment_methodology, hcp_lan_category, effective_start, effective_end")
          .eq("practice_id", practiceId)
          .eq("measurement_year", measurementYear)
          .in("status", ["Active", "Executed", "Signed"]),
      ]);

      if (mRes.error) throw new Error("Measure catalog: " + mRes.error.message);
      if (sRes.error) throw new Error("Performance snapshots: " + sRes.error.message);
      if (tRes.error) throw new Error("Reference targets: " + tRes.error.message);

      // VBP query is enrichment - if it fails, the dashboard still renders.
      // Most likely failure mode is a deferred RLS policy on cm_vbp_contracts;
      // that should not block clinical staff from seeing measure performance.
      let contractRows = [];
      let contractMeasureRows = [];
      if (cRes.error) {
        console.warn("[AMH dashboard] VBP contracts query failed:", cRes.error.message);
      } else {
        contractRows = cRes.data || [];
        if (contractRows.length > 0) {
          const contractIds = contractRows.map(c => c.id);
          const { data: cmData, error: cmErr } = await supabase
            .from("cm_vbp_contract_measures")
            .select("contract_id, measure_code, target_type, target_value, target_unit, weight, payment_rule, denominator_min, status, notes, measurement_period_label")
            .in("contract_id", contractIds)
            .neq("status", "Removed");
          if (cmErr) {
            console.warn("[AMH dashboard] VBP contract measures query failed:", cmErr.message);
          } else {
            contractMeasureRows = cmData || [];
          }
        }
      }

      setMeasures(mRes.data || []);
      setSnapshots(sRes.data || []);
      setTargets(tRes.data || []);
      setVbpContracts(contractRows);
      setVbpContractMeasures(contractMeasureRows);
    } catch (e) {
      setError(e.message || String(e));
      setMeasures([]);
      setSnapshots([]);
      setTargets([]);
      setVbpContracts([]);
      setVbpContractMeasures([]);
    }
    setLoading(false);
  }, [practiceId, measurementYear]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Refresh button handler. Calls SECURITY DEFINER RPC then refetches.
  // The RPC computes for the caller's practice + current calendar year, so
  // a refresh from the MY2025 view still recomputes the current MY's data.
  // After recompute, fetchAll re-reads using whatever measurementYear is
  // currently selected.
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const { error: rpcErr } = await supabase.rpc("refresh_amh_dashboard_for_caller");
      if (rpcErr) throw new Error(rpcErr.message);
      await fetchAll();
    } catch (e) {
      setError("Refresh failed: " + (e.message || String(e)));
    }
    setRefreshing(false);
  }, [fetchAll]);

  // -----------------------------------------------------------------------
  // Index helpers - build lookup maps once, reuse across the assembly loop
  // -----------------------------------------------------------------------

  // Snapshots indexed by measure_code
  const snapshotsByMeasure = useMemo(() => {
    const idx = new Map();
    for (const s of snapshots) {
      const key = s.measure_code;
      if (!idx.has(key)) idx.set(key, []);
      idx.get(key).push(s);
    }
    return idx;
  }, [snapshots]);

  // Targets indexed by measure_code
  const targetsByMeasure = useMemo(() => {
    const idx = new Map();
    for (const t of targets) {
      const key = t.measure_code;
      if (!idx.has(key)) idx.set(key, []);
      idx.get(key).push(t);
    }
    return idx;
  }, [targets]);

  // VBP contract measures indexed by measure_code, joined to their parent contract
  const vbpByMeasure = useMemo(() => {
    const contractById = new Map(vbpContracts.map(c => [c.id, c]));
    const idx = new Map();
    for (const cm of vbpContractMeasures) {
      const contract = contractById.get(cm.contract_id);
      if (!contract) continue;
      const key = cm.measure_code;
      if (!idx.has(key)) idx.set(key, []);
      idx.get(key).push({ ...cm, contract });
    }
    return idx;
  }, [vbpContracts, vbpContractMeasures]);

  // -----------------------------------------------------------------------
  // Assemble per-measure objects
  // -----------------------------------------------------------------------
  const assembledMeasures = useMemo(() => {
    return measures.map(m => {
      const code = m.measure_code;
      const measureSnapshots = snapshotsByMeasure.get(code) || [];
      const measureTargets   = targetsByMeasure.get(code) || [];
      const measureVbp       = vbpByMeasure.get(code) || [];

      // Pick the headline submeasure for the card. Preference order:
      //   1. snapshot with submeasure IS NULL (most common - simple measures)
      //   2. snapshot with submeasure ILIKE 'Total%' (composite measures)
      //   3. first submeasure alphabetically
      // Drill-in detail panel shows all submeasures.
      const practiceAggregate = pickPrimarySubmeasure(
        measureSnapshots.filter(s => s.scope === "practice_aggregate")
      );

      // Plan-filtered snapshots for the same submeasure pick
      const planRates = measureSnapshots
        .filter(s =>
          s.scope === "plan_filtered"
          && sameSubmeasure(s.submeasure, practiceAggregate?.submeasure)
        )
        .map(s => ({
          plan: s.payer_short_name,
          rate: s.rate != null ? Number(s.rate) : null,
          numerator: s.numerator,
          denominator: s.denominator,
          gaps_open: s.gaps_open,
          gaps_closed: s.gaps_closed,
        }))
        .sort((a, b) => (a.plan || "").localeCompare(b.plan || ""));

      // Priority-population stratification snapshots for the same submeasure
      const stratumRates = measureSnapshots
        .filter(s =>
          s.scope === "priority_population"
          && sameSubmeasure(s.submeasure, practiceAggregate?.submeasure)
        )
        .map(s => ({
          population: s.priority_population,
          rate: s.rate != null ? Number(s.rate) : null,
          numerator: s.numerator,
          denominator: s.denominator,
        }))
        .sort((a, b) => stratumOrder(a.population) - stratumOrder(b.population));

      // All submeasures (for drill-in)
      const submeasureRows = measureSnapshots
        .filter(s => s.scope === "practice_aggregate")
        .map(s => ({
          submeasure: s.submeasure,
          rate: s.rate != null ? Number(s.rate) : null,
          numerator: s.numerator,
          denominator: s.denominator,
          gaps_open: s.gaps_open,
          gaps_closed: s.gaps_closed,
          direction: s.direction,
        }));

      // Targets - find overall_nc base, plan-specific, and priority-population.
      // Match against the same submeasure as the practice aggregate so the UI
      // shows like-vs-like (e.g. PPC Postpartum target paired with PPC
      // Postpartum practice rate).
      const overallNcTarget = measureTargets.find(t =>
        t.scope === "overall_nc"
        && t.priority_population == null
        && sameSubmeasure(t.submeasure, practiceAggregate?.submeasure)
      );
      const planTargets = {};
      for (const t of measureTargets) {
        if (t.scope === "plan_specific"
            && t.priority_population == null
            && sameSubmeasure(t.submeasure, practiceAggregate?.submeasure)) {
          planTargets[t.payer_short_name] = {
            target_rate: t.target_rate != null ? Number(t.target_rate) : null,
            baseline_rate: t.baseline_rate != null ? Number(t.baseline_rate) : null,
            goal_benchmark: t.goal_benchmark,
          };
        }
      }
      const priorityPopulationTargets = {};
      for (const t of measureTargets) {
        if (t.priority_population != null
            && t.scope === "overall_nc"
            && sameSubmeasure(t.submeasure, practiceAggregate?.submeasure)) {
          priorityPopulationTargets[t.priority_population] = {
            target_rate: t.target_rate != null ? Number(t.target_rate) : null,
            has_disparity: !!t.has_disparity,
            relative_difference_pct: t.relative_difference_pct != null
              ? Number(t.relative_difference_pct) : null,
            reference_group_rate: t.reference_group_rate != null
              ? Number(t.reference_group_rate) : null,
          };
        }
      }

      // Performance status vs NC overall target
      const direction = practiceAggregate?.direction
        || (BEAT_THE_TREND_MEASURES.has(code) ? "beat_the_trend" : "higher_is_better");
      const targetForStatus = overallNcTarget?.target_rate != null
        ? Number(overallNcTarget.target_rate) : null;
      const practiceRate = practiceAggregate?.rate != null
        ? Number(practiceAggregate.rate) : null;
      const status = computeStatus({
        practiceRate,
        targetForStatus,
        direction,
        isPlanReported: PLAN_REPORTED_MEASURES.has(code),
        isAwaitingClinical: AWAITING_CLINICAL_MEASURES.has(code),
        isBeatTheTrend: BEAT_THE_TREND_MEASURES.has(code),
        hasData: !!practiceAggregate,
      });

      // Disparity flag: true if any priority population target is set with
      // has_disparity = true AND the practice's stratum rate is below it
      // (relative threshold not re-evaluated client-side - we trust NC's flag).
      const hasDisparity = stratumRates.some(sr => {
        const tgt = priorityPopulationTargets[sr.population];
        return !!(tgt && tgt.has_disparity);
      });

      // Trend: monthly snapshots for this measure + submeasure across the MY
      const trend = measureSnapshots
        .filter(s =>
          s.scope === "practice_aggregate"
          && sameSubmeasure(s.submeasure, practiceAggregate?.submeasure)
        )
        .map(s => ({
          snapshot_date: s.snapshot_date,
          rate: s.rate != null ? Number(s.rate) : null,
        }))
        .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));

      return {
        measure_code: code,
        measure_name: m.measure_name,
        submeasure: practiceAggregate?.submeasure || null,
        measure_kind: m.measure_kind,
        sub_components: m.sub_components,
        direction,
        is_plan_reported: PLAN_REPORTED_MEASURES.has(code),
        is_awaiting_clinical: AWAITING_CLINICAL_MEASURES.has(code),
        is_beat_the_trend: BEAT_THE_TREND_MEASURES.has(code),

        practice_rate: practiceRate,
        practice_numerator: practiceAggregate?.numerator ?? null,
        practice_denominator: practiceAggregate?.denominator ?? null,
        practice_gaps_open: practiceAggregate?.gaps_open ?? 0,
        practice_gaps_closed: practiceAggregate?.gaps_closed ?? 0,

        plan_rates: planRates,
        stratum_rates: stratumRates,
        submeasure_rows: submeasureRows,
        trend,

        nc_overall_target: overallNcTarget?.target_rate != null
          ? Number(overallNcTarget.target_rate) : null,
        nc_overall_baseline: overallNcTarget?.baseline_rate != null
          ? Number(overallNcTarget.baseline_rate) : null,
        nc_overall_goal_benchmark: overallNcTarget?.goal_benchmark || null,
        plan_targets: planTargets,
        priority_population_targets: priorityPopulationTargets,

        vbp_contracts: measureVbp,
        has_vbp_contract: measureVbp.length > 0,
        has_disparity: hasDisparity,
        status,  // 'above', 'near', 'below', 'plan_reported', 'awaiting_clinical', 'beat_the_trend', 'no_data'
      };
    });
  }, [measures, snapshotsByMeasure, targetsByMeasure, vbpByMeasure]);

  // -----------------------------------------------------------------------
  // KPI strip
  // -----------------------------------------------------------------------
  const kpis = useMemo(() => {
    let atOrAbove = 0;
    let belowTarget = 0;
    let disparities = 0;
    for (const m of assembledMeasures) {
      if (m.status === "above") atOrAbove += 1;
      else if (m.status === "below" || m.status === "near") belowTarget += 1;
      if (m.has_disparity) disparities += 1;
    }
    return {
      tracked: assembledMeasures.length,
      atOrAbove,
      belowTarget,
      disparities,
    };
  }, [assembledMeasures]);

  // Latest computed_at across all snapshots - drives the "Last computed" hint
  const lastComputed = useMemo(() => {
    let latest = null;
    for (const s of snapshots) {
      const t = s.computed_at ? new Date(s.computed_at).getTime() : 0;
      if (!latest || t > latest) latest = t;
    }
    return latest ? new Date(latest) : null;
  }, [snapshots]);

  return {
    measures: assembledMeasures,
    kpis,
    lastComputed,
    loading,
    refreshing,
    error,
    refresh,
  };
}

// =============================================================================
// Helpers
// =============================================================================

function pickPrimarySubmeasure(snapshots) {
  if (!snapshots.length) return null;
  const noSub = snapshots.find(s => s.submeasure == null);
  if (noSub) return noSub;
  const total = snapshots.find(s =>
    typeof s.submeasure === "string" && /total/i.test(s.submeasure)
  );
  if (total) return total;
  // Sort alphabetically and pick the first
  const sorted = [...snapshots].sort((a, b) =>
    (a.submeasure || "").localeCompare(b.submeasure || "")
  );
  return sorted[0];
}

function sameSubmeasure(a, b) {
  // Treat null and "" as equivalent (defensive against schema drift)
  const norm = v => (v == null || v === "") ? null : v;
  return norm(a) === norm(b);
}

function stratumOrder(pop) {
  if (pop === "black_aa") return 0;
  if (pop === "aian") return 1;
  if (pop === "hispanic_latino") return 2;
  return 99;
}

// Returns one of:
//   'above'              - meets or exceeds target
//   'near'               - within 5% of target (relative)
//   'below'              - meaningfully below target
//   'plan_reported'      - waiting on plan/EQRO data
//   'awaiting_clinical'  - waiting on chart capture (e.g. CDF)
//   'beat_the_trend'     - CIS-E, no fixed target
//   'no_data'            - no snapshot exists yet
function computeStatus({ practiceRate, targetForStatus, direction, isPlanReported, isAwaitingClinical, isBeatTheTrend, hasData }) {
  if (isAwaitingClinical) return "awaiting_clinical";
  if (isBeatTheTrend) return "beat_the_trend";
  if (!hasData || practiceRate == null) {
    return isPlanReported ? "plan_reported" : "no_data";
  }
  if (targetForStatus == null) return "no_data";

  const meetsTarget = direction === "lower_is_better"
    ? practiceRate <= targetForStatus
    : practiceRate >= targetForStatus;
  if (meetsTarget) return "above";

  const gapPct = Math.abs(practiceRate - targetForStatus) / targetForStatus;
  return gapPct <= 0.05 ? "near" : "below";
}
