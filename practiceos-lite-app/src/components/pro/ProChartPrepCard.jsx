// ProChartPrepCard.jsx
//
// Destination in the deployed repo: src/components/pro/ProChartPrepCard.jsx
//
// Compact Dashboard widget for Chart Prep. Shows tomorrow's appointment count,
// flag breakdown, and the top items to review. Clicking the card navigates
// to the full Chart Prep tab.
//
// Self-gates on tier: renders null for Lite practices, so it's always safe
// to mount unconditionally in the Dashboard grid.
//
// Props:
//   - practiceId (required): the practice UUID
//   - tier (required): "Lite" | "Pro" | "Command"
//   - onNav (optional): callback fn to switch the main view; called with
//       "pro_chart_prep" when the user clicks "View all"

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { C } from "../../lib/tokens";
import {
  chartPrepSummaryForNextBusinessDay,
  flagCounts,
  patientDisplayName,
  formatSlotTime,
} from "../../lib/chartPrepApi";

const REFRESH_INTERVAL_MS = 300000; // 5 min

function formatPrettyDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month:   "short",
    day:     "numeric",
  });
}

export default function ProChartPrepCard({ practiceId, tier, onNav }) {
  const eligible = tier === "Pro" || tier === "Command";

  const [apptDate, setApptDate]     = useState(null);
  const [notes, setNotes]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);

  const load = useCallback(async () => {
    if (!practiceId || !eligible) {
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const { apptDate: d, notes: ns } = await chartPrepSummaryForNextBusinessDay(practiceId);
      setApptDate(d);
      setNotes(ns);
    } catch (err) {
      setError(err.message || "Failed to load Chart Prep");
    } finally {
      setLoading(false);
    }
  }, [practiceId, eligible]);

  useEffect(() => {
    load();
    if (!eligible) return undefined;
    const id = setInterval(load, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [load, eligible]);

  const summary = useMemo(() => {
    const total    = notes.length;
    const reviewed = notes.filter((n) => n.status === "Reviewed").length;
    const failed   = notes.filter((n) => n.status === "Failed").length;
    let high = 0;
    let med  = 0;
    for (const n of notes) {
      const c = flagCounts(n.flags);
      high += c.high;
      med  += c.medium;
    }
    return { total, reviewed, failed, high, med, unreviewed: total - reviewed };
  }, [notes]);

  // Top 3 items to show: prioritize high-flag first, then medium-flag, then rest
  const topItems = useMemo(() => {
    const scored = notes.map((n) => {
      const c = flagCounts(n.flags);
      return { note: n, score: c.high * 100 + c.medium * 10 + c.low };
    });
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const sa = (a.note.appointments && a.note.appointments.start_slot) || 0;
      const sb = (b.note.appointments && b.note.appointments.start_slot) || 0;
      return sa - sb;
    });
    return scored.slice(0, 3).map((s) => s.note);
  }, [notes]);

  if (!eligible) return null;

  const goToFullView = () => {
    if (typeof onNav === "function") onNav("pro_chart_prep");
  };

  return (
    <div style={{
      background: C.bgPrimary,
      border: "0.5px solid " + C.borderLight,
      borderRadius: 10,
      padding: 18,
      display: "flex",
      flexDirection: "column",
      gap: 14,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: C.textTertiary,
            textTransform: "uppercase", letterSpacing: "0.05em",
          }}>
            Chart Prep
          </div>
          <div style={{
            fontSize: 15, fontWeight: 600, color: C.textPrimary, marginTop: 3,
          }}>
            {apptDate ? formatPrettyDate(apptDate) : "Tomorrow"}
          </div>
        </div>
        <button
          onClick={goToFullView}
          style={{
            background: C.tealBg, color: C.tealDark,
            border: "0.5px solid " + C.tealBorder,
            borderRadius: 6, padding: "4px 10px",
            fontSize: 11, fontWeight: 600, cursor: "pointer",
            flexShrink: 0,
          }}
        >
          View all {"\u2192"}
        </button>
      </div>

      {/* Stats strip */}
      {loading ? (
        <div style={{ color: C.textTertiary, fontSize: 12 }}>Loading...</div>
      ) : error ? (
        <div style={{
          background: C.redBg, border: "0.5px solid " + C.redBorder,
          color: C.red, padding: 8, borderRadius: 6, fontSize: 12,
        }}>
          {error}
        </div>
      ) : summary.total === 0 ? (
        <div style={{
          color: C.textTertiary, fontSize: 12, fontStyle: "italic",
          padding: "8px 0",
        }}>
          No appointments scheduled for {apptDate ? formatPrettyDate(apptDate) : "the next business day"}.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <StatPill label="Appointments" value={summary.total} tone="neutral" />
            <StatPill label="Reviewed"     value={summary.reviewed} tone={summary.reviewed > 0 ? "good" : "neutral"} />
            {summary.high > 0 && (
              <StatPill label="High flags" value={summary.high} tone="bad" />
            )}
            {summary.med > 0 && (
              <StatPill label="Medium"     value={summary.med} tone="warn" />
            )}
            {summary.failed > 0 && (
              <StatPill label="Failed"     value={summary.failed} tone="bad" />
            )}
          </div>

          {/* Top items */}
          <div style={{
            display: "flex", flexDirection: "column", gap: 6,
            borderTop: "0.5px solid " + C.borderLight, paddingTop: 10,
          }}>
            {topItems.map((n) => (
              <TopItemRow key={n.id} note={n} onClick={goToFullView} />
            ))}
          </div>

          {summary.total > 3 && (
            <div style={{ color: C.textTertiary, fontSize: 11, textAlign: "right" }}>
              + {summary.total - 3} more
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatPill({ label, value, tone }) {
  const styles = {
    neutral: { bg: C.bgSecondary, fg: C.textPrimary, border: C.borderLight },
    good:    { bg: C.greenBg,     fg: C.green,       border: C.greenBorder },
    warn:    { bg: C.amberBg,     fg: C.amber,       border: C.amberBorder },
    bad:     { bg: C.redBg,       fg: C.red,         border: C.redBorder },
  };
  const s = styles[tone] || styles.neutral;
  return (
    <div style={{
      background: s.bg, color: s.fg,
      border: "0.5px solid " + s.border,
      borderRadius: 6, padding: "4px 10px",
      display: "inline-flex", alignItems: "baseline", gap: 6,
      fontSize: 11,
    }}>
      <span style={{ fontWeight: 700, fontSize: 13 }}>{value}</span>
      <span style={{ fontWeight: 500 }}>{label}</span>
    </div>
  );
}

function TopItemRow({ note, onClick }) {
  const patient = note.patients || {};
  const appt    = note.appointments || {};
  const counts  = flagCounts(note.flags);
  const name    = patientDisplayName(patient);
  const time    = formatSlotTime(appt.start_slot);
  const isReviewed = note.status === "Reviewed";
  const isFailed   = note.status === "Failed";

  return (
    <button
      onClick={onClick}
      style={{
        textAlign: "left", background: "transparent", border: "none",
        padding: "6px 0", cursor: "pointer",
        display: "grid", gridTemplateColumns: "60px 1fr auto",
        gap: 10, alignItems: "center",
        borderRadius: 4,
      }}
    >
      <span style={{ fontSize: 11, fontWeight: 600, color: C.textSecondary }}>
        {time}
      </span>
      <span style={{
        fontSize: 13, color: isReviewed ? C.textTertiary : C.textPrimary,
        fontWeight: isReviewed ? 400 : 500,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        textDecoration: isReviewed ? "line-through" : "none",
      }}>
        {name}
      </span>
      <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
        {isFailed && (
          <span style={{
            background: C.redBg, color: C.red, border: "0.5px solid " + C.redBorder,
            fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 10,
          }}>
            FAILED
          </span>
        )}
        {counts.high > 0 && (
          <span style={{
            background: C.redBg, color: C.red, border: "0.5px solid " + C.redBorder,
            fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 10,
          }}>
            {counts.high}
          </span>
        )}
        {counts.medium > 0 && counts.high === 0 && (
          <span style={{
            background: C.amberBg, color: C.amber, border: "0.5px solid " + C.amberBorder,
            fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 10,
          }}>
            {counts.medium}
          </span>
        )}
        {isReviewed && (
          <span style={{
            color: C.green, fontSize: 12, fontWeight: 700,
          }}>
            {"\u2713"}
          </span>
        )}
      </span>
    </button>
  );
}
