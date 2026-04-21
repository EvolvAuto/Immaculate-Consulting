// ═══════════════════════════════════════════════════════════════════════════════
// src/views/pro/ProHRSNView.jsx
// Pro tier: HRSN pre-visit screener management.
// This view (Step 1 of 3) renders existing screenings + AI summaries + referral
// drafts. Staff screener form and patient portal form land in Step 2.
// Cadence scheduling and dashboard widget land in Step 3.
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { C } from "../../lib/tokens";
import {
  listRecentScreenings,
  listReferralDrafts,
  updateReferralDraft,
  markReferralSent,
  markResponseReviewed,
  getEffectiveNarrative,
} from "../../lib/hrsnApi";

// ───────────────────────────────────────────────────────────────────────────────
// Shared formatting helpers
// ───────────────────────────────────────────────────────────────────────────────

const DOMAIN_LABELS = {
  food_insecurity:      "Food insecurity",
  housing_instability:  "Housing instability",
  housing_quality:      "Housing quality",
  transportation:       "Transportation",
  utilities:            "Utilities",
  interpersonal_safety: "Interpersonal safety",
  other:                "Other",
};

const PRIORITY_STYLES = {
  urgent:  { bg: "#FEE2E2", border: "#DC2626", color: "#991B1B", label: "URGENT" },
  high:    { bg: "#FEF3C7", border: "#D97706", color: "#92400E", label: "HIGH" },
  medium:  { bg: "#E0F2FE", border: "#0284C7", color: "#075985", label: "MEDIUM" },
  low:     { bg: "#F3F4F6", border: "#6B7280", color: "#374151", label: "LOW" },
};

const STATUS_STYLES = {
  Draft:      { bg: "#F3F4F6", color: "#374151", label: "Draft" },
  Approved:   { bg: "#D1FAE5", color: "#065F46", label: "Approved" },
  Sent:       { bg: "#E0E7FF", color: "#3730A3", label: "Sent" },
  Dismissed:  { bg: "#F3F4F6", color: "#6B7280", label: "Dismissed" },
};

// Channels through which staff can send a referral. Order reflects likely
// frequency for NC Medicaid practices; "NCCARE360 API" is provisioned for
// future per-practice API integration.
const SEND_VIA_OPTIONS = [
  { value: "NCCARE360 Portal",     label: "NCCARE360 Portal (copy/paste)" },
  { value: "NCCARE360 API",        label: "NCCARE360 API" },
  { value: "Email",                label: "Email" },
  { value: "Fax",                  label: "Fax" },
  { value: "Phone",                label: "Phone call" },
  { value: "Printed / In-person",  label: "Printed / handed to patient" },
  { value: "Other",                label: "Other" },
];

const AI_STATUS_STYLES = {
  None:    { bg: "#F3F4F6", color: "#6B7280", label: "Not generated" },
  Queued:  { bg: "#E0F2FE", color: "#075985", label: "Queued" },
  Running: { bg: "#FEF3C7", color: "#92400E", label: "Generating..." },
  Success: { bg: "#D1FAE5", color: "#065F46", label: "AI summary ready" },
  Failed:  { bg: "#FEE2E2", color: "#991B1B", label: "Summary failed" },
  Skipped: { bg: "#F3F4F6", color: "#6B7280", label: "Skipped" },
};

function fmtDate(ts) {
  if (!ts) return "-";
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtDateTime(ts) {
  if (!ts) return "-";
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " +
         d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function patientName(p) {
  if (!p) return "Unknown patient";
  const first = p.first_name || "";
  const last  = p.last_name  || "";
  const full  = (first + " " + last).trim();
  return full || "Unknown patient";
}

// ───────────────────────────────────────────────────────────────────────────────
// Main view
// ───────────────────────────────────────────────────────────────────────────────

export default function ProHRSNView() {
  const { profile, practiceId, tier } = useAuth();
  const isProTier = ["Pro", "Command"].includes(tier);

  const [activeTab, setActiveTab] = useState("recent"); // recent | drafts | schedule
  const [screenings, setScreenings] = useState([]);
  const [drafts, setDrafts]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!isProTier || !practiceId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      listRecentScreenings(practiceId, 30),
      listReferralDrafts(practiceId, { statuses: ["Draft", "Approved"] }),
    ])
      .then(function(results) {
        if (cancelled) return;
        setScreenings(results[0]);
        setDrafts(results[1]);
      })
      .catch(function(e) {
        if (!cancelled) setError(e.message || String(e));
      })
      .finally(function() {
        if (!cancelled) setLoading(false);
      });
    return function() { cancelled = true; };
  }, [practiceId, isProTier, refreshKey]);

  const handleRefresh = function() { setRefreshKey(function(k) { return k + 1; }); };

  if (!isProTier) {
    return (
      <div style={{ padding: "24px 20px" }}>
        <LockedState />
      </div>
    );
  }

  // Counts for tab badges
  const draftCount = drafts.filter(function(d) { return d.status === "Draft"; }).length;
  const urgentCount = drafts.filter(function(d) {
    return d.status === "Draft" && d.priority === "urgent";
  }).length;

  return (
    <div style={{ padding: "16px 20px", maxWidth: 1400, margin: "0 auto" }}>
      <Header onRefresh={handleRefresh} />

      <Tabs
        active={activeTab}
        onChange={setActiveTab}
        draftCount={draftCount}
        urgentCount={urgentCount}
      />

      {error && (
        <div style={{
          background: "#FEE2E2", border: "0.5px solid #DC2626",
          color: "#991B1B", padding: "10px 14px", borderRadius: 6,
          fontSize: 12, marginBottom: 16,
        }}>
          Error loading HRSN data: {error}
        </div>
      )}

      {loading && <LoadingState />}

      {!loading && activeTab === "recent" && (
        <RecentScreeningsTab
          screenings={screenings}
          currentUser={profile}
          onUpdated={handleRefresh}
        />
      )}

      {!loading && activeTab === "drafts" && (
        <ReferralDraftsTab
          drafts={drafts}
          currentUser={profile}
          onUpdated={handleRefresh}
        />
      )}

      {!loading && activeTab === "schedule" && <ScheduleTabStub />}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
// Header + Tabs
// ───────────────────────────────────────────────────────────────────────────────

function Header({ onRefresh }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between",
      alignItems: "flex-start", marginBottom: 20,
    }}>
      <div>
        <div style={{ fontSize: 22, fontWeight: 700, color: C.textPrimary, marginBottom: 4 }}>
          HRSN Screening
        </div>
        <div style={{ fontSize: 13, color: C.textSecondary, maxWidth: 720 }}>
          Review Health-Related Social Needs screenings and AI-drafted referral packets.
          The AI summary surfaces positive domains, flags notable patient statements, and
          drafts NCCARE360-formatted referrals for staff review.
        </div>
      </div>
      <button
        onClick={onRefresh}
        style={{
          background: "#fff", color: C.textSecondary,
          border: "0.5px solid " + C.borderMid, borderRadius: 6,
          padding: "8px 14px", fontSize: 12, fontWeight: 600,
          cursor: "pointer", fontFamily: "inherit",
        }}
      >
        Refresh
      </button>
    </div>
  );
}

function Tabs({ active, onChange, draftCount, urgentCount }) {
  const tabs = [
    { id: "recent",   label: "Recent Screenings" },
    {
      id: "drafts",
      label: "Draft Referrals",
      badge: draftCount > 0 ? draftCount : null,
      urgent: urgentCount > 0,
    },
    { id: "schedule", label: "Due for Screening" },
  ];
  return (
    <div style={{
      display: "flex", gap: 4, borderBottom: "0.5px solid " + C.borderMid,
      marginBottom: 20,
    }}>
      {tabs.map(function(t) {
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            onClick={function() { onChange(t.id); }}
            style={{
              background: "transparent", border: "none",
              borderBottom: isActive ? ("2px solid " + C.teal) : "2px solid transparent",
              padding: "10px 16px", fontSize: 13,
              fontWeight: isActive ? 700 : 500,
              color: isActive ? C.teal : C.textSecondary,
              cursor: "pointer", fontFamily: "inherit",
              display: "flex", alignItems: "center", gap: 8,
              marginBottom: -1,
            }}
          >
            {t.label}
            {t.badge != null && (
              <span style={{
                background: t.urgent ? "#DC2626" : (isActive ? C.teal : C.textTertiary),
                color: "#fff", fontSize: 10, fontWeight: 700,
                borderRadius: 10, padding: "2px 7px",
                minWidth: 18, textAlign: "center", lineHeight: 1.4,
              }}>
                {t.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
// Recent Screenings tab
// ───────────────────────────────────────────────────────────────────────────────

function RecentScreeningsTab({ screenings, currentUser, onUpdated }) {
  if (screenings.length === 0) {
    return (
      <EmptyState
        title="No HRSN screenings yet"
        body="Screenings completed by patients (via portal or staff tablet) will appear here with an AI-generated clinical summary."
      />
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {screenings.map(function(s) {
        return (
          <ScreeningCard
            key={s.id}
            screening={s}
            currentUser={currentUser}
            onUpdated={onUpdated}
          />
        );
      })}
    </div>
  );
}

function ScreeningCard({ screening, currentUser, onUpdated }) {
  const [expanded, setExpanded] = useState(false);
  const [marking, setMarking]   = useState(false);

  const s       = screening;
  const summary = s.ai_summary || {};
  const status  = s.ai_summary_status || "None";
  const statusStyle = AI_STATUS_STYLES[status] || AI_STATUS_STYLES.None;
  const pName   = patientName(s.patients);
  const mrn     = (s.patients && s.patients.mrn) || "-";

  const positiveDomains = useMemo(function() {
    const doms = summary.domains || {};
    return Object.keys(doms).filter(function(k) {
      return doms[k] && doms[k].status === "positive";
    });
  }, [summary]);

  const hasUrgent = !!(summary.urgent_safety_alert);
  const hasCaveat = !!(summary.staff_assisted_completion_caveat);

  const canMarkReviewed = status === "Success" && !s.reviewed_at;

  const handleMarkReviewed = async function() {
    setMarking(true);
    try {
      await markResponseReviewed(s.id, currentUser);
      if (onUpdated) onUpdated();
    } catch (e) {
      alert("Failed to mark reviewed: " + (e.message || e));
    } finally {
      setMarking(false);
    }
  };

  return (
    <div style={{
      background: "#fff",
      border: hasUrgent ? "1px solid #DC2626" : ("0.5px solid " + C.borderMid),
      borderRadius: 8,
      overflow: "hidden",
      boxShadow: hasUrgent ? "0 1px 3px rgba(220,38,38,0.15)" : "none",
    }}>
      {/* Header row: clickable */}
      <div
        onClick={function() { setExpanded(function(x) { return !x; }); }}
        style={{
          padding: "14px 18px",
          cursor: "pointer",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          borderBottom: expanded ? ("0.5px solid " + C.borderMid) : "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.textPrimary }}>
            {pName}
          </div>
          <div style={{ fontSize: 11, color: C.textTertiary, fontFamily: "'JetBrains Mono', monospace" }}>
            MRN {mrn}
          </div>
          {hasUrgent && (
            <div style={{
              background: "#DC2626", color: "#fff",
              fontSize: 10, fontWeight: 700, letterSpacing: "0.05em",
              padding: "3px 8px", borderRadius: 4,
            }}>
              URGENT SAFETY ALERT
            </div>
          )}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {positiveDomains.map(function(d) {
              return (
                <span
                  key={d}
                  style={{
                    background: "#FEF3C7", color: "#92400E",
                    fontSize: 10, fontWeight: 600,
                    padding: "2px 7px", borderRadius: 10,
                  }}
                >
                  {DOMAIN_LABELS[d] || d}
                </span>
              );
            })}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 11, color: C.textSecondary }}>
          <span style={{
            background: statusStyle.bg, color: statusStyle.color,
            fontSize: 10, fontWeight: 600,
            padding: "3px 8px", borderRadius: 10,
          }}>
            {statusStyle.label}
          </span>
          <span>{fmtDateTime(s.completed_at)}</span>
          <span style={{ fontSize: 14 }}>{expanded ? "▾" : "▸"}</span>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div style={{ padding: "16px 18px", background: C.bgSecondary }}>
          <div style={{ fontSize: 11, color: C.textTertiary, marginBottom: 12 }}>
            Completion mode: <strong style={{ color: C.textSecondary }}>{s.completion_mode || "Unknown"}</strong>
            {" · "}Via: <strong style={{ color: C.textSecondary }}>{s.administered_via}</strong>
            {s.reviewed_at && (
              <span>{" · Reviewed: "}<strong style={{ color: C.textSecondary }}>{fmtDateTime(s.reviewed_at)}</strong></span>
            )}
          </div>

          {status === "Failed" && (
            <FailureBanner error={s.ai_summary_error} attempts={s.ai_summary_attempts} />
          )}

          {status === "Success" && (
            <AISummaryBody
              summary={summary}
              canMarkReviewed={canMarkReviewed}
              marking={marking}
              onMarkReviewed={handleMarkReviewed}
            />
          )}

          {(status === "Queued" || status === "Running") && (
            <div style={{
              background: "#FEF3C7", color: "#92400E",
              padding: "12px 14px", borderRadius: 6, fontSize: 12,
            }}>
              AI summary is being generated. Refresh in a few seconds.
            </div>
          )}

          {/* Raw responses details for reference */}
          <details style={{ marginTop: 16 }}>
            <summary style={{
              fontSize: 11, fontWeight: 600, color: C.textTertiary,
              cursor: "pointer", userSelect: "none",
            }}>
              View raw patient responses
            </summary>
            <pre style={{
              marginTop: 8, background: "#fff",
              border: "0.5px solid " + C.borderMid, borderRadius: 4,
              padding: 12, fontSize: 11, overflow: "auto", maxHeight: 300,
              color: C.textSecondary, fontFamily: "'JetBrains Mono', monospace",
            }}>
              {JSON.stringify(s.responses, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}

function FailureBanner({ error, attempts }) {
  return (
    <div style={{
      background: "#FEE2E2", border: "0.5px solid #DC2626",
      color: "#991B1B", padding: "12px 14px", borderRadius: 6, fontSize: 12,
    }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>
        AI summary generation failed ({attempts || 0} attempts)
      </div>
      {error && (
        <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", opacity: 0.85 }}>
          {error}
        </div>
      )}
      <div style={{ fontSize: 11, marginTop: 6, fontStyle: "italic" }}>
        Contact support to retry. Raw patient responses are preserved below.
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
// AI Summary rendering (the payoff)
// ───────────────────────────────────────────────────────────────────────────────

function AISummaryBody({ summary, canMarkReviewed, marking, onMarkReviewed }) {
  const alert   = summary.urgent_safety_alert;
  const caveat  = summary.staff_assisted_completion_caveat;
  const domains = summary.domains || {};
  const quotes  = summary.flagged_quotes || [];
  const refs    = summary.recommended_referrals || [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      {/* Urgent safety alert - TOP, red, unmissable */}
      {alert && (
        <div style={{
          background: "#FEE2E2", border: "1px solid #DC2626",
          borderRadius: 6, padding: "12px 14px",
        }}>
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: "0.1em",
            color: "#991B1B", marginBottom: 6,
          }}>
            ⚠ URGENT SAFETY ALERT · {(alert.severity || "").toUpperCase()}
          </div>
          <div style={{ fontSize: 13, color: "#7F1D1D", marginBottom: 8, lineHeight: 1.5 }}>
            {alert.alert_text}
          </div>
          {alert.recommended_action && (
            <div style={{ fontSize: 11, color: "#991B1B", fontStyle: "italic" }}>
              Recommended action: {alert.recommended_action}
            </div>
          )}
        </div>
      )}

      {/* Staff-assisted caveat - amber, less prominent but visible */}
      {caveat && (
        <div style={{
          background: "#FEF3C7", border: "0.5px solid #D97706",
          borderRadius: 6, padding: "10px 12px",
          fontSize: 11, color: "#92400E",
        }}>
          <strong>Staff-assisted completion:</strong> {caveat}
        </div>
      )}

      {/* Summary paragraph - the TLDR */}
      {summary.summary_paragraph && (
        <div style={{
          background: "#fff", border: "0.5px solid " + C.borderMid,
          borderRadius: 6, padding: "14px 16px",
        }}>
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
            color: C.textTertiary, marginBottom: 8,
          }}>
            CLINICAL SUMMARY
          </div>
          <div style={{ fontSize: 13, color: C.textPrimary, lineHeight: 1.55 }}>
            {summary.summary_paragraph}
          </div>
        </div>
      )}

      {/* Domain grid */}
      <div style={{
        background: "#fff", border: "0.5px solid " + C.borderMid,
        borderRadius: 6, padding: "14px 16px",
      }}>
        <div style={{
          fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
          color: C.textTertiary, marginBottom: 10,
        }}>
          DOMAIN FINDINGS
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {Object.keys(DOMAIN_LABELS).filter(function(k) { return k !== "other"; }).map(function(key) {
            const d = domains[key] || { status: "unknown" };
            return <DomainRow key={key} domainKey={key} data={d} />;
          })}
        </div>
      </div>

      {/* Flagged quotes */}
      {quotes.length > 0 && (
        <div style={{
          background: "#fff", border: "0.5px solid " + C.borderMid,
          borderRadius: 6, padding: "14px 16px",
        }}>
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
            color: C.textTertiary, marginBottom: 10,
          }}>
            NOTABLE PATIENT STATEMENTS
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {quotes.map(function(q, i) {
              return (
                <div key={i} style={{
                  borderLeft: "2px solid " + C.teal,
                  paddingLeft: 12,
                }}>
                  <div style={{
                    fontSize: 13, color: C.textPrimary,
                    fontStyle: "italic", lineHeight: 1.5, marginBottom: 6,
                  }}>
                    "{q.quote}"
                  </div>
                  <div style={{ fontSize: 10, color: C.textTertiary }}>
                    {DOMAIN_LABELS[q.domain] || q.domain} · {q.why}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recommended referrals preview */}
      {refs.length > 0 && (
        <div style={{
          background: "#fff", border: "0.5px solid " + C.borderMid,
          borderRadius: 6, padding: "14px 16px",
        }}>
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
            color: C.textTertiary, marginBottom: 10,
          }}>
            RECOMMENDED REFERRALS ({refs.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {refs.map(function(r, i) {
              const p = PRIORITY_STYLES[r.priority] || PRIORITY_STYLES.medium;
              return (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  fontSize: 12, color: C.textPrimary,
                }}>
                  <span style={{
                    background: p.bg, color: p.color,
                    border: "0.5px solid " + p.border,
                    fontSize: 9, fontWeight: 700, letterSpacing: "0.05em",
                    padding: "2px 7px", borderRadius: 3, minWidth: 54, textAlign: "center",
                  }}>
                    {p.label}
                  </span>
                  <span style={{ fontWeight: 600 }}>{DOMAIN_LABELS[r.domain] || r.domain}</span>
                  {r.nccare360_category && (
                    <span style={{ color: C.textTertiary, fontSize: 11 }}>
                      · NCCARE360: {r.nccare360_category}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{
            marginTop: 10, fontSize: 11, color: C.textTertiary, fontStyle: "italic",
          }}>
            Full referral packets are in the Draft Referrals tab for staff review.
          </div>
        </div>
      )}

      {/* Mark reviewed action */}
      {canMarkReviewed && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={onMarkReviewed}
            disabled={marking}
            style={{
              background: C.teal, color: "#fff", border: "none",
              borderRadius: 6, padding: "8px 16px", fontSize: 12,
              fontWeight: 600, cursor: marking ? "wait" : "pointer",
              fontFamily: "inherit", opacity: marking ? 0.6 : 1,
            }}
          >
            {marking ? "Marking..." : "Mark as reviewed"}
          </button>
        </div>
      )}
    </div>
  );
}

function DomainRow({ domainKey, data }) {
  const status   = data.status || "unknown";
  const severity = data.severity;
  const rationale = data.rationale || "";

  const isPositive = status === "positive";
  const isPartial  = status === "partial";

  const statusColor =
    isPositive ? "#92400E" :
    isPartial  ? "#075985" :
    C.textTertiary;
  const statusBg =
    isPositive ? "#FEF3C7" :
    isPartial  ? "#E0F2FE" :
    "#F3F4F6";

  return (
    <div style={{
      display: "grid", gridTemplateColumns: "180px 110px 1fr",
      gap: 12, alignItems: "start", fontSize: 12,
    }}>
      <div style={{ color: C.textPrimary, fontWeight: 600 }}>
        {DOMAIN_LABELS[domainKey] || domainKey}
      </div>
      <div>
        <span style={{
          background: statusBg, color: statusColor,
          fontSize: 10, fontWeight: 700, letterSpacing: "0.05em",
          padding: "2px 8px", borderRadius: 3,
        }}>
          {status.toUpperCase()}
        </span>
        {severity && (
          <span style={{ marginLeft: 6, fontSize: 10, color: C.textTertiary }}>
            {severity}
          </span>
        )}
      </div>
      <div style={{ color: C.textSecondary, lineHeight: 1.5 }}>
        {rationale}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
// Referral Drafts tab
// ───────────────────────────────────────────────────────────────────────────────

function ReferralDraftsTab({ drafts, currentUser, onUpdated }) {
  if (drafts.length === 0) {
    return (
      <EmptyState
        title="No referral drafts awaiting review"
        body="When patients screen positive for HRSN domains, Claude drafts NCCARE360-formatted referral packets for staff review here."
      />
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {drafts.map(function(d) {
        return (
          <ReferralDraftCard
            key={d.id}
            draft={d}
            currentUser={currentUser}
            onUpdated={onUpdated}
          />
        );
      })}
    </div>
  );
}

function ReferralDraftCard({ draft, currentUser, onUpdated }) {
  const [editing, setEditing]   = useState(false);
  const [narrative, setNarrative] = useState(getEffectiveNarrative(draft));
  const [notes, setNotes]       = useState(draft.staff_notes || "");
  const [saving, setSaving]     = useState(false);
  const [copiedAt, setCopiedAt] = useState(null);

  const p = PRIORITY_STYLES[draft.priority] || PRIORITY_STYLES.medium;
  const s = STATUS_STYLES[draft.status] || STATUS_STYLES.Draft;
  const pName = patientName(draft.patients);
  const hasEdits = !!draft.staff_edited_narrative;

  const handleSaveEdit = async function() {
    setSaving(true);
    try {
      await updateReferralDraft(draft.id, {
        staff_edited_narrative: narrative,
        staff_notes: notes || null,
      }, currentUser);
      setEditing(false);
      if (onUpdated) onUpdated();
    } catch (e) {
      alert("Save failed: " + (e.message || e));
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = function() {
    const text = narrative || "";
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function() {
        setCopiedAt(Date.now());
        setTimeout(function() { setCopiedAt(null); }, 2500);
      });
    }
  };

  const [sendModalOpen, setSendModalOpen] = useState(false);

  const handleStatusChange = async function(newStatus) {
    if (!confirm("Change status to " + newStatus + "?")) return;
    setSaving(true);
    try {
      await updateReferralDraft(draft.id, { status: newStatus }, currentUser);
      if (onUpdated) onUpdated();
    } catch (e) {
      alert("Status update failed: " + (e.message || e));
    } finally {
      setSaving(false);
    }
  };

  const handleSendComplete = async function(meta) {
    setSaving(true);
    try {
      await markReferralSent(draft.id, meta, currentUser);
      setSendModalOpen(false);
      if (onUpdated) onUpdated();
    } catch (e) {
      alert("Mark-as-sent failed: " + (e.message || e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      background: "#fff", border: "0.5px solid " + C.borderMid,
      borderRadius: 8, overflow: "hidden",
    }}>
      {/* Header strip */}
      <div style={{
        padding: "12px 16px",
        background: p.bg,
        borderBottom: "0.5px solid " + p.border,
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{
            background: p.border, color: "#fff",
            fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
            padding: "3px 9px", borderRadius: 3,
          }}>
            {p.label}
          </span>
          <span style={{ fontSize: 13, fontWeight: 700, color: p.color }}>
            {DOMAIN_LABELS[draft.domain] || draft.domain}
          </span>
          {draft.nccare360_category && (
            <span style={{ fontSize: 11, color: p.color, opacity: 0.8 }}>
              NCCARE360: {draft.nccare360_category}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11 }}>
          <span style={{ color: p.color }}>{pName}</span>
          <span style={{ color: p.color, opacity: 0.6 }}>{fmtDate(draft.created_at)}</span>
          <span style={{
            background: s.bg, color: s.color,
            fontSize: 10, fontWeight: 600,
            padding: "2px 7px", borderRadius: 10,
          }}>
            {s.label}
          </span>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: "14px 16px" }}>
        <div style={{
          fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
          color: C.textTertiary, marginBottom: 8,
        }}>
          REFERRAL PACKET {hasEdits && !editing && (
            <span style={{ color: C.teal, marginLeft: 6, letterSpacing: 0 }}>· Edited</span>
          )}
        </div>

        {editing ? (
          <>
            <textarea
              value={narrative}
              onChange={function(e) { setNarrative(e.target.value); }}
              style={{
                width: "100%", minHeight: 180, padding: 12,
                border: "0.5px solid " + C.borderMid, borderRadius: 4,
                fontSize: 12, color: C.textPrimary, fontFamily: "inherit",
                lineHeight: 1.5, resize: "vertical",
              }}
            />
            <div style={{
              fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
              color: C.textTertiary, marginTop: 12, marginBottom: 6,
            }}>
              STAFF NOTES (internal)
            </div>
            <textarea
              value={notes}
              onChange={function(e) { setNotes(e.target.value); }}
              placeholder="Internal notes about this referral..."
              style={{
                width: "100%", minHeight: 60, padding: 10,
                border: "0.5px solid " + C.borderMid, borderRadius: 4,
                fontSize: 12, color: C.textPrimary, fontFamily: "inherit",
                lineHeight: 1.5, resize: "vertical",
              }}
            />
          </>
        ) : (
          <>
            <div style={{
              fontSize: 13, color: C.textPrimary, lineHeight: 1.6,
              whiteSpace: "pre-wrap",
              padding: 12, background: C.bgSecondary, borderRadius: 4,
              border: "0.5px solid " + C.borderMid,
            }}>
              {narrative || "(no narrative)"}
            </div>
            {draft.staff_notes && (
              <div style={{
                marginTop: 10, padding: "8px 12px",
                background: "#FFF7ED", border: "0.5px solid #FED7AA",
                borderRadius: 4, fontSize: 11, color: "#9A3412",
              }}>
                <strong>Staff notes:</strong> {draft.staff_notes}
              </div>
            )}
          </>
        )}

        {/* Actions */}
        <div style={{
          display: "flex", justifyContent: "flex-end",
          gap: 8, marginTop: 14, flexWrap: "wrap",
        }}>
          {editing ? (
            <>
              <button
                onClick={function() {
                  setNarrative(getEffectiveNarrative(draft));
                  setNotes(draft.staff_notes || "");
                  setEditing(false);
                }}
                disabled={saving}
                style={btnSecondary(saving)}
              >
                Cancel
              </button>
              <button onClick={handleSaveEdit} disabled={saving} style={btnPrimary(saving)}>
                {saving ? "Saving..." : "Save edits"}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={function() { setEditing(true); }}
                disabled={saving || draft.status === "Sent" || draft.status === "Dismissed"}
                style={btnSecondary(saving)}
              >
                Edit
              </button>
              <button onClick={handleCopy} disabled={saving} style={btnSecondary(saving)}>
                {copiedAt ? "Copied!" : "Copy to clipboard"}
              </button>
              {draft.status === "Draft" && (
                <>
                  <button
                    onClick={function() { handleStatusChange("Dismissed"); }}
                    disabled={saving}
                    style={btnSecondary(saving)}
                  >
                    Dismiss
                  </button>
                  <button
                    onClick={function() { handleStatusChange("Approved"); }}
                    disabled={saving}
                    style={btnPrimary(saving)}
                  >
                    Approve
                  </button>
                </>
              )}
              {draft.status === "Approved" && (
                <button
                  onClick={function() { setSendModalOpen(true); }}
                  disabled={saving}
                  style={btnPrimary(saving)}
                >
                  I sent this - record it
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {sendModalOpen && (
        <SendReferralModal
          draft={draft}
          onCancel={function() { setSendModalOpen(false); }}
          onConfirm={handleSendComplete}
          saving={saving}
        />
      )}
    </div>
  );
}

function btnPrimary(disabled) {
  return {
    background: C.teal, color: "#fff", border: "none",
    borderRadius: 6, padding: "7px 14px", fontSize: 12, fontWeight: 600,
    cursor: disabled ? "wait" : "pointer", fontFamily: "inherit",
    opacity: disabled ? 0.6 : 1,
  };
}
function btnSecondary(disabled) {
  return {
    background: "#fff", color: C.textSecondary,
    border: "0.5px solid " + C.borderMid,
    borderRadius: 6, padding: "7px 14px", fontSize: 12, fontWeight: 600,
    cursor: disabled ? "wait" : "pointer", fontFamily: "inherit",
    opacity: disabled ? 0.6 : 1,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
// SendReferralModal - captures sent_via + optional recipient when staff marks
// a referral as externally sent. Feeds reporting ("% of transportation
// referrals via NCCARE360 last month") and will gracefully accommodate the
// future NCCARE360 API integration without schema changes.
// ───────────────────────────────────────────────────────────────────────────────

function SendReferralModal({ draft, onCancel, onConfirm, saving }) {
  const [sentVia, setSentVia]           = useState(SEND_VIA_OPTIONS[0].value);
  const [recipient, setRecipient]       = useState("");

  const domainLabel = DOMAIN_LABELS[draft.domain] || draft.domain;

  const handleSubmit = function() {
    if (!sentVia) return;
    onConfirm({
      sent_via: sentVia,
      sent_to_recipient: recipient.trim() || null,
    });
  };

  const recipientPlaceholder =
    sentVia === "Email" ? "e.g. partner@foodbank.org" :
    sentVia === "Fax"   ? "e.g. (919) 555-0199" :
    sentVia === "Phone" ? "e.g. Care coordinator - Jane Smith" :
    sentVia === "NCCARE360 Portal" ? "e.g. Food Bank of Central NC" :
    sentVia === "NCCARE360 API"    ? "e.g. Food Bank of Central NC (auto-filled from response)" :
    "Partner name or contact info (optional)";

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        onClick={function(e) { e.stopPropagation(); }}
        style={{
          background: "#fff", borderRadius: 8,
          maxWidth: 480, width: "90vw",
          boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
          overflow: "hidden",
        }}
      >
        <div style={{
          padding: "16px 20px",
          borderBottom: "0.5px solid " + C.borderMid,
        }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary }}>
            Record referral as sent
          </div>
          <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 4 }}>
            {domainLabel} referral for {patientName(draft.patients)}
          </div>
        </div>

        <div style={{ padding: "18px 20px" }}>
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
            color: C.textTertiary, marginBottom: 6,
          }}>
            HOW WAS THIS SENT?
          </div>
          <select
            value={sentVia}
            onChange={function(e) { setSentVia(e.target.value); }}
            disabled={saving}
            style={{
              width: "100%", padding: "8px 10px",
              border: "0.5px solid " + C.borderMid, borderRadius: 6,
              fontSize: 13, color: C.textPrimary, fontFamily: "inherit",
              background: "#fff",
            }}
          >
            {SEND_VIA_OPTIONS.map(function(opt) {
              return <option key={opt.value} value={opt.value}>{opt.label}</option>;
            })}
          </select>

          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
            color: C.textTertiary, marginTop: 16, marginBottom: 6,
          }}>
            RECIPIENT <span style={{ color: C.textTertiary, fontWeight: 500, letterSpacing: 0 }}>(optional)</span>
          </div>
          <input
            type="text"
            value={recipient}
            onChange={function(e) { setRecipient(e.target.value); }}
            placeholder={recipientPlaceholder}
            disabled={saving}
            style={{
              width: "100%", padding: "8px 10px",
              border: "0.5px solid " + C.borderMid, borderRadius: 6,
              fontSize: 13, color: C.textPrimary, fontFamily: "inherit",
            }}
          />
          <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 6, lineHeight: 1.5 }}>
            Who or what organization received this referral. Used for follow-up
            and reporting.
          </div>
        </div>

        <div style={{
          padding: "12px 20px",
          borderTop: "0.5px solid " + C.borderMid,
          background: C.bgSecondary,
          display: "flex", justifyContent: "flex-end", gap: 8,
        }}>
          <button onClick={onCancel} disabled={saving} style={btnSecondary(saving)}>
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={saving || !sentVia} style={btnPrimary(saving)}>
            {saving ? "Recording..." : "Confirm sent"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
// Schedule tab (stub - full implementation in Step 3)
// ───────────────────────────────────────────────────────────────────────────────

function ScheduleTabStub() {
  return (
    <EmptyState
      title="Due-for-screening tracking coming in Step 3"
      body="This tab will show patients whose HRSN re-screening is due based on their cadence interval (annual by default, 6 months for high-need patients). Cadence is set by the provider after reviewing each screening."
    />
  );
}

// ───────────────────────────────────────────────────────────────────────────────
// Shared empty / loading / locked states
// ───────────────────────────────────────────────────────────────────────────────

function EmptyState({ title, body }) {
  return (
    <div style={{
      background: "#fff", border: "0.5px dashed " + C.borderMid,
      borderRadius: 8, padding: "40px 24px", textAlign: "center",
    }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: C.textPrimary, marginBottom: 6 }}>
        {title}
      </div>
      <div style={{ fontSize: 12, color: C.textSecondary, maxWidth: 500, margin: "0 auto", lineHeight: 1.5 }}>
        {body}
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div style={{
      padding: "40px 24px", textAlign: "center",
      color: C.textTertiary, fontSize: 12,
    }}>
      Loading screenings...
    </div>
  );
}

function LockedState() {
  return (
    <div style={{
      background: "#fff", border: "0.5px solid " + C.borderMid,
      borderRadius: 8, padding: "32px 24px", textAlign: "center",
    }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: C.textPrimary, marginBottom: 6 }}>
        HRSN Screening is a Pro tier feature
      </div>
      <div style={{ fontSize: 13, color: C.textSecondary, maxWidth: 520, margin: "0 auto", lineHeight: 1.5 }}>
        Upgrade to Pro to enable AI-generated clinical summaries of Health-Related
        Social Needs screenings, plus automated draft referrals in NCCARE360 format
        for staff review.
      </div>
    </div>
  );
}
