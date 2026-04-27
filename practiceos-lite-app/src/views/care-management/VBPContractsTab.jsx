// ═══════════════════════════════════════════════════════════════════════════
// VBPContractsTab.jsx
//
// Care Management sub-tab: list of VBP (Value-Based Payment) contracts for
// the practice. One row per contract; click a row to expand inline detail
// (payment_methodology jsonb, eligibility, full measures table). "+ New"
// and Edit navigate to the dedicated full-page form.
//
// Schema:
//   cm_vbp_contracts          - one row per contract (practice + payer + MY)
//   cm_vbp_contract_measures  - measures included in a contract
//
// Multi-MP contracts (UHC HH PBC pattern): one cm_vbp_contract_measures row
// per (measure, MP). Same contract has multiple rows for the same measure
// distinguished by measurement_period_label. The list shows count as
// "5 measures" or "1×3MPs" so admins can spot multi-MP contracts at a glance.
//
// Admin only. Same gate as HEDIS Uploads.
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { C } from "../../lib/tokens";
import {
  Btn, Card, Loader, EmptyState, ErrorBanner, FL, Badge,
} from "../../components/ui";
import {
  KpiCard, StatusBadge, Th, Td, selectStyle,
} from "./shared";

// Common program_type labels. Free-text in the DB; this is just for the
// list filter dropdown. New types appearing in data automatically join the list.
const COMMON_PROGRAM_TYPES = [
  "per_gap_closure",
  "per_gap_tiered",
  "qrt_gate",
  "shared_savings_pool",
  "fee_inflator",
  "hybrid",
  "other",
];

const STATUS_OPTIONS = ["All", "Draft", "Active", "Expired", "Cancelled", "Archived"];

// NC health plan label lookup. Mirrors the master list in VBPContractFormPage
// so the list view can display "Healthy Blue (BCBS NC Medicaid)" instead of
// the raw "healthy_blue" stored value. Falls back to the raw value for any
// plan not in this map (e.g., legacy contracts pre-dropdown, or values added
// to the form list but not yet here).
const NC_HEALTH_PLAN_LABELS = {
  wellcare:             "WellCare of NC",
  amerihealth:          "AmeriHealth Caritas NC",
  healthy_blue:         "Healthy Blue (BCBS NC Medicaid)",
  uhc_community:        "UHC Community Plan",
  cch:                  "Carolina Complete Health",
  alliance:             "Alliance Health",
  partners:             "Partners Health Management",
  trillium:             "Trillium Health Resources",
  vaya:                 "Vaya Health",
  ebci:                 "EBCI Tribal Option",
  nc_medicaid_direct:   "NC Medicaid Direct",
  ubh:                  "United Behavioral Health",
  bcbs_nc:              "BCBS NC (Commercial)",
  aetna:                "Aetna",
  cigna:                "Cigna",
  uhc_commercial:       "UHC (Commercial)",
  humana:               "Humana",
  wellcare_ma:          "WellCare MA",
  humana_ma:            "Humana MA",
  uhc_ma:               "UHC MA",
  aetna_ma:             "Aetna MA",
  bcbs_nc_ma:           "BCBS NC MA",
  healthteam_advantage: "HealthTeam Advantage",
  alignment:            "Alignment Healthcare",
  medicare_ffs:         "Original Medicare",
  mssp:                 "MSSP ACO",
  other:                "Other",
};

// HCP-LAN APM Framework category labels (display only; full list with
// descriptions lives in VBPContractFormPage). Mirrors the form so the detail
// view shows human-readable names, not just codes.
const HCP_LAN_LABELS = {
  "1":  "1 - FFS, no link to quality",
  "2A": "2A - Foundational payments (infrastructure)",
  "2B": "2B - Pay for reporting",
  "2C": "2C - Pay-for-performance",
  "3A": "3A - Shared savings (upside only)",
  "3B": "3B - Shared savings + risk",
  "3N": "3N - Risk-based, not linked to quality",
  "4A": "4A - Condition-specific population-based payment",
  "4B": "4B - Comprehensive population-based payment",
  "4C": "4C - Integrated finance + delivery system",
  "4N": "4N - Capitated, not linked to quality",
};

function fmtDateOnly(iso) {
  if (!iso) return "-";
  if (typeof iso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return new Date(iso).toLocaleDateString();
}

// Days until effective_end. Returns null if no end date set.
function daysUntilExpiry(effectiveEnd) {
  if (!effectiveEnd) return null;
  const ms = new Date(effectiveEnd).getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

export default function VBPContractsTab({ practiceId, isAdmin }) {
  const navigate = useNavigate();
  const [contracts, setContracts] = useState([]);
  const [measureCountsById, setMeasureCountsById] = useState({}); // {contractId: {measures: int, mps: int}}
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);

  // Filters
  const [filterPayer, setFilterPayer]     = useState("");
  const [filterMY, setFilterMY]           = useState("");
  const [filterProgram, setFilterProgram] = useState("");
  const [filterStatus, setFilterStatus]   = useState("Active");

  // Inline expansion state (rows are expanded by id)
  const [expanded, setExpanded] = useState(null);
  const [detailMeasures, setDetailMeasures] = useState({});  // {contractId: [measure rows]}
  const [loadingDetail, setLoadingDetail]   = useState(false);

  const load = useCallback(async () => {
    if (!practiceId) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: cErr } = await supabase
        .from("cm_vbp_contracts")
        .select("id, payer_short_name, measurement_year, contract_label, contract_type, program_type, hcp_lan_category, effective_start, effective_end, status, payment_methodology, eligibility_requirements, notes, notes_payment_methodology, created_at, updated_at")
        .eq("practice_id", practiceId)
        .order("measurement_year", { ascending: false })
        .order("payer_short_name", { ascending: true })
        .limit(500);
      if (cErr) throw cErr;
      setContracts(data || []);

      // Bulk-fetch measure counts so the list can show "5 measures" or "1×3MPs"
      // without N+1 queries.
      if ((data || []).length > 0) {
        const ids = data.map(c => c.id);
        const { data: mData, error: mErr } = await supabase
          .from("cm_vbp_contract_measures")
          .select("contract_id, measure_code, measurement_period_label, status")
          .in("contract_id", ids);
        if (mErr) throw mErr;
        const counts = {};
        for (const id of ids) counts[id] = { measures: 0, mps: 0, perCode: {} };
        for (const m of (mData || [])) {
          if (m.status !== "Active") continue;
          const c = counts[m.contract_id];
          if (!c.perCode[m.measure_code]) c.perCode[m.measure_code] = 0;
          c.perCode[m.measure_code]++;
        }
        for (const id of ids) {
          const perCode = counts[id].perCode;
          counts[id].measures = Object.keys(perCode).length;
          counts[id].mps = Math.max(0, ...Object.values(perCode));
        }
        setMeasureCountsById(counts);
      } else {
        setMeasureCountsById({});
      }
    } catch (e) {
      setError(e.message || "Failed to load VBP contracts");
    } finally {
      setLoading(false);
    }
  }, [practiceId]);

  useEffect(() => { load(); }, [load]);

  // Lazy-load measures for the expanded row
  const loadDetailMeasures = useCallback(async (contractId) => {
    if (detailMeasures[contractId]) return;
    setLoadingDetail(true);
    try {
      const { data, error: e } = await supabase
        .from("cm_vbp_contract_measures")
        .select("id, measure_code, target_type, target_value, target_unit, weight, denominator_min, status, measurement_period_label, payment_rule, notes, cm_hedis_measures(measure_name, classification_status)")
        .eq("contract_id", contractId)
        .order("measurement_period_label", { ascending: true, nullsFirst: true })
        .order("measure_code", { ascending: true });
      if (e) throw e;
      setDetailMeasures(prev => ({ ...prev, [contractId]: data || [] }));
    } catch (e) {
      setError(e.message || "Failed to load measures for that contract");
    } finally {
      setLoadingDetail(false);
    }
  }, [detailMeasures]);

  const toggleExpand = (contractId) => {
    if (expanded === contractId) {
      setExpanded(null);
    } else {
      setExpanded(contractId);
      loadDetailMeasures(contractId);
    }
  };

  const distinctPayers = useMemo(
    () => Array.from(new Set(contracts.map(c => c.payer_short_name).filter(Boolean))).sort(),
    [contracts]
  );
  const distinctMYs = useMemo(
    () => Array.from(new Set(contracts.map(c => c.measurement_year).filter(Boolean))).sort((a, b) => b - a),
    [contracts]
  );
  const distinctPrograms = useMemo(
    () => {
      const set = new Set(COMMON_PROGRAM_TYPES);
      contracts.forEach(c => c.program_type && set.add(c.program_type));
      return Array.from(set).sort();
    },
    [contracts]
  );

  const filtered = useMemo(() => {
    let rows = contracts;
    if (filterPayer)   rows = rows.filter(c => c.payer_short_name === filterPayer);
    if (filterMY)      rows = rows.filter(c => String(c.measurement_year) === filterMY);
    if (filterProgram) rows = rows.filter(c => c.program_type === filterProgram);
    if (filterStatus !== "All") rows = rows.filter(c => c.status === filterStatus);
    return rows;
  }, [contracts, filterPayer, filterMY, filterProgram, filterStatus]);

  // KPIs always reflect full contracts list, not filtered view
  const stats = useMemo(() => {
    const active = contracts.filter(c => c.status === "Active");
    const expiringSoon = active.filter(c => {
      const d = daysUntilExpiry(c.effective_end);
      return d !== null && d >= 0 && d < 60;
    }).length;
    const draft = contracts.filter(c => c.status === "Draft").length;
    const archived = contracts.filter(c => c.status === "Archived").length;
    return {
      active: active.length,
      expiringSoon,
      draft,
      archived,
      total: contracts.length,
    };
  }, [contracts]);

  if (!isAdmin) {
    return (
      <EmptyState
        title="Admin only"
        message="VBP contract administration is restricted to admin users."
      />
    );
  }

  if (loading) return <Loader label="Loading VBP contracts..." />;

  return (
    <div>
      {error && <ErrorBanner message={error} />}

      {/* Explainer header */}
      <Card style={{ padding: 14, marginBottom: 16, background: C.bgSecondary }}>
        <div style={{ fontSize: 13, color: C.textPrimary, lineHeight: 1.55 }}>
          <strong>VBP contracts</strong> describe the payment terms with each plan: which measures
          count, what targets unlock payment, and how dollars flow. The reconciliation engine and
          regression queue use these contracts as the source of truth for "what's in scope" - and
          eventually (Phase 3) the outbound serializer will use them to drive submission cadences.
        </div>
      </Card>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
        <KpiCard label="Active"          value={stats.active}        hint="Currently in effect" variant="blue" />
        <KpiCard label="Expiring < 60d"  value={stats.expiringSoon}  hint="Re-contract decisions due" variant={stats.expiringSoon > 0 ? "amber" : "neutral"} />
        <KpiCard label="Draft"           value={stats.draft}         hint="Not yet active" />
        <KpiCard label="Archived"        value={stats.archived}      hint="Ended or replaced" />
      </div>

      {/* Filters */}
      <Card style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
          <div>
            <FL>Payer</FL>
            <select value={filterPayer} onChange={e => setFilterPayer(e.target.value)} style={selectStyle}>
              <option value="">All payers</option>
              {distinctPayers.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <FL>Measurement Year</FL>
            <select value={filterMY} onChange={e => setFilterMY(e.target.value)} style={selectStyle}>
              <option value="">All years</option>
              {distinctMYs.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <FL>Program type</FL>
            <select value={filterProgram} onChange={e => setFilterProgram(e.target.value)} style={selectStyle}>
              <option value="">All types</option>
              {distinctPrograms.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <FL>Status</FL>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={selectStyle}>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
          <div style={{ fontSize: 11, color: C.textTertiary }}>
            Showing {filtered.length} of {contracts.length} contracts
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn variant="ghost" size="sm" onClick={load}>Refresh</Btn>
            <Btn variant="primary" size="sm" onClick={() => navigate("/care-management/vbp-contracts/new")}>
              + New contract
            </Btn>
          </div>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState
          title={contracts.length === 0 ? "No VBP contracts yet" : "No contracts match these filters"}
          message={contracts.length === 0
            ? "Add your first contract to track payer payment terms. The reconciliation engine and regression queue will use this for measure-in-scope decisions."
            : "Try adjusting your filters above."}
        />
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead style={{ background: C.bgSecondary, borderBottom: "0.5px solid " + C.borderLight }}>
              <tr>
                <Th>Label</Th>
                <Th>Payer</Th>
                <Th>MY</Th>
                <Th>Program type</Th>
                <Th>Effective</Th>
                <Th>Measures</Th>
                <Th>Status</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, idx) => (
                <ContractRow
                  key={c.id}
                  contract={c}
                  measureCounts={measureCountsById[c.id]}
                  isExpanded={expanded === c.id}
                  onToggle={() => toggleExpand(c.id)}
                  onEdit={() => navigate("/care-management/vbp-contracts/" + c.id)}
                  measures={detailMeasures[c.id]}
                  loadingDetail={loadingDetail && expanded === c.id && !detailMeasures[c.id]}
                  isLast={idx === filtered.length - 1}
                />
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

// ─── Table row + inline expansion ────────────────────────────────────────────
function ContractRow({ contract, measureCounts, isExpanded, onToggle, onEdit, measures, loadingDetail, isLast }) {
  const c = contract;
  const counts = measureCounts || { measures: 0, mps: 0 };
  const measuresLabel = counts.mps > 1
    ? counts.measures + "x" + counts.mps + "MPs"
    : counts.measures + (counts.measures === 1 ? " measure" : " measures");

  const expiry = daysUntilExpiry(c.effective_end);
  const effectiveLabel = (c.effective_start || "?") + " to " + (c.effective_end || "?");

  return (
    <>
      <tr
        onClick={onToggle}
        style={{
          borderBottom: isExpanded || !isLast ? "0.5px solid " + C.borderLight : "none",
          cursor: "pointer",
          background: isExpanded ? C.tealBg : "transparent",
        }}
      >
        <Td>
          <strong>{c.contract_label}</strong>
          {c.contract_type && (
            <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>
              {c.contract_type}
            </div>
          )}
        </Td>
        <Td>
          <strong>{NC_HEALTH_PLAN_LABELS[c.payer_short_name] || c.payer_short_name}</strong>
          <div style={{ fontSize: 10, color: C.textTertiary, fontFamily: "monospace", marginTop: 2 }}>
            {c.payer_short_name}
          </div>
        </Td>
        <Td>{c.measurement_year}</Td>
        <Td>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
            {c.program_type
              ? <Badge label={c.program_type} variant="neutral" size="xs" />
              : <span style={{ fontSize: 11, color: C.textTertiary }}>not set</span>}
            {c.hcp_lan_category && (
              <Badge label={"HCP-LAN " + c.hcp_lan_category} variant="blue" size="xs" />
            )}
          </div>
        </Td>
        <Td style={{ fontSize: 11 }}>
          <div>{effectiveLabel}</div>
          {expiry !== null && expiry >= 0 && expiry < 60 && (
            <div style={{ marginTop: 2 }}>
              <Badge label={"Expires in " + expiry + "d"} variant="amber" size="xs" />
            </div>
          )}
          {expiry !== null && expiry < 0 && (
            <div style={{ marginTop: 2 }}>
              <Badge label="Past end date" variant="neutral" size="xs" />
            </div>
          )}
        </Td>
        <Td>{measuresLabel}</Td>
        <Td><StatusBadge status={c.status} /></Td>
        <Td align="right">
          <Btn size="sm" variant="outline" onClick={e => { e.stopPropagation(); onEdit(); }}>Edit</Btn>
        </Td>
      </tr>
      {isExpanded && (
        <tr style={{ background: "#fcfcfc" }}>
          <td colSpan={8} style={{ padding: "16px 20px", borderBottom: !isLast ? "0.5px solid " + C.borderLight : "none" }}>
            <ContractDetail contract={c} measures={measures} loading={loadingDetail} />
          </td>
        </tr>
      )}
    </>
  );
}

function ContractDetail({ contract, measures, loading }) {
  const c = contract;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Classification */}
      {c.hcp_lan_category && (
        <div>
          <DetailLabel>HCP-LAN APM category</DetailLabel>
          <div style={{ fontSize: 12, color: C.textPrimary }}>
            {HCP_LAN_LABELS[c.hcp_lan_category] || c.hcp_lan_category}
          </div>
        </div>
      )}

      {/* Notes */}
      {c.notes && (
        <div>
          <DetailLabel>Notes</DetailLabel>
          <div style={{ fontSize: 12, color: C.textPrimary, whiteSpace: "pre-wrap" }}>{c.notes}</div>
        </div>
      )}

      {/* Payment methodology */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <DetailLabel>Payment methodology</DetailLabel>
          {c.notes_payment_methodology && (
            <div style={{ fontSize: 12, color: C.textPrimary, marginBottom: 6, whiteSpace: "pre-wrap" }}>
              {c.notes_payment_methodology}
            </div>
          )}
          <JsonBlock value={c.payment_methodology} />
        </div>
        <div>
          <DetailLabel>Eligibility requirements</DetailLabel>
          <JsonBlock value={c.eligibility_requirements} />
        </div>
      </div>

      {/* Measures table */}
      <div>
        <DetailLabel>Measures</DetailLabel>
        {loading ? (
          <Loader label="Loading measures..." />
        ) : (measures || []).length === 0 ? (
          <div style={{ fontSize: 12, color: C.textTertiary, fontStyle: "italic" }}>
            No measures attached to this contract yet.
          </div>
        ) : (
          <div style={{ border: "0.5px solid " + C.borderLight, borderRadius: 6, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead style={{ background: C.bgSecondary }}>
                <tr>
                  <Th>Code</Th>
                  <Th>Name</Th>
                  <Th>Target</Th>
                  <Th>Weight</Th>
                  <Th>Denom min</Th>
                  <Th>MP</Th>
                  <Th>Status</Th>
                  <Th>Payment rule</Th>
                </tr>
              </thead>
              <tbody>
                {measures.map((m, idx) => (
                  <tr key={m.id} style={{ borderTop: idx > 0 ? "0.5px solid " + C.borderLight : "none" }}>
                    <Td><code style={{ fontFamily: "monospace", fontWeight: 600, color: C.teal }}>{m.measure_code}</code></Td>
                    <Td>
                      {m.cm_hedis_measures?.measure_name || "-"}
                      {m.cm_hedis_measures?.classification_status === "unknown" && (
                        <span style={{ marginLeft: 6 }}><Badge label="Unknown" variant="amber" size="xs" /></span>
                      )}
                    </Td>
                    <Td style={{ fontSize: 11 }}>
                      {m.target_type}
                      {m.target_value !== null && m.target_value !== undefined ? " / " + m.target_value : ""}
                      {m.target_unit ? " " + m.target_unit : ""}
                    </Td>
                    <Td>{m.weight ?? "-"}</Td>
                    <Td>{m.denominator_min ?? "-"}</Td>
                    <Td>{m.measurement_period_label || "-"}</Td>
                    <Td><StatusBadge status={m.status} /></Td>
                    <Td style={{ maxWidth: 280 }}>
                      <JsonInline value={m.payment_rule} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Audit trail */}
      <div style={{ fontSize: 11, color: C.textTertiary, paddingTop: 6, borderTop: "0.5px solid " + C.borderLight }}>
        Created {fmtDateOnly(c.created_at)}
        {c.updated_at && c.updated_at !== c.created_at && " · Last edited " + fmtDateOnly(c.updated_at)}
      </div>
    </div>
  );
}

function DetailLabel({ children }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
      textTransform: "uppercase", color: C.textSecondary, marginBottom: 6,
    }}>
      {children}
    </div>
  );
}

function JsonBlock({ value }) {
  if (!value || (typeof value === "object" && Object.keys(value).length === 0)) {
    return <div style={{ fontSize: 11, color: C.textTertiary, fontStyle: "italic" }}>None set</div>;
  }
  return (
    <pre style={{
      fontFamily: "monospace", fontSize: 11, lineHeight: 1.5,
      background: C.bgSecondary, padding: 10, borderRadius: 6,
      border: "0.5px solid " + C.borderLight,
      whiteSpace: "pre-wrap", wordBreak: "break-word",
      maxHeight: 220, overflow: "auto", margin: 0,
    }}>
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function JsonInline({ value }) {
  if (!value) return <span style={{ fontSize: 11, color: C.textTertiary }}>-</span>;
  const summary = (() => {
    if (value.model === "per_gap" && value.amount !== undefined) {
      return "$" + value.amount + (value.high_priority_amount ? " ($" + value.high_priority_amount + " HP)" : "") + "/gap";
    }
    if (value.model === "per_gap_tiered" && Array.isArray(value.tiers)) {
      return value.tiers.length + " tiers, $" + value.tiers[0]?.amount + "-$" + value.tiers[value.tiers.length - 1]?.amount;
    }
    if (value.model === "weighted_benchmark") {
      return "weight " + (value.weight ?? "?") + " @ " + (value.benchmark_pct ?? "?") + "%";
    }
    if (value.model === "improvement_points" && Array.isArray(value.tiers)) {
      return value.tiers.length + " improvement tiers";
    }
    if (value.model === "fee_inflator") {
      return (value.adjustment_pct ?? "?") + "% rate inflator";
    }
    if (value.model === "reporting_only") {
      return "reporting only";
    }
    return value.model || "custom";
  })();
  return (
    <code style={{ fontFamily: "monospace", fontSize: 11, color: C.textSecondary }}>
      {summary}
    </code>
  );
}
