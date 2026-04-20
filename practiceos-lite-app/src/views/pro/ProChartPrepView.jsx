// ProChartPrepView.jsx
//
// Destination in the deployed repo: src/views/pro/ProChartPrepView.jsx
//
// Full-tab view for the Pro "Chart Prep" feature. Shows the next-business-day
// appointment list with AI-generated prep summaries, lets providers click any
// row to see the full structured note, mark it Reviewed, regenerate it, or
// add a pre-visit note.
//
// Uses: src/lib/chartPrepApi.js, src/auth/AuthProvider (or equivalent hook)

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  listChartPrepNotesForDate,
  fetchChartPrepNote,
  markChartPrepReviewed,
  regenerateChartPrep,
  formatSlotTime,
  patientDisplayName,
  patientAge,
  providerDisplayName,
  flagCounts,
} from "../../lib/chartPrepApi";

// IMPORTANT: adjust this import if your auth hook lives elsewhere.
// The other Pro views (AssistantView, OutreachReviewView, InboundSMSReviewView)
// should use the same hook, so copy whichever one they import from.
import { useAuth } from "../../auth/AuthProvider";

// ---------------------------------------------------------------------------
// Color system - adjust to match your tokens.js if needed
// ---------------------------------------------------------------------------

const COLORS = {
  bgPage:       "#f9fafb",
  bgCard:       "#ffffff",
  bgHover:      "#f3f4f6",
  border:       "#e5e7eb",
  borderStrong: "#d1d5db",
  textPrimary:  "#111827",
  textMuted:    "#6b7280",
  textFaint:    "#9ca3af",
  accent:       "#0f766e",   // teal - matches IC brand
  accentLight:  "#ccfbf1",
  severityHigh:   { bg: "#fef2f2", fg: "#991b1b", border: "#fecaca" },
  severityMedium: { bg: "#fffbeb", fg: "#92400e", border: "#fde68a" },
  severityLow:    { bg: "#f3f4f6", fg: "#4b5563", border: "#d1d5db" },
  statusGenerated: { bg: "#eff6ff", fg: "#1e40af" },
  statusReviewed:  { bg: "#f0fdf4", fg: "#15803d" },
  statusFailed:    { bg: "#fef2f2", fg: "#991b1b" },
  statusStale:     { bg: "#f5f5f4", fg: "#57534e" },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nextBusinessDayISO(fromDate) {
  // Simple client-side fallback for the default date picker starting value.
  // The real business-day logic lives server-side in next_business_day_for_practice.
  const d = new Date(fromDate || new Date());
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function formatPrettyDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month:   "long",
    day:     "numeric",
    year:    "numeric",
  });
}

function statusColors(status) {
  if (status === "Reviewed") return COLORS.statusReviewed;
  if (status === "Failed")   return COLORS.statusFailed;
  if (status === "Stale")    return COLORS.statusStale;
  return COLORS.statusGenerated;
}

function severityColors(sev) {
  const s = (sev || "").toLowerCase();
  if (s === "high")   return COLORS.severityHigh;
  if (s === "medium") return COLORS.severityMedium;
  return COLORS.severityLow;
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export default function ProChartPrepView() {
  const auth = useAuth();
  const practiceId = auth && auth.practiceId;

  const [targetDate, setTargetDate] = useState(nextBusinessDayISO());
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);

  const loadNotes = useCallback(async () => {
    if (!practiceId) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await listChartPrepNotesForDate(practiceId, targetDate);
      setNotes(rows);
    } catch (err) {
      setError(err.message || "Failed to load chart prep notes");
    } finally {
      setLoading(false);
    }
  }, [practiceId, targetDate]);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  const handleNoteUpdated = (updatedNote) => {
    setNotes((prev) => prev.map((n) => (n.id === updatedNote.id ? { ...n, ...updatedNote } : n)));
  };

  const handleNoteRegenerated = async (noteId) => {
    // The regenerate call is async - wait a beat, then refetch.
    setTimeout(async () => {
      try {
        const refreshed = await fetchChartPrepNote(noteId);
        handleNoteUpdated(refreshed);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[ProChartPrepView] refresh after regen failed", err.message || err);
      }
    }, 12000);
  };

  const summary = useMemo(() => computeSummary(notes), [notes]);

  const selectedNote = useMemo(
    () => notes.find((n) => n.id === selectedId) || null,
    [notes, selectedId],
  );

  return (
    <div style={{ backgroundColor: COLORS.bgPage, minHeight: "100%", padding: 24 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0, color: COLORS.textPrimary }}>
            Chart Prep
          </h1>
          <div style={{ color: COLORS.textMuted, fontSize: 14, marginTop: 4 }}>
            Pre-visit summaries for {formatPrettyDate(targetDate)}
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <label style={{ fontSize: 13, color: COLORS.textMuted }}>
            Date:
            <input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              style={{
                marginLeft: 8,
                padding: "6px 8px",
                border: "1px solid " + COLORS.borderStrong,
                borderRadius: 4,
                fontSize: 13,
              }}
            />
          </label>
          <button
            onClick={loadNotes}
            disabled={loading}
            style={{
              padding: "8px 16px",
              background: COLORS.bgCard,
              border: "1px solid " + COLORS.borderStrong,
              borderRadius: 4,
              cursor: loading ? "default" : "pointer",
              fontSize: 13,
              color: COLORS.textPrimary,
            }}
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      {/* Summary band */}
      <SummaryBand summary={summary} />

      {/* Error */}
      {error && (
        <div style={{
          background: COLORS.severityHigh.bg, border: "1px solid " + COLORS.severityHigh.border,
          color: COLORS.severityHigh.fg, padding: 12, borderRadius: 6, marginBottom: 16,
        }}>
          {error}
        </div>
      )}

      {/* List */}
      {loading && notes.length === 0 ? (
        <div style={{ color: COLORS.textMuted, textAlign: "center", padding: 40 }}>
          Loading chart prep notes...
        </div>
      ) : notes.length === 0 ? (
        <EmptyState targetDate={targetDate} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {notes.map((note) => (
            <ChartPrepRow
              key={note.id}
              note={note}
              onClick={() => setSelectedId(note.id)}
            />
          ))}
        </div>
      )}

      {/* Detail modal */}
      {selectedNote && (
        <ChartPrepDetailModal
          note={selectedNote}
          onClose={() => setSelectedId(null)}
          onReviewed={handleNoteUpdated}
          onRegenerated={handleNoteRegenerated}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary band
// ---------------------------------------------------------------------------

function computeSummary(notes) {
  const total    = notes.length;
  const reviewed = notes.filter((n) => n.status === "Reviewed").length;
  const failed   = notes.filter((n) => n.status === "Failed").length;
  let highFlags = 0;
  let medFlags  = 0;
  for (const n of notes) {
    const c = flagCounts(n.flags);
    highFlags += c.high;
    medFlags  += c.medium;
  }
  return { total, reviewed, failed, highFlags, medFlags };
}

function SummaryBand({ summary }) {
  const items = [
    { label: "Appointments",  value: summary.total,    tone: "neutral" },
    { label: "Reviewed",      value: summary.reviewed, tone: "good"    },
    { label: "High flags",    value: summary.highFlags, tone: summary.highFlags > 0 ? "bad" : "neutral" },
    { label: "Medium flags",  value: summary.medFlags,  tone: "neutral" },
    { label: "Failed",        value: summary.failed,    tone: summary.failed > 0 ? "bad" : "neutral" },
  ];
  return (
    <div style={{
      display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap",
    }}>
      {items.map((item) => (
        <div key={item.label} style={{
          flex: "1 1 150px",
          background: COLORS.bgCard,
          border: "1px solid " + COLORS.border,
          borderRadius: 6,
          padding: "12px 16px",
        }}>
          <div style={{ color: COLORS.textMuted, fontSize: 12, fontWeight: 500 }}>
            {item.label}
          </div>
          <div style={{
            fontSize: 22, fontWeight: 600, marginTop: 4,
            color: item.tone === "bad"  ? "#b91c1c"
                 : item.tone === "good" ? "#15803d"
                 : COLORS.textPrimary,
          }}>
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ targetDate }) {
  return (
    <div style={{
      background: COLORS.bgCard, border: "1px dashed " + COLORS.borderStrong,
      borderRadius: 6, padding: 40, textAlign: "center",
    }}>
      <div style={{ fontSize: 15, color: COLORS.textPrimary, fontWeight: 500 }}>
        No chart prep notes for {formatPrettyDate(targetDate)}
      </div>
      <div style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 6 }}>
        Prep notes are generated the evening before each business day. If this date is in the past
        or no appointments are scheduled, nothing will appear here.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

function ChartPrepRow({ note, onClick }) {
  const stat = statusColors(note.status);
  const counts = flagCounts(note.flags);
  const apptMeta = note.appointments || {};
  const patient  = note.patients || {};
  const provider = note.providers || null;
  const name = patientDisplayName(patient);
  const age  = patientAge(patient);
  const gen  = patient.gender ? String(patient.gender).charAt(0).toUpperCase() : "";
  const identity = [age, gen].filter(Boolean).join("");

  return (
    <button
      onClick={onClick}
      style={{
        textAlign: "left",
        background: COLORS.bgCard,
        border: "1px solid " + COLORS.border,
        borderRadius: 6,
        padding: 16,
        cursor: "pointer",
        display: "grid",
        gridTemplateColumns: "90px 1fr auto",
        gap: 16,
        alignItems: "center",
        fontSize: 14,
        color: COLORS.textPrimary,
      }}
    >
      {/* Time column */}
      <div>
        <div style={{ fontWeight: 600, fontSize: 15 }}>
          {formatSlotTime(apptMeta.start_slot)}
        </div>
        <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 2 }}>
          {apptMeta.appt_type || ""}
        </div>
      </div>

      {/* Main column */}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>{name}</span>
          {identity && (
            <span style={{ color: COLORS.textMuted, fontSize: 13 }}>{identity}</span>
          )}
          {provider && (
            <span style={{ color: COLORS.textMuted, fontSize: 13 }}>{"\u2022"} {providerDisplayName(provider)}</span>
          )}
        </div>
        {note.one_line_summary && (
          <div style={{
            color: COLORS.textMuted, fontSize: 13, marginTop: 6,
            overflow: "hidden", display: "-webkit-box",
            WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
          }}>
            {note.one_line_summary}
          </div>
        )}
        {note.status === "Failed" && note.error_message && (
          <div style={{
            color: COLORS.statusFailed.fg, fontSize: 12, marginTop: 6,
            fontFamily: "ui-monospace, monospace",
          }}>
            {note.error_message.slice(0, 140)}
          </div>
        )}
      </div>

      {/* Right column: status + flags */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
        <span style={{
          background: stat.bg, color: stat.fg,
          padding: "3px 10px", borderRadius: 12, fontSize: 11, fontWeight: 600,
        }}>
          {note.status}
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          {counts.high > 0 && (
            <FlagBadge level="high" count={counts.high} />
          )}
          {counts.medium > 0 && (
            <FlagBadge level="medium" count={counts.medium} />
          )}
          {counts.low > 0 && (
            <FlagBadge level="low" count={counts.low} />
          )}
        </div>
      </div>
    </button>
  );
}

function FlagBadge({ level, count }) {
  const colors = severityColors(level);
  return (
    <span style={{
      background: colors.bg, color: colors.fg, border: "1px solid " + colors.border,
      fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 10,
    }}>
      {count} {level}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Detail modal
// ---------------------------------------------------------------------------

function ChartPrepDetailModal({ note, onClose, onReviewed, onRegenerated }) {
  const [providerNote, setProviderNote] = useState(note.provider_note || "");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const patient = note.patients || {};
  const appt    = note.appointments || {};
  const provider = note.providers || null;
  const name  = patientDisplayName(patient);
  const age   = patientAge(patient);
  const mrn   = patient.mrn || "";

  const handleMarkReviewed = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const updated = await markChartPrepReviewed(note.id, providerNote || null);
      onReviewed && onReviewed({ ...note, ...updated });
      onClose();
    } catch (err) {
      setActionError(err.message || "Failed to mark reviewed");
    } finally {
      setBusy(false);
    }
  };

  const handleRegenerate = async () => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await regenerateChartPrep(note.appointment_id);
      onRegenerated && onRegenerated(note.id);
      setActionError("Regeneration dispatched. This note will refresh in about 10 seconds.");
    } catch (err) {
      setActionError(err.message || "Regeneration failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
        zIndex: 1000, display: "flex", alignItems: "flex-start",
        justifyContent: "center", padding: 40, overflowY: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: COLORS.bgCard, borderRadius: 8, maxWidth: 840,
          width: "100%", padding: 0, boxShadow: "0 10px 40px rgba(0,0,0,0.2)",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "20px 24px", borderBottom: "1px solid " + COLORS.border,
          display: "flex", alignItems: "flex-start", gap: 16,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 600, color: COLORS.textPrimary }}>
              {name}
              {age !== null && (
                <span style={{ color: COLORS.textMuted, fontWeight: 400, fontSize: 16, marginLeft: 8 }}>
                  {age}{patient.gender ? String(patient.gender).charAt(0).toUpperCase() : ""}
                </span>
              )}
              {mrn && (
                <span style={{ color: COLORS.textFaint, fontWeight: 400, fontSize: 14, marginLeft: 12 }}>
                  {mrn}
                </span>
              )}
            </div>
            <div style={{ color: COLORS.textMuted, fontSize: 13, marginTop: 4 }}>
              {providerDisplayName(provider) || "No provider"}
              {" \u2022 "}
              {appt.appt_type || "No type"}
              {" \u2022 "}
              {formatSlotTime(appt.start_slot)}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              border: "none", background: "transparent", fontSize: 22,
              cursor: "pointer", color: COLORS.textMuted, lineHeight: 1, padding: 4,
            }}
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
          {/* One line summary */}
          {note.one_line_summary && (
            <div style={{
              background: COLORS.accentLight, padding: 14, borderRadius: 6,
              fontSize: 14, lineHeight: 1.5, color: "#134e4a", fontWeight: 500,
            }}>
              {note.one_line_summary}
            </div>
          )}

          {/* Historical arc */}
          {note.historical_arc && (
            <DetailSection title="Historical arc">
              <div style={{ fontStyle: "italic", color: COLORS.textPrimary, fontSize: 14, lineHeight: 1.5 }}>
                {note.historical_arc}
              </div>
            </DetailSection>
          )}

          {/* Key problems */}
          {Array.isArray(note.key_problems) && note.key_problems.length > 0 && (
            <DetailSection title="Key problems">
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {note.key_problems.map((p, i) => (
                  <div key={i} style={{
                    background: COLORS.bgHover, padding: 10, borderRadius: 5,
                    borderLeft: "3px solid " + COLORS.accent,
                  }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</div>
                    {p.status && (
                      <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 2 }}>
                        Status: <strong>{p.status}</strong>
                      </div>
                    )}
                    {p.last_addressed && (
                      <div style={{ fontSize: 13, color: COLORS.textPrimary, marginTop: 4 }}>
                        {p.last_addressed}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </DetailSection>
          )}

          {/* Two-column row: overdue + recent changes */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            {Array.isArray(note.overdue_measures) && note.overdue_measures.length > 0 && (
              <DetailSection title="Overdue">
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
                  {note.overdue_measures.map((m, i) => (
                    <li key={i}>
                      <strong>{m.measure}</strong>
                      {m.last_date ? " - last " + m.last_date : " - never documented"}
                      {m.days_overdue ? " (" + m.days_overdue + " days overdue)" : ""}
                    </li>
                  ))}
                </ul>
              </DetailSection>
            )}
            {Array.isArray(note.recent_changes) && note.recent_changes.length > 0 && (
              <DetailSection title="Recent changes">
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
                  {note.recent_changes.map((c, i) => (
                    <li key={i}>
                      <span style={{
                        background: COLORS.bgHover, padding: "1px 6px", borderRadius: 3,
                        fontSize: 11, marginRight: 6, color: COLORS.textMuted,
                      }}>
                        {c.type}
                      </span>
                      {c.summary}
                      {c.date && (
                        <span style={{ color: COLORS.textFaint, fontSize: 12 }}>
                          {" (" + c.date + ")"}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </DetailSection>
            )}
          </div>

          {/* Suggested agenda */}
          {Array.isArray(note.suggested_agenda) && note.suggested_agenda.length > 0 && (
            <DetailSection title="Suggested agenda">
              <ol style={{ margin: 0, paddingLeft: 22, fontSize: 14, lineHeight: 1.7 }}>
                {note.suggested_agenda.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ol>
            </DetailSection>
          )}

          {/* Flags */}
          {Array.isArray(note.flags) && note.flags.length > 0 && (
            <DetailSection title="Flags">
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {note.flags.map((f, i) => {
                  const c = severityColors(f.severity);
                  return (
                    <div key={i} style={{
                      background: c.bg, border: "1px solid " + c.border,
                      color: c.fg, padding: "8px 12px", borderRadius: 5,
                      fontSize: 13, display: "flex", gap: 10, alignItems: "flex-start",
                    }}>
                      <span style={{
                        fontSize: 11, fontWeight: 700, textTransform: "uppercase",
                        flexShrink: 0, marginTop: 1,
                      }}>
                        {f.severity || "low"}
                      </span>
                      <span>{f.text}</span>
                    </div>
                  );
                })}
              </div>
            </DetailSection>
          )}

          {/* Device + vaccine notes (side by side) */}
          {((Array.isArray(note.device_notes) && note.device_notes.length > 0) ||
            (Array.isArray(note.vaccine_notes) && note.vaccine_notes.length > 0)) && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              {Array.isArray(note.device_notes) && note.device_notes.length > 0 && (
                <DetailSection title="Devices">
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
                    {note.device_notes.map((d, i) => (
                      <li key={i}>
                        <strong>{d.device}</strong>
                        {d.note && <span>: {d.note}</span>}
                      </li>
                    ))}
                  </ul>
                </DetailSection>
              )}
              {Array.isArray(note.vaccine_notes) && note.vaccine_notes.length > 0 && (
                <DetailSection title="Vaccines">
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
                    {note.vaccine_notes.map((v, i) => (
                      <li key={i}>
                        <strong>{v.vaccine}</strong> - {v.stance}
                        {v.implication && <span>. {v.implication}</span>}
                      </li>
                    ))}
                  </ul>
                </DetailSection>
              )}
            </div>
          )}

          {/* SDOH */}
          {note.sdoh_summary && (
            <DetailSection title="Social determinants">
              <div style={{ fontSize: 13, lineHeight: 1.5, color: COLORS.textPrimary }}>
                {note.sdoh_summary}
              </div>
            </DetailSection>
          )}

          {/* Provider note */}
          <DetailSection title="Your pre-visit note (optional)">
            <textarea
              value={providerNote}
              onChange={(e) => setProviderNote(e.target.value)}
              placeholder="Anything to remember before walking in..."
              rows={3}
              style={{
                width: "100%", border: "1px solid " + COLORS.borderStrong,
                borderRadius: 4, padding: 8, fontSize: 13, fontFamily: "inherit",
                resize: "vertical",
              }}
            />
          </DetailSection>

          {/* Action row */}
          {actionError && (
            <div style={{
              background: COLORS.severityMedium.bg, border: "1px solid " + COLORS.severityMedium.border,
              color: COLORS.severityMedium.fg, padding: 10, borderRadius: 5, fontSize: 13,
            }}>
              {actionError}
            </div>
          )}
          <div style={{
            display: "flex", gap: 10, justifyContent: "space-between", alignItems: "center",
            borderTop: "1px solid " + COLORS.border, paddingTop: 16,
          }}>
            <div style={{ fontSize: 11, color: COLORS.textFaint }}>
              Model: {note.model || "unknown"}
              {note.last_attempt_at && (" \u2022 generated " + new Date(note.last_attempt_at).toLocaleString())}
              {note.generation_attempts > 1 && (" \u2022 attempt " + note.generation_attempts)}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={handleRegenerate}
                disabled={busy}
                style={{
                  padding: "8px 16px", background: COLORS.bgCard,
                  border: "1px solid " + COLORS.borderStrong, borderRadius: 4,
                  cursor: busy ? "default" : "pointer", fontSize: 13,
                  color: COLORS.textPrimary, opacity: busy ? 0.6 : 1,
                }}
              >
                Regenerate
              </button>
              {note.status !== "Reviewed" && (
                <button
                  onClick={handleMarkReviewed}
                  disabled={busy}
                  style={{
                    padding: "8px 18px", background: COLORS.accent,
                    border: "1px solid " + COLORS.accent, borderRadius: 4,
                    color: "#fff", cursor: busy ? "default" : "pointer",
                    fontSize: 13, fontWeight: 500, opacity: busy ? 0.6 : 1,
                  }}
                >
                  {busy ? "Saving..." : "Mark Reviewed"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailSection({ title, children }) {
  return (
    <div>
      <div style={{
        fontSize: 11, fontWeight: 700, textTransform: "uppercase",
        color: COLORS.textMuted, marginBottom: 8, letterSpacing: 0.5,
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}
