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
// Submeasure handling: many measures (WCV, CHL, GSD, IMA-E, W30, PPC) have
// submeasures - the seed inserts a row per submeasure with values like
// "Total (Ages)", "Ages 3-11", "Total (All Ages)", "Glycemic Status (<8.0%)".
// For card display we anchor on a single "headline" submeasure. Resolution:
//   1. If a snapshot exists, use its submeasure (snapshot drives target lookup)
//   2. If no snapshot exists yet, pick a Total*-style submeasure from the
//      catalog's targets so the card still shows the correct NC target before
//      first compute
//   3. Else fall back to NULL or first-alphabetical
// All submeasure-sensitive matching uses headlineSubmeasure as the join key.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

const MEASURE_COLS = [
  "measure_code", "measure_name", "measure_kind", "classification_status",
  "amh_measure_set_year", "sub_components", "active",
].join(", ");

const SNAPSHOT_COLS = [
  "measure_code", "submeasure", "scope", "payer_short_name", "priority_population",
  "numerator", "denominator", "rate", "gaps_open", "gaps_closed", "direction",
  "snapshot_date", "computed_at",
].join(", ");

const TARGET_COLS = [
  "measure_code", "submeasure", "scope", "payer_short_name", "priority_population",
  "baseline_rate", "target_rate", "goal_benchmark", "direction",
  "has_disparity", "relative_difference_pct", "reference_group_rate", "notes",
].join(", ");

const PLAN_REPORTED_MEASURES     = new Set(["AAP", "PCR"]);
const AWAITING_CLINICAL_MEASURES = new Set(["CDF"]);
const BEAT_THE_TREND_MEASURES    = new Set(["CIS-E"]);

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

  const snapshotsByMeasure = useMemo(() => {
    const idx = new Map();
    for (const s of snapshots) {
      if (!idx.has(s.measure_code)) idx.set(s.measure_code, []);
      idx.get(s.measure_code).push(s);
    }
    return idx;
  }, [snapshots]);

  const targetsByMeasure = useMemo(() => {
    const idx = new Map();
    for (const t of targets) {
      if (!idx.has(t.measure_code)) idx.set(t.measure_code, []);
      idx.get(t.measure_code).push(t);
    }
    return idx;
  }, [targets]);

  const vbpByMeasure = useMemo(() => {
    const contractById = new Map(vbpContracts.map(c => [c.id, c]));
    const idx = new Map();
    for (const cm of vbpContractMeasures) {
      const contract = contractById.get(cm.contract_id);
      if (!contract) continue;
      if (!idx.has(cm.measure_code)) idx.set(cm.measure_code, []);
      idx.get(cm.measure_code).push({ ...cm, contract });
    }
    return idx;
  }, [vbpContracts, vbpContractMeasures]);

  const assembledMeasures = useMemo(() => {
    return measures.map(m => {
      const code = m.measure_code;
      const measureSnapshots = snapshotsByMeasure.get(code) || [];
      const measureTargets   = targetsByMeasure.get(code) || [];
      const measureVbp       = vbpByMeasure.get(code) || [];

      // Anchor submeasure for the headline rate + target.
      // Snapshot wins if present; else fall back to catalog targets so the
      // card has a meaningful NC target at cold-start.
      const practiceAggregate = pickPrimarySubmeasure(
        measureSnapshots.filter(s => s.scope === "practice_aggregate")
      );
      const headlineSubmeasure = practiceAggregate?.submeasure
        ?? pickPreferredTargetSubmeasure(measureTargets);

      const planRates = measureSnapshots
        .filter(s =>
          s.scope === "plan_filtered"
          && sameSubmeasure(s.submeasure, headlineSubmeasure)
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

      const stratumRates = measureSnapshots
        .filter(s =>
          s.scope === "priority_population"
          && sameSubmeasure(s.submeasure, headlineSubmeasure)
        )
        .map(s => ({
          population: s.priority_population,
          rate: s.rate != null ? Number(s.rate) : null,
          numerator: s.numerator,
          denominator: s.denominator,
        }))
        .sort((a, b) => stratumOrder(a.population) - stratumOrder(b.population));

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

      const overallNcTarget = measureTargets.find(t =>
        t.scope === "overall_nc"
        && t.priority_population == null
        && sameSubmeasure(t.submeasure, headlineSubmeasure)
      );
      const planTargets = {};
      for (const t of measureTargets) {
        if (t.scope === "plan_specific"
            && t.priority_population == null
            && sameSubmeasure(t.submeasure, headlineSubmeasure)) {
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
            && sameSubmeasure(t.submeasure, headlineSubmeasure)) {
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

      const hasDisparity = stratumRates.some(sr => {
        const tgt = priorityPopulationTargets[sr.population];
        return !!(tgt && tgt.has_disparity);
      });

      const trend = measureSnapshots
        .filter(s =>
          s.scope === "practice_aggregate"
          && sameSubmeasure(s.submeasure, headlineSubmeasure)
        )
        .map(s => ({
          snapshot_date: s.snapshot_date,
          rate: s.rate != null ? Number(s.rate) : null,
        }))
        .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));

      return {
        measure_code: code,
        measure_name: m.measure_name,
        submeasure: headlineSubmeasure,
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
        status,
      };
    });
  }, [measures, snapshotsByMeasure, targetsByMeasure, vbpByMeasure]);

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
  const sorted = [...snapshots].sort((a, b) =>
    (a.submeasure || "").localeCompare(b.submeasure || "")
  );
  return sorted[0];
}

// Cold-start fallback: when no practice snapshot exists yet, peek at the
// reference targets to find the "headline" submeasure for this measure.
// Same precedence as snapshots: NULL first, then "Total*", then alphabetical.
// Scoped to overall_nc + non-priority-population so we anchor on the base
// reference row.
function pickPreferredTargetSubmeasure(targets) {
  const candidates = targets.filter(t =>
    t.scope === "overall_nc" && t.priority_population == null
  );
  if (!candidates.length) return null;
  const noSub = candidates.find(t => t.submeasure == null);
  if (noSub !== undefined) return null;
  const total = candidates.find(t =>
    typeof t.submeasure === "string" && /total/i.test(t.submeasure)
  );
  if (total) return total.submeasure;
  const sorted = [...candidates].sort((a, b) =>
    (a.submeasure || "").localeCompare(b.submeasure || "")
  );
  return sorted[0]?.submeasure || null;
}

function sameSubmeasure(a, b) {
  const norm = v => (v == null || v === "") ? null : v;
  return norm(a) === norm(b);
}

function stratumOrder(pop) {
  if (pop === "black_aa") return 0;
  if (pop === "aian") return 1;
  if (pop === "hispanic_latino") return 2;
  return 99;
}

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
