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
    const today = new Date();
    const pastDay20 = today.getUTCDate() >= 20;
    const needsAttention = new Set();

    for (const r of active) {
      const band = stalenessBand(r.acuity_tier, r.days_since_contact);
      if (band === "amber" || band === "red") needsAttention.add(r.id);
      if (pastDay20 && !r.has_contact_this_month) needsAttention.add(r.id);
    }
    for (const r of pending) {
      const tooOld = r.days_since_enrolled !== null && r.days_since_enrolled >= 14;
      const noSuccess = !r.last_touchpoint_at || r.days_since_contact === null;
      // If pending 14+ days AND no last contact at all, flag as outreach overdue.
      // (If they have any contact, even an attempt, we respect that and do not flag yet.)
      if (tooOld && noSuccess) needsAttention.add(r.id);
    }

    const billingAtRisk = active.filter(r => pastDay20 && !r.has_contact_this_month).length;

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
                    <StaleDaysBadge days={r.days_since_contact} status={r.enrollment_status} acuity={r.acuity_tier} />
                  </Td>
                  <Td>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {r.enrollment_status === "Active" && !r.has_contact_this_month && new Date().getUTCDate() >= 20 && (
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

// Acuity-aware staleness band.
//
// Policy grounding:
//   - TCM Provider Manual Section 4.2: "to submit a claim for payment for a
//     member in a month, a Tailored Plan/LME/MCO, AMH+, or CMA must have at
//     least one qualifying member-facing contact in that month."
//   - TCM Provider Manual footnote 35 (rate assumption): engaged members
//     receive on average three monthly contacts + one in-person quarterly.
//   - Cadence is clinical judgment, not a fixed acuity-tier requirement.
//     These thresholds are calibrated to warn BEFORE the billing floor slips
//     and with tighter windows for High acuity members per the rate
//     assumption of visible multi-contact engagement.
//
// Red band = overdue relative to billing floor. Amber = warning, act soon.
// These defaults live here; v2 will make them practice-configurable via
// practice_preferences.cm_cadence_thresholds JSONB.
const CADENCE_THRESHOLDS = {
  High:     { amberAt: 11, redAt: 21 },
  Moderate: { amberAt: 15, redAt: 26 },
  Low:      { amberAt: 31, redAt: 46 },
};

function stalenessBand(acuity, days) {
  if (days === null || days === undefined) return "amber"; // "No contact" = amber band by default
  const t = CADENCE_THRESHOLDS[acuity] || CADENCE_THRESHOLDS.Moderate;
  if (days >= t.redAt)   return "red";
  if (days >= t.amberAt) return "amber";
  return "green";
}

// Sub-component: days-since badge with acuity-aware coloring.
// Disenrolled rows do not show staleness (not applicable).
function StaleDaysBadge({ days, status, acuity }) {
  if (status === "Disenrolled") return <span style={{ color: C.textTertiary }}>-</span>;
  if (days === null || days === undefined) return <Badge label="No contact" variant="amber" size="xs" />;
  const band = stalenessBand(acuity, days);
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
