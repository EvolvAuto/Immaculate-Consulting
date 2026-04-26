// ═══════════════════════════════════════════════════════════════════════════════
// src/views/admin/AdministratorView.jsx
// Multi-sub-view router shell for the Super Admin section. Renders a top
// sub-nav (matches the pattern of other PracticeOS views) and switches the
// body based on URL.
//
// All sub-views are super-admin gated by the parent <SuperAdminRoute/>; they
// can assume isSuperAdmin = true.
// ═══════════════════════════════════════════════════════════════════════════════

import { useNavigate, useLocation } from "react-router-dom";
import { C } from "../../lib/tokens";
import { TopBar } from "../../components/ui";
import SubscriptionsView from "./SubscriptionsView";
import PracticesView     from "./PracticesView";
import SystemHealthView  from "./SystemHealthView";
import FeatureFlagsView  from "./FeatureFlagsView";
import AuditLogView      from "./AuditLogView";
import AdminSettingsView from "./AdminSettingsView";

const TABS = [
  { key: "subscriptions", label: "Subscriptions", path: "/admin/subscriptions" },
  { key: "practices",     label: "Practices",     path: "/admin/practices" },
  { key: "health",        label: "System Health", path: "/admin/health" },
  { key: "flags",         label: "Feature Flags", path: "/admin/flags" },
  { key: "audit",         label: "Audit Log",     path: "/admin/audit" },
  { key: "settings",      label: "Settings",      path: "/admin/settings" },
];

export default function AdministratorView() {
  const navigate = useNavigate();
  const location = useLocation();

  const activeTab = TABS.find(t => location.pathname.startsWith(t.path)) || TABS[0];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar
        title="Administrator"
        sub="Internal IC tooling · super admin only"
        actions={null}
      />
      <div style={{
        display: "flex",
        gap: 0,
        padding: "0 24px",
        background: C.bgPrimary,
        borderBottom: "0.5px solid " + C.borderLight,
      }}>
        {TABS.map(tab => {
          const active = tab.key === activeTab.key;
          return (
            <button
              key={tab.key}
              onClick={() => navigate(tab.path)}
              style={{
                padding: "10px 0",
                marginRight: 22,
                fontSize: 12,
                fontWeight: active ? 600 : 500,
                color: active ? C.teal : C.textSecondary,
                background: "none",
                border: "none",
                borderBottom: "2px solid " + (active ? C.teal : "transparent"),
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {activeTab.key === "subscriptions" && <SubscriptionsView />}
        {activeTab.key === "practices"     && <PracticesView />}
        {activeTab.key === "health"        && <SystemHealthView />}
        {activeTab.key === "flags"         && <FeatureFlagsView />}
        {activeTab.key === "audit"         && <AuditLogView />}
        {activeTab.key === "settings"      && <AdminSettingsView />}
      </div>
    </div>
  );
}
