import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../auth/AuthProvider";
import { C } from "../lib/tokens";
import {
  Badge, Btn, Card, Modal, Loader, EmptyState, ErrorBanner,
  SectionHead, FL, TabBar
} from "../components/ui";

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
        <NewImportModal practiceId={practiceId} onClose={() => setShowNew(false)} onCreated={(id) => { setShowNew(false); load().then(() => runEdge("prl-parse", { import_id: id })); }} />
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

function RegistryTab() {
  return (
    <ComingSoonTab
      title="Registry - Coming next session"
      description="Filterable enrollments list: acuity tier distribution, program type breakdown, recent additions, disenrollment queue, CHW acceptance status per enrollment."
      schemaNote="Tables ready: cm_enrollments (33 columns), cm_risk_tier_history (append-only ledger)"
    />
  );
}
function TouchpointsTab() {
  return (
    <ComingSoonTab
      title="Touchpoints - Coming next session"
      description="Contact log with role-aware activity filtering. Separate views for Care Manager vs Extender vs CHW. Quick-entry modal with activity category validation."
      schemaNote="Tables ready: cm_touchpoints (27 columns incl. in_person generated col, delivered_by_role scope trigger)"
    />
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
