// ═══════════════════════════════════════════════════════════════════════════════
// src/Layout.jsx
// Shell chrome: sidebar + user strip + system banner + <Outlet/> for routed views.
// Extracted from the old App.jsx so routing lives at the top and chrome lives
// here. State-based activeNav is gone; the active item is derived from URL.
// ═══════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "./auth/AuthProvider";
import { supabase } from "./lib/supabaseClient";
import { C, NAV_BY_ROLE, NAV_META, ROLE_STYLES } from "./lib/tokens";
import PortalShell          from "./views/PortalShell";
import ProSystemAlertBanner from "./components/pro/ProSystemAlertBanner";
import SpectatorBanner      from "./auth/SpectatorBanner";

// Sidebar nav id -> URL path. Colocated with the sidebar rendering (not in
// tokens.js) so URL changes don't require a design-token edit.
const NAV_PATHS = {
  dashboard:         "/dashboard",
  schedule:          "/schedule",
  patients:          "/patients",
  queue:             "/queue",
  tasks:             "/tasks",
  clinical:          "/clinical",
  inbox:             "/inbox",
  staff:             "/staff",
  reports:           "/reports",
  settings:          "/settings",
  eligibility:       "/eligibility",
  waitlist:          "/waitlist",
  insights:          "/insights",
  compliance:        "/compliance",
  care_management:   "/care-management",
  insurance_updates: "/insurance-updates",
  portal:            "/portal",
  pro_chart_prep:    "/pro/chart-prep",
  pro_hrsn:          "/pro/hrsn",
  pro_assistant:     "/pro/assistant",
  pro_outreach:      "/pro/outreach",
  pro_inbound_sms:   "/pro/inbound-sms",
};

// Pro nav metadata (icon + label). Kept inline so tokens.js doesn't change.
const PRO_NAV_META_LOCAL = {
  pro_chart_prep:  { icon: "📋", label: "Chart Prep" },
  pro_hrsn:        { icon: "🤝", label: "HRSN" },
  pro_assistant:   { icon: "🤖", label: "AI Assistant" },
  pro_outreach:    { icon: "📤", label: "Outreach" },
  pro_inbound_sms: { icon: "💬", label: "Inbound SMS" },
};

export default function Layout() {
  const { profile, role, practiceId, tier, isSuperAdmin, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const mainRef  = useRef(null);

  // Patient role gets its own shell - short-circuit entirely, no sidebar.
  if (role === "Patient") return <PortalShell />;

  const navItems  = NAV_BY_ROLE[role] || [];
  const isProTier = ["Pro", "Command"].includes(tier);
  const proNavIds = isProTier
    ? ["pro_chart_prep", "pro_hrsn", "pro_assistant", "pro_outreach", "pro_inbound_sms"]
    : [];

  const [collapsed, setCollapsed]       = useState(false);
  const [badgeCounts, setBadgeCounts]   = useState({});

  // Derive active sidebar item from the URL.
  // Sort by path length descending so the more-specific match wins
  // (e.g. "/pro/chart-prep" beats "/pro" if "/pro" ever becomes a nav id).
  const activeNav = (() => {
    const entries = Object.entries(NAV_PATHS).sort((a, b) => b[1].length - a[1].length);
    const match = entries.find(([, p]) =>
      location.pathname === p || location.pathname.startsWith(p + "/")
    );
    return match ? match[0] : (navItems[0] || "dashboard");
  })();

  // Click handler used by the sidebar AND exposed to child views via outlet
  // context. Maintains backward compat with views that still call onNav('x').
  const onNav = (id) => {
    const path = NAV_PATHS[id];
    navigate(path || "/dashboard");
  };

  // Scroll reset on route change. <main> owns scrolling (not window),
  // so reset the main element's scrollTop, not window.scrollTo.
  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [location.pathname]);

  // Sidebar badge polling. Refetch on route change + every 60s.
  useEffect(() => {
    if (!practiceId) return;
    let cancelled = false;
    const fetchCounts = async () => {
      const [insuranceRes, inboxRes] = await Promise.all([
        supabase
          .from("insurance_update_requests")
          .select("id", { count: "exact", head: true })
          .eq("practice_id", practiceId)
          .eq("status", "Pending Review"),
        supabase
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("practice_id", practiceId)
          .eq("direction", "Inbound")
          .eq("is_read", false),
      ]);
      const counts = {
        insurance_updates: insuranceRes.count || 0,
        inbox:             inboxRes.count     || 0,
      };
      if (!cancelled) setBadgeCounts(counts);
    };
    fetchCounts();
    const timer = setInterval(fetchCounts, 60000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [practiceId, location.pathname]);

  const roleStyle = ROLE_STYLES[role] || {};

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
                onClick={() => onNav(id)}
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

          {proNavIds.length > 0 && !collapsed && (
            <div style={{
              padding: "14px 12px 4px",
              fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.4)",
            }}>Pro</div>
          )}
          {proNavIds.map(id => {
            const meta = PRO_NAV_META_LOCAL[id];
            if (!meta) return null;
            const active = activeNav === id;
            return (
              <button
                key={id}
                onClick={() => onNav(id)}
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
                <span style={{ fontSize: 14 }}>{meta.icon}</span>
                {!collapsed && <span style={{ flex: 1 }}>{meta.label}</span>}
              </button>
            );
          })}

          {/* Super admin section - only rendered for super admins.
              Defense layer 1 of 3 (cosmetic). Layer 2 = SuperAdminRoute. Layer 3 = RLS. */}
          {isSuperAdmin && (
            <>
              {!collapsed && (
                <div style={{
                  padding: "14px 12px 4px",
                  fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "rgba(93,202,165,0.55)",
                }}>Super Admin</div>
              )}
              <button
                onClick={() => navigate("/admin/subscriptions")}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: collapsed ? "10px 0" : "10px 12px",
                  marginBottom: 2,
                  background: location.pathname.startsWith("/admin") ? "rgba(93,202,165,0.12)" : "transparent",
                  border: "none",
                  borderLeft: "2px solid " + (location.pathname.startsWith("/admin") ? "#5DCAA5" : "transparent"),
                  borderRadius: 0,
                  color: location.pathname.startsWith("/admin") ? "#fff" : "rgba(255,255,255,0.75)",
                  fontSize: 13,
                  fontWeight: location.pathname.startsWith("/admin") ? 600 : 500,
                  cursor: "pointer",
                  textAlign: "left",
                  justifyContent: collapsed ? "center" : "flex-start",
                }}
              >
                <span style={{ fontSize: 14, color: "#5DCAA5" }}>◆</span>
                {!collapsed && <span style={{ flex: 1 }}>Administrator</span>}
                {!collapsed && (
                  <span style={{
                    fontSize: 8, fontWeight: 700,
                    color: "#5DCAA5",
                    background: "rgba(93,202,165,0.15)",
                    padding: "1px 5px",
                    borderRadius: 3,
                    letterSpacing: "0.12em",
                  }}>IC</span>
                )}
              </button>
            </>
          )}
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
      <main ref={mainRef} style={{ flex: 1, minWidth: 0, overflowY: "auto", display: "flex", flexDirection: "column" }}>
        <SpectatorBanner />
        <ProSystemAlertBanner practiceId={practiceId} role={role} tier={tier} />
        {/* Expose onNav to views via outlet context for backward compat.
            Views that still use `{ onNav }` as a prop will silently receive
            undefined and break only if they actually call it. Any such view
            is a one-line fix (see handoff notes below). */}
        <Outlet context={{ onNav }} />
      </main>
    </div>
  );
}
