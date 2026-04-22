// ═══════════════════════════════════════════════════════════════════════════════
// src/components/TrendChart.jsx
// Pure-SVG trend chart + sparkline. Zero external deps - no recharts, no d3.
// Renders HbA1c-style charts with goal/threshold bands and in-range shading.
// TrendChart is interactive: hover snaps to nearest data point by X coordinate
// and shows a tooltip with value, date, status, and source.
// ═══════════════════════════════════════════════════════════════════════════════

import { useRef, useState } from "react";
import { C } from "../lib/tokens";

// ─── Sparkline: tiny inline SVG, 120x24 by default ───────────────────────────
export function Sparkline({ values, color = "#378ADD", goal = null, width = 120, height = 24 }) {
  if (!values || values.length < 2) {
    return <svg width={width} height={height}><line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke={C.textTertiary} strokeWidth="1" strokeDasharray="2,2" /></svg>;
  }
  const min = Math.min(...values, goal ?? Infinity);
  const max = Math.max(...values, goal ?? -Infinity);
  const range = max - min || 1;
  const pad = 2;
  const usableW = width - pad * 2;
  const usableH = height - pad * 2;
  const points = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * usableW;
    const y = pad + usableH - ((v - min) / range) * usableH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const lastX = pad + usableW;
  const lastY = pad + usableH - ((values[values.length - 1] - min) / range) * usableH;
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      {goal != null && (
        <line x1={pad} x2={pad + usableW}
          y1={pad + usableH - ((goal - min) / range) * usableH}
          y2={pad + usableH - ((goal - min) / range) * usableH}
          stroke={C.textTertiary} strokeWidth="1" strokeDasharray="2,2" opacity="0.5" />
      )}
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r="2.5" fill={color} />
    </svg>
  );
}

// ─── Full trend chart with reference band, goal/threshold, axis labels ───────
export function TrendChart({ data, unit = "", goalLow, goalHigh, thresholdLow, thresholdHigh, refLow, refHigh, height = 220, color = "#378ADD", higherIsBetter = false }) {
  // Hooks must run unconditionally - declare before any early returns.
  const svgRef = useRef(null);
  const [hoverIdx, setHoverIdx] = useState(null);

  if (!data || data.length === 0) {
    return <div style={{ padding: 24, textAlign: "center", color: C.textTertiary, fontSize: 12 }}>No data yet</div>;
  }
  const width = 640;
  const padL = 44, padR = 16, padT = 14, padB = 34;
  const w = width - padL - padR;
  const h = height - padT - padB;

  const values = data.map((d) => d.value);
  const bounds = [...values];
  [goalLow, goalHigh, thresholdLow, thresholdHigh, refLow, refHigh].forEach((v) => { if (v != null) bounds.push(v); });
  let yMin = Math.min(...bounds);
  let yMax = Math.max(...bounds);
  const cushion = (yMax - yMin) * 0.15 || 1;
  yMin -= cushion;
  yMax += cushion;
  const yRange = yMax - yMin;

  const xFor = (i) => padL + (data.length === 1 ? w / 2 : (i / (data.length - 1)) * w);
  const yFor = (v) => padT + h - ((v - yMin) / yRange) * h;

  const linePoints = data.map((d, i) => `${xFor(i)},${yFor(d.value)}`).join(" ");

  // Reference band (in-range, if both bounds provided)
  const refBand = refLow != null && refHigh != null ? (
    <rect x={padL} y={yFor(refHigh)} width={w} height={yFor(refLow) - yFor(refHigh)}
      fill={C.teal || "#1D9E75"} opacity="0.06" />
  ) : null;

  // Y-axis ticks (4)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => yMin + t * yRange);

  // X-axis labels - show first, last, and up to 3 in between
  const xTickIdx = data.length <= 6
    ? data.map((_, i) => i)
    : [0, Math.floor(data.length / 4), Math.floor(data.length / 2), Math.floor(3 * data.length / 4), data.length - 1];

  // ── Hover handling ──────────────────────────────────────────────────────────
  // Translate mouse position into the nearest data point index. The SVG scales
  // to fit its container via viewBox, so convert DOM coords to SVG coord space
  // before snapping.
  const handleMove = (e) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const scaleX = width / rect.width;
    const svgX = (e.clientX - rect.left) * scaleX;
    if (svgX < padL || svgX > padL + w) { setHoverIdx(null); return; }
    let nearest = 0;
    let bestDist = Infinity;
    for (let i = 0; i < data.length; i++) {
      const dist = Math.abs(xFor(i) - svgX);
      if (dist < bestDist) { bestDist = dist; nearest = i; }
    }
    setHoverIdx(nearest);
  };
  const handleLeave = () => setHoverIdx(null);

  // Status evaluation scoped to what TrendChart receives (just goal/threshold
  // values, not a full metric object). Falls back to neutral when thresholds
  // aren't provided.
  const statusFor = (val) => {
    if (val == null || isNaN(val)) return { label: "", color: C.textTertiary };
    if (thresholdLow != null && val < thresholdLow) return { label: higherIsBetter ? "Critical low" : "Below threshold", color: "#A32D2D" };
    if (thresholdHigh != null && val > thresholdHigh) return { label: "Above threshold", color: "#A32D2D" };
    if (!higherIsBetter && goalHigh != null && val > goalHigh) return { label: "Above goal", color: "#854F0B" };
    if ( higherIsBetter && goalLow  != null && val < goalLow)  return { label: "Below goal", color: "#854F0B" };
    if (!higherIsBetter && goalLow  != null && val < goalLow)  return { label: "Below range", color: "#854F0B" };
    if (goalLow != null || goalHigh != null) return { label: "At goal", color: "#27500A" };
    return { label: "", color: C.textSecondary };
  };

  // Tooltip rendered inside the SVG so it scales with it. Positioned above the
  // point when there's room; flipped below when the point is near the top.
  const renderTooltip = () => {
    if (hoverIdx == null) return null;
    const d = data[hoverIdx];
    const pointX = xFor(hoverIdx);
    const pointY = yFor(d.value);
    const status = statusFor(d.value);
    const dateLabel = new Date(d.measured_at || d.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const valueLabel = `${Math.abs(d.value) >= 10 ? Math.round(d.value) : Number(d.value).toFixed(1)}${unit}`;
    const sourceLabel = d.source ? (d.source_detail ? `${d.source} · ${d.source_detail}` : d.source) : "";

    const tipW = 180;
    const tipH = status.label ? 58 : 42;
    const gap = 10;

    // Prefer above the point; flip below if too close to the top
    const flip = pointY - gap - tipH < padT + 4;
    const tipY = flip ? pointY + gap : pointY - gap - tipH;

    // Keep within left/right bounds
    let tipX = pointX - tipW / 2;
    if (tipX < padL) tipX = padL;
    if (tipX + tipW > padL + w) tipX = padL + w - tipW;

    return (
      <g style={{ pointerEvents: "none" }}>
        <line x1={pointX} y1={padT} x2={pointX} y2={padT + h}
          stroke={color} strokeWidth="1" strokeDasharray="3,3" opacity="0.35" />
        <circle cx={pointX} cy={pointY} r="7" fill="none" stroke={color} strokeWidth="1.5" opacity="0.5" />
        <rect x={tipX} y={tipY} width={tipW} height={tipH} rx="6"
          fill="#fff" stroke={C.borderMid || "#D0D5DD"} strokeWidth="0.5"
          style={{ filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.12))" }} />
        <text x={tipX + 10} y={tipY + 17} fontSize="12" fontWeight="700" fill={C.textPrimary || "#1A1A1A"} fontFamily="inherit">
          {valueLabel}
        </text>
        <text x={tipX + tipW - 10} y={tipY + 17} textAnchor="end" fontSize="10" fill={C.textSecondary || "#555"} fontFamily="inherit">
          {dateLabel}
        </text>
        {status.label && (
          <text x={tipX + 10} y={tipY + 33} fontSize="10" fontWeight="600" fill={status.color} fontFamily="inherit">
            {status.label}
          </text>
        )}
        {sourceLabel && (
          <text x={tipX + 10} y={tipY + (status.label ? 49 : 33)} fontSize="10" fill={C.textTertiary || "#777"} fontFamily="inherit">
            {sourceLabel}
          </text>
        )}
      </g>
    );
  };

  return (
    <svg ref={svgRef} width="100%" viewBox={`0 0 ${width} ${height}`}
      style={{ display: "block", maxWidth: "100%", cursor: hoverIdx != null ? "crosshair" : "default" }}
      preserveAspectRatio="xMidYMid meet"
      onMouseMove={handleMove} onMouseLeave={handleLeave}>
      {refBand}

      {/* Invisible hit layer over the plot area - ensures mousemove fires even
          on empty SVG space (between points, above the line, etc). */}
      <rect x={padL} y={padT} width={w} height={h} fill="transparent" />

      {/* Goal line */}
      {goalHigh != null && !higherIsBetter && (
        <g>
          <line x1={padL} y1={yFor(goalHigh)} x2={padL + w} y2={yFor(goalHigh)}
            stroke="#27500A" strokeWidth="1.5" strokeDasharray="4,3" opacity="0.65" />
          <text x={padL + w - 2} y={yFor(goalHigh) - 4} textAnchor="end"
            fontSize="10" fill="#27500A" fontFamily="inherit">goal {goalHigh}{unit}</text>
        </g>
      )}
      {goalLow != null && higherIsBetter && (
        <g>
          <line x1={padL} y1={yFor(goalLow)} x2={padL + w} y2={yFor(goalLow)}
            stroke="#27500A" strokeWidth="1.5" strokeDasharray="4,3" opacity="0.65" />
          <text x={padL + w - 2} y={yFor(goalLow) - 4} textAnchor="end"
            fontSize="10" fill="#27500A" fontFamily="inherit">goal ≥{goalLow}{unit}</text>
        </g>
      )}

      {/* Threshold line (caution) */}
      {thresholdHigh != null && !higherIsBetter && (
        <g>
          <line x1={padL} y1={yFor(thresholdHigh)} x2={padL + w} y2={yFor(thresholdHigh)}
            stroke="#A32D2D" strokeWidth="1.5" strokeDasharray="4,3" opacity="0.55" />
          <text x={padL + w - 2} y={yFor(thresholdHigh) - 4} textAnchor="end"
            fontSize="10" fill="#A32D2D" fontFamily="inherit">threshold {thresholdHigh}{unit}</text>
        </g>
      )}

      {/* Y-axis ticks */}
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={padL - 4} y1={yFor(t)} x2={padL} y2={yFor(t)} stroke={C.textTertiary} strokeWidth="0.5" />
          <text x={padL - 6} y={yFor(t) + 3} textAnchor="end" fontSize="10" fill={C.textTertiary} fontFamily="inherit">
            {Math.abs(t) >= 10 ? Math.round(t) : t.toFixed(1)}
          </text>
        </g>
      ))}

      {/* X-axis */}
      <line x1={padL} y1={padT + h} x2={padL + w} y2={padT + h} stroke={C.borderLight} strokeWidth="0.5" />
      {xTickIdx.map((i) => {
        const d = data[i];
        const date = new Date(d.measured_at || d.date);
        const label = date.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
        return (
          <text key={i} x={xFor(i)} y={padT + h + 16} textAnchor="middle" fontSize="10" fill={C.textTertiary} fontFamily="inherit">
            {label}
          </text>
        );
      })}

      {/* Data line + area */}
      <polygon points={`${padL},${padT + h} ${linePoints} ${padL + w},${padT + h}`} fill={color} opacity="0.08" />
      <polyline points={linePoints} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

      {/* Data points */}
      {data.map((d, i) => (
        <g key={i}>
          <circle cx={xFor(i)} cy={yFor(d.value)} r="4" fill={color} stroke="#fff" strokeWidth="1.5" />
          {d.is_flagged && <circle cx={xFor(i)} cy={yFor(d.value)} r="7" fill="none" stroke="#A32D2D" strokeWidth="1" opacity="0.6" />}
        </g>
      ))}

      {/* Tooltip (rendered last so it sits on top of everything) */}
      {renderTooltip()}
    </svg>
  );
}

// ─── Evaluate a single value against metric definition → status + color ──────
export function evaluateMetric(value, metric) {
  if (value == null || isNaN(value)) return { status: "unknown", label: "—", color: C.textTertiary, chip: "neutral" };
  const hib = metric.higher_is_better;
  // Out of threshold → red
  if (metric.threshold_low != null && value < metric.threshold_low) return { status: "critical", label: hib ? "Critical low" : "Below threshold", color: "#A32D2D", chip: "red" };
  if (metric.threshold_high != null && value > metric.threshold_high) return { status: "critical", label: "Above threshold", color: "#A32D2D", chip: "red" };
  // Out of goal → amber
  if (!hib && metric.goal_high != null && value > metric.goal_high) return { status: "elevated", label: "Above goal", color: "#854F0B", chip: "amber" };
  if ( hib && metric.goal_low != null && value < metric.goal_low)   return { status: "below",    label: "Below goal", color: "#854F0B", chip: "amber" };
  if (!hib && metric.goal_low != null && value < metric.goal_low)   return { status: "low",      label: "Below range", color: "#854F0B", chip: "amber" };
  // In goal
  return { status: "good", label: "At goal", color: "#27500A", chip: "green" };
}
