// ═══════════════════════════════════════════════════════════════════════════════
// src/views/patient/PanelQuickEntryStrip.jsx
// Inline strip for the Clinical encounter editor. Appears under the Assessment
// section when the patient has an active chronic condition. Provider can enter
// key panel values inline — values write to clinical_measurements on sign.
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../auth/AuthProvider";
import { C } from "../../lib/tokens";
import { insertRow } from "../../lib/db";
import { FL } from "../../components/ui";

// Expected props:
//   patient            — patient row (must have problem_list)
//   encounter          — encounter row (must have id, patient_id, practice_id)
//   disabled           — true when encounter is Signed (locked)
//   onValuesChange?    — optional callback (values) => void, called whenever local values change
//
// Writes happen OUTSIDE this component — the encounter editor calls
// `savePanelValues(patient, encounter, values)` exported below when the user
// saves the draft or signs the note. This keeps writes atomic with the note.

export default function PanelQuickEntryStrip({ patient, encounter, disabled, onValuesChange }) {
  const { practiceId } = useAuth();
  const [panels, setPanels] = useState([]);
  const [metrics, setMetrics] = useState([]);
  const [lastValues, setLastValues] = useState({}); // metric_name → last value (any date)
  const [values, setValues] = useState({});         // metric_name → string input

  useEffect(() => {
    if (!patient?.id) return;
    (async () => {
      const [pRes, cRes, mRes, lastRes] = await Promise.all([
        supabase.from("clinical_panels").select("*").eq("is_active", true).order("sort_order"),
        supabase.from("panel_condition_codes").select("*"),
        supabase.from("clinical_metrics").select("*").eq("is_active", true).order("sort_order"),
        supabase.from("clinical_measurements").select("metric_name, value_numeric, measured_at").eq("patient_id", patient.id).order("measured_at", { ascending: false }).limit(200),
      ]);
      const allPanels = pRes.data || [];
      const codes = cRes.data || [];
      const allMetrics = mRes.data || [];

      const problemCodes = (patient.problem_list || []).map((p) => typeof p === "string" ? p : p.code).filter(Boolean);
      const applicable = allPanels.filter((pnl) => {
        const panelCodes = codes.filter((c) => c.panel_id === pnl.id);
        return panelCodes.some((pc) => problemCodes.some((pcode) => pc.code_prefix ? pcode.startsWith(pc.code) : pcode === pc.code));
      });

      // Compute last value per metric (most recent)
      const last = {};
      for (const m of (lastRes.data || [])) {
        if (!(m.metric_name in last)) last[m.metric_name] = m;
      }

      setPanels(applicable);
      setMetrics(allMetrics);
      setLastValues(last);
    })();
  }, [patient?.id]);

  const setVal = (metricName, v) => {
    setValues((prev) => {
      const next = { ...prev, [metricName]: v };
      onValuesChange?.(next);
      return next;
    });
  };

  if (panels.length === 0) return null;

  return (
    <div style={{ marginTop: 10 }}>
      {panels.map((panel) => {
        const panelMetrics = metrics.filter((m) => m.panel_id === panel.id).slice(0, 4); // 4-wide strip
        if (panelMetrics.length === 0) return null;
        return (
          <div key={panel.id} style={{
            background: C.bgSecondary, borderRadius: 8, padding: "10px 12px", marginBottom: 8,
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: panel.color }} />
                <span style={{ fontSize: 12, fontWeight: 600 }}>{panel.name} tracking</span>
                <span style={{ fontSize: 10, color: C.textTertiary }}>suggested from problem list</span>
              </div>
              <span style={{ fontSize: 10, color: C.textSecondary }}>saved to trends on sign</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${panelMetrics.length}, 1fr)`, gap: 8 }}>
              {panelMetrics.map((m) => {
                const last = lastValues[m.name];
                const currentVal = values[m.name] || "";
                const numVal = parseFloat(currentVal);
                const aboveThreshold = !isNaN(numVal) && (
                  (!m.higher_is_better && m.threshold_high != null && numVal > m.threshold_high) ||
                  (!m.higher_is_better && m.goal_high != null && numVal > m.goal_high) ||
                  ( m.higher_is_better && m.threshold_low != null && numVal < m.threshold_low)
                );
                return (
                  <div key={m.id}>
                    <FL>{m.name} {m.unit && <span style={{ color: C.textTertiary, fontWeight: 400 }}>({m.unit})</span>}</FL>
                    <input
                      type="number" step="any" inputMode="decimal"
                      disabled={disabled}
                      value={currentVal}
                      onChange={(e) => setVal(m.name, e.target.value)}
                      placeholder={last?.value_numeric != null ? String(last.value_numeric) : ""}
                      style={{
                        width: "100%", padding: "5px 8px",
                        border: `0.5px solid ${aboveThreshold ? "#A32D2D" : C.borderMid}`,
                        borderRadius: 6, fontSize: 13, fontFamily: "inherit",
                        background: aboveThreshold ? "#FCEBEB" : C.bgPrimary,
                        color: aboveThreshold ? "#A32D2D" : C.textPrimary,
                      }}
                    />
                    <div style={{ fontSize: 10, color: aboveThreshold ? "#A32D2D" : C.textTertiary, marginTop: 2 }}>
                      {last ? `Last: ${last.value_numeric} (${new Date(last.measured_at).toLocaleDateString("en-US", { month: "short", year: "2-digit" })})`
                        : m.goal_high != null ? `goal <${m.goal_high}${m.unit || ""}`
                        : m.goal_low != null ? `goal ≥${m.goal_low}${m.unit || ""}`
                        : ""}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Helper the encounter editor calls on save/sign ─────────────────────────
// Writes any non-empty input values to clinical_measurements, flagged per
// metric thresholds. Silent no-op for empty inputs.
export async function savePanelValues({ patientId, practiceId, encounterId, values, metrics, panels, enteredBy }) {
  const inserts = [];
  for (const [metricName, rawVal] of Object.entries(values || {})) {
    const v = parseFloat(rawVal);
    if (isNaN(v)) continue;
    const metric = metrics.find((m) => m.name === metricName);
    if (!metric) continue;
    const panel = panels.find((p) => p.id === metric.panel_id);
    const flag = evaluateThreshold(v, metric);
    inserts.push({
      practice_id: practiceId,
      patient_id: patientId,
      metric_id: metric.id,
      encounter_id: encounterId,
      metric_name: metric.name,
      panel_name: panel?.name,
      value_numeric: v,
      unit: metric.unit,
      measured_at: new Date().toISOString(),
      source: "Manual",
      source_detail: "Documented during encounter",
      is_flagged: flag.flag,
      flag_reason: flag.reason,
      entered_by: enteredBy,
    });
  }
  if (inserts.length === 0) return { inserted: 0 };
  const { error } = await supabase.from("clinical_measurements").insert(inserts);
  if (error) throw error;
  return { inserted: inserts.length };
}

function evaluateThreshold(v, m) {
  if (!m.higher_is_better && m.threshold_high != null && v > m.threshold_high) return { flag: true, reason: `Above threshold ${m.threshold_high}` };
  if (!m.higher_is_better && m.goal_high != null && v > m.goal_high) return { flag: true, reason: `Above goal ${m.goal_high}` };
  if ( m.higher_is_better && m.threshold_low != null && v < m.threshold_low) return { flag: true, reason: `Below threshold ${m.threshold_low}` };
  if ( m.higher_is_better && m.goal_low != null && v < m.goal_low) return { flag: true, reason: `Below goal ${m.goal_low}` };
  return { flag: false, reason: null };
}
