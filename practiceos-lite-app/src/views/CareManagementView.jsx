import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../auth/AuthProvider";
import { C } from "../lib/tokens";
import {
  Badge, Btn, Card, Modal, Loader, EmptyState, ErrorBanner,
  SectionHead, FL, TabBar
} from "../components/ui";
import { stalenessBand, isBillableByPlan, isPastBillingRiskDay, PLAN_PROGRAM_MATRIX, validatePlanProgramProvider } from "../lib/cmCadence";
import CHWTab from "./CHWTab";

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
        {tab === "plans"       && <PlansTab practiceId={profile?.practice_id} profile={profile} />}
        {tab === "billing"     && <BillingTab practiceId={profile?.practice_id} profile={profile} />}
        {tab === "chw"         && <CHWTab practiceId={profile?.practice_id} profile={profile} />}
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
  const [riskFilter, setRiskFilter]       = useState("all"); // all | attention | critical
  const [selected, setSelected]           = useState(null);
  const [showNewEnroll, setShowNewEnroll] = useState(false);

  // Role gate for enrollment creation. CHW cannot create; Owner/Manager/CM can.
  const role = profile?.role;
  const canCreateEnroll = role && role !== "CHW";

  const load = useCallback(async () => {
    if (!practiceId) return;
    setLoading(true);
    setError(null);
    try {
      // Fetch enrollments + patient names in one call via the embedded FK select.
      const { data: enrollments, error: e1 } = await supabase
        .from("cm_enrollments")
        .select("id, patient_id, program_type, enrollment_status, acuity_tier, health_plan_type, cm_provider_type, payer_name, plan_member_id, enrolled_at, assigned_at, disenrolled_at, disenrollment_reason_code, assigned_care_manager_id, hop_eligible, hop_active, patients(first_name, last_name, date_of_birth)")
        .eq("practice_id", practiceId)
        .order("enrollment_status", { ascending: true })
        .order("acuity_tier",        { ascending: true })
        .order("enrolled_at",        { ascending: false });
      if (e1) throw e1;

      // For each enrollment, pull the max touchpoint_at. Single aggregate query
      // rather than per-row fetches - cheap and keeps the UI snappy.
      const enrIds = (enrollments || []).map(e => e.id);
      let lastTpMap = {};
      let riskMap = {};
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

        // Risk assessments - fetch only active (non-superseded) assessments.
        // Each enrollment has at most one active assessment due to DB trigger.
        const { data: risks, error: e3 } = await supabase
          .from("cm_enrollment_risk_assessments")
          .select("id, enrollment_id, risk_level, risk_score, headline, narrative, risk_factors, protective_factors, recommended_interventions, suggested_next_contact_by, confidence, assessed_at, acknowledged_at, acknowledged_by, dismissed_at, dismissed_by, dismissed_reason, trigger_reason, model, prompt_version")
          .in("enrollment_id", enrIds)
          .is("superseded_at", null);
        if (e3) throw e3;
        for (const r of risks || []) {
          riskMap[r.enrollment_id] = r;
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
          risk: riskMap[e.id] || null,
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

  // Helper: is an enrollment currently "flagged at risk"?
  // Definition: has an active risk assessment at medium+ AND not dismissed.
  // Acknowledged assessments still count as flagged (they're on the queue
  // until dismissed or superseded with a lower-risk reassessment).
  const isRiskFlagged = (r) => {
    const risk = r.risk;
    if (!risk) return false;
    if (risk.dismissed_at) return false;
    return risk.risk_level === "medium" || risk.risk_level === "high" || risk.risk_level === "critical";
  };

  // Compute filter + KPI values against the loaded rows
  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (statusFilter  !== "all" && r.enrollment_status !== statusFilter)  return false;
      if (acuityFilter  !== "all" && r.acuity_tier       !== acuityFilter)  return false;
      if (programFilter !== "all" && r.program_type      !== programFilter) return false;
      if (riskFilter === "attention") {
        if (!isRiskFlagged(r)) return false;
      } else if (riskFilter === "critical") {
        if (!r.risk || r.risk.dismissed_at || r.risk.risk_level !== "critical") return false;
      }
      return true;
    });
  }, [rows, statusFilter, acuityFilter, programFilter, riskFilter]);

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
      const band = stalenessBand(r.acuity_tier, r.days_since_contact, r.health_plan_type);
      if (band === "amber" || band === "red") needsAttention.add(r.id);
      // BILL RISK only counts for Tailored Plan (monthly billing floor).
      if (pastDay20 && !r.has_contact_this_month && isBillableByPlan(r.health_plan_type)) {
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

    const billingAtRisk = active.filter(r => pastDay20 && !r.has_contact_this_month && isBillableByPlan(r.health_plan_type)).length;

    // AI risk counts - only count non-dismissed active-enrollment members
    const aiFlagged  = active.filter(r => isRiskFlagged(r));
    const aiCritical = aiFlagged.filter(r => r.risk && r.risk.risk_level === "critical").length;

    return {
      total:           rows.length,
      active:          active.length,
      high:            active.filter(r => r.acuity_tier === "High").length,
      moderate:        active.filter(r => r.acuity_tier === "Moderate").length,
      low:             active.filter(r => r.acuity_tier === "Low").length,
      pending:         pending.length,
      stale:           needsAttention.size,
      billing_at_risk: billingAtRisk,
      ai_flagged:      aiFlagged.length,
      ai_critical:     aiCritical,
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
        <KpiCard label="AI flagged"       value={kpis.ai_flagged} hint={kpis.ai_critical > 0 ? (kpis.ai_critical + " critical") : "Medium+ risk, not dismissed"} variant={kpis.ai_critical > 0 ? "red" : (kpis.ai_flagged > 0 ? "amber" : "neutral")} />
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
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textTertiary }}>Risk</span>
          <FilterPill active={riskFilter === "all"}       onClick={() => setRiskFilter("all")}>All</FilterPill>
          <FilterPill active={riskFilter === "attention"} onClick={() => setRiskFilter("attention")}>At risk</FilterPill>
          <FilterPill active={riskFilter === "critical"}  onClick={() => setRiskFilter("critical")}>Critical</FilterPill>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {canCreateEnroll && (
            <Btn variant="primary" size="sm" onClick={() => setShowNewEnroll(true)}>+ New enrollment</Btn>
          )}
          <Btn variant="outline" size="sm" onClick={load}>Refresh</Btn>
        </div>
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
                <Th>Plan</Th>
                <Th>Program</Th>
                <Th>Acuity</Th>
                <Th>Status</Th>
                <Th>Risk</Th>
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
                  <Td><PlanTypeBadge planType={r.health_plan_type} /></Td>
                  <Td>
                    <div>{r.program_type}</div>
                    {r.cm_provider_type && <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>{r.cm_provider_type}</div>}
                  </Td>
                  <Td><AcuityBadge tier={r.acuity_tier} /></Td>
                  <Td><StatusBadge status={r.enrollment_status} /></Td>
                  <Td><RiskBadge risk={r.risk} /></Td>
                  <Td style={{ fontSize: 12 }}>{r.payer_name}</Td>
                  <Td align="right" style={{ fontSize: 12, color: C.textSecondary }}>
                    {r.last_touchpoint_at ? new Date(r.last_touchpoint_at).toLocaleDateString() : "-"}
                  </Td>
                  <Td align="right">
                    <StaleDaysBadge days={r.days_since_contact} status={r.enrollment_status} acuity={r.acuity_tier} planType={r.health_plan_type} />
                  </Td>
                  <Td>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {r.enrollment_status === "Active" && !r.has_contact_this_month && isPastBillingRiskDay() && isBillableByPlan(r.health_plan_type) && (
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
        <EnrollmentDetail
          enrollment={selected}
          onClose={() => setSelected(null)}
          onUpdated={() => { setSelected(null); load(); }}
          onRiskChanged={load}
        />
      )}
      {showNewEnroll && (
        <NewEnrollmentModal
          practiceId={practiceId}
          userId={profile?.id}
          onClose={() => setShowNewEnroll(false)}
          onCreated={() => { setShowNewEnroll(false); load(); }}
        />
      )}
    </div>
  );
}

// Sub-component: acuity-tier color-coded badge. Returns "-" if tier is null
// (expected for Standard Plan enrollments where acuity tiering does not apply).
function AcuityBadge({ tier }) {
  const map = { High: "red", Moderate: "amber", Low: "green" };
  return <Badge label={tier || "-"} variant={map[tier] || "neutral"} size="xs" />;
}

// Sub-component: health plan type badge. Tailored Plan, Standard Plan, Other.
function PlanTypeBadge({ planType }) {
  if (!planType) return <span style={{ color: C.textTertiary, fontSize: 12 }}>-</span>;
  const map = { "Tailored Plan": "purple", "Standard Plan": "blue", "Other": "neutral" };
  const shortLabel = { "Tailored Plan": "Tailored", "Standard Plan": "Standard", "Other": "Other" };
  return <Badge label={shortLabel[planType] || planType} variant={map[planType] || "neutral"} size="xs" />;
}

// Sub-component: days-since badge with acuity-aware + program-aware coloring.
// Staleness logic lives in src/lib/cmCadence.js - see that module for the
// policy grounding (TCM Provider Manual Section 4.2 + footnote 35) and for
// per-program threshold tables. Disenrolled rows do not show staleness.
function StaleDaysBadge({ days, status, acuity, planType }) {
  if (status === "Disenrolled") return <span style={{ color: C.textTertiary }}>-</span>;
  if (days === null || days === undefined) return <Badge label="No contact" variant="amber" size="xs" />;
  const band = stalenessBand(acuity, days, planType);
  const variant = band === "red" ? "red" : band === "amber" ? "amber" : "green";
  return <Badge label={days + "d"} variant={variant} size="xs" />;
}

// Sub-component: AI-assessed clinical risk badge. Shows the latest active
// (non-superseded) risk_level. If the assessment has been dismissed, renders
// a muted indicator so reviewers know the AI flagged it but a human cleared it.
// If no assessment exists yet, shows em-dash.
function RiskBadge({ risk }) {
  if (!risk) return <span style={{ color: C.textTertiary, fontSize: 12 }}>-</span>;
  if (risk.dismissed_at) {
    return (
      <span title="Flagged by AI, dismissed by staff" style={{ fontSize: 11, color: C.textTertiary, fontStyle: "italic" }}>
        Dismissed
      </span>
    );
  }
  const map = {
    critical: "red",
    high:     "red",
    medium:   "amber",
    low:      "green",
  };
  const label = (risk.risk_level || "").toUpperCase();
  const variant = map[risk.risk_level] || "neutral";
  const title = risk.headline || "";
  return (
    <span title={title}>
      <Badge label={label} variant={variant} size="xs" />
      {risk.acknowledged_at && (
        <span style={{ marginLeft: 4, fontSize: 10, color: C.textTertiary }} title="Acknowledged">ack</span>
      )}
    </span>
  );
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
function EnrollmentDetail({ enrollment, onClose, onUpdated, onRiskChanged }) {
  const { profile } = useAuth();
  const [touchpoints, setTouchpoints] = useState([]);
  const [loading, setLoading]         = useState(true);
  // Sub-mode: view (default) | edit | disenroll | activate
  const [mode, setMode] = useState("view");

  // AI risk state - latest active assessment for this enrollment, plus the
  // action-handler flags for Re-assess / Acknowledge / Dismiss.
  const [risk, setRisk] = useState(null);
  const [riskHistory, setRiskHistory] = useState([]);
  const [riskLoading, setRiskLoading] = useState(true);
  const [riskBusy, setRiskBusy]       = useState(false);
  const [riskError, setRiskError]     = useState(null);
  const [showDismiss, setShowDismiss] = useState(false);
  const [dismissReason, setDismissReason] = useState("");

  const loadRisk = useCallback(async () => {
    setRiskLoading(true);
    try {
      // Single query: all assessments for this enrollment. The one with
      // superseded_at IS NULL is the currently-active assessment; the rest
      // are history (sorted newest-first for the timeline view).
      const { data } = await supabase
        .from("cm_enrollment_risk_assessments")
        .select("id, risk_level, risk_score, headline, narrative, risk_factors, protective_factors, recommended_interventions, suggested_next_contact_by, confidence, assessed_at, acknowledged_at, acknowledged_by, dismissed_at, dismissed_by, dismissed_reason, trigger_reason, model, superseded_at, superseded_by_id")
        .eq("enrollment_id", enrollment.id)
        .order("assessed_at", { ascending: false });
      const rows = data || [];
      const active  = rows.find(r => !r.superseded_at) || null;
      const history = rows.filter(r => r.superseded_at);
      setRisk(active);
      setRiskHistory(history);
    } catch (e) {
      setRiskError(e.message || "Could not load risk assessment");
    } finally {
      setRiskLoading(false);
    }
  }, [enrollment.id]);

  useEffect(() => {
    supabase
      .from("cm_touchpoints")
      .select("id, touchpoint_at, contact_method, successful_contact, delivered_by_role, activity_category_code, notes")
      .eq("enrollment_id", enrollment.id)
      .order("touchpoint_at", { ascending: false })
      .limit(50)
      .then(({ data }) => { setTouchpoints(data || []); setLoading(false); });
    loadRisk();
  }, [enrollment.id, loadRisk]);

  // Re-assess: call cmp-risk-assess-enrollment edge fn. Supersedes current
  // via DB trigger; we just refetch after.
  const handleReassess = async () => {
    setRiskBusy(true);
    setRiskError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) throw new Error("Not authenticated");
      const url = supabase.supabaseUrl + "/functions/v1/cmp-risk-assess-enrollment";
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": "Bearer " + token,
        },
        body: JSON.stringify({ enrollment_id: enrollment.id, trigger_reason: "manual" }),
      });
      const body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || "HTTP " + res.status);
      await loadRisk();
      // Await the parent's reload so rows is fresh before the user can close
      // the modal. Previously this was fire-and-forget, which produced a race:
      // if the user closed the modal quickly, the Registry would still show
      // stale risk data until they hit Refresh.
      if (onRiskChanged) await onRiskChanged();
    } catch (e) {
      setRiskError(e.message || "Re-assess failed");
    } finally {
      setRiskBusy(false);
    }
  };

  // Acknowledge: mark the current assessment as seen and being worked.
  const handleAcknowledge = async () => {
    if (!risk?.id) return;
    setRiskBusy(true);
    setRiskError(null);
    try {
      const { error: e1 } = await supabase
        .from("cm_enrollment_risk_assessments")
        .update({
          acknowledged_at: new Date().toISOString(),
          acknowledged_by: profile?.id || null,
        })
        .eq("id", risk.id);
      if (e1) throw e1;
      await loadRisk();
      if (onRiskChanged) await onRiskChanged();
    } catch (e) {
      setRiskError(e.message || "Acknowledge failed");
    } finally {
      setRiskBusy(false);
    }
  };

  // Dismiss: removes from "At risk" queue. Requires a reason for audit trail.
  const handleDismiss = async () => {
    if (!risk?.id) return;
    if (!dismissReason.trim()) { setRiskError("Dismiss reason required"); return; }
    setRiskBusy(true);
    setRiskError(null);
    try {
      const { error: e1 } = await supabase
        .from("cm_enrollment_risk_assessments")
        .update({
          dismissed_at: new Date().toISOString(),
          dismissed_by: profile?.id || null,
          dismissed_reason: dismissReason.trim(),
        })
        .eq("id", risk.id);
      if (e1) throw e1;
      setShowDismiss(false);
      setDismissReason("");
      await loadRisk();
      if (onRiskChanged) await onRiskChanged();
    } catch (e) {
      setRiskError(e.message || "Dismiss failed");
    } finally {
      setRiskBusy(false);
    }
  };

  const title = (enrollment.patients?.first_name || "") + " " + (enrollment.patients?.last_name || "");
  const canActivate   = enrollment.enrollment_status === "Pending" || enrollment.enrollment_status === "On Hold";
  const canDisenroll  = enrollment.enrollment_status !== "Disenrolled";
  const canEdit       = enrollment.enrollment_status !== "Deceased" && enrollment.enrollment_status !== "Transferred";

  // Role gate for risk actions. CHW can trigger Re-assess but cannot
  // Acknowledge/Dismiss (those are supervisor-level decisions).
  const role = profile?.role;
  const canReassess = role && enrollment.enrollment_status !== "Disenrolled";
  const canAckDismiss = role && role !== "CHW";

  // Inline mode: show the relevant form in place of the read-only view.
  if (mode === "edit") {
    return (
      <Modal title={"Edit enrollment: " + title} onClose={onClose} width={760}>
        <EditEnrollmentForm
          enrollment={enrollment}
          onCancel={() => setMode("view")}
          onSaved={() => { if (onUpdated) onUpdated(); }}
        />
      </Modal>
    );
  }
  if (mode === "disenroll") {
    return (
      <Modal title={"Disenroll: " + title} onClose={onClose} width={640}>
        <DisenrollForm
          enrollment={enrollment}
          onCancel={() => setMode("view")}
          onSaved={() => { if (onUpdated) onUpdated(); }}
        />
      </Modal>
    );
  }
  if (mode === "activate") {
    return (
      <Modal title={"Activate: " + title} onClose={onClose} width={560}>
        <ActivateForm
          enrollment={enrollment}
          onCancel={() => setMode("view")}
          onSaved={() => { if (onUpdated) onUpdated(); }}
        />
      </Modal>
    );
  }

  return (
    <Modal title={"Enrollment: " + title} onClose={onClose} width={760}>
      {/* Action buttons row */}
      {(canActivate || canEdit || canDisenroll) && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16, paddingBottom: 12, borderBottom: "0.5px solid " + C.borderLight }}>
          {canActivate && (
            <Btn variant="primary" size="sm" onClick={() => setMode("activate")}>
              {enrollment.enrollment_status === "On Hold" ? "Resume enrollment" : "Activate"}
            </Btn>
          )}
          {canEdit && (
            <Btn variant="outline" size="sm" onClick={() => setMode("edit")}>Edit</Btn>
          )}
          {canDisenroll && (
            <Btn variant="outline" size="sm" onClick={() => setMode("disenroll")} style={{ color: C.red, borderColor: C.redBorder }}>
              Disenroll
            </Btn>
          )}
        </div>
      )}

      {/* Summary row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        <DetailField label="Plan type"    value={<PlanTypeBadge planType={enrollment.health_plan_type} />} />
        <DetailField label="Program"      value={enrollment.program_type} />
        <DetailField label="Provider"     value={enrollment.cm_provider_type || "-"} />
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

      {/* AI clinical risk panel */}
      <RiskPanel
        risk={risk}
        history={riskHistory}
        loading={riskLoading}
        busy={riskBusy}
        error={riskError}
        canReassess={canReassess}
        canAckDismiss={canAckDismiss}
        onReassess={handleReassess}
        onAcknowledge={handleAcknowledge}
        showDismiss={showDismiss}
        setShowDismiss={setShowDismiss}
        dismissReason={dismissReason}
        setDismissReason={setDismissReason}
        onDismiss={handleDismiss}
      />

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
        .select("id, touchpoint_at, contact_method, successful_contact, delivered_by_role, activity_category_code, notes, enrollment_id, patient_id, delivered_by_user_id, hrsn_domains_addressed, counts_toward_tcm_contact, ai_scribe_model, cm_enrollments(program_type, acuity_tier), patients(first_name, last_name)")
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

  // AI polish state. `aiResult` holds the normalized response from the
  // cmp-summarize-touchpoint edge function; when present we render a preview
  // strip showing action items, detected concerns, and the TCM-countability
  // rationale. `aiMeta` captures model/version for the DB audit fields so we
  // can mark the touchpoint as AI-polished on save. `notesBaseline` captures
  // what polished_notes looked like right after the AI populated the textarea
  // so we can detect user edits - if the user diverged, we still write their
  // text but leave ai_scribe_summary NULL to avoid claiming AI content they
  // didn't actually keep.
  const [aiPolishing, setAiPolishing]   = useState(false);
  const [aiError, setAiError]           = useState(null);
  const [aiResult, setAiResult]         = useState(null);
  const [aiMeta, setAiMeta]             = useState(null);
  const [notesBaseline, setNotesBaseline] = useState("");

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
      .select("id, patient_id, program_type, acuity_tier, enrollment_status, patients(first_name, last_name, date_of_birth, mrn)")
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
          mrn:        e.patients?.mrn || "",
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

  // -------------------------------------------------------------------------
  // AI polish handler - invokes cmp-summarize-touchpoint with the CM's raw
  // notes and auto-populates form fields with suggestions. Never overwrites
  // fields the user has already set meaningfully.
  // -------------------------------------------------------------------------
  const handleAiPolish = async () => {
    if (!notes.trim())    { setAiError("Type some raw notes first, then polish"); return; }
    if (!enrollmentId)    { setAiError("Pick a patient/enrollment first"); return; }
    if (!contactMethod)   { setAiError("Pick a contact method first"); return; }

    setAiPolishing(true);
    setAiError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const url = supabase.supabaseUrl + "/functions/v1/cmp-summarize-touchpoint";
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": "Bearer " + token,
        },
        body: JSON.stringify({
          raw_notes: notes,
          contact_method: contactMethod,
          enrollment_id: enrollmentId,
          current_activity_category_code: activityCode || null,
        }),
      });
      const body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || "HTTP " + res.status);

      // Replace notes textarea with polished version, record baseline so we
      // can detect later edits. Suggest activity code only if user hadn't
      // already picked one. Merge suggested HRSN domains with any the user
      // manually toggled.
      const polished = body.polished_notes || notes;
      setNotes(polished);
      setNotesBaseline(polished);

      if (!activityCode && body.suggested_activity_category_code) {
        setActivityCode(body.suggested_activity_category_code);
      }
      if (Array.isArray(body.suggested_hrsn_domains) && body.suggested_hrsn_domains.length > 0) {
        setSelectedHrsn(prev => {
          const merged = new Set(prev);
          for (const d of body.suggested_hrsn_domains) merged.add(d);
          return Array.from(merged);
        });
      }

      setAiResult(body);
      setAiMeta({
        model_used:     body.model_used,
        prompt_version: body.prompt_version,
        generated_at:   body.generated_at,
      });
    } catch (e) {
      setAiError(e.message || "AI polish failed");
    } finally {
      setAiPolishing(false);
    }
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

    // AI audit trail: only mark ai_scribe_summary / ai_scribe_model when the
    // user actually kept the AI-polished text (baseline match). If they
    // edited the polished version, write just their text and leave the AI
    // columns null - we don't want to claim AI content the user rewrote.
    if (aiResult && notes === notesBaseline) {
      payload.ai_scribe_summary = notes.trim();
      payload.ai_scribe_model   = aiMeta?.model_used || null;
      payload.source            = "Manual-AI-Polished";
    }

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
              <option key={p.id} value={p.id}>
                {p.last_name}, {p.first_name}{p.mrn ? " (" + p.mrn + ")" : ""}
              </option>
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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <FL>Notes ({notes.length}/500)</FL>
            {enrollmentId && contactMethod && notes.trim().length >= 5 && (
              <Btn
                variant={aiResult ? "outline" : "primary"}
                size="sm"
                disabled={aiPolishing}
                onClick={handleAiPolish}
                style={{ marginBottom: 4 }}
              >
                {aiPolishing ? "Polishing..." : (aiResult ? "Re-polish" : "Polish with AI")}
              </Btn>
            )}
          </div>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value.slice(0, 500))}
            rows={4}
            placeholder="Clinical observations, topics discussed, follow-up needed..."
            style={{ ...inputStyle, resize: "vertical" }}
          />
          {aiError && (
            <div style={{ marginTop: 6, fontSize: 12, color: C.red, background: C.redBg, padding: "6px 10px", borderRadius: 6, border: "0.5px solid " + C.redBorder }}>
              {aiError}
            </div>
          )}
          {aiResult && (
            <TouchpointAiPreview aiResult={aiResult} notesEdited={notes !== notesBaseline} />
          )}
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
// TouchpointAiPreview - preview strip shown inside LogTouchpointModal after
// the CM clicks "Polish with AI". Surfaces the AI's suggestions that don't
// map cleanly to form fields (action items, detected safety concerns, TCM
// countability rationale) so the CM sees everything the AI picked up on.
// v1: read-only. Action items displayed but not auto-converted to tasks;
// that's a future enhancement.
// ---------------------------------------------------------------------------
function TouchpointAiPreview({ aiResult, notesEdited }) {
  const actions    = Array.isArray(aiResult.action_items)     ? aiResult.action_items     : [];
  const concerns   = Array.isArray(aiResult.detected_concerns) ? aiResult.detected_concerns : [];
  const hrsnCount  = Array.isArray(aiResult.suggested_hrsn_domains) ? aiResult.suggested_hrsn_domains.length : 0;

  const dueLabel = (v) => {
    if (v === "today")      return "Today";
    if (v === "tomorrow")   return "Tomorrow";
    if (v === "this_week")  return "This week";
    if (v === "next_week")  return "Next week";
    return null;
  };

  return (
    <div style={{ marginTop: 10, padding: 12, background: "#fafafa", border: "0.5px solid " + C.borderLight, borderRadius: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary }}>
          AI polish applied
        </div>
        {notesEdited && (
          <Badge label="NOTES EDITED AFTER POLISH" variant="amber" size="xs" />
        )}
      </div>

      {/* Critical concerns block first - highest attention */}
      {concerns.length > 0 && (
        <div style={{ marginBottom: 10, padding: 10, background: C.redBg, border: "0.5px solid " + C.redBorder, borderRadius: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.red, marginBottom: 6 }}>
            Detected concerns - review before saving
          </div>
          {concerns.map((c, i) => (
            <div key={i} style={{ fontSize: 13, color: C.textPrimary, marginBottom: i < concerns.length - 1 ? 6 : 0 }}>
              <Badge label={String(c.type || "concern").replace(/_/g, " ").toUpperCase()} variant={c.severity === "critical" ? "red" : c.severity === "high" ? "red" : "amber"} size="xs" />
              <span style={{ marginLeft: 6 }}>{c.description}</span>
            </div>
          ))}
        </div>
      )}

      {/* TCM countability rationale */}
      {aiResult.counts_reasoning && (
        <div style={{ marginBottom: 10, fontSize: 12, color: C.textSecondary }}>
          <strong style={{ color: C.textPrimary }}>TCM count:</strong> {aiResult.suggested_counts_toward_tcm_contact ? "Yes" : "No"} - {aiResult.counts_reasoning}
        </div>
      )}

      {/* Activity category suggestion rationale */}
      {aiResult.activity_category_rationale && aiResult.suggested_activity_category_code && (
        <div style={{ marginBottom: 10, fontSize: 12, color: C.textSecondary }}>
          <strong style={{ color: C.textPrimary }}>Category rationale:</strong> {aiResult.activity_category_rationale}
        </div>
      )}

      {/* HRSN domains addressed */}
      {hrsnCount > 0 && (
        <div style={{ marginBottom: 10, fontSize: 12, color: C.textSecondary }}>
          <strong style={{ color: C.textPrimary }}>HRSN domains detected:</strong> {aiResult.suggested_hrsn_domains.join(", ")}
        </div>
      )}

      {/* Action items */}
      {actions.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 6 }}>
            Extracted action items ({actions.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {actions.map((a, i) => (
              <div key={i} style={{ fontSize: 12, padding: "6px 10px", background: C.bgPrimary, border: "0.5px solid " + C.borderLight, borderRadius: 6 }}>
                <div style={{ color: C.textPrimary }}>{a.description}</div>
                <div style={{ fontSize: 10, color: C.textTertiary, marginTop: 2, display: "flex", gap: 8 }}>
                  {dueLabel(a.suggested_due) && <span>Due: {dueLabel(a.suggested_due)}</span>}
                  {a.suggested_owner && <span>Owner: {String(a.suggested_owner).replace(/_/g, " ")}</span>}
                </div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 10, color: C.textTertiary, marginTop: 6, fontStyle: "italic" }}>
            Action items shown for reference. Auto-converting to tasks is a future enhancement.
          </div>
        </div>
      )}
    </div>
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
// ===============================================================================
// Plans tab
// ===============================================================================
//
// Manages cm_care_plans - formal care plans linked to enrollments. Five plan
// types per cm_plan_type enum:
//   - Care Plan (generic TCM)
//   - Individual Support Plan (IDD populations)
//   - AMH Tier 3 Care Plan (Standard Plan)
//   - Comprehensive Assessment (intake-era)
//   - 90-Day Transition Plan (institutional discharge)
//
// Plans have status (Draft/Active/Archived/Superseded) and track review cadence
// via next_review_due. "Overdue review" = status='Active' AND next_review_due is
// in the past.
//
// v1 scope: list + create + detail. NOT in v1:
//   - Structured goals editor (goals kept as free-text JSONB array)
//   - Member acknowledgment workflow
//   - Document generation (PDF export)
//   - AI draft assistance (schema-level AI review gate is ready but UI is not)
//   - Automated review reminders
// ===============================================================================

function PlansTab({ practiceId, profile }) {
  const [plans, setPlans]                 = useState([]);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState(null);
  const [statusFilter, setStatusFilter]   = useState("all");
  const [planTypeFilter, setPlanTypeFilter] = useState("all");
  const [selected, setSelected]           = useState(null);
  const [showNewPlan, setShowNewPlan]     = useState(false);

  const role = profile?.role;
  const canCreate = role && role !== "CHW";

  const load = () => {
    if (!practiceId) return;
    setLoading(true);
    supabase
      .from("cm_care_plans")
      .select("id, patient_id, enrollment_id, plan_type, plan_status, version, assessment_date, last_reviewed_at, next_review_due, effective_date, expires_at, goals, interventions, unmet_needs, risk_factors, strengths, supports, medications_reviewed, ai_drafted, ai_draft_model, ai_draft_at, ai_draft_prompt_version, human_reviewed_at, member_ack_at, notes, created_at, patients(first_name, last_name, mrn), cm_enrollments(program_type, health_plan_type, cm_provider_type)")
      .eq("practice_id", practiceId)
      .order("created_at", { ascending: false })
      .then(({ data, error: e }) => {
        if (e) setError(e.message);
        else setPlans(data || []);
        setLoading(false);
      });
  };

  useEffect(() => { load(); }, [practiceId]);

  const today = new Date().toISOString().split("T")[0];

  const kpis = useMemo(() => {
    const active = plans.filter(p => p.plan_status === "Active");
    const drafts = plans.filter(p => p.plan_status === "Draft");
    const overdueReview = active.filter(p => p.next_review_due && p.next_review_due < today);
    return {
      total:         plans.length,
      active:        active.length,
      drafts:        drafts.length,
      overdueReview: overdueReview.length,
    };
  }, [plans, today]);

  const filtered = useMemo(() => {
    return plans.filter(p => {
      if (statusFilter !== "all" && p.plan_status !== statusFilter) return false;
      if (planTypeFilter !== "all" && p.plan_type !== planTypeFilter) return false;
      return true;
    });
  }, [plans, statusFilter, planTypeFilter]);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
        <KpiCard label="Total plans"    value={kpis.total} />
        <KpiCard label="Active"         value={kpis.active}        hint="Active care plans" />
        <KpiCard label="Drafts"         value={kpis.drafts}        hint="Not yet activated" variant={kpis.drafts > 0 ? "amber" : "neutral"} />
        <KpiCard label="Review overdue" value={kpis.overdueReview} hint="Active plans past next_review_due" variant={kpis.overdueReview > 0 ? "amber" : "neutral"} />
      </div>

      <Card style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, padding: 12 }}>
        <div style={{ display: "flex", gap: 6 }}>
          {["all", "Draft", "Active", "Archived", "Superseded"].map(s => (
            <Btn key={s} size="sm" variant={statusFilter === s ? "primary" : "ghost"} onClick={() => setStatusFilter(s)}>
              {s === "all" ? "All statuses" : s}
            </Btn>
          ))}
        </div>
        <select value={planTypeFilter} onChange={e => setPlanTypeFilter(e.target.value)} style={{ ...selectStyle, width: 240 }}>
          <option value="all">All plan types</option>
          <option value="Care Plan">Care Plan</option>
          <option value="Individual Support Plan">Individual Support Plan</option>
          <option value="AMH Tier 3 Care Plan">AMH Tier 3 Care Plan</option>
          <option value="Comprehensive Assessment">Comprehensive Assessment</option>
          <option value="90-Day Transition Plan">90-Day Transition Plan</option>
        </select>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {canCreate && (
            <Btn variant="primary" size="sm" onClick={() => setShowNewPlan(true)}>+ New plan</Btn>
          )}
          <Btn variant="outline" size="sm" onClick={load}>Refresh</Btn>
        </div>
      </Card>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <Card>
        {loading ? (
          <Loader label="Loading care plans..." />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No care plans yet"
            message={plans.length === 0 ? "Create the first care plan from an active enrollment." : "No plans match the current filters."}
          />
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                <Th>Patient</Th>
                <Th>Plan type</Th>
                <Th>Status</Th>
                <Th align="right">Version</Th>
                <Th align="right">Assessment</Th>
                <Th align="right">Last reviewed</Th>
                <Th align="right">Next review</Th>
                <Th align="right">Goals</Th>
                <Th>Flags</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(plan => {
                const overdueReview = plan.plan_status === "Active" && plan.next_review_due && plan.next_review_due < today;
                const goalsCount = Array.isArray(plan.goals) ? plan.goals.length : 0;
                return (
                  <tr key={plan.id} onClick={() => setSelected(plan)} style={{ cursor: "pointer" }}>
                    <Td>
                      <div style={{ fontWeight: 600 }}>
                        {plan.patients?.last_name || ""}, {plan.patients?.first_name || ""}
                      </div>
                      {plan.patients?.mrn && (
                        <div style={{ fontSize: 11, color: C.textTertiary, fontFamily: "monospace", marginTop: 2 }}>{plan.patients.mrn}</div>
                      )}
                    </Td>
                    <Td>{plan.plan_type}</Td>
                    <Td><PlanStatusBadge status={plan.plan_status} /></Td>
                    <Td align="right" style={{ color: C.textSecondary }}>v{plan.version}</Td>
                    <Td align="right" style={{ color: C.textSecondary }}>
                      {plan.assessment_date ? new Date(plan.assessment_date).toLocaleDateString() : "-"}
                    </Td>
                    <Td align="right" style={{ color: C.textSecondary }}>
                      {plan.last_reviewed_at ? new Date(plan.last_reviewed_at).toLocaleDateString() : "-"}
                    </Td>
                    <Td align="right" style={{ color: overdueReview ? C.red : C.textSecondary, fontWeight: overdueReview ? 700 : 400 }}>
                      {plan.next_review_due ? new Date(plan.next_review_due).toLocaleDateString() : "-"}
                    </Td>
                    <Td align="right">{goalsCount}</Td>
                    <Td>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {overdueReview && <Badge label="REVIEW DUE" variant="red" size="xs" />}
                        {plan.ai_drafted && !plan.human_reviewed_at && <Badge label="AI DRAFT" variant="amber" size="xs" />}
                        {plan.member_ack_at && <Badge label="MEMBER ACK" variant="green" size="xs" />}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {selected && (
        <PlanDetailModal plan={selected} profile={profile} onClose={() => setSelected(null)} onUpdated={() => { setSelected(null); load(); }} />
      )}
      {showNewPlan && (
        <NewPlanModal
          practiceId={practiceId}
          userId={profile?.id}
          onClose={() => setShowNewPlan(false)}
          onCreated={() => { setShowNewPlan(false); load(); }}
        />
      )}
    </div>
  );
}

function PlanStatusBadge({ status }) {
  const map = { Draft: "amber", Active: "green", Archived: "neutral", Superseded: "neutral" };
  return <Badge label={status} variant={map[status] || "neutral"} size="xs" />;
}

// ---------------------------------------------------------------------------
// PlanDetailModal - read-only view of a care plan with all JSONB collections
// rendered as plain lists. Quick-action buttons for status transitions.
// ---------------------------------------------------------------------------

function PlanDetailModal({ plan, profile, onClose, onUpdated }) {
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);
  // Sub-mode: "view" (default, read-only) | "draftReview" (AI annual review).
  // Keeping the sub-mode inside PlanDetailModal instead of opening a nested
  // modal avoids double-Modal stacking and lets the reviewer flip back to the
  // prior-plan view without closing the whole thing.
  const [mode, setMode] = useState("view");

  // Role gate for the Annual Review AI button. Tier gating is enforced
  // server-side in cmp-draft-annual-review; a 403 surfaces in the error
  // banner if the practice isn't on Command tier.
  const role = profile?.role;
  const canDraftReview =
    plan.plan_status === "Active"
    && role
    && role !== "CHW";

  const title = (plan.patients?.first_name || "") + " " + (plan.patients?.last_name || "") + " - " + plan.plan_type;

  // Map the in-app user role to the cm_delivery_role enum used in the
  // human_reviewer_role column. Falls back to "Other" for roles that don't
  // have a clean clinical equivalent (e.g. Owner, Billing).
  const roleToDeliveryRole = (r) => {
    if (r === "Supervising Care Manager" || r === "Supervising CM") return "Supervising Care Manager";
    if (r === "Care Manager") return "Care Manager";
    if (r === "CHW" || r === "Extender") return "CHW";
    if (r === "Provider") return "Provider";
    return "Other";
  };

  const transitionStatus = async (newStatus, opts = {}) => {
    setSaving(true); setError(null);
    const nowIso = new Date().toISOString();
    const patch = { plan_status: newStatus, updated_at: nowIso };
    if (newStatus === "Active" && !plan.effective_date) {
      patch.effective_date = new Date().toISOString().split("T")[0];
    }
    // When activating an AI-drafted plan, we must also record the human
    // reviewer to satisfy cm_care_plans_ai_review_gate. Gate definition:
    //   NOT (ai_drafted=true AND plan_status='Active' AND human_reviewed_by IS NULL)
    // The reviewer is the current user clicking Activate. This is a single-
    // click attestation - the person hitting "Mark reviewed + activate" is
    // the human whose review we're recording.
    if (newStatus === "Active" && opts.markReviewed) {
      patch.human_reviewed_by    = profile?.id || null;
      patch.human_reviewed_at    = nowIso;
      patch.human_reviewer_role  = roleToDeliveryRole(profile?.role);
      patch.updated_by           = profile?.id || null;
    }
    try {
      const { error: updErr } = await supabase
        .from("cm_care_plans")
        .update(patch)
        .eq("id", plan.id);
      if (updErr) throw updErr;
      onUpdated();
    } catch (e) { setError(e.message); setSaving(false); }
  };

  const goals         = Array.isArray(plan.goals)         ? plan.goals         : [];
  const interventions = Array.isArray(plan.interventions) ? plan.interventions : [];
  const unmetNeeds    = Array.isArray(plan.unmet_needs)   ? plan.unmet_needs   : [];
  const riskFactors   = Array.isArray(plan.risk_factors)  ? plan.risk_factors  : [];
  const strengths     = Array.isArray(plan.strengths)     ? plan.strengths     : [];
  const supports      = Array.isArray(plan.supports)      ? plan.supports      : [];

  // Annual review drafting mode: swap the whole body for the draft flow.
  // Same Modal wrapper; different title and content. Accept here means a new
  // plan version was inserted - we propagate onUpdated() to refresh the list.
  if (mode === "draftReview") {
    return (
      <Modal title={"Annual review: " + title} onClose={onClose} width={900}>
        <AnnualReviewDrafter
          priorPlan={plan}
          userId={profile?.id}
          onCancel={() => setMode("view")}
          onSaved={() => { if (onUpdated) onUpdated(); }}
        />
      </Modal>
    );
  }

  return (
    <Modal title={title} onClose={onClose} width={820}>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div style={{ display: "flex", gap: 8, marginBottom: 16, paddingBottom: 12, borderBottom: "0.5px solid " + C.borderLight, flexWrap: "wrap" }}>
        {plan.plan_status === "Draft" && plan.ai_drafted && !plan.human_reviewed_by && (
          // AI-drafted Draft - activation requires human review attestation
          // per the cm_care_plans_ai_review_gate check constraint. CHW can't
          // attest clinical plans, so only non-CHW roles get the button.
          role && role !== "CHW" ? (
            <Btn variant="primary" size="sm" disabled={saving} onClick={() => transitionStatus("Active", { markReviewed: true })}>
              {saving ? "Activating..." : "Mark reviewed + activate"}
            </Btn>
          ) : (
            <div style={{ fontSize: 12, color: C.textTertiary, fontStyle: "italic", padding: "6px 0" }}>
              Awaiting review by Care Manager or Supervisor before activation
            </div>
          )
        )}
        {plan.plan_status === "Draft" && (!plan.ai_drafted || plan.human_reviewed_by) && (
          // Human-drafted plan OR AI-drafted plan that already has reviewer on file
          <Btn variant="primary" size="sm" disabled={saving} onClick={() => transitionStatus("Active")}>
            {saving ? "Activating..." : "Activate plan"}
          </Btn>
        )}
        {plan.plan_status === "Active" && (
          <Btn variant="outline" size="sm" disabled={saving} onClick={() => transitionStatus("Archived")}>
            {saving ? "Archiving..." : "Archive plan"}
          </Btn>
        )}
        {plan.plan_status === "Archived" && (
          <Btn variant="outline" size="sm" disabled={saving} onClick={() => transitionStatus("Active")}>
            Re-activate
          </Btn>
        )}
        {canDraftReview && (
          <Btn variant="primary" size="sm" onClick={() => setMode("draftReview")}>
            Draft annual review with AI
          </Btn>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        <DetailField label="Status"      value={
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <PlanStatusBadge status={plan.plan_status} />
            {plan.ai_drafted && <Badge label="AI DRAFTED" variant="blue" size="xs" />}
            {plan.ai_drafted && plan.human_reviewed_by && (
              <Badge label="REVIEWED" variant="green" size="xs" />
            )}
          </div>
        } />
        <DetailField label="Version"     value={"v" + plan.version} />
        <DetailField label="Assessment"  value={plan.assessment_date ? new Date(plan.assessment_date).toLocaleDateString() : "-"} />
        <DetailField label="Effective"   value={plan.effective_date ? new Date(plan.effective_date).toLocaleDateString() : "-"} />
        <DetailField label="Last reviewed" value={plan.last_reviewed_at ? new Date(plan.last_reviewed_at).toLocaleDateString() : "-"} />
        <DetailField label="Next review" value={plan.next_review_due ? new Date(plan.next_review_due).toLocaleDateString() : "-"} />
        <DetailField label="Meds reviewed" value={plan.medications_reviewed ? "Yes" : "No"} />
        <DetailField label="Member ack"  value={plan.member_ack_at ? new Date(plan.member_ack_at).toLocaleDateString() : "No"} />
      </div>

      <PlanSection title="Goals"         items={goals}         emptyMsg="No goals recorded" />
      <PlanSection title="Interventions" items={interventions} emptyMsg="No interventions recorded" />
      <PlanSection title="Unmet needs"   items={unmetNeeds}    emptyMsg="No unmet needs recorded" />
      <PlanSection title="Risk factors"  items={riskFactors}   emptyMsg="No risk factors recorded" />
      <PlanSection title="Strengths"     items={strengths}     emptyMsg="No strengths recorded" />
      <PlanSection title="Supports"      items={supports}      emptyMsg="No supports recorded" />

      {/* Review summary - rendered when this plan is the output of an
          annual/interim review. Shows what changed vs. the prior version. */}
      {plan.review_summary && (
        <ReviewSummaryPanel summary={plan.review_summary} priorPlanId={plan.prior_plan_id} />
      )}
    </Modal>
  );
}

function PlanSection({ title, items, emptyMsg }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 8 }}>
        {title} ({items.length})
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: 12, color: C.textTertiary, fontStyle: "italic", padding: "6px 0" }}>{emptyMsg}</div>
      ) : (
        <div style={{ border: "0.5px solid " + C.borderLight, borderRadius: 8 }}>
          {items.map((item, i) => {
            const text = typeof item === "string" ? item : (item.text || item.description || item.name || JSON.stringify(item));
            return (
              <div key={i} style={{ padding: "8px 12px", borderBottom: i < items.length - 1 ? "0.5px solid " + C.borderLight : "none", fontSize: 13 }}>
                {text}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NewPlanModal - create a new care plan linked to an active enrollment.
//
// Plan type defaults based on enrollment health_plan_type:
//   Tailored Plan -> "Care Plan"
//   Standard Plan -> "AMH Tier 3 Care Plan"
//   Other/null    -> "Care Plan" as generic default
//
// v1 goals entry: simple multi-line textarea, one goal per line. Saves as
// a JSONB array of strings.
// ---------------------------------------------------------------------------

function NewPlanModal({ practiceId, userId, onClose, onCreated }) {
  const [enrollments, setEnrollments] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState(null);

  const [enrollmentId, setEnrollmentId]   = useState("");
  const [planType, setPlanType]           = useState("");
  const [assessmentDate, setAssessmentDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [nextReviewDue, setNextReviewDue]   = useState("");
  const [goalsText, setGoalsText]           = useState("");
  const [medsReviewed, setMedsReviewed]     = useState(false);
  const [notes, setNotes]                   = useState("");

  // AI draft state - set when user clicks "Draft with AI".
  // `aiDraft` holds the full structured response so we can save all sections.
  // `aiMeta`  holds model/version/generated_at for the audit fields on save.
  // `goalsBaseline` captures what the textarea looked like right after drafting;
  // if the user edits it, we detect divergence and fall back to simple strings
  // (preserving their edits but losing the AI's per-goal metadata).
  const [aiDrafting, setAiDrafting]     = useState(false);
  const [aiError, setAiError]           = useState(null);
  const [aiDraft, setAiDraft]           = useState(null);
  const [aiMeta, setAiMeta]             = useState(null);
  const [goalsBaseline, setGoalsBaseline] = useState("");

  useEffect(() => {
    if (!practiceId) return;
    supabase
      .from("cm_enrollments")
      .select("id, patient_id, program_type, enrollment_status, health_plan_type, patients(first_name, last_name, mrn)")
      .eq("practice_id", practiceId)
      .in("enrollment_status", ["Active", "Pending"])
      .order("enrollment_status", { ascending: true })
      .then(({ data }) => { setEnrollments(data || []); setLoading(false); });
  }, [practiceId]);

  const selectedEnrollment = useMemo(
    () => enrollments.find(e => e.id === enrollmentId) || null,
    [enrollments, enrollmentId]
  );

  useEffect(() => {
    if (!selectedEnrollment) return;
    if (selectedEnrollment.health_plan_type === "Standard Plan") setPlanType("AMH Tier 3 Care Plan");
    else setPlanType("Care Plan");
    // Clear any prior AI draft when the enrollment changes
    setAiDraft(null);
    setAiMeta(null);
    setAiError(null);
    setGoalsBaseline("");
  }, [selectedEnrollment?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!assessmentDate || nextReviewDue) return;
    const d = new Date(assessmentDate + "T12:00:00Z");
    d.setUTCFullYear(d.getUTCFullYear() + 1);
    setNextReviewDue(d.toISOString().split("T")[0]);
  }, [assessmentDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------------------------------------------------------
  // AI draft call - invokes the cmp-draft-care-plan edge function with the
  // current enrollment. Populates the goals textarea + captures structured
  // sections that will be written on save.
  // -------------------------------------------------------------------------
  const handleAiDraft = async () => {
    if (!enrollmentId) { setAiError("Pick an enrollment first"); return; }
    setAiDrafting(true);
    setAiError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const url = supabase.supabaseUrl + "/functions/v1/cmp-draft-care-plan";
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": "Bearer " + token,
        },
        body: JSON.stringify({ enrollment_id: enrollmentId }),
      });
      const body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || "HTTP " + res.status);

      // Capture goals text + structured data + audit metadata
      setGoalsText(body.goals_text || "");
      setGoalsBaseline(body.goals_text || "");
      setAiDraft(body.structured || null);
      setAiMeta({
        model_used:     body.model_used,
        prompt_version: body.prompt_version,
        generated_at:   body.generated_at,
      });

      // If AI recommends 6-month review cadence, override the 12-month default
      const cadence = body.structured?.recommended_review_cadence_months;
      if (cadence === 6 && assessmentDate) {
        const d = new Date(assessmentDate + "T12:00:00Z");
        d.setUTCMonth(d.getUTCMonth() + 6);
        setNextReviewDue(d.toISOString().split("T")[0]);
      }
    } catch (e) {
      setAiError(e.message || "AI draft failed");
    } finally {
      setAiDrafting(false);
    }
  };

  const save = async () => {
    if (!enrollmentId) { setError("Pick an enrollment"); return; }
    if (!planType)     { setError("Pick a plan type"); return; }

    setSaving(true); setError(null);

    // Goal resolution:
    // - If AI drafted AND the textarea still matches the AI baseline exactly,
    //   save the full structured goal objects (preserves domain/target_date/measure/rationale).
    // - Otherwise the user edited the textarea, so save as simple string array.
    const goalsFromText = goalsText.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    const textareaMatchesBaseline = aiDraft && goalsText === goalsBaseline;
    const goals = textareaMatchesBaseline && Array.isArray(aiDraft.goals) && aiDraft.goals.length > 0
      ? aiDraft.goals
      : goalsFromText;

    const nowIso = new Date().toISOString();
    const payload = {
      practice_id:   practiceId,
      patient_id:    selectedEnrollment.patient_id,
      enrollment_id: enrollmentId,
      plan_type:     planType,
      plan_status:   "Draft",
      assessment_date: assessmentDate || null,
      next_review_due: nextReviewDue || null,
      goals:         goals,
      medications_reviewed: medsReviewed,
      medications_reviewed_at: medsReviewed ? nowIso : null,
      medications_reviewed_by: medsReviewed ? (userId || null) : null,
      notes:         notes.trim() || null,
      created_by:    userId || null,
    };

    // When AI drafted, attach all structured sections + audit flags so the
    // PlanDetailModal will render interventions/unmet_needs/etc. and CMs
    // can see the AI provenance.
    if (aiDraft) {
      payload.interventions = Array.isArray(aiDraft.interventions) ? aiDraft.interventions : [];
      payload.unmet_needs   = Array.isArray(aiDraft.unmet_needs)   ? aiDraft.unmet_needs   : [];
      payload.risk_factors  = Array.isArray(aiDraft.risk_factors)  ? aiDraft.risk_factors  : [];
      payload.strengths     = Array.isArray(aiDraft.strengths)     ? aiDraft.strengths     : [];
      payload.supports      = Array.isArray(aiDraft.supports)      ? aiDraft.supports      : [];
      payload.ai_drafted            = true;
      payload.ai_draft_model        = aiMeta?.model_used || null;
      payload.ai_draft_at           = aiMeta?.generated_at || nowIso;
      payload.ai_draft_prompt_version = aiMeta?.prompt_version || null;
    }

    try {
      const { error: insErr } = await supabase.from("cm_care_plans").insert(payload);
      if (insErr) throw insErr;
      onCreated();
    } catch (e) { setError(e.message || "Failed to create plan"); setSaving(false); }
  };

  if (loading) {
    return (
      <Modal title="New care plan" onClose={onClose} width={760}>
        <Loader label="Loading enrollments..." />
      </Modal>
    );
  }

  return (
    <Modal title="New care plan" onClose={onClose} width={760}>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={{ gridColumn: "1 / -1" }}>
          <FL>Enrollment</FL>
          <select value={enrollmentId} onChange={e => setEnrollmentId(e.target.value)} style={selectStyle}>
            <option value="">-- Pick an enrollment --</option>
            {enrollments.map(e => (
              <option key={e.id} value={e.id}>
                {e.patients?.last_name || ""}, {e.patients?.first_name || ""}
                {e.patients?.mrn ? " (" + e.patients.mrn + ")" : ""} - {e.program_type}{e.health_plan_type ? " / " + e.health_plan_type : ""} [{e.enrollment_status}]
              </option>
            ))}
          </select>
        </div>

        {/* AI Draft call-to-action - appears once an enrollment is picked */}
        {enrollmentId && (
          <div style={{ gridColumn: "1 / -1", padding: 12, background: C.bgSecondary, border: "0.5px solid " + C.borderLight, borderRadius: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary }}>AI draft assistant</div>
                <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 2 }}>
                  {aiDraft
                    ? "Draft generated. Review each section below before saving."
                    : "Pull the member's record (enrollment, touchpoints, HRSN, problem list) and draft SMART goals + interventions + barriers for your review."}
                </div>
              </div>
              <Btn
                variant={aiDraft ? "outline" : "primary"}
                size="sm"
                disabled={aiDrafting}
                onClick={handleAiDraft}
              >
                {aiDrafting ? "Drafting..." : (aiDraft ? "Re-draft" : "Draft with AI")}
              </Btn>
            </div>
            {aiError && (
              <div style={{ marginTop: 8, fontSize: 12, color: C.red, background: C.redBg, padding: "6px 10px", borderRadius: 6, border: "0.5px solid " + C.redBorder }}>
                {aiError}
              </div>
            )}
          </div>
        )}

        <div>
          <FL>Plan type</FL>
          <select value={planType} onChange={e => setPlanType(e.target.value)} style={selectStyle}>
            <option value="">-- Select plan type --</option>
            <option value="Care Plan">Care Plan (TCM)</option>
            <option value="Individual Support Plan">Individual Support Plan</option>
            <option value="AMH Tier 3 Care Plan">AMH Tier 3 Care Plan (Standard Plan)</option>
            <option value="Comprehensive Assessment">Comprehensive Assessment</option>
            <option value="90-Day Transition Plan">90-Day Transition Plan</option>
          </select>
        </div>

        <div>
          <FL>Assessment date</FL>
          <input type="date" value={assessmentDate} onChange={e => setAssessmentDate(e.target.value)} style={inputStyle} />
        </div>

        <div>
          <FL>Next review due</FL>
          <input type="date" value={nextReviewDue} onChange={e => setNextReviewDue(e.target.value)} style={inputStyle} />
          <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 4 }}>
            {aiDraft && aiDraft.recommended_review_cadence_months === 6
              ? "AI recommends 6-month review based on this member's profile"
              : "Default: 1 year after assessment"}
          </div>
        </div>

        <div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginTop: 28 }}>
            <input type="checkbox" checked={medsReviewed} onChange={e => setMedsReviewed(e.target.checked)} />
            <span style={{ fontSize: 13 }}>Medications reviewed</span>
          </label>
        </div>

        {/* Assessment summary - shown when AI drafted */}
        {aiDraft?.assessment_summary && (
          <div style={{ gridColumn: "1 / -1", padding: 12, background: "#f0f9ff", border: "0.5px solid #bae6fd", borderRadius: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#075985", marginBottom: 4 }}>
              AI Assessment Summary
            </div>
            <div style={{ fontSize: 13, color: C.textPrimary, lineHeight: 1.5 }}>
              {aiDraft.assessment_summary}
            </div>
          </div>
        )}

        <div style={{ gridColumn: "1 / -1" }}>
          <FL>Goals (one per line)</FL>
          <textarea
            value={goalsText}
            onChange={e => setGoalsText(e.target.value)}
            rows={5}
            placeholder="Reduce A1C to under 7.0 by next review&#10;Attend all scheduled primary care visits&#10;Fill prescriptions within 48 hours of PCP refill"
            style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
          />
          <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 4 }}>
            {aiDraft
              ? "Edit freely - each non-blank line is a goal. AI-structured metadata (domain, target date, measure) is preserved only if you keep the text exactly as drafted."
              : "Each non-blank line becomes a goal. Interventions and other sections can be added after the plan is created (via MCP for now)."}
          </div>
        </div>

        {/* AI draft preview - read-only cards for the sections that aren't editable in v1 */}
        {aiDraft && (
          <div style={{ gridColumn: "1 / -1" }}>
            <AiDraftPreview draft={aiDraft} />
          </div>
        )}

        <div style={{ gridColumn: "1 / -1" }}>
          <FL>Notes (optional)</FL>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" disabled={saving || !enrollmentId || !planType} onClick={save}>
          {saving ? "Creating..." : "Create as Draft"}
        </Btn>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// AiDraftPreview - read-only preview of the sections the AI drafted.
// For v1 users cannot edit these in the creation modal (they edit post-save
// via MCP or future PlanDetailModal enhancements). Visible tells the CM what
// context the AI included so they can course-correct with a Re-draft.
// ---------------------------------------------------------------------------
function AiDraftPreview({ draft }) {
  const interventions = Array.isArray(draft.interventions) ? draft.interventions : [];
  const unmetNeeds    = Array.isArray(draft.unmet_needs)   ? draft.unmet_needs   : [];
  const riskFactors   = Array.isArray(draft.risk_factors)  ? draft.risk_factors  : [];
  const strengths     = Array.isArray(draft.strengths)     ? draft.strengths     : [];
  const supports      = Array.isArray(draft.supports)      ? draft.supports      : [];
  const quality       = draft.quality_notes || {};

  return (
    <div style={{ padding: 12, background: "#fafafa", border: "0.5px solid " + C.borderLight, borderRadius: 8 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary }}>
          AI draft sections
        </div>
        {quality.data_completeness && (
          <Badge
            label={"DATA " + String(quality.data_completeness).toUpperCase()}
            variant={quality.data_completeness === "high" ? "green" : quality.data_completeness === "medium" ? "amber" : "red"}
            size="xs"
          />
        )}
      </div>

      <AiDraftChunk title="Interventions" items={interventions} render={(i) => (
        <div>
          <div style={{ fontSize: 13, color: C.textPrimary }}>{i.description}</div>
          <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>
            {[i.cadence, i.responsible_party].filter(Boolean).join(" \u00B7 ")}
          </div>
        </div>
      )} />

      <AiDraftChunk title="Unmet needs / barriers" items={unmetNeeds} render={(u) => (
        <div>
          <div style={{ fontSize: 13, color: C.textPrimary, display: "flex", gap: 6, alignItems: "baseline" }}>
            <span>{u.description}</span>
            {u.urgency && <Badge label={String(u.urgency).toUpperCase()} variant={u.urgency === "urgent" ? "red" : u.urgency === "high" ? "amber" : "neutral"} size="xs" />}
          </div>
          {u.mitigation_idea && (
            <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2, fontStyle: "italic" }}>Idea: {u.mitigation_idea}</div>
          )}
        </div>
      )} />

      <AiDraftChunk title="Risk factors" items={riskFactors} render={(r) => (
        <div style={{ fontSize: 13, color: C.textPrimary }}>{r.description}</div>
      )} />

      <AiDraftChunk title="Strengths" items={strengths} render={(s) => (
        <div style={{ fontSize: 13, color: C.textPrimary }}>{typeof s === "string" ? s : (s.text || JSON.stringify(s))}</div>
      )} />

      <AiDraftChunk title="Supports" items={supports} render={(s) => (
        <div>
          <div style={{ fontSize: 13, color: C.textPrimary }}>{s.name}{s.relationship ? " (" + s.relationship + ")" : ""}</div>
          {s.role && <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>{s.role}</div>}
        </div>
      )} />

      {Array.isArray(quality.missing_data_elements) && quality.missing_data_elements.length > 0 && (
        <div style={{ marginTop: 12, padding: 10, background: C.amberBg, border: "0.5px solid " + C.amberBorder, borderRadius: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 4 }}>
            Missing data that would improve this draft
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: C.textPrimary }}>
            {quality.missing_data_elements.map((el, i) => <li key={i}>{el}</li>)}
          </ul>
        </div>
      )}

      <div style={{ marginTop: 10, fontSize: 10, color: C.textTertiary, fontStyle: "italic" }}>
        Clinical review required before finalization.
      </div>
    </div>
  );
}

function AiDraftChunk({ title, items, render }) {
  if (!items || items.length === 0) return null;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.textSecondary, marginBottom: 4 }}>
        {title} ({items.length})
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {items.map((it, i) => (
          <div key={i} style={{ padding: "8px 10px", background: C.bgPrimary, border: "0.5px solid " + C.borderLight, borderRadius: 6 }}>
            {render(it)}
          </div>
        ))}
      </div>
    </div>
  );
}

// ===============================================================================
// Billing Readiness tab
// ===============================================================================
//
// Displays cm_billing_periods - one row per (enrollment, billing_month).
//
// Data pipeline: supabase.rpc("cm_rollup_practice_billing", { practice, month })
// aggregates qualifying touchpoints (counts_toward_tcm_contact) into billing
// period rows, computing readiness flags and claim_status.
//
// v1 simplified rules:
//   - required_contacts_total = 1 for any Active TCM or AMH enrollment
//   - meets_contact_requirements = actual >= required
//   - has_care_manager_majority = care_manager_count >= ceil(total / 2)
//   - Ready when: meets + CM majority + no duplicative
//
// Claim lifecycle (simplified): Not Ready -> Ready (auto) -> Submitted (manual)
//   -> Paid / Denied. No appeal/void UI in v1.
//
// Month is normalized to first-of-month. Prev/next buttons shift by calendar
// month. "Recompute this month" calls the rollup RPC and reloads.
// ===============================================================================

function BillingTab({ practiceId, profile }) {
  const [month, setMonth]             = useState(() => firstOfCurrentMonth());
  const [periods, setPeriods]         = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected]       = useState(null);
  const [rollingUp, setRollingUp]     = useState(false);

  const role = profile?.role;
  const canRecompute  = role && role !== "CHW";
  const canSubmitClaim = role && role !== "CHW";

  const load = () => {
    if (!practiceId) return;
    setLoading(true);
    supabase
      .from("cm_billing_periods")
      .select("id, patient_id, enrollment_id, billing_month, acuity_tier_snapshot, program_type_snapshot, required_contacts_total, actual_contacts_total, actual_in_person, actual_telephonic, actual_video, actual_care_manager_contacts, actual_supervising_contacts, actual_extender_contacts, actual_provider_contacts, meets_contact_requirements, has_care_manager_majority, has_duplicative_service, claim_status, claim_external_id, claim_ready_at, claim_submitted_at, claim_paid_at, claim_paid_amount, claim_denial_code, claim_denial_reason, verification_status, verified_at, flagged_issues, notes, patients(first_name, last_name, mrn), cm_enrollments(health_plan_type, cm_provider_type, payer_name)")
      .eq("practice_id", practiceId)
      .eq("billing_month", month)
      .order("claim_status", { ascending: true })
      .then(({ data, error: e }) => {
        if (e) setError(e.message);
        else setPeriods(data || []);
        setLoading(false);
      });
  };

  useEffect(() => { load(); }, [practiceId, month]);

  const recompute = async () => {
    if (!practiceId) return;
    setRollingUp(true);
    setError(null);
    try {
      const { error: rpcErr } = await supabase.rpc("cm_rollup_practice_billing", {
        p_practice_id: practiceId,
        p_month: month,
      });
      if (rpcErr) throw rpcErr;
      load();
    } catch (e) {
      setError(e.message || "Recompute failed");
    } finally {
      setRollingUp(false);
    }
  };

  // KPIs
  const kpis = useMemo(() => {
    const counts = {
      total:     periods.length,
      ready:     0,
      notReady:  0,
      submitted: 0,
      paid:      0,
      denied:    0,
    };
    for (const p of periods) {
      if (p.claim_status === "Ready")     counts.ready++;
      else if (p.claim_status === "Not Ready") counts.notReady++;
      else if (p.claim_status === "Submitted") counts.submitted++;
      else if (p.claim_status === "Paid")      counts.paid++;
      else if (p.claim_status === "Denied")    counts.denied++;
    }
    return counts;
  }, [periods]);

  const filtered = useMemo(() => {
    if (statusFilter === "all") return periods;
    return periods.filter(p => p.claim_status === statusFilter);
  }, [periods, statusFilter]);

  const monthLabel = new Date(month + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  const shiftMonth = (deltaMonths) => {
    const d = new Date(month + "T12:00:00Z");
    d.setUTCMonth(d.getUTCMonth() + deltaMonths);
    setMonth(d.toISOString().split("T")[0].substring(0, 8) + "01");
  };

  return (
    <div>
      {/* Month selector + recompute */}
      <Card style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, padding: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Btn variant="outline" size="sm" onClick={() => shiftMonth(-1)}>&larr; Prev</Btn>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary, minWidth: 160, textAlign: "center" }}>
            {monthLabel}
          </div>
          <Btn variant="outline" size="sm" onClick={() => shiftMonth(1)}>Next &rarr;</Btn>
          <Btn variant="ghost" size="sm" onClick={() => setMonth(firstOfCurrentMonth())}>Current</Btn>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {canRecompute && (
            <Btn variant="primary" size="sm" disabled={rollingUp} onClick={recompute}>
              {rollingUp ? "Recomputing..." : "Recompute this month"}
            </Btn>
          )}
          <Btn variant="outline" size="sm" onClick={load}>Refresh</Btn>
        </div>
      </Card>

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 20 }}>
        <KpiCard label="Billable periods" value={kpis.total}     hint="Enrollments this month" />
        <KpiCard label="Ready to bill"    value={kpis.ready}     hint="Meet floor + CM majority" variant={kpis.ready > 0 ? "green" : "neutral"} />
        <KpiCard label="Not ready"        value={kpis.notReady}  hint="Missing contacts" variant={kpis.notReady > 0 ? "amber" : "neutral"} />
        <KpiCard label="Submitted"        value={kpis.submitted} hint="Awaiting payment" variant="blue" />
        <KpiCard label="Paid"             value={kpis.paid}      hint="Revenue collected" variant="green" />
        {kpis.denied > 0 && (
          <KpiCard label="Denied"         value={kpis.denied}    hint="Needs follow-up" variant="red" />
        )}
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {/* Filter bar */}
      <Card style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, padding: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textTertiary, marginRight: 4 }}>Status</span>
        {["all", "Ready", "Not Ready", "Submitted", "Paid", "Denied"].map(s => (
          <FilterPill key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)}>
            {s === "all" ? "All" : s}
          </FilterPill>
        ))}
      </Card>

      {/* Table */}
      <Card>
        {loading ? (
          <Loader label="Loading billing periods..." />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={periods.length === 0 ? "No billing periods for " + monthLabel : "No periods match filter"}
            message={periods.length === 0 ? "Click \"Recompute this month\" to aggregate touchpoints into billing periods." : "Change the status filter to see more results."}
          />
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                <Th>Patient</Th>
                <Th>Program</Th>
                <Th align="right">Contacts</Th>
                <Th>Methods</Th>
                <Th>Flags</Th>
                <Th>Claim</Th>
                <Th>Verification</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(bp => {
                const met  = bp.meets_contact_requirements;
                const maj  = bp.has_care_manager_majority;
                const dup  = bp.has_duplicative_service;
                return (
                  <tr key={bp.id} onClick={() => setSelected(bp)} style={{ cursor: "pointer" }}>
                    <Td>
                      <div style={{ fontWeight: 600 }}>
                        {bp.patients?.last_name || ""}, {bp.patients?.first_name || ""}
                      </div>
                      {bp.patients?.mrn && (
                        <div style={{ fontSize: 11, color: C.textTertiary, fontFamily: "monospace", marginTop: 2 }}>{bp.patients.mrn}</div>
                      )}
                    </Td>
                    <Td>
                      <div>{bp.program_type_snapshot}</div>
                      <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>
                        {bp.cm_enrollments?.health_plan_type || "-"}
                        {bp.acuity_tier_snapshot ? " | " + bp.acuity_tier_snapshot : ""}
                      </div>
                    </Td>
                    <Td align="right">
                      <span style={{ color: met ? C.green : C.red, fontWeight: 700 }}>
                        {bp.actual_contacts_total}
                      </span>
                      <span style={{ color: C.textTertiary }}> / {bp.required_contacts_total}</span>
                    </Td>
                    <Td>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", fontSize: 11 }}>
                        {bp.actual_in_person  > 0 && <span style={{ color: C.textSecondary }}>IP:{bp.actual_in_person}</span>}
                        {bp.actual_telephonic > 0 && <span style={{ color: C.textSecondary }}>Tel:{bp.actual_telephonic}</span>}
                        {bp.actual_video      > 0 && <span style={{ color: C.textSecondary }}>Vid:{bp.actual_video}</span>}
                        {bp.actual_contacts_total === 0 && <span style={{ color: C.textTertiary }}>none</span>}
                      </div>
                    </Td>
                    <Td>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {!met && <Badge label="UNDER FLOOR" variant="red" size="xs" />}
                        {met && !maj && <Badge label="NO CM MAJORITY" variant="amber" size="xs" />}
                        {dup && <Badge label="DUPLICATIVE" variant="red" size="xs" />}
                      </div>
                    </Td>
                    <Td><ClaimStatusBadge status={bp.claim_status} /></Td>
                    <Td><VerificationBadge status={bp.verification_status} /></Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {selected && (
        <BillingPeriodDetailModal
          period={selected}
          userId={profile?.id}
          canSubmitClaim={canSubmitClaim}
          onClose={() => setSelected(null)}
          onUpdated={() => { setSelected(null); load(); }}
        />
      )}
    </div>
  );
}

// Helper: first of current calendar month as YYYY-MM-DD
function firstOfCurrentMonth() {
  const now = new Date();
  return now.getUTCFullYear() + "-" + String(now.getUTCMonth() + 1).padStart(2, "0") + "-01";
}

function ClaimStatusBadge({ status }) {
  const map = {
    "Not Ready": "neutral",
    "Ready":     "green",
    "Submitted": "blue",
    "Paid":      "green",
    "Denied":    "red",
    "Appealed":  "amber",
    "Void":      "neutral",
  };
  return <Badge label={status} variant={map[status] || "neutral"} size="xs" />;
}

function VerificationBadge({ status }) {
  if (!status || status === "Not Reviewed") {
    return <span style={{ fontSize: 11, color: C.textTertiary }}>-</span>;
  }
  const map = { "Reviewed": "blue", "Approved": "green", "Flagged": "red" };
  return <Badge label={status} variant={map[status] || "neutral"} size="xs" />;
}

// ---------------------------------------------------------------------------
// BillingPeriodDetailModal - breakdown of a billing period with claim
// lifecycle actions and verification controls.
// ---------------------------------------------------------------------------

function BillingPeriodDetailModal({ period, userId, canSubmitClaim, onClose, onUpdated }) {
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);
  const [showSubmit, setShowSubmit]   = useState(false);
  const [showPaid, setShowPaid]       = useState(false);
  const [showDenied, setShowDenied]   = useState(false);
  const [claimExtId, setClaimExtId]   = useState("");
  const [paidAmount, setPaidAmount]   = useState("");
  const [denialCode, setDenialCode]   = useState("");
  const [denialReason, setDenialReason] = useState("");

  // AI explainer state. The edge function returns a structured analysis with
  // status assessment, path-to-ready steps, audit risks, and recommended
  // actions. `aiContext` holds the small metadata packet (billing_month,
  // days_remaining, etc.) so the UI can show deadlines without recomputing.
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiAnalysis, setAiAnalysis]   = useState(null);
  const [aiContext, setAiContext]     = useState(null);
  const [aiError, setAiError]         = useState(null);

  const title = (period.patients?.first_name || "") + " " + (period.patients?.last_name || "")
    + " - " + new Date(period.billing_month + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  const patchBillingPeriod = async (patch) => {
    setSaving(true); setError(null);
    try {
      const { error: updErr } = await supabase
        .from("cm_billing_periods")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", period.id);
      if (updErr) throw updErr;
      onUpdated();
    } catch (e) {
      setError(e.message || "Update failed");
      setSaving(false);
    }
  };

  const submitClaim = async () => {
    if (!claimExtId.trim()) { setError("External claim ID required"); return; }
    await patchBillingPeriod({
      claim_status:        "Submitted",
      claim_external_id:   claimExtId.trim(),
      claim_submitted_at:  new Date().toISOString(),
      claim_submitted_by:  userId || null,
      claim_ready_at:      period.claim_ready_at || new Date().toISOString(),
    });
  };

  const markPaid = async () => {
    const amt = parseFloat(paidAmount);
    if (isNaN(amt) || amt < 0) { setError("Valid paid amount required"); return; }
    await patchBillingPeriod({
      claim_status:      "Paid",
      claim_paid_at:     new Date().toISOString(),
      claim_paid_amount: amt,
    });
  };

  const markDenied = async () => {
    if (!denialReason.trim()) { setError("Denial reason required"); return; }
    await patchBillingPeriod({
      claim_status:        "Denied",
      claim_denial_code:   denialCode.trim() || null,
      claim_denial_reason: denialReason.trim(),
    });
  };

  const approveVerification = async () => {
    await patchBillingPeriod({
      verification_status: "Approved",
      verified_at:         new Date().toISOString(),
      verified_by:         userId || null,
    });
  };

  // -------------------------------------------------------------------------
  // AI explainer - calls cmp-billing-explainer and renders the structured
  // analysis inline. Works for all claim statuses; the edge function returns
  // different sections based on status (path_to_ready vs audit_risks vs
  // denial_analysis). Re-runnable by clicking again.
  // -------------------------------------------------------------------------
  const handleAiAnalyze = async () => {
    setAiAnalyzing(true);
    setAiError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const url = supabase.supabaseUrl + "/functions/v1/cmp-billing-explainer";
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": "Bearer " + token,
        },
        body: JSON.stringify({ billing_period_id: period.id }),
      });
      const body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || "HTTP " + res.status);

      setAiAnalysis(body.analysis || null);
      setAiContext(body.context || null);
    } catch (e) {
      setAiError(e.message || "AI analysis failed");
    } finally {
      setAiAnalyzing(false);
    }
  };

  const roleRows = [
    ["Care Manager",             period.actual_care_manager_contacts],
    ["Supervising Care Manager", period.actual_supervising_contacts],
    ["Extender",                 period.actual_extender_contacts],
    ["Provider",                 period.actual_provider_contacts],
  ].filter(r => r[1] > 0);

  const methodRows = [
    ["In Person",  period.actual_in_person],
    ["Telephonic", period.actual_telephonic],
    ["Video",      period.actual_video],
  ].filter(r => r[1] > 0);

  const flags = Array.isArray(period.flagged_issues) ? period.flagged_issues : [];

  // Which action buttons should be shown. Precomputed so the action row
  // only renders when at least one is available (avoids empty bordered row).
  const showReady     = period.claim_status === "Ready"     && canSubmitClaim && !showSubmit;
  const showSubmitted = period.claim_status === "Submitted" && canSubmitClaim && !showPaid && !showDenied;
  const showVerify    = period.verification_status !== "Approved" && canSubmitClaim;

  return (
    <Modal title={title} onClose={onClose} width={760}>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {/* Toolbar: Explain with AI always available; claim lifecycle actions conditional */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, paddingBottom: 12, borderBottom: "0.5px solid " + C.borderLight, flexWrap: "wrap" }}>
        <Btn
          variant={aiAnalysis ? "outline" : "primary"}
          size="sm"
          disabled={aiAnalyzing}
          onClick={handleAiAnalyze}
        >
          {aiAnalyzing ? "Analyzing..." : (aiAnalysis ? "Re-analyze" : "Explain with AI")}
        </Btn>
        {showReady && (
          <Btn variant="primary" size="sm" onClick={() => setShowSubmit(true)}>Submit claim</Btn>
        )}
        {showSubmitted && (
          <>
            <Btn variant="primary" size="sm" onClick={() => setShowPaid(true)}>Mark paid</Btn>
            <Btn variant="outline" size="sm" onClick={() => setShowDenied(true)} style={{ color: C.red, borderColor: C.redBorder }}>Mark denied</Btn>
          </>
        )}
        {showVerify && (
          <Btn variant="outline" size="sm" disabled={saving} onClick={approveVerification}>
            {saving ? "Approving..." : "Mark verified"}
          </Btn>
        )}
      </div>

      {/* AI analysis error + result */}
      {aiError && (
        <div style={{ marginBottom: 16, fontSize: 12, color: C.red, background: C.redBg, padding: "10px 12px", borderRadius: 8, border: "0.5px solid " + C.redBorder }}>
          {aiError}
        </div>
      )}
      {aiAnalysis && (
        <BillingAnalysisCard analysis={aiAnalysis} context={aiContext} claimStatus={period.claim_status} />
      )}

      {/* Inline submit claim form */}
      {showSubmit && (
        <div style={{ padding: 12, marginBottom: 16, background: C.bgSecondary, borderRadius: 8 }}>
          <FL>External claim ID (from billing system)</FL>
          <input type="text" value={claimExtId} onChange={e => setClaimExtId(e.target.value)} placeholder="e.g. CLM-2026-04-00123" style={{ ...inputStyle, fontFamily: "monospace" }} />
          <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
            <Btn variant="ghost" size="sm" onClick={() => { setShowSubmit(false); setClaimExtId(""); }}>Cancel</Btn>
            <Btn variant="primary" size="sm" disabled={saving || !claimExtId.trim()} onClick={submitClaim}>
              {saving ? "Submitting..." : "Confirm submission"}
            </Btn>
          </div>
        </div>
      )}

      {/* Inline mark paid form */}
      {showPaid && (
        <div style={{ padding: 12, marginBottom: 16, background: C.bgSecondary, borderRadius: 8 }}>
          <FL>Paid amount (USD)</FL>
          <input type="number" step="0.01" value={paidAmount} onChange={e => setPaidAmount(e.target.value)} placeholder="0.00" style={inputStyle} />
          <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
            <Btn variant="ghost" size="sm" onClick={() => { setShowPaid(false); setPaidAmount(""); }}>Cancel</Btn>
            <Btn variant="primary" size="sm" disabled={saving || !paidAmount} onClick={markPaid}>
              {saving ? "Saving..." : "Confirm payment"}
            </Btn>
          </div>
        </div>
      )}

      {/* Inline mark denied form */}
      {showDenied && (
        <div style={{ padding: 12, marginBottom: 16, background: C.bgSecondary, borderRadius: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
            <div>
              <FL>Denial code (optional)</FL>
              <input type="text" value={denialCode} onChange={e => setDenialCode(e.target.value)} placeholder="e.g. CO-97" style={{ ...inputStyle, fontFamily: "monospace" }} />
            </div>
            <div>
              <FL>Denial reason</FL>
              <input type="text" value={denialReason} onChange={e => setDenialReason(e.target.value)} placeholder="e.g. Duplicate service" style={inputStyle} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
            <Btn variant="ghost" size="sm" onClick={() => { setShowDenied(false); setDenialCode(""); setDenialReason(""); }}>Cancel</Btn>
            <Btn variant="primary" size="sm" disabled={saving || !denialReason.trim()} onClick={markDenied} style={{ background: C.red, borderColor: C.red }}>
              {saving ? "Saving..." : "Confirm denial"}
            </Btn>
          </div>
        </div>
      )}

      {/* Summary row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        <DetailField label="Program"          value={period.program_type_snapshot} />
        <DetailField label="Plan"             value={period.cm_enrollments?.health_plan_type || "-"} />
        <DetailField label="Acuity"           value={period.acuity_tier_snapshot || "-"} />
        <DetailField label="Provider"         value={period.cm_enrollments?.cm_provider_type || "-"} />
        <DetailField label="Claim status"     value={<ClaimStatusBadge status={period.claim_status} />} />
        <DetailField label="Verification"     value={<VerificationBadge status={period.verification_status} />} />
        <DetailField label="Contacts"         value={period.actual_contacts_total + " / " + period.required_contacts_total} />
        <DetailField label="CM majority"      value={period.has_care_manager_majority ? "Yes" : "No"} />
      </div>

      {/* Claim lifecycle audit */}
      {(period.claim_ready_at || period.claim_submitted_at || period.claim_paid_at) && (
        <div style={{ marginBottom: 20, padding: 12, background: C.bgSecondary, borderRadius: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 8 }}>
            Claim lifecycle
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.8 }}>
            {period.claim_ready_at && <div>Ready: {new Date(period.claim_ready_at).toLocaleString()}</div>}
            {period.claim_submitted_at && (
              <div>
                Submitted: {new Date(period.claim_submitted_at).toLocaleString()}
                {period.claim_external_id && <span style={{ fontFamily: "monospace", color: C.textSecondary }}> ({period.claim_external_id})</span>}
              </div>
            )}
            {period.claim_paid_at && (
              <div style={{ color: C.green }}>
                Paid: {new Date(period.claim_paid_at).toLocaleString()}
                {period.claim_paid_amount && <span> - ${Number(period.claim_paid_amount).toFixed(2)}</span>}
              </div>
            )}
            {period.claim_denial_reason && (
              <div style={{ color: C.red }}>
                Denied: {period.claim_denial_code ? "[" + period.claim_denial_code + "] " : ""}{period.claim_denial_reason}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Contact breakdown */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 8 }}>
          Qualifying contacts ({period.actual_contacts_total})
        </div>
        {period.actual_contacts_total === 0 ? (
          <div style={{ fontSize: 12, color: C.textTertiary, fontStyle: "italic", padding: "6px 0" }}>
            No qualifying contacts logged this month. Log touchpoints from the Touchpoints tab - only successful contacts via In Person, Telephonic, or Video count toward the billing floor.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <div style={{ fontSize: 11, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>By method</div>
              {methodRows.map(([label, count]) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13 }}>
                  <span>{label}</span>
                  <span style={{ fontWeight: 600 }}>{count}</span>
                </div>
              ))}
            </div>
            <div>
              <div style={{ fontSize: 11, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>By role</div>
              {roleRows.map(([label, count]) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13 }}>
                  <span>{label}</span>
                  <span style={{ fontWeight: 600 }}>{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Flagged issues */}
      {flags.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 8 }}>
            Flagged issues ({flags.length})
          </div>
          <div style={{ border: "0.5px solid " + C.redBorder, borderRadius: 8, background: C.redBg }}>
            {flags.map((f, i) => {
              const text = typeof f === "string" ? f : (f.message || f.description || JSON.stringify(f));
              return (
                <div key={i} style={{ padding: "8px 12px", borderBottom: i < flags.length - 1 ? "0.5px solid " + C.redBorder : "none", fontSize: 13 }}>
                  {text}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {period.notes && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 8 }}>
            Notes
          </div>
          <div style={{ fontSize: 13, padding: "8px 12px", background: C.bgSecondary, borderRadius: 8 }}>
            {period.notes}
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// NewEnrollmentModal - create a new Care Management enrollment.
//
// Enrollment has three plan-related dimensions:
//   1. health_plan_type - Tailored Plan / Standard Plan / Other (or null for informal)
//   2. program_type     - TCM / AMH / General Engagement / Other
//   3. cm_provider_type - AMH+ / AMH Tier 3 / CMA / CIN / Other
//      (Plan-based excluded: practices do not enroll plan-managed members)
//
// Valid combinations are enforced by PLAN_PROGRAM_MATRIX in cmCadence.js:
//   Tailored Plan -> TCM, delivered by AMH+ / CMA / CIN
//   Standard Plan -> AMH, delivered by AMH Tier 3 / CIN
//   Other         -> General Engagement or Other, any provider
//   (null plan)   -> informal, no constraint
//
// The "Allow nonstandard combination" override exists for edge cases
// (plan transitions, dual enrollment, etc.) that do not fit the matrix.
//
// Acuity tier only applies to Tailored Plan (TCM) enrollments.
//
// Partial-unique index on (patient_id, program_type) WHERE status='Active'
// prevents duplicate active enrollments. Surfaced as UX warning before save.
// ---------------------------------------------------------------------------

const ALL_PROGRAM_TYPES = [
  "TCM",
  "AMH",
  "General Engagement",
  "Other",
];

const ALL_PROVIDER_TYPES = [
  "AMH+",
  "AMH Tier 3",
  "CMA",
  "CIN",
  "Other",
];

function NewEnrollmentModal({ practiceId, userId, onClose, onCreated }) {
  const [patients, setPatients]           = useState([]);
  const [existing, setExisting]           = useState([]);
  const [careManagers, setCareManagers]   = useState([]);
  const [loading, setLoading]             = useState(true);

  // Form state
  const [patientSearch, setPatientSearch] = useState("");
  const [patientId, setPatientId]         = useState("");
  const [planType, setPlanType]           = useState("");
  const [programType, setProgramType]     = useState("");
  const [providerType, setProviderType]   = useState("");
  const [allowOverride, setAllowOverride] = useState(false);
  const [payerName, setPayerName]         = useState("");
  const [planMemberId, setPlanMemberId]   = useState("");
  const [acuityTier, setAcuityTier]       = useState("");
  const [status, setStatus]               = useState("Pending");
  const [enrolledAt, setEnrolledAt]       = useState(() => new Date().toISOString().split("T")[0]);
  const [assignedCM, setAssignedCM]       = useState("");
  const [hopEligible, setHopEligible]     = useState(false);
  const [notes, setNotes]                 = useState("");

  const [saving, setSaving]               = useState(false);
  const [error, setError]                 = useState(null);
  const [autoFilledFrom, setAutoFilledFrom] = useState("");

  // Load lookup data in parallel
  useEffect(() => {
    if (!practiceId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      supabase
        .from("patients")
        .select("id, first_name, last_name, mrn, date_of_birth")
        .eq("practice_id", practiceId)
        .order("last_name", { ascending: true })
        .limit(2000),
      supabase
        .from("cm_enrollments")
        .select("patient_id, program_type, enrollment_status")
        .eq("practice_id", practiceId)
        .eq("enrollment_status", "Active"),
      supabase
        .from("users")
        .select("id, full_name, role")
        .eq("practice_id", practiceId)
        .in("role", ["Care Manager", "Supervising Care Manager", "Care Manager Supervisor"])
        .order("full_name", { ascending: true }),
    ]).then(([pRes, eRes, cmRes]) => {
      if (cancelled) return;
      setPatients(pRes.data || []);
      setExisting(eRes.data || []);
      setCareManagers(cmRes.data || []);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [practiceId]);

  // Cascade: when plan type changes, auto-set program and reset provider
  // if the current provider is no longer valid for the new plan.
  useEffect(() => {
    if (!planType) return;
    const rule = PLAN_PROGRAM_MATRIX[planType];
    if (!rule) return;
    // Auto-set program_type when rule has a canonical program
    if (rule.program) {
      setProgramType(rule.program);
    }
    // Clear provider if not in the allowed set (unless override active)
    if (rule.providers && providerType && !allowOverride && !rule.providers.includes(providerType)) {
      setProviderType("");
    }
    // Clear acuity if moving to Standard or Other (acuity only meaningful for Tailored)
    if (planType !== "Tailored Plan") {
      setAcuityTier("");
    }
  }, [planType]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-populate from patient insurance when a patient is selected.
  //
  // Pulls rank=1 active insurance policy and:
  //   - Pre-fills payer_name + plan_member_id (if those fields are empty)
  //   - Derives health_plan_type from payer_category:
  //       "NC Medicaid - Tailored"  -> "Tailored Plan"
  //       "NC Medicaid - Standard"  -> "Standard Plan"
  //       anything else             -> left null (user picks)
  //   - Program type cascades automatically via the plan-cascade useEffect
  //
  // Only fills empty fields - won't clobber anything the user already typed.
  // Shows a small info banner so the user knows auto-fill happened.
  useEffect(() => {
    if (!patientId) { setAutoFilledFrom(""); return; }
    let cancelled = false;
    supabase
      .from("insurance_policies")
      .select("payer_category, payer_name, member_id")
      .eq("patient_id", patientId)
      .eq("is_active", true)
      .order("rank", { ascending: true })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return;
        if (!payerName.trim())    setPayerName(data.payer_name || "");
        if (!planMemberId.trim()) setPlanMemberId(data.member_id || "");
        if (!planType) {
          if (data.payer_category === "NC Medicaid - Tailored")      setPlanType("Tailored Plan");
          else if (data.payer_category === "NC Medicaid - Standard") setPlanType("Standard Plan");
        }
        setAutoFilledFrom(data.payer_name || "insurance on file");
      });
    return () => { cancelled = true; };
  }, [patientId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Patient search filtering
  const patientMatches = useMemo(() => {
    if (!patientSearch.trim()) return patients.slice(0, 25);
    const q = patientSearch.trim().toLowerCase();
    return patients.filter(p => {
      const name = ((p.first_name || "") + " " + (p.last_name || "")).toLowerCase();
      const mrn  = (p.mrn || "").toLowerCase();
      return name.includes(q) || mrn.includes(q);
    }).slice(0, 25);
  }, [patients, patientSearch]);

  const selectedPatient = useMemo(
    () => patients.find(p => p.id === patientId) || null,
    [patients, patientId]
  );

  // Duplicate check: does this (patient, program) already have an Active?
  const duplicateWarning = useMemo(() => {
    if (!patientId || !programType) return null;
    const dup = existing.find(e => e.patient_id === patientId && e.program_type === programType);
    return dup ? "This patient already has an Active enrollment in " + programType + ". Disenroll the existing enrollment first, or pick a different program." : null;
  }, [patientId, programType, existing]);

  // Plan/program/provider validation
  const combinationWarning = useMemo(() => {
    if (allowOverride) return null;
    return validatePlanProgramProvider(planType, programType, providerType);
  }, [planType, programType, providerType, allowOverride]);

  // Which program types are valid for the chosen plan?
  const allowedPrograms = useMemo(() => {
    if (!planType || allowOverride) return ALL_PROGRAM_TYPES;
    const rule = PLAN_PROGRAM_MATRIX[planType];
    if (!rule) return ALL_PROGRAM_TYPES;
    if (rule.program) return [rule.program];
    // Other plan type: General Engagement / Other only
    return ["General Engagement", "Other"];
  }, [planType, allowOverride]);

  // Which provider types are valid for the chosen plan?
  const allowedProviders = useMemo(() => {
    if (!planType || allowOverride) return ALL_PROVIDER_TYPES;
    const rule = PLAN_PROGRAM_MATRIX[planType];
    return (rule && rule.providers) ? rule.providers : ALL_PROVIDER_TYPES;
  }, [planType, allowOverride]);

  const showAcuity = planType === "Tailored Plan" || (allowOverride && planType);

  const save = async () => {
    if (!patientId)     { setError("Pick a patient"); return; }
    if (!programType)   { setError("Pick a program type"); return; }
    if (duplicateWarning)   { setError(duplicateWarning); return; }
    if (combinationWarning) { setError(combinationWarning + " (check the override box to proceed anyway)"); return; }
    if (status === "Active" && !enrolledAt) { setError("Enrolled date required for Active status"); return; }

    setSaving(true);
    setError(null);

    const nowIso = new Date().toISOString();
    const payload = {
      practice_id:       practiceId,
      patient_id:        patientId,
      program_type:      programType,
      enrollment_status: status,
      created_by:        userId || null,
    };
    if (planType)         payload.health_plan_type = planType;
    if (providerType)     payload.cm_provider_type = providerType;
    if (payerName.trim())    payload.payer_name     = payerName.trim();
    if (planMemberId.trim()) payload.plan_member_id = planMemberId.trim();
    if (showAcuity && acuityTier) {
      payload.acuity_tier         = acuityTier;
      payload.acuity_tier_set_at  = nowIso;
      payload.acuity_tier_set_by  = userId || null;
    }
    if (status === "Active" && enrolledAt) {
      payload.enrolled_at = new Date(enrolledAt + "T12:00:00Z").toISOString();
    }
    if (assignedCM) {
      payload.assigned_care_manager_id = assignedCM;
      payload.assigned_at              = nowIso;
    }
    if (hopEligible) payload.hop_eligible = true;
    if (notes.trim())  payload.notes = notes.trim();

    try {
      const { error: insErr } = await supabase.from("cm_enrollments").insert(payload);
      if (insErr) throw insErr;
      onCreated();
    } catch (e) {
      setError(e.message || "Failed to create enrollment");
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Modal title="New enrollment" onClose={onClose} width={760}>
        <Loader label="Loading practice patients..." />
      </Modal>
    );
  }

  return (
    <Modal title="New enrollment" onClose={onClose} width={760}>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {/* Patient picker */}
        <div style={{ gridColumn: "1 / -1" }}>
          <FL>Patient</FL>
          {selectedPatient ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", border: "0.5px solid " + C.borderLight, borderRadius: 8, background: C.bgSecondary }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary }}>
                  {selectedPatient.last_name}, {selectedPatient.first_name}
                </div>
                <div style={{ fontSize: 11, color: C.textTertiary, fontFamily: "monospace", marginTop: 2 }}>
                  {selectedPatient.mrn || "no MRN"}
                  {selectedPatient.date_of_birth ? " | DOB " + new Date(selectedPatient.date_of_birth).toLocaleDateString() : ""}
                </div>
              </div>
              <Btn size="sm" variant="outline" onClick={() => { setPatientId(""); setPatientSearch(""); setAutoFilledFrom(""); }}>
                Change
              </Btn>
            </div>
          ) : (
            <div>
              <input
                type="text"
                value={patientSearch}
                onChange={e => setPatientSearch(e.target.value)}
                placeholder="Search by name or MRN..."
                style={{ ...inputStyle, width: "100%" }}
              />
              {patientSearch.trim() && (
                <div style={{ marginTop: 6, maxHeight: 180, overflow: "auto", border: "0.5px solid " + C.borderLight, borderRadius: 8 }}>
                  {patientMatches.length === 0 ? (
                    <div style={{ padding: 12, fontSize: 12, color: C.textTertiary, textAlign: "center" }}>
                      No patients match "{patientSearch}"
                    </div>
                  ) : patientMatches.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => { setPatientId(p.id); setPatientSearch(""); }}
                      style={{
                        display: "block", width: "100%", textAlign: "left",
                        padding: "8px 12px", border: "none",
                        borderBottom: "0.5px solid " + C.borderLight,
                        background: C.bgPrimary, cursor: "pointer",
                        fontFamily: "inherit", fontSize: 13,
                      }}
                    >
                      <div style={{ fontWeight: 600, color: C.textPrimary }}>
                        {p.last_name}, {p.first_name}
                      </div>
                      <div style={{ fontSize: 11, color: C.textTertiary, fontFamily: "monospace" }}>
                        {p.mrn || "no MRN"}
                        {p.date_of_birth ? " | DOB " + new Date(p.date_of_birth).toLocaleDateString() : ""}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {autoFilledFrom && (
          <div style={{ gridColumn: "1 / -1", padding: "8px 12px", background: C.bgSecondary, border: "0.5px solid " + C.borderLight, borderRadius: 8, fontSize: 12, color: C.textSecondary }}>
            <strong>Auto-filled</strong> payer, plan type, and member ID from {autoFilledFrom} on file. Edit any field to override.
          </div>
        )}

        {/* Plan type picker - drives program + provider cascades */}
        <div>
          <FL>Health plan type</FL>
          <select value={planType} onChange={e => setPlanType(e.target.value)} style={selectStyle}>
            <option value="">-- Select plan type --</option>
            <option value="Tailored Plan">Tailored Plan (TCM universe)</option>
            <option value="Standard Plan">Standard Plan (AMH universe)</option>
            <option value="Other">Other / Not applicable</option>
          </select>
          {planType && PLAN_PROGRAM_MATRIX[planType] && PLAN_PROGRAM_MATRIX[planType].program && !allowOverride && (
            <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 4 }}>
              Program auto-set to {PLAN_PROGRAM_MATRIX[planType].program}
            </div>
          )}
        </div>

        <div>
          <FL>Program type</FL>
          <select value={programType} onChange={e => setProgramType(e.target.value)} style={selectStyle}>
            <option value="">-- Select program --</option>
            {allowedPrograms.map(pt => (
              <option key={pt} value={pt}>{pt}</option>
            ))}
          </select>
        </div>

        <div>
          <FL>CM provider type</FL>
          <select value={providerType} onChange={e => setProviderType(e.target.value)} style={selectStyle}>
            <option value="">-- Select provider --</option>
            {allowedProviders.map(pt => (
              <option key={pt} value={pt}>{pt}</option>
            ))}
          </select>
          {planType === "Tailored Plan" && !allowOverride && (
            <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 4 }}>
              Tailored Plan: AMH+, CMA, or CIN
            </div>
          )}
          {planType === "Standard Plan" && !allowOverride && (
            <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 4 }}>
              Standard Plan: AMH Tier 3 or CIN
            </div>
          )}
        </div>

        <div>
          <FL>Initial status</FL>
          <select value={status} onChange={e => setStatus(e.target.value)} style={selectStyle}>
            <option value="Pending">Pending (outreach not started)</option>
            <option value="Active">Active (consented + engaged)</option>
            <option value="On Hold">On Hold</option>
          </select>
        </div>

        {/* Override checkbox - gates the plan/program/provider validation */}
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.textSecondary, cursor: "pointer", padding: "6px 10px", background: allowOverride ? C.amberBg : "transparent", border: "0.5px solid " + (allowOverride ? C.amberBorder : C.borderLight), borderRadius: 8 }}>
            <input type="checkbox" checked={allowOverride} onChange={e => setAllowOverride(e.target.checked)} />
            <div>
              <strong>Allow nonstandard plan/program/provider combination</strong>
              <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 1 }}>
                Override the validation matrix. Use only for plan transitions, dual enrollment, or legacy data - document the reason in the notes field.
              </div>
            </div>
          </label>
        </div>

        <div>
          <FL>Payer name (optional)</FL>
          <input
            type="text"
            value={payerName}
            onChange={e => setPayerName(e.target.value)}
            placeholder="e.g. Vaya Health, Alliance Health"
            style={inputStyle}
          />
        </div>

        <div>
          <FL>Plan member ID / CNDS (optional)</FL>
          <input
            type="text"
            value={planMemberId}
            onChange={e => setPlanMemberId(e.target.value)}
            placeholder="e.g. 944HG128X2"
            style={{ ...inputStyle, fontFamily: "monospace" }}
          />
        </div>

        {showAcuity && (
          <div>
            <FL>Acuity tier (Tailored Plan / TCM only)</FL>
            <select value={acuityTier} onChange={e => setAcuityTier(e.target.value)} style={selectStyle}>
              <option value="">-- Not yet set --</option>
              <option value="High">High</option>
              <option value="Moderate">Moderate</option>
              <option value="Low">Low</option>
            </select>
          </div>
        )}

        <div>
          <FL>Assigned care manager (optional)</FL>
          <select value={assignedCM} onChange={e => setAssignedCM(e.target.value)} style={selectStyle}>
            <option value="">-- Unassigned --</option>
            {careManagers.map(cm => (
              <option key={cm.id} value={cm.id}>{cm.full_name} ({cm.role})</option>
            ))}
          </select>
        </div>

        {status === "Active" && (
          <div>
            <FL>Enrolled date</FL>
            <input
              type="date"
              value={enrolledAt}
              onChange={e => setEnrolledAt(e.target.value)}
              style={inputStyle}
            />
          </div>
        )}

        <div style={{ gridColumn: "1 / -1" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "8px 0" }}>
            <input type="checkbox" checked={hopEligible} onChange={e => setHopEligible(e.target.checked)} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>
                HOP eligible
              </div>
              <div style={{ fontSize: 11, color: C.textSecondary, marginTop: 2 }}>
                Patient is eligible for Healthy Opportunities Pilot HRSN interventions. HOP active can be toggled later based on interventions.
              </div>
            </div>
          </label>
        </div>

        <div style={{ gridColumn: "1 / -1" }}>
          <FL>Notes (optional)</FL>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            placeholder="Referral source, outreach strategy, initial clinical context..."
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </div>
      </div>

      {duplicateWarning && (
        <div style={{ marginTop: 12, padding: 12, background: C.amberBg, border: "0.5px solid " + C.amberBorder, borderRadius: 8, fontSize: 12, color: C.textPrimary }}>
          <strong>Duplicate check:</strong> {duplicateWarning}
        </div>
      )}

      {combinationWarning && (
        <div style={{ marginTop: 12, padding: 12, background: C.amberBg, border: "0.5px solid " + C.amberBorder, borderRadius: 8, fontSize: 12, color: C.textPrimary }}>
          <strong>Invalid combination:</strong> {combinationWarning}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" disabled={saving || !!duplicateWarning || !!combinationWarning} onClick={save}>
          {saving ? "Creating..." : "Create enrollment"}
        </Btn>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// EditEnrollmentForm - edit an existing enrollment.
//
// Editable: acuity_tier (with stamp), assigned_care_manager_id, health_plan_type,
// cm_provider_type, payer_name, plan_member_id, hop_eligible, hop_active, notes.
//
// NOT editable: patient_id, program_type, enrollment_status
//   (use Disenroll/Activate for status transitions; use Disenroll + new
//   enrollment for program changes so the audit trail is clean).
//
// If acuity_tier changes, stamp acuity_tier_set_at + acuity_tier_set_by.
// If assigned_care_manager_id changes, stamp assigned_at.
// ---------------------------------------------------------------------------

function EditEnrollmentForm({ enrollment, onCancel, onSaved }) {
  const [careManagers, setCareManagers] = useState([]);
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const [error, setError]               = useState(null);

  const [planType, setPlanType]         = useState(enrollment.health_plan_type || "");
  const [providerType, setProviderType] = useState(enrollment.cm_provider_type || "");
  const [acuityTier, setAcuityTier]     = useState(enrollment.acuity_tier || "");
  const [assignedCM, setAssignedCM]     = useState(enrollment.assigned_care_manager_id || "");
  const [payerName, setPayerName]       = useState(enrollment.payer_name || "");
  const [planMemberId, setPlanMemberId] = useState(enrollment.plan_member_id || "");
  const [hopEligible, setHopEligible]   = useState(!!enrollment.hop_eligible);
  const [hopActive, setHopActive]       = useState(!!enrollment.hop_active);
  const [notes, setNotes]               = useState(enrollment.notes || "");

  useEffect(() => {
    supabase
      .from("users")
      .select("id, full_name, role")
      .eq("practice_id", enrollment.practice_id)
      .in("role", ["Care Manager", "Supervising Care Manager", "Care Manager Supervisor"])
      .order("full_name", { ascending: true })
      .then(({ data }) => { setCareManagers(data || []); setLoading(false); });
  }, [enrollment.practice_id]);

  const showAcuity = planType === "Tailored Plan";

  const acuityChanged   = acuityTier   !== (enrollment.acuity_tier || "");
  const assignedChanged = assignedCM   !== (enrollment.assigned_care_manager_id || "");

  const save = async () => {
    setSaving(true);
    setError(null);

    const nowIso = new Date().toISOString();
    const patch = {
      health_plan_type: planType || null,
      cm_provider_type: providerType || null,
      acuity_tier:      (showAcuity && acuityTier) ? acuityTier : null,
      assigned_care_manager_id: assignedCM || null,
      payer_name:       payerName.trim() || null,
      plan_member_id:   planMemberId.trim() || null,
      hop_eligible:     hopEligible,
      hop_active:       hopActive,
      notes:            notes.trim() || null,
      updated_at:       nowIso,
    };

    if (acuityChanged && acuityTier) {
      patch.acuity_tier_set_at = nowIso;
      patch.acuity_tier_set_by = null;
    }
    if (assignedChanged && assignedCM) {
      patch.assigned_at = nowIso;
    }

    try {
      const { error: updErr } = await supabase
        .from("cm_enrollments")
        .update(patch)
        .eq("id", enrollment.id);
      if (updErr) throw updErr;
      onSaved();
    } catch (e) {
      setError(e.message || "Failed to save changes");
      setSaving(false);
    }
  };

  if (loading) return <Loader label="Loading..." />;

  return (
    <div>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div style={{ padding: "10px 12px", marginBottom: 16, background: C.bgSecondary, borderRadius: 8, fontSize: 12, color: C.textSecondary }}>
        Patient, program, and status cannot be changed here.
        To move a patient to a different program, disenroll and create a new enrollment.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <FL>Health plan type</FL>
          <select value={planType} onChange={e => setPlanType(e.target.value)} style={selectStyle}>
            <option value="">-- Not set --</option>
            <option value="Tailored Plan">Tailored Plan</option>
            <option value="Standard Plan">Standard Plan</option>
            <option value="Other">Other</option>
          </select>
        </div>

        <div>
          <FL>CM provider type</FL>
          <select value={providerType} onChange={e => setProviderType(e.target.value)} style={selectStyle}>
            <option value="">-- Not set --</option>
            {ALL_PROVIDER_TYPES.map(pt => (
              <option key={pt} value={pt}>{pt}</option>
            ))}
          </select>
        </div>

        <div>
          <FL>Payer name</FL>
          <input type="text" value={payerName} onChange={e => setPayerName(e.target.value)} style={inputStyle} />
        </div>

        <div>
          <FL>Plan member ID / CNDS</FL>
          <input type="text" value={planMemberId} onChange={e => setPlanMemberId(e.target.value)} style={{ ...inputStyle, fontFamily: "monospace" }} />
        </div>

        {showAcuity && (
          <div>
            <FL>Acuity tier</FL>
            <select value={acuityTier} onChange={e => setAcuityTier(e.target.value)} style={selectStyle}>
              <option value="">-- Not set --</option>
              <option value="High">High</option>
              <option value="Moderate">Moderate</option>
              <option value="Low">Low</option>
            </select>
            {acuityChanged && <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 4 }}>Will stamp new set_at timestamp</div>}
          </div>
        )}

        <div>
          <FL>Assigned care manager</FL>
          <select value={assignedCM} onChange={e => setAssignedCM(e.target.value)} style={selectStyle}>
            <option value="">-- Unassigned --</option>
            {careManagers.map(cm => (
              <option key={cm.id} value={cm.id}>{cm.full_name} ({cm.role})</option>
            ))}
          </select>
          {assignedChanged && assignedCM && <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 4 }}>Will stamp new assigned_at timestamp</div>}
        </div>

        <div style={{ gridColumn: "1 / -1", display: "flex", gap: 24 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={hopEligible} onChange={e => setHopEligible(e.target.checked)} />
            <span style={{ fontSize: 13 }}>HOP eligible</span>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={hopActive} onChange={e => setHopActive(e.target.checked)} />
            <span style={{ fontSize: 13 }}>HOP active</span>
          </label>
        </div>

        <div style={{ gridColumn: "1 / -1" }}>
          <FL>Notes</FL>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
        <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
        <Btn variant="primary" disabled={saving} onClick={save}>
          {saving ? "Saving..." : "Save changes"}
        </Btn>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DisenrollForm - disenroll an active or pending enrollment.
//
// Required: disenrollment_reason_code (from cm_reference_codes category
// 'disenrollment_reason'). Optional: notes, disenrolled_at (defaults today).
//
// Side-effects: enrollment_status -> 'Disenrolled', disenrolled_at set.
// ---------------------------------------------------------------------------

function DisenrollForm({ enrollment, onCancel, onSaved }) {
  const [reasonCodes, setReasonCodes] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState(null);

  const [reasonCode, setReasonCode]       = useState("");
  const [disenrolledAt, setDisenrolledAt] = useState(() => new Date().toISOString().split("T")[0]);
  const [notes, setNotes]                 = useState("");

  useEffect(() => {
    supabase
      .from("cm_reference_codes")
      .select("code, label, sort_order")
      .eq("category", "disenrollment_reason")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .then(({ data }) => { setReasonCodes(data || []); setLoading(false); });
  }, []);

  const save = async () => {
    if (!reasonCode) { setError("Pick a disenrollment reason"); return; }
    if (!disenrolledAt) { setError("Disenrollment date required"); return; }

    setSaving(true);
    setError(null);

    const patch = {
      enrollment_status:           "Disenrolled",
      disenrollment_reason_code:   reasonCode,
      disenrolled_at:              new Date(disenrolledAt + "T12:00:00Z").toISOString(),
      disenrollment_notes:         notes.trim() || null,
      updated_at:                  new Date().toISOString(),
    };

    try {
      const { error: updErr } = await supabase
        .from("cm_enrollments")
        .update(patch)
        .eq("id", enrollment.id);
      if (updErr) throw updErr;
      onSaved();
    } catch (e) {
      setError(e.message || "Failed to disenroll");
      setSaving(false);
    }
  };

  if (loading) return <Loader label="Loading reason codes..." />;

  return (
    <div>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div style={{ padding: "10px 12px", marginBottom: 16, background: C.amberBg, border: "0.5px solid " + C.amberBorder, borderRadius: 8, fontSize: 12, color: C.textPrimary }}>
        <strong>Disenrolling ends this care management engagement.</strong>
        The patient touchpoint history is preserved. A new enrollment can be created later if the patient re-engages.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={{ gridColumn: "1 / -1" }}>
          <FL>Reason for disenrollment</FL>
          <select value={reasonCode} onChange={e => setReasonCode(e.target.value)} style={selectStyle}>
            <option value="">-- Select reason --</option>
            {reasonCodes.map(rc => (
              <option key={rc.code} value={rc.code}>{rc.label}</option>
            ))}
          </select>
        </div>

        <div>
          <FL>Disenrollment date</FL>
          <input type="date" value={disenrolledAt} onChange={e => setDisenrolledAt(e.target.value)} style={inputStyle} />
        </div>

        <div style={{ gridColumn: "1 / -1" }}>
          <FL>Notes (optional)</FL>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Additional context, follow-up actions..." style={{ ...inputStyle, resize: "vertical" }} />
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
        <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
        <Btn variant="primary" disabled={saving || !reasonCode} onClick={save} style={{ background: C.red, borderColor: C.red }}>
          {saving ? "Disenrolling..." : "Confirm disenrollment"}
        </Btn>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ActivateForm - transition Pending or On Hold enrollments to Active.
//
// Sets enrollment_status='Active' and enrolled_at (if not already set).
// If moving from On Hold, does not overwrite existing enrolled_at.
// ---------------------------------------------------------------------------

function ActivateForm({ enrollment, onCancel, onSaved }) {
  const [enrolledAt, setEnrolledAt] = useState(() => {
    if (enrollment.enrolled_at) return enrollment.enrolled_at.split("T")[0];
    return new Date().toISOString().split("T")[0];
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);

  const isResume = enrollment.enrollment_status === "On Hold";

  const save = async () => {
    if (!enrolledAt) { setError("Enrolled date required"); return; }
    setSaving(true);
    setError(null);

    const patch = {
      enrollment_status: "Active",
      updated_at:        new Date().toISOString(),
    };
    if (!enrollment.enrolled_at) {
      patch.enrolled_at = new Date(enrolledAt + "T12:00:00Z").toISOString();
    }

    try {
      const { error: updErr } = await supabase
        .from("cm_enrollments")
        .update(patch)
        .eq("id", enrollment.id);
      if (updErr) throw updErr;
      onSaved();
    } catch (e) {
      setError(e.message || "Failed to activate");
      setSaving(false);
    }
  };

  return (
    <div>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div style={{ padding: "10px 12px", marginBottom: 16, background: C.bgSecondary, borderRadius: 8, fontSize: 12, color: C.textSecondary }}>
        {isResume
          ? "Resuming this enrollment moves it back to Active. Original enrolled date is preserved."
          : "Activating moves this enrollment from Pending to Active, indicating the member has consented and engagement has begun."}
      </div>

      {!enrollment.enrolled_at && (
        <div>
          <FL>Enrolled date</FL>
          <input type="date" value={enrolledAt} onChange={e => setEnrolledAt(e.target.value)} style={inputStyle} />
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
        <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
        <Btn variant="primary" disabled={saving} onClick={save}>
          {saving ? "Activating..." : (isResume ? "Resume enrollment" : "Activate enrollment")}
        </Btn>
      </div>
    </div>
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

// ---------------------------------------------------------------------------
// BillingAnalysisCard - renders the structured output from cmp-billing-explainer.
// Sections shown adapt to claim_status: Not Ready gets path_to_ready, Ready/
// Submitted get audit_risks, Denied gets denial_analysis. All statuses get
// the narrative summary + recommended_next_actions + add_on_opportunities.
// ---------------------------------------------------------------------------
function BillingAnalysisCard({ analysis, context, claimStatus }) {
  if (!analysis) return null;

  const pathToReady     = Array.isArray(analysis.path_to_ready)          ? analysis.path_to_ready          : [];
  const auditRisks      = Array.isArray(analysis.audit_risks)            ? analysis.audit_risks            : [];
  const nextActions     = Array.isArray(analysis.recommended_next_actions) ? analysis.recommended_next_actions : [];
  const addOns          = Array.isArray(analysis.add_on_opportunities)   ? analysis.add_on_opportunities   : [];
  const denial          = analysis.denial_analysis || null;
  const caveats         = Array.isArray(analysis.confidence_caveats)     ? analysis.confidence_caveats     : [];

  const statusLabel = (s) => {
    if (!s) return "Analysis";
    return s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  };

  const statusColor = (s) => {
    if (s === "ready_strong" || s === "paid" || s === "on_track") return "#047857"; // green
    if (s === "ready_audit_risk" || s === "at_risk" || s === "submitted_waiting") return "#d97706"; // amber
    if (s === "blocked" || s === "denied_resubmittable" || s === "denied_terminal") return "#dc2626"; // red
    return "#0369a1"; // blue
  };

  const priorityColor = (p) => p === "urgent" ? "red" : p === "high" ? "red" : p === "medium" ? "amber" : "neutral";
  const severityColor = (s) => s === "high" ? "red" : s === "medium" ? "amber" : "neutral";

  const deadlineLabel = (d) => {
    if (!d) return null;
    if (d === "asap")         return "ASAP";
    if (d === "end_of_month") return "End of month";
    // Try to parse as ISO date
    try {
      const dt = new Date(d + "T12:00:00Z");
      return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    } catch (e) { return d; }
  };

  return (
    <div style={{ marginBottom: 20, padding: 14, background: "#f0f9ff", border: "0.5px solid #bae6fd", borderRadius: 10 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10, gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#075985" }}>
            AI Analysis
          </div>
          {analysis.status_assessment && (
            <div style={{ fontSize: 12, fontWeight: 700, color: statusColor(analysis.status_assessment) }}>
              {statusLabel(analysis.status_assessment)}
            </div>
          )}
          {context?.days_remaining_in_month > 0 && context?.month_status === "current" && (
            <div style={{ fontSize: 11, color: C.textTertiary }}>
              {context.days_remaining_in_month} day{context.days_remaining_in_month === 1 ? "" : "s"} left this month
            </div>
          )}
        </div>
        {analysis.confidence && (
          <Badge
            label={"CONFIDENCE " + String(analysis.confidence).toUpperCase()}
            variant={analysis.confidence === "high" ? "green" : analysis.confidence === "medium" ? "amber" : "red"}
            size="xs"
          />
        )}
      </div>

      {/* Narrative */}
      {analysis.narrative_summary && (
        <div style={{ fontSize: 13, color: C.textPrimary, lineHeight: 1.55, marginBottom: 14 }}>
          {analysis.narrative_summary}
        </div>
      )}

      {/* Path to ready (Not Ready periods) */}
      {pathToReady.length > 0 && (
        <AnalysisSection title="Path to ready" tone="amber">
          {pathToReady.map((step, i) => (
            <div key={i} style={{ padding: "8px 10px", background: C.bgPrimary, border: "0.5px solid " + C.borderLight, borderRadius: 6, marginBottom: i < pathToReady.length - 1 ? 6 : 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 2 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>{step.action}</div>
                {deadlineLabel(step.deadline) && (
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.red, whiteSpace: "nowrap" }}>
                    By {deadlineLabel(step.deadline)}
                  </div>
                )}
              </div>
              {step.reason && (
                <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>{step.reason}</div>
              )}
            </div>
          ))}
        </AnalysisSection>
      )}

      {/* Audit risks (Ready/Submitted periods) */}
      {auditRisks.length > 0 && (
        <AnalysisSection title="Audit durability risks" tone="amber">
          {auditRisks.map((risk, i) => (
            <div key={i} style={{ padding: "8px 10px", background: C.bgPrimary, border: "0.5px solid " + C.borderLight, borderRadius: 6, marginBottom: i < auditRisks.length - 1 ? 6 : 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap", marginBottom: 2 }}>
                <Badge label={String(risk.severity || "medium").toUpperCase()} variant={severityColor(risk.severity)} size="xs" />
                <div style={{ fontSize: 13, color: C.textPrimary }}>{risk.risk}</div>
              </div>
              {risk.mitigation && (
                <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2, fontStyle: "italic" }}>Mitigation: {risk.mitigation}</div>
              )}
            </div>
          ))}
        </AnalysisSection>
      )}

      {/* Denial analysis (Denied periods) */}
      {claimStatus === "Denied" && denial && denial.root_cause_hypothesis && (
        <AnalysisSection title="Denial analysis" tone="red">
          <div style={{ padding: 10, background: C.bgPrimary, border: "0.5px solid " + C.borderLight, borderRadius: 6 }}>
            <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 4 }}>
              <strong style={{ color: C.textPrimary }}>Likely root cause:</strong> {denial.root_cause_hypothesis}
            </div>
            {Array.isArray(denial.evidence) && denial.evidence.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.textSecondary, marginBottom: 2 }}>Evidence</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: C.textPrimary }}>
                  {denial.evidence.map((ev, i) => <li key={i}>{ev}</li>)}
                </ul>
              </div>
            )}
            {denial.resubmission_viability && (
              <div style={{ marginTop: 8, fontSize: 12 }}>
                <strong style={{ color: C.textPrimary }}>Resubmission viability:</strong>{" "}
                <Badge
                  label={String(denial.resubmission_viability).replace(/_/g, " ").toUpperCase()}
                  variant={denial.resubmission_viability === "viable" ? "green" : denial.resubmission_viability === "partially_viable" ? "amber" : "red"}
                  size="xs"
                />
              </div>
            )}
            {Array.isArray(denial.resubmission_steps) && denial.resubmission_steps.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.textSecondary, marginBottom: 2 }}>Resubmission steps</div>
                <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: C.textPrimary }}>
                  {denial.resubmission_steps.map((st, i) => <li key={i}>{st}</li>)}
                </ol>
              </div>
            )}
          </div>
        </AnalysisSection>
      )}

      {/* Add-on opportunities */}
      {addOns.length > 0 && (
        <AnalysisSection title="Add-on code opportunities" tone="green">
          {addOns.map((a, i) => (
            <div key={i} style={{ padding: "8px 10px", background: C.bgPrimary, border: "0.5px solid " + C.borderLight, borderRadius: 6, marginBottom: i < addOns.length - 1 ? 6 : 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap", marginBottom: 2 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>{String(a.code || "").toUpperCase()}</div>
                <Badge
                  label={String(a.eligibility || "").replace(/_/g, " ").toUpperCase()}
                  variant={a.eligibility === "likely_eligible" ? "green" : a.eligibility === "needs_verification" ? "amber" : "neutral"}
                  size="xs"
                />
              </div>
              {a.reasoning && <div style={{ fontSize: 11, color: C.textTertiary }}>{a.reasoning}</div>}
            </div>
          ))}
        </AnalysisSection>
      )}

      {/* Recommended next actions (always shown) */}
      {nextActions.length > 0 && (
        <AnalysisSection title="Recommended next actions" tone="blue">
          {nextActions.map((a, i) => (
            <div key={i} style={{ padding: "8px 10px", background: C.bgPrimary, border: "0.5px solid " + C.borderLight, borderRadius: 6, marginBottom: i < nextActions.length - 1 ? 6 : 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap", marginBottom: 2 }}>
                <Badge label={String(a.priority || "medium").toUpperCase()} variant={priorityColor(a.priority)} size="xs" />
                <div style={{ fontSize: 13, color: C.textPrimary, flex: 1 }}>{a.action}</div>
              </div>
              <div style={{ fontSize: 10, color: C.textTertiary, marginTop: 4, display: "flex", gap: 10 }}>
                {a.owner && <span>Owner: {String(a.owner).replace(/_/g, " ")}</span>}
                {a.estimated_impact && <span>Impact: {String(a.estimated_impact).replace(/_/g, " ")}</span>}
              </div>
            </div>
          ))}
        </AnalysisSection>
      )}

      {/* Confidence caveats */}
      {caveats.length > 0 && (
        <div style={{ marginTop: 10, padding: 8, fontSize: 11, color: C.textTertiary, fontStyle: "italic" }}>
          Caveats: {caveats.join(" / ")}
        </div>
      )}
    </div>
  );
}

function AnalysisSection({ title, tone, children }) {
  const borderColor = tone === "amber" ? "#fbbf24" : tone === "red" ? "#f87171" : tone === "green" ? "#34d399" : "#60a5fa";
  return (
    <div style={{ marginBottom: 12, paddingLeft: 10, borderLeft: "2px solid " + borderColor }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 6 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RiskPanel - renders the latest active risk assessment for an enrollment
// in the EnrollmentDetail modal. Three states:
//   - loading
//   - no assessment yet (shows "Run initial assessment" CTA)
//   - assessment present (shows narrative + factors + interventions + actions)
// Actions: Re-assess (any role), Acknowledge + Dismiss (non-CHW only).
// ---------------------------------------------------------------------------
function RiskPanel({
  risk, history, loading, busy, error,
  canReassess, canAckDismiss,
  onReassess, onAcknowledge,
  showDismiss, setShowDismiss,
  dismissReason, setDismissReason,
  onDismiss,
}) {
  // Collapsible history section - null means not expanded, id means expanded
  const [expandedHistoryId, setExpandedHistoryId] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const safeHistory = Array.isArray(history) ? history : [];
  if (loading) {
    return (
      <div style={{ marginBottom: 20, padding: 12, background: C.bgSecondary, borderRadius: 8, fontSize: 12, color: C.textTertiary }}>
        Loading risk assessment...
      </div>
    );
  }

  // No assessment yet - show "Run initial assessment" CTA
  if (!risk) {
    return (
      <div style={{ marginBottom: 20, padding: 14, background: C.bgSecondary, border: "0.5px dashed " + C.borderLight, borderRadius: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 3 }}>
              Clinical risk
            </div>
            <div style={{ fontSize: 13, color: C.textSecondary }}>
              No assessment yet. Run an assessment to evaluate engagement, clinical, and social risk signals.
            </div>
          </div>
          {canReassess && (
            <Btn variant="primary" size="sm" disabled={busy} onClick={onReassess}>
              {busy ? "Assessing..." : "Run assessment"}
            </Btn>
          )}
        </div>
        {error && (
          <div style={{ marginTop: 10, fontSize: 12, color: C.red, background: C.redBg, padding: 8, borderRadius: 6, border: "0.5px solid " + C.redBorder }}>
            {error}
          </div>
        )}
      </div>
    );
  }

  const level = risk.risk_level;
  const levelColor =
    level === "critical" ? "#dc2626" :
    level === "high"     ? "#dc2626" :
    level === "medium"   ? "#d97706" :
    "#047857";
  const levelBg =
    level === "critical" ? "#fef2f2" :
    level === "high"     ? "#fef2f2" :
    level === "medium"   ? "#fffbeb" :
    "#f0fdf4";
  const levelBorder =
    level === "critical" ? "#fca5a5" :
    level === "high"     ? "#fca5a5" :
    level === "medium"   ? "#fcd34d" :
    "#86efac";

  const factors = Array.isArray(risk.risk_factors) ? risk.risk_factors : [];
  const interventions = Array.isArray(risk.recommended_interventions) ? risk.recommended_interventions : [];
  const protective = Array.isArray(risk.protective_factors) ? risk.protective_factors : [];

  const severityColor = (s) => s === "high" ? "red" : s === "medium" ? "amber" : "neutral";
  const urgencyColor  = (u) => u === "urgent" ? "red" : u === "high" ? "red" : u === "medium" ? "amber" : "neutral";

  return (
    <div style={{ marginBottom: 20, padding: 14, background: levelBg, border: "0.5px solid " + levelBorder, borderRadius: 10 }}>
      {/* Header - level + headline + action buttons */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: levelColor }}>
              {(level || "").toUpperCase()} RISK
            </div>
            {typeof risk.risk_score === "number" && (
              <div style={{ fontSize: 10, color: C.textTertiary }}>score {risk.risk_score}/100</div>
            )}
            {risk.confidence && (
              <Badge label={"CONF " + String(risk.confidence).toUpperCase()} variant={risk.confidence === "high" ? "green" : risk.confidence === "medium" ? "amber" : "red"} size="xs" />
            )}
            {risk.acknowledged_at && <Badge label="ACK" variant="blue" size="xs" />}
            {risk.dismissed_at && <Badge label="DISMISSED" variant="neutral" size="xs" />}
          </div>
          {risk.headline && (
            <div style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary, lineHeight: 1.4 }}>
              {risk.headline}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {canReassess && (
            <Btn variant="outline" size="sm" disabled={busy} onClick={onReassess}>
              {busy ? "..." : "Re-assess"}
            </Btn>
          )}
          {canAckDismiss && !risk.acknowledged_at && !risk.dismissed_at && (
            <Btn variant="outline" size="sm" disabled={busy} onClick={onAcknowledge}>Acknowledge</Btn>
          )}
          {canAckDismiss && !risk.dismissed_at && (
            <Btn variant="outline" size="sm" disabled={busy} onClick={() => setShowDismiss(true)} style={{ color: C.textSecondary }}>
              Dismiss
            </Btn>
          )}
        </div>
      </div>

      {/* Dismiss reason inline form */}
      {showDismiss && (
        <div style={{ marginBottom: 12, padding: 10, background: C.bgPrimary, border: "0.5px solid " + C.borderLight, borderRadius: 6 }}>
          <FL>Reason for dismissing this assessment</FL>
          <input
            type="text"
            value={dismissReason}
            onChange={e => setDismissReason(e.target.value)}
            placeholder="e.g. Already resolved - member re-engaged last week"
            style={inputStyle}
          />
          <div style={{ display: "flex", gap: 6, marginTop: 8, justifyContent: "flex-end" }}>
            <Btn variant="ghost" size="sm" onClick={() => { setShowDismiss(false); setDismissReason(""); }}>Cancel</Btn>
            <Btn variant="primary" size="sm" disabled={busy || !dismissReason.trim()} onClick={onDismiss}>
              {busy ? "Dismissing..." : "Confirm dismiss"}
            </Btn>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ marginBottom: 10, fontSize: 12, color: C.red, background: C.redBg, padding: 8, borderRadius: 6, border: "0.5px solid " + C.redBorder }}>
          {error}
        </div>
      )}

      {/* Risk trajectory sparkline - only renders when there are 2+ total
          assessments (active + at least 1 historical). Gives at-a-glance
          context on whether risk is improving, stable, or escalating. */}
      <RiskTrajectorySparkline history={safeHistory} current={risk} />

      {/* Narrative */}
      {risk.narrative && (
        <div style={{ fontSize: 13, color: C.textPrimary, lineHeight: 1.55, marginBottom: 12 }}>
          {risk.narrative}
        </div>
      )}

      {/* Risk factors */}
      {factors.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 6 }}>
            Risk factors
          </div>
          {factors.map((f, i) => (
            <div key={i} style={{ padding: "6px 10px", background: C.bgPrimary, border: "0.5px solid " + C.borderLight, borderRadius: 6, marginBottom: i < factors.length - 1 ? 4 : 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap", marginBottom: 2 }}>
                <Badge label={String(f.severity || "med").toUpperCase()} variant={severityColor(f.severity)} size="xs" />
                {f.category && <Badge label={String(f.category).toUpperCase()} variant="neutral" size="xs" />}
                <div style={{ fontSize: 12, color: C.textPrimary, fontWeight: 500 }}>{f.factor}</div>
              </div>
              {f.evidence && <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>Evidence: {f.evidence}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Recommended interventions */}
      {interventions.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 6 }}>
            Recommended interventions
          </div>
          {interventions.map((iv, i) => (
            <div key={i} style={{ padding: "6px 10px", background: C.bgPrimary, border: "0.5px solid " + C.borderLight, borderRadius: 6, marginBottom: i < interventions.length - 1 ? 4 : 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap", marginBottom: 2 }}>
                <Badge label={String(iv.urgency || "med").toUpperCase()} variant={urgencyColor(iv.urgency)} size="xs" />
                <div style={{ fontSize: 12, color: C.textPrimary, fontWeight: 500, flex: 1 }}>{iv.action}</div>
              </div>
              <div style={{ fontSize: 10, color: C.textTertiary, marginTop: 3, display: "flex", gap: 10 }}>
                {iv.owner && <span>Owner: {String(iv.owner).replace(/_/g, " ")}</span>}
                {iv.rationale && <span style={{ flex: 1 }}>- {iv.rationale}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Protective factors + next-contact-by + assessment metadata */}
      {protective.length > 0 && (
        <div style={{ marginBottom: 10, fontSize: 12, color: C.textSecondary }}>
          <span style={{ fontWeight: 600, color: C.textPrimary }}>Protective factors:</span> {protective.join(" / ")}
        </div>
      )}
      {risk.suggested_next_contact_by && (
        <div style={{ marginBottom: 8, fontSize: 12, color: C.textPrimary }}>
          <span style={{ fontWeight: 600 }}>Suggested next contact by:</span>{" "}
          <span style={{ color: levelColor, fontWeight: 600 }}>
            {new Date(risk.suggested_next_contact_by + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}
          </span>
        </div>
      )}

      {/* Dismiss reason audit trail */}
      {risk.dismissed_at && risk.dismissed_reason && (
        <div style={{ marginTop: 10, fontSize: 11, color: C.textTertiary, fontStyle: "italic", paddingTop: 8, borderTop: "0.5px solid " + C.borderLight }}>
          Dismissed {new Date(risk.dismissed_at).toLocaleDateString()}: {risk.dismissed_reason}
        </div>
      )}

      {/* Footer: assessment metadata */}
      <div style={{ marginTop: 10, fontSize: 10, color: C.textTertiary, borderTop: "0.5px solid " + C.borderLight, paddingTop: 8, display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <span>Assessed {risk.assessed_at ? new Date(risk.assessed_at).toLocaleString() : ""}</span>
        <span>Trigger: {risk.trigger_reason}{risk.model ? " / " + risk.model : ""}</span>
      </div>

      {/* History: previous (superseded) assessments. Each is expandable to
          show the full narrative + factors + interventions that were active
          at that point in time. Disposition badge indicates how the entry
          ended: Acknowledged, Dismissed, or neither (superseded without
          being actioned). */}
      {safeHistory.length > 0 && (
        <div style={{ marginTop: 10, borderTop: "0.5px solid " + C.borderLight, paddingTop: 8 }}>
          <button
            onClick={() => setHistoryOpen(!historyOpen)}
            style={{
              background: "transparent",
              border: "none",
              padding: "4px 0",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: C.textSecondary,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span>{historyOpen ? "-" : "+"}</span>
            <span>Assessment history ({safeHistory.length})</span>
          </button>
          {historyOpen && (
            <div style={{ marginTop: 8 }}>
              {safeHistory.map((h, i) => {
                const isExpanded = expandedHistoryId === h.id;
                const levelMap = { critical: "red", high: "red", medium: "amber", low: "green" };
                const hFactors = Array.isArray(h.risk_factors) ? h.risk_factors : [];
                const hInterventions = Array.isArray(h.recommended_interventions) ? h.recommended_interventions : [];
                // Disposition: what happened to this assessment before it was
                // superseded? Dismissed takes precedence over Acknowledged in display.
                let disposition = "Superseded";
                let dispVariant = "neutral";
                if (h.dismissed_at) { disposition = "Dismissed"; dispVariant = "neutral"; }
                else if (h.acknowledged_at) { disposition = "Acknowledged"; dispVariant = "blue"; }
                return (
                  <div key={h.id} style={{
                    padding: "8px 10px",
                    background: C.bgPrimary,
                    border: "0.5px solid " + C.borderLight,
                    borderRadius: 6,
                    marginBottom: i < safeHistory.length - 1 ? 6 : 0,
                  }}>
                    <button
                      onClick={() => setExpandedHistoryId(isExpanded ? null : h.id)}
                      style={{
                        background: "transparent",
                        border: "none",
                        padding: 0,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        textAlign: "left",
                        width: "100%",
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        gap: 8,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap", marginBottom: 2 }}>
                          <Badge label={String(h.risk_level || "").toUpperCase()} variant={levelMap[h.risk_level] || "neutral"} size="xs" />
                          <Badge label={disposition.toUpperCase()} variant={dispVariant} size="xs" />
                          <span style={{ fontSize: 11, color: C.textTertiary }}>
                            {h.assessed_at ? new Date(h.assessed_at).toLocaleDateString() : ""}
                          </span>
                        </div>
                        {h.headline && (
                          <div style={{ fontSize: 12, color: C.textPrimary, lineHeight: 1.4 }}>
                            {h.headline}
                          </div>
                        )}
                      </div>
                      <span style={{ fontSize: 11, color: C.textTertiary, marginLeft: 8 }}>
                        {isExpanded ? "Hide" : "View"}
                      </span>
                    </button>
                    {isExpanded && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "0.5px solid " + C.borderLight }}>
                        {h.narrative && (
                          <div style={{ fontSize: 12, color: C.textPrimary, lineHeight: 1.5, marginBottom: 10 }}>
                            {h.narrative}
                          </div>
                        )}
                        {hFactors.length > 0 && (
                          <div style={{ marginBottom: 10 }}>
                            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 4 }}>
                              Risk factors at the time
                            </div>
                            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, color: C.textPrimary, lineHeight: 1.5 }}>
                              {hFactors.map((f, j) => (
                                <li key={j}>
                                  <strong>{f.factor}</strong>
                                  {f.evidence && <span style={{ color: C.textTertiary }}> - {f.evidence}</span>}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {hInterventions.length > 0 && (
                          <div style={{ marginBottom: 10 }}>
                            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 4 }}>
                              Recommended interventions at the time
                            </div>
                            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, color: C.textPrimary, lineHeight: 1.5 }}>
                              {hInterventions.map((iv, j) => (
                                <li key={j}>{iv.action}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {h.dismissed_reason && (
                          <div style={{ fontSize: 11, color: C.textTertiary, fontStyle: "italic", marginBottom: 4 }}>
                            Dismiss reason: {h.dismissed_reason}
                          </div>
                        )}
                        <div style={{ fontSize: 10, color: C.textTertiary, display: "flex", gap: 10, flexWrap: "wrap" }}>
                          <span>Trigger: {h.trigger_reason || "-"}</span>
                          {h.model && <span>{h.model}</span>}
                          {h.acknowledged_at && <span>Acknowledged {new Date(h.acknowledged_at).toLocaleDateString()}</span>}
                          {h.dismissed_at && <span>Dismissed {new Date(h.dismissed_at).toLocaleDateString()}</span>}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AnnualReviewDrafter - calls cmp-draft-annual-review, presents the draft
// for human review (edit/accept/reject), and on accept inserts a new
// cm_care_plans row with prior_plan_id set. The DB trigger auto-supersedes
// the prior plan. This keeps the workflow fully auditable: every review
// produces a new plan version, and the review_summary jsonb captures the
// AI's analysis of what changed, which the reviewer can edit before saving.
// ---------------------------------------------------------------------------
function AnnualReviewDrafter({ priorPlan, userId, onCancel, onSaved }) {
  const [drafting, setDrafting]   = useState(false);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState(null);
  const [draft, setDraft]         = useState(null);
  const [context, setContext]     = useState(null);
  const [modelMeta, setModelMeta] = useState(null);

  // Editable overrides. The AI's draft goes into these on generation; the
  // reviewer can then edit before saving. On save we combine the edited
  // review_summary/refreshed_plan with the AI metadata.
  const [overallAssessment, setOverallAssessment] = useState("");
  const [reviewerNotes, setReviewerNotes]         = useState("");
  const [nextReviewDue, setNextReviewDue]         = useState("");

  const handleDraft = async () => {
    setDrafting(true);
    setError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const url = supabase.supabaseUrl + "/functions/v1/cmp-draft-annual-review";
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": "Bearer " + token,
        },
        body: JSON.stringify({ prior_plan_id: priorPlan.id }),
      });
      const body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || "HTTP " + res.status);

      setDraft(body.draft || null);
      setContext(body.context || null);
      setModelMeta({
        model: body.model_used,
        prompt_version: body.prompt_version,
        generated_at: body.generated_at,
      });
      // Seed editable fields from AI output
      setOverallAssessment(body.draft?.review_summary?.overall_assessment || "");
      setNextReviewDue(body.draft?.refreshed_plan?.suggested_next_review_due || "");
      setReviewerNotes("");
    } catch (e) {
      setError(e.message || "Draft failed");
    } finally {
      setDrafting(false);
    }
  };

  // Accept + save: insert a new cm_care_plans row as a new version.
  // The DB trigger flips the prior plan to Superseded automatically.
  const handleAccept = async () => {
    if (!draft) { setError("No draft to save"); return; }
    setSaving(true);
    setError(null);
    try {
      // Compose the review_summary jsonb: mostly AI output, but with any
      // reviewer overrides applied on top.
      const finalSummary = {
        ...draft.review_summary,
        overall_assessment: overallAssessment || draft.review_summary?.overall_assessment || "",
        reviewer_notes:     reviewerNotes.trim() || null,
        ai_generated:       true,
        ai_model:           modelMeta?.model,
        ai_prompt_version:  modelMeta?.prompt_version,
        ai_generated_at:    modelMeta?.generated_at,
      };

      const refreshed = draft.refreshed_plan || {};
      const assessmentDate = new Date().toISOString().split("T")[0];
      // Default 365d out if reviewer didn't override
      let nextDue = nextReviewDue || null;
      if (!nextDue && refreshed.suggested_next_review_due) nextDue = refreshed.suggested_next_review_due;
      if (!nextDue) {
        const d = new Date();
        d.setUTCFullYear(d.getUTCFullYear() + 1);
        nextDue = d.toISOString().split("T")[0];
      }

      const { data: inserted, error: insErr } = await supabase
        .from("cm_care_plans")
        .insert({
          practice_id:         priorPlan.practice_id,
          patient_id:          priorPlan.patient_id,
          enrollment_id:       priorPlan.enrollment_id,
          plan_type:           priorPlan.plan_type,
          plan_status:         "Draft",
          version:             (priorPlan.version || 1) + 1,
          assessment_date:     assessmentDate,
          next_review_due:     nextDue,
          effective_date:      null,
          goals:               Array.isArray(refreshed.goals)         ? refreshed.goals         : [],
          interventions:       Array.isArray(refreshed.interventions) ? refreshed.interventions : [],
          unmet_needs:         Array.isArray(refreshed.unmet_needs)   ? refreshed.unmet_needs   : [],
          risk_factors:        Array.isArray(refreshed.risk_factors)  ? refreshed.risk_factors  : [],
          strengths:           Array.isArray(refreshed.strengths)     ? refreshed.strengths     : [],
          supports:            Array.isArray(refreshed.supports)      ? refreshed.supports      : [],
          emergency_plan:      refreshed.emergency_plan || {},
          medications_reviewed: false,
          prior_plan_id:       priorPlan.id,
          review_summary:      finalSummary,
          ai_drafted:          true,
          ai_draft_model:      modelMeta?.model || null,
          ai_draft_at:         modelMeta?.generated_at || new Date().toISOString(),
          ai_draft_prompt_version: modelMeta?.prompt_version || null,
          notes:               reviewerNotes.trim() || null,
          created_by:          userId || null,
          updated_by:          userId || null,
        })
        .select("id")
        .single();

      if (insErr) throw insErr;
      if (onSaved) onSaved();
    } catch (e) {
      setError(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  // Initial state: no draft yet. Show kickoff CTA + prior plan summary.
  if (!draft) {
    const priorGoalCount = Array.isArray(priorPlan.goals) ? priorPlan.goals.length : 0;
    const priorAssessmentDate = priorPlan.assessment_date || priorPlan.created_at;
    return (
      <div>
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
        <div style={{ padding: 14, marginBottom: 16, background: "#f0f9ff", border: "0.5px solid #bae6fd", borderRadius: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#075985", marginBottom: 6 }}>
            Ready to draft annual review
          </div>
          <div style={{ fontSize: 13, color: C.textPrimary, lineHeight: 1.55 }}>
            This will review <strong>v{priorPlan.version}</strong> (assessed {priorAssessmentDate ? new Date(priorAssessmentDate).toLocaleDateString() : "-"}) with
            <strong> {priorGoalCount} goal{priorGoalCount === 1 ? "" : "s"}</strong>.
            Claude will pull every touchpoint, HRSN screening, billing month, and risk assessment since that date and draft a review for your approval. You'll edit before saving. Approximate cost: 3-5 cents.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Btn variant="ghost" size="sm" onClick={onCancel}>Back</Btn>
          <Btn variant="primary" size="sm" disabled={drafting} onClick={handleDraft}>
            {drafting ? "Drafting (~30 seconds)..." : "Draft review"}
          </Btn>
        </div>
      </div>
    );
  }

  // Draft is ready. Show preview + editable fields + save/cancel.
  const rs = draft.review_summary || {};
  const rp = draft.refreshed_plan || {};
  const goalsMet        = Array.isArray(rs.goals_met)         ? rs.goals_met         : [];
  const goalsNotMet     = Array.isArray(rs.goals_not_met)     ? rs.goals_not_met     : [];
  const goalsCarried    = Array.isArray(rs.goals_carried_over) ? rs.goals_carried_over : [];
  const goalsRemoved    = Array.isArray(rs.goals_removed)     ? rs.goals_removed     : [];
  const keyEvents       = Array.isArray(rs.key_events)        ? rs.key_events        : [];
  const refreshedGoals  = Array.isArray(rp.goals)             ? rp.goals             : [];
  const refreshedInts   = Array.isArray(rp.interventions)     ? rp.interventions     : [];
  const refreshedNeeds  = Array.isArray(rp.unmet_needs)       ? rp.unmet_needs       : [];
  const confCaveats     = Array.isArray(draft.confidence_caveats) ? draft.confidence_caveats : [];

  return (
    <div>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {/* Draft header with confidence + reassess */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textSecondary }}>
            Review draft
          </div>
          {rs.period_covered && (
            <div style={{ fontSize: 13, color: C.textPrimary, marginTop: 2 }}>{rs.period_covered}</div>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {draft.confidence && (
            <Badge label={"CONFIDENCE " + String(draft.confidence).toUpperCase()} variant={draft.confidence === "high" ? "green" : draft.confidence === "medium" ? "amber" : "red"} size="xs" />
          )}
          {rs.interim_review_recommended && (
            <Badge label="INTERIM REVIEW RECOMMENDED" variant="amber" size="xs" />
          )}
          {rs.medications_need_review && (
            <Badge label="MED REVIEW" variant="amber" size="xs" />
          )}
          <Btn variant="outline" size="sm" disabled={drafting} onClick={handleDraft}>
            {drafting ? "..." : "Re-draft"}
          </Btn>
        </div>
      </div>

      {/* Overall assessment - editable */}
      <div style={{ marginBottom: 16 }}>
        <FL>Overall assessment</FL>
        <textarea
          value={overallAssessment}
          onChange={e => setOverallAssessment(e.target.value)}
          rows={3}
          style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical" }}
        />
      </div>

      {/* Two-column summary: left = what happened (met/not met/carried/removed), right = what's next */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 6 }}>
            Prior period review
          </div>
          {goalsMet.length > 0 && (
            <ReviewGroup title={"Goals met (" + goalsMet.length + ")"} tone="green">
              {goalsMet.map((g, i) => (
                <div key={i} style={{ fontSize: 12, color: C.textPrimary, marginBottom: 4 }}>
                  <strong>{g.goal}</strong>
                  {g.evidence && <div style={{ fontSize: 11, color: C.textTertiary }}>{g.evidence}</div>}
                </div>
              ))}
            </ReviewGroup>
          )}
          {goalsNotMet.length > 0 && (
            <ReviewGroup title={"Goals not met (" + goalsNotMet.length + ")"} tone="red">
              {goalsNotMet.map((g, i) => (
                <div key={i} style={{ fontSize: 12, color: C.textPrimary, marginBottom: 4 }}>
                  <strong>{g.goal}</strong>
                  {g.reason && <div style={{ fontSize: 11, color: C.textTertiary }}>Reason: {g.reason}</div>}
                  {g.recommendation && <div style={{ fontSize: 11, color: C.textTertiary }}>Rec: {String(g.recommendation).replace(/_/g, " ")}</div>}
                </div>
              ))}
            </ReviewGroup>
          )}
          {goalsCarried.length > 0 && (
            <ReviewGroup title={"Carry over (" + goalsCarried.length + ")"} tone="blue">
              {goalsCarried.map((g, i) => (
                <div key={i} style={{ fontSize: 12, color: C.textPrimary, marginBottom: 4 }}>
                  <strong>{g.goal}</strong>
                  {g.rationale && <div style={{ fontSize: 11, color: C.textTertiary }}>{g.rationale}</div>}
                </div>
              ))}
            </ReviewGroup>
          )}
          {goalsRemoved.length > 0 && (
            <ReviewGroup title={"Removed (" + goalsRemoved.length + ")"} tone="neutral">
              {goalsRemoved.map((g, i) => (
                <div key={i} style={{ fontSize: 12, color: C.textPrimary, marginBottom: 4 }}>
                  <strong>{g.goal}</strong>
                  {g.reason && <div style={{ fontSize: 11, color: C.textTertiary }}>{g.reason}</div>}
                </div>
              ))}
            </ReviewGroup>
          )}
          {keyEvents.length > 0 && (
            <ReviewGroup title={"Key events (" + keyEvents.length + ")"} tone="amber">
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: C.textPrimary }}>
                {keyEvents.map((ev, i) => <li key={i}>{ev}</li>)}
              </ul>
            </ReviewGroup>
          )}
        </div>

        <div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 6 }}>
            Refreshed plan
          </div>
          {refreshedGoals.length > 0 && (
            <ReviewGroup title={"Goals (" + refreshedGoals.length + ")"} tone="blue">
              {refreshedGoals.map((g, i) => (
                <div key={i} style={{ fontSize: 12, color: C.textPrimary, marginBottom: 6 }}>
                  <div style={{ display: "flex", gap: 4, alignItems: "baseline", flexWrap: "wrap", marginBottom: 2 }}>
                    {g.priority && <Badge label={String(g.priority).toUpperCase()} variant={g.priority === "high" ? "red" : g.priority === "medium" ? "amber" : "neutral"} size="xs" />}
                    {g.source && <Badge label={String(g.source).replace(/_/g, " ").toUpperCase()} variant="neutral" size="xs" />}
                    {g.domain && <span style={{ fontSize: 10, color: C.textTertiary }}>{g.domain}</span>}
                  </div>
                  <strong>{g.goal}</strong>
                  {g.target_date && <div style={{ fontSize: 11, color: C.textTertiary }}>Target: {g.target_date}</div>}
                  {g.rationale && <div style={{ fontSize: 11, color: C.textTertiary }}>{g.rationale}</div>}
                </div>
              ))}
            </ReviewGroup>
          )}
          {refreshedInts.length > 0 && (
            <ReviewGroup title={"Interventions (" + refreshedInts.length + ")"} tone="neutral">
              {refreshedInts.map((iv, i) => (
                <div key={i} style={{ fontSize: 12, color: C.textPrimary, marginBottom: 4 }}>
                  <strong>{iv.intervention}</strong>
                  <div style={{ fontSize: 11, color: C.textTertiary }}>
                    {iv.owner && <span>Owner: {String(iv.owner).replace(/_/g, " ")} </span>}
                    {iv.frequency && <span>/ {iv.frequency}</span>}
                  </div>
                </div>
              ))}
            </ReviewGroup>
          )}
          {refreshedNeeds.length > 0 && (
            <ReviewGroup title={"Unmet needs (" + refreshedNeeds.length + ")"} tone="amber">
              {refreshedNeeds.map((n, i) => (
                <div key={i} style={{ fontSize: 12, color: C.textPrimary, marginBottom: 4 }}>
                  <strong>{n.need}</strong>
                  {n.category && <span style={{ fontSize: 10, color: C.textTertiary }}> ({n.category})</span>}
                  {n.plan_to_address && <div style={{ fontSize: 11, color: C.textTertiary }}>{n.plan_to_address}</div>}
                </div>
              ))}
            </ReviewGroup>
          )}
        </div>
      </div>

      {/* Reviewer overrides */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <div>
          <FL>Next review due</FL>
          <input type="date" value={nextReviewDue} onChange={e => setNextReviewDue(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <FL>Reviewer notes (optional)</FL>
          <input type="text" value={reviewerNotes} onChange={e => setReviewerNotes(e.target.value)} placeholder="Anything worth flagging to supervising CM" style={inputStyle} />
        </div>
      </div>

      {/* Confidence caveats */}
      {confCaveats.length > 0 && (
        <div style={{ marginBottom: 14, padding: 8, background: C.amberBg, border: "0.5px solid " + C.amberBorder, borderRadius: 6, fontSize: 11, color: C.textSecondary }}>
          <strong>Caveats:</strong> {confCaveats.join(" / ")}
        </div>
      )}

      {/* Model footer */}
      {modelMeta && (
        <div style={{ fontSize: 10, color: C.textTertiary, textAlign: "right", marginBottom: 10 }}>
          Drafted {new Date(modelMeta.generated_at).toLocaleString()} / {modelMeta.model}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", paddingTop: 12, borderTop: "0.5px solid " + C.borderLight }}>
        <Btn variant="ghost" size="sm" onClick={onCancel}>Cancel</Btn>
        <Btn variant="primary" size="sm" disabled={saving} onClick={handleAccept}>
          {saving ? "Saving..." : "Accept + create v" + ((priorPlan.version || 1) + 1)}
        </Btn>
      </div>
    </div>
  );
}

// Small helper for AnnualReviewDrafter's review-group tiles.
function ReviewGroup({ title, tone, children }) {
  const border = tone === "green" ? "#86efac" : tone === "red" ? "#fca5a5" : tone === "amber" ? "#fcd34d" : tone === "blue" ? "#7dd3fc" : C.borderLight;
  return (
    <div style={{ marginBottom: 10, paddingLeft: 10, borderLeft: "2px solid " + border }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 4 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReviewSummaryPanel - compact display of a plan's review_summary jsonb.
// Used in PlanDetailModal when looking at a reviewed (v2+) plan to show
// what changed from the prior version. Link to prior plan is informational
// only - the reviewer can navigate by filtering the Plans list.
// ---------------------------------------------------------------------------
function ReviewSummaryPanel({ summary, priorPlanId }) {
  if (!summary || typeof summary !== "object") return null;
  const met       = Array.isArray(summary.goals_met) ? summary.goals_met : [];
  const notMet    = Array.isArray(summary.goals_not_met) ? summary.goals_not_met : [];
  const carried   = Array.isArray(summary.goals_carried_over) ? summary.goals_carried_over : [];
  const removed   = Array.isArray(summary.goals_removed) ? summary.goals_removed : [];
  const keyEvents = Array.isArray(summary.key_events) ? summary.key_events : [];

  return (
    <div style={{ marginTop: 4, marginBottom: 16, padding: 14, background: "#f8fafc", border: "0.5px solid " + C.borderLight, borderRadius: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 8 }}>
        Review summary
        {priorPlanId && (
          <span style={{ marginLeft: 8, fontSize: 10, color: C.textTertiary, fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>
            (superseded prior plan)
          </span>
        )}
      </div>
      {summary.period_covered && (
        <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 6 }}>{summary.period_covered}</div>
      )}
      {summary.overall_assessment && (
        <div style={{ fontSize: 13, color: C.textPrimary, lineHeight: 1.55, marginBottom: 10 }}>
          {summary.overall_assessment}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, marginBottom: 10 }}>
        <ReviewStat label="Met"      value={met.length}     tone="green" />
        <ReviewStat label="Not met"  value={notMet.length}  tone="red" />
        <ReviewStat label="Carried"  value={carried.length} tone="blue" />
        <ReviewStat label="Removed"  value={removed.length} tone="neutral" />
      </div>
      {keyEvents.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 4 }}>
            Key events during period
          </div>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: C.textPrimary }}>
            {keyEvents.map((ev, i) => <li key={i}>{ev}</li>)}
          </ul>
        </div>
      )}
      {summary.reviewer_notes && (
        <div style={{ marginTop: 10, fontSize: 12, color: C.textSecondary, fontStyle: "italic" }}>
          Reviewer notes: {summary.reviewer_notes}
        </div>
      )}
      {summary.ai_generated && (
        <div style={{ marginTop: 10, fontSize: 10, color: C.textTertiary, borderTop: "0.5px solid " + C.borderLight, paddingTop: 6 }}>
          AI-drafted {summary.ai_generated_at ? new Date(summary.ai_generated_at).toLocaleDateString() : ""}
          {summary.ai_model ? " / " + summary.ai_model : ""}
        </div>
      )}
    </div>
  );
}

function ReviewStat({ label, value, tone }) {
  const color = tone === "green" ? "#047857" : tone === "red" ? "#dc2626" : tone === "blue" ? "#0369a1" : C.textSecondary;
  return (
    <div style={{ padding: "6px 10px", background: C.bgPrimary, border: "0.5px solid " + C.borderLight, borderRadius: 6 }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textTertiary }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: color, lineHeight: 1 }}>{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RiskTrajectorySparkline - compact visualization of risk_level over time
// for one enrollment. Used inside RiskPanel when the member has >= 2 total
// assessments (current + at least 1 historical). Inline-SVG, no libraries.
//
// X-axis: index (evenly spaced) - simpler than date-based and highlights
//         trajectory regardless of gaps. Most-recent on the right.
// Y-axis: risk level mapped to height. low=bottom, critical=top.
// Line + markers color-coded by level at that point.
// ---------------------------------------------------------------------------
function RiskTrajectorySparkline({ history, current }) {
  // Combine history (superseded) + current (active, if any) into one
  // chronologically-ordered array. `history` is already sorted newest-first
  // in the parent; reverse to oldest-first, then append current.
  const historyOldestFirst = Array.isArray(history) ? history.slice().reverse() : [];
  const points = [...historyOldestFirst];
  if (current) points.push(current);
  if (points.length < 2) return null;

  const LEVEL_Y = { low: 3, medium: 2, high: 1, critical: 0 };
  const LEVEL_COLOR = { low: "#10b981", medium: "#f59e0b", high: "#ef4444", critical: "#991b1b" };
  const W = 260;
  const H = 56;
  const MARGIN = 6;
  const plotW = W - MARGIN * 2;
  const plotH = H - MARGIN * 2;

  const coords = points.map((p, i) => {
    const x = MARGIN + (points.length > 1 ? (i * plotW) / (points.length - 1) : plotW / 2);
    const yBucket = LEVEL_Y[p.risk_level];
    const y = MARGIN + (typeof yBucket === "number" ? (yBucket * plotH) / 3 : plotH / 2);
    return { x, y, point: p };
  });

  const pathD = coords.map((c, i) => (i === 0 ? "M" : "L") + c.x.toFixed(1) + "," + c.y.toFixed(1)).join(" ");

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary }}>
          Risk trajectory ({points.length} assessments)
        </div>
        <div style={{ fontSize: 9, color: C.textTertiary }}>
          oldest {points[0]?.assessed_at ? new Date(points[0].assessed_at).toLocaleDateString() : ""}
          {" -> "}
          newest {points[points.length - 1]?.assessed_at ? new Date(points[points.length - 1].assessed_at).toLocaleDateString() : ""}
        </div>
      </div>
      <div style={{ background: C.bgPrimary, border: "0.5px solid " + C.borderLight, borderRadius: 6, padding: 4 }}>
        <svg width="100%" height={H} viewBox={"0 0 " + W + " " + H} preserveAspectRatio="none" style={{ display: "block" }}>
          {/* Horizontal gridlines - one per level */}
          {[0, 1, 2, 3].map(i => {
            const y = MARGIN + (i * plotH) / 3;
            return <line key={i} x1={MARGIN} y1={y} x2={W - MARGIN} y2={y} stroke="#e5e7eb" strokeWidth="0.5" strokeDasharray="2,2" />;
          })}
          {/* Level labels on the left */}
          <text x={2} y={MARGIN + 3} fontSize="7" fill={C.textTertiary}>CRIT</text>
          <text x={2} y={MARGIN + plotH / 3 + 3} fontSize="7" fill={C.textTertiary}>HIGH</text>
          <text x={2} y={MARGIN + 2 * plotH / 3 + 3} fontSize="7" fill={C.textTertiary}>MED</text>
          <text x={2} y={MARGIN + plotH + 3} fontSize="7" fill={C.textTertiary}>LOW</text>
          {/* Trajectory line */}
          <path d={pathD} fill="none" stroke={C.textSecondary} strokeWidth="1.5" />
          {/* Points colored by level */}
          {coords.map((c, i) => (
            <circle
              key={i}
              cx={c.x}
              cy={c.y}
              r={3.5}
              fill={LEVEL_COLOR[c.point.risk_level] || C.textTertiary}
              stroke="white"
              strokeWidth="1"
            >
              <title>
                {c.point.assessed_at ? new Date(c.point.assessed_at).toLocaleDateString() : ""} - {String(c.point.risk_level || "").toUpperCase()}
                {c.point.headline ? " - " + c.point.headline : ""}
              </title>
            </circle>
          ))}
        </svg>
      </div>
    </div>
  );
}
