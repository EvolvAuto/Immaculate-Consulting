// ═══════════════════════════════════════════════════════════════════════════════
// src/views/settings/ClinicalPanelsTab.jsx
// Add/edit/delete clinical panels, their metrics, and ICD-10 trigger codes.
// Goes inside SettingsView as a new tab alongside Practice Info / Rooms / Hours.
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../auth/AuthProvider";
import { C } from "../../lib/tokens";
import { listRows, insertRow, updateRow, deleteRow } from "../../lib/db";
import { Badge, Btn, Card, Modal, Input, Textarea, Select, Toggle, FL, SectionHead, Loader, ErrorBanner, EmptyState } from "../../components/ui";

const COLOR_PRESETS = ["#1D9E75","#378ADD","#D85A30","#D4537E","#534AB7","#0E7490","#A32D2D","#6D28D9","#EF9F27","#888780"];

export default function ClinicalPanelsTab({ canEdit }) {
  const { practiceId } = useAuth();
  const [panels, setPanels] = useState([]);
  const [codes, setCodes] = useState([]);
  const [metrics, setMetrics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingPanel, setEditingPanel] = useState(null);
  const [addingPanel, setAddingPanel] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  const load = async () => {
    try {
      setLoading(true);
      const [p, c, m] = await Promise.all([
        listRows("clinical_panels", { order: "sort_order" }),
        supabase.from("panel_condition_codes").select("*"),
        supabase.from("clinical_metrics").select("*").order("sort_order"),
      ]);
      setPanels(p);
      setCodes(c.data || []);
      setMetrics(m.data || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (practiceId) load(); }, [practiceId]);

  const savePanel = async (form) => {
    try {
      const payload = {
        name: form.name, color: form.color,
        description: form.description || null,
        amh_measure_ref: form.amh_measure_ref || null,
        sort_order: parseInt(form.sort_order) || 0,
        is_active: form.is_active !== false,
      };
      if (form.id) await updateRow("clinical_panels", form.id, payload);
      else await insertRow("clinical_panels", payload, practiceId);
      setEditingPanel(null); setAddingPanel(false); load();
    } catch (e) { alert(e.message); }
  };

  const removePanel = async (p) => {
    if (!confirm(`Delete panel "${p.name}" and all its metrics/codes? Patient measurement history will be kept but orphaned.`)) return;
    try { await deleteRow("clinical_panels", p.id); load(); } catch (e) { alert(e.message); }
  };

  if (loading) return <Loader />;
  if (error) return <ErrorBanner message={error} />;

  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>
      <SectionHead title="Clinical Panels" sub="Chronic-condition tracking panels — auto-assigned to patients whose problem list matches."
        action={canEdit && <Btn size="sm" onClick={() => setAddingPanel(true)}>+ Add Panel</Btn>} />

      {panels.length === 0 ? <EmptyState icon="📊" title="No panels configured" />
        : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {panels.map((p) => {
            const panelCodes = codes.filter((c) => c.panel_id === p.id);
            const panelMetrics = metrics.filter((m) => m.panel_id === p.id);
            const expanded = expandedId === p.id;
            return (
              <Card key={p.id} style={{ padding: 0, opacity: p.is_active ? 1 : 0.55 }}>
                <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}
                  onClick={() => setExpandedId(expanded ? null : p.id)}>
                  <div style={{ width: 14, height: 14, borderRadius: "50%", background: p.color, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</span>
                      <Badge label={`${panelMetrics.length} metrics`} variant="neutral" size="xs" />
                      <Badge label={`${panelCodes.length} ICD codes`} variant="neutral" size="xs" />
                      {p.amh_measure_ref && <Badge label="AMH" variant="teal" size="xs" />}
                    </div>
                    {p.description && <div style={{ fontSize: 11, color: C.textSecondary, marginTop: 2 }}>{p.description}</div>}
                  </div>
                  <div style={{ fontSize: 16, color: C.textTertiary }}>{expanded ? "▾" : "▸"}</div>
                  {canEdit && (
                    <>
                      <Btn size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setEditingPanel(p); }}>Edit</Btn>
                      <Btn size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); removePanel(p); }}>×</Btn>
                    </>
                  )}
                </div>
                {expanded && (
                  <div style={{ padding: "0 14px 14px", borderTop: `0.5px solid ${C.borderLight}` }}>
                    <PanelInternals panel={p} codes={panelCodes} metrics={panelMetrics} canEdit={canEdit} onChange={load} />
                  </div>
                )}
              </Card>
            );
          })}
        </div>}

      {(addingPanel || editingPanel) && (
        <PanelForm
          initial={editingPanel || { name: "", color: COLOR_PRESETS[0], description: "", amh_measure_ref: "", sort_order: (panels.at(-1)?.sort_order || 0) + 1, is_active: true }}
          onClose={() => { setAddingPanel(false); setEditingPanel(null); }}
          onSave={savePanel}
        />
      )}
    </div>
  );
}

function PanelInternals({ panel, codes, metrics, canEdit, onChange }) {
  const [addingCode, setAddingCode] = useState(false);
  const [addingMetric, setAddingMetric] = useState(false);
  const [editingMetric, setEditingMetric] = useState(null);

  const removeCode = async (c) => {
    if (!confirm(`Remove trigger code ${c.code}?`)) return;
    try { await deleteRow("panel_condition_codes", c.id); onChange(); } catch (e) { alert(e.message); }
  };
  const addCode = async (f) => {
    try {
      await supabase.from("panel_condition_codes").insert({ panel_id: panel.id, code_system: "ICD-10", code: f.code.toUpperCase(), code_prefix: !!f.code_prefix });
      setAddingCode(false); onChange();
    } catch (e) { alert(e.message); }
  };
  const saveMetric = async (f) => {
    try {
      const payload = {
        name: f.name, unit: f.unit || null, description: f.description || null,
        ref_low: num(f.ref_low), ref_high: num(f.ref_high),
        goal_low: num(f.goal_low), goal_high: num(f.goal_high),
        threshold_low: num(f.threshold_low), threshold_high: num(f.threshold_high),
        higher_is_better: !!f.higher_is_better,
        loinc_code: f.loinc_code || null,
        sort_order: parseInt(f.sort_order) || 0,
        is_active: f.is_active !== false,
      };
      if (f.id) await updateRow("clinical_metrics", f.id, payload);
      else await supabase.from("clinical_metrics").insert({ panel_id: panel.id, ...payload });
      setEditingMetric(null); setAddingMetric(false); onChange();
    } catch (e) { alert(e.message); }
  };
  const removeMetric = async (m) => {
    if (!confirm(`Remove metric "${m.name}"? Existing measurements keep their metric_name.`)) return;
    try { await deleteRow("clinical_metrics", m.id); onChange(); } catch (e) { alert(e.message); }
  };

  return (
    <>
      <div style={{ display: "flex", gap: 16, marginTop: 10 }}>
        {/* ICD codes */}
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.textSecondary, textTransform: "uppercase", letterSpacing: "0.04em" }}>Trigger codes</div>
            {canEdit && <Btn size="sm" variant="ghost" onClick={() => setAddingCode(true)}>+ code</Btn>}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {codes.length === 0 ? <span style={{ fontSize: 11, color: C.textTertiary }}>None</span>
              : codes.map((c) => (
                <span key={c.id} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", background: C.bgSecondary, borderRadius: 4, fontSize: 11, fontFamily: "monospace" }}>
                  {c.code}{c.code_prefix && "*"}
                  {canEdit && <button onClick={() => removeCode(c)} style={{ background: "none", border: "none", fontSize: 12, cursor: "pointer", color: C.textTertiary }}>×</button>}
                </span>
              ))}
          </div>
          <div style={{ fontSize: 10, color: C.textTertiary, marginTop: 4 }}>* prefix match (e.g. E11* matches E11.9, E11.65)</div>
        </div>

        {/* Metrics */}
        <div style={{ flex: 2 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.textSecondary, textTransform: "uppercase", letterSpacing: "0.04em" }}>Metrics</div>
            {canEdit && <Btn size="sm" variant="ghost" onClick={() => setAddingMetric(true)}>+ metric</Btn>}
          </div>
          {metrics.length === 0 ? <span style={{ fontSize: 11, color: C.textTertiary }}>None</span>
            : metrics.map((m) => (
              <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderBottom: `0.5px solid ${C.borderLight}` }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 500 }}>{m.name} <span style={{ color: C.textTertiary, fontWeight: 400 }}>{m.unit}</span></div>
                  <div style={{ fontSize: 10, color: C.textTertiary }}>
                    {m.ref_low != null || m.ref_high != null ? `ref ${m.ref_low ?? "–"}–${m.ref_high ?? "–"}` : ""}
                    {m.goal_high != null ? ` · goal <${m.goal_high}` : ""}
                    {m.goal_low != null ? ` · goal ≥${m.goal_low}` : ""}
                  </div>
                </div>
                {canEdit && <>
                  <Btn size="sm" variant="ghost" onClick={() => setEditingMetric(m)}>edit</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => removeMetric(m)}>×</Btn>
                </>}
              </div>
            ))}
        </div>
      </div>

      {addingCode && <CodeForm onClose={() => setAddingCode(false)} onSave={addCode} />}
      {(addingMetric || editingMetric) && (
        <MetricForm
          initial={editingMetric || { name: "", unit: "", sort_order: (metrics.at(-1)?.sort_order || 0) + 1, is_active: true, higher_is_better: false }}
          onClose={() => { setAddingMetric(false); setEditingMetric(null); }}
          onSave={saveMetric}
        />
      )}
    </>
  );
}

function PanelForm({ initial, onClose, onSave }) {
  const [f, setF] = useState(initial);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  return (
    <Modal title={initial.id ? "Edit Panel" : "New Panel"} onClose={onClose} maxWidth={520}>
      <Input label="Name *" value={f.name} onChange={set("name")} placeholder="e.g. Diabetes, Asthma, CKD" />
      <Textarea label="Description" value={f.description} onChange={set("description")} rows={2} placeholder="What this panel tracks and why" />
      <Input label="AMH measure ref (optional)" value={f.amh_measure_ref} onChange={set("amh_measure_ref")} placeholder="e.g. HBD: Glycemic Status Assessment" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Input label="Sort order" type="number" value={f.sort_order} onChange={set("sort_order")} />
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 18 }}>
          <FL>Active</FL>
          <Toggle value={f.is_active} onChange={set("is_active")} />
        </div>
      </div>
      <FL>Color</FL>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
        {COLOR_PRESETS.map((c) => (
          <button key={c} onClick={() => set("color")(c)} style={{
            width: 32, height: 32, borderRadius: "50%", background: c,
            border: f.color === c ? `3px solid ${C.textPrimary}` : "2px solid #fff",
            boxShadow: "0 0 0 1px rgba(0,0,0,0.1)", cursor: "pointer",
          }} />
        ))}
        <input type="color" value={f.color} onChange={(e) => set("color")(e.target.value)} style={{ width: 32, height: 32, border: "none", cursor: "pointer", background: "transparent" }} />
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        <Btn onClick={() => f.name.trim() && onSave(f)}>Save</Btn>
      </div>
    </Modal>
  );
}

function MetricForm({ initial, onClose, onSave }) {
  const [f, setF] = useState(initial);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  return (
    <Modal title={initial.id ? "Edit Metric" : "New Metric"} onClose={onClose} maxWidth={540}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Input label="Name *" value={f.name} onChange={set("name")} placeholder="HbA1c, BP systolic..." />
        <Input label="Unit" value={f.unit} onChange={set("unit")} placeholder="%, mg/dL, mmHg..." />
      </div>
      <Textarea label="Description" value={f.description} onChange={set("description")} rows={2} />
      <div style={{ fontSize: 11, fontWeight: 600, color: C.textSecondary, textTransform: "uppercase", letterSpacing: "0.04em", margin: "8px 0 4px" }}>Reference range</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Input label="Ref low" type="number" value={f.ref_low ?? ""} onChange={set("ref_low")} />
        <Input label="Ref high" type="number" value={f.ref_high ?? ""} onChange={set("ref_high")} />
      </div>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.textSecondary, textTransform: "uppercase", letterSpacing: "0.04em", margin: "8px 0 4px" }}>Goal (amber flag outside this)</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Input label="Goal low" type="number" value={f.goal_low ?? ""} onChange={set("goal_low")} />
        <Input label="Goal high" type="number" value={f.goal_high ?? ""} onChange={set("goal_high")} />
      </div>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.textSecondary, textTransform: "uppercase", letterSpacing: "0.04em", margin: "8px 0 4px" }}>Threshold (red flag outside this)</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Input label="Threshold low" type="number" value={f.threshold_low ?? ""} onChange={set("threshold_low")} />
        <Input label="Threshold high" type="number" value={f.threshold_high ?? ""} onChange={set("threshold_high")} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
        <Input label="LOINC code" value={f.loinc_code} onChange={set("loinc_code")} placeholder="e.g. 4548-4" />
        <Input label="Sort order" type="number" value={f.sort_order} onChange={set("sort_order")} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
        <input type="checkbox" checked={!!f.higher_is_better} onChange={(e) => set("higher_is_better")(e.target.checked)} />
        <span style={{ fontSize: 12 }}>Higher is better (e.g. HDL, eGFR)</span>
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        <Btn onClick={() => f.name.trim() && onSave(f)}>Save</Btn>
      </div>
    </Modal>
  );
}

function CodeForm({ onClose, onSave }) {
  const [f, setF] = useState({ code: "", code_prefix: false });
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  return (
    <Modal title="Add ICD-10 trigger code" onClose={onClose} maxWidth={400}>
      <Input label="ICD-10 code *" value={f.code} onChange={set("code")} placeholder="E11.9 or E11 for prefix match" />
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <input type="checkbox" checked={f.code_prefix} onChange={(e) => set("code_prefix")(e.target.checked)} />
        <span style={{ fontSize: 12 }}>Prefix match (e.g. "E11" matches E11.9, E11.65, etc.)</span>
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        <Btn onClick={() => f.code.trim() && onSave(f)}>Add</Btn>
      </div>
    </Modal>
  );
}

function num(v) { if (v === "" || v === null || v === undefined) return null; const n = parseFloat(v); return isNaN(n) ? null : n; }
