import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../auth/AuthProvider";
import { C } from "../../lib/tokens";
import {
  Btn, Card, Modal, Loader, EmptyState, ErrorBanner, FL
} from "../../components/ui";
import {
  KpiCard, StatusBadge, SubTabButton, Th, Td, inputStyle, selectStyle
} from "./shared";

// ===============================================================================
// HEDIS tab - quality gap tracking from health-plan files
//
// Three sub-tabs share this single tab:
//   - Open Gaps: read-only patient gap list, role-aware filters, all clinical
//                roles see this and use it for outreach planning
//   - Uploads:   admin-only file ingestion (.xlsx) -> hedis-parse -> hedis-match
//                lifecycle, with parser status, retry buttons, parse-error drill-in
//   - Outbound:  Day 3+ placeholder for Duke-Margolis-aligned supplemental data
//                submissions (closure proof to plans). Currently shows roadmap copy.
//
// Schema:
//   - cm_hedis_uploads      (one row per file received)
//   - cm_hedis_member_gaps  (one row per member-measure gap)
//   - cm_hedis_template_versions (parser configs, global; admin-managed)
//   - cm_hedis_measures     (HEDIS code catalog, global; auto-stubs unknown codes)
//
// Edge functions:
//   - hedis-parse v1: takes upload_id, downloads .xlsx, applies template config,
//                     emits gap rows. Auto-detects template or uses override.
//   - hedis-match v1: takes upload_id, links plan_member_id to local patients
//                     via insurance_policies + cm_enrollments + name/DOB fallback.
//
// Storage:
//   - hedis-imports bucket. Path: practice_<practice_id>/<yyyy-mm>/<uuid>-<filename>
// ===============================================================================

// Compute SHA-256 of a File for de-dup at the DB unique index level.
async function sha256OfFile(file) {
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

// Format helpers
function fmtDate(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString();
}
function fmtDateOnly(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString();
}

// ===============================================================================
// Top-level shell - sub-tab routing + role gating
// ===============================================================================
export default function HEDISTab({ practiceId, profile, isAdmin }) {
  // CMs default to Open Gaps; admins default to Uploads (admin first job is upload)
  const [mode, setMode] = useState(isAdmin ? "uploads" : "gaps");

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <SubTabButton active={mode === "gaps"}     onClick={() => setMode("gaps")}>Open Gaps</SubTabButton>
        {isAdmin && (
          <SubTabButton active={mode === "uploads"} onClick={() => setMode("uploads")}>Uploads</SubTabButton>
        )}
        <SubTabButton active={mode === "outbound"} onClick={() => setMode("outbound")}>Outbound</SubTabButton>
      </div>
      {mode === "gaps"     && <HEDISOpenGaps practiceId={practiceId} />}
      {mode === "uploads"  && isAdmin && <HEDISUploads practiceId={practiceId} />}
      {mode === "outbound" && <HEDISOutboundPlaceholder />}
    </div>
  );
}

// ===============================================================================
// Open Gaps - clinical view (all roles)
// ===============================================================================
function HEDISOpenGaps({ practiceId }) {
  const [rows, setRows]               = useState([]);
  const [measures, setMeasures]       = useState([]);
  const [uploads, setUploads]         = useState([]); // for "Run month" filter
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);

  // Filters
  const [filterPlan, setFilterPlan]             = useState("");
  const [filterMeasure, setFilterMeasure]       = useState("");
  const [filterCompliant, setFilterCompliant]   = useState("actionable"); // 'actionable' | 'all' | 'open' | 'unknown' | 'compliant'
  const [filterMatch, setFilterMatch]           = useState("matched");      // 'all' | 'matched' | 'unmatched' | 'multi'
  const [filterReportingPeriod, setFilterPeriod] = useState("");            // upload.id

  const load = useCallback(async () => {
    if (!practiceId) return;
    setLoading(true);
    setError(null);
    try {
      // Parallel: gap rows (with patient join), measure catalog, recent uploads
      const [gapsRes, measRes, upRes] = await Promise.all([
        supabase
          .from("cm_hedis_member_gaps")
          .select("id, source_plan_short_name, plan_member_id, member_first_name, member_last_name, member_dob, measure_code, submeasure, compliant, bucket, measure_anchor_date, date_of_last_service, match_status, match_confidence, patient_id, reporting_period_start, reporting_period_end, upload_id, patient:patient_id(id, first_name, last_name, date_of_birth)")
          .eq("practice_id", practiceId)
          .is("closed_at", null)
          .order("reporting_period_end", { ascending: false, nullsFirst: false })
          .limit(2000),
        supabase
          .from("cm_hedis_measures")
          .select("measure_code, measure_name, measure_category")
          .eq("active", true)
          .order("measure_code"),
        supabase
          .from("cm_hedis_uploads")
          .select("id, source_plan_short_name, reporting_period_start, reporting_period_end, status")
          .eq("practice_id", practiceId)
          .in("status", ["Parsed", "Validated", "Reconciled"])
          .order("reporting_period_end", { ascending: false, nullsFirst: false })
          .limit(20),
      ]);
      if (gapsRes.error) throw gapsRes.error;
      if (measRes.error) throw measRes.error;
      if (upRes.error)   throw upRes.error;
      setRows(gapsRes.data || []);
      setMeasures(measRes.data || []);
      setUploads(upRes.data || []);
    } catch (e) {
      setError(e.message || "Failed to load gaps");
    } finally {
      setLoading(false);
    }
  }, [practiceId]);

  useEffect(() => { load(); }, [load]);

  // Filter pipeline
  const filteredRows = useMemo(() => {
    let r = rows;
    if (filterPlan)             r = r.filter(g => g.source_plan_short_name === filterPlan);
    if (filterMeasure)          r = r.filter(g => g.measure_code === filterMeasure);
    if (filterCompliant === "actionable") r = r.filter(g => g.compliant !== true);  // open OR unknown
    if (filterCompliant === "open")       r = r.filter(g => g.compliant === false);
    if (filterCompliant === "unknown")    r = r.filter(g => g.compliant === null || g.compliant === undefined);
    if (filterCompliant === "compliant")  r = r.filter(g => g.compliant === true);
    if (filterMatch === "matched")    r = r.filter(g => g.match_status === "Matched Single" || g.match_status === "Manually Resolved");
    if (filterMatch === "unmatched")  r = r.filter(g => g.match_status === "Unmatched");
    if (filterMatch === "multi")      r = r.filter(g => g.match_status === "Matched Multiple");
    if (filterReportingPeriod)        r = r.filter(g => g.upload_id === filterReportingPeriod);
    return r;
  }, [rows, filterPlan, filterMeasure, filterCompliant, filterMatch, filterReportingPeriod]);

  // Per-row stats for the KPIs (always computed against full data set, not filtered view)
  const stats = useMemo(() => {
    const open  = rows.filter(g => g.compliant === false).length;
    const matched = rows.filter(g => g.match_status === "Matched Single" || g.match_status === "Manually Resolved").length;
    const unmatched = rows.filter(g => g.match_status === "Unmatched").length;
    const multi = rows.filter(g => g.match_status === "Matched Multiple").length;
    return { open, matched, unmatched, multi, total: rows.length };
  }, [rows]);

  // Group filtered rows by member (one expandable row per member, gaps stacked inside)
  const grouped = useMemo(() => {
    const byMember = new Map();
    for (const g of filteredRows) {
      const key = g.plan_member_id;
      const existing = byMember.get(key) || {
        plan_member_id: g.plan_member_id,
        member_first_name: g.member_first_name,
        member_last_name: g.member_last_name,
        member_dob: g.member_dob,
        patient_id: g.patient_id,
        patient: g.patient,
        match_status: g.match_status,
        match_confidence: g.match_confidence,
        source_plan_short_name: g.source_plan_short_name,
        gaps: [],
      };
      existing.gaps.push(g);
      byMember.set(key, existing);
    }
    return Array.from(byMember.values()).sort((a, b) => {
      // Unmatched first (action items), then by last name
      const aUnmatched = a.match_status === "Unmatched" ? 0 : 1;
      const bUnmatched = b.match_status === "Unmatched" ? 0 : 1;
      if (aUnmatched !== bUnmatched) return aUnmatched - bUnmatched;
      return (a.member_last_name || "").localeCompare(b.member_last_name || "");
    });
  }, [filteredRows]);

  if (loading) return <Loader label="Loading gaps..." />;

  // Distinct plans seen in actual data (so dropdown only shows plans Leonard has data for)
  const distinctPlans = Array.from(new Set(rows.map(r => r.source_plan_short_name))).sort();

  return (
    <div>
      {error && <ErrorBanner message={error} />}

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 20 }}>
        <KpiCard label="Open gaps"   value={stats.open}      hint="Members with non-compliant measures" variant={stats.open > 0 ? "amber" : "neutral"} />
        <KpiCard label="Matched"     value={stats.matched}   hint="Linked to a local patient"           variant="blue" />
        <KpiCard label="Unmatched"   value={stats.unmatched} hint="No patient link found yet"           variant={stats.unmatched > 0 ? "amber" : "neutral"} />
        <KpiCard label="Multi-match" value={stats.multi}     hint="Need staff review"                   variant={stats.multi > 0 ? "amber" : "neutral"} />
        <KpiCard label="Total gaps"  value={stats.total}     hint="Across all uploaded plan files" />
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
              {measures.map(m => <option key={m.measure_code} value={m.measure_code}>{m.measure_code} - {m.measure_name?.slice(0, 50)}</option>)}
            </select>
          </div>
          <div>
            <FL>Compliance</FL>
            <select value={filterCompliant} onChange={e => setFilterCompliant(e.target.value)} style={selectStyle}>
              <option value="actionable">Actionable (open + unknown)</option>
              <option value="open">Open only</option>
              <option value="unknown">Unknown only</option>
              <option value="compliant">Compliant only</option>
              <option value="all">All</option>
            </select>
          </div>
          <div>
            <FL>Match status</FL>
            <select value={filterMatch} onChange={e => setFilterMatch(e.target.value)} style={selectStyle}>
              <option value="matched">Matched only</option>
              <option value="unmatched">Unmatched only</option>
              <option value="multi">Multi-match (review)</option>
              <option value="all">All</option>
            </select>
          </div>
          <div>
            <FL>Reporting period</FL>
            <select value={filterReportingPeriod} onChange={e => setFilterPeriod(e.target.value)} style={selectStyle}>
              <option value="">All periods</option>
              {uploads.map(u => (
                <option key={u.id} value={u.id}>
                  {u.source_plan_short_name} - {u.reporting_period_end ? fmtDateOnly(u.reporting_period_end) : "no period"}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
          <div style={{ fontSize: 11, color: C.textTertiary }}>
            Showing {filteredRows.length} gaps across {grouped.length} members
          </div>
          <Btn variant="ghost" size="sm" onClick={load}>Refresh</Btn>
        </div>
      </Card>

      {/* Gap list grouped by member */}
      {grouped.length === 0 ? (
        <EmptyState
          title="No gaps match these filters"
          message={rows.length === 0
            ? "No HEDIS files have been parsed yet. An admin can upload files in the Uploads sub-tab."
            : "Try adjusting your filters above to see more results."}
        />
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead style={{ background: C.bgSecondary, borderBottom: "0.5px solid " + C.borderLight }}>
              <tr>
                <Th>Member</Th>
                <Th>Member ID</Th>
                <Th>DOB</Th>
                <Th>Plan</Th>
                <Th>Match</Th>
                <Th>Open gaps</Th>
                <Th>Measures</Th>
              </tr>
            </thead>
            <tbody>
              {grouped.map((m, idx) => {
                const memberName = [m.member_first_name, m.member_last_name].filter(Boolean).join(" ") || "(no name)";
                const openCount = m.gaps.filter(g => g.compliant === false).length;
                const measuresList = Array.from(new Set(m.gaps.map(g => g.measure_code))).join(", ");
                return (
                  <tr key={m.plan_member_id} style={{ borderBottom: idx < grouped.length - 1 ? "0.5px solid " + C.borderLight : "none" }}>
                    <Td>
                      <strong>{memberName}</strong>
                      {m.patient && (
                        <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>
                          Patient #{m.patient.id ? m.patient.id.slice(0, 8) : ""}
                        </div>
                      )}
                    </Td>
                    <Td style={{ fontFamily: "monospace", fontSize: 11 }}>{m.plan_member_id}</Td>
                    <Td>{fmtDateOnly(m.member_dob)}</Td>
                    <Td>{m.source_plan_short_name}</Td>
                    <Td>
                      <StatusBadge status={m.match_status} />
                      {m.match_confidence !== null && m.match_confidence !== undefined && (
                        <div style={{ fontSize: 10, color: C.textTertiary, marginTop: 2 }}>
                          {(m.match_confidence * 100).toFixed(0)}% confidence
                        </div>
                      )}
                    </Td>
                    <Td>
                      <span style={{ fontWeight: 600, color: openCount > 0 ? C.amber : C.textPrimary }}>
                        {openCount}
                      </span>
                      <span style={{ fontSize: 11, color: C.textTertiary }}> / {m.gaps.length}</span>
                    </Td>
                    <Td style={{ fontSize: 11, fontFamily: "monospace" }}>{measuresList}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

// ===============================================================================
// Uploads - admin-only file ingestion
// ===============================================================================
function HEDISUploads({ practiceId }) {
  const [uploads, setUploads]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [showNew, setShowNew]   = useState(false);
  const [running, setRunning]   = useState(null); // { uploadId, action }
  const [selected, setSelected] = useState(null);
  const [needsChoice, setNeedsChoice] = useState(null); // { uploadId, candidates, all_active_templates }

  const load = useCallback(async () => {
    if (!practiceId) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from("cm_hedis_uploads")
        .select("id, source_plan_short_name, template_version_id, file_name, file_size_bytes, reporting_period_start, reporting_period_end, status, status_reason, parsed_row_count, matched_row_count, unmatched_row_count, skipped_row_count, received_at, parsed_at, validated_at")
        .eq("practice_id", practiceId)
        .order("received_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      setUploads(data || []);
    } catch (e) {
      setError(e.message || "Failed to load uploads");
    } finally {
      setLoading(false);
    }
  }, [practiceId]);

  useEffect(() => { load(); }, [load]);

  const runEdge = async (slug, payload, uploadId, action) => {
    setRunning({ uploadId, action });
    try {
      const { data, error } = await supabase.functions.invoke(slug, { body: payload });
      if (error) throw error;
      // hedis-parse may return needs_user_choice (HTTP 200, ok=false). Handle separately.
      if (data && data.ok === false && data.needs_user_choice) {
        setNeedsChoice({
          uploadId: data.upload_id,
          candidates: data.candidates || [],
          all_active_templates: data.all_active_templates || [],
        });
        await load();
        return data;
      }
      if (data && data.ok === false) throw new Error(data.error || "Edge function returned error");
      await load();
      return data;
    } catch (e) {
      setError(e.message || "Edge call failed");
      throw e;
    } finally {
      setRunning(null);
    }
  };

  if (loading) return <Loader label="Loading uploads..." />;

  const stats = {
    total: uploads.length,
    needsParse: uploads.filter(u => u.status === "Received").length,
    parsed: uploads.filter(u => u.status === "Parsed").length,
    failed: uploads.filter(u => u.status === "Failed").length,
  };

  return (
    <div>
      {error && <ErrorBanner message={error} />}

      {/* Summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 20 }}>
        <KpiCard label="Total uploads (recent 50)" value={stats.total} hint="HEDIS files received" />
        <KpiCard label="Awaiting parse" value={stats.needsParse} hint="status = Received" variant={stats.needsParse > 0 ? "amber" : "neutral"} />
        <KpiCard label="Awaiting match"  value={stats.parsed}     hint="status = Parsed"   variant={stats.parsed > 0 ? "blue" : "neutral"} />
        <KpiCard label="Failed"          value={stats.failed}     hint="needs investigation" variant={stats.failed > 0 ? "amber" : "neutral"} />
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <Btn variant="primary" size="md" onClick={() => setShowNew(true)}>+ Upload HEDIS file</Btn>
        <Btn variant="outline" size="md" onClick={load}>Refresh</Btn>
      </div>

      {uploads.length === 0 ? (
        <EmptyState
          title="No HEDIS uploads yet"
          sub="Drop your first plan gap-list file to start. Currently supported: Carolina Complete Health (CCH), Healthy Blue (BCBS NC Medicaid), and UnitedHealthcare (PCOR). New formats can be added via template config."
        />
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead style={{ background: C.bgSecondary, borderBottom: "0.5px solid " + C.borderLight }}>
              <tr>
                <Th>Received</Th>
                <Th>Plan</Th>
                <Th>File</Th>
                <Th>Period</Th>
                <Th>Status</Th>
                <Th align="right">Rows</Th>
                <Th align="right">Matched</Th>
                <Th align="right">Unmatched</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {uploads.map((up, idx) => {
                const isRunning = running?.uploadId === up.id;
                return (
                  <tr
                    key={up.id}
                    onClick={() => setSelected(up)}
                    style={{
                      borderBottom: idx < uploads.length - 1 ? "0.5px solid " + C.borderLight : "none",
                      cursor: "pointer",
                      background: selected?.id === up.id ? C.tealBg : "transparent",
                    }}
                  >
                    <Td>{fmtDate(up.received_at)}</Td>
                    <Td><strong>{up.source_plan_short_name}</strong></Td>
                    <Td style={{ fontSize: 11, color: C.textTertiary, fontFamily: "monospace" }}>{up.file_name}</Td>
                    <Td style={{ fontSize: 11 }}>
                      {up.reporting_period_start || up.reporting_period_end
                        ? `${up.reporting_period_start || "?"} to ${up.reporting_period_end || "?"}`
                        : "-"}
                    </Td>
                    <Td><StatusBadge status={up.status} /></Td>
                    <Td align="right">{up.parsed_row_count || 0}</Td>
                    <Td align="right">{up.matched_row_count || 0}</Td>
                    <Td align="right">{up.unmatched_row_count || 0}</Td>
                    <Td align="right">
                      {up.status === "Received" && (
                        <Btn size="sm" variant="outline" disabled={isRunning}
                          onClick={e => { e.stopPropagation(); runEdge("hedis-parse", { upload_id: up.id }, up.id, "parse"); }}>
                          {isRunning && running.action === "parse" ? "Parsing..." : "Parse"}
                        </Btn>
                      )}
                      {up.status === "Parsed" && (
                        <Btn size="sm" variant="outline" disabled={isRunning}
                          onClick={e => { e.stopPropagation(); runEdge("hedis-match", { upload_id: up.id }, up.id, "match"); }}>
                          {isRunning && running.action === "match" ? "Matching..." : "Match"}
                        </Btn>
                      )}
                      {(up.status === "Validated" || up.status === "Failed") && (
                        <Btn size="sm" variant="ghost" disabled={isRunning}
                          onClick={e => { e.stopPropagation(); runEdge("hedis-parse", { upload_id: up.id, force_reparse: true }, up.id, "reparse"); }}>
                          {isRunning && running.action === "reparse" ? "Reparsing..." : "Re-parse"}
                        </Btn>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {selected && (
        <UploadDetail upload={selected} onClose={() => setSelected(null)} onUpdated={load} />
      )}
      {showNew && (
        <NewUploadModal
          practiceId={practiceId}
          onClose={() => setShowNew(false)}
          onCreated={(result) => {
            setShowNew(false);
            // If parser came back asking for a template choice, surface picker immediately
            if (result?.needs_user_choice) {
              setNeedsChoice({
                uploadId: result.upload_id,
                candidates: result.candidates || [],
                all_active_templates: result.all_active_templates || [],
              });
            }
            load();
          }}
        />
      )}
      {needsChoice && (
        <TemplatePickerModal
          uploadId={needsChoice.uploadId}
          candidates={needsChoice.candidates}
          allTemplates={needsChoice.all_active_templates}
          onClose={() => setNeedsChoice(null)}
          onChosen={async (templateVersionId) => {
            setNeedsChoice(null);
            await runEdge("hedis-parse",
              { upload_id: needsChoice.uploadId, template_version_id: templateVersionId },
              needsChoice.uploadId, "parse"
            );
          }}
        />
      )}
    </div>
  );
}

// ===============================================================================
// New Upload Modal - file picker, hash, storage upload, insert row, invoke parse
// ===============================================================================
function NewUploadModal({ practiceId, onClose, onCreated }) {
  const [file, setFile]       = useState(null);
  const [progress, setProgress] = useState("");
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState(null);

  const onFilePick = (e) => {
    const f = e.target.files?.[0];
    if (!f) { setFile(null); return; }
    if (!/\.xlsx$/i.test(f.name)) {
      setError("File must be a .xlsx workbook (got: " + f.name + ")");
      return;
    }
    setError(null);
    setFile(f);
  };

  const save = async () => {
    if (!file) { setError("Pick a file first"); return; }
    if (!practiceId) { setError("No practice context"); return; }
    setSaving(true);
    setError(null);
    try {
      // 1. Hash for de-dupe
      setProgress("Hashing file...");
      const sha = await sha256OfFile(file);

      // 2. Storage upload. Path: practice_<id>/<yyyy-mm>/<uuid>-<safefilename>
      setProgress("Uploading file...");
      const now = new Date();
      const yyyymm = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
      const uuid = crypto.randomUUID();
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
      const storagePath = "practice_" + practiceId + "/" + yyyymm + "/" + uuid + "-" + safeName;

      const { error: upErr } = await supabase.storage
        .from("hedis-imports")
        .upload(storagePath, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
      if (upErr) throw new Error("Storage upload failed: " + upErr.message);

      // 3. Insert cm_hedis_uploads row. source_plan_short_name is set by the parser
      // once it picks a template; we use a provisional value here so RLS/audit are happy.
      setProgress("Creating upload record...");
      const { data: ins, error: insErr } = await supabase
        .from("cm_hedis_uploads")
        .insert({
          practice_id:            practiceId,
          source_plan_short_name: "auto", // overwritten by hedis-parse from chosen template
          file_name:              file.name,
          file_path:              storagePath,
          file_size_bytes:        file.size,
          file_sha256:            sha,
          status:                 "Received",
        })
        .select("id")
        .single();
      if (insErr) {
        // De-dupe collision is expected if user re-uploads
        if (insErr.code === "23505") {
          throw new Error("This file has already been uploaded (matching SHA-256). Look for it in the list above.");
        }
        throw insErr;
      }

      // 4. Invoke parser
      setProgress("Parsing file...");
      const { data: parseRes, error: parseErr } = await supabase.functions.invoke("hedis-parse", {
        body: { upload_id: ins.id },
      });
      if (parseErr) throw parseErr;

      // hedis-parse returns ok=false + needs_user_choice when detection is ambiguous.
      // That is NOT an error - surface to caller so the picker modal can open.
      onCreated(parseRes);
    } catch (e) {
      setError(e.message || "Upload failed");
    } finally {
      setSaving(false);
      setProgress("");
    }
  };

  return (
    <Modal title="Upload HEDIS file" onClose={onClose} maxWidth={620}>
      {error && <ErrorBanner message={error} />}
      <div style={{ marginBottom: 12 }}>
        <FL>HEDIS gap-list file (.xlsx)</FL>
        <input
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={onFilePick}
          style={{ ...inputStyle, padding: 8 }}
        />
        {file && (
          <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 4 }}>
            Selected: <strong>{file.name}</strong> ({(file.size / 1024).toFixed(1)} KB)
          </div>
        )}
      </div>
      <div style={{ fontSize: 11, color: C.textTertiary, marginBottom: 16, lineHeight: 1.5 }}>
        <div>The system will auto-detect the file format and parse it. Currently supported:</div>
        <ul style={{ marginTop: 4, marginBottom: 4, paddingLeft: 18 }}>
          <li>Carolina Complete Health (CCH) - Member Gap List MCD &amp; MKT</li>
          <li>Healthy Blue (BCBS NC Medicaid) - Blank GIC Report</li>
          <li>UnitedHealthcare Community Plan - PCOR (Patient Care Opportunity Report)</li>
        </ul>
        <div>If the format isn't recognized, you'll be prompted to pick the template manually.</div>
      </div>
      {progress && (
        <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 12, padding: 10, background: C.bgSecondary, borderRadius: 6 }}>
          {progress}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Btn variant="ghost" onClick={onClose} disabled={saving}>Cancel</Btn>
        <Btn variant="primary" disabled={!file || saving} onClick={save}>
          {saving ? "Uploading..." : "Upload + parse"}
        </Btn>
      </div>
    </Modal>
  );
}

// ===============================================================================
// Template Picker Modal - shown when hedis-parse returns needs_user_choice
// ===============================================================================
function TemplatePickerModal({ uploadId, candidates, allTemplates, onClose, onChosen }) {
  const [picked, setPicked] = useState(candidates?.[0]?.template_version_id || allTemplates?.[0]?.id || "");

  const showAllOptions = !candidates || candidates.length === 0;
  const list = showAllOptions ? allTemplates : candidates;

  return (
    <Modal title="Pick a template for this file" onClose={onClose} maxWidth={560}>
      <div style={{ fontSize: 13, color: C.textSecondary, marginBottom: 12 }}>
        {showAllOptions
          ? "We could not auto-detect the file format. Pick the template that matches this file:"
          : "We found multiple possible templates for this file. Pick which one to use:"}
      </div>
      <div style={{ marginBottom: 16 }}>
        {(list || []).map(c => {
          const id = c.template_version_id || c.id;
          const label = c.source_plan_label || (c.source_plan_short_name + " - " + (c.version_label || ""));
          const score = c.score !== undefined ? "  (match score: " + c.score + ")" : "";
          return (
            <label key={id}
              style={{
                display: "block",
                padding: "8px 12px",
                marginBottom: 6,
                border: "0.5px solid " + (picked === id ? C.teal : C.borderLight),
                borderRadius: 6,
                cursor: "pointer",
                background: picked === id ? C.tealBg : "transparent",
              }}>
              <input
                type="radio"
                checked={picked === id}
                onChange={() => setPicked(id)}
                style={{ marginRight: 8 }}
              />
              <strong>{label}</strong>
              <span style={{ fontSize: 11, color: C.textTertiary }}>{score}</span>
              {c.version_label && (
                <div style={{ fontSize: 11, color: C.textTertiary, marginLeft: 22 }}>
                  Version: {c.version_label}
                </div>
              )}
            </label>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: C.textTertiary, marginBottom: 12 }}>
        If none of these match, contact your admin to add a new template config. Day 2 will let you add new templates self-service.
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" disabled={!picked} onClick={() => onChosen(picked)}>Use this template</Btn>
      </div>
    </Modal>
  );
}

// ===============================================================================
// Upload Detail - parse_errors drill-in + matched/unmatched preview
// ===============================================================================
function UploadDetail({ upload, onClose, onUpdated }) {
  const [gaps, setGaps]               = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);

  // Manual reporting-period fallback (for files where the parser couldn't auto-detect)
  const [periodStart, setPeriodStart] = useState(upload.reporting_period_start || "");
  const [periodEnd, setPeriodEnd]     = useState(upload.reporting_period_end   || "");
  const [savingPeriod, setSavingPeriod] = useState(false);
  const [periodSaved, setPeriodSaved]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("cm_hedis_member_gaps")
        .select("id, plan_member_id, member_first_name, member_last_name, member_dob, measure_code, submeasure, compliant, match_status, match_confidence")
        .eq("upload_id", upload.id)
        .order("match_status", { ascending: true })
        .limit(500);
      if (error) throw error;
      setGaps(data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [upload.id]);

  useEffect(() => { load(); }, [load]);

  // Save manual reporting period to the upload row + propagate to gap rows
  // so the Open Gaps "Reporting period" filter picks up the value.
  const saveReportingPeriod = async () => {
    if (!periodStart || !periodEnd) {
      setError("Both start and end dates are required");
      return;
    }
    if (periodEnd < periodStart) {
      setError("End date must be on or after start date");
      return;
    }
    setSavingPeriod(true);
    setError(null);
    try {
      const { error: upErr } = await supabase
        .from("cm_hedis_uploads")
        .update({
          reporting_period_start: periodStart,
          reporting_period_end:   periodEnd,
        })
        .eq("id", upload.id);
      if (upErr) throw upErr;

      const { error: gapsErr } = await supabase
        .from("cm_hedis_member_gaps")
        .update({
          reporting_period_start: periodStart,
          reporting_period_end:   periodEnd,
        })
        .eq("upload_id", upload.id);
      if (gapsErr) throw gapsErr;

      setPeriodSaved(true);
      onUpdated && onUpdated();
    } catch (e) {
      setError(e.message || "Failed to save reporting period");
    } finally {
      setSavingPeriod(false);
    }
  };

  const parseErrors = upload.parse_errors;
  const hasUnmappedHeaders = parseErrors?.unmapped_headers?.length > 0;
  const hasNormalizerIssues = parseErrors?.unmapped_normalizer_values?.length > 0;
  const stubbedMeasures = parseErrors?.unknown_measures_auto_stubbed || [];

  // Show fallback only after parser ran AND failed to detect the period AND user
  // hasn't just saved one in this session.
  const showPeriodFallback = (upload.status === "Parsed" || upload.status === "Validated")
    && !upload.reporting_period_start && !upload.reporting_period_end
    && !periodSaved;

  return (
    <Modal title={"Upload detail: " + upload.file_name} onClose={onClose} maxWidth={1100}>
      {error && <ErrorBanner message={error}  />}

      {/* Status summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginBottom: 16 }}>
        <KpiCard label="Status"   value={<StatusBadge status={upload.status} />} hint={upload.status_reason || ""} />
        <KpiCard label="Rows parsed"   value={upload.parsed_row_count || 0}     hint="non-blank data rows" />
        <KpiCard label="Rows matched"  value={upload.matched_row_count || 0}    hint="linked to local patient" variant="blue" />
        <KpiCard label="Rows skipped"  value={upload.skipped_row_count || 0}    hint="missing required field" variant={upload.skipped_row_count > 0 ? "amber" : "neutral"} />
      </div>

      {/* Manual reporting-period fallback */}
      {showPeriodFallback && (
        <Card style={{ padding: 12, marginBottom: 16, background: C.amberBg, borderColor: C.amber }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Reporting period not detected</div>
          <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 12 }}>
            The parser could not auto-detect the reporting period for this file. Enter it manually below; the value will be saved to this upload and to all of its gap rows.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, alignItems: "end" }}>
            <div>
              <FL>Period start</FL>
              <input
                type="date"
                value={periodStart}
                onChange={e => setPeriodStart(e.target.value)}
                style={inputStyle}
                disabled={savingPeriod}
              />
            </div>
            <div>
              <FL>Period end</FL>
              <input
                type="date"
                value={periodEnd}
                onChange={e => setPeriodEnd(e.target.value)}
                style={inputStyle}
                disabled={savingPeriod}
              />
            </div>
            <Btn variant="primary" disabled={savingPeriod || !periodStart || !periodEnd} onClick={saveReportingPeriod}>
              {savingPeriod ? "Saving..." : "Save period"}
            </Btn>
          </div>
        </Card>
      )}

      {/* Parse warnings (if any) */}
      {(hasUnmappedHeaders || hasNormalizerIssues || stubbedMeasures.length > 0) && (
        <Card style={{ padding: 12, marginBottom: 16, background: C.amberBg, borderColor: C.amber }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Parse warnings</div>
          {hasUnmappedHeaders && (
            <div style={{ fontSize: 12, marginBottom: 4 }}>
              <strong>Unmapped headers:</strong> {parseErrors.unmapped_headers.join(", ")}
            </div>
          )}
          {hasNormalizerIssues && (
            <div style={{ fontSize: 12, marginBottom: 4 }}>
              <strong>Unrecognized values:</strong> {parseErrors.unmapped_normalizer_values.length} occurrences
              (sample: {parseErrors.unmapped_normalizer_values.slice(0, 3).map(v => v.normalizer + "=" + v.value).join(", ")})
            </div>
          )}
          {stubbedMeasures.length > 0 && (
            <div style={{ fontSize: 12 }}>
              <strong>Auto-stubbed unknown measure codes:</strong> {stubbedMeasures.join(", ")}
              <span style={{ color: C.textTertiary }}> (added to catalog with placeholder names; backfill metadata when possible)</span>
            </div>
          )}
        </Card>
      )}

      {loading ? (
        <Loader label="Loading gap rows..." />
      ) : gaps.length === 0 ? (
        <EmptyState title="No gap rows" sub="This upload has no parsed gap rows yet. If status is Received, click Parse." />
      ) : (
        <div style={{ maxHeight: 400, overflow: "auto", border: "0.5px solid " + C.borderLight, borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead style={{ background: C.bgSecondary, position: "sticky", top: 0 }}>
              <tr>
                <Th>Member ID</Th>
                <Th>Name</Th>
                <Th>DOB</Th>
                <Th>Measure</Th>
                <Th>Sub</Th>
                <Th>Compliant</Th>
                <Th>Match</Th>
              </tr>
            </thead>
            <tbody>
              {gaps.map(g => (
                <tr key={g.id} style={{ borderBottom: "0.5px solid " + C.borderLight }}>
                  <Td style={{ fontFamily: "monospace", fontSize: 11 }}>{g.plan_member_id}</Td>
                  <Td>{[g.member_first_name, g.member_last_name].filter(Boolean).join(" ") || "-"}</Td>
                  <Td>{fmtDateOnly(g.member_dob)}</Td>
                  <Td><strong>{g.measure_code}</strong></Td>
                  <Td>{g.submeasure || "-"}</Td>
                  <Td>{g.compliant === true ? "Yes" : g.compliant === false ? "No" : "-"}</Td>
                  <Td><StatusBadge status={g.match_status} /></Td>
                </tr>
              ))}
            </tbody>
          </table>
          {gaps.length === 500 && (
            <div style={{ padding: 10, fontSize: 11, color: C.textTertiary, textAlign: "center", background: C.bgSecondary }}>
              Showing first 500 rows.
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// ===============================================================================
// Outbound placeholder - Day 3+ Duke-Margolis-aligned supplemental data
// ===============================================================================
function HEDISOutboundPlaceholder() {
  return (
    <Card style={{ padding: 32, textAlign: "center" }}>
      <div style={{ fontSize: 18, fontWeight: 600, color: C.textPrimary, marginBottom: 8 }}>
        Outbound (Coming Soon)
      </div>
      <div style={{ fontSize: 13, color: C.textSecondary, maxWidth: 540, margin: "0 auto", lineHeight: 1.6 }}>
        This is where you'll generate <strong>supplemental data submissions</strong> back to health plans
        - the Duke-Margolis-aligned format proving your practice closed open gaps with actual A1c values,
        BP readings, LOINC codes, and encounter dates.
      </div>
      <div style={{ fontSize: 12, color: C.textTertiary, maxWidth: 540, margin: "12px auto 0", lineHeight: 1.6 }}>
        Initial scope: A1c control (GSD) and Blood Pressure (CBP). Submissions will follow each plan's
        SFTP convention with optional Duke-Margolis canonical format fallback.
      </div>
      <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 16, fontStyle: "italic" }}>
        Available after the closure-detection engine ships in Day 3+.
      </div>
    </Card>
  );
}
