// src/views/care-management/AmhQualityDashboardTab.jsx
//
// AMH Quality Measure Dashboard tab for the AMH CM Add-On bundle.
//
// Lives inside CareManagementView. Gating happens at the parent router (this
// tab is part of the AMH Care Management Add-On bundle, not standard Command).
// The Add-on pill in the header signals the positioning until the SKU-based
// gating ships with the onboarding wizard.
//
// Data flow:
//   - Reads cm_amh_measure_performance_snapshots via useAmhMeasurePerformance
//   - The snapshot is computed by public.compute_amh_measure_performance(),
//     which rolls up cm_hedis_member_gap_current
//   - Refresh button calls public.refresh_amh_dashboard_for_caller() RPC,
//     which re-runs the compute for the caller's practice + current MY
//   - NC reference targets come from nc_amh_reference_targets
//   - VBP enrichment from cm_vbp_contracts + cm_vbp_contract_measures
//
// Three views the user can shift between:
//   1. Plan = All (default): practice_aggregate rate vs NC overall target
//   2. Plan = specific PHP: plan-filtered rate vs NC plan-specific target
//      + VBP contract target if one exists for that plan
//   3. View = VBP-Contracted Only: filtered to measures in active contracts,
//      KPI strip flips to financial-impact lens, sorted by gap-to-target
//
// Cross-tab integrations:
//   - "View open gaps" button in drill-in deep-links to HEDIS tab pre-filtered
//   - "View VBP contract" pill in drill-in deep-links to VBP Contracts tab
//   - Both use react-router state pattern matching CareManagementView

import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAmhMeasurePerformance } from "../../hooks/useAmhMeasurePerformance";

// =============================================================================
// Tokens - self-contained for now. Match PlanAssignmentsTab convention; swap
// for the project tokens import later if a sweep is done.
// =============================================================================
const C = {
  teal:           "#0F6E56",
  tealMid:        "#1D9E75",
  tealLight:      "#E1F5EE",
  tealText:       "#085041",
  amber:          "#854F0B",
  amberLight:     "#FAEEDA",
  amberText:      "#633806",
  red:            "#A32D2D",
  redLight:       "#FCEBEB",
  redText:        "#791F1F",
  redBgSoft:      "#FEE2E2",
  blue:           "#185FA5",
  blueLight:      "#E6F1FB",
  blueText:       "#0C447C",
  green:          "#3B6D11",
  greenLight:     "#EAF3DE",
  greenText:      "#27500A",
  gold:           "#B45309",
  goldLight:      "#FEF3C7",
  bgPrimary:      "#ffffff",
  bgSecondary:    "#fafaf8",
  bgTertiary:     "#f5f4f0",
  borderLight:    "#e8e6df",
  borderMid:      "#d3d1c7",
  textPrimary:    "#2c2c2a",
  textSecondary:  "#5f5e5a",
  textTertiary:   "#888780",
};

// =============================================================================
// NC Plan registry - human labels for plan codes appearing in snapshots.
// Keep this list aligned with the NC_HEALTH_PLANS_GROUPED constants. CCH
// merged with WellCare in April 2026 and is reported as a single "cch" key.
// =============================================================================
const PLAN_LABEL = {
  cch:           "Carolina Complete Health",
  healthy_blue:  "Healthy Blue",
  uhc_community: "UHC Community Plan of NC",
  amerihealth:   "Amerihealth Caritas",
  wellcare:      "WellCare (legacy, merged with CCH)",
};

const STRATUM_LABEL = {
  black_aa:        "Black / African American",
  aian:            "American Indian / Alaska Native",
  hispanic_latino: "Hispanic / Latino",
};

const STATUS_FILTERS = [
  { value: "all",       label: "Status: All" },
  { value: "below",     label: "Status: Below Target" },
  { value: "disparity", label: "Status: Disparity Flagged" },
  { value: "awaiting",  label: "Status: Awaiting Data" },
];

const SORT_OPTIONS = [
  { value: "name",        label: "Sort: Measure Name" },
  { value: "performance", label: "Sort: Performance vs Target" },
  { value: "denominator", label: "Sort: Eligible Members" },
];

// =============================================================================
// Helpers
// =============================================================================
function fmtPercent(rate) {
  if (rate == null) return "--";
  return Number(rate).toFixed(1) + "%";
}

function fmtRatio(rate) {
  // PCR uses observed/expected ratios (1.00 = at expectation). Show 2 decimals.
  if (rate == null) return "--";
  return Number(rate).toFixed(2);
}

function fmtRateForMeasure(rate, code) {
  if (code === "PCR") return fmtRatio(rate);
  return fmtPercent(rate);
}

function fmtTimeAgo(date) {
  if (!date) return "never";
  const d = (date instanceof Date) ? date : new Date(date);
  const ms = Date.now() - d.getTime();
  const mins  = Math.floor(ms / 60000);
  const hours = Math.floor(ms / 3600000);
  const days  = Math.floor(ms / 86400000);
  if (mins  < 1)  return "just now";
  if (mins  < 60) return mins  + "m ago";
  if (hours < 24) return hours + "h ago";
  return days + "d ago";
}

// Computes the delta between practice rate and target. Returns a string with
// sign for display (e.g. "+6.2", "-4.5"). Respects direction: for lower-is-better
// measures (PCR, GSD >9.0%), a lower rate is "above" target (positive delta).
function computeDeltaLabel(practiceRate, targetRate, direction) {
  if (practiceRate == null || targetRate == null) return null;
  const raw = practiceRate - targetRate;
  const adjusted = direction === "lower_is_better" ? -raw : raw;
  const sign = adjusted >= 0 ? "+" : "";
  return sign + adjusted.toFixed(1);
}

// =============================================================================
// Inline primitives
// =============================================================================
function Pill({ label, bg, fg, mono }) {
  return (
    <span style={{
      fontSize: 11,
      padding: "2px 8px",
      borderRadius: 999,
      background: bg,
      color: fg,
      fontWeight: 500,
      fontFamily: mono ? "ui-monospace, monospace" : "inherit",
      whiteSpace: "nowrap",
      display: "inline-block",
    }}>{label}</span>
  );
}

function StatusBadge({ status }) {
  const map = {
    above:             { label: "Above target",      bg: C.greenLight, fg: C.greenText },
    near:              { label: "Near target",       bg: C.amberLight, fg: C.amberText },
    below:             { label: "Below target",      bg: C.redLight,   fg: C.redText },
    plan_reported:     { label: "Awaiting Plan",     bg: C.blueLight,  fg: C.blueText },
    awaiting_clinical: { label: "Awaiting Clinical", bg: C.bgSecondary, fg: C.textSecondary },
    beat_the_trend:    { label: "Beat-the-Trend",    bg: C.amberLight, fg: C.amberText },
    no_data:           { label: "No data",           bg: C.bgSecondary, fg: C.textTertiary },
  };
  const c = map[status] || map.no_data;
  return <Pill label={c.label} bg={c.bg} fg={c.fg} />;
}

function KpiCard({ label, value, hint, accent }) {
  const valueColor = accent === "warning" ? C.amberText
                   : accent === "success" ? C.greenText
                   : accent === "danger"  ? C.redText
                   : C.textPrimary;
  return (
    <div style={{
      background: C.bgPrimary,
      border: "0.5px solid " + C.borderLight,
      borderRadius: 10,
      padding: "16px 18px",
      minWidth: 0,
    }}>
      <div style={{
        fontSize: 11, fontWeight: 600, letterSpacing: "0.06em",
        textTransform: "uppercase", color: C.textSecondary, marginBottom: 8,
      }}>{label}</div>
      <div style={{
        fontSize: 30, fontWeight: 700, color: valueColor, lineHeight: 1,
        fontFamily: "inherit",
      }}>{value}</div>
      <div style={{ fontSize: 12, color: C.textTertiary, marginTop: 6 }}>{hint}</div>
    </div>
  );
}

function Btn({ children, onClick, variant, size, disabled }) {
  const base = {
    fontSize:    size === "sm" ? 12 : 13,
    padding:     size === "sm" ? "6px 10px" : "8px 14px",
    borderRadius: 8,
    border:      "0.5px solid " + C.borderMid,
    background:  variant === "primary" ? C.teal
              :  variant === "ghost"   ? "transparent"
              :  C.bgPrimary,
    color:       variant === "primary" ? "#fff" : C.textPrimary,
    cursor:      disabled ? "not-allowed" : "pointer",
    opacity:     disabled ? 0.55 : 1,
    fontFamily:  "inherit",
    fontWeight:  500,
  };
  return <button style={base} onClick={onClick} disabled={disabled}>{children}</button>;
}

// =============================================================================
// Main component
// =============================================================================
export default function AmhQualityDashboardTab({ practiceId, currentUser }) {
  const navigate = useNavigate();
  const currentYear = new Date().getFullYear();
  // v1 supports the current calendar year only. UI shows a year picker but
  // the only options are current + prior to keep the UI honest about what's
  // computable (snapshots are written by month within an MY).
  const [filterMy, setFilterMy]     = useState(currentYear);
  const [filterPlan, setFilterPlan] = useState("all");
  const [viewMode, setViewMode]     = useState("all"); // 'all' | 'vbp_only'
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy]         = useState("name");
  const [selectedKey, setSelectedKey] = useState(null);

  const { measures, kpis, lastComputed, loading, refreshing, error, refresh } =
    useAmhMeasurePerformance(practiceId, filterMy);

  // Derive available plans from the measure data (only show plans that have
  // at least one snapshot row across the dataset)
  const availablePlans = useMemo(() => {
    const set = new Set();
    for (const m of measures) {
      for (const pr of m.plan_rates) {
        if (pr.plan) set.add(pr.plan);
      }
      for (const t of Object.keys(m.plan_targets || {})) {
        if (t) set.add(t);
      }
    }
    return Array.from(set).sort();
  }, [measures]);

  const hasAnyVbp = useMemo(
    () => measures.some(m => m.has_vbp_contract),
    [measures]
  );

  // Apply view mode + filters + sort
  const visibleMeasures = useMemo(() => {
    let list = measures;

    // VBP-only view
    if (viewMode === "vbp_only") {
      list = list.filter(m => m.has_vbp_contract);
    }

    // Status filter
    if (statusFilter === "below") {
      list = list.filter(m => m.status === "below" || m.status === "near");
    } else if (statusFilter === "disparity") {
      list = list.filter(m => m.has_disparity);
    } else if (statusFilter === "awaiting") {
      list = list.filter(m =>
        m.status === "plan_reported" || m.status === "awaiting_clinical" || m.status === "no_data"
      );
    }

    // Sort
    const sorted = [...list];
    if (sortBy === "name") {
      sorted.sort((a, b) => a.measure_name.localeCompare(b.measure_name));
    } else if (sortBy === "performance") {
      sorted.sort((a, b) => statusRank(a.status) - statusRank(b.status));
    } else if (sortBy === "denominator") {
      sorted.sort((a, b) => (b.practice_denominator || 0) - (a.practice_denominator || 0));
    }
    return sorted;
  }, [measures, viewMode, statusFilter, sortBy]);

  // Auto-select first measure on first load (so the drill-in isn't empty)
  useEffect(() => {
    if (!selectedKey && visibleMeasures.length > 0) {
      setSelectedKey(measureKey(visibleMeasures[0]));
    }
  }, [visibleMeasures, selectedKey]);

  // If the selected measure is no longer visible (filter changed), pick the
  // first visible one so drill-in stays in sync
  useEffect(() => {
    if (!selectedKey || !visibleMeasures.length) return;
    const stillVisible = visibleMeasures.some(m => measureKey(m) === selectedKey);
    if (!stillVisible) setSelectedKey(measureKey(visibleMeasures[0]));
  }, [visibleMeasures, selectedKey]);

  const selectedMeasure = useMemo(
    () => visibleMeasures.find(m => measureKey(m) === selectedKey) || null,
    [visibleMeasures, selectedKey]
  );

  // Deep-link helpers
  function openHedisForMeasure(code) {
    navigate("/care-management", { state: { tab: "hedis", measureCode: code } });
  }
  function openVbpContract(contractId) {
    navigate("/care-management", { state: { tab: "vbp", contractId } });
  }

  return (
    <div style={{
      flex: 1,
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      background: C.bgPrimary,
    }}>
      {/* Header */}
      <div style={{
        padding: "16px 20px",
        borderBottom: "0.5px solid " + C.borderLight,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: C.textPrimary }}>
              AMH Quality Measure Dashboard
            </div>
            <Pill label="Add-on" bg={C.tealLight} fg={C.tealText} />
            {hasAnyVbp ? (
              <Pill label="VBP Contracts Active" bg={C.goldLight} fg={C.gold} />
            ) : null}
          </div>
          <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 2 }}>
            Practice performance against the NC Medicaid AMH Measure Set. Reference targets
            shown are NC statewide benchmarks; AMH targets are negotiated with each Health Plan.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select
            value={filterMy}
            onChange={e => setFilterMy(Number(e.target.value))}
            style={selectStyle}
          >
            <option value={currentYear}>MY {currentYear}</option>
            <option value={currentYear - 1}>MY {currentYear - 1}</option>
          </select>
          <select
            value={filterPlan}
            onChange={e => setFilterPlan(e.target.value)}
            style={selectStyle}
          >
            <option value="all">Plan: All</option>
            {availablePlans.map(p => (
              <option key={p} value={p}>{PLAN_LABEL[p] || p.toUpperCase()}</option>
            ))}
          </select>
          <Btn size="sm" onClick={refresh} disabled={refreshing}>
            {refreshing ? "Refreshing..." : "Refresh"}
          </Btn>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", background: C.bgTertiary }}>

        {/* VBP toggle - only when contracts exist */}
        {hasAnyVbp ? (
          <div style={{
            display: "flex", gap: 4, marginBottom: 16,
            padding: 4, background: C.bgPrimary,
            border: "0.5px solid " + C.borderLight, borderRadius: 8,
            width: "fit-content",
          }}>
            <ViewToggleButton
              active={viewMode === "all"}
              onClick={() => setViewMode("all")}
            >All Measures</ViewToggleButton>
            <ViewToggleButton
              active={viewMode === "vbp_only"}
              onClick={() => setViewMode("vbp_only")}
            >VBP-Contracted Only</ViewToggleButton>
          </div>
        ) : null}

        {/* KPI strip */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
          marginBottom: 16,
        }}>
          <KpiCard
            label="Measures Tracked"
            value={kpis.tracked}
            hint={viewMode === "vbp_only" ? "VBP-contracted only" : "AMH MY" + filterMy + " set"}
          />
          <KpiCard
            label="At or Above Target"
            value={kpis.atOrAbove}
            hint={kpis.atOrAbove > 0 ? "on track for incentive" : "no measures above target yet"}
            accent={kpis.atOrAbove > 0 ? "success" : undefined}
          />
          <KpiCard
            label="Below Target"
            value={kpis.belowTarget}
            hint={kpis.belowTarget > 0 ? "action needed" : "all measures meeting target"}
            accent={kpis.belowTarget > 0 ? "warning" : undefined}
          />
          <KpiCard
            label="Disparities Flagged"
            value={kpis.disparities}
            hint={kpis.disparities > 0 ? "priority population gap >= 10%" : "no flagged disparities"}
            accent={kpis.disparities > 0 ? "danger" : undefined}
          />
        </div>

        {/* Filter row */}
        <div style={{
          display: "flex", gap: 8, alignItems: "center",
          padding: "10px 12px",
          background: C.bgPrimary,
          border: "0.5px solid " + C.borderLight,
          borderRadius: 8,
          marginBottom: 16,
          flexWrap: "wrap",
        }}>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={selectStyle}>
            {STATUS_FILTERS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={selectStyle}>
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: C.textTertiary }}>
            Last computed: {fmtTimeAgo(lastComputed)}
          </span>
        </div>

        {/* Body */}
        {error ? (
          <ErrorBlock message={error} onRetry={refresh} />
        ) : loading ? (
          <LoadingSkeleton />
        ) : visibleMeasures.length === 0 ? (
          <EmptyState
            hasAnyData={measures.length > 0}
            isVbpOnly={viewMode === "vbp_only"}
            onRefresh={refresh}
          />
        ) : (
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 420px",
            gap: 16,
            alignItems: "start",
          }}>
            {/* Left: card grid */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: 12,
            }}>
              {visibleMeasures.map(m => (
                <MeasureCard
                  key={measureKey(m)}
                  measure={m}
                  filterPlan={filterPlan}
                  selected={measureKey(m) === selectedKey}
                  onSelect={() => setSelectedKey(measureKey(m))}
                />
              ))}
            </div>

            {/* Right: drill-in detail panel - sticky */}
            <div style={{ position: "sticky", top: 0 }}>
              {selectedMeasure ? (
                <MeasureDetailPanel
                  measure={selectedMeasure}
                  filterPlan={filterPlan}
                  onOpenHedis={() => openHedisForMeasure(selectedMeasure.measure_code)}
                  onOpenVbp={openVbpContract}
                />
              ) : (
                <div style={{
                  padding: 24, background: C.bgPrimary,
                  border: "0.5px solid " + C.borderLight, borderRadius: 12,
                  fontSize: 12, color: C.textTertiary, textAlign: "center",
                }}>
                  Select a measure to see drill-in detail
                </div>
              )}
            </div>
          </div>
        )}

        {/* Reference framing footer */}
        <div style={{
          marginTop: 24, padding: "14px 18px",
          background: C.bgPrimary,
          border: "0.5px solid " + C.borderLight, borderRadius: 8,
          fontSize: 12, color: C.textSecondary, lineHeight: 1.6,
        }}>
          <strong style={{ color: C.textPrimary, fontWeight: 600 }}>About these benchmarks.</strong>
          {" "}NC Medicaid does NOT set targets for individual AMH practices. The MY{filterMy} targets
          shown are NC's statewide reference points, calculated using the Gap-to-Goal methodology
          (10% reduction toward the National Medicaid 50th or 90th percentile depending on baseline).
          Your practice should negotiate AMH-specific performance targets directly with each Health
          Plan during contract negotiations. Disparity flags use NC's threshold of 10% relative
          difference between priority and reference populations.
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Measure card
// =============================================================================
function MeasureCard({ measure, filterPlan, selected, onSelect }) {
  const m = measure;

  // Pick rate + target based on plan filter
  let displayRate;
  let displayDenominator;
  let targetRate;
  let targetLabel;
  if (filterPlan === "all") {
    displayRate = m.practice_rate;
    displayDenominator = m.practice_denominator;
    targetRate = m.nc_overall_target;
    targetLabel = "NC Target MY" + (new Date().getFullYear());
  } else {
    const planRow = m.plan_rates.find(p => p.plan === filterPlan);
    displayRate = planRow ? planRow.rate : null;
    displayDenominator = planRow ? planRow.denominator : null;
    const planTgt = m.plan_targets[filterPlan];
    targetRate = planTgt ? planTgt.target_rate : null;
    targetLabel = "NC " + (PLAN_LABEL[filterPlan] || filterPlan.toUpperCase());
  }

  const direction = m.direction;
  const delta = computeDeltaLabel(displayRate, targetRate, direction);

  // Badges
  const badges = [];
  if (m.is_plan_reported)     badges.push({ label: "Plan-Reported",       bg: C.blueLight,   fg: C.blueText });
  if (m.is_awaiting_clinical) badges.push({ label: "Awaiting Clinical",   bg: C.bgSecondary, fg: C.textSecondary });
  if (m.is_beat_the_trend)    badges.push({ label: "Beat-the-Trend",      bg: C.amberLight,  fg: C.amberText });
  if (direction === "lower_is_better") badges.push({ label: "Lower is Better", bg: C.bgSecondary, fg: C.textSecondary });
  if (m.has_vbp_contract)     badges.push({ label: "VBP Contract",        bg: C.goldLight,   fg: C.gold });

  return (
    <div
      onClick={onSelect}
      style={{
        background: C.bgPrimary,
        border: selected ? "1px solid " + C.teal : "0.5px solid " + C.borderLight,
        boxShadow: selected ? "0 0 0 1px " + C.teal + " inset" : "none",
        borderRadius: 12,
        padding: "16px 18px 14px",
        cursor: "pointer",
        transition: "border-color 0.15s",
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.borderColor = C.tealMid; }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.borderColor = C.borderLight; }}
    >
      {/* Head */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14, gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary, lineHeight: 1.3 }}>
            {m.measure_name}
          </div>
          <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 3 }}>
            {m.measure_code}
            {m.submeasure ? " - " + m.submeasure : ""}
            {displayDenominator != null ? " - " + displayDenominator + " eligible" : ""}
          </div>
        </div>
        {badges.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end", flexShrink: 0 }}>
            {badges.slice(0, 2).map((b, i) => (
              <Pill key={i} label={b.label} bg={b.bg} fg={b.fg} />
            ))}
          </div>
        ) : null}
      </div>

      {/* Rate + target */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 12 }}>
        <div style={{
          fontSize: 30, fontWeight: 700,
          color: displayRate == null ? C.textTertiary : C.textPrimary,
          lineHeight: 1, letterSpacing: "-0.02em",
        }}>
          {fmtRateForMeasure(displayRate, m.measure_code)}
        </div>
        {!m.is_beat_the_trend && !m.is_awaiting_clinical && targetRate != null ? (
          <div style={{ fontSize: 12, color: C.textSecondary }}>
            <div style={{
              fontSize: 10, fontWeight: 600, letterSpacing: "0.06em",
              textTransform: "uppercase", color: C.textTertiary,
            }}>{targetLabel}</div>
            <span style={{ fontWeight: 600, color: C.textPrimary }}>
              {fmtRateForMeasure(targetRate, m.measure_code)}
            </span>
            {delta ? (
              <DeltaBadge value={delta} status={m.status} />
            ) : null}
          </div>
        ) : (
          <div style={{ fontSize: 11, color: C.textTertiary, fontStyle: "italic" }}>
            {m.is_beat_the_trend ? "trajectory only" :
             m.is_awaiting_clinical ? "clinical data pending" :
             "no target available"}
          </div>
        )}
      </div>

      {/* Sparkline (when there's >=2 trend points) */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        marginBottom: 14, paddingBottom: 12,
        borderBottom: "0.5px solid " + C.borderLight,
      }}>
        <span style={{
          fontSize: 10, color: C.textTertiary, fontWeight: 500,
          textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap",
        }}>Trend</span>
        <Sparkline trend={m.trend} status={m.status} />
      </div>

      {/* Stratification */}
      <StrataGrid measure={m} />
    </div>
  );
}

function DeltaBadge({ value, status }) {
  const style = status === "above" ? { bg: C.greenLight, fg: C.greenText }
              : status === "below" ? { bg: C.redLight,   fg: C.redText }
              : status === "near"  ? { bg: C.amberLight, fg: C.amberText }
              : { bg: C.bgSecondary, fg: C.textSecondary };
  return (
    <span style={{
      display: "inline-block",
      fontSize: 11, fontWeight: 600,
      padding: "2px 6px", borderRadius: 4, marginLeft: 6,
      background: style.bg, color: style.fg,
    }}>{value}</span>
  );
}

function Sparkline({ trend, status }) {
  if (!trend || trend.length < 2) {
    return (
      <svg viewBox="0 0 200 32" preserveAspectRatio="none" style={{ flex: 1, height: 32 }}>
        <line x1="0" y1="20" x2="200" y2="20"
          stroke={C.borderMid} strokeWidth="1" strokeDasharray="3 3" />
      </svg>
    );
  }
  // Build polyline points. Y-axis: invert (higher rate = lower y).
  const validPoints = trend.filter(p => p.rate != null);
  if (validPoints.length < 2) {
    return (
      <svg viewBox="0 0 200 32" preserveAspectRatio="none" style={{ flex: 1, height: 32 }}>
        <line x1="0" y1="20" x2="200" y2="20"
          stroke={C.borderMid} strokeWidth="1" strokeDasharray="3 3" />
      </svg>
    );
  }
  const min = Math.min(...validPoints.map(p => p.rate));
  const max = Math.max(...validPoints.map(p => p.rate));
  const range = max - min || 1;
  const stepX = 200 / Math.max(validPoints.length - 1, 1);
  const points = validPoints.map((p, i) => {
    const x = i * stepX;
    const y = 30 - ((p.rate - min) / range) * 26;
    return x.toFixed(1) + "," + y.toFixed(1);
  }).join(" ");

  const stroke = status === "above" ? C.green
               : status === "below" ? C.red
               : status === "near"  ? C.amber
               : C.teal;

  // Last-point dot
  const lastX = (validPoints.length - 1) * stepX;
  const lastY = 30 - ((validPoints[validPoints.length - 1].rate - min) / range) * 26;

  return (
    <svg viewBox="0 0 200 32" preserveAspectRatio="none" style={{ flex: 1, height: 32 }}>
      <polyline points={points}
        fill="none" stroke={stroke} strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r="3" fill={stroke} />
    </svg>
  );
}

function StrataGrid({ measure }) {
  const m = measure;
  // Empty state when stratification data is fully missing
  const hasAnyStratum = m.stratum_rates.length > 0;
  const populations = ["black_aa", "aian", "hispanic_latino"];
  const stratumByPop = Object.fromEntries(m.stratum_rates.map(s => [s.population, s]));

  return (
    <div>
      <div style={{
        fontSize: 10, fontWeight: 600, letterSpacing: "0.06em",
        textTransform: "uppercase", color: C.textTertiary, marginBottom: 8,
      }}>Race / Ethnicity Stratification</div>
      {!hasAnyStratum ? (
        <div style={{
          padding: "8px 10px", background: C.bgSecondary,
          border: "0.5px dashed " + C.borderMid, borderRadius: 6,
          fontSize: 11, color: C.textTertiary, textAlign: "center", fontStyle: "italic",
        }}>
          Awaiting Stratification Data &middot; race/ethnicity not yet captured
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
          {populations.map(pop => {
            const sr = stratumByPop[pop];
            const tgt = m.priority_population_targets[pop];
            const isDisparity = !!(tgt && tgt.has_disparity);
            const bg = isDisparity ? C.redLight : C.bgSecondary;
            const borderC = isDisparity ? "#f3c5c5" : C.borderLight;
            return (
              <div key={pop} style={{
                background: bg,
                border: "0.5px solid " + borderC,
                borderRadius: 6, padding: "6px 8px",
                fontSize: 11, lineHeight: 1.3,
              }}>
                <div style={{ color: C.textSecondary, fontWeight: 500, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span>{shortStratumLabel(pop)}</span>
                  {isDisparity ? (
                    <span title="Disparity flagged" style={{
                      fontSize: 9, fontWeight: 700, color: "#fff",
                      background: C.red, borderRadius: 999, padding: "0 5px",
                    }}>!</span>
                  ) : null}
                </div>
                <div style={{ fontWeight: 700, color: C.textPrimary, marginTop: 2 }}>
                  {sr ? fmtRateForMeasure(sr.rate, m.measure_code) : "--"}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function shortStratumLabel(pop) {
  if (pop === "black_aa") return "Black / AA";
  if (pop === "aian") return "AIAN";
  if (pop === "hispanic_latino") return "Hispanic";
  return pop;
}

// =============================================================================
// Drill-in detail panel
// =============================================================================
function MeasureDetailPanel({ measure, filterPlan, onOpenHedis, onOpenVbp }) {
  const m = measure;

  return (
    <div style={{
      background: C.bgPrimary,
      border: "0.5px solid " + C.borderLight,
      borderRadius: 12,
      overflow: "hidden",
    }}>
      {/* Head */}
      <div style={{
        padding: "16px 20px 14px",
        background: "linear-gradient(180deg, " + C.tealLight + "55 0%, " + C.bgPrimary + " 100%)",
        borderBottom: "0.5px solid " + C.borderLight,
      }}>
        <div style={{
          fontSize: 11, fontWeight: 600, letterSpacing: "0.06em",
          textTransform: "uppercase", color: C.teal, marginBottom: 4,
        }}>Selected Measure</div>
        <div style={{
          fontSize: 17, fontWeight: 700, color: C.textPrimary,
          marginBottom: 8, lineHeight: 1.3,
        }}>{m.measure_name}</div>
        <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 6 }}>
          <span style={{ fontFamily: "ui-monospace, monospace" }}>{m.measure_code}</span>
          {m.submeasure ? " - " + m.submeasure : ""}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <StatusBadge status={m.status} />
          {m.has_vbp_contract ? (
            <Pill label={m.vbp_contracts.length + " VBP contract" + (m.vbp_contracts.length === 1 ? "" : "s")}
                  bg={C.goldLight} fg={C.gold} />
          ) : null}
        </div>
      </div>

      <div style={{ padding: "14px 20px" }}>

        {/* Eligible Population */}
        <DetailSection title="Eligible Population">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Stat label="Eligible Members" value={m.practice_denominator ?? "--"} />
            <Stat label={m.measure_code === "PCR" ? "Numerator (Readmits)" : "Numerator (Compliant)"}
                  value={m.practice_numerator ?? "--"} />
            <Stat label="Open Gaps" value={m.practice_gaps_open || 0}
                  valueColor={(m.practice_gaps_open || 0) > 0 ? C.amberText : undefined} />
            <Stat label="Closed YTD" value={m.practice_gaps_closed || 0}
                  valueColor={(m.practice_gaps_closed || 0) > 0 ? C.greenText : undefined} />
          </div>
          {m.practice_gaps_open > 0 ? (
            <div style={{ marginTop: 12 }}>
              <Btn size="sm" onClick={onOpenHedis}>
                View {m.practice_gaps_open} open gap{m.practice_gaps_open === 1 ? "" : "s"} in HEDIS
              </Btn>
            </div>
          ) : null}
        </DetailSection>

        {/* Performance by Plan */}
        {m.plan_rates.length > 0 ? (
          <DetailSection title="Performance by Plan">
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {m.plan_rates.map(pr => {
                const tgt = m.plan_targets[pr.plan];
                const targetRate = tgt ? tgt.target_rate : null;
                // Bar fill width: visualize rate against a 0-100 scale (or 0-2 for ratios)
                const max = m.measure_code === "PCR" ? 2 : 100;
                const fillPct = pr.rate != null ? Math.min((pr.rate / max) * 100, 100) : 0;
                return (
                  <div key={pr.plan} style={{
                    display: "flex", alignItems: "center", gap: 8, fontSize: 12,
                  }}>
                    <span style={{
                      flex: 1, color: C.textPrimary, fontWeight: 500, minWidth: 0,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {PLAN_LABEL[pr.plan] || pr.plan.toUpperCase()}
                    </span>
                    <span style={{
                      flex: 2, height: 4, background: C.bgTertiary,
                      borderRadius: 2, overflow: "hidden",
                    }}>
                      <span style={{
                        display: "block", height: "100%",
                        background: C.teal, width: fillPct + "%",
                      }} />
                    </span>
                    <span style={{ fontWeight: 600, color: C.textPrimary, minWidth: 48, textAlign: "right" }}>
                      {fmtRateForMeasure(pr.rate, m.measure_code)}
                    </span>
                    {targetRate != null ? (
                      <span style={{ fontSize: 10, color: C.textTertiary, minWidth: 42, textAlign: "right" }}>
                        tgt {fmtRateForMeasure(targetRate, m.measure_code)}
                      </span>
                    ) : (
                      <span style={{ fontSize: 10, color: C.textTertiary, minWidth: 42 }}> </span>
                    )}
                  </div>
                );
              })}
            </div>
          </DetailSection>
        ) : null}

        {/* Disparity Analysis */}
        <DetailSection title="Disparity Analysis">
          <DisparityTable measure={m} />
        </DetailSection>

        {/* VBP Performance */}
        {m.has_vbp_contract ? (
          <DetailSection title="VBP Performance">
            {m.vbp_contracts.map(vc => (
              <VbpRow key={vc.contract_id} vc={vc} measure={m} onOpen={() => onOpenVbp(vc.contract_id)} />
            ))}
          </DetailSection>
        ) : null}

        {/* Submeasures (when there are multiple) */}
        {m.submeasure_rows.length > 1 ? (
          <DetailSection title="Submeasures">
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {m.submeasure_rows.map((s, i) => (
                <div key={i} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "8px 10px", background: C.bgSecondary, borderRadius: 6,
                  border: "0.5px solid " + C.borderLight, fontSize: 12,
                }}>
                  <span style={{ color: C.textPrimary }}>{s.submeasure || "(unspecified)"}</span>
                  <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: C.textTertiary }}>
                      {s.numerator}/{s.denominator}
                    </span>
                    <span style={{ fontWeight: 600, color: C.textPrimary, minWidth: 48, textAlign: "right" }}>
                      {fmtRateForMeasure(s.rate, m.measure_code)}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </DetailSection>
        ) : null}

      </div>
    </div>
  );
}

function DetailSection({ title, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{
        fontSize: 10, fontWeight: 600, letterSpacing: "0.08em",
        textTransform: "uppercase", color: C.textTertiary, marginBottom: 10,
      }}>{title}</div>
      {children}
    </div>
  );
}

function Stat({ label, value, valueColor }) {
  return (
    <div style={{
      background: C.bgSecondary, padding: "10px 12px", borderRadius: 6,
      border: "0.5px solid " + C.borderLight,
    }}>
      <div style={{
        fontSize: 10, color: C.textTertiary, fontWeight: 500,
        textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4,
      }}>{label}</div>
      <div style={{
        fontSize: 18, fontWeight: 700, color: valueColor || C.textPrimary,
      }}>{value}</div>
    </div>
  );
}

function DisparityTable({ measure }) {
  const m = measure;
  const populations = ["black_aa", "aian", "hispanic_latino"];
  const stratumByPop = Object.fromEntries(m.stratum_rates.map(s => [s.population, s]));
  const anyData = m.stratum_rates.length > 0;

  if (!anyData) {
    return (
      <div style={{
        padding: 12, background: C.bgSecondary,
        border: "0.5px dashed " + C.borderMid, borderRadius: 6,
        fontSize: 12, color: C.textSecondary, textAlign: "center", fontStyle: "italic",
      }}>
        Awaiting stratification data. Once race / ethnicity is captured on patient charts,
        per-population rates and disparity flags will appear here.
      </div>
    );
  }

  return (
    <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
      <thead>
        <tr>
          <th style={thStyle}>Population</th>
          <th style={{ ...thStyle, textAlign: "right" }}>Rate</th>
          <th style={{ ...thStyle, textAlign: "right" }}>Target</th>
        </tr>
      </thead>
      <tbody>
        {populations.map(pop => {
          const sr = stratumByPop[pop];
          const tgt = m.priority_population_targets[pop];
          if (!sr) return null;
          const isDisparity = !!(tgt && tgt.has_disparity);
          return (
            <tr key={pop} style={isDisparity ? { background: C.redLight } : undefined}>
              <td style={tdStyle}>
                {isDisparity ? (
                  <span style={{
                    display: "inline-block", padding: "1px 5px", marginRight: 6,
                    background: C.red, color: "#fff", borderRadius: 999,
                    fontSize: 9, fontWeight: 700,
                  }}>!</span>
                ) : null}
                {STRATUM_LABEL[pop] || pop}
                {tgt && tgt.relative_difference_pct != null ? (
                  <span style={{ fontSize: 10, color: C.textTertiary, marginLeft: 6 }}>
                    ({tgt.relative_difference_pct >= 0 ? "+" : ""}{tgt.relative_difference_pct.toFixed(1)}% vs ref)
                  </span>
                ) : null}
              </td>
              <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600, fontFamily: "inherit" }}>
                {fmtRateForMeasure(sr.rate, m.measure_code)}
              </td>
              <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600 }}>
                {tgt && tgt.target_rate != null ? fmtRateForMeasure(tgt.target_rate, m.measure_code) : "--"}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const thStyle = {
  padding: "6px 8px",
  fontSize: 10, fontWeight: 600, color: C.textTertiary,
  textAlign: "left", textTransform: "uppercase", letterSpacing: "0.06em",
  borderBottom: "0.5px solid " + C.borderLight,
};
const tdStyle = {
  padding: "6px 8px", color: C.textPrimary,
  borderBottom: "0.5px solid " + C.bgTertiary,
};

function VbpRow({ vc, measure, onOpen }) {
  const m = measure;
  const meetsDenominatorMin = vc.denominator_min == null
    || (m.practice_denominator != null && m.practice_denominator >= vc.denominator_min);

  // Compute progress vs contract target
  const target = vc.target_value != null ? Number(vc.target_value) : null;
  const rate = m.practice_rate;
  let onTrack = null;
  if (target != null && rate != null) {
    onTrack = m.direction === "lower_is_better" ? rate <= target : rate >= target;
  }

  return (
    <div style={{
      padding: 12, background: C.goldLight, border: "0.5px solid " + C.gold + "33",
      borderRadius: 6, marginBottom: 8,
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "flex-start",
        gap: 8, marginBottom: 8,
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.textPrimary }}>
            {vc.contract.contract_label}
          </div>
          <div style={{ fontSize: 11, color: C.textSecondary, marginTop: 2 }}>
            {PLAN_LABEL[vc.contract.payer_short_name] || vc.contract.payer_short_name.toUpperCase()}
            {vc.contract.program_type ? " - " + vc.contract.program_type : ""}
          </div>
        </div>
        <button
          onClick={onOpen}
          style={{
            fontSize: 11, fontWeight: 600, padding: "3px 8px",
            background: "#fff", border: "0.5px solid " + C.gold,
            borderRadius: 4, color: C.gold,
            cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
          }}
        >
          View contract
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, fontSize: 11 }}>
        <VbpStat label="Contract Target"
          value={target != null ? fmtRateForMeasure(target, m.measure_code) : "--"} />
        <VbpStat label="Current Rate"
          value={rate != null ? fmtRateForMeasure(rate, m.measure_code) : "--"}
          color={onTrack === true ? C.greenText : onTrack === false ? C.redText : undefined} />
        <VbpStat label="Weight"
          value={vc.weight != null ? Number(vc.weight).toFixed(2) : "--"} />
      </div>
      {vc.denominator_min != null ? (
        <div style={{
          marginTop: 8, fontSize: 10,
          color: meetsDenominatorMin ? C.greenText : C.redText,
        }}>
          Min denominator: {vc.denominator_min} -
          {meetsDenominatorMin ? " met" : " not yet met (current: " + (m.practice_denominator || 0) + ")"}
        </div>
      ) : null}
    </div>
  );
}

function VbpStat({ label, value, color }) {
  return (
    <div>
      <div style={{
        fontSize: 9, fontWeight: 600, letterSpacing: "0.06em",
        textTransform: "uppercase", color: C.textTertiary, marginBottom: 2,
      }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: color || C.textPrimary }}>{value}</div>
    </div>
  );
}

function ViewToggleButton({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      padding: "6px 12px", fontSize: 12, fontWeight: 600,
      border: "none", borderRadius: 6,
      background: active ? C.teal : "transparent",
      color: active ? "#fff" : C.textSecondary,
      cursor: "pointer", fontFamily: "inherit",
    }}>{children}</button>
  );
}

// =============================================================================
// Empty / loading / error states
// =============================================================================
function LoadingSkeleton() {
  const cell = { background: C.bgSecondary, borderRadius: 6 };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 420px", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
        {[1, 2, 3, 4].map(i => (
          <div key={i} style={{
            background: C.bgPrimary, border: "0.5px solid " + C.borderLight,
            borderRadius: 12, padding: 18,
          }}>
            <div style={{ ...cell, height: 14, width: "70%", marginBottom: 6 }} />
            <div style={{ ...cell, height: 10, width: "40%", marginBottom: 16 }} />
            <div style={{ ...cell, height: 28, width: "55%", marginBottom: 14 }} />
            <div style={{ ...cell, height: 32, marginBottom: 12 }} />
            <div style={{ ...cell, height: 50 }} />
          </div>
        ))}
      </div>
      <div style={{ background: C.bgPrimary, border: "0.5px solid " + C.borderLight, borderRadius: 12, padding: 24, height: 400 }}>
        <div style={{ ...cell, height: 12, width: "30%", marginBottom: 8 }} />
        <div style={{ ...cell, height: 18, width: "75%", marginBottom: 14 }} />
        <div style={{ ...cell, height: 100 }} />
      </div>
    </div>
  );
}

function ErrorBlock({ message, onRetry }) {
  return (
    <div style={{
      padding: 20, border: "0.5px solid " + C.redLight,
      background: C.redLight, borderRadius: 8, color: C.redText, fontSize: 13,
    }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Failed to load quality dashboard</div>
      <div style={{ marginBottom: 10, fontFamily: "ui-monospace, monospace", fontSize: 11 }}>
        {message}
      </div>
      <Btn size="sm" onClick={onRetry}>Retry</Btn>
    </div>
  );
}

function EmptyState({ hasAnyData, isVbpOnly, onRefresh }) {
  if (isVbpOnly) {
    return (
      <div style={{
        padding: "48px 20px", textAlign: "center",
        border: "0.5px dashed " + C.borderMid, borderRadius: 12,
        background: C.bgPrimary,
      }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary, marginBottom: 6 }}>
          No VBP-contracted measures match your filters
        </div>
        <div style={{ fontSize: 12, color: C.textSecondary, maxWidth: 480, margin: "0 auto" }}>
          Either no active VBP contracts cover the AMH measure set for this MY, or all
          contracted measures are filtered out by the current status filter.
        </div>
      </div>
    );
  }
  return (
    <div style={{
      padding: "48px 20px", textAlign: "center",
      border: "0.5px dashed " + C.borderMid, borderRadius: 12,
      background: C.bgPrimary,
    }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary, marginBottom: 6 }}>
        {hasAnyData ? "No measures match your filters" : "No measure performance computed yet"}
      </div>
      <div style={{ fontSize: 12, color: C.textSecondary, maxWidth: 520, margin: "0 auto", lineHeight: 1.6 }}>
        {hasAnyData
          ? "Try changing the status filter or selecting a different plan."
          : "Click Refresh to compute performance now. Snapshots are also recomputed nightly. Once HEDIS gap files arrive from your Health Plans, this dashboard will populate with practice-level rates."}
      </div>
      {!hasAnyData ? (
        <div style={{ marginTop: 16 }}>
          <Btn size="sm" variant="primary" onClick={onRefresh}>Compute now</Btn>
        </div>
      ) : null}
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================

// Stable identity key for a measure card. Includes submeasure so the same
// measure_code with different submeasures stays disambiguated if we ever
// expand to one card per submeasure.
function measureKey(m) {
  return m.measure_code + "::" + (m.submeasure || "");
}

// Numeric rank for "Sort: Performance" ordering. Lower = worse, listed first.
function statusRank(status) {
  return {
    below: 0,
    near: 1,
    plan_reported: 2,
    awaiting_clinical: 3,
    no_data: 4,
    beat_the_trend: 5,
    above: 6,
  }[status] ?? 99;
}

// Shared select style (matches PlanAssignmentsTab)
const selectStyle = {
  fontSize: 12,
  padding: "5px 10px",
  borderRadius: 8,
  border: "0.5px solid " + C.borderMid,
  background: C.bgPrimary,
  fontFamily: "inherit",
  cursor: "pointer",
};
