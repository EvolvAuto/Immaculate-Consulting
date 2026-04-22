import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../auth/AuthProvider";
import { C } from "../lib/tokens";
import {
  Badge, Btn, Card, Modal, Loader, EmptyState, ErrorBanner,
  SectionHead, FL, TabBar
} from "../components/ui";
import { stalenessBand, isBillableProgram, isPastBillingRiskDay } from "../lib/cmCadence";

// ===============================================================================
// CareManagementView - entry point for the Care Management Console (Command tier)
//
// Six tabs:
//   1. Registry            - enrollments list, acuity filter, program breakdown
//   2. Touchpoints         - contact log, role-aware activity filter
//   3. Plans               - care plans with AI-draft review gate indicator
//   4. Billing Readiness   - monthly billing_periods with readiness status
//   5. CHW Coordination    - CHW-to-CM assignments, FTE gauge
//   6. PRL                 - inbound reconciliation queue + outbound builder
//
// THIS FILE ships the shell + fully-wired PRL tab. Other 5 tabs are stubs
// with "Coming next session" content - schema is ready, UX needs design pass.
// ===============================================================================

const TAB_KEYS = ["registry", "touchpoints", "plans", "billing", "chw", "prl"];
const TAB_META = {
  registry:    { label: "Registry",           icon: "\u25A3" },
  touchpoints: { label: "Touchpoints",        icon: "\u25C9" },
  plans:       { label: "Plans",              icon: "\u25A4" },
  billing:     { label: "Billing Readiness",  icon: "\u25A5" },
  chw:         { label: "CHW Coordination",   icon: "\u25C8" },
  prl:         { label: "PRL",                icon: "\u25A6" },
};

const CM_ROLES = new Set([
  "Owner",
  "Manager",
  "Care Manager",
  "Supervising Care Manager",
  "Care Manager Supervisor",
]);

export default function CareManagementView() {
  const { profile } = useAuth();
  const role = profile?.role;
  const canAccess = role && (CM_ROLES.has(role) || role === "CHW");
  const [tab, setTab] = useState("prl"); // Default to PRL since it's fully wired

  // Unauthorized roles see a polite block instead of the console
  if (!canAccess) {
    return (
      <div style={{ padding: 32 }}>
        <SectionHead title="Care Management" />
        <Card style={{ marginTop: 16, padding: 24, textAlign: "center" }}>
          <div style={{ fontSize: 15, color: C.textSecondary, marginBottom: 8 }}>
            The Care Management Console is available to Care Managers, Supervising Care Managers, CHWs, Owners, and Managers.
          </div>
          <div style={{ fontSize: 13, color: C.textTertiary }}>
            Current role: {role || "Unknown"}. Contact your practice owner if you believe this is incorrect.
          </div>
        </Card>
      </div>
    );
  }

  // CHW role: only see a limited view of Registry + Touchpoints (no PRL, no Billing, no Plans)
  const visibleTabs = role === "CHW"
    ? ["registry", "touchpoints", "chw"]
    : TAB_KEYS;

  // Keep tab valid for role
  useEffect(() => {
    if (!visibleTabs.includes(tab)) setTab(visibleTabs[0]);
  }, [role]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ padding: "16px 24px 0", borderBottom: "0.5px solid " + C.borderLight, background: C.bgPrimary }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: C.textPrimary, letterSpacing: "-0.01em" }}>
              Care Management
            </div>
            <div style={{ fontSize: 13, color: C.textSecondary, marginTop: 2 }}>
              {role === "CHW"
                ? "Your directed caseload and engagement touchpoints"
                : "Enrollments, touchpoints, plans, billing readiness, and PRL exchange"}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {visibleTabs.map(k => (
            <TabButton key={k} active={tab === k} onClick={() => setTab(k)}>
              <span style={{ marginRight: 6, opacity: 0.7 }}>{TAB_META[k].icon}</span>
              {TAB_META[k].label}
            </TabButton>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 24, background: C.bgTertiary }}>
        {tab === "registry"    && <RegistryTab />}
        {tab === "touchpoints" && <TouchpointsTab />}
        {tab === "plans"       && <PlansTab />}
        {tab === "billing"     && <BillingTab />}
        {tab === "chw"         && <CHWTab />}
        {tab === "prl"         && <PRLTab />}
      </div>
    </div>
  );
}

// --- Local Tab Button ---------------------------------------------------------
function TabButton({ active, children, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "10px 16px",
        fontSize: 13,
        fontWeight: 600,
        fontFamily: "inherit",
        border: "none",
        cursor: "pointer",
        background: "transparent",
        color: active ? C.teal : C.textSecondary,
        borderBottom: active ? "2px solid " + C.teal : "2px solid transparent",
        marginBottom: -1,
        transition: "color 0.15s, border-color 0.15s",
      }}
    >
      {children}
    </button>
  );
}

// ===============================================================================
// PRL TAB - fully wired
// ===============================================================================

function PRLTab() {
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

function SubTabButton({ active, children, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "7px 14px",
        fontSize: 12,
        fontWeight: 600,
        fontFamily: "inherit",
        borderRadius: 8,
        border: "0.5px solid " + (active ? C.teal : C.borderLight),
        background: active ? C.tealBg : C.bgPrimary,
        color: active ? C.teal : C.textSecondary,
        cursor: "pointer",
        transition: "all 0.15s",
      }}
    >
      {children}
    </button>
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
    setRunning(slug === "prl-parse" ? "parse" : "match");
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
  const [generating, setGenerating] = useState(null); // export id currently generating

  const load = useCallback(async () => {
    if (!practiceId) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from("cm_prl_exports")
        .select("id, file_type, reporting_month, target_plan_short_name, target_php_name, status, record_count, version_release, file_name, generated_at, transmitted_at, notes")
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
                    {(ex.status === "Draft" || ex.status === "Ready") && (
                      <Btn size="sm" variant="outline" disabled={generating === ex.id} onClick={() => generate(ex.id)}>
                        {generating === ex.id ? "Generating..." : (ex.status === "Draft" ? "Generate" : "Regenerate")}
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
    </div>
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

// ===============================================================================
// PLACEHOLDER TABS (Registry, Touchpoints, Plans, Billing, CHW)
// Schema is ready; UX needs a design pass. Stubs below so the shell still works.
// ===============================================================================

function ComingSoonTab({ title, description, schemaNote }) {
  return (
    <Card style={{ padding: 32, textAlign: "center" }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: C.textPrimary, marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 14, color: C.textSecondary, marginBottom: 16, maxWidth: 560, margin: "0 auto 16px" }}>{description}</div>
      <div style={{ fontSize: 12, color: C.textTertiary, fontStyle: "italic", fontFamily: "monospace" }}>{schemaNote}</div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// RegistryTab - caseload view for Care Managers
// Shows active enrollments with acuity tier, program, assigned CM, last
// touchpoint date, HOP flag, and a "days since last contact" computed column
// that flags stale engagement. Filterable by acuity, program, and status.
// ---------------------------------------------------------------------------

function RegistryTab() {
  const { profile } = useAuth();
  const practiceId = profile?.practice_id;

  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [rows, setRows]         = useState([]);
  const [acuityFilter, setAcuityFilter]   = useState("all");
  const [programFilter, setProgramFilter] = useState("all");
  const [statusFilter, setStatusFilter]   = useState("Active");
  const [selected, setSelected]           = useState(null);

  const load = useCallback(async () => {
    if (!practiceId) return;
    setLoading(true);
    setError(null);
    try {
      // Fetch enrollments + patient names in one call via the embedded FK select.
      const { data: enrollments, error: e1 } = await supabase
        .from("cm_enrollments")
        .select("id, patient_id, program_type, enrollment_status, acuity_tier, payer_name, plan_member_id, enrolled_at, assigned_at, disenrolled_at, disenrollment_reason_code, assigned_care_manager_id, hop_eligible, hop_active, patients(first_name, last_name, date_of_birth)")
        .eq("practice_id", practiceId)
        .order("enrollment_status", { ascending: true })
        .order("acuity_tier",        { ascending: true })
        .order("enrolled_at",        { ascending: false });
      if (e1) throw e1;

      // For each enrollment, pull the max touchpoint_at. Single aggregate query
      // rather than per-row fetches - cheap and keeps the UI snappy.
      const enrIds = (enrollments || []).map(e => e.id);
      let lastTpMap = {};
      if (enrIds.length > 0) {
        const { data: tps, error: e2 } = await supabase
          .from("cm_touchpoints")
          .select("enrollment_id, touchpoint_at, successful_contact")
          .in("enrollment_id", enrIds)
          .order("touchpoint_at", { ascending: false });
        if (e2) throw e2;
        // Group manually - pick latest successful per enrollment, fall back to
        // latest attempt if no successful exists.
        // Compute first day of current calendar month (for billing-floor tracking)
        const now0 = new Date();
        const monthStart = new Date(Date.UTC(now0.getUTCFullYear(), now0.getUTCMonth(), 1));

        for (const tp of tps || []) {
          const cur = lastTpMap[tp.enrollment_id];
          if (!cur) {
            lastTpMap[tp.enrollment_id] = {
              last_at: tp.touchpoint_at,
              last_successful_at: tp.successful_contact ? tp.touchpoint_at : null,
              successful_this_month: tp.successful_contact && new Date(tp.touchpoint_at) >= monthStart,
            };
          } else {
            if (tp.successful_contact && !cur.last_successful_at) {
              cur.last_successful_at = tp.touchpoint_at;
            }
            if (tp.successful_contact && new Date(tp.touchpoint_at) >= monthStart) {
              cur.successful_this_month = true;
            }
          }
        }
      }

      // Merge and compute days-since + enrollment-age (for Pending staleness rule)
      const now = new Date();
      const merged = (enrollments || []).map(e => {
        const tp = lastTpMap[e.id] || {};
        const lastAt = tp.last_successful_at || tp.last_at || null;
        const days = lastAt ? Math.floor((now - new Date(lastAt)) / (1000 * 60 * 60 * 24)) : null;
        // Days since enrollment was created - used for Pending staleness.
        const enrolledAt = e.enrolled_at ? new Date(e.enrolled_at) : null;
        const daysSinceEnrolled = enrolledAt ? Math.floor((now - enrolledAt) / (1000 * 60 * 60 * 24)) : null;
        return {
          ...e,
          last_touchpoint_at: lastAt,
          days_since_contact: days,
          days_since_enrolled: daysSinceEnrolled,
          has_contact_this_month: !!tp.successful_this_month,
        };
      });
      setRows(merged);
    } catch (err) {
      setError(err.message || "Failed to load registry");
    } finally {
      setLoading(false);
    }
  }, [practiceId]);

  useEffect(() => { load(); }, [load]);

  // Compute filter + KPI values against the loaded rows
  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (statusFilter  !== "all" && r.enrollment_status !== statusFilter)  return false;
      if (acuityFilter  !== "all" && r.acuity_tier       !== acuityFilter)  return false;
      if (programFilter !== "all" && r.program_type      !== programFilter) return false;
      return true;
    });
  }, [rows, statusFilter, acuityFilter, programFilter]);

  const kpis = useMemo(() => {
    const active  = rows.filter(r => r.enrollment_status === "Active");
    const pending = rows.filter(r => r.enrollment_status === "Pending");

    // needsAttention = Active rows in Amber or Red band per acuity-aware thresholds
    //                  UNION Pending rows 14+ days old with no successful contact (Rule B)
    //                  UNION Active rows with 0 successful contacts this calendar month
    //                        once we are past day 20 of the month (billing at risk).
    // See stalenessBand() for threshold rationale. These numbers are calibrated against
    // the TCM Provider Manual (monthly billing floor + 3-contacts/month rate assumption).
    const pastDay20 = isPastBillingRiskDay();
    const needsAttention = new Set();

    for (const r of active) {
      const band = stalenessBand(r.acuity_tier, r.days_since_contact, r.program_type);
      if (band === "amber" || band === "red") needsAttention.add(r.id);
      // BILL RISK only counts for programs with a monthly billing floor.
      if (pastDay20 && !r.has_contact_this_month && isBillableProgram(r.program_type)) {
        needsAttention.add(r.id);
      }
    }
    for (const r of pending) {
      const tooOld = r.days_since_enrolled !== null && r.days_since_enrolled >= 14;
      const noSuccess = !r.last_touchpoint_at || r.days_since_contact === null;
      // If pending 14+ days AND no last contact at all, flag as outreach overdue.
      // (If they have any contact, even an attempt, we respect that and do not flag yet.)
      if (tooOld && noSuccess) needsAttention.add(r.id);
    }

    const billingAtRisk = active.filter(r => pastDay20 && !r.has_contact_this_month && isBillableProgram(r.program_type)).length;

    return {
      total:           rows.length,
      active:          active.length,
      high:            active.filter(r => r.acuity_tier === "High").length,
      moderate:        active.filter(r => r.acuity_tier === "Moderate").length,
      low:             active.filter(r => r.acuity_tier === "Low").length,
      pending:         pending.length,
      stale:           needsAttention.size,
      billing_at_risk: billingAtRisk,
      hop:             active.filter(r => r.hop_active).length,
    };
  }, [rows]);

  if (loading) return <Loader label="Loading caseload..." />;

  return (
    <div>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
        <KpiCard label="Active caseload"  value={kpis.active}   hint={kpis.pending + " pending enrollment"} />
        <KpiCard label="High acuity"      value={kpis.high}     hint="Active enrollments"  variant="amber" />
        <KpiCard label="Needs attention"  value={kpis.stale}    hint={kpis.billing_at_risk > 0 ? (kpis.billing_at_risk + " at billing risk this month") : "Overdue vs acuity-tier cadence"} variant={kpis.stale > 0 ? "amber" : "neutral"} />
        <KpiCard label="HOP active"       value={kpis.hop}      hint="HRSN interventions"  variant="blue" />
      </div>

      {/* Filter bar */}
      <Card style={{ padding: 12, marginBottom: 16, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textTertiary }}>Status</span>
          <FilterPill active={statusFilter === "Active"}      onClick={() => setStatusFilter("Active")}>Active</FilterPill>
          <FilterPill active={statusFilter === "Pending"}     onClick={() => setStatusFilter("Pending")}>Pending</FilterPill>
          <FilterPill active={statusFilter === "Disenrolled"} onClick={() => setStatusFilter("Disenrolled")}>Disenrolled</FilterPill>
          <FilterPill active={statusFilter === "all"}         onClick={() => setStatusFilter("all")}>All</FilterPill>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textTertiary }}>Acuity</span>
          <FilterPill active={acuityFilter === "all"}      onClick={() => setAcuityFilter("all")}>All</FilterPill>
          <FilterPill active={acuityFilter === "High"}     onClick={() => setAcuityFilter("High")}>High</FilterPill>
          <FilterPill active={acuityFilter === "Moderate"} onClick={() => setAcuityFilter("Moderate")}>Moderate</FilterPill>
          <FilterPill active={acuityFilter === "Low"}      onClick={() => setAcuityFilter("Low")}>Low</FilterPill>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textTertiary }}>Program</span>
          <select value={programFilter} onChange={e => setProgramFilter(e.target.value)} style={{ ...selectStyle, width: "auto", minWidth: 150 }}>
            <option value="all">All programs</option>
            <option value="TCM">TCM</option>
            <option value="AMH Plus">AMH Plus</option>
            <option value="AMH Tier 3">AMH Tier 3</option>
            <option value="CMA">CMA</option>
            <option value="CIN CM">CIN CM</option>
            <option value="General Engagement">General Engagement</option>
          </select>
        </div>
        <Btn variant="outline" size="sm" onClick={load} style={{ marginLeft: "auto" }}>Refresh</Btn>
      </Card>

      {/* Registry table */}
      {filtered.length === 0 ? (
        <EmptyState
          title={rows.length === 0 ? "No enrollments yet" : "No matching enrollments"}
          message={rows.length === 0
            ? "Create your first Care Management enrollment to build the caseload. Enrollment creation UI is on the roadmap - for now, enrollments are seeded via database or PRL import."
            : "Try relaxing the filters above. You can also view Disenrolled records for historical context."}
        />
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead style={{ background: C.bgSecondary, borderBottom: "0.5px solid " + C.borderLight }}>
              <tr>
                <Th>Patient</Th>
                <Th>Program</Th>
                <Th>Acuity</Th>
                <Th>Status</Th>
                <Th>Payer</Th>
                <Th align="right">Last contact</Th>
                <Th align="right">Days</Th>
                <Th>Flags</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, idx) => (
                <tr key={r.id} onClick={() => setSelected(r)} style={{
                  borderBottom: idx < filtered.length - 1 ? "0.5px solid " + C.borderLight : "none",
                  cursor: "pointer",
                  background: selected?.id === r.id ? C.tealBg : "transparent",
                }}>
                  <Td>
                    <div style={{ fontWeight: 600 }}>{r.patients?.last_name || ""}, {r.patients?.first_name || ""}</div>
                    {r.plan_member_id && <div style={{ fontSize: 11, color: C.textTertiary, fontFamily: "monospace", marginTop: 2 }}>{r.plan_member_id}</div>}
                  </Td>
                  <Td>{r.program_type}</Td>
                  <Td><AcuityBadge tier={r.acuity_tier} /></Td>
                  <Td><StatusBadge status={r.enrollment_status} /></Td>
                  <Td style={{ fontSize: 12 }}>{r.payer_name}</Td>
                  <Td align="right" style={{ fontSize: 12, color: C.textSecondary }}>
                    {r.last_touchpoint_at ? new Date(r.last_touchpoint_at).toLocaleDateString() : "-"}
                  </Td>
                  <Td align="right">
                    <StaleDaysBadge days={r.days_since_contact} status={r.enrollment_status} acuity={r.acuity_tier} programType={r.program_type} />
                  </Td>
                  <Td>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {r.enrollment_status === "Active" && !r.has_contact_this_month && isPastBillingRiskDay() && isBillableProgram(r.program_type) && (
                        <Badge label="BILL RISK" variant="red" size="xs" />
                      )}
                      {r.hop_active && <Badge label="HOP" variant="blue" size="xs" />}
                      {r.hop_eligible && !r.hop_active && <Badge label="HOP eligible" variant="neutral" size="xs" />}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {selected && (
        <EnrollmentDetail enrollment={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

// Sub-component: acuity-tier color-coded badge
function AcuityBadge({ tier }) {
  const map = { High: "red", Moderate: "amber", Low: "green" };
  return <Badge label={tier || "-"} variant={map[tier] || "neutral"} size="xs" />;
}

// Sub-component: days-since badge with acuity-aware + program-aware coloring.
// Staleness logic lives in src/lib/cmCadence.js - see that module for the
// policy grounding (TCM Provider Manual Section 4.2 + footnote 35) and for
// per-program threshold tables. Disenrolled rows do not show staleness.
function StaleDaysBadge({ days, status, acuity, programType }) {
  if (status === "Disenrolled") return <span style={{ color: C.textTertiary }}>-</span>;
  if (days === null || days === undefined) return <Badge label="No contact" variant="amber" size="xs" />;
  const band = stalenessBand(acuity, days, programType);
  const variant = band === "red" ? "red" : band === "amber" ? "amber" : "green";
  return <Badge label={days + "d"} variant={variant} size="xs" />;
}

// Sub-component: filter pill button
function FilterPill({ active, children, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: "5px 12px",
      fontSize: 12,
      fontWeight: 600,
      fontFamily: "inherit",
      border: "0.5px solid " + (active ? C.teal : C.borderLight),
      background: active ? C.tealBg : C.bgPrimary,
      color: active ? C.teal : C.textSecondary,
      borderRadius: 16,
      cursor: "pointer",
      transition: "all 0.15s",
    }}>{children}</button>
  );
}

// Sub-component: enrollment detail modal. Read-only for now - edit flows
// (update acuity, disenroll, reassign CM) come in the next session.
function EnrollmentDetail({ enrollment, onClose }) {
  const [touchpoints, setTouchpoints] = useState([]);
  const [loading, setLoading]         = useState(true);

  useEffect(() => {
    supabase
      .from("cm_touchpoints")
      .select("id, touchpoint_at, contact_method, successful_contact, delivered_by_role, activity_category_code, notes")
      .eq("enrollment_id", enrollment.id)
      .order("touchpoint_at", { ascending: false })
      .limit(50)
      .then(({ data }) => { setTouchpoints(data || []); setLoading(false); });
  }, [enrollment.id]);

  const title = (enrollment.patients?.first_name || "") + " " + (enrollment.patients?.last_name || "");

  return (
    <Modal title={"Enrollment: " + title} onClose={onClose} width={760}>
      {/* Summary row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        <DetailField label="Program"      value={enrollment.program_type} />
        <DetailField label="Acuity"       value={<AcuityBadge tier={enrollment.acuity_tier} />} />
        <DetailField label="Status"       value={<StatusBadge status={enrollment.enrollment_status} />} />
        <DetailField label="Enrolled"     value={enrollment.enrolled_at ? new Date(enrollment.enrolled_at).toLocaleDateString() : "-"} />
        <DetailField label="Payer"        value={enrollment.payer_name} />
        <DetailField label="Plan member #" value={enrollment.plan_member_id || "-"} monospace />
        <DetailField label="Assigned CM"  value={enrollment.assigned_care_manager_id ? "Set" : "Unassigned"} />
        <DetailField label="HOP"          value={enrollment.hop_active ? "Active" : (enrollment.hop_eligible ? "Eligible" : "No")} />
      </div>

      {enrollment.enrollment_status === "Disenrolled" && (
        <div style={{ padding: 12, marginBottom: 16, background: C.redBg, border: "0.5px solid " + C.redBorder, borderRadius: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.red, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Disenrolled</div>
          <div style={{ fontSize: 13, color: C.textPrimary }}>
            {enrollment.disenrollment_reason_code || "reason unspecified"}
            {enrollment.disenrolled_at && <span style={{ color: C.textSecondary }}> on {new Date(enrollment.disenrolled_at).toLocaleDateString()}</span>}
          </div>
        </div>
      )}

      {/* Touchpoint history */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 8 }}>
          Touchpoint history ({touchpoints.length})
        </div>
        {loading ? (
          <Loader label="Loading touchpoints..." />
        ) : touchpoints.length === 0 ? (
          <EmptyState title="No touchpoints yet" message="Log the first contact with this patient from the Touchpoints tab." />
        ) : (
          <div style={{ border: "0.5px solid " + C.borderLight, borderRadius: 8, maxHeight: 320, overflow: "auto" }}>
            {touchpoints.map((tp, i) => (
              <div key={tp.id} style={{
                padding: "10px 12px",
                borderBottom: i < touchpoints.length - 1 ? "0.5px solid " + C.borderLight : "none",
                background: tp.successful_contact ? "transparent" : C.amberBg,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>
                    {new Date(tp.touchpoint_at).toLocaleString()}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <Badge label={tp.contact_method} variant="teal" size="xs" />
                    <Badge label={tp.delivered_by_role} variant="purple" size="xs" />
                    {!tp.successful_contact && <Badge label="Attempt" variant="amber" size="xs" />}
                  </div>
                </div>
                {tp.notes && <div style={{ fontSize: 12, color: C.textSecondary }}>{tp.notes}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

// Sub-component: labeled detail field for the enrollment modal
function DetailField({ label, value, monospace }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textTertiary, marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 13, color: C.textPrimary, fontFamily: monospace ? "monospace" : "inherit" }}>{value || "-"}</div>
    </div>
  );
}
// ---------------------------------------------------------------------------
// TouchpointsTab - contact log view for Care Managers and CHWs.
//
// Shows all touchpoints logged for the practice, filterable by date range,
// patient name, care manager, program, and success status. Role-aware:
//   - CHW sees only their own touchpoints (delivered_by_user_id = self)
//   - Care Managers / Supervisors see all practice touchpoints
//
// Append-only: v1 does not allow edit or delete. This matches TCM Provider
// Manual audit expectations (records retention + HIPAA) - mutating touchpoint
// history would break the billing trail.
// ---------------------------------------------------------------------------

// Values must match the cm_contact_method Postgres enum exactly.
const CONTACT_METHODS = [
  "In Person",
  "Telephonic",
  "Video",
  "Secure Message",
  "Letter",
  "Email",
  "Attempt - No Contact",
];

// Methods that count toward the TCM monthly billing floor when successful.
// Per TCM Provider Manual Section 4.2: qualifying contacts are member-facing
// interactions (in-person, telephonic, or two-way audio/video). Letter, email,
// and secure message do not qualify; attempts with no contact never qualify.
const TCM_QUALIFYING_METHODS = new Set(["In Person", "Telephonic", "Video"]);

// HOP HRSN domains used across PracticeOS (matches hrsn_referral_drafts.domain
// values). These are stored in cm_touchpoints.hrsn_domains_addressed as text[].
const HOP_DOMAINS = [
  { code: "food_insecurity",     label: "Food insecurity" },
  { code: "housing_instability", label: "Housing instability" },
  { code: "housing_quality",     label: "Housing quality" },
  { code: "transportation",      label: "Transportation" },
  { code: "utilities",           label: "Utilities" },
  { code: "interpersonal_safety", label: "Interpersonal safety" },
];

const DATE_RANGE_PRESETS = [
  { key: "7d",    label: "Last 7 days",  days: 7 },
  { key: "30d",   label: "Last 30 days", days: 30 },
  { key: "month", label: "This month",   days: null },
  { key: "all",   label: "All time",     days: null },
];

function TouchpointsTab() {
  const { profile } = useAuth();
  const practiceId = profile?.practice_id;
  const role       = profile?.role;
  const isCHW      = role === "CHW";

  const [loading, setLoading]               = useState(true);
  const [error, setError]                   = useState(null);
  const [touchpoints, setTouchpoints]       = useState([]);
  const [selectedTp, setSelectedTp]         = useState(null);
  const [showLogModal, setShowLogModal]     = useState(false);
  const [careManagers, setCareManagers]     = useState([]);

  // Filter state
  const [dateRange, setDateRange]           = useState("30d");
  const [patientFilter, setPatientFilter]   = useState("");
  const [cmFilter, setCmFilter]             = useState("all");
  const [programFilter, setProgramFilter]   = useState("all");
  const [successfulOnly, setSuccessfulOnly] = useState(false);

  const load = useCallback(async () => {
    if (!practiceId) return;
    setLoading(true);
    setError(null);
    try {
      // Compute cutoff timestamp for date filter
      let cutoffIso = null;
      const now = new Date();
      if (dateRange === "7d") {
        cutoffIso = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      } else if (dateRange === "30d") {
        cutoffIso = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      } else if (dateRange === "month") {
        cutoffIso = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
      }

      // Single query with embeds: cm_enrollments for program/acuity,
      // patients for name. logged_by_user is pulled separately to avoid
      // RLS issues on the users table cross-scope.
      let query = supabase
        .from("cm_touchpoints")
        .select("id, touchpoint_at, contact_method, successful_contact, delivered_by_role, activity_category_code, notes, enrollment_id, patient_id, delivered_by_user_id, hrsn_domains_addressed, counts_toward_tcm_contact, cm_enrollments(program_type, acuity_tier), patients(first_name, last_name)")
        .eq("practice_id", practiceId)
        .order("touchpoint_at", { ascending: false })
        .limit(200);

      if (cutoffIso)          query = query.gte("touchpoint_at", cutoffIso);
      if (cmFilter !== "all") query = query.eq("delivered_by_user_id", cmFilter);
      if (successfulOnly)     query = query.eq("successful_contact", true);
      // CHW can only see their own touchpoints
      if (isCHW && profile?.id) query = query.eq("delivered_by_user_id", profile.id);

      const { data, error: qErr } = await query;
      if (qErr) throw qErr;

      // Client-side filter for patient name (cannot filter on embedded field server-side cleanly)
      let filtered = data || [];
      if (patientFilter.trim()) {
        const q = patientFilter.trim().toLowerCase();
        filtered = filtered.filter(t => {
          const name = ((t.patients?.first_name || "") + " " + (t.patients?.last_name || "")).toLowerCase();
          return name.includes(q);
        });
      }
      if (programFilter !== "all") {
        filtered = filtered.filter(t => t.cm_enrollments?.program_type === programFilter);
      }

      setTouchpoints(filtered);
    } catch (e) {
      setError(e.message || "Failed to load touchpoints");
    } finally {
      setLoading(false);
    }
  }, [practiceId, isCHW, profile?.id, dateRange, cmFilter, successfulOnly, patientFilter, programFilter]);

  useEffect(() => { load(); }, [load]);

  // Load care managers list for filter dropdown (hidden for CHW)
  useEffect(() => {
    if (!practiceId || isCHW) return;
    supabase
      .from("users")
      .select("id, full_name, role")
      .eq("practice_id", practiceId)
      .in("role", ["Care Manager", "Supervising Care Manager", "Care Manager Supervisor", "CHW"])
      .order("full_name", { ascending: true })
      .then(({ data }) => setCareManagers(data || []));
  }, [practiceId, isCHW]);

  // KPIs computed over the currently loaded/filtered set
  const kpis = useMemo(() => {
    const successful = touchpoints.filter(t => t.successful_contact);
    const uniquePatients = new Set(successful.map(t => t.patient_id));
    return {
      total:      touchpoints.length,
      successful: successful.length,
      attempts:   touchpoints.length - successful.length,
      patients:   uniquePatients.size,
    };
  }, [touchpoints]);

  if (loading && touchpoints.length === 0) return <Loader label="Loading touchpoints..." />;

  return (
    <div>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
        <KpiCard label="Touchpoints shown" value={kpis.total}      hint="Matching current filters" />
        <KpiCard label="Successful"        value={kpis.successful} hint="Qualifying contacts"    variant="blue" />
        <KpiCard label="Attempts only"     value={kpis.attempts}   hint="No-contact attempts"    variant={kpis.attempts > 0 ? "amber" : "neutral"} />
        <KpiCard label="Unique patients"   value={kpis.patients}   hint="Patients touched"       />
      </div>

      {/* Filter bar */}
      <Card style={{ padding: 12, marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textTertiary }}>Period</span>
            {DATE_RANGE_PRESETS.map(p => (
              <FilterPill key={p.key} active={dateRange === p.key} onClick={() => setDateRange(p.key)}>{p.label}</FilterPill>
            ))}
          </div>
          <Btn variant="primary" size="md" onClick={() => setShowLogModal(true)} style={{ marginLeft: "auto" }}>
            + Log touchpoint
          </Btn>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 220px", minWidth: 220 }}>
            <input
              type="text"
              value={patientFilter}
              onChange={e => setPatientFilter(e.target.value)}
              placeholder="Search by patient name..."
              style={{ ...inputStyle, width: "100%" }}
            />
          </div>
          {!isCHW && (
            <select value={cmFilter} onChange={e => setCmFilter(e.target.value)} style={{ ...selectStyle, width: "auto", minWidth: 180 }}>
              <option value="all">All team members</option>
              {careManagers.map(cm => (
                <option key={cm.id} value={cm.id}>{cm.full_name} ({cm.role})</option>
              ))}
            </select>
          )}
          <select value={programFilter} onChange={e => setProgramFilter(e.target.value)} style={{ ...selectStyle, width: "auto", minWidth: 150 }}>
            <option value="all">All programs</option>
            <option value="TCM">TCM</option>
            <option value="AMH Plus">AMH Plus</option>
            <option value="AMH Tier 3">AMH Tier 3</option>
            <option value="CMA">CMA</option>
            <option value="CIN CM">CIN CM</option>
            <option value="General Engagement">General Engagement</option>
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.textSecondary, cursor: "pointer" }}>
            <input type="checkbox" checked={successfulOnly} onChange={e => setSuccessfulOnly(e.target.checked)} />
            Successful only
          </label>
          <Btn variant="outline" size="sm" onClick={load}>Refresh</Btn>
        </div>
      </Card>

      {/* Touchpoints table */}
      {touchpoints.length === 0 ? (
        <EmptyState
          title="No touchpoints found"
          message={isCHW
            ? "You have not logged any touchpoints in this period yet. Use + Log touchpoint to record your first contact."
            : "No touchpoints match the current filters. Try a wider date range, or relax the filters above."}
        />
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead style={{ background: C.bgSecondary, borderBottom: "0.5px solid " + C.borderLight }}>
              <tr>
                <Th>Date/Time</Th>
                <Th>Patient</Th>
                <Th>Program</Th>
                <Th>Method</Th>
                <Th>Activity</Th>
                <Th>Role</Th>
                <Th>Outcome</Th>
              </tr>
            </thead>
            <tbody>
              {touchpoints.map((tp, idx) => (
                <tr
                  key={tp.id}
                  onClick={() => setSelectedTp(tp)}
                  style={{
                    borderBottom: idx < touchpoints.length - 1 ? "0.5px solid " + C.borderLight : "none",
                    cursor: "pointer",
                    background: selectedTp?.id === tp.id ? C.tealBg : "transparent",
                  }}
                >
                  <Td style={{ fontSize: 12 }}>{formatTouchpointTime(tp.touchpoint_at)}</Td>
                  <Td>
                    <div style={{ fontWeight: 600 }}>
                      {(tp.patients?.last_name || "") + ", " + (tp.patients?.first_name || "")}
                    </div>
                  </Td>
                  <Td style={{ fontSize: 12 }}>{tp.cm_enrollments?.program_type || "-"}</Td>
                  <Td><Badge label={tp.contact_method} variant="teal" size="xs" /></Td>
                  <Td style={{ fontSize: 12, color: C.textSecondary }}>
                    {tp.activity_category_code || "-"}
                  </Td>
                  <Td><Badge label={tp.delivered_by_role || "-"} variant="purple" size="xs" /></Td>
                  <Td>
                    {tp.successful_contact
                      ? <Badge label="Successful" variant="green" size="xs" />
                      : <Badge label="Attempt" variant="amber" size="xs" />}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {selectedTp && (
        <TouchpointDetailModal touchpoint={selectedTp} onClose={() => setSelectedTp(null)} />
      )}
      {showLogModal && (
        <LogTouchpointModal
          practiceId={practiceId}
          userId={profile?.id}
          userRole={role}
          onClose={() => setShowLogModal(false)}
          onLogged={() => { setShowLogModal(false); load(); }}
        />
      )}
    </div>
  );
}

// Formatting helper: if touchpoint is today, show time only; else show date.
function formatTouchpointTime(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return "Today " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// ---------------------------------------------------------------------------
// LogTouchpointModal - the "Log touchpoint" form.
//
// Field-by-field policy rationale:
//   - Patient picker: filters to patients with at least one Active or
//     Pending enrollment in this practice. Scopes enrollment automatically
//     if patient has one active enrollment; prompts if multiple.
//   - Contact Method: from cm_contact_method enum (hardcoded list here).
//     "Attempt - No Contact" forces successful=false and disables toggle.
//   - Activity Category: fetched live from cm_reference_codes where
//     category='activity_category'. Enforced by DB FK trigger so this
//     cannot be bypassed client-side anyway.
//   - HRSN Domains: optional multi-select. Shown always - lets CM tag
//     proactive HRSN discussions even outside a formal referral.
//   - Notes: 500 char max. Stored in cm_touchpoints.notes.
//   - Delivered By Role: auto-filled from user's role. No UI field.
// ---------------------------------------------------------------------------

function LogTouchpointModal({ practiceId, userId, userRole, onClose, onLogged }) {
  const [enrolledPatients, setEnrolledPatients] = useState([]);
  const [activityCodes, setActivityCodes]       = useState([]);
  // HRSN domains are hardcoded from HOP spec, not fetched (no reference_codes category for them).
  const hrsnDomains = HOP_DOMAINS;

  const [patientId, setPatientId]           = useState("");
  const [enrollmentId, setEnrollmentId]     = useState("");
  const [availableEnrollments, setAvailableEnrollments] = useState([]);
  const [touchpointAt, setTouchpointAt]     = useState(() => {
    // Default to now, formatted for datetime-local input (YYYY-MM-DDTHH:MM)
    const d = new Date();
    const pad = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  });
  const [contactMethod, setContactMethod]   = useState("Telephonic");
  const [activityCode, setActivityCode]     = useState("");
  const [selectedHrsn, setSelectedHrsn]     = useState([]);
  const [notes, setNotes]                   = useState("");
  const [successful, setSuccessful]         = useState(true);

  const [saving, setSaving]                 = useState(false);
  const [error, setError]                   = useState(null);

  // Derive: if Attempt - No Contact, force successful=false
  useEffect(() => {
    if (contactMethod === "Attempt - No Contact") {
      setSuccessful(false);
    }
  }, [contactMethod]);

  // Load enrolled patients (Active + Pending enrollments in practice)
  useEffect(() => {
    if (!practiceId) return;
    supabase
      .from("cm_enrollments")
      .select("id, patient_id, program_type, acuity_tier, enrollment_status, patients(first_name, last_name, date_of_birth)")
      .eq("practice_id", practiceId)
      .in("enrollment_status", ["Active", "Pending"])
      .order("enrollment_status", { ascending: true })
      .then(({ data }) => setEnrolledPatients(data || []));
  }, [practiceId]);

  // Load activity codes
  useEffect(() => {
    supabase
      .from("cm_reference_codes")
      .select("code, label, metadata, sort_order")
      .eq("category", "activity_category")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .then(({ data, error }) => {
        if (!error && data) setActivityCodes(data);
      });
  }, []);

  // When patient changes, compute available enrollments for that patient
  useEffect(() => {
    if (!patientId) {
      setAvailableEnrollments([]);
      setEnrollmentId("");
      return;
    }
    const matching = enrolledPatients.filter(e => e.patient_id === patientId);
    setAvailableEnrollments(matching);
    if (matching.length === 1) {
      setEnrollmentId(matching[0].id);
    } else {
      setEnrollmentId("");
    }
  }, [patientId, enrolledPatients]);

  // Deduplicated patient list for the picker
  const patientOptions = useMemo(() => {
    const seen = new Map();
    for (const e of enrolledPatients) {
      if (!seen.has(e.patient_id)) {
        seen.set(e.patient_id, {
          id: e.patient_id,
          first_name: e.patients?.first_name || "",
          last_name:  e.patients?.last_name || "",
        });
      }
    }
    return Array.from(seen.values()).sort((a, b) => (a.last_name + a.first_name).localeCompare(b.last_name + b.first_name));
  }, [enrolledPatients]);

  // Group activity codes by metadata.group if present; otherwise flat.
  const groupedActivities = useMemo(() => {
    const groups = {};
    let hasGrouping = false;
    for (const c of activityCodes) {
      const g = (c.metadata && c.metadata.group) || null;
      if (g) hasGrouping = true;
      const key = g || "All activities";
      if (!groups[key]) groups[key] = [];
      groups[key].push(c);
    }
    return { groups, hasGrouping };
  }, [activityCodes]);

  const toggleHrsn = (code) => {
    setSelectedHrsn(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]);
  };

  const save = async () => {
    if (!patientId)       { setError("Select a patient"); return; }
    if (!enrollmentId)    { setError("Select an enrollment (patient has multiple)"); return; }
    if (!touchpointAt)    { setError("Set the contact date/time"); return; }
    if (!contactMethod)   { setError("Select a contact method"); return; }
    if (!activityCode)    { setError("Select an activity category"); return; }
    if (notes.length > 500) { setError("Notes must be 500 characters or fewer"); return; }

    // No future-dated touchpoints
    const when = new Date(touchpointAt);
    if (when.getTime() > Date.now()) { setError("Touchpoints cannot be dated in the future"); return; }

    setSaving(true);
    setError(null);

    // Role mapping to cm_delivered_by_role enum. Best-effort; if user's role
    // does not map cleanly, we default to "Care Manager" since that is the
    // baseline for the cm_touchpoints.delivered_by_role scope trigger.
    // Maps public.users.role to cm_delivery_role enum values.
    // cm_delivery_role values: Care Manager, Supervising Care Manager, Extender,
    // Provider, Pharmacist, Other, CHW.
    const roleMap = {
      "Care Manager":             "Care Manager",
      "Supervising Care Manager": "Supervising Care Manager",
      "Care Manager Supervisor":  "Supervising Care Manager",
      "CHW":                      "CHW",
      "Owner":                    "Other",
      "Manager":                  "Other",
      "Provider":                 "Provider",
    };
    const deliveredByRole = roleMap[userRole] || "Other";

    // Compute derived billing flags.
    // successful_contact: user-specified, forced false if Attempt.
    // counts_toward_tcm_contact: must be a member-facing successful contact.
    //   Per TCM Provider Manual, Secure Message / Letter / Email do NOT count.
    const isSuccessful = contactMethod === "Attempt - No Contact" ? false : successful;
    const countsTowardTcm = isSuccessful && TCM_QUALIFYING_METHODS.has(contactMethod);

    // Build insert payload. All NOT NULL columns must be either provided or
    // have DB defaults. hrsn_domains_addressed is NOT NULL with default '{}',
    // but we always send the array to be explicit about the user's intent.
    const payload = {
      practice_id:               practiceId,
      enrollment_id:             enrollmentId,
      patient_id:                patientId,
      delivered_by_user_id:      userId,
      touchpoint_at:             when.toISOString(),
      contact_method:            contactMethod,
      successful_contact:        isSuccessful,
      counts_toward_tcm_contact: countsTowardTcm,
      delivered_by_role:         deliveredByRole,
      activity_category_code:    activityCode,
      hrsn_domains_addressed:    selectedHrsn,
      notes:                     notes.trim() || null,
      source:                    "Manual",
    };

    try {
      const { error: insErr } = await supabase.from("cm_touchpoints").insert(payload);
      if (insErr) throw insErr;
      onLogged();
    } catch (e) {
      setError(e.message || "Failed to log touchpoint");
      setSaving(false);
    }
  };

  const mustPickEnrollment = availableEnrollments.length > 1 && !enrollmentId;

  return (
    <Modal title="Log touchpoint" onClose={onClose} width={720}>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={{ gridColumn: "1 / -1" }}>
          <FL>Patient</FL>
          <select value={patientId} onChange={e => setPatientId(e.target.value)} style={selectStyle}>
            <option value="">-- Select patient --</option>
            {patientOptions.map(p => (
              <option key={p.id} value={p.id}>{p.last_name}, {p.first_name}</option>
            ))}
          </select>
          {enrolledPatients.length === 0 && (
            <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 4 }}>
              No Active or Pending enrollments in this practice yet. Seed enrollments first.
            </div>
          )}
        </div>

        {mustPickEnrollment && (
          <div style={{ gridColumn: "1 / -1" }}>
            <FL>Which enrollment? (This patient has multiple)</FL>
            <select value={enrollmentId} onChange={e => setEnrollmentId(e.target.value)} style={selectStyle}>
              <option value="">-- Select enrollment --</option>
              {availableEnrollments.map(e => (
                <option key={e.id} value={e.id}>
                  {e.program_type} ({e.acuity_tier}) - {e.enrollment_status}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <FL>Contact date/time</FL>
          <input type="datetime-local" value={touchpointAt} onChange={e => setTouchpointAt(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <FL>Contact method</FL>
          <select value={contactMethod} onChange={e => setContactMethod(e.target.value)} style={selectStyle}>
            {CONTACT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        <div style={{ gridColumn: "1 / -1" }}>
          <FL>Activity category</FL>
          <select value={activityCode} onChange={e => setActivityCode(e.target.value)} style={selectStyle}>
            <option value="">-- Select activity --</option>
            {groupedActivities.hasGrouping
              ? Object.entries(groupedActivities.groups).map(([groupName, codes]) => (
                  <optgroup key={groupName} label={groupName}>
                    {codes.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                  </optgroup>
                ))
              : activityCodes.map(c => <option key={c.code} value={c.code}>{c.label}</option>)
            }
          </select>
          {activityCodes.length === 0 && (
            <div style={{ fontSize: 11, color: C.amber, marginTop: 4 }}>
              Warning: no activity codes loaded. Check that cm_reference_codes has category='activity_category' rows.
            </div>
          )}
        </div>

        {hrsnDomains.length > 0 && (
          <div style={{ gridColumn: "1 / -1" }}>
            <FL>HRSN domains (optional)</FL>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {hrsnDomains.map(d => (
                <button
                  key={d.code}
                  type="button"
                  onClick={() => toggleHrsn(d.code)}
                  style={{
                    padding: "5px 12px",
                    fontSize: 12,
                    fontWeight: 600,
                    fontFamily: "inherit",
                    border: "0.5px solid " + (selectedHrsn.includes(d.code) ? C.teal : C.borderLight),
                    background: selectedHrsn.includes(d.code) ? C.tealBg : C.bgPrimary,
                    color: selectedHrsn.includes(d.code) ? C.teal : C.textSecondary,
                    borderRadius: 16,
                    cursor: "pointer",
                  }}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ gridColumn: "1 / -1" }}>
          <FL>Notes ({notes.length}/500)</FL>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value.slice(0, 500))}
            rows={4}
            placeholder="Clinical observations, topics discussed, follow-up needed..."
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </div>

        <div style={{ gridColumn: "1 / -1", padding: 12, background: contactMethod === "Attempt - No Contact" ? C.amberBg : C.bgSecondary, border: "0.5px solid " + C.borderLight, borderRadius: 8 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: contactMethod === "Attempt - No Contact" ? "not-allowed" : "pointer" }}>
            <input
              type="checkbox"
              checked={successful}
              disabled={contactMethod === "Attempt - No Contact"}
              onChange={e => setSuccessful(e.target.checked)}
            />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>
                Successful contact (counts toward billing + cadence)
              </div>
              <div style={{ fontSize: 11, color: C.textSecondary, marginTop: 2 }}>
                {contactMethod === "Attempt - No Contact"
                  ? "Locked OFF - an attempt with no contact is never billable."
                  : "Turn OFF if you reached voicemail or left a message without engaging the member."}
              </div>
            </div>
          </label>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" disabled={saving} onClick={save}>
          {saving ? "Saving..." : "Log touchpoint"}
        </Btn>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// TouchpointDetailModal - read-only view of a single touchpoint.
// Kept minimal for v1. If future needs require editable touchpoints
// (e.g. addendum/correction workflows), build as a separate modal with a
// clear audit trail rather than mutating in place.
// ---------------------------------------------------------------------------

function TouchpointDetailModal({ touchpoint, onClose }) {
  const tp = touchpoint;
  const patientName = (tp.patients?.first_name || "") + " " + (tp.patients?.last_name || "");

  return (
    <Modal title={"Touchpoint: " + patientName} onClose={onClose} width={600}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, marginBottom: 16 }}>
        <DetailField label="When"     value={new Date(tp.touchpoint_at).toLocaleString()} />
        <DetailField label="Outcome"  value={tp.successful_contact ? "Successful contact" : "Attempt only"} />
        <DetailField label="Method"   value={<Badge label={tp.contact_method} variant="teal" size="xs" />} />
        <DetailField label="Role"     value={<Badge label={tp.delivered_by_role} variant="purple" size="xs" />} />
        <DetailField label="Program"  value={tp.cm_enrollments?.program_type || "-"} />
        <DetailField label="Acuity"   value={<AcuityBadge tier={tp.cm_enrollments?.acuity_tier} />} />
        <DetailField label="Activity" value={tp.activity_category_code || "-"} />
      </div>

      {tp.notes && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textTertiary, marginBottom: 6 }}>Notes</div>
          <div style={{ padding: 12, background: C.bgSecondary, border: "0.5px solid " + C.borderLight, borderRadius: 8, fontSize: 13, color: C.textPrimary, whiteSpace: "pre-wrap" }}>
            {tp.notes}
          </div>
        </div>
      )}

      <div style={{ marginTop: 16, fontSize: 11, color: C.textTertiary, fontStyle: "italic" }}>
        Touchpoints are append-only. To correct this record, log a new touchpoint referencing this one in notes.
      </div>
    </Modal>
  );
}
function PlansTab() {
  return (
    <ComingSoonTab
      title="Plans - Coming next session"
      description="Versioned care plans with AI-draft review gate. Plans drafted by Claude cannot be Active until a human has reviewed. Active-only unique constraint per enrollment + plan_type."
      schemaNote="Tables ready: cm_care_plans (cm_care_plans_ai_review_gate CHECK enforced)"
    />
  );
}
function BillingTab() {
  return (
    <ComingSoonTab
      title="Billing Readiness - Coming next session"
      description="Monthly billing periods dashboard. Acuity + program snapshotted per month. Readiness flags: meets_contact_requirements, has_care_manager_majority, has_duplicative_service. Claim lifecycle tracking."
      schemaNote="Tables ready: cm_billing_periods, cm_duplicative_services"
    />
  );
}
function CHWTab() {
  return (
    <ComingSoonTab
      title="CHW Coordination - Coming next session"
      description="CHW to Care Manager direction relationships with FTE gauge (2.0 FTE cap enforced by DB trigger per NC Medicaid TCM April 2022 guidance). Conflict-of-interest override workflow with required rationale."
      schemaNote="Tables ready: cm_chw_assignments, users.chw_* columns (13 credentialing fields)"
    />
  );
}

// ===============================================================================
// Small UI helpers local to this file
// ===============================================================================

function KpiCard({ label, value, hint, variant }) {
  const palette = {
    amber:   { bg: C.amberBg,  color: C.amber,   border: C.amberBorder  },
    blue:    { bg: C.blueBg,   color: C.blue,    border: C.blueBorder   },
    neutral: { bg: C.bgPrimary,color: C.teal,    border: C.borderLight  },
  };
  const p = palette[variant] || palette.neutral;
  return (
    <Card style={{ padding: 16, background: p.bg, border: "0.5px solid " + p.border }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 32, fontWeight: 700, color: p.color, marginTop: 4, lineHeight: 1 }}>{value}</div>
      {hint && <div style={{ fontSize: 12, color: C.textTertiary, marginTop: 6 }}>{hint}</div>}
    </Card>
  );
}

function StatusBadge({ status }) {
  const map = {
    "Received":          "neutral",
    "Parsing":           "blue",
    "Parsed":            "blue",
    "Validated":         "teal",
    "Reconciled":        "green",
    "Failed":            "red",
    "Rejected":          "red",
    "Unmatched":         "amber",
    "Matched Single":    "green",
    "Matched Multiple":  "amber",
    "Manually Resolved": "green",
    "Skipped":           "neutral",
    "Draft":             "neutral",
    "Ready":             "blue",
    "Generated":         "teal",
    "Transmitted":       "green",
    "Acknowledged":      "green",
  };
  return <Badge label={status} variant={map[status] || "neutral"} size="xs" />;
}

function Th({ children, align }) {
  return (
    <th style={{
      textAlign: align || "left",
      fontSize: 11,
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: "0.05em",
      color: C.textSecondary,
      padding: "10px 12px",
    }}>
      {children}
    </th>
  );
}
function Td({ children, align, style }) {
  return (
    <td style={{
      padding: "10px 12px",
      textAlign: align || "left",
      color: C.textPrimary,
      verticalAlign: "middle",
      ...style,
    }}>
      {children}
    </td>
  );
}

const inputStyle = {
  width: "100%",
  padding: "9px 12px",
  border: "1px solid " + C.borderMid,
  borderRadius: 8,
  fontSize: 13,
  fontFamily: "inherit",
  outline: "none",
  color: C.textPrimary,
  background: C.bgPrimary,
  boxSizing: "border-box",
  resize: "vertical",
};

const selectStyle = {
  ...inputStyle,
  WebkitAppearance: "none",
  paddingRight: 32,
};
