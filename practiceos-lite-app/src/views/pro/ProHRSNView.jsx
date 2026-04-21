// ═══════════════════════════════════════════════════════════════════════════════
// src/views/pro/ProHRSNView.jsx
// Pro tier: HRSN pre-visit screener management.
// This view (Step 1 of 3) renders existing screenings + AI summaries + referral
// drafts. Staff screener form and patient portal form land in Step 2.
// Cadence scheduling and dashboard widget land in Step 3.
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { supabase } from "../../lib/supabaseClient";
import { C } from "../../lib/tokens";
import {
  listRecentScreenings,
  listReferralDrafts,
  updateReferralDraft,
  markReferralSent,
  markResponseReviewed,
  getEffectiveNarrative,
  getPracticePref,
  upsertScreeningSchedule,
  listDueForScreening,
  getScreeningCounts,
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

// Cadence dropdown options. Aligned with NC Medicaid norms: 6 months for
// high-need patients, 12 months standard, 24 months for stable low-risk.
const CADENCE_OPTIONS = [
  { value: 6,  label: "6 months",  helper: "High-need patient" },
  { value: 12, label: "12 months", helper: "Standard" },
  { value: 24, label: "24 months", helper: "Stable / low-risk" },
];

function addMonthsToDateStr(dateStr, months) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + Number(months));
  return d.toISOString().slice(0, 10);
}

function fmtDateShort(dateStr) {
  if (!dateStr) return "-";
  const d = new Date(dateStr + (dateStr.length === 10 ? "T00:00:00" : ""));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function daysBetween(dateStr) {
  if (!dateStr) return 0;
  const d = new Date(dateStr + "T00:00:00").getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d - today.getTime()) / 86400000);
}

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
  // Recent Screenings filter: 'all' | 'needs_review' | 'urgent' | 'reviewed'
  // Default to needs_review so the tab opens as a clinical queue, not a feed.
  const [screeningFilter, setScreeningFilter] = useState("needs_review");
  const [screeningCounts, setScreeningCounts] = useState({
    all: 0, needs_review: 0, urgent: 0, reviewed: 0,
  });

  useEffect(() => {
    if (!isProTier || !practiceId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      listRecentScreenings(practiceId, 30, screeningFilter),
      listReferralDrafts(practiceId, { statuses: ["Draft", "Approved"] }),
      getScreeningCounts(practiceId),
    ])
      .then(function(results) {
        if (cancelled) return;
        setScreenings(results[0]);
        setDrafts(results[1]);
        setScreeningCounts(results[2]);
      })
      .catch(function(e) {
        if (!cancelled) setError(e.message || String(e));
      })
      .finally(function() {
        if (!cancelled) setLoading(false);
      });
    return function() { cancelled = true; };
  }, [practiceId, isProTier, refreshKey, screeningFilter]);

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
          filter={screeningFilter}
          onFilterChange={setScreeningFilter}
          counts={screeningCounts}
          onOptimisticRemove={function(id) {
            setScreenings(function(prev) { return prev.filter(function(s) { return s.id !== id; }); });
          }}
        />
      )}

      {!loading && activeTab === "drafts" && (
        <ReferralDraftsTab
          drafts={drafts}
          currentUser={profile}
          onUpdated={handleRefresh}
        />
      )}

      {!loading && activeTab === "schedule" && <ScheduleTab practiceId={practiceId} />}
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

function RecentScreeningsTab({ screenings, currentUser, onUpdated, filter, onFilterChange, counts, onOptimisticRemove }) {
  const emptyCopy = {
    all:          { title: "No HRSN screenings yet",        body: "Screenings completed by patients (via portal or staff tablet) will appear here with an AI-generated clinical summary." },
    needs_review: { title: "Nothing needs review",          body: "All AI summaries generated so far have been reviewed by staff. New screenings will appear here as they're completed." },
    urgent:       { title: "No urgent alerts waiting",      body: "Nothing in the current queue was flagged with an urgent safety alert. This is a good thing." },
    reviewed:     { title: "No reviewed screenings yet",    body: "Once staff marks a screening as reviewed, it moves here." },
  }[filter] || { title: "No screenings", body: "" };

  return (
    <div>
      <ScreeningFilterBar filter={filter} onChange={onFilterChange} counts={counts} />

      {screenings.length === 0 ? (
        <EmptyState title={emptyCopy.title} body={emptyCopy.body} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {screenings.map(function(s) {
            return (
              <ScreeningCard
                key={s.id}
                screening={s}
                currentUser={currentUser}
                onUpdated={onUpdated}
                filter={filter}
                onOptimisticRemove={onOptimisticRemove}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function ScreeningFilterBar({ filter, onChange, counts }) {
  const pills = [
    { id: "needs_review", label: "Needs review",  count: counts.needs_review, tone: "amber",   emphasis: counts.needs_review > 0 },
    { id: "urgent",       label: "Urgent alerts", count: counts.urgent,       tone: "red",     emphasis: counts.urgent > 0 },
    { id: "reviewed",     label: "Reviewed",      count: counts.reviewed,     tone: "teal",    emphasis: false },
    { id: "all",          label: "All",           count: counts.all,          tone: "neutral", emphasis: false },
  ];
  return (
    <div style={{
      display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16,
      padding: "10px 12px", background: "#fff",
      border: "0.5px solid " + C.borderMid, borderRadius: 8,
    }}>
      {pills.map(function(p) {
        const active = filter === p.id;
        const style  = getFilterPillStyle(p.tone, active, p.emphasis);
        return (
          <button
            key={p.id}
            onClick={function() { onChange(p.id); }}
            style={{
              display: "flex", alignItems: "center", gap: 7,
              padding: "6px 12px", borderRadius: 16,
              border: "0.5px solid " + style.border,
              background: style.bg, color: style.color,
              fontSize: 12, fontWeight: active ? 700 : 600,
              cursor: "pointer", fontFamily: "inherit",
              transition: "background 0.12s, color 0.12s",
            }}
          >
            <span>{p.label}</span>
            <span style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              minWidth: 18, height: 18, padding: "0 6px",
              borderRadius: 10, fontSize: 10, fontWeight: 700,
              background: style.badgeBg, color: style.badgeColor,
            }}>
              {p.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function getFilterPillStyle(tone, active, emphasis) {
  // Active = the currently-selected filter (solid look)
  // Emphasis = non-zero count on a tone that needs attention (amber/red glow even when inactive)
  const palettes = {
    amber:   { base:"#FEF3C7", border:"#D97706", color:"#92400E", activeBg:"#D97706", activeColor:"#fff" },
    red:     { base:"#FEE2E2", border:"#DC2626", color:"#991B1B", activeBg:"#DC2626", activeColor:"#fff" },
    teal:    { base:"#D1FAE5", border:"#059669", color:"#065F46", activeBg:"#059669", activeColor:"#fff" },
    neutral: { base:"#F3F4F6", border:C.borderMid, color:C.textSecondary, activeBg:C.textPrimary, activeColor:"#fff" },
  };
  const p = palettes[tone] || palettes.neutral;
  if (active) {
    return {
      bg: p.activeBg, color: p.activeColor, border: p.activeBg,
      badgeBg: "rgba(255,255,255,0.25)", badgeColor: "#fff",
    };
  }
  if (emphasis) {
    return {
      bg: p.base, color: p.color, border: p.border,
      badgeBg: "#fff", badgeColor: p.color,
    };
  }
  return {
    bg: "#fff", color: C.textSecondary, border: C.borderMid,
    badgeBg: "#F3F4F6", badgeColor: C.textTertiary,
  };
}

function ScreeningCard({ screening, currentUser, onUpdated, filter, onOptimisticRemove }) {
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
  const isReviewed      = !!s.reviewed_at;
  const needsReview     = status === "Success" && !isReviewed;

  const handleMarkReviewed = async function() {
    setMarking(true);
    try {
      await markResponseReviewed(s.id, currentUser);
      // Optimistic removal: if we're viewing a filter this row no longer
      // matches (needs_review or urgent), slide it out immediately so the
      // provider sees an inbox-like clearing behavior.
      if ((filter === "needs_review" || filter === "urgent") && onOptimisticRemove) {
        onOptimisticRemove(s.id);
      }
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
       <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: C.textSecondary }}>
          {isReviewed && (
            <span
              title={"Reviewed " + fmtDateTime(s.reviewed_at)}
              style={{
                background: "#D1FAE5", color: "#065F46",
                fontSize: 10, fontWeight: 600,
                padding: "3px 8px", borderRadius: 10,
              }}
            >
              Reviewed
            </span>
          )}
          {needsReview && !hasUrgent && (
            <span style={{
              background: "#FEF3C7", color: "#92400E",
              fontSize: 10, fontWeight: 600,
              padding: "3px 8px", borderRadius: 10,
            }}>
              Needs review
            </span>
          )}
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
              screening={s}
              currentUser={currentUser}
              onCadenceSaved={onUpdated}
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

function AISummaryBody({ summary, canMarkReviewed, marking, onMarkReviewed, screening, currentUser, onCadenceSaved }) {
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

     {/* Cadence setter */}
      {screening && (
        <CadenceCard screening={screening} currentUser={currentUser} onSaved={onCadenceSaved} />
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
// ───────────────────────────────────────────────────────────────────────────────
// Cadence card - provider sets re-screen interval from within the summary view
// ───────────────────────────────────────────────────────────────────────────────

function CadenceCard({ screening, currentUser, onSaved }) {
  // We show the current schedule state + allow the provider to change cadence.
  // On save, we upsert patient_screening_schedule. The existing AFTER INSERT
  // trigger already set a 12-month default from this screening; this lets the
  // provider override to 6 or 24.
  const [cadence, setCadence] = useState(12);
  const [reason, setReason]   = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [error, setError]     = useState(null);
  const [schedule, setSchedule] = useState(null);

  useEffect(() => {
    if (!screening || !screening.practice_id || !screening.patient_id) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from("patient_screening_schedule")
          .select("id, cadence_months, reason_for_cadence, last_screened_at, due_date")
          .eq("practice_id",   screening.practice_id)
          .eq("patient_id",    screening.patient_id)
          .eq("screener_type", "HRSN")
          .maybeSingle();
        if (cancelled) return;
        if (data) {
          setSchedule(data);
          setCadence(data.cadence_months || 12);
          setReason(data.reason_for_cadence || "");
        }
      } catch (e) {
        if (!cancelled) setError(e && e.message ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return function() { cancelled = true; };
  }, [screening]);

  const projectedDue = useMemo(() => {
    const anchor = (schedule && schedule.last_screened_at) || screening.completed_at;
    if (!anchor) return null;
    return addMonthsToDateStr(anchor, cadence);
  }, [schedule, screening, cadence]);

  // Is the screening being viewed the same as the patient's most recent?
  // If not, show a note - cadence always anchors to the most recent response,
  // so a provider editing from an older screening may expect the projection
  // to start from the visible screening's completed_at.
  const viewingHistorical = useMemo(() => {
    if (!schedule || !schedule.last_screened_at || !screening.completed_at) return false;
    // Treat "same" as within 5 seconds to avoid timestamp-precision false positives
    const diffMs = Math.abs(
      new Date(schedule.last_screened_at).getTime() - new Date(screening.completed_at).getTime()
    );
    return diffMs > 5000;
  }, [schedule, screening]);

  const hasChanges =
    !loading && (
      cadence !== (schedule?.cadence_months || 12) ||
      reason  !== (schedule?.reason_for_cadence || "")
    );

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await upsertScreeningSchedule({
        practice_id:         screening.practice_id,
        patient_id:          screening.patient_id,
        screener_type:       "HRSN",
        cadence_months:      cadence,
        reason_for_cadence:  reason.trim() || null,
      });
      setSavedAt(Date.now());
      if (onSaved) onSaved();
    } catch (e) {
      setError(e && e.message ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      background: "#fff", border: "0.5px solid " + C.borderMid,
      borderRadius: 6, padding: "14px 16px",
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
        color: C.textTertiary, marginBottom: 10,
      }}>
        RE-SCREENING CADENCE
      </div>

      {loading ? (
        <div style={{ fontSize: 12, color: C.textTertiary }}>Loading current schedule...</div>
      ) : (
        <>
         {viewingHistorical && (
            <div style={{
              marginBottom: 12, padding: "8px 10px",
              background: "#FEF3C7", border: "0.5px solid #D97706",
              borderRadius: 4, fontSize: 11, color: "#92400E", lineHeight: 1.5,
            }}>
              <strong>Viewing an older screening.</strong> Cadence always anchors
              to this patient's most recent HRSN response
              {schedule && schedule.last_screened_at
                ? (" (" + fmtDateShort(schedule.last_screened_at.slice(0, 10)) + ")")
                : ""}
              , not the one displayed above.
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
            {CADENCE_OPTIONS.map(opt => {
              const selected = cadence === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setCadence(opt.value)}
                  disabled={saving}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    width: "100%", textAlign: "left",
                    padding: "9px 12px",
                    background: selected ? "#E0F2FE" : "#fff",
                    border: "0.5px solid " + (selected ? "#0284C7" : C.borderMid),
                    borderRadius: 6,
                    cursor: saving ? "wait" : "pointer",
                    fontFamily: "inherit", fontSize: 12,
                    color: selected ? "#075985" : C.textPrimary,
                    fontWeight: selected ? 600 : 500,
                  }}
                >
                  <span style={{
                    width: 14, height: 14, borderRadius: "50%",
                    border: "1.5px solid " + (selected ? "#0284C7" : C.borderMid),
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {selected && <span style={{
                      width: 6, height: 6, borderRadius: "50%", background: "#0284C7",
                    }} />}
                  </span>
                  <span style={{ flex: 1 }}>{opt.label}</span>
                  <span style={{ fontSize: 10, color: C.textTertiary, fontWeight: 500 }}>
                    {opt.helper}
                  </span>
                </button>
              );
            })}
          </div>

          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
            color: C.textTertiary, marginBottom: 5,
          }}>
            REASON <span style={{ fontWeight: 500, letterSpacing: 0 }}>(optional)</span>
          </div>
          <input
            type="text"
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="e.g. High-need per PCP assessment"
            disabled={saving}
            style={{
              width: "100%", padding: "7px 10px",
              border: "0.5px solid " + C.borderMid, borderRadius: 6,
              fontSize: 12, color: C.textPrimary, fontFamily: "inherit",
              marginBottom: 12,
            }}
          />

          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            flexWrap: "wrap", gap: 10,
          }}>
            <div style={{ fontSize: 11, color: C.textSecondary }}>
              Next screening due: <strong style={{ color: C.textPrimary }}>
                {fmtDateShort(projectedDue)}
              </strong>
              {schedule && schedule.due_date !== projectedDue && (
                <span style={{ color: C.textTertiary, marginLeft: 6 }}>
                  (was {fmtDateShort(schedule.due_date)})
                </span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {savedAt && !hasChanges && (
                <span style={{ fontSize: 11, color: "#065F46" }}>Saved</span>
              )}
              <button
                onClick={handleSave}
                disabled={saving || !hasChanges}
                style={{
                  background: hasChanges ? C.teal : C.textTertiary,
                  color: "#fff", border: "none",
                  borderRadius: 6, padding: "7px 14px", fontSize: 12, fontWeight: 600,
                  cursor: saving ? "wait" : (hasChanges ? "pointer" : "not-allowed"),
                  fontFamily: "inherit",
                  opacity: saving ? 0.7 : 1,
                }}
              >
                {saving ? "Saving..." : "Save cadence"}
              </button>
            </div>
          </div>

          {error && (
            <div style={{
              marginTop: 10, padding: "8px 10px",
              background: "#FEE2E2", border: "0.5px solid #DC2626",
              color: "#991B1B", fontSize: 11, borderRadius: 4,
            }}>
              {error}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
// Schedule tab - Overdue + Coming Due
// ───────────────────────────────────────────────────────────────────────────────

function ScheduleTab({ practiceId }) {
  const [buckets, setBuckets] = useState({ overdue: [], comingDue: [], lookaheadDays: 30 });
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    if (!practiceId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const pref = await getPracticePref(practiceId, "pro_hrsn_due_lookahead_days");
        const lookahead = (typeof pref === "number" && pref > 0) ? pref : 30;
        const result = await listDueForScreening(practiceId, lookahead);
        if (!cancelled) setBuckets(result);
      } catch (e) {
        if (!cancelled) setError(e && e.message ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return function() { cancelled = true; };
  }, [practiceId]);

  if (loading) return <LoadingState />;
  if (error) {
    return (
      <div style={{
        background: "#FEE2E2", border: "0.5px solid #DC2626",
        color: "#991B1B", padding: "10px 14px", borderRadius: 6,
        fontSize: 12,
      }}>
        Error loading: {error}
      </div>
    );
  }

  const { overdue, comingDue, lookaheadDays } = buckets;

  if (overdue.length === 0 && comingDue.length === 0) {
    return (
      <EmptyState
        title="No screenings due right now"
        body={"All patients with HRSN screening schedules are current. Patients coming due within " + lookaheadDays + " days will surface here."}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {overdue.length > 0 && (
        <ScheduleBucket
          title="Overdue"
          subtitle="Re-screening due date has passed"
          accent="#DC2626"
          accentBg="#FEE2E2"
          rows={overdue}
        />
      )}
      {comingDue.length > 0 && (
        <ScheduleBucket
          title="Coming due"
          subtitle={"Re-screening due within " + lookaheadDays + " days"}
          accent="#D97706"
          accentBg="#FEF3C7"
          rows={comingDue}
        />
      )}
    </div>
  );
}

function ScheduleBucket({ title, subtitle, accent, accentBg, rows }) {
  return (
    <div>
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 3 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.textPrimary }}>
            {title}
          </div>
          <span style={{
            background: accentBg, color: accent,
            fontSize: 11, fontWeight: 700,
            padding: "2px 9px", borderRadius: 10,
          }}>
            {rows.length}
          </span>
        </div>
        <div style={{ fontSize: 11, color: C.textTertiary }}>{subtitle}</div>
      </div>

      <div style={{
        background: "#fff",
        border: "0.5px solid " + C.borderMid,
        borderRadius: 8, overflow: "hidden",
      }}>
        {rows.map(function(r, i) {
          const p        = r.patients || {};
          const name     = ((p.first_name || "") + " " + (p.last_name || "")).trim() || "Unknown patient";
          const mrn      = p.mrn || "-";
          const days     = daysBetween(r.due_date);
          const dayLabel =
            days < 0  ? (Math.abs(days) + " day" + (Math.abs(days) === 1 ? "" : "s") + " ago") :
            days === 0 ? "Today" :
                         ("in " + days + " day" + (days === 1 ? "" : "s"));
          return (
            <div
              key={r.id}
              style={{
                padding: "12px 16px",
                borderTop: i > 0 ? ("0.5px solid " + C.borderLight) : "none",
                display: "flex", alignItems: "center",
                gap: 12, flexWrap: "wrap",
              }}
            >
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>
                  {name}
                </div>
                <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>
                  MRN {mrn}
                  {r.last_screened_at && (
                    <span> · Last screened {fmtDateShort(r.last_screened_at.slice(0, 10))}</span>
                  )}
                  {r.cadence_months && (
                    <span> · {r.cadence_months}-month cadence</span>
                  )}
                </div>
                {r.reason_for_cadence && (
                  <div style={{ fontSize: 11, color: C.textSecondary, marginTop: 3, fontStyle: "italic" }}>
                    {r.reason_for_cadence}
                  </div>
                )}
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: accent }}>
                  Due {fmtDateShort(r.due_date)}
                </div>
                <div style={{ fontSize: 11, color: C.textTertiary }}>
                  {dayLabel}
                </div>
              </div>
              <button
                disabled
                title="Staff 'Start screening' button is wired in Step 2b"
                style={{
                  background: "#fff", color: C.textTertiary,
                  border: "0.5px solid " + C.borderMid,
                  borderRadius: 6, padding: "7px 12px", fontSize: 12, fontWeight: 600,
                  cursor: "not-allowed", fontFamily: "inherit", opacity: 0.65,
                }}
              >
                Start screening
              </button>
            </div>
          );
        })}
      </div>
    </div>
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
