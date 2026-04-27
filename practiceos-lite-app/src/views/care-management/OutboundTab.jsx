// ═══════════════════════════════════════════════════════════════════════════
// src/views/care-management/OutboundTab.jsx
//
// Phase 3 admin surface for HEDIS supplemental-data outbound submissions.
// Lives inside Care Management for Owner / Manager roles only (gated by
// CareManagementView's visibility logic and defense-in-depth here).
//
// Workflow:
//   1. Admin clicks "+ New submission", picks payer + MY
//   2. Modal calls hedis-outbound-generate edge function with dry_run=true
//   3. Preview shows file name, gap count, warnings, first 3 data rows
//   4. Admin clicks "Generate" -> edge function called with dry_run=false
//   5. Submission lands in history with status='Generated'
//   6. Admin downloads file, uploads to plan SFTP/portal/email
//   7. Admin marks Sent (with sent_via, sent_to, timestamp)
//   8. Or marks Voided if regeneration is needed
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { supabase } from "../../lib/supabaseClient";
import { C } from "../../lib/tokens";
import { Card, SectionHead, Btn, Badge, Modal, Loader, FL, Input, Select, Textarea } from "../../components/ui";
import { updateRow } from "../../lib/db";

// ─── NC health plan label lookup (mirrors VBPContractsTab) ────────────────
const NC_HEALTH_PLANS_GROUPED = [
  { group: "NC Medicaid - Standard Plan PHPs", options: [
    { short: "wellcare",      label: "WellCare of NC" },
    { short: "amerihealth",   label: "AmeriHealth Caritas NC" },
    { short: "healthy_blue",  label: "Healthy Blue (BCBS NC Medicaid)" },
    { short: "uhc_community", label: "UHC Community Plan of NC" },
    { short: "cch",           label: "Carolina Complete Health" },
  ]},
  { group: "NC Medicaid - Tailored Plan PHPs", options: [
    { short: "alliance", label: "Alliance Health" },
    { short: "partners", label: "Partners Health Management" },
    { short: "trillium", label: "Trillium Health Resources" },
    { short: "vaya",     label: "Vaya Health" },
  ]},
  { group: "NC Medicaid - Other", options: [
    { short: "ebci",               label: "EBCI Tribal Option" },
    { short: "nc_medicaid_direct", label: "NC Medicaid Direct (FFS)" },
  ]},
  { group: "Behavioral Health Carve-out", options: [
    { short: "ubh", label: "United Behavioral Health" },
  ]},
  { group: "Commercial", options: [
    { short: "bcbs_nc",        label: "BCBS NC (Commercial)" },
    { short: "aetna",          label: "Aetna" },
    { short: "cigna",          label: "Cigna" },
    { short: "uhc_commercial", label: "UHC (Commercial)" },
    { short: "humana",         label: "Humana" },
  ]},
  { group: "Medicare Advantage", options: [
    { short: "wellcare_ma",          label: "WellCare MA" },
    { short: "humana_ma",            label: "Humana MA" },
    { short: "uhc_ma",               label: "UHC MA" },
    { short: "aetna_ma",             label: "Aetna MA" },
    { short: "bcbs_nc_ma",           label: "BCBS NC MA" },
    { short: "healthteam_advantage", label: "HealthTeam Advantage" },
    { short: "alignment",            label: "Alignment Healthcare" },
  ]},
  { group: "Medicare", options: [
    { short: "medicare_ffs", label: "Original Medicare" },
    { short: "mssp",         label: "MSSP ACO" },
  ]},
  { group: "Other", options: [
    { short: "other", label: "Other" },
  ]},
];

const PLAN_LABEL = {};
for (const g of NC_HEALTH_PLANS_GROUPED) for (const o of g.options) PLAN_LABEL[o.short] = o.label;

const SENT_VIA_OPTIONS = ["Manual SFTP", "Auto SFTP", "Email", "Plan Portal", "Other"];
const STATUS_FILTER_OPTIONS = ["All", "Generated", "Sent", "Failed", "Voided"];

const STATUS_VARIANT = {
  Generated:  { variant: "amber",   label: "Generated" },
  Sent:       { variant: "green",   label: "Sent" },
  Failed:     { variant: "red",     label: "Failed" },
  Voided:     { variant: "neutral", label: "Voided" },
  Superseded: { variant: "neutral", label: "Superseded" },
};

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// ─── Main component ────────────────────────────────────────────────────────
export default function OutboundTab({ practiceId, isAdmin }) {
  const { profile } = useAuth();

  const [configs, setConfigs]                 = useState([]);
  const [submissions, setSubmissions]         = useState([]);
  const [loading, setLoading]                 = useState(true);
  const [error, setError]                     = useState(null);
  const [generateOpen, setGenerateOpen]       = useState(false);
  const [expandedId, setExpandedId]           = useState(null);
  const [sentModalSub, setSentModalSub]       = useState(null);
  const [voidModalSub, setVoidModalSub]       = useState(null);
  const [filterStatus, setFilterStatus]       = useState("All");
  const [filterPayer, setFilterPayer]         = useState("All");

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const [configRes, subRes] = await Promise.all([
        supabase.from("cm_outbound_configs")
          .select("id, code, name, format, file_naming_pattern, measure_scope, active")
          .eq("active", true)
          .order("code"),
        supabase.from("cm_outbound_submissions")
          .select("id, payer_short_name, contract_id, measurement_year, file_name, gap_count, status, generated_at, sent_at, sent_via, sent_to, voided_at, void_reason, notes, file_content, file_content_hash, generated_by, config_id")
          .eq("practice_id", practiceId)
          .order("generated_at", { ascending: false }),
      ]);
      if (configRes.error) throw configRes.error;
      if (subRes.error) throw subRes.error;
      setConfigs(configRes.data || []);
      setSubmissions(subRes.data || []);
    } catch (e) {
      setError(e.message || "Failed to load outbound data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (practiceId) refresh();
  }, [practiceId]);

  // KPIs
  const kpis = useMemo(() => {
    const k = { total: submissions.length, generated: 0, sent: 0, voided: 0, gapsThisYear: 0 };
    const thisYear = new Date().getFullYear();
    for (const s of submissions) {
      if (s.status === "Generated") k.generated++;
      else if (s.status === "Sent") k.sent++;
      else if (s.status === "Voided") k.voided++;
      if (s.measurement_year === thisYear) k.gapsThisYear += s.gap_count || 0;
    }
    return k;
  }, [submissions]);

  // Filters
  const filtered = useMemo(() => {
    return submissions.filter(s => {
      if (filterStatus !== "All" && s.status !== filterStatus) return false;
      if (filterPayer !== "All" && s.payer_short_name !== filterPayer) return false;
      return true;
    });
  }, [submissions, filterStatus, filterPayer]);

  const distinctPayers = useMemo(() => {
    const set = new Set(submissions.map(s => s.payer_short_name));
    return ["All", ...Array.from(set).sort()];
  }, [submissions]);

  // ─── Defense in depth: admin-only ────────────────────────────────────────
  if (!isAdmin) {
    return (
      <Card style={{ padding: 24, textAlign: "center" }}>
        <SectionHead title="Outbound Submissions" />
        <div style={{ marginTop: 12, fontSize: 13, color: C.textSecondary }}>
          Outbound submissions are administrative artifacts (Owner / Manager only).
        </div>
      </Card>
    );
  }

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header + CTA */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <SectionHead title="Outbound Submissions" />
          <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 4 }}>
            Generate Duke-Margolis canonical supplemental-data files from closed HEDIS gaps. Submit to plans monthly via SFTP, portal, or email; mark Sent here for audit trail.
          </div>
        </div>
        <Btn onClick={() => setGenerateOpen(true)}>+ New submission</Btn>
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        <KPICard label="Total submissions" value={kpis.total} />
        <KPICard label="Awaiting send" value={kpis.generated} accent={kpis.generated > 0 ? C.amber : null} />
        <KPICard label="Sent" value={kpis.sent} accent={C.teal} />
        <KPICard label={"Gaps reported (" + new Date().getFullYear() + ")"} value={kpis.gapsThisYear} />
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: C.textSecondary }}>Status:</span>
        {STATUS_FILTER_OPTIONS.map(s => (
          <Chip key={s} active={filterStatus === s} onClick={() => setFilterStatus(s)}>{s}</Chip>
        ))}
        <span style={{ fontSize: 12, color: C.textSecondary, marginLeft: 12 }}>Payer:</span>
        <select value={filterPayer} onChange={e => setFilterPayer(e.target.value)}
          style={{ padding: "6px 10px", border: "0.5px solid " + C.borderMid, borderRadius: 4, fontSize: 12, fontFamily: "inherit", background: "#fff" }}>
          {distinctPayers.map(p => (
            <option key={p} value={p}>{p === "All" ? "All payers" : (PLAN_LABEL[p] || p)}</option>
          ))}
        </select>
      </div>

      {/* Body */}
      {loading ? (
        <Loader label="Loading submissions..." />
      ) : error ? (
        <Card style={{ padding: 16, background: "#fef2f2", border: "0.5px solid " + C.red, color: C.red, fontSize: 12 }}>
          {error}
        </Card>
      ) : filtered.length === 0 ? (
        <Card style={{ padding: 32, textAlign: "center" }}>
          <div style={{ fontSize: 14, color: C.textSecondary, marginBottom: 8 }}>
            {submissions.length === 0
              ? "No submissions yet. Click \"+ New submission\" to generate your first file."
              : "No submissions match the current filters."}
          </div>
        </Card>
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: C.bgSecondary, borderBottom: "0.5px solid " + C.borderLight }}>
                <Th>Generated</Th>
                <Th>Payer</Th>
                <Th>MY</Th>
                <Th>File</Th>
                <Th>Gaps</Th>
                <Th>Status</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => (
                <SubmissionRow
                  key={s.id}
                  submission={s}
                  expanded={expandedId === s.id}
                  onToggle={() => setExpandedId(expandedId === s.id ? null : s.id)}
                  onMarkSent={() => setSentModalSub(s)}
                  onVoid={() => setVoidModalSub(s)}
                  onDownload={() => downloadFile(s)}
                />
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Modals */}
      {generateOpen && (
        <GenerateModal
          configs={configs}
          onClose={() => setGenerateOpen(false)}
          onGenerated={() => { setGenerateOpen(false); refresh(); }}
        />
      )}
      {sentModalSub && (
        <MarkSentModal
          submission={sentModalSub}
          profile={profile}
          onClose={() => setSentModalSub(null)}
          onSaved={() => { setSentModalSub(null); refresh(); }}
        />
      )}
      {voidModalSub && (
        <VoidModal
          submission={voidModalSub}
          profile={profile}
          onClose={() => setVoidModalSub(null)}
          onSaved={() => { setVoidModalSub(null); refresh(); }}
        />
      )}
    </div>
  );
}

// ─── Submission row + expanded detail ─────────────────────────────────────
function SubmissionRow({ submission: s, expanded, onToggle, onMarkSent, onVoid, onDownload }) {
  const variant = STATUS_VARIANT[s.status] || { variant: "neutral", label: s.status };
  const isActionable = s.status === "Generated";
  return (
    <>
      <tr style={{ borderBottom: "0.5px solid " + C.borderLight, cursor: "pointer" }} onClick={onToggle}>
        <Td>{new Date(s.generated_at).toLocaleString()}</Td>
        <Td><strong>{PLAN_LABEL[s.payer_short_name] || s.payer_short_name}</strong></Td>
        <Td>{s.measurement_year}</Td>
        <Td style={{ fontFamily: "monospace", fontSize: 11 }}>{s.file_name}</Td>
        <Td>{s.gap_count}</Td>
        <Td><Badge label={variant.label} variant={variant.variant} size="xs" /></Td>
        <Td onClick={e => e.stopPropagation()}>
          <div style={{ display: "flex", gap: 4 }}>
            <Btn variant="outline" size="sm" onClick={onDownload}>Download</Btn>
            {isActionable && <Btn variant="outline" size="sm" onClick={onMarkSent}>Mark Sent</Btn>}
            {(s.status === "Generated" || s.status === "Sent") && <Btn variant="outline" size="sm" onClick={onVoid}>Void</Btn>}
          </div>
        </Td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7} style={{ padding: 16, background: "#fafafa", borderBottom: "0.5px solid " + C.borderLight }}>
            <SubmissionDetail submission={s} />
          </td>
        </tr>
      )}
    </>
  );
}

function SubmissionDetail({ submission: s }) {
  const [gaps, setGaps] = useState([]);
  const [showRaw, setShowRaw] = useState(false);
  const [loadingGaps, setLoadingGaps] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("cm_outbound_submission_gaps")
        .select("gap_id, evidence_id, row_index, cm_hedis_member_gaps:gap_id(measure_code, plan_member_id, member_first_name, member_last_name)")
        .eq("submission_id", s.id)
        .order("row_index");
      setGaps(data || []);
      setLoadingGaps(false);
    })();
  }, [s.id]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      <div>
        <DetailLabel>Audit metadata</DetailLabel>
        <DetailRow k="Submission ID" v={s.id} mono />
        <DetailRow k="File hash (SHA-256)" v={s.file_content_hash} mono />
        <DetailRow k="Generated at" v={new Date(s.generated_at).toLocaleString()} />
        {s.sent_at && <DetailRow k="Sent at" v={new Date(s.sent_at).toLocaleString()} />}
        {s.sent_via && <DetailRow k="Sent via" v={s.sent_via} />}
        {s.sent_to && <DetailRow k="Sent to" v={s.sent_to} />}
        {s.voided_at && <DetailRow k="Voided at" v={new Date(s.voided_at).toLocaleString()} />}
        {s.void_reason && <DetailRow k="Void reason" v={s.void_reason} />}
        {s.notes && <DetailRow k="Notes" v={s.notes} />}
        <div style={{ marginTop: 8 }}>
          <Btn variant="outline" size="sm" onClick={() => setShowRaw(!showRaw)}>
            {showRaw ? "Hide" : "Show"} file content
          </Btn>
        </div>
        {showRaw && (
          <pre style={{
            marginTop: 8, padding: 8, background: "#fff", border: "0.5px solid " + C.borderLight,
            borderRadius: 4, fontSize: 10, fontFamily: "monospace", maxHeight: 240, overflow: "auto",
            whiteSpace: "pre", wordBreak: "break-all",
          }}>
            {s.file_content}
          </pre>
        )}
      </div>
      <div>
        <DetailLabel>Included gaps ({gaps.length})</DetailLabel>
        {loadingGaps ? (
          <div style={{ fontSize: 11, color: C.textTertiary }}>Loading...</div>
        ) : (
          <div style={{ maxHeight: 240, overflow: "auto" }}>
            {gaps.map(g => (
              <div key={g.gap_id} style={{ padding: "4px 0", borderBottom: "0.5px solid " + C.borderLight, fontSize: 11 }}>
                <strong>#{g.row_index}</strong>{" "}
                <code style={{ fontFamily: "monospace" }}>{g.cm_hedis_member_gaps?.measure_code}</code>{" "}
                {g.cm_hedis_member_gaps?.member_first_name} {g.cm_hedis_member_gaps?.member_last_name}{" "}
                <span style={{ color: C.textTertiary }}>· {g.cm_hedis_member_gaps?.plan_member_id}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Generate modal: 2-step (preview → commit) ───────────────────────────
function GenerateModal({ configs, onClose, onGenerated }) {
  const currentYear = new Date().getFullYear();
  const [payer, setPayer]               = useState("");
  const [my, setMy]                     = useState(currentYear);
  const [configCode, setConfigCode]     = useState("dm_canonical_v1");
  const [stage, setStage]               = useState("input"); // input | previewing | preview | generating
  const [preview, setPreview]           = useState(null);
  const [error, setError]               = useState(null);

  const handlePreview = async () => {
    if (!payer) { setError("Pick a payer"); return; }
    setError(null);
    setStage("previewing");
    try {
      const result = await invokeOutboundEngine({
        payer_short_name: payer,
        measurement_year: my,
        config_code: configCode,
        dry_run: true,
      });
      setPreview(result);
      setStage("preview");
    } catch (e) {
      setError(e.message || "Preview failed");
      setStage("input");
    }
  };

  const handleGenerate = async () => {
    setError(null);
    setStage("generating");
    try {
      await invokeOutboundEngine({
        payer_short_name: payer,
        measurement_year: my,
        config_code: configCode,
        dry_run: false,
      });
      onGenerated();
    } catch (e) {
      setError(e.message || "Generation failed");
      setStage("preview");
    }
  };

  return (
    <Modal title="New outbound submission" onClose={onClose} maxWidth={680}>
      {/* Step 1: pick scope */}
      {(stage === "input" || stage === "previewing") && (
        <>
          <div style={{ marginBottom: 12, fontSize: 12, color: C.textSecondary, lineHeight: 1.55 }}>
            Generates a Duke-Margolis canonical pipe-delimited file from closed HEDIS gaps in the chosen scope. Preview first to check warnings and gap count, then generate to commit.
          </div>
          <div style={{ marginBottom: 12 }}>
            <FL>Payer / health plan *</FL>
            <select value={payer} onChange={e => setPayer(e.target.value)}
              style={{ width: "100%", padding: "8px 10px", border: "0.5px solid " + C.borderMid, borderRadius: 4, fontSize: 13, fontFamily: "inherit", background: "#fff" }}>
              <option value="">Select a plan...</option>
              {NC_HEALTH_PLANS_GROUPED.map(group => (
                <optgroup key={group.group} label={group.group}>
                  {group.options.map(opt => (
                    <option key={opt.short} value={opt.short}>{opt.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Input label="Measurement year *" type="number" value={my} onChange={v => setMy(parseInt(v, 10) || currentYear)} />
            <Select label="Format" value={configCode} onChange={setConfigCode}
              options={configs.map(c => c.code)} />
          </div>
          {error && (
            <div style={{ marginTop: 8, padding: "8px 12px", background: "#fef2f2", border: "0.5px solid " + C.red, borderRadius: 6, fontSize: 12, color: C.red }}>
              {error}
            </div>
          )}
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: "0.5px solid " + C.borderLight, display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Btn variant="outline" onClick={onClose} disabled={stage === "previewing"}>Cancel</Btn>
            <Btn onClick={handlePreview} disabled={!payer || stage === "previewing"}>
              {stage === "previewing" ? "Loading preview..." : "Preview"}
            </Btn>
          </div>
        </>
      )}

      {/* Step 2: preview + commit */}
      {(stage === "preview" || stage === "generating") && preview && (
        <>
          <div style={{ marginBottom: 12, padding: "10px 12px", background: C.tealBg, border: "0.5px solid " + C.tealBorder, borderRadius: 6 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{preview.file_name}</div>
            <div style={{ fontSize: 12, color: C.textSecondary }}>
              {preview.gap_count} gap{preview.gap_count === 1 ? "" : "s"} · {preview.warnings?.length || 0} warnings · format {preview.config_code}
            </div>
          </div>

          {(preview.warnings || []).length > 0 && (
            <div style={{ marginBottom: 12, padding: "10px 12px", background: "#fffbeb", border: "0.5px solid " + C.amberBorder, borderRadius: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: C.amber }}>
                {preview.warnings.length} conditionally-required field{preview.warnings.length === 1 ? "" : "s"} missing
              </div>
              <div style={{ fontSize: 11, color: C.textSecondary, maxHeight: 100, overflow: "auto" }}>
                {summarizeWarnings(preview.warnings).map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </div>
              <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 6 }}>
                CR warnings don't block submission. Plans may flag rows with missing CR fields - review before sending.
              </div>
            </div>
          )}

          <div style={{ marginBottom: 12 }}>
            <DetailLabel>Preview (first 3 data rows)</DetailLabel>
            <pre style={{
              padding: 10, background: "#fff", border: "0.5px solid " + C.borderLight,
              borderRadius: 4, fontSize: 10, fontFamily: "monospace", maxHeight: 200, overflow: "auto",
              whiteSpace: "pre", wordBreak: "break-all",
            }}>
              {(preview.preview_first_3_rows || []).join("\n")}
            </pre>
          </div>

          {error && (
            <div style={{ marginTop: 8, padding: "8px 12px", background: "#fef2f2", border: "0.5px solid " + C.red, borderRadius: 6, fontSize: 12, color: C.red }}>
              {error}
            </div>
          )}

          <div style={{ marginTop: 16, paddingTop: 12, borderTop: "0.5px solid " + C.borderLight, display: "flex", gap: 8, justifyContent: "space-between" }}>
            <Btn variant="ghost" onClick={() => { setPreview(null); setStage("input"); }} disabled={stage === "generating"}>← Back</Btn>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn variant="outline" onClick={onClose} disabled={stage === "generating"}>Cancel</Btn>
              <Btn onClick={handleGenerate} disabled={stage === "generating"}>
                {stage === "generating" ? "Generating..." : "Generate submission"}
              </Btn>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}

// Group warnings by field for compact display
function summarizeWarnings(warnings) {
  const byField = {};
  for (const w of warnings) {
    byField[w.field] = (byField[w.field] || 0) + 1;
  }
  return Object.entries(byField)
    .sort((a, b) => b[1] - a[1])
    .map(([field, count]) => "· " + field + (count > 1 ? " (" + count + " gaps)" : ""));
}

// ─── Mark Sent modal ──────────────────────────────────────────────────────
function MarkSentModal({ submission, profile, onClose, onSaved }) {
  const [sentVia, setSentVia] = useState("Manual SFTP");
  const [sentTo, setSentTo]   = useState("");
  const [sentAt, setSentAt]   = useState(() => new Date().toISOString().slice(0, 16));
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState(null);

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      await updateRow("cm_outbound_submissions", submission.id, {
        status:    "Sent",
        sent_at:   new Date(sentAt).toISOString(),
        sent_via:  sentVia,
        sent_to:   sentTo.trim() || null,
      }, {
        audit: { entityType: "cm_outbound_submissions", details: { action: "marked_sent", sent_via: sentVia } },
      });
      onSaved();
    } catch (e) {
      setError(e.message || "Update failed");
      setSaving(false);
    }
  };

  return (
    <Modal title={"Mark sent: " + submission.file_name} onClose={onClose} maxWidth={520}>
      <div style={{ marginBottom: 12, fontSize: 12, color: C.textSecondary }}>
        Record how this submission was delivered to the plan. This becomes part of the audit trail.
      </div>
      <Select label="Delivery channel *" value={sentVia} onChange={setSentVia} options={SENT_VIA_OPTIONS} />
      <Input label="Sent to (path / email / portal URL)" value={sentTo} onChange={setSentTo}
        placeholder={sentVia === "Manual SFTP" ? "sftp://plan-host.example.com/inbox/" : "e.g. supplemental-data@plan.com"} />
      <Input label="When was it sent? *" type="datetime-local" value={sentAt} onChange={setSentAt} />
      {error && (
        <div style={{ marginTop: 8, padding: "8px 12px", background: "#fef2f2", border: "0.5px solid " + C.red, borderRadius: 6, fontSize: 12, color: C.red }}>
          {error}
        </div>
      )}
      <div style={{ marginTop: 16, paddingTop: 12, borderTop: "0.5px solid " + C.borderLight, display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn variant="outline" onClick={onClose} disabled={saving}>Cancel</Btn>
        <Btn onClick={save} disabled={saving}>{saving ? "Saving..." : "Confirm sent"}</Btn>
      </div>
    </Modal>
  );
}

// ─── Void modal ──────────────────────────────────────────────────────────
function VoidModal({ submission, profile, onClose, onSaved }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);

  const save = async () => {
    if (!reason.trim()) { setError("Reason required for void"); return; }
    setError(null);
    setSaving(true);
    try {
      await updateRow("cm_outbound_submissions", submission.id, {
        status:      "Voided",
        voided_at:   new Date().toISOString(),
        void_reason: reason.trim(),
      }, {
        audit: { entityType: "cm_outbound_submissions", details: { action: "voided", was_status: submission.status } },
      });
      onSaved();
    } catch (e) {
      setError(e.message || "Update failed");
      setSaving(false);
    }
  };

  return (
    <Modal title={"Void submission: " + submission.file_name} onClose={onClose} maxWidth={520}>
      <div style={{ marginBottom: 12, padding: "10px 12px", background: "#fef2f2", border: "0.5px solid " + C.red, borderRadius: 6, fontSize: 12, color: C.red, lineHeight: 1.55 }}>
        Voiding marks this submission as no-longer-valid. The audit row stays. Use this when you regenerated a corrected file or sent a wrong version. Voided submissions can't be marked Sent later.
      </div>
      <Textarea label="Reason *" value={reason} onChange={setReason} rows={3}
        placeholder="e.g. Regenerated after correcting Provider NPI on 4 gaps; superseded by submission XYZ" />
      {error && (
        <div style={{ marginTop: 8, padding: "8px 12px", background: "#fef2f2", border: "0.5px solid " + C.red, borderRadius: 6, fontSize: 12, color: C.red }}>
          {error}
        </div>
      )}
      <div style={{ marginTop: 16, paddingTop: 12, borderTop: "0.5px solid " + C.borderLight, display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn variant="outline" onClick={onClose} disabled={saving}>Cancel</Btn>
        <Btn onClick={save} disabled={saving} style={{ background: C.red, borderColor: C.red }}>
          {saving ? "Voiding..." : "Confirm void"}
        </Btn>
      </div>
    </Modal>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────

// Invoke the hedis-outbound-generate edge function. Uses the supabase-js
// functions.invoke method which auto-attaches the session JWT.
async function invokeOutboundEngine(body) {
  const { data, error } = await supabase.functions.invoke("hedis-outbound-generate", {
    body,
  });
  if (error) {
    // Functions invoke wraps non-2xx as error.context — try to surface server message
    let serverMsg = error.message;
    try {
      const ctx = error.context;
      if (ctx && typeof ctx.text === "function") {
        const txt = await ctx.text();
        const parsed = JSON.parse(txt);
        if (parsed.error) serverMsg = parsed.error;
        if (parsed.errors) serverMsg += " (" + parsed.errors.length + " field errors)";
      }
    } catch (_) {}
    throw new Error(serverMsg);
  }
  return data;
}

// Trigger a download of the file_content as a .txt file
function downloadFile(submission) {
  const blob = new Blob([submission.file_content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = submission.file_name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Small UI helpers ────────────────────────────────────────────────────
function KPICard({ label, value, accent }) {
  return (
    <Card style={{ padding: 12 }}>
      <div style={{ fontSize: 11, color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: accent || C.textPrimary, lineHeight: 1.1 }}>{value}</div>
    </Card>
  );
}

function Chip({ active, children, onClick }) {
  return (
    <button onClick={onClick}
      style={{
        padding: "6px 12px", fontSize: 12, fontWeight: active ? 600 : 500,
        border: "0.5px solid " + (active ? C.teal : C.borderMid),
        background: active ? C.tealBg : "#fff",
        color: active ? C.teal : C.textPrimary,
        borderRadius: 16, cursor: "pointer", fontFamily: "inherit",
        transition: "background 0.15s, color 0.15s",
      }}>
      {children}
    </button>
  );
}

function Th({ children }) {
  return <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 600, color: C.textSecondary, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>{children}</th>;
}

function Td({ children, ...rest }) {
  return <td style={{ padding: "10px 12px", verticalAlign: "middle" }} {...rest}>{children}</td>;
}

function DetailLabel({ children }) {
  return <div style={{ fontSize: 10, color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4, fontWeight: 600 }}>{children}</div>;
}

function DetailRow({ k, v, mono }) {
  return (
    <div style={{ marginBottom: 4, fontSize: 11 }}>
      <span style={{ color: C.textTertiary }}>{k}: </span>
      <span style={{ fontFamily: mono ? "monospace" : "inherit", color: C.textPrimary, wordBreak: "break-all" }}>{v}</span>
    </div>
  );
}
