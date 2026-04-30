// src/views/care-management/PlanAssignmentsTab.jsx
//
// Plan Assignments tab for the AMH CM Add-On bundle.
// Lives inside CareManagementView. Gating happens at the parent router
// (only render this tab when the practice has an active AMH CM add-on
// subscription). This component assumes it should display.
//
// Source data: cm_amh_member_assignments
// Parser:      parse-amh-member-assignment edge function
// Poller:      amh-inbound-poll edge function (cron, currently paused)
//
// IMPORTANT - Add-on positioning:
// The Add-on pill in the header is intentional. This view is part of
// the AMH CM Add-On bundle and is NOT included in the standard Command
// tier. When the practice does not own the add-on, the parent router
// should hide this tab entirely or render an upsell stub instead.

import React, { useEffect, useMemo, useState } from "react";
import { useAmhAssignments } from "../../hooks/useAmhAssignments";
import { supabase } from "../../lib/supabaseClient";
 
// =============================================================================
// Tokens - replace with `import C from "../../lib/tokens"` if your project
// uses a centralized tokens file. Hardcoded here so the file is self-contained.
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
  blue:           "#185FA5",
  blueLight:      "#E6F1FB",
  blueText:       "#0C447C",
  green:          "#3B6D11",
  greenLight:     "#EAF3DE",
  greenText:      "#27500A",
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
// Small helpers
// =============================================================================
function fmtDate(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "-";
  return d.toISOString().slice(0, 10);
}

function fmtDateTime(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleString();
}

function timeSince(date) {
  if (!date) return "never";
  const ms = Date.now() - date.getTime();
  const mins  = Math.floor(ms / 60000);
  const hours = Math.floor(ms / 3600000);
  const days  = Math.floor(ms / 86400000);
  if (mins  < 1)  return "just now";
  if (mins  < 60) return mins  + "m ago";
  if (hours < 24) return hours + "h ago";
  return days + "d ago";
}

function memberFullName(r) {
  const first  = r.member_first_name  || "";
  const last   = r.member_last_name   || "";
  const middle = r.member_middle_name || "";
  if (last && first) {
    return middle
      ? last + ", " + first + " " + middle.charAt(0) + "."
      : last + ", " + first;
  }
  return last || first || "(no name)";
}

function providerName(first, last) {
  const f = first || "";
  const l = last  || "";
  if (l && f) return l + ", " + f;
  return l || f || "";
}

function maintenanceLabel(code) {
  if (code === "021") return { label: "021 New",     bg: C.greenLight, fg: C.greenText };
  if (code === "001") return { label: "001 Update",  bg: C.blueLight,  fg: C.blueText  };
  if (code === "024") return { label: "024 Termed",  bg: C.redLight,   fg: C.redText   };
  return { label: code || "-", bg: C.bgSecondary, fg: C.textSecondary };
}

function tierBadge(t) {
  // Per spec: PCP, AMH1, AMH2, AMH3
  if (t === "AMH3") return { label: "AMH3", bg: C.tealLight, fg: C.tealText };
  if (t === "AMH2") return { label: "AMH2", bg: C.tealLight, fg: C.tealText };
  if (t === "AMH1") return { label: "AMH1", bg: C.tealLight, fg: C.tealText };
  if (t === "PCP")  return { label: "PCP",  bg: C.bgSecondary, fg: C.textSecondary };
  return { label: t || "-", bg: C.bgSecondary, fg: C.textSecondary };
}

function reconBadge(status) {
  if (status === "Matched")          return { bg: C.tealLight, fg: C.tealText };
  if (status === "Manually Linked")  return { bg: C.tealLight, fg: C.tealText };
  if (status === "Auto Created")     return { bg: C.blueLight, fg: C.blueText };
  if (status === "Unmatched")        return { bg: C.amberLight, fg: C.amberText };
  if (status === "Manual Review")    return { bg: C.amberLight, fg: C.amberText };
  if (status === "Pending")          return { bg: C.bgSecondary, fg: C.textSecondary };
  return { bg: C.bgSecondary, fg: C.textSecondary };
}

// =============================================================================
// Inline primitives - replace with imports if your project provides them
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
    }}>{label}</span>
  );
}

function KpiCard({ label, value, hint, accent }) {
  // accent: undefined | "warning" | "success" | "danger"
  const bg = accent === "warning" ? C.amberLight : C.bgSecondary;
  const fg = accent === "warning" ? C.amberText
           : accent === "success" ? C.greenText
           : accent === "danger"  ? C.redText
           : C.textPrimary;
  const labelFg = accent === "warning" ? C.amberText : C.textSecondary;
  const hintFg  = accent === "warning" ? C.amberText : C.textTertiary;
  return (
    <div style={{
      background: bg,
      borderRadius: 8,
      padding: "12px 14px",
      minWidth: 0,
    }}>
      <div style={{ fontSize: 11, color: labelFg }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 500, marginTop: 2, color: fg }}>{value}</div>
      <div style={{ fontSize: 11, color: hintFg, marginTop: 2 }}>{hint}</div>
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
              : variant === "ghost"   ? "transparent"
              : C.bgPrimary,
    color:       variant === "primary" ? "#fff" : C.textPrimary,
    cursor:      disabled ? "not-allowed" : "pointer",
    opacity:     disabled ? 0.5 : 1,
    fontFamily:  "inherit",
    fontWeight:  500,
  };
  return <button style={base} onClick={onClick} disabled={disabled}>{children}</button>;
}

function Modal({ title, children, onClose, width }) {
  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "rgba(0,0,0,0.4)",
      zIndex: 100,
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: C.bgPrimary,
        borderRadius: 12,
        width: width || 720,
        maxWidth: "100%",
        maxHeight: "85vh",
        overflowY: "auto",
        boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
      }}>
        <div style={{
          padding: "16px 20px",
          borderBottom: "0.5px solid " + C.borderLight,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          position: "sticky", top: 0, background: C.bgPrimary, zIndex: 1,
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary }}>{title}</div>
          <button onClick={onClose} style={{
            border: "none", background: "transparent", cursor: "pointer",
            fontSize: 18, color: C.textTertiary, padding: 4,
          }}>x</button>
        </div>
        <div style={{ padding: 20 }}>{children}</div>
      </div>
    </div>
  );
}

// =============================================================================
// Main component
// =============================================================================
export default function PlanAssignmentsTab({ practiceId, currentUser }) {
  const { rows, loading, error, kpis, lastSync, refetch } = useAmhAssignments(practiceId);

  // Filter state
  const [filterPayer,    setFilterPayer]    = useState("all");
  const [filterMaint,    setFilterMaint]    = useState("all");
  const [filterRecon,    setFilterRecon]    = useState("all");
  const [filterDateRange, setFilterDateRange] = useState("30d");
  const [search,         setSearch]         = useState("");

  // Modals
  const [detailRow, setDetailRow]         = useState(null);
  const [showRepollModal, setShowRepollModal] = useState(false);
  const [repollState, setRepollState]     = useState({ running: false, message: null });

  // Derived: distinct payers in the data
  const payerOptions = useMemo(() => {
    const set = new Set();
    rows.forEach(r => { if (r.payer_short_name) set.add(r.payer_short_name); });
    return Array.from(set).sort();
  }, [rows]);

  // Apply filters in memory (volume is small per practice)
  const filteredRows = useMemo(() => {
    const cutoff = (() => {
      if (filterDateRange === "all") return null;
      const days = filterDateRange === "7d"  ? 7
                : filterDateRange === "30d" ? 30
                : filterDateRange === "90d" ? 90
                : null;
      return days ? Date.now() - days * 24 * 60 * 60 * 1000 : null;
    })();

    const q = search.trim().toLowerCase();

    return rows.filter(r => {
      if (filterPayer !== "all" && r.payer_short_name !== filterPayer) return false;
      if (filterMaint !== "all" && r.maintenance_type_code !== filterMaint) return false;
      if (filterRecon !== "all" && r.reconciliation_status !== filterRecon) return false;
      if (cutoff && r.last_seen_at && new Date(r.last_seen_at).getTime() < cutoff) return false;
      if (q) {
        const hay = (
          (r.member_last_name || "") + " " +
          (r.member_first_name || "") + " " +
          (r.cnds_id || "") + " " +
          (r.amh_last_name || "") + " " +
          (r.pcp_last_name || "")
        ).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, filterPayer, filterMaint, filterRecon, filterDateRange, search]);

  // -------------------------------------------------------------------------
  // Re-run reconciliation: calls parse-amh-member-assignment with
  // mode='reconcile_only' to retry CNDS-to-medicaid_id matching. SFTP polling
  // happens automatically on the Tuesday cron; manual polls live on the Plan
  // Connections tab where credentials and per-PHP profiles are managed (the
  // poller is per-profile and requires Owner/Manager role + configured creds).
  // This button is the everyday tool: fix a patient's medicaid_id in their
  // chart, click here, the row flips to Matched.
  // -------------------------------------------------------------------------
  async function handleRepollAndReparse() {
    setRepollState({ running: true, message: "Re-running patient reconciliation..." });
    try {
      const resp = await supabase.functions.invoke("parse-amh-member-assignment", {
        body: { practice_id: practiceId, mode: "reconcile_only" },
      });
      if (resp.error) {
        throw new Error("Reconciliation failed: " + resp.error.message);
      }
      const data = resp.data || {};
      const recon = data.reconciliation || { matched: 0, unmatched: 0 };
      const summary = "Reconciliation complete: " + recon.matched + " matched, "
                    + recon.unmatched + " still unmatched.";
      setRepollState({ running: false, message: summary });
      await refetch();
    } catch (e) {
      setRepollState({
        running: false,
        message: "Error: " + ((e && e.message) || String(e)),
      });
    }
  }

  // -------------------------------------------------------------------------
  // Layout
  // -------------------------------------------------------------------------
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
              Plan assignments
            </div>
            <Pill label="Add-on" bg={C.tealLight} fg={C.tealText} />
          </div>
          <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 2 }}>
            Beneficiary segments parsed from PHP 834 BA files. Part of the AMH CM Add-On bundle.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: C.textTertiary }}>
            Last sync: {timeSince(lastSync)}
            {payerOptions.length > 0 ? " - " + payerOptions.join(", ") : ""}
          </span>
          <Btn size="sm" onClick={() => setShowRepollModal(true)}>
            Re-run reconciliation
          </Btn>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>

        {/* KPI strip */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
          marginBottom: 16,
        }}>
          <KpiCard
            label="Total assignments"
            value={kpis.total}
            hint={"Across " + kpis.planCount + " plan" + (kpis.planCount === 1 ? "" : "s")}
          />
          <KpiCard
            label="New this week"
            value={kpis.newThisWeek}
            hint="Maintenance 021"
            accent={kpis.newThisWeek > 0 ? "success" : undefined}
          />
          <KpiCard
            label="Terminated"
            value={kpis.terminated}
            hint="Maintenance 024"
            accent={kpis.terminated > 0 ? "danger" : undefined}
          />
          <KpiCard
            label="Unmatched - need review"
            value={kpis.unmatched}
            hint={kpis.unmatched > 0 ? "Link to patients" : "All segments reconciled"}
            accent={kpis.unmatched > 0 ? "warning" : undefined}
          />
        </div>

        {/* Filter row */}
        <div style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
          padding: "10px 12px",
          background: C.bgSecondary,
          borderRadius: 8,
          marginBottom: 12,
        }}>
          <select value={filterPayer} onChange={e => setFilterPayer(e.target.value)} style={selectStyle}>
            <option value="all">All plans</option>
            {payerOptions.map(p => <option key={p} value={p}>{p.toUpperCase()}</option>)}
          </select>
          <select value={filterMaint} onChange={e => setFilterMaint(e.target.value)} style={selectStyle}>
            <option value="all">All maintenance</option>
            <option value="021">New (021)</option>
            <option value="001">Update (001)</option>
            <option value="024">Terminated (024)</option>
          </select>
          <select value={filterDateRange} onChange={e => setFilterDateRange(e.target.value)} style={selectStyle}>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="all">All time</option>
          </select>
          <select value={filterRecon} onChange={e => setFilterRecon(e.target.value)} style={selectStyle}>
            <option value="all">All recon states</option>
            <option value="Pending">Pending</option>
            <option value="Matched">Matched</option>
            <option value="Unmatched">Unmatched</option>
            <option value="Manually Linked">Manually Linked</option>
            <option value="Auto Created">Auto Created</option>
            <option value="Manual Review">Manual Review</option>
          </select>
          <input
            type="text"
            placeholder="Name, CNDS, or provider"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              flex: 1,
              minWidth: 160,
              fontSize: 12,
              padding: "5px 10px",
              borderRadius: 8,
              border: "0.5px solid " + C.borderMid,
              background: C.bgPrimary,
              fontFamily: "inherit",
              outline: "none",
            }}
          />
        </div>

        {/* Table */}
        {loading
          ? <LoadingSkeleton />
          : error
            ? <ErrorBlock message={error} onRetry={refetch} />
            : filteredRows.length === 0
              ? <EmptyState hasAnyData={rows.length > 0} />
              : <AssignmentsTable rows={filteredRows} onSelectRow={setDetailRow} />
        }

        {/* Footer line */}
        {!loading && rows.length > 0 ? (
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "10px 2px", marginTop: 8,
            fontSize: 11, color: C.textTertiary,
          }}>
            <div>Showing {filteredRows.length} of {rows.length} - click any row for full eligibility history</div>
          </div>
        ) : null}
      </div>

      {/* Detail modal */}
      {detailRow ? (
        <DetailModal
          row={detailRow}
          allRows={rows}
          onClose={() => setDetailRow(null)}
          onReconciliationChanged={async () => { await refetch(); }}
          practiceId={practiceId}
          currentUser={currentUser}
        />
      ) : null}

      {/* Re-poll & re-parse confirmation / progress modal */}
      {showRepollModal ? (
        <RepollModal
          state={repollState}
          onConfirm={handleRepollAndReparse}
          onClose={() => {
            setShowRepollModal(false);
            setRepollState({ running: false, message: null });
          }}
        />
      ) : null}
    </div>
  );
}

// =============================================================================
// Inline styles shared across selects
// =============================================================================
const selectStyle = {
  fontSize: 12,
  padding: "5px 8px",
  borderRadius: 8,
  border: "0.5px solid " + C.borderMid,
  background: C.bgPrimary,
  fontFamily: "inherit",
  cursor: "pointer",
};

// =============================================================================
// Sub-components
// =============================================================================

function AssignmentsTable({ rows, onSelectRow }) {
  const cols = "minmax(200px, 2fr) minmax(140px, 1.4fr) 90px minmax(180px, 1.6fr) 110px 130px";
  return (
    <div style={{
      border: "0.5px solid " + C.borderLight,
      borderRadius: 8,
      overflow: "hidden",
    }}>
      {/* Header row */}
      <div style={{
        display: "grid",
        gridTemplateColumns: cols,
        gap: 10,
        padding: "10px 14px",
        fontSize: 11,
        color: C.textSecondary,
        borderBottom: "0.5px solid " + C.borderLight,
        background: C.bgSecondary,
        fontWeight: 500,
      }}>
        <div>Member</div>
        <div>CNDS - plan</div>
        <div>Tier</div>
        <div>Provider - eligibility</div>
        <div>Maintenance</div>
        <div style={{ textAlign: "right" }}>Recon</div>
      </div>

      {rows.map((r, idx) => {
        const tier  = tierBadge(r.php_amh_pcp_type_and_tier);
        const maint = maintenanceLabel(r.maintenance_type_code);
        const recon = reconBadge(r.reconciliation_status);
        const provFirst = r.amh_first_name || r.pcp_first_name;
        const provLast  = r.amh_last_name  || r.pcp_last_name;
        return (
          <div
            key={r.id}
            onClick={() => onSelectRow(r)}
            style={{
              display: "grid",
              gridTemplateColumns: cols,
              gap: 10,
              padding: "12px 14px",
              alignItems: "center",
              borderBottom: idx === rows.length - 1 ? "none" : "0.5px solid " + C.borderLight,
              cursor: "pointer",
              transition: "background 0.1s",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = C.bgSecondary; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
          >
            <div>
              <div style={{ fontWeight: 500, color: C.textPrimary, fontSize: 13 }}>
                {memberFullName(r)}
              </div>
              <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>
                DOB {fmtDate(r.member_dob)}
                {r.res_county_code ? " - county " + r.res_county_code : ""}
              </div>
            </div>
            <div>
              <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: C.textPrimary }}>
                {r.cnds_id}
              </div>
              <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>
                {(r.payer_short_name || "").toUpperCase()}
                {r.plan_coverage_description ? " - " + r.plan_coverage_description : ""}
              </div>
            </div>
            <div>
              <Pill label={tier.label} bg={tier.bg} fg={tier.fg} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: C.textPrimary }}>
                {providerName(provFirst, provLast) || "-"}
              </div>
              <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>
                {fmtDate(r.enrollment_start_date)} -&gt; {fmtDate(r.enrollment_end_date)}
              </div>
            </div>
            <div>
              <Pill label={maint.label} bg={maint.bg} fg={maint.fg} />
            </div>
            <div style={{ textAlign: "right" }}>
              <Pill
                label={r.reconciliation_status || "Pending"}
                bg={recon.bg}
                fg={recon.fg}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LoadingSkeleton() {
  const cell = { background: C.bgSecondary, borderRadius: 4, height: 12 };
  const rows = [1, 2, 3, 4];
  return (
    <div style={{
      border: "0.5px solid " + C.borderLight,
      borderRadius: 8,
      overflow: "hidden",
    }}>
      {rows.map(i => (
        <div key={i} style={{
          padding: "16px 14px",
          borderBottom: i === rows.length ? "none" : "0.5px solid " + C.borderLight,
          display: "grid", gridTemplateColumns: "2fr 1.4fr 1fr 1.6fr 1fr 1fr", gap: 10,
        }}>
          <div style={{ ...cell, width: "70%" }} />
          <div style={{ ...cell, width: "60%" }} />
          <div style={{ ...cell, width: "40%" }} />
          <div style={{ ...cell, width: "80%" }} />
          <div style={{ ...cell, width: "50%" }} />
          <div style={{ ...cell, width: "60%" }} />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ hasAnyData }) {
  return (
    <div style={{
      padding: "60px 20px",
      textAlign: "center",
      border: "0.5px dashed " + C.borderMid,
      borderRadius: 8,
      background: C.bgSecondary,
    }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary, marginBottom: 6 }}>
        {hasAnyData ? "No assignments match your filters" : "No assignments parsed yet"}
      </div>
      <div style={{ fontSize: 12, color: C.textSecondary, maxWidth: 480, margin: "0 auto" }}>
        {hasAnyData
          ? "Try widening the date range or clearing the search box."
          : "Once a PHP drops a Beneficiary Assignment file (NCMT_BeneficiaryAssignmentData_*) into your inbound SFTP, it will be parsed automatically every Tuesday morning. You can also click Re-poll &amp; re-parse to trigger it now."}
      </div>
    </div>
  );
}

function ErrorBlock({ message, onRetry }) {
  return (
    <div style={{
      padding: 20,
      border: "0.5px solid " + C.redLight,
      background: C.redLight,
      borderRadius: 8,
      color: C.redText,
      fontSize: 13,
    }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Failed to load plan assignments</div>
      <div style={{ marginBottom: 10, fontFamily: "ui-monospace, monospace", fontSize: 11 }}>
        {message}
      </div>
      <Btn size="sm" onClick={onRetry}>Retry</Btn>
    </div>
  );
}

// =============================================================================
// Detail modal: full eligibility history for a CNDS + reconciliation actions
// =============================================================================
function DetailModal({ row, allRows, onClose, onReconciliationChanged, practiceId, currentUser }) {
  // Sibling segments for this CNDS, newest first
  const history = useMemo(() => {
    return allRows
      .filter(x => x.cnds_id === row.cnds_id)
      .sort((a, b) => {
        const ad = a.php_eligibility_begin_date || "";
        const bd = b.php_eligibility_begin_date || "";
        return bd.localeCompare(ad);
      });
  }, [allRows, row.cnds_id]);

  const [busy, setBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState(null);

  async function setReconciliationStatus(newStatus, note) {
    setBusy(true);
    setActionMsg(null);
    const patch = {
      reconciliation_status: newStatus,
      reconciled_at: new Date().toISOString(),
    };
    if (typeof note === "string") patch.reconciliation_notes = note;
    // Reset to pending also clears the patient link, so the next reconcile
    // pass can re-evaluate from scratch. Without this the row sits in a
    // zombie state (Pending status + still pointing at the old patient).
    if (newStatus === "Pending") patch.matched_patient_id = null;
    // When resetting to Pending, also clear the patient link so auto-recon
    // can re-evaluate from scratch on the next parser run. Otherwise the
    // row sits in a zombie state (Pending status + still pointing at the
    // old patient) and the recon pass skips it.
    if (newStatus === "Pending") patch.matched_patient_id = null;
    const { error } = await supabase
      .from("cm_amh_member_assignments")
      .update(patch)
      .eq("id", row.id);
    setBusy(false);
    if (error) {
      setActionMsg("Update failed: " + error.message);
    } else {
      setActionMsg("Status set to " + newStatus + ".");
      await onReconciliationChanged();
    }
  }

  const tier  = tierBadge(row.php_amh_pcp_type_and_tier);
  const maint = maintenanceLabel(row.maintenance_type_code);
  const recon = reconBadge(row.reconciliation_status);

  return (
    <Modal
      title={memberFullName(row) + " - " + row.cnds_id}
      onClose={onClose}
      width={780}
    >
      {/* Top summary card */}
      <div style={{
        background: C.bgSecondary,
        borderRadius: 8,
        padding: 14,
        marginBottom: 16,
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 10,
        fontSize: 12,
      }}>
        <SummaryRow label="DOB"           value={fmtDate(row.member_dob)} />
        <SummaryRow label="Phone"         value={row.member_phone || "-"} />
        <SummaryRow label="Plan"          value={(row.payer_short_name || "").toUpperCase() + " - " + (row.plan_coverage_description || "-")} />
        <SummaryRow label="Tier"          value={<Pill label={tier.label} bg={tier.bg} fg={tier.fg} />} />
        <SummaryRow label="Maintenance"   value={<Pill label={maint.label} bg={maint.bg} fg={maint.fg} />} />
        <SummaryRow label="Recon status"  value={<Pill label={row.reconciliation_status || "Pending"} bg={recon.bg} fg={recon.fg} />} />
        <SummaryRow label="AMH provider"  value={providerName(row.amh_first_name, row.amh_last_name) || "-"} />
        <SummaryRow label="AMH NPI/Aty"   value={row.amh_identification_code || "-"} />
        <SummaryRow label="PCP provider"  value={providerName(row.pcp_first_name, row.pcp_last_name) || "-"} />
        <SummaryRow label="PCP NPI/Aty"   value={row.pcp_identification_code || "-"} />
        <SummaryRow label="Address"       value={row.res_address_line1 ? row.res_address_line1 + ", " + (row.res_city || "") + " " + (row.res_state || "") + " " + (row.res_zip || "") : "-"} />
        <SummaryRow label="County"        value={row.res_county_code || "-"} />
      </div>

      {/* Eligibility history */}
      <div style={{ fontSize: 12, fontWeight: 600, color: C.textPrimary, marginBottom: 8 }}>
        Eligibility history ({history.length} segment{history.length === 1 ? "" : "s"})
      </div>
      <div style={{
        border: "0.5px solid " + C.borderLight,
        borderRadius: 8,
        marginBottom: 16,
        overflow: "hidden",
      }}>
        {history.map((h, i) => {
          const isCurrent = h.id === row.id;
          const m = maintenanceLabel(h.maintenance_type_code);
          return (
            <div key={h.id} style={{
              padding: "10px 14px",
              borderBottom: i === history.length - 1 ? "none" : "0.5px solid " + C.borderLight,
              background: isCurrent ? C.tealLight : "transparent",
              display: "grid",
              gridTemplateColumns: "1fr 1.5fr 1fr",
              gap: 8,
              fontSize: 11,
            }}>
              <div>
                <div style={{ color: isCurrent ? C.tealText : C.textSecondary, fontWeight: 500 }}>
                  PHP eligibility
                </div>
                <div style={{ color: isCurrent ? C.tealText : C.textPrimary, marginTop: 2 }}>
                  {fmtDate(h.php_eligibility_begin_date)} -&gt; {fmtDate(h.php_eligibility_end_date)}
                </div>
              </div>
              <div>
                <div style={{ color: isCurrent ? C.tealText : C.textSecondary, fontWeight: 500 }}>
                  {(h.payer_short_name || "").toUpperCase()} - {h.plan_coverage_description || "-"}
                </div>
                <div style={{ color: isCurrent ? C.tealText : C.textTertiary, marginTop: 2 }}>
                  Provider: {providerName(h.amh_first_name || h.pcp_first_name, h.amh_last_name || h.pcp_last_name) || "-"}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                <Pill label={m.label} bg={m.bg} fg={m.fg} />
                {isCurrent ? <span style={{ fontSize: 10, color: C.tealText, fontWeight: 500 }}>CURRENT</span> : null}
              </div>
            </div>
          );
        })}
      </div>

      {/* File lineage */}
      <div style={{ fontSize: 12, fontWeight: 600, color: C.textPrimary, marginBottom: 8 }}>
        File lineage
      </div>
      <div style={{
        background: C.bgSecondary,
        borderRadius: 8,
        padding: 12,
        marginBottom: 16,
        fontSize: 11,
        color: C.textSecondary,
        display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px",
      }}>
        <div>First seen</div>
        <div style={{ color: C.textPrimary, fontFamily: "ui-monospace, monospace" }}>
          {fmtDateTime(row.first_seen_at)}
        </div>
        <div>Last seen</div>
        <div style={{ color: C.textPrimary, fontFamily: "ui-monospace, monospace" }}>
          {fmtDateTime(row.last_seen_at)}
        </div>
        <div>Times seen</div>
        <div style={{ color: C.textPrimary }}>{row.times_seen || 1}</div>
        <div>Source row index</div>
        <div style={{ color: C.textPrimary }}>{row.source_record_index || "-"}</div>
      </div>

      <DiscrepancyPanel baRow={row} currentUser={currentUser} />

      {/* Reconciliation actions */}
      <div style={{ fontSize: 12, fontWeight: 600, color: C.textPrimary, marginBottom: 8 }}>
        Reconciliation
      </div>
      {row.reconciliation_status === "Matched" || row.reconciliation_status === "Manually Linked" ? (
        <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 12 }}>
          Linked to patient ID: <span style={{ fontFamily: "ui-monospace, monospace" }}>{row.matched_patient_id}</span>
          {row.reconciled_at ? <span style={{ color: C.textTertiary }}> - reconciled {fmtDateTime(row.reconciled_at)}</span> : null}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 12 }}>
          This segment is not linked to a patient yet. To link it, set the patient&apos;s
          {" "}<span style={{ fontFamily: "ui-monospace, monospace" }}>medicaid_id</span>{" "}
          to <span style={{ fontFamily: "ui-monospace, monospace" }}>{row.cnds_id}</span> from the patient chart, then click Re-poll &amp; re-parse on the assignments tab. Auto-reconciliation runs after every parse.
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Btn size="sm" onClick={() => setReconciliationStatus("Manual Review", "Flagged for manual review by " + (currentUserLabel() || "staff"))} disabled={busy}>
          Flag for manual review
        </Btn>
        {row.reconciliation_status !== "Pending" ? (
          <Btn size="sm" variant="ghost" onClick={() => setReconciliationStatus("Pending", null)} disabled={busy}>
            Reset to pending
          </Btn>
        ) : null}
      </div>
      {actionMsg ? (
        <div style={{
          marginTop: 10, fontSize: 11,
          color: actionMsg.startsWith("Update failed") ? C.redText : C.tealText,
        }}>{actionMsg}</div>
      ) : null}
    </Modal>
  );
}

function SummaryRow({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
      <span style={{ color: C.textSecondary }}>{label}</span>
      <span style={{ color: C.textPrimary, fontWeight: 500, textAlign: "right" }}>{value}</span>
    </div>
  );
}

// Pulled out so DetailModal stays renderable even if currentUser is undefined
function currentUserLabel() {
  // Replace with your actual current-user accessor if you wire one in.
  return null;
}

// =============================================================================
// DiscrepancyPanel - shows fields that differ between the BA file's view of
// the member and the matched patient record. Read-only, informational only.
//
// Renders only for rows with matched_patient_id set (Matched + Manually Linked
// + Manual Review). The panel returns null when there's no patient to compare
// against, so it auto-hides for Pending and Unmatched rows.
//
// Comparison rules:
//   - String fields are normalized (trim + lowercase) before compare so
//     "JANE DOE" and "Jane Doe" don't flag as a difference.
//   - Phone strips all non-digits before compare.
//   - ZIP compares first 5 chars only (handles ZIP+4 in either source).
//   - Gender maps the BA file's code (1/2 or M/F) to the desc when desc is
//     missing.
//   - We INTENTIONALLY do not compare county - BA stores 3-digit codes
//     ("092"), patients table stores names ("Wake"). Without a mapping we'd
//     get false positives on every row. Defer until we have the code table.
//   - Email is not on the BA file, so we don't compare it either.
//
// A field counts as a discrepancy only when BOTH sides have a value AND they
// differ, OR when the BA has a value and the patient field is empty (since
// that's a hint to update the patient chart). Patient-has-data-BA-doesn't is
// not flagged - the BA file simply doesn't track everything.
// =============================================================================
function DiscrepancyPanel({ baRow, currentUser }) {
  const [patient, setPatient] = useState(null);
  const [loading, setLoading] = useState(true);
  // Bumping refreshKey re-triggers the patient fetch effect after Apply,
  // which makes the just-applied row drop out of the diff list automatically.
  const [refreshKey, setRefreshKey] = useState(0);
  // Tracks which field is currently saving so the row's button can show
  // "Applying..." and avoid double-submits.
  const [pendingField, setPendingField] = useState(null);
  const [errMsg, setErrMsg] = useState(null);

  // Apply is gated to roles that routinely maintain patient demographics.
  // RLS on the patients table is the real enforcement boundary - this is a
  // UI-only gate that controls whether the Apply button is even rendered.
  //
  // v1 hardcoded allow-list. Onboarding wizard will replace with a
  // per-practice configurable list and a per-user override so an Office
  // Manager can grant or revoke this privilege individually.
  //
  // Intentionally excluded:
  //   Patient - can't reach this page anyway
  //   Provider - clinical role; chart maintenance isn't their workflow
  //   CHW - field worker without onsite supervision when applying
  // If a practice needs Provider or CHW included, add them here for now;
  // the wizard will make this surface-level customizable.
  const APPLY_ROLES = new Set([
    "Owner",
    "Manager",
    "Front Desk",
    "Medical Assistant",
    "Billing",
    "Care Manager",
    "Supervising Care Manager",
    "Care Manager Supervisor",
  ]);
  const canApply = !!(currentUser?.role && APPLY_ROLES.has(currentUser.role));

  useEffect(() => {
    if (!baRow.matched_patient_id) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("patients")
        .select("first_name, last_name, date_of_birth, gender, phone_mobile, address_line1, city, state, zip, preferred_language")
        .eq("id", baRow.matched_patient_id)
        .maybeSingle();
      if (cancelled) return;
      setPatient(data || null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [baRow.matched_patient_id, refreshKey]);

  if (!baRow.matched_patient_id) return null;
  if (loading) return null;
  if (!patient) return null;

  const diffs = computeBaPatientDiffs(baRow, patient);

  // Apply a single field's BA value to the patient record. Two writes:
  //   1. UPDATE patients SET <field> = <value>
  //   2. log_audit RPC capturing source BA segment + old/new values for
  //      reversibility and compliance.
  // If the audit log fails, we still consider the apply successful from the
  // user's perspective (the patient record was updated). The audit failure
  // is logged to console for ops to investigate; we don't roll back the
  // patient update because the data move is the user-facing operation.
  async function applyField(diff) {
    setPendingField(diff.patientField);
    setErrMsg(null);
    try {
      const { error: updErr } = await supabase
        .from("patients")
        .update({ [diff.patientField]: diff.applyValue })
        .eq("id", baRow.matched_patient_id);
      if (updErr) throw new Error(updErr.message);

      const { error: audErr } = await supabase.rpc("log_audit", {
        p_action: "Update",
        p_entity_type: "patients",
        p_entity_id: baRow.matched_patient_id,
        p_patient_id: baRow.matched_patient_id,
        p_details: {
          source: "amh_ba_apply",
          source_ba_id: baRow.id,
          source_ba_file_id: baRow.first_seen_file_id,
          source_cnds_id: baRow.cnds_id,
          applied_field: diff.patientField,
          old_value: diff.patientValue || null,
          new_value: diff.applyValue,
        },
        p_success: true,
        p_error_message: null,
      });
      if (audErr) {
        console.warn("[discrepancy panel] audit_log write failed:", audErr.message);
      }

      setRefreshKey(k => k + 1);
    } catch (e) {
      setErrMsg("Apply failed: " + ((e && e.message) || String(e)));
    } finally {
      setPendingField(null);
    }
  }

  const hasIdentityDiffs = diffs.some(d => !d.canApply);
  const hasApplyableDiffs = diffs.some(d => d.canApply);

  return (
    <>
      <div style={{ fontSize: 12, fontWeight: 600, color: C.textPrimary, marginBottom: 8 }}>
        BA file vs patient record
      </div>
      {diffs.length === 0 ? (
        <div style={{
          background: C.tealLight,
          border: "0.5px solid " + C.tealLight,
          borderLeft: "3px solid " + C.tealMid,
          borderRadius: 6,
          padding: "8px 12px",
          marginBottom: 16,
          fontSize: 11,
          color: C.tealText,
        }}>
          Patient record matches the BA file across all checked fields.
        </div>
      ) : (
        <div style={{
          background: "#FEF3C7",
          border: "0.5px solid #FDE68A",
          borderLeft: "3px solid #D97706",
          borderRadius: 6,
          padding: 12,
          marginBottom: 16,
        }}>
          <div style={{ fontSize: 11, color: "#854F0B", marginBottom: 10, fontWeight: 600 }}>
            {diffs.length} field{diffs.length === 1 ? "" : "s"} differ from the patient record. Review the match before relying on it.
          </div>
          <div style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr 1fr auto",
            gap: "6px 14px",
            fontSize: 11,
            alignItems: "center",
          }}>
            <div style={{ fontWeight: 700, color: "#854F0B", letterSpacing: "0.04em", textTransform: "uppercase", fontSize: 9 }}>Field</div>
            <div style={{ fontWeight: 700, color: "#854F0B", letterSpacing: "0.04em", textTransform: "uppercase", fontSize: 9 }}>BA file</div>
            <div style={{ fontWeight: 700, color: "#854F0B", letterSpacing: "0.04em", textTransform: "uppercase", fontSize: 9 }}>Patient record</div>
            <div></div>
            {diffs.map((d, i) => {
              const showApply = d.canApply && canApply;
              const isPending = pendingField === d.patientField;
              return (
                <React.Fragment key={i}>
                  <div style={{ color: "#92400E", fontWeight: 500 }}>{d.label}</div>
                  <div style={{
                    color: C.textPrimary,
                    fontFamily: d.mono ? "ui-monospace, monospace" : "inherit",
                  }}>
                    {d.baValue || <span style={{ color: C.textTertiary, fontStyle: "italic" }}>(empty)</span>}
                  </div>
                  <div style={{
                    color: C.textPrimary,
                    fontFamily: d.mono ? "ui-monospace, monospace" : "inherit",
                  }}>
                    {d.patientValue || <span style={{ color: C.textTertiary, fontStyle: "italic" }}>(not set)</span>}
                  </div>
                  <div>
                    {showApply ? (
                      <button
                        onClick={() => applyField(d)}
                        disabled={isPending}
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          padding: "3px 9px",
                          background: isPending ? C.bgSecondary : "#fff",
                          border: "0.5px solid #D97706",
                          borderRadius: 4,
                          color: "#854F0B",
                          cursor: isPending ? "wait" : "pointer",
                          fontFamily: "inherit",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {isPending ? "Applying..." : "Apply to chart"}
                      </button>
                    ) : null}
                  </div>
                </React.Fragment>
              );
            })}
          </div>
          {hasIdentityDiffs ? (
            <div style={{ fontSize: 10, color: "#854F0B", marginTop: 10, fontStyle: "italic" }}>
              Name and date of birth cannot be applied. If those differ, the wrong patient is probably linked - use Reset to pending below and fix the medicaid_id on the correct patient.
            </div>
          ) : null}
          {!canApply && hasApplyableDiffs ? (
            <div style={{ fontSize: 10, color: C.textSecondary, marginTop: 10, fontStyle: "italic" }}>
              Your role does not have permission to apply BA values to the patient chart. Ask your office manager.
            </div>
          ) : null}
          {errMsg ? (
            <div style={{ fontSize: 11, color: C.redText, marginTop: 8 }}>
              {errMsg}
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}

// Returns an array of diff records, one per field that differs between the
// BA segment and the matched patient record.
//
// Each record:
//   { label, baValue, patientValue, canApply, patientField?, applyValue?, mono? }
//
//   - canApply=false on identity fields (first_name, last_name, date_of_birth)
//     because if those differ it means the wrong patient is linked, and the
//     correct action is Reset to pending - not overwriting demographics.
//   - canApply=true on demographic + address fields. patientField names the
//     column to write, applyValue is the normalized value to write.
//
// See the DiscrepancyPanel comment block above for comparison rules.
function computeBaPatientDiffs(ba, patient) {
  const norm = s => (s || "").toString().trim().toLowerCase();
  const phoneOnly = s => (s || "").toString().replace(/\D/g, "");
  const zip5 = s => (s || "").toString().trim().slice(0, 5);

  const out = [];

  // Identity fields - canApply=false. Mismatches here mean the wrong patient
  // is linked; the right fix is Reset to pending, not overwriting the chart.

  if (ba.member_first_name && patient.first_name &&
      norm(ba.member_first_name) !== norm(patient.first_name)) {
    out.push({
      label: "First name",
      baValue: ba.member_first_name,
      patientValue: patient.first_name,
      canApply: false,
    });
  }

  if (ba.member_last_name && patient.last_name &&
      norm(ba.member_last_name) !== norm(patient.last_name)) {
    out.push({
      label: "Last name",
      baValue: ba.member_last_name,
      patientValue: patient.last_name,
      canApply: false,
    });
  }

  if (ba.member_dob && patient.date_of_birth &&
      ba.member_dob !== patient.date_of_birth) {
    out.push({
      label: "Date of birth",
      baValue: ba.member_dob,
      patientValue: patient.date_of_birth,
      canApply: false,
      mono: true,
    });
  }

  // Demographics + address - canApply=true.

  // Gender: BA may have desc ("Male"/"Female") OR code (1/2 or M/F).
  // Map code to desc as fallback; patients table uses Title Case enum.
  const baGenderCode = (ba.member_gender_code || "").toString().trim().toUpperCase();
  const baGender = ba.member_gender_desc
    || (baGenderCode === "1" || baGenderCode === "M" ? "Male"
      : baGenderCode === "2" || baGenderCode === "F" ? "Female"
      : null);
  if (baGender && patient.gender && norm(baGender) !== norm(patient.gender)) {
    out.push({
      label: "Gender",
      baValue: baGender,
      patientValue: patient.gender,
      patientField: "gender",
      applyValue: baGender,
      canApply: true,
    });
  }

  // Phone: BA stores raw 10 digits, patient may have formatting. Apply digits-only.
  if (ba.member_phone) {
    const baP = phoneOnly(ba.member_phone);
    const patP = phoneOnly(patient.phone_mobile);
    if (baP && (!patP || baP !== patP)) {
      out.push({
        label: "Phone",
        baValue: ba.member_phone,
        patientValue: patient.phone_mobile,
        patientField: "phone_mobile",
        applyValue: baP,
        canApply: true,
        mono: true,
      });
    }
  }

  if (ba.res_address_line1) {
    if (!patient.address_line1 || norm(ba.res_address_line1) !== norm(patient.address_line1)) {
      out.push({
        label: "Address",
        baValue: ba.res_address_line1,
        patientValue: patient.address_line1,
        patientField: "address_line1",
        applyValue: ba.res_address_line1,
        canApply: true,
      });
    }
  }

  if (ba.res_city && patient.city && norm(ba.res_city) !== norm(patient.city)) {
    out.push({
      label: "City",
      baValue: ba.res_city,
      patientValue: patient.city,
      patientField: "city",
      applyValue: ba.res_city,
      canApply: true,
    });
  }

  if (ba.res_state && patient.state &&
      ba.res_state.toString().trim().toUpperCase() !== patient.state.toString().trim().toUpperCase()) {
    out.push({
      label: "State",
      baValue: ba.res_state,
      patientValue: patient.state,
      patientField: "state",
      applyValue: ba.res_state.toString().trim().toUpperCase(),
      canApply: true,
    });
  }

  if (ba.res_zip && patient.zip && zip5(ba.res_zip) !== zip5(patient.zip)) {
    out.push({
      label: "ZIP",
      baValue: ba.res_zip,
      patientValue: patient.zip,
      patientField: "zip",
      applyValue: zip5(ba.res_zip),
      canApply: true,
      mono: true,
    });
  }

  if (ba.language_desc && patient.preferred_language &&
      norm(ba.language_desc) !== norm(patient.preferred_language)) {
    out.push({
      label: "Language",
      baValue: ba.language_desc,
      patientValue: patient.preferred_language,
      patientField: "preferred_language",
      applyValue: ba.language_desc,
      canApply: true,
    });
  }

  return out;
}

// =============================================================================
// Re-poll & re-parse confirmation modal
// =============================================================================
function RepollModal({ state, onConfirm, onClose }) {
  const isRunning = state.running;
  const hasResult = !state.running && state.message;
  return (
    <Modal title="Re-run reconciliation" onClose={isRunning ? () => {} : onClose} width={500}>
      {!hasResult ? (
        <>
          <div style={{ fontSize: 13, color: C.textPrimary, marginBottom: 12 }}>
            This will re-run patient matching for all Pending rows in your assignments table:
          </div>
          <ol style={{ fontSize: 12, color: C.textSecondary, paddingLeft: 20, marginBottom: 16, lineHeight: 1.6 }}>
            <li>For each Pending segment, look up a patient with a matching <code>medicaid_id</code>.</li>
            <li>If found, set the row to <code>Matched</code> and link the patient.</li>
            <li>If not, set the row to <code>Unmatched</code>.</li>
          </ol>
          <div style={{ fontSize: 11, color: C.textTertiary, marginBottom: 16 }}>
            Use this after fixing a patient's <code>medicaid_id</code> in their chart. SFTP polling
            for new BA files runs automatically every Tuesday morning. To force a poll outside
            that schedule, use the Plan Connections tab.
          </div>
          {isRunning && state.message ? (
            <div style={{
              padding: 10,
              background: C.bgSecondary,
              borderRadius: 6,
              fontSize: 12,
              color: C.textSecondary,
              marginBottom: 12,
              fontStyle: "italic",
            }}>{state.message}</div>
          ) : null}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Btn size="sm" variant="ghost" onClick={onClose} disabled={isRunning}>Cancel</Btn>
            <Btn size="sm" variant="primary" onClick={onConfirm} disabled={isRunning}>
              {isRunning ? "Running..." : "Run now"}
            </Btn>
          </div>
        </>
      ) : (
        <>
          <div style={{
            padding: 14,
            background: state.message.startsWith("Error") ? C.redLight : C.tealLight,
            color: state.message.startsWith("Error") ? C.redText : C.tealText,
            borderRadius: 8,
            fontSize: 13,
            marginBottom: 16,
          }}>
            {state.message}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Btn size="sm" onClick={onClose}>Close</Btn>
          </div>
        </>
      )}
    </Modal>
  );
}
