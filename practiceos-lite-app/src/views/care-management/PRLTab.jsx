import { useState, useEffect, useCallback } from "react";
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
// PRL (Provider-Reported Lists) tab
//
// Two modes share a single tab:
//   - Inbound:  files we RECEIVE from PHPs (patient roster assignments)
//   - Outbound: files we SEND to PHPs (Section D care management reports)
//
// File lifecycle differs between the two:
//   - Inbound: Received -> Parsing -> Parsed -> Validated -> Reconciled (+ Failed/Rejected)
//   - Outbound: Draft -> Ready -> Generated -> Transmitted -> Acknowledged
//
// Admin-only in the Care Management Console (Owner/Manager only). Clinical
// roles (Care Managers, Supervising CMs, CHWs) do not see this tab.
// ===============================================================================

export default function PRLTab() {
  const { profile } = useAuth();
  const [mode, setMode] = useState("inbound"); // "inbound" | "outbound"

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <SubTabButton active={mode === "inbound"}  onClick={() => setMode("inbound")}>Inbound (PRL Imports)</SubTabButton>
        <SubTabButton active={mode === "outbound"} onClick={() => setMode("outbound")}>Outbound (PRL Exports)</SubTabButton>
      </div>
      {mode === "inbound"  && <PRLInbound  practiceId={profile?.practice_id} />}
      {mode === "outbound" && <PRLOutbound practiceId={profile?.practice_id} />}
    </div>
  );
}

// --- Inbound Imports ----------------------------------------------------------
function PRLInbound({ practiceId }) {
  const [imports, setImports] = useState([]);
  const [pending, setPending] = useState([]); // from cm_prl_pending_reconciliation_summary RPC
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [selected, setSelected] = useState(null);
  const [showNew, setShowNew]   = useState(false);
  const [running, setRunning]   = useState(null); // "parse" | "match" | null

  const load = useCallback(async () => {
    if (!practiceId) return;
    setLoading(true);
    setError(null);
    try {
      const [impRes, pendRes] = await Promise.all([
        supabase
          .from("cm_prl_imports")
          .select("id, file_type, full_or_incremental, source_plan_short_name, source_php_name, file_name, version_release, status, parsed_row_count, matched_row_count, unmatched_row_count, received_at")
          .eq("practice_id", practiceId)
          .order("received_at", { ascending: false })
          .limit(50),
        supabase.rpc("cm_prl_pending_reconciliation_summary"),
      ]);
      if (impRes.error) throw impRes.error;
      setImports(impRes.data || []);
      setPending(pendRes.error ? [] : (pendRes.data || []));
    } catch (e) {
      setError(e.message || "Failed to load imports");
    } finally {
      setLoading(false);
    }
  }, [practiceId]);

  useEffect(() => { load(); }, [load]);

  const runEdge = async (slug, payload) => {
    setRunning(slug === "prl-parse" ? "parse" : slug === "prl-match" ? "match" : "apply");
    try {
      const { data, error } = await supabase.functions.invoke(slug, { body: payload });
      if (error) throw error;
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

  if (loading) return <Loader label="Loading PRL imports..." />;

  return (
    <div>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 20 }}>
        <KpiCard
          label="Total imports (recent 50)"
          value={imports.length}
          hint="Inbound PRL files received"
        />
        <KpiCard
          label="Needs reconciliation"
          value={pending.length}
          hint="Imports with unmatched or multi-match rows"
          variant={pending.length > 0 ? "amber" : "neutral"}
        />
        <KpiCard
          label="Ready to validate"
          value={imports.filter(i => i.status === "Parsed").length}
          hint="Awaiting prl-match run"
          variant="blue"
        />
        <KpiCard
          label="Ready to apply"
          value={imports.filter(i => i.status === "Validated").length}
          hint="Awaiting prl-apply run"
          variant="blue"
        />
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <Btn variant="primary" size="md" onClick={() => setShowNew(true)}>+ New import (paste PSV)</Btn>
        <Btn variant="outline" size="md" onClick={load}>Refresh</Btn>
      </div>

      {/* Imports table */}
      {imports.length === 0 ? (
        <EmptyState
          title="No PRL imports yet"
          message="Paste PSV text from an inbound file to start. Once your sFTP endpoint is configured, files will land here automatically."
        />
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead style={{ background: C.bgSecondary, borderBottom: "0.5px solid " + C.borderLight }}>
              <tr>
                <Th>Received</Th>
                <Th>Plan</Th>
                <Th>File</Th>
                <Th>Version</Th>
                <Th>Status</Th>
                <Th align="right">Rows</Th>
                <Th align="right">Matched</Th>
                <Th align="right">Unmatched</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {imports.map((imp, idx) => (
                <tr
                  key={imp.id}
                  onClick={() => setSelected(imp)}
                  style={{
                    borderBottom: idx < imports.length - 1 ? "0.5px solid " + C.borderLight : "none",
                    cursor: "pointer",
                    background: selected?.id === imp.id ? C.tealBg : "transparent",
                  }}
                >
                  <Td>{imp.received_at ? new Date(imp.received_at).toLocaleString() : "-"}</Td>
                  <Td><strong>{imp.source_plan_short_name}</strong> {imp.source_php_name ? " - " + imp.source_php_name : ""}</Td>
                  <Td style={{ fontSize: 11, color: C.textTertiary, fontFamily: "monospace" }}>{imp.file_name}</Td>
                  <Td>{imp.version_release || "-"}</Td>
                  <Td><StatusBadge status={imp.status} /></Td>
                  <Td align="right">{imp.parsed_row_count || 0}</Td>
                  <Td align="right">{imp.matched_row_count || 0}</Td>
                  <Td align="right">{imp.unmatched_row_count || 0}</Td>
                  <Td align="right">
                    {imp.status === "Received" && (
                      <Btn size="sm" variant="outline" disabled={running === "parse"} onClick={e => { e.stopPropagation(); runEdge("prl-parse", { import_id: imp.id }); }}>
                        {running === "parse" ? "Parsing..." : "Parse"}
                      </Btn>
                    )}
                    {imp.status === "Parsed" && (
                      <Btn size="sm" variant="outline" disabled={running === "match"} onClick={e => { e.stopPropagation(); runEdge("prl-match", { import_id: imp.id }); }}>
                        {running === "match" ? "Matching..." : "Match"}
                      </Btn>
                    )}
                    {imp.status === "Validated" && (
                      <Btn size="sm" variant="primary" disabled={running === "apply"} onClick={e => { e.stopPropagation(); runEdge("prl-apply", { import_id: imp.id }); }}>
                        {running === "apply" ? "Applying..." : "Apply"}
                      </Btn>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {selected && (
        <ImportDetail importRow={selected} onClose={() => setSelected(null)} onResolved={load} />
      )}
      {showNew && (
        <NewImportModal practiceId={practiceId} onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(); }} />
      )}
    </div>
  );
}

// --- Outbound Exports ---------------------------------------------------------
function PRLOutbound({ practiceId }) {
  const [exports, setExports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [showTransmit, setShowTransmit] = useState(null); // export row or null
  const [generating, setGenerating] = useState(null);     // export id currently generating
  const [downloading, setDownloading] = useState(null);   // export id currently downloading

  const download = async (ex) => {
    if (!ex.file_path) { setError("No file to download - regenerate the export first."); return; }
    setDownloading(ex.id);
    try {
      const { data, error } = await supabase.storage
        .from("prl-exports")
        .createSignedUrl(ex.file_path, 60 * 60 * 24, { download: ex.file_name || "prl.txt" });
      if (error) throw error;
      if (data?.signedUrl) window.open(data.signedUrl, "_blank");
    } catch (e) {
      setError(e.message || "Download failed");
    } finally {
      setDownloading(null);
    }
  };

  const load = useCallback(async () => {
    if (!practiceId) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from("cm_prl_exports")
        .select("id, file_type, reporting_month, target_plan_short_name, target_php_name, status, record_count, version_release, file_name, file_path, file_size_bytes, generated_at, transmitted_at, transmission_method, notes")
        .eq("practice_id", practiceId)
        .order("reporting_month", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      setExports(data || []);
    } catch (e) {
      setError(e.message || "Failed to load exports");
    } finally {
      setLoading(false);
    }
  }, [practiceId]);

  useEffect(() => { load(); }, [load]);

  const generate = async (exportId) => {
    setGenerating(exportId);
    try {
      const { data, error } = await supabase.functions.invoke("prl-generate", { body: { export_id: exportId } });
      if (error) throw error;
      if (data && data.ok === false) throw new Error(data.error || "Generate failed");
      await load();
      return data;
    } catch (e) {
      setError(e.message || "Generate failed");
    } finally {
      setGenerating(null);
    }
  };

  if (loading) return <Loader label="Loading PRL exports..." />;

  return (
    <div>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <Btn variant="primary" size="md" onClick={() => setShowNew(true)}>+ New export</Btn>
        <Btn variant="outline" size="md" onClick={load}>Refresh</Btn>
      </div>

      {exports.length === 0 ? (
        <EmptyState
          title="No outbound exports yet"
          message="Create an export for a specific plan + reporting month. The generator walks your enrollments and touchpoints to build the PRL Section D response."
        />
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead style={{ background: C.bgSecondary, borderBottom: "0.5px solid " + C.borderLight }}>
              <tr>
                <Th>Reporting month</Th>
                <Th>Plan</Th>
                <Th>File type</Th>
                <Th>Version</Th>
                <Th>Status</Th>
                <Th align="right">Records</Th>
                <Th>Generated</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {exports.map((ex, idx) => (
                <tr key={ex.id} style={{ borderBottom: idx < exports.length - 1 ? "0.5px solid " + C.borderLight : "none" }}>
                  <Td>{ex.reporting_month}</Td>
                  <Td><strong>{ex.target_plan_short_name}</strong>{ex.target_php_name ? " - " + ex.target_php_name : ""}</Td>
                  <Td>{ex.file_type}</Td>
                  <Td>{ex.version_release || "-"}</Td>
                  <Td><StatusBadge status={ex.status} /></Td>
                  <Td align="right">{ex.record_count || 0}</Td>
                  <Td>{ex.generated_at ? new Date(ex.generated_at).toLocaleString() : "-"}</Td>
                  <Td align="right">
                    {(ex.status === "Draft" || ex.status === "Rejected") && (
                      <Btn size="sm" variant="outline" disabled={generating === ex.id} onClick={() => generate(ex.id)}>
                        {generating === ex.id ? "Generating..." : (ex.status === "Rejected" ? "Regenerate" : "Generate")}
                      </Btn>
                    )}
                    {(ex.status === "Generated" || ex.status === "Transmitted" || ex.status === "Acknowledged") && ex.file_path && (
                      <Btn size="sm" variant="outline" disabled={downloading === ex.id} onClick={() => download(ex)} style={{ marginRight: 4 }}>
                        {downloading === ex.id ? "..." : "Download"}
                      </Btn>
                    )}
                    {ex.status === "Generated" && (
                      <Btn size="sm" variant="primary" onClick={() => setShowTransmit(ex)}>
                        Mark as Transmitted
                      </Btn>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {showNew && (
        <NewExportModal practiceId={practiceId} onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(); }} />
      )}
      {showTransmit && (
        <TransmitModal exportRow={showTransmit} onClose={() => setShowTransmit(null)} onTransmitted={() => { setShowTransmit(null); load(); }} />
      )}
    </div>
  );
}

// --- Transmit Modal (Mark as Transmitted) ------------------------------------
function TransmitModal({ exportRow, onClose, onTransmitted }) {
  const [method, setMethod] = useState("SFTP");
  const [notes, setNotes]   = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData?.user?.id || null;
      const { error } = await supabase
        .from("cm_prl_exports")
        .update({
          status:              "Transmitted",
          transmission_method: method,
          transmission_notes:  notes.trim() || null,
          transmitted_at:      new Date().toISOString(),
          transmitted_by:      userId,
        })
        .eq("id", exportRow.id);
      if (error) throw error;
      onTransmitted();
    } catch (e) {
      setError(e.message || "Failed to mark as transmitted");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={"Mark as Transmitted: " + (exportRow.file_name || exportRow.target_plan_short_name)} onClose={onClose} width={520}>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      <div style={{ marginBottom: 12 }}>
        <FL>Transmission method</FL>
        <select value={method} onChange={e => setMethod(e.target.value)} style={selectStyle}>
          <option value="SFTP">SFTP</option>
          <option value="Plan Portal">Plan Portal</option>
          <option value="Email">Email</option>
          <option value="Manual Upload">Manual Upload</option>
        </select>
      </div>
      <div style={{ marginBottom: 12 }}>
        <FL>Notes (optional)</FL>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={3}
          placeholder="e.g., SFTP server hostname, portal confirmation number, recipient email"
          style={{ ...inputStyle, resize: "vertical" }}
        />
      </div>
      <div style={{ fontSize: 11, color: C.textTertiary, marginBottom: 16 }}>
        This logs the transmission for your audit trail. It does not send the file - you must upload it to the plan's SFTP/portal separately.
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" disabled={saving} onClick={save}>{saving ? "Saving..." : "Mark as Transmitted"}</Btn>
      </div>
    </Modal>
  );
}

// --- Import Detail (inline panel) ---------------------------------------------
function ImportDetail({ importRow, onClose, onResolved }) {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("cm_prl_member_rows")
        .select("id, row_index, cnds_id, priority_population_1, php_risk_score_category, match_status, matched_patient_id, match_candidates, validation_errors")
        .eq("import_id", importRow.id)
        .order("row_index", { ascending: true })
        .limit(500);
      if (error) throw error;
      setRows(data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [importRow.id]);

  useEffect(() => { load(); }, [load]);

  const resolveRow = async (rowId, patientId) => {
    try {
      const { error } = await supabase
        .from("cm_prl_member_rows")
        .update({
          match_status: "Manually Resolved",
          matched_patient_id: patientId,
          match_resolved_at: new Date().toISOString(),
        })
        .eq("id", rowId);
      if (error) throw error;
      await load();
      onResolved && onResolved();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <Modal title={"Import detail: " + importRow.file_name} onClose={onClose} width={900}>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      {loading ? (
        <Loader label="Loading member rows..." />
      ) : rows.length === 0 ? (
        <EmptyState title="No rows" message="This import has no member rows yet. Run Parse first." />
      ) : (
        <div style={{ maxHeight: 500, overflow: "auto", border: "0.5px solid " + C.borderLight, borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead style={{ background: C.bgSecondary, position: "sticky", top: 0 }}>
              <tr>
                <Th>#</Th>
                <Th>CNDS ID</Th>
                <Th>Pop 1</Th>
                <Th>Risk</Th>
                <Th>Match</Th>
                <Th>Candidates</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} style={{ borderBottom: "0.5px solid " + C.borderLight }}>
                  <Td>{r.row_index}</Td>
                  <Td style={{ fontFamily: "monospace" }}>{r.cnds_id}</Td>
                  <Td>{r.priority_population_1 || "-"}</Td>
                  <Td>{r.php_risk_score_category || "-"}</Td>
                  <Td><StatusBadge status={r.match_status} /></Td>
                  <Td style={{ fontSize: 11 }}>
                    {Array.isArray(r.match_candidates) && r.match_candidates.length > 0
                      ? r.match_candidates.slice(0, 3).map(c => c.full_name).filter(Boolean).join(", ") + (r.match_candidates.length > 3 ? " +" + (r.match_candidates.length - 3) : "")
                      : "-"}
                  </Td>
                  <Td align="right">
                    {r.match_status === "Matched Multiple" && Array.isArray(r.match_candidates) && r.match_candidates.slice(0, 3).map(c => (
                      <Btn key={c.patient_id} size="sm" variant="outline" style={{ marginLeft: 4 }} onClick={() => resolveRow(r.id, c.patient_id)}>
                        Pick {(c.full_name || "").split(" ")[0] || "candidate"}
                      </Btn>
                    ))}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

// --- New Import Modal (paste PSV) ---------------------------------------------
function NewImportModal({ practiceId, onClose, onCreated }) {
  const [plans, setPlans] = useState([]);
  const [planCode, setPlanCode] = useState("");
  const [fileType, setFileType] = useState("AMH Standard Plan");
  const [versionRelease, setVersionRelease] = useState("AMH 7.0");
  const [fileName, setFileName] = useState("paste_test_" + Date.now() + ".TXT");
  const [psvText, setPsvText]   = useState("");
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState(null);

  useEffect(() => {
    supabase
      .from("cm_reference_codes")
      .select("code, label, metadata")
      .eq("category", "prl_plan_short_name")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .then(({ data }) => setPlans(data || []));
  }, []);

  const save = async () => {
    if (!planCode) { setError("Pick a target plan"); return; }
    if (!psvText.trim()) { setError("Paste the PSV text"); return; }
    setSaving(true);
    setError(null);
    try {
      const selected = plans.find(p => p.code === planCode);
      const sourcePhpName = selected ? selected.label : null;
      const { data, error } = await supabase
        .from("cm_prl_imports")
        .insert({
          practice_id:             practiceId,
          file_type:               fileType,
          full_or_incremental:     "Full",
          source_plan_short_name:  planCode,
          source_php_name:         sourcePhpName,
          file_name:               fileName,
          version_release:         versionRelease,
          status:                  "Received",
        })
        .select("id")
        .single();
      if (error) throw error;

      // Invoke parser inline with the pasted text so the row goes straight to Parsed.
      const { data: parseRes, error: parseErr } = await supabase.functions.invoke("prl-parse", {
        body: { import_id: data.id, psv_text: psvText },
      });
      if (parseErr) throw parseErr;
      if (parseRes && parseRes.ok === false) throw new Error(parseRes.error || "Parser returned error");

      onCreated(data.id);
    } catch (e) {
      setError(e.message || "Failed to create import");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="New PRL import (paste PSV)" onClose={onClose} width={800}>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <FL>File type</FL>
          <select value={fileType} onChange={e => setFileType(e.target.value)} style={selectStyle}>
            <option value="AMH Standard Plan">AMH Standard Plan</option>
            <option value="TCM Tailored Plan">TCM Tailored Plan</option>
          </select>
        </div>
        <div>
          <FL>Source plan</FL>
          <select value={planCode} onChange={e => setPlanCode(e.target.value)} style={selectStyle}>
            <option value="">-- Select --</option>
            {plans.map(p => (
              <option key={p.code} value={p.code}>{p.code} - {p.label}</option>
            ))}
          </select>
        </div>
        <div>
          <FL>Version</FL>
          <select value={versionRelease} onChange={e => setVersionRelease(e.target.value)} style={selectStyle}>
            <option value="AMH 7.0">AMH 7.0</option>
            <option value="AMH 6.0">AMH 6.0</option>
            <option value="TCM R12.0">TCM R12.0</option>
          </select>
        </div>
        <div>
          <FL>File name</FL>
          <input value={fileName} onChange={e => setFileName(e.target.value)} style={inputStyle} />
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <FL>PSV text (header row + data rows, pipe-delimited, double-quote qualified)</FL>
        <textarea
          value={psvText}
          onChange={e => setPsvText(e.target.value)}
          rows={10}
          placeholder={'CNDS ID|Maintenance Type Code|Priority Population 1|PHP Risk Score Category|...\n"900000001"|"021"|"006"|"M"|...'}
          style={{ ...inputStyle, fontFamily: "monospace", fontSize: 11 }}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" disabled={saving} onClick={save}>{saving ? "Saving + parsing..." : "Save + parse"}</Btn>
      </div>
    </Modal>
  );
}

// --- New Export Modal ---------------------------------------------------------
function NewExportModal({ practiceId, onClose, onCreated }) {
  const [plans, setPlans] = useState([]);
  const [planCode, setPlanCode]     = useState("");
  const [fileType, setFileType]     = useState("TCM Tailored Plan");
  const [reportingMonth, setMonth]  = useState(() => {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-01";
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);

  useEffect(() => {
    supabase
      .from("cm_reference_codes")
      .select("code, label, metadata")
      .eq("category", "prl_plan_short_name")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .then(({ data }) => setPlans(data || []));
  }, []);

  const save = async () => {
    if (!planCode) { setError("Pick a target plan"); return; }
    setSaving(true);
    setError(null);
    try {
      const selected = plans.find(p => p.code === planCode);
      const { error } = await supabase
        .from("cm_prl_exports")
        .insert({
          practice_id:            practiceId,
          file_type:              fileType,
          full_or_incremental:    "Full",
          reporting_month:        reportingMonth,
          target_plan_short_name: planCode,
          target_php_id:          "PENDING",
          target_php_name:        selected ? selected.label : null,
          status:                 "Draft",
        });
      if (error) throw error;
      onCreated();
    } catch (e) {
      setError(e.message || "Failed to create export");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="New PRL export" onClose={onClose} width={520}>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <FL>File type</FL>
          <select value={fileType} onChange={e => setFileType(e.target.value)} style={selectStyle}>
            <option value="AMH Standard Plan">AMH Standard Plan</option>
            <option value="TCM Tailored Plan">TCM Tailored Plan</option>
          </select>
        </div>
        <div>
          <FL>Target plan</FL>
          <select value={planCode} onChange={e => setPlanCode(e.target.value)} style={selectStyle}>
            <option value="">-- Select --</option>
            {plans.map(p => (
              <option key={p.code} value={p.code}>{p.code} - {p.label}</option>
            ))}
          </select>
        </div>
        <div>
          <FL>Reporting month (first-of-month)</FL>
          <input type="date" value={reportingMonth} onChange={e => setMonth(e.target.value)} style={inputStyle} />
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" disabled={saving} onClick={save}>{saving ? "Saving..." : "Create draft"}</Btn>
      </div>
    </Modal>
  );
}
