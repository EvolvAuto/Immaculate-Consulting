// ===============================================================================
// src/components/GoalEditor.jsx
// Row-based editor and display for structured care plan goals.
//
// Exports:
//   <GoalEditor goals onChange readOnly />   - editable row-based editor
//   <GoalDisplay goals />                     - read-only richly-rendered list
//
// Both accept any mix of string/legacy/canonical goal shapes; they normalize
// internally via normalizeGoal(). GoalEditor emits normalized objects through
// onChange so the saved data is always canonical.
// ===============================================================================

import { useState } from "react";
import { C } from "../lib/tokens";
import { Badge, Btn } from "./ui";
import {
  normalizeGoal, normalizeGoals, blankGoal, isBlankGoal,
  PRIORITY_OPTIONS, STATUS_OPTIONS, DOMAIN_SUGGESTIONS,
} from "../lib/cmGoals";

const inputStyle = {
  width: "100%",
  padding: "7px 10px",
  border: "1px solid " + C.borderMid,
  borderRadius: 6,
  fontSize: 12,
  fontFamily: "inherit",
  outline: "none",
  color: C.textPrimary,
  background: C.bgPrimary,
  boxSizing: "border-box",
};

const selectStyle = {
  ...inputStyle,
  WebkitAppearance: "none",
  paddingRight: 28,
};

const priorityColor = {
  high:   { bg: C.redBg,    border: C.redBorder,    text: C.red    },
  medium: { bg: C.amberBg,  border: C.amberBorder,  text: C.amber  },
  low:    { bg: C.greenBg,  border: C.greenBorder,  text: C.green  },
};

const statusColor = {
  open:    { bg: C.blueBg,   text: C.blue     },
  met:     { bg: C.greenBg,  text: C.green    },
  not_met: { bg: C.redBg,    text: C.red      },
  removed: { bg: C.bgTertiary, text: C.textTertiary },
};

const sourceColor = {
  carried_over: { bg: C.purpleBg, text: C.purple, label: "CARRIED OVER" },
  new:          { bg: C.tealBg,   text: C.teal,   label: "NEW THIS REVIEW" },
};

// -----------------------------------------------------------------------------
// GoalEditor - editable. Used in NewPlanModal and any future edit-plan flows.
// -----------------------------------------------------------------------------
export function GoalEditor({ goals, onChange, readOnly = false, label = "Goals" }) {
  // Always work with normalized shape internally
  const normalized = normalizeGoals(goals);

  // Initialize with at least one blank row if empty (so there's always somewhere to type)
  const rows = normalized.length > 0 ? normalized : [blankGoal()];

  const updateRow = (idx, patch) => {
    const next = rows.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    onChange(next);
  };

  const addRow = () => {
    onChange([...rows, blankGoal()]);
  };

  const removeRow = (idx) => {
    const next = rows.filter((_, i) => i !== idx);
    // If user removes the last row, leave one blank
    onChange(next.length > 0 ? next : [blankGoal()]);
  };

  const moveRow = (idx, dir) => {
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= rows.length) return;
    const next = [...rows];
    [next[idx], next[targetIdx]] = [next[targetIdx], next[idx]];
    onChange(next);
  };

  return (
    <div>
      {label && (
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary }}>
            {label} ({rows.filter(r => !isBlankGoal(r)).length})
          </div>
          {!readOnly && (
            <Btn variant="outline" size="sm" onClick={addRow}>
              + Add goal
            </Btn>
          )}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map((goal, idx) => (
          <GoalEditorRow
            key={idx}
            goal={goal}
            index={idx}
            total={rows.length}
            readOnly={readOnly}
            onChange={patch => updateRow(idx, patch)}
            onRemove={() => removeRow(idx)}
            onMoveUp={() => moveRow(idx, -1)}
            onMoveDown={() => moveRow(idx, 1)}
          />
        ))}
      </div>

      {/* Domain datalist - shared across rows */}
      <datalist id="goal-domain-suggestions">
        {DOMAIN_SUGGESTIONS.map(d => <option key={d} value={d} />)}
      </datalist>
    </div>
  );
}

function GoalEditorRow({ goal, index, total, readOnly, onChange, onRemove, onMoveUp, onMoveDown }) {
  const [expanded, setExpanded] = useState(false);
  const g = goal || blankGoal();
  const pr = priorityColor[g.priority] || priorityColor.medium;
  const hasRichFields = g.domain || g.measure || g.rationale || g.target_date || g.source;

  return (
    <div style={{
      padding: 12,
      background: C.bgPrimary,
      border: "1px solid " + C.borderLight,
      borderLeft: "3px solid " + pr.border,
      borderRadius: 8,
    }}>
      {/* Header row: index + source badge + priority pill + status + actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: C.textTertiary, minWidth: 20 }}>
          #{index + 1}
        </div>

        {/* Source badge (only for review-annotated goals) */}
        {g.source && sourceColor[g.source] && (
          <span style={{
            fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 3,
            background: sourceColor[g.source].bg, color: sourceColor[g.source].text,
            textTransform: "uppercase", letterSpacing: "0.05em",
          }}>
            {sourceColor[g.source].label}
          </span>
        )}

        {/* Priority selector (inline 3-way pill) */}
        <div style={{ display: "flex", gap: 2, marginLeft: "auto" }}>
          {PRIORITY_OPTIONS.map(opt => {
            const active = g.priority === opt.value;
            const c = priorityColor[opt.value];
            return (
              <button
                key={opt.value}
                type="button"
                disabled={readOnly}
                onClick={() => onChange({ priority: opt.value })}
                style={{
                  padding: "3px 10px",
                  fontSize: 10,
                  fontWeight: 700,
                  border: "0.5px solid " + (active ? c.border : C.borderLight),
                  background: active ? c.bg : "transparent",
                  color: active ? c.text : C.textTertiary,
                  borderRadius: 4,
                  cursor: readOnly ? "default" : "pointer",
                  fontFamily: "inherit",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {/* Status (only shown for non-open status) */}
        {g.status && g.status !== "open" && (
          <span style={{
            fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 3,
            background: statusColor[g.status]?.bg || C.bgTertiary,
            color: statusColor[g.status]?.text || C.textTertiary,
            textTransform: "uppercase", letterSpacing: "0.05em",
          }}>
            {statusColor[g.status]?.label || g.status}
          </span>
        )}

        {/* Reorder + delete buttons */}
        {!readOnly && (
          <div style={{ display: "flex", gap: 2 }}>
            <IconBtn disabled={index === 0}          onClick={onMoveUp}   title="Move up">&uarr;</IconBtn>
            <IconBtn disabled={index === total - 1}  onClick={onMoveDown} title="Move down">&darr;</IconBtn>
            <IconBtn onClick={onRemove} title="Remove goal" danger>&times;</IconBtn>
          </div>
        )}
      </div>

      {/* Goal text (main input) */}
      <textarea
        value={g.goal || ""}
        onChange={e => onChange({ goal: e.target.value })}
        readOnly={readOnly}
        placeholder="e.g. Reduce A1C to under 7.0 by next review"
        rows={2}
        style={{
          ...inputStyle,
          fontSize: 13,
          resize: "vertical",
          marginBottom: 8,
          background: readOnly ? C.bgSecondary : C.bgPrimary,
        }}
      />

      {/* Expand toggle for rich fields */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        style={{
          background: "transparent",
          border: "none",
          color: C.textSecondary,
          fontSize: 11,
          fontWeight: 600,
          cursor: "pointer",
          padding: "4px 0",
          fontFamily: "inherit",
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        <span>{expanded ? "\u25BC" : "\u25B6"}</span>
        <span>
          {expanded ? "Hide details" : (hasRichFields ? "Show details" : "Add details")}
        </span>
        {!expanded && hasRichFields && (
          <span style={{ color: C.textTertiary, fontWeight: 400, marginLeft: 4 }}>
            ({[g.domain, g.target_date, g.measure && "measure"].filter(Boolean).join(" \u00B7 ")})
          </span>
        )}
      </button>

      {expanded && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
          <div>
            <FieldLabel>Domain</FieldLabel>
            <input
              type="text"
              value={g.domain || ""}
              onChange={e => onChange({ domain: e.target.value })}
              readOnly={readOnly}
              list="goal-domain-suggestions"
              placeholder="e.g. medical, social, engagement"
              style={inputStyle}
            />
          </div>
          <div>
            <FieldLabel>Target date</FieldLabel>
            <input
              type="date"
              value={g.target_date || ""}
              onChange={e => onChange({ target_date: e.target.value || null })}
              readOnly={readOnly}
              style={inputStyle}
            />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <FieldLabel>Measure (how we'll know it's achieved)</FieldLabel>
            <input
              type="text"
              value={g.measure || ""}
              onChange={e => onChange({ measure: e.target.value })}
              readOnly={readOnly}
              placeholder="e.g. A1C lab value under 7.0 at next PCP visit"
              style={inputStyle}
            />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <FieldLabel>Rationale (why this goal matters)</FieldLabel>
            <input
              type="text"
              value={g.rationale || ""}
              onChange={e => onChange({ rationale: e.target.value })}
              readOnly={readOnly}
              placeholder="e.g. Prior A1C 8.2 with inconsistent adherence"
              style={inputStyle}
            />
          </div>
          {/* Status selector only shown in edit mode for existing goals */}
          {!readOnly && g.status && (
            <div>
              <FieldLabel>Status</FieldLabel>
              <select
                value={g.status}
                onChange={e => onChange({ status: e.target.value })}
                style={selectStyle}
              >
                {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Small helper - icon-style compact button
function IconBtn({ children, onClick, disabled, title, danger }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        width: 22, height: 22,
        padding: 0,
        border: "0.5px solid " + C.borderLight,
        background: "transparent",
        color: disabled ? C.textTertiary : (danger ? C.red : C.textSecondary),
        borderRadius: 4,
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: 12,
        lineHeight: "20px",
        fontFamily: "inherit",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {children}
    </button>
  );
}

function FieldLabel({ children }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, textTransform: "uppercase",
      letterSpacing: "0.05em", color: C.textTertiary, marginBottom: 3,
    }}>
      {children}
    </div>
  );
}

// -----------------------------------------------------------------------------
// GoalDisplay - read-only rich rendering. Used in PlanDetailModal.
// -----------------------------------------------------------------------------
export function GoalDisplay({ goals, emptyMsg = "No goals recorded" }) {
  const normalized = normalizeGoals(goals);

  if (normalized.length === 0) {
    return (
      <div style={{ fontSize: 12, color: C.textTertiary, fontStyle: "italic", padding: "6px 0" }}>
        {emptyMsg}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {normalized.map((g, i) => (
        <GoalDisplayRow key={i} goal={g} index={i} />
      ))}
    </div>
  );
}

function GoalDisplayRow({ goal, index }) {
  const g = goal;
  const pr = priorityColor[g.priority] || priorityColor.medium;

  return (
    <div style={{
      padding: 12,
      border: "0.5px solid " + C.borderLight,
      borderLeft: "3px solid " + pr.border,
      borderRadius: 8,
      background: C.bgPrimary,
    }}>
      {/* Header chips */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: C.textTertiary }}>
          #{index + 1}
        </div>
        {g.priority && (
          <Badge
            label={g.priority.toUpperCase()}
            variant={g.priority === "high" ? "red" : g.priority === "low" ? "green" : "amber"}
            size="xs"
          />
        )}
        {g.domain && (
          <span style={{ fontSize: 10, fontWeight: 600, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.03em" }}>
            {g.domain.replace(/_/g, " ")}
          </span>
        )}
        {g.source && sourceColor[g.source] && (
          <span style={{
            fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 3,
            background: sourceColor[g.source].bg, color: sourceColor[g.source].text,
            textTransform: "uppercase", letterSpacing: "0.05em",
          }}>
            {sourceColor[g.source].label}
          </span>
        )}
        {g.status && g.status !== "open" && (
          <span style={{
            fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 3,
            background: statusColor[g.status]?.bg || C.bgTertiary,
            color: statusColor[g.status]?.text || C.textTertiary,
            textTransform: "uppercase", letterSpacing: "0.05em",
          }}>
            {statusColor[g.status]?.label || g.status}
          </span>
        )}
        {g.target_date && (
          <span style={{ marginLeft: "auto", fontSize: 11, color: C.textTertiary }}>
            Target: {new Date(g.target_date + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}
          </span>
        )}
      </div>

      {/* Goal text */}
      <div style={{ fontSize: 13, color: C.textPrimary, lineHeight: 1.5, marginBottom: (g.measure || g.rationale) ? 8 : 0 }}>
        {g.goal}
      </div>

      {/* Measure + rationale (if present) */}
      {(g.measure || g.rationale) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: C.textTertiary }}>
          {g.measure && (
            <div>
              <span style={{ fontWeight: 600, color: C.textSecondary }}>Measure: </span>{g.measure}
            </div>
          )}
          {g.rationale && (
            <div>
              <span style={{ fontWeight: 600, color: C.textSecondary }}>Rationale: </span>{g.rationale}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
