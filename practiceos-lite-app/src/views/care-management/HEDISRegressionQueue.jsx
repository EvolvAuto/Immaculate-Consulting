// ═══════════════════════════════════════════════════════════════════════════
// HEDISRegressionQueue.jsx
//
// Sub-tab inside the HEDIS module. Lists gaps that have regressed:
// closures we previously attested to that the plan now reports as
// non-compliant on a fresh upload.
//
// Source of truth: cm_hedis_regression_queue view, which filters
// cm_hedis_member_gaps to rows where regression_flagged_at IS NOT NULL
// AND regression_resolved_at IS NULL. View pre-joins patient names and
// measure metadata so this surface needs no extra joins.
//
// Resolution actions write back to cm_hedis_member_gaps:
//   Resubmitted    - we re-sent closure proof to plan; closure intact
//   Re-attested    - we re-confirmed clinically; closure intact
//   Plan_Corrected - plan acknowledged error; closure intact
//   Voided_Closure - prior closure was wrong; closed_at cleared
//
// CHECK constraint on cm_hedis_member_gaps_regression_resolution_chk
// enforces these four exact strings.
//
// Keeping this file self-contained from the rest of HEDISTab. Imports the
// same UI primitives + shared sub-tab utilities so visuals stay consistent.
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { C } from "../../lib/tokens";
import {
  Btn, Card, Modal, Loader, EmptyState, ErrorBanner, FL, Badge, Textarea
} from "../../components/ui";
import { KpiCard, Th, Td, selectStyle } from "./shared";

// Resolution types - must match the CHECK constraint on
// cm_hedis_member_gaps.regression_resolution_chk exactly.
const RESOLUTIONS = [
  {
    value: "Resubmitted",
    label: "Mark as resubmitted",
    blurb: "We re-sent our closure proof to the plan. Awaiting their next refresh.",
    keepsClosure: true,
    detail: "Use this when you've already shipped supplemental data showing the closure (or you're about to). The plan likely missed it on their last refresh and will reflect compliance after the next monthly cycle. Phase 3 will automate the outbound serializer.",
  },
  {
    value: "Re-attested",
    label: "Re-attest closure",
    blurb: "We re-confirmed the closure clinically. New evidence on file.",
    keepsClosure: true,
    detail: "Use this when the original closure was thin and you've added stronger documentation (clearer LOINC, better evidence_date, encounter link). Closure stands; any new evidence should be attested separately on the patient chart.",
  },
  {
    value: "Plan_Corrected",
    label: "Plan corrected the error",
    blurb: "Plan acknowledged their data was wrong. No further action.",
    keepsClosure: true,
    detail: "Use this when you've contacted the plan and they confirmed the regression was on their side (lost claim, mis-attribution, late processing). Closure stands.",
  },
  {
    value: "Voided_Closure",
    label: "Void the closure",
    blurb: "Prior closure was incorrect. Gap reopens and must be re-closed clinically.",
    keepsClosure: false,
    detail: "Use this only if you've determined the original attestation was wrong (wrong patient, wrong measure, evidence didn't actually qualify). This clears closed_at and closure metadata; the gap returns to the Open Gaps queue and needs new clinical evidence to close.",
    danger: true,
  },
];

function fmtDate(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString();
}
function fmtDateOnly(iso) {
  if (!iso) return "-";
  // Date-only (YYYY-MM-DD) shouldn't be re-localized to "yesterday"
  if (typeof iso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return new Date(iso).toLocaleDateString();
}

function daysSince(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

// ===============================================================================
// Top-level regression queue view
// ===============================================================================
export default function HEDISRegressionQueue({ practiceId }) {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  // Filters
  const [filterPlan, setFilterPlan]       = useState("");
  const [filterMeasure, setFilterMeasure] = useState("");
  const [filterAge, setFilterAge]         = useState(""); // '', '7', '30'

  // Active resolution modal (which gap is being resolved)
  const [resolving, setResolving] = useState(null);

  const load = useCallback(async () => {
    if (!practiceId) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from("cm_hedis_regression_queue")
        .select("*")
        .eq("practice_id", practiceId)
        .order("regression_flagged_at", { ascending: true })
        .limit(500);
      if (error) throw error;
      setRows(data || []);
    } catch (e) {
      setError(e.message || "Failed to load regression queue");
    } finally {
      setLoading(false);
    }
  }, [practiceId]);

  useEffect(() => { load(); }, [load]);

  const distinctPlans    = useMemo(() => Array.from(new Set(rows.map(r => r.source_plan_short_name).filter(Boolean))).sort(), [rows]);
  const distinctMeasures = useMemo(() => Array.from(new Set(rows.map(r => r.measure_code).filter(Boolean))).sort(), [rows]);

  const filtered = useMemo(() => {
    let r = rows;
    if (filterPlan)    r = r.filter(g => g.source_plan_short_name === filterPlan);
    if (filterMeasure) r = r.filter(g => g.measure_code === filterMeasure);
    if (filterAge) {
      const threshold = parseInt(filterAge, 10);
      r = r.filter(g => {
        const d = daysSince(g.regression_flagged_at);
        return d !== null && d >= threshold;
      });
    }
    return r;
  }, [rows, filterPlan, filterMeasure, filterAge]);

  // Aging bucket KPIs computed against full set, not filtered view
  const stats = useMemo(() => {
    const total = rows.length;
    let recent = 0, week = 0, month = 0, older = 0;
    for (const g of rows) {
      const d = daysSince(g.regression_flagged_at);
      if (d === null) continue;
      if (d < 7)       recent++;
      else if (d < 30) week++;
      else if (d < 90) month++;
      else             older++;
    }
    return { total, recent, week, month, older };
  }, [rows]);

  if (loading) return <Loader label="Loading regression queue..." />;

  return (
    <div>
      {error && <ErrorBanner message={error} />}

      {/* Explanatory header - this surface is uncommon; users need orientation. */}
      <Card style={{ padding: 14, marginBottom: 16, background: C.bgSecondary }}>
        <div style={{ fontSize: 13, color: C.textPrimary, lineHeight: 1.55 }}>
          <strong>What is this?</strong> When a plan re-uploads a member gap as non-compliant for
          a measure that was already closed in our system, the system flags the gap as regressed.
          Closure carries forward (you don't lose your attestation), but the gap shows up here so
          staff can decide whether to resubmit, re-attest, or void the prior closure.
        </div>
      </Card>

      {/* KPIs by aging */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
        <KpiCard label="Total open"  value={stats.total}  hint="Awaiting resolution" variant={stats.total > 0 ? "amber" : "neutral"} />
        <KpiCard label="< 7 days"    value={stats.recent} hint="Recently flagged" />
        <KpiCard label="7-30 days"   value={stats.week}   hint="This month"        variant={stats.week > 0  ? "blue" : "neutral"} />
        <KpiCard label="30-90 days"  value={stats.month}  hint="Stale - act soon"  variant={stats.month > 0 ? "amber" : "neutral"} />
        <KpiCard label="90+ days"    value={stats.older}  hint="Overdue"           variant={stats.older > 0 ? "amber" : "neutral"} />
      </div>

      {/* Filters */}
      <Card style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
          <div>
            <FL>Plan</FL>
            <select value={filterPlan} onChange={e => setFilterPlan(e.target.value)} style={selectStyle}>
              <option value="">All plans</option>
              {distinctPlans.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <FL>Measure</FL>
            <select value={filterMeasure} onChange={e => setFilterMeasure(e.target.value)} style={selectStyle}>
              <option value="">All measures</option>
              {distinctMeasures.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <FL>Aging</FL>
            <select value={filterAge} onChange={e => setFilterAge(e.target.value)} style={selectStyle}>
              <option value="">All ages</option>
              <option value="7">7+ days old</option>
              <option value="30">30+ days old</option>
              <option value="90">90+ days old</option>
            </select>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
          <div style={{ fontSize: 11, color: C.textTertiary }}>
            Showing {filtered.length} of {rows.length} regressions
          </div>
          <Btn variant="ghost" size="sm" onClick={load}>Refresh</Btn>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState
          title={rows.length === 0 ? "No regressions" : "No regressions match these filters"}
          message={rows.length === 0
            ? "Closures we attested to are still being honored by the plans. When a plan re-uploads a closed gap as non-compliant, you'll see it here."
            : "Try adjusting your filters above."}
        />
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead style={{ background: C.bgSecondary, borderBottom: "0.5px solid " + C.borderLight }}>
              <tr>
                <Th>Patient</Th>
                <Th>Plan / Measure</Th>
                <Th>Closure on file</Th>
                <Th>Flagged</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((g, idx) => (
                <RegressionRow
                  key={g.id}
                  gap={g}
                  isLast={idx === filtered.length - 1}
                  onResolve={() => setResolving(g)}
                />
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {resolving && (
        <ResolveRegressionModal
          gap={resolving}
          onClose={() => setResolving(null)}
          onResolved={() => {
            setResolving(null);
            load();
          }}
        />
      )}
    </div>
  );
}

// ===============================================================================
// Single row in the regression table
// ===============================================================================
function RegressionRow({ gap, isLast, onResolve }) {
  const patientName = [gap.patient_first_name, gap.patient_last_name].filter(Boolean).join(" ")
                   || [gap.member_first_name, gap.member_last_name].filter(Boolean).join(" ")
                   || "(no name)";
  const measureName = gap.measure_name || gap.measure_code;
  const ageDays = daysSince(gap.regression_flagged_at);
  const ageLabel = ageDays === null ? "-"
                 : ageDays === 0 ? "today"
                 : ageDays === 1 ? "1 day ago"
                 : ageDays + " days ago";
  const ageVariant = ageDays === null ? "neutral"
                   : ageDays >= 90    ? "amber"
                   : ageDays >= 30    ? "amber"
                   : ageDays >= 7     ? "blue"
                   : "neutral";

  return (
    <tr style={{
      borderBottom: isLast ? "none" : "0.5px solid " + C.borderLight,
    }}>
      <Td>
        <strong>{patientName}</strong>
        {gap.member_dob && (
          <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>
            DOB {fmtDateOnly(gap.member_dob)}
          </div>
        )}
        <div style={{ fontSize: 11, color: C.textTertiary, fontFamily: "monospace", marginTop: 2 }}>
          {gap.plan_member_id}
        </div>
      </Td>
      <Td>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <Badge label={gap.source_plan_short_name || "?"} variant="neutral" size="xs" />
          <code style={{ fontSize: 11, fontWeight: 700, color: C.teal, fontFamily: "monospace" }}>
            {gap.measure_code}{gap.submeasure && gap.submeasure !== gap.measure_code ? " - " + gap.submeasure : ""}
          </code>
        </div>
        <div style={{ fontSize: 12, color: C.textPrimary, marginTop: 4 }}>
          {measureName}
        </div>
        {gap.measurement_year && (
          <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>
            MY {gap.measurement_year}
          </div>
        )}
      </Td>
      <Td>
        <div style={{ fontSize: 12, color: C.textPrimary }}>
          {fmtDateOnly(gap.closed_at)}
        </div>
        {gap.closure_method && (
          <div style={{ fontSize: 11, color: C.textSecondary, marginTop: 2 }}>
            {gap.closure_method}
          </div>
        )}
        {gap.report_count > 1 && (
          <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>
            Reported {gap.report_count}x
          </div>
        )}
      </Td>
      <Td>
        <Badge label={ageLabel} variant={ageVariant} size="xs" />
        <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>
          {fmtDate(gap.regression_flagged_at)}
        </div>
      </Td>
      <Td align="right">
        <Btn size="sm" variant="primary" onClick={onResolve}>Resolve</Btn>
      </Td>
    </tr>
  );
}

// ===============================================================================
// Resolution modal
// ===============================================================================
function ResolveRegressionModal({ gap, onClose, onResolved }) {
  const [resolution, setResolution] = useState("");
  const [note, setNote]             = useState("");
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState(null);

  const selected = RESOLUTIONS.find(r => r.value === resolution);

  const patientName = [gap.patient_first_name, gap.patient_last_name].filter(Boolean).join(" ")
                   || [gap.member_first_name, gap.member_last_name].filter(Boolean).join(" ")
                   || "(no name)";
  const measureName = gap.measure_name || gap.measure_code;

  const save = async () => {
    if (!resolution) {
      setError("Pick a resolution.");
      return;
    }
    if (selected.danger && !confirmVoid) {
      setError("Confirm you intend to void the closure - this reopens the gap.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Build update payload. Voided_Closure also clears closure metadata so
      // the gap rejoins the open queue (and Open Gaps surface stops filtering
      // it out via closed_at IS NULL).
      const patch = {
        regression_resolved_at: new Date().toISOString(),
        regression_resolution: resolution,
      };
      if (!selected.keepsClosure) {
        patch.closed_at              = null;
        patch.closure_method         = null;
        patch.closure_evidence_id    = null;
        patch.closed_by_encounter_id = null;
      }

      // If a note was provided, append to bucket as a structured trailer.
      // We don't have a dedicated regression_resolution_note column yet;
      // staff notes go into bucket as "Regression resolved: <note>" so they
      // surface in the gap row's existing display fields. (If a column gets
      // added later, this is a one-line swap.)
      if (note.trim()) {
        const existingBucket = gap.bucket || "";
        const trailer = "Regression " + resolution + ": " + note.trim();
        patch.bucket = existingBucket
          ? (existingBucket + " | " + trailer).slice(0, 500)
          : trailer.slice(0, 500);
      }

      const { error: upErr } = await supabase
        .from("cm_hedis_member_gaps")
        .update(patch)
        .eq("id", gap.id);
      if (upErr) throw upErr;

      onResolved();
    } catch (e) {
      setError(e.message || "Failed to save resolution");
      setSaving(false);
    }
  };

  return (
    <Modal title="Resolve regression" onClose={onClose} maxWidth={680}>
      {/* Context strip */}
      <div style={{
        marginBottom: 14, padding: "10px 12px",
        background: C.tealBg, border: "0.5px solid " + C.tealBorder,
        borderRadius: 6, fontSize: 12, color: C.textPrimary,
      }}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>
          {patientName} - {gap.measure_code}{gap.submeasure && gap.submeasure !== gap.measure_code ? " - " + gap.submeasure : ""}
        </div>
        <div style={{ fontSize: 11, color: C.textSecondary, lineHeight: 1.5 }}>
          {measureName} via {gap.source_plan_short_name || "?"}
          {gap.measurement_year ? " (MY " + gap.measurement_year + ")" : ""}
          <br />
          Originally closed {fmtDateOnly(gap.closed_at)} ({gap.closure_method || "unknown method"}).
          Plan re-flagged non-compliant {fmtDate(gap.regression_flagged_at)}.
        </div>
      </div>

      <div style={{ marginBottom: 6, fontSize: 13, color: C.textPrimary, fontWeight: 600 }}>
        Pick a resolution
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
        {RESOLUTIONS.map(r => {
          const isPicked = resolution === r.value;
          return (
            <label
              key={r.value}
              style={{
                display: "block",
                padding: "10px 14px",
                border: "0.5px solid " + (isPicked
                  ? (r.danger ? C.red : C.teal)
                  : C.borderLight),
                borderLeft: "3px solid " + (isPicked
                  ? (r.danger ? C.red : C.teal)
                  : (r.danger ? "#fca5a5" : C.borderLight)),
                borderRadius: 6,
                cursor: "pointer",
                background: isPicked
                  ? (r.danger ? "#fef2f2" : C.tealBg)
                  : "#fff",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <input
                  type="radio"
                  name="resolution"
                  checked={isPicked}
                  onChange={() => { setResolution(r.value); setConfirmVoid(false); }}
                  style={{ margin: 0 }}
                />
                <strong style={{ fontSize: 13, color: r.danger ? C.red : C.textPrimary }}>
                  {r.label}
                </strong>
                {r.danger && <Badge label="Reopens gap" variant="red" size="xs" />}
              </div>
              <div style={{ fontSize: 12, color: C.textSecondary, marginLeft: 22, marginBottom: 2 }}>
                {r.blurb}
              </div>
              {isPicked && (
                <div style={{ fontSize: 11, color: C.textTertiary, marginLeft: 22, marginTop: 6, lineHeight: 1.5 }}>
                  {r.detail}
                </div>
              )}
            </label>
          );
        })}
      </div>

      {/* Voided_Closure confirmation - extra friction so this isn't a single click */}
      {selected?.danger && (
        <div style={{
          marginBottom: 14, padding: "10px 12px",
          background: "#fef2f2", border: "0.5px solid " + C.red, borderRadius: 6,
        }}>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, color: C.textPrimary, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={confirmVoid}
              onChange={e => setConfirmVoid(e.target.checked)}
              style={{ marginTop: 3 }}
            />
            <span>
              I understand that voiding the closure will reopen this gap.
              Existing closure metadata (closed_at, closure_method, evidence link)
              will be cleared. The gap will reappear in the Open Gaps queue and will
              need new clinical evidence to close.
            </span>
          </label>
        </div>
      )}

      <Textarea
        label="Note (optional)"
        value={note}
        onChange={setNote}
        rows={2}
        placeholder="Optional context, e.g. 'Resubmitted via SFTP 2026-04-15' or 'Spoke with plan rep, ticket #12345'"
      />

      {error && (
        <div style={{
          marginTop: 8, padding: "8px 12px",
          background: C.redBg || "#fef2f2",
          border: "0.5px solid " + (C.redBorder || C.red),
          borderRadius: 6, fontSize: 12, color: C.red,
        }}>
          {error}
        </div>
      )}

      <div style={{
        marginTop: 16, paddingTop: 12,
        borderTop: "0.5px solid " + C.borderLight,
        display: "flex", gap: 8, justifyContent: "flex-end",
      }}>
        <Btn variant="outline" onClick={onClose} disabled={saving}>Cancel</Btn>
        <Btn
          onClick={save}
          disabled={saving || !resolution || (selected?.danger && !confirmVoid)}
          variant={selected?.danger ? "amber" : "primary"}
        >
          {saving ? "Saving..." : "Save resolution"}
        </Btn>
      </div>
    </Modal>
  );
}
