import { Badge, Card } from "../../components/ui";
import { C } from "../../lib/tokens";
import { stalenessBand } from "../../lib/cmCadence";

// ---------------------------------------------------------------------------
// Shared UI primitives for Care Management tabs.
//
// Everything here is dumb/presentational - no data fetching, no state
// beyond what's passed in via props. If something in this file grows
// non-trivial logic, it belongs in its own file instead.
//
// Kept deliberately simple: badges, buttons, table cells, input styles,
// and the KPI card used at the top of several tabs.
// ---------------------------------------------------------------------------

// ----- KPI card (top-of-tab summary tiles) ---------------------------------

export function KpiCard({ label, value, hint, variant }) {
  const palette = {
    amber:   { bg: C.amberBg,  color: C.amber,   border: C.amberBorder  },
    blue:    { bg: C.blueBg,   color: C.blue,    border: C.blueBorder   },
    red:     { bg: C.redBg,    color: C.red,     border: C.redBorder    },
    green:   { bg: C.greenBg || "#ecfdf5", color: C.green || "#047857", border: C.greenBorder || "#86efac" },
    neutral: { bg: C.bgPrimary, color: C.teal,   border: C.borderLight  },
  };
  const p = palette[variant] || palette.neutral;
  return (
    <Card style={{ padding: 16, background: p.bg, border: "0.5px solid " + p.border }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 32, fontWeight: 700, color: p.color, marginTop: 4, lineHeight: 1 }}>{value}</div>
      {hint && <div style={{ fontSize: 12, color: C.textTertiary, marginTop: 6 }}>{hint}</div>}
    </Card>
  );
}

// ----- Badges used in multiple places ---------------------------------------

// StatusBadge - generic status chip used in PRL (inbound + outbound) plus
// the enrollment status column. Mixed palette tuned for each status value.
export function StatusBadge({ status }) {
  const map = {
    "Received":          "neutral",
    "Parsing":           "blue",
    "Parsed":            "blue",
    "Validated":         "teal",
    "Reconciled":        "green",
    "Failed":            "red",
    "Rejected":          "red",
    "Unmatched":         "amber",
    "Matched Single":    "green",
    "Matched Multiple":  "amber",
    "Manually Resolved": "green",
    "Skipped":           "neutral",
    "Draft":             "neutral",
    "Ready":             "blue",
    "Generated":         "teal",
    "Transmitted":       "green",
    "Acknowledged":      "green",
    // Enrollment statuses
    "Active":            "green",
    "Pending":           "amber",
    "On Hold":           "amber",
    "Disenrolled":       "neutral",
    "Deceased":          "neutral",
    "Transferred":       "neutral",
  };
  return <Badge label={status} variant={map[status] || "neutral"} size="xs" />;
}

// AcuityBadge - shows High / Moderate / Low acuity tier. Returns "-" if
// null (expected for Standard Plan enrollments where acuity doesn't apply).
export function AcuityBadge({ tier }) {
  const map = { High: "red", Moderate: "amber", Low: "green" };
  return <Badge label={tier || "-"} variant={map[tier] || "neutral"} size="xs" />;
}

// PlanTypeBadge - health plan type chip (Tailored / Standard / Other).
export function PlanTypeBadge({ planType }) {
  if (!planType) return <span style={{ color: C.textTertiary, fontSize: 12 }}>-</span>;
  const map = { "Tailored Plan": "purple", "Standard Plan": "blue", "Other": "neutral" };
  const shortLabel = { "Tailored Plan": "Tailored", "Standard Plan": "Standard", "Other": "Other" };
  return <Badge label={shortLabel[planType] || planType} variant={map[planType] || "neutral"} size="xs" />;
}

// PlanStatusBadge - care plan status chip (Draft / Active / Archived / Superseded).
export function PlanStatusBadge({ status }) {
  const map = { Draft: "amber", Active: "green", Archived: "neutral", Superseded: "neutral" };
  return <Badge label={status} variant={map[status] || "neutral"} size="xs" />;
}

// ClaimStatusBadge - billing claim lifecycle state.
export function ClaimStatusBadge({ status }) {
  const map = {
    "Not Ready": "neutral",
    "Ready":     "green",
    "Submitted": "blue",
    "Paid":      "green",
    "Denied":    "red",
    "Appealed":  "amber",
    "Void":      "neutral",
  };
  return <Badge label={status} variant={map[status] || "neutral"} size="xs" />;
}

// VerificationBadge - billing verification status ("Not Reviewed" suppressed).
export function VerificationBadge({ status }) {
  if (!status || status === "Not Reviewed") {
    return <span style={{ fontSize: 11, color: C.textTertiary }}>-</span>;
  }
  const map = { "Reviewed": "blue", "Approved": "green", "Flagged": "red" };
  return <Badge label={status} variant={map[status] || "neutral"} size="xs" />;
}

// RiskBadge - AI-assessed clinical risk chip. Dismissed assessments show
// a muted indicator instead of the level so reviewers can see that a human
// cleared the flag.
export function RiskBadge({ risk }) {
  if (!risk) return <span style={{ color: C.textTertiary, fontSize: 12 }}>-</span>;
  if (risk.dismissed_at) {
    return (
      <span title="Flagged by AI, dismissed by staff" style={{ fontSize: 11, color: C.textTertiary, fontStyle: "italic" }}>
        Dismissed
      </span>
    );
  }
  const map = {
    critical: "red",
    high:     "red",
    medium:   "amber",
    low:      "green",
  };
  const label = (risk.risk_level || "").toUpperCase();
  const variant = map[risk.risk_level] || "neutral";
  const title = risk.headline || "";
  return (
    <span title={title}>
      <Badge label={label} variant={variant} size="xs" />
      {risk.acknowledged_at && (
        <span style={{ marginLeft: 4, fontSize: 10, color: C.textTertiary }} title="Acknowledged">ack</span>
      )}
    </span>
  );
}

// ----- Filter pill button ---------------------------------------------------

export function FilterPill({ active, children, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: "5px 12px",
      fontSize: 12,
      fontWeight: 600,
      fontFamily: "inherit",
      border: "0.5px solid " + (active ? C.teal : C.borderLight),
      background: active ? C.tealBg : C.bgPrimary,
      color: active ? C.teal : C.textSecondary,
      borderRadius: 16,
      cursor: "pointer",
      transition: "all 0.15s",
    }}>{children}</button>
  );
}

// ----- Sub-tab button (used in PRL inbound/outbound toggle) -----------------

export function SubTabButton({ active, children, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "7px 14px",
        fontSize: 12,
        fontWeight: 600,
        fontFamily: "inherit",
        borderRadius: 8,
        border: "0.5px solid " + (active ? C.teal : C.borderLight),
        background: active ? C.tealBg : C.bgPrimary,
        color: active ? C.teal : C.textSecondary,
        cursor: "pointer",
        transition: "all 0.15s",
      }}
    >
      {children}
    </button>
  );
}

// ----- Table cell primitives ------------------------------------------------

export function Th({ children, align }) {
  return (
    <th style={{
      textAlign: align || "left",
      fontSize: 11,
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: "0.05em",
      color: C.textSecondary,
      padding: "10px 12px",
    }}>
      {children}
    </th>
  );
}

export function Td({ children, align, style }) {
  return (
    <td style={{
      padding: "10px 12px",
      textAlign: align || "left",
      color: C.textPrimary,
      verticalAlign: "middle",
      ...style,
    }}>
      {children}
    </td>
  );
}

// ----- Labeled detail field (used in modals) -------------------------------

export function DetailField({ label, value, monospace }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textTertiary, marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 13, color: C.textPrimary, fontFamily: monospace ? "monospace" : "inherit" }}>{value || "-"}</div>
    </div>
  );
}

// ----- Stale-days badge (Registry) -----------------------------------------

// Acuity-aware + program-aware day badge. Actual thresholds live in
// cmCadence.stalenessBand() - this is just presentation.
export function StaleDaysBadge({ days, status, acuity, planType }) {
  if (status === "Disenrolled") return <span style={{ color: C.textTertiary }}>-</span>;
  if (days === null || days === undefined) return <Badge label="No contact" variant="amber" size="xs" />;
  const band = stalenessBand(acuity, days, planType);
  const variant = band === "red" ? "red" : band === "amber" ? "amber" : "green";
  return <Badge label={days + "d"} variant={variant} size="xs" />;
}

// ----- Shared input styles --------------------------------------------------

export const inputStyle = {
  width: "100%",
  padding: "9px 12px",
  border: "1px solid " + C.borderMid,
  borderRadius: 8,
  fontSize: 13,
  fontFamily: "inherit",
  outline: "none",
  color: C.textPrimary,
  background: C.bgPrimary,
  boxSizing: "border-box",
  resize: "vertical",
};

export const selectStyle = {
  ...inputStyle,
  WebkitAppearance: "none",
  paddingRight: 32,
};

// ----- Enrollment domain constants ------------------------------------------
// These are the complete option sets for program_type and cm_provider_type
// used when the validation matrix is overridden (or as the default for the
// "Other" plan type). They live here rather than in a specific modal file
// because EditEnrollmentForm and NewEnrollmentModal both need them and
// neither owns the other.

export const ALL_PROGRAM_TYPES = [
  "TCM",
  "AMH",
  "General Engagement",
  "Other",
];

export const ALL_PROVIDER_TYPES = [
  "AMH+",
  "AMH Tier 3",
  "CMA",
  "CIN",
  "Other",
];
