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

// ─── inline SVG chart with axes, gridlines, and date labels ─────────────────
function MiniChart({ rows }) {
  const W = 700, H = 200;
  const padL = 52, padR = 16, padT = 16, padB = 34;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  const vals = rows.map(r => Number(r.measured_value)).filter(v => !Number.isNaN(v));
  if (vals.length < 2) return null;

  const rawMin = Math.min(...vals);
  const rawMax = Math.max(...vals);
  const span = (rawMax - rawMin) || 1;
  const yMin = rawMin - span * 0.15;
  const yMax = rawMax + span * 0.15;
  const ySpan = yMax - yMin;

  const fmt = (v) => {
    const av = Math.abs(v);
    if (av >= 100) return v.toFixed(0);
    return v.toFixed(1);
  };

  const yTicks = [yMax, (yMin + yMax) / 2, yMin];

  const xFor = (i) => padL + (chartW * (i / (rows.length - 1)));
  const yFor = (v) => padT + chartH - ((v - yMin) / ySpan) * chartH;

  const points = rows.map((r, i) => ({
    x: xFor(i),
    y: yFor(Number(r.measured_value)),
    in_goal: r.in_goal,
    date: r.measured_at,
  }));

  const pathD = points.map((p, i) => (i === 0 ? "M" : "L") + p.x.toFixed(1) + "," + p.y.toFixed(1)).join(" ");

  const dateAt = (idx) => {
    const d = new Date(rows[idx].measured_at);
    return d.toLocaleDateString("en-US", { month:"short", day:"numeric" });
  };
  const labelIdx = rows.length >= 5
    ? [0, Math.floor(rows.length / 2), rows.length - 1]
    : [0, rows.length - 1];

  return (
    <div style={{ width:"100%", overflowX:"auto" }}>
      <svg viewBox={"0 0 " + W + " " + H} style={{ width:"100%", height:200, display:"block" }}>
        {/* Y-axis gridlines + value labels */}
        {yTicks.map((t, i) => (
          <g key={"y" + i}>
            <line x1={padL} x2={padL + chartW}
                  y1={yFor(t)} y2={yFor(t)}
                  stroke={C.borderLight} strokeWidth="0.5"
                  strokeDasharray={i === 1 ? "2,3" : "0"} />
            <text x={padL - 8} y={yFor(t) + 3.5}
                  textAnchor="end" fontSize="10"
                  fill={C.textTertiary} fontFamily="inherit">
              {fmt(t)}
            </text>
          </g>
        ))}

        {/* X-axis baseline */}
        <line x1={padL} x2={padL + chartW}
              y1={padT + chartH} y2={padT + chartH}
              stroke={C.borderMid} strokeWidth="0.5" />

        {/* X-axis date labels */}
        {labelIdx.map((i, k) => (
          <text key={"x" + k} x={xFor(i)} y={H - 10}
                textAnchor="middle" fontSize="10"
                fill={C.textTertiary} fontFamily="inherit">
            {dateAt(i)}
          </text>
        ))}

        {/* Data line */}
        <path d={pathD} fill="none" stroke={C.teal} strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" />

        {/* Data points */}
        {points.map((p, i) => (
          <circle key={"pt" + i} cx={p.x} cy={p.y} r="4"
                  fill={p.in_goal ? C.teal : C.amber}
                  stroke="#fff" strokeWidth="1.5" />
        ))}
      </svg>
    </div>
  );
}
