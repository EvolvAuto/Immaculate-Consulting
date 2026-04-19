// ═══════════════════════════════════════════════════════════════════════════════
// src/views/portal/PortalTrends.jsx
// Clinical measurements trends for the patient. Self-read RLS already in place.
// Uses a self-contained mini chart (so portal doesn't have to import TrendChart).
// ═══════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from "react";
import { supabase, logAudit } from "../../lib/supabaseClient";
import { C, Panel, Badge, Empty, InfoBox, fmtDate } from "./_ui.jsx";

export default function PortalTrends({ patientId }) {
  const [measurements, setMeasurements] = useState([]);
  const [panels, setPanels] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const m = await supabase.from("clinical_measurements")
          .select("id, metric_id, metric_name, value_numeric, unit, measured_at, source, is_flagged")
          .eq("patient_id", patientId)
          .order("measured_at", { ascending:false }).limit(500);
        if (!active) return;
        setMeasurements(m.data || []);
        logAudit({ action:"Read", entityType:"clinical_measurements", entityId:patientId }).catch(()=>{});
      } catch (e) {
        console.warn("[trends] load failed:", e?.message || e);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [patientId]);

// Group by metric_name, keep oldest-first for chart.
  // Normalize DB columns (value_numeric, is_flagged) to the shape the
  // rendering code below expects (measured_value, in_goal).
  const byMetric = useMemo(() => {
    const map = {};
    [...measurements].reverse().forEach(raw => {
      const m = {
        ...raw,
        measured_value: raw.value_numeric,
        in_goal:        !raw.is_flagged,
      };
      const k = m.metric_name || m.metric_id || "Unknown";
      if (!map[k]) map[k] = [];
      map[k].push(m);
    });
    return map;
  }, [measurements]);

  if (loading) return <Empty title="Loading your trends..." />;
  if (Object.keys(byMetric).length === 0)
    return <Empty title="No measurements yet"
                  subtitle="When your provider records measurements, they will appear here as trends." />;

  return (
    <div>
      <InfoBox>
        These are measurements recorded during your visits. The green band shows your target
        range when your provider has set one.
      </InfoBox>

      {Object.entries(byMetric).map(([metric, rows]) => {
        const latest = rows[rows.length - 1];
        const prior = rows.length > 1 ? rows[rows.length - 2] : null;
        const delta = prior ? (Number(latest.measured_value) - Number(prior.measured_value)) : null;
        const deltaPct = delta !== null && Number(prior.measured_value) !== 0
          ? (delta / Number(prior.measured_value)) * 100 : null;

        return (
          <Panel key={metric}>
            <div style={{
              display:"flex", justifyContent:"space-between", alignItems:"flex-start",
              flexWrap:"wrap", gap:10, marginBottom:10,
            }}>
              <div>
                <div style={{ fontSize:13, fontWeight:600, color:C.textPrimary }}>{metric}</div>
                <div style={{ fontSize:11, color:C.textTertiary, marginTop:2 }}>
                  {rows.length} reading{rows.length === 1 ? "" : "s"} - latest {fmtDate(latest.measured_at)}
                </div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:22, fontWeight:700, color: latest.in_goal ? C.green : C.amber }}>
                  {latest.measured_value} <span style={{ fontSize:12, color:C.textSecondary, fontWeight:400 }}>{latest.unit}</span>
                </div>
                {delta !== null && (
                  <div style={{ fontSize:10, color: delta < 0 ? C.green : C.red, fontWeight:500 }}>
                    {delta > 0 ? "▲ +" : "▼ "}{delta.toFixed(1)}
                    {deltaPct !== null ? " (" + deltaPct.toFixed(1) + "%)" : ""} from last
                  </div>
                )}
                <div style={{ marginTop:4 }}>
                  <Badge label={latest.in_goal ? "In Goal" : "Out of Goal"}
                         variant={latest.in_goal ? "teal" : "amber"} />
                </div>
              </div>
            </div>

            {rows.length > 1 && <MiniChart rows={rows} />}
          </Panel>
        );
      })}
    </div>
  );
}

// ─── tiny inline SVG chart ────────────────────────────────────────────────────
function MiniChart({ rows }) {
  const W = 640, H = 120, PAD = 12;
  const vals = rows.map(r => Number(r.measured_value)).filter(v => !Number.isNaN(v));
  if (vals.length < 2) return null;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = (max - min) || 1;
  const paddedMin = min - span * 0.15;
  const paddedMax = max + span * 0.15;
  const paddedSpan = paddedMax - paddedMin;

  const points = rows.map((r, i) => {
    const x = PAD + ((W - 2 * PAD) * (i / (rows.length - 1)));
    const val = Number(r.measured_value);
    const y = H - PAD - ((val - paddedMin) / paddedSpan) * (H - 2 * PAD);
    return { x, y, in_goal: r.in_goal, date: r.measured_at, val };
  });

  const pathD = points.map((p, i) => (i === 0 ? "M" : "L") + p.x.toFixed(1) + "," + p.y.toFixed(1)).join(" ");

  return (
    <div style={{ width:"100%", overflowX:"auto" }}>
      <svg viewBox={"0 0 " + W + " " + H} style={{ width:"100%", height:120, display:"block" }}>
        <path d={pathD} fill="none" stroke={C.teal} strokeWidth="1.5" />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="3"
                  fill={p.in_goal ? C.teal : C.amber}
                  stroke="#fff" strokeWidth="1" />
        ))}
      </svg>
    </div>
  );
}
