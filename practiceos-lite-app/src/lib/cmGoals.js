// ===============================================================================
// src/lib/cmGoals.js
// Canonical goal shape + normalizer for cm_care_plans.goals.
//
// Why this exists:
//   Two AI edge functions historically emitted different shapes:
//     - cmp-draft-care-plan:    { text, domain, measure, rationale, target_date }
//     - cmp-draft-annual-review: { goal, domain, source, priority, rationale, target_date }
//   Plus human-created plans stored plain strings.
//   A DB migration (normalize_cm_care_plans_goals_shape, Apr 2026) rewrote all
//   existing rows to canonical shape, but edge functions still emit their
//   original shapes. This module normalizes on load/save so everything
//   downstream (UI, PDF generator, billing logic) can rely on one shape.
// ===============================================================================

// Canonical goal shape. All fields except `goal` are optional.
// {
//   goal:        string (required, the goal statement)
//   domain:      string (free-text, e.g. "medical", "social", "engagement")
//   priority:    "high" | "medium" | "low"
//   target_date: ISO date string or null
//   measure:     string or null (how we'll know)
//   rationale:   string or null (why)
//   status:      "open" | "met" | "not_met" | "removed"
//   source:      "carried_over" | "new" | null (only set by annual-review flow)
// }

export const PRIORITY_OPTIONS = [
  { value: "high",   label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low",    label: "Low" },
];

export const STATUS_OPTIONS = [
  { value: "open",    label: "Open"    },
  { value: "met",     label: "Met"     },
  { value: "not_met", label: "Not met" },
  { value: "removed", label: "Removed" },
];

// Common domain values. Not enforced - CM can type custom via the datalist.
// Covers the vocabulary the AI edge functions actually emit today plus the
// canonical NC Medicaid TCM domains.
export const DOMAIN_SUGGESTIONS = [
  "medical",
  "behavioral",
  "social",
  "self_management",
  "engagement",
  "functional",
  "care_coordination",
  "medication_adherence",
  "physical_health",
  "other",
];

// Normalize ANY goal (string, {text, ...}, {goal, ...}) to canonical object.
// Idempotent - already-canonical goals pass through unchanged (only gains
// defaults for any missing fields).
export function normalizeGoal(input) {
  if (input == null) {
    return { goal: "", priority: "medium", status: "open" };
  }
  if (typeof input === "string") {
    return {
      goal:     input,
      priority: "medium",
      status:   "open",
    };
  }
  if (typeof input !== "object") {
    // Shouldn't happen but be defensive
    return { goal: String(input), priority: "medium", status: "open" };
  }

  // Object path. Map text -> goal if needed.
  const goalText = input.goal || input.text || input.description || input.name || "";

  return {
    goal:        goalText,
    domain:      input.domain      || undefined,
    priority:    input.priority    || "medium",
    target_date: input.target_date || null,
    measure:     input.measure     || null,
    rationale:   input.rationale   || null,
    status:      input.status      || "open",
    source:      input.source      || null,
    // Preserve any extra fields the AI or a future feature may have added
    // (e.g. progress_notes) so round-trip edits don't lose data.
    ...stripKnownKeys(input),
  };
}

// Helper: return object with only unknown keys. Prevents known canonical
// keys from being double-spread (and thus overridden by raw input values
// that may be null/empty). We handle canonical keys explicitly above.
function stripKnownKeys(obj) {
  const known = new Set([
    "goal", "text", "description", "name",
    "domain", "priority", "target_date",
    "measure", "rationale", "status", "source",
  ]);
  const extras = {};
  for (const k of Object.keys(obj)) {
    if (!known.has(k) && obj[k] !== undefined) extras[k] = obj[k];
  }
  return extras;
}

// Normalize an array of goals (or null/undefined). Always returns an array.
export function normalizeGoals(goals) {
  if (!Array.isArray(goals)) return [];
  return goals.map(normalizeGoal).filter(g => g.goal && g.goal.trim().length > 0);
}

// Extract plain display text from a normalized (or legacy) goal.
// Used anywhere we need to render just the text without the structured chrome.
export function goalText(g) {
  if (!g) return "";
  if (typeof g === "string") return g;
  return g.goal || g.text || g.description || g.name || "";
}

// Make a fresh blank goal for "Add goal" buttons.
export function blankGoal() {
  return {
    goal:        "",
    domain:      "",
    priority:    "medium",
    target_date: null,
    measure:     "",
    rationale:   "",
    status:      "open",
  };
}

// Check if a goal is empty (for filtering out blank rows before save)
export function isBlankGoal(g) {
  if (!g) return true;
  const text = goalText(g);
  return !text || !text.trim();
}
