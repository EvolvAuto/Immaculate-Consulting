// ═══════════════════════════════════════════════════════════════════════════════
// src/views/patient/TrendsTab.jsx
// Chronic-condition tracking tab for the patient detail modal.
// Auto-detects applicable panels from the patient's problem list and renders
// per-panel trend charts, sparkline rows, and a full measurement history.
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../auth/AuthProvider";
import { C } from "../../lib/tokens";
import { insertRow, logAudit } from "../../lib/db";
import { Badge, Btn, Card, Modal, Input, Select, FL, SectionHead, Loader, ErrorBanner, EmptyState } from "../../components/ui";
import { TrendChart, Sparkline, evaluateMetric } from "../../components/TrendChart";

export default function TrendsTab({ patient }) {
  const { practiceId, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [panels, setPanels] = useState([]);       // panels applicable to this patient
  const [allPanels, setAllPanels] = useState([]); // all configured panels (for +add)
  const [metrics, setMetrics] = useState([]);     // metric definitions for active panel
  const [measurements, setMeasurements] = useState([]); // all measurements for patient
  const [activePanelId, setActivePanelId] = useState(null);
  const [adding, setAdding] = useState(null); // metric to add a value for

  useEffect(() => {
    if (!patient?.id) return;
    (async () => {
      try {
        setLoading(true);
        const [pRes, cRes, mRes, measRes] = await Promise.all([
          supabase.from("clinical_panels").select("*").eq("is_active", true).order("sort_order"),
          supabase.from("panel_condition_codes").select("*"),
          supabase.from("clinical_metrics").select("*").eq("is_active", true).order("sort_order"),
          supabase.from("clinical_measurements").select("*").eq("patient_id", patient.id).order("measured_at"),
        ]);
        if (pRes.error) throw pRes.error;
        const allP = pRes.data || [];
        const codes = cRes.data || [];
        const mets  = mRes.data  || [];
        const meas  = measRes.data || [];

        // Auto-assign panels based on problem list
        const problemCodes = (patient.problem_list || [])
          .map((p) => typeof p === "string" ? p : p.code)
          .filter(Boolean);

        const applicable = allP.filter((pnl) => {
          const panelCodes = codes.filter((c) => c.panel_id === pnl.id);
          return panelCodes.some((pc) => problemCodes.some((pcode) => pc.code_prefix ? pcode.startsWith(pc.code) : pcode === pc.code));
        });

        setAllPanels(allP);
        setPanels(applicable);
        setMetrics(mets);
        setMeasurements(meas);
        if (applicable.length > 0 && !activePanelId) setActivePanelId(applicable[0].id);
      } catch (e) { setError(e.message); }
      finally { setLoading(false); }
    })();
  }, [patient?.id]);

  const activePanel = panels.find((p) => p.id === activePanelId) || allPanels.find((p) => p.id === activePanelId);
  const panelMetrics = useMemo(() => metrics.filter((m) => m.panel_id === activePanelId), [metrics, activePanelId]);

  // Build per-metric history
  const metricHistory = useMemo(() => {
    const byMetric = {};
    panelMetrics.forEach((m) => {
      byMetric[m.name] = measurements
        .filter((meas) => meas.metric_name === m.name && meas.value_numeric != null)
        .map((meas) => ({
          value: Number(meas.value_numeric),
          measured_at: meas.measured_at,
          is_flagged: meas.is_flagged,
          source: meas.source,
          id: meas.id,
        }));
    });
    return byMetric;
  }, [panelMetrics, measurements]);

  const addPanel = (pid) => setActivePanelId(pid);

  const saveMeasurement = async (metric, form) => {
    try {
      const val = parseFloat(form.value);
      if (isNaN(val)) { alert("Enter a numeric value"); return; }
      const flag = isFlagged(val, metric);
      await insertRow("clinical_measurements", {
        patient_id: patient.id,
        metric_id: metric.id,
        metric_name: metric.name,
        panel_name: activePanel?.name,
        value_numeric: val,
        unit: metric.unit,
        measured_at: form.measured_at ? new Date(form.measured_at).toISOString() : new Date().toISOString(),
        source: form.source || "Manual",
        source_detail: form.source_detail || null,
        is_flagged: flag.flag,
        flag_reason: flag.reason,
        entered_by: profile?.id,
      }, practiceId, { audit: { entityType: "clinical_measurements", patientId: patient.id, details: { metric: metric.name, value: val } } });
      // Reload
      const { data } = await supabase.from("clinical_measurements").select("*").eq("patient_id", patient.id).order("measured_at");
      setMeasurements(data || []);
      setAdding(null);
    } catch (e) { alert(e.message); }
  };

  if (loading) return <Loader />;
  if (error) return <ErrorBanner message={error} />;

  // No applicable panels & no active selection yet
  if (panels.length === 0 && !activePanelId) {
    return (
      <div>
        <EmptyState icon="📊" title="No chronic-condition panels apply" sub="Panels auto-assign from the problem list. Pick one manually if needed." />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginTop: 16 }}>
          {allPanels.map((p) => (
            <PanelPill key={p.id} panel={p} active={false} onClick={() => setActivePanelId(p.id)} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Panel pills */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
        {panels.map((p) => (
          <PanelPill key={p.id} panel={p} active={p.id === activePanelId} onClick={() => setActivePanelId(p.id)} />
        ))}
        {allPanels.filter((p) => !panels.find((x) => x.id === p.id)).length > 0 && (
          <PanelMenu otherPanels={allPanels.filter((p) => !panels.find((x) => x.id === p.id))} activeId={activePanelId} onPick={setActivePanelId} />
        )}
      </div>
      <div style={{ fontSize: 11, color: C.textTertiary, margin: "8px 0 20px" }}>
        Auto-assigned from problem list
        {(patient.problem_list || []).length > 0 && <>: {(patient.problem_list || []).slice(0, 4).map((p) => typeof p === "string" ? p : p.code).filter(Boolean).join(", ")}</>}
      </div>

      {activePanel && panelMetrics.length > 0 && (
        <PanelView
          panel={activePanel}
          metrics={panelMetrics}
          history={metricHistory}
          onAddValue={(m) => setAdding(m)}
          measurements={measurements.filter((m) => panelMetrics.some((pm) => pm.name === m.metric_name))}
        />
      )}

      {adding && <AddMeasurementModal metric={adding} onClose={() => setAdding(null)} onSave={(form) => saveMeasurement(adding, form)} />}
    </div>
  );
}

function PanelPill({ panel, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "6px 12px", borderRadius: 999,
      border: `0.5px solid ${active ? panel.color : C.borderMid}`,
      background: active ? panel.color + "18" : "transparent",
      color: active ? panel.color : C.textPrimary,
      fontSize: 12, fontWeight: active ? 600 : 400,
      fontFamily: "inherit", cursor: "pointer",
    }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: panel.color }} />
      {panel.name}
    </button>
  );
}

function PanelMenu({ otherPanels, activeId, onPick }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen(!open)} style={{
        padding: "6px 12px", borderRadius: 999, border: `0.5px dashed ${C.borderMid}`,
        background: "transparent", color: C.textSecondary, fontSize: 12, fontFamily: "inherit", cursor: "pointer",
      }}>+ other panel</button>
      {open && (
        <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, background: C.bgPrimary, border: `0.5px solid ${C.borderMid}`, borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,0.08)", zIndex: 10, minWidth: 200 }}>
          {otherPanels.map((p) => (
            <div key={p.id} onClick={() => { onPick(p.id); setOpen(false); }}
              style={{ padding: "8px 12px", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: p.color }} />
              {p.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PanelView({ panel, metrics, history, onAddValue, measurements }) {
  // Primary metric (first in sort order) gets the big chart
  const primary = metrics[0];
  const primaryHistory = history[primary?.name] || [];

  // Overall panel status — worst among primary metric's latest reading
  const latestPrimary = primaryHistory.length > 0 ? primaryHistory[primaryHistory.length - 1].value : null;
  const panelStatus = latestPrimary != null ? evaluateMetric(latestPrimary, primary) : { label: "No data", chip: "neutral" };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{panel.name}</div>
          {panel.description && <div style={{ fontSize: 11, color: C.textSecondary, marginTop: 2 }}>{panel.description}</div>}
          {panel.amh_measure_ref && (
            <div style={{ fontSize: 10, color: C.textTertiary, marginTop: 4 }}>
              Tracked against NC Medicaid AMH measure: <b>{panel.amh_measure_ref}</b>
            </div>
          )}
        </div>
        <Badge label={panelStatus.label} variant={panelStatus.chip} />
      </div>

      {/* Primary metric chart */}
      {primary && primaryHistory.length > 0 && (
        <div style={{ background: C.bgPrimary, border: `0.5px solid ${C.borderLight}`, borderRadius: 8, padding: 12, marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
            {primary.name} <span style={{ color: C.textTertiary, fontWeight: 400 }}>({primary.unit})</span>
          </div>
          <TrendChart
            data={primaryHistory}
            unit={primary.unit ? " " + primary.unit : ""}
            goalLow={primary.goal_low} goalHigh={primary.goal_high}
            thresholdLow={primary.threshold_low} thresholdHigh={primary.threshold_high}
            refLow={primary.ref_low} refHigh={primary.ref_high}
            higherIsBetter={primary.higher_is_better}
            color={panel.color}
          />
        </div>
      )}
      {primary && primaryHistory.length === 0 && (
        <div style={{ padding: 24, border: `1px dashed ${C.borderLight}`, borderRadius: 8, textAlign: "center", color: C.textTertiary, fontSize: 12, marginBottom: 20 }}>
          No {primary.name} history yet. Values entered during encounters will appear here.
          <br />
          <Btn size="sm" variant="outline" onClick={() => onAddValue(primary)} style={{ marginTop: 12 }}>+ Add {primary.name} value</Btn>
        </div>
      )}

      {/* Sparkline rows for every metric in the panel */}
      <SectionHead title="Panel metrics" sub="Latest values vs goal" />
      <div style={{ background: C.bgPrimary, border: `0.5px solid ${C.borderLight}`, borderRadius: 8, overflow: "hidden" }}>
        {metrics.map((m, i) => {
          const hist = history[m.name] || [];
          const latest = hist.length > 0 ? hist[hist.length - 1] : null;
          const prev   = hist.length > 1 ? hist[hist.length - 2] : null;
          const ev = latest ? evaluateMetric(latest.value, m) : { label: "No data", chip: "neutral", color: C.textTertiary };
          const delta = latest && prev ? latest.value - prev.value : null;
          return (
            <div key={m.id} style={{
              display: "grid", gridTemplateColumns: "1.4fr 140px 1.2fr 90px 70px",
              alignItems: "center", gap: 12,
              padding: "12px 14px",
              borderTop: i > 0 ? `0.5px solid ${C.borderLight}` : "none",
            }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{m.name}</div>
                <div style={{ fontSize: 11, color: C.textSecondary, marginTop: 2 }}>
                  {m.description || (m.ref_low != null || m.ref_high != null ? `Ref ${m.ref_low ?? "–"}${m.ref_high != null ? `–${m.ref_high}` : "+"} ${m.unit || ""}` : m.unit)}
                </div>
              </div>
              <div style={{ height: 28 }}>
                <Sparkline values={hist.map((v) => v.value)} color={panel.color} goal={m.goal_high ?? m.goal_low} width={140} height={28} />
              </div>
              <div>
                {latest ? (
                  <div>
                    <span style={{ fontSize: 15, fontWeight: 600, color: ev.color }}>{formatValue(latest.value)}</span>
                    <span style={{ fontSize: 11, color: C.textSecondary, marginLeft: 4 }}>{m.unit}</span>
                    <span style={{ marginLeft: 8 }}><Badge label={ev.label} variant={ev.chip} size="xs" /></span>
                  </div>
                ) : (
                  <Btn size="sm" variant="ghost" onClick={() => onAddValue(m)}>+ Add</Btn>
                )}
              </div>
              <div style={{ fontSize: 11, color: C.textSecondary, textAlign: "right" }}>
                {latest && new Date(latest.measured_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </div>
              <div style={{ fontSize: 11, textAlign: "right", color: delta == null ? C.textTertiary : (delta === 0 ? C.textSecondary : (m.higher_is_better ? (delta > 0 ? "#27500A" : "#A32D2D") : (delta > 0 ? "#A32D2D" : "#27500A"))) }}>
                {delta == null ? "—" : `${delta > 0 ? "↑" : delta < 0 ? "↓" : ""} ${formatValue(Math.abs(delta))}`}
              </div>
            </div>
          );
        })}
      </div>

      {/* Full measurement history table */}
      <SectionHead title="Measurement history" sub={`${measurements.length} values across ${metrics.length} metrics`}
        action={<Btn size="sm" variant="outline" onClick={() => onAddValue(primary)}>+ Add measurement</Btn>} />
      {measurements.length === 0 ? (
        <EmptyState title="No measurements yet" />
      ) : (
        <div style={{ background: C.bgPrimary, border: `0.5px solid ${C.borderLight}`, borderRadius: 8, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "110px 1.2fr 1fr 0.8fr 1fr", padding: "8px 14px", fontSize: 10, fontWeight: 700, color: C.textSecondary, textTransform: "uppercase", letterSpacing: "0.04em", background: C.bgSecondary, borderBottom: `0.5px solid ${C.borderLight}` }}>
            <div>Date</div><div>Metric</div><div>Value</div><div>Ref</div><div>Source</div>
          </div>
          {[...measurements].reverse().map((m) => {
            const metric = metrics.find((x) => x.name === m.metric_name);
            const ev = metric ? evaluateMetric(Number(m.value_numeric), metric) : { chip: "neutral", label: "—", color: C.textTertiary };
            return (
              <div key={m.id} style={{ display: "grid", gridTemplateColumns: "110px 1.2fr 1fr 0.8fr 1fr", padding: "10px 14px", fontSize: 12, borderTop: `0.5px solid ${C.borderLight}`, alignItems: "center" }}>
                <div style={{ color: C.textSecondary }}>{new Date(m.measured_at).toLocaleDateString()}</div>
                <div>{m.metric_name}</div>
                <div>
                  <span style={{ fontWeight: 600, color: ev.color }}>{formatValue(m.value_numeric)}</span>
                  <span style={{ color: C.textSecondary, marginLeft: 4 }}>{m.unit}</span>
                  {m.is_flagged && <Badge label="Flag" variant="red" size="xs" />}
                </div>
                <div style={{ color: C.textTertiary, fontSize: 11 }}>
                  {metric?.ref_low != null || metric?.ref_high != null ? `${metric.ref_low ?? "–"}–${metric.ref_high ?? "–"}` : "—"}
                </div>
                <div style={{ color: C.textSecondary, fontSize: 11 }}>
                  {m.source}{m.source_detail && ` · ${m.source_detail}`}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function isFlagged(val, metric) {
  if (metric.threshold_low != null && val < metric.threshold_low) return { flag: true, reason: `Below threshold ${metric.threshold_low}` };
  if (metric.threshold_high != null && val > metric.threshold_high) return { flag: true, reason: `Above threshold ${metric.threshold_high}` };
  if (!metric.higher_is_better && metric.goal_high != null && val > metric.goal_high) return { flag: true, reason: `Above goal ${metric.goal_high}` };
  if ( metric.higher_is_better && metric.goal_low  != null && val < metric.goal_low)  return { flag: true, reason: `Below goal ${metric.goal_low}` };
  return { flag: false, reason: null };
}

function formatValue(v) {
  const n = Number(v);
  if (!isFinite(n)) return "—";
  if (Math.abs(n) >= 10) return Math.round(n).toString();
  return n.toFixed(1);
}

function AddMeasurementModal({ metric, onClose, onSave }) {
  const [f, setF] = useState({
    value: "", measured_at: new Date().toISOString().slice(0, 16),
    source: "Manual", source_detail: "",
  });
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  return (
    <Modal title={`Add ${metric?.name || "measurement"}`} onClose={onClose} maxWidth={440}>
      <div style={{ fontSize: 11, color: C.textTertiary, marginBottom: 10 }}>
        {metric?.description} {metric?.unit && `(${metric.unit})`}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Input label={`Value ${metric?.unit ? "(" + metric.unit + ")" : ""}`} value={f.value} onChange={set("value")} placeholder={metric?.goal_high ? `goal <${metric.goal_high}` : ""} />
        <Input label="Measured At" type="datetime-local" value={f.measured_at} onChange={set("measured_at")} />
        <Select label="Source" value={f.source} onChange={set("source")} options={["Manual", "Interface", "Patient Reported"]} />
        <Input label="Source detail" value={f.source_detail} onChange={set("source_detail")} placeholder="Quest, LabCorp, in-office..." />
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        <Btn onClick={() => onSave(f)}>Save</Btn>
      </div>
    </Modal>
  );
}
