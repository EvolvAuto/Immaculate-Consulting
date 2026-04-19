// ═══════════════════════════════════════════════════════════════════════════════
// src/App.jsx
// PracticeOS Lite shell: nav sidebar + routed main content.
// Views are lazy-imported as they're built out view-by-view in subsequent sessions.
// ═══════════════════════════════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import { useAuth } from "./auth/AuthProvider";
import { supabase } from "./lib/supabaseClient";
import ProtectedRoute from "./auth/ProtectedRoute";
import { C, NAV_BY_ROLE, NAV_META, ROLE_STYLES } from "./lib/tokens";
import ActivatePortal from "./auth/ActivatePortal";
import PortalShell    from "./views/PortalShell";

// Views -----------------------------------------------------------------------
// Stub placeholders. Each is a standalone file under src/views/ and gets
// fleshed out session-by-session by porting from PracticeOSLite_Full.jsx.
import DashboardView   from "./views/DashboardView";
import ScheduleView    from "./views/ScheduleView";
import PatientsView    from "./views/PatientsView";
import QueueView       from "./views/QueueView";
import TasksView       from "./views/TasksView";
import ClinicalView    from "./views/ClinicalView";
import InboxView       from "./views/InboxView";
import StaffView       from "./views/StaffView";
import ReportsView     from "./views/ReportsView";
import SettingsView    from "./views/SettingsView";
import EligibilityView from "./views/EligibilityView";
import WaitlistView    from "./views/WaitlistView";
import InsightsView    from "./views/InsightsView";
import ComplianceView       from "./views/ComplianceView";
import InsuranceUpdatesView from "./views/InsuranceUpdatesView";
import PortalView           from "./views/PortalView";

const VIEWS = {
  dashboard:         DashboardView,
  schedule:          ScheduleView,
  patients:          PatientsView,
  queue:             QueueView,
  tasks:             TasksView,
  clinical:          ClinicalView,
  inbox:             InboxView,
  staff:             StaffView,
  reports:           ReportsView,
  settings:          SettingsView,
  eligibility:       EligibilityView,
  waitlist:          WaitlistView,
  insights:          InsightsView,
  compliance:        ComplianceView,
  insurance_updates: InsuranceUpdatesView,
  portal:            PortalView,
};

export default function App() {
  // Public activation route - runs BEFORE auth check so patients without a
  // session can land on /activate?token=... directly from the invite email.
  if (typeof window !== "undefined" && window.location.pathname === "/activate") {
    return <ActivatePortal />;
  }
  return (
    <ProtectedRoute>
      <Shell />
    </ProtectedRoute>
  );
}

function Shell() {
  const { profile, role, practiceId, signOut } = useAuth();

  // Patient role gets its own shell - skip the staff sidebar entirely
  if (role === "Patient") return <PortalShell />;

  const navItems = NAV_BY_ROLE[role] || [];
  const [activeNav, setActiveNav] = useState(navItems[0] || "dashboard");
  const [collapsed, setCollapsed] = useState(false);
  const [badgeCounts, setBadgeCounts] = useState({});

  // Refresh sidebar badges on mount, every 60s, and after any nav change
  useEffect(() => {
    if (!practiceId) return;
    let cancelled = false;
    const fetchCounts = async () => {
      const counts = {};
      const { count } = await supabase
        .from("insurance_update_requests")
        .select("id", { count: "exact", head: true })
        .eq("practice_id", practiceId)
        .eq("status", "Pending Review");
      counts.insurance_updates = count || 0;
      if (!cancelled) setBadgeCounts(counts);
    };
    fetchCounts();
    const timer = setInterval(fetchCounts, 60000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [practiceId, activeNav]);

  const ActiveView = VIEWS[activeNav] || (() => <EmptyState name={activeNav} />);
  const roleStyle  = ROLE_STYLES[role] || {};

  return (
    <div style={{
      display: "flex",
      height: "100vh",
      background: C.bgSecondary,
      fontFamily: "'DM Sans', system-ui, -apple-system, sans-serif",
      color: C.textPrimary,
    }}>
      {/* ── Sidebar ───────────────────────────────────────────────────── */}
      <nav style={{
        width: collapsed ? 64 : 220,
        background: C.navBg,
        color: "#fff",
        display: "flex",
        flexDirection: "column",
        transition: "width 0.2s",
        flexShrink: 0,
      }}>
        <div style={{
          padding: collapsed ? "18px 0" : "18px 20px",
          borderBottom: "0.5px solid rgba(255,255,255,0.08)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          justifyContent: collapsed ? "center" : "flex-start",
        }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8,
            background: C.teal, color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 13, fontWeight: 800, flexShrink: 0,
          }}>PL</div>
          {!collapsed && (
            <div>
              <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 14, fontWeight: 700 }}>PracticeOS</div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.55)" }}>Lite</div>
            </div>
          )}
        </div>

        {/* Nav items */}
        <div style={{ flex: 1, padding: "12px 8px", overflowY: "auto" }}>
          {navItems.map(id => {
            const meta = NAV_META[id];
            if (!meta) return null;
            const active = activeNav === id;
            return (
              <button
                key={id}
                onClick={() => setActiveNav(id)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: collapsed ? "10px 0" : "10px 12px",
                  marginBottom: 2,
                  background: active ? "rgba(255,255,255,0.08)" : "transparent",
                  border: "none",
                  borderRadius: 8,
                  color: active ? "#fff" : "rgba(255,255,255,0.7)",
                  fontSize: 13,
                  fontWeight: active ? 600 : 500,
                  cursor: "pointer",
                  textAlign: "left",
                  justifyContent: collapsed ? "center" : "flex-start",
                }}
              >
                <span style={{ fontSize: 14, position: "relative" }}>
                  {meta.icon}
                  {collapsed && badgeCounts[id] > 0 && (
                    <span style={{
                      position: "absolute", top: -4, right: -6,
                      width: 8, height: 8, borderRadius: "50%",
                      background: C.amber,
                    }} />
                  )}
                </span>
                {!collapsed && <span style={{ flex: 1 }}>{meta.label}</span>}
                {!collapsed && badgeCounts[id] > 0 && (
                  <span style={{
                    background: C.amber, color: "#fff",
                    fontSize: 10, fontWeight: 700,
                    borderRadius: 10, padding: "2px 7px",
                    minWidth: 18, textAlign: "center", lineHeight: 1.4,
                  }}>{badgeCounts[id]}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* User strip */}
        <div style={{
          padding: collapsed ? "12px 0" : "14px 16px",
          borderTop: "0.5px solid rgba(255,255,255,0.08)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          justifyContent: collapsed ? "center" : "space-between",
        }}>
          {!collapsed && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {profile?.full_name || "—"}
              </div>
              <div style={{ fontSize: 10, color: roleStyle.border || "rgba(255,255,255,0.55)" }}>
                {roleStyle.label || role || "—"}
              </div>
            </div>
          )}
          <button
            onClick={signOut}
            style={{
              background: "transparent", color: "rgba(255,255,255,0.6)",
              border: "0.5px solid rgba(255,255,255,0.2)", borderRadius: 6,
              padding: "4px 8px", fontSize: 10, cursor: "pointer",
            }}
            title="Sign out"
          >
            Sign out
          </button>
        </div>

        <button
          onClick={() => setCollapsed(c => !c)}
          style={{
            background: "transparent", color: "rgba(255,255,255,0.4)",
            border: "none", padding: "10px", fontSize: 11, cursor: "pointer",
            borderTop: "0.5px solid rgba(255,255,255,0.06)",
          }}
        >
          {collapsed ? "›" : "‹  Collapse"}
        </button>
      </nav>

      {/* ── Main Content ──────────────────────────────────────────────── */}
     <main style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <ActiveView onNav={setActiveNav} />
      </main>
    </div>
  );
}

function EmptyState({ name }) {
  return (
    <div style={{
      flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
      color: C.textTertiary, fontSize: 13,
    }}>
      View "{name}" not yet implemented.
    </div>
  );
}
