import { useState, useEffect } from "react";
import { useAuth } from "../auth/AuthProvider";
import { C } from "../lib/tokens";
import { Card, SectionHead } from "../components/ui";
import CHWTab from "./CHWTab";
import PRLTab from "./care-management/PRLTab";
import HEDISTab from "./care-management/HEDISTab";
import RegistryTab from "./care-management/RegistryTab";
import TouchpointsTab from "./care-management/TouchpointsTab";
import PlansTab from "./care-management/PlansTab";
import BillingTab from "./care-management/BillingTab";

// ===============================================================================
// CareManagementView - entry point for the Care Management Console (Command tier)
//
// Seven tabs:
//   1. Registry            - enrollments list, acuity filter, program breakdown
//   2. Touchpoints         - contact log, role-aware activity filter
//   3. Plans               - care plans with AI-draft review gate indicator
//   4. Billing Readiness   - monthly billing_periods with readiness status
//   5. CHW Coordination    - CHW-to-CM assignments, FTE gauge
//   6. PRL                 - inbound reconciliation queue + outbound builder
//   7. HEDIS               - plan gap-list ingestion, member gaps, closure tracking
//
// This file is the router shell. Each tab lives in its own module under
// ./care-management/. Role-based tab visibility is computed here and the
// early-return for unauthorized users sits AFTER every hook to avoid the
// React hooks-order error #310 when auth loads asynchronously.
// ===============================================================================

const TAB_KEYS = ["registry", "touchpoints", "plans", "billing", "chw", "prl", "hedis"];
const TAB_META = {
  registry:    { label: "Registry",           icon: "\u25A3" },
  touchpoints: { label: "Touchpoints",        icon: "\u25C9" },
  plans:       { label: "Plans",              icon: "\u25A4" },
  billing:     { label: "Billing Readiness",  icon: "\u25A5" },
  chw:         { label: "CHW Coordination",   icon: "\u25C8" },
  prl:         { label: "PRL",                icon: "\u25A6" },
  hedis:       { label: "HEDIS",              icon: "\u25A7" },
};

const CM_ROLES = new Set([
  "Owner",
  "Manager",
  "Care Manager",
  "Supervising Care Manager",
  "Care Manager Supervisor",
]);

// Admin-only tabs (PRL). Clinical roles (CM, Supervising CM, CHW) don't see
// PRL - it's the health-plan roster exchange and is an administrative/billing
// function, not clinical care work. Owners and Managers can grant a user
// "Manager" role if they need PRL access.
const ADMIN_ROLES = new Set(["Owner", "Manager"]);

export default function CareManagementView() {
  const { profile } = useAuth();
  const role = profile?.role;
  const canAccess = role && (CM_ROLES.has(role) || role === "CHW");
  const isAdmin = role && ADMIN_ROLES.has(role);
  const [tab, setTab] = useState("registry"); // Default to Registry; PRL is admin-only

  // Role-based tab visibility. Computed unconditionally (no hooks below this
  // point can be skipped by the early-return below).
  //   CHW:                              Registry + Touchpoints + CHW
  //   Clinical (CM / Supervising CM):   all clinical tabs, no PRL
  //   Admin (Owner / Manager):          all tabs including PRL
  const visibleTabs = role === "CHW"
    ? ["registry", "touchpoints", "chw"]
    : isAdmin
      ? TAB_KEYS
      : ["registry", "touchpoints", "plans", "billing", "chw", "hedis"];

  // Keep tab valid for role. MUST run before any conditional return below,
  // or React's hook-ordering check will fire error #310 when auth loads
  // asynchronously (first render no role -> early return -> fewer hooks;
  // next render role loads -> more hooks -> crash).
  useEffect(() => {
    if (!visibleTabs.includes(tab)) setTab(visibleTabs[0]);
  }, [role]); // eslint-disable-line react-hooks/exhaustive-deps

  // Unauthorized roles see a polite block instead of the console
  if (!canAccess) {
    return (
      <div style={{ padding: 32 }}>
        <SectionHead title="Care Management" />
        <Card style={{ marginTop: 16, padding: 24, textAlign: "center" }}>
          <div style={{ fontSize: 15, color: C.textSecondary, marginBottom: 8 }}>
            The Care Management Console is available to Care Managers, Supervising Care Managers, CHWs, Owners, and Managers.
          </div>
          <div style={{ fontSize: 13, color: C.textTertiary }}>
            Current role: {role || "Unknown"}. Contact your practice owner if you believe this is incorrect.
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ padding: "16px 24px 0", borderBottom: "0.5px solid " + C.borderLight, background: C.bgPrimary }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: C.textPrimary, letterSpacing: "-0.01em" }}>
              Care Management
            </div>
            <div style={{ fontSize: 13, color: C.textSecondary, marginTop: 2 }}>
              {role === "CHW"
                ? "Your directed caseload and engagement touchpoints"
                : "Enrollments, touchpoints, plans, billing readiness, and PRL exchange"}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {visibleTabs.map(k => (
            <TabButton key={k} active={tab === k} onClick={() => setTab(k)}>
              <span style={{ marginRight: 6, opacity: 0.7 }}>{TAB_META[k].icon}</span>
              {TAB_META[k].label}
            </TabButton>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 24, background: C.bgTertiary }}>
        {tab === "registry"    && <RegistryTab />}
        {tab === "touchpoints" && <TouchpointsTab />}
        {tab === "plans"       && <PlansTab practiceId={profile?.practice_id} profile={profile} />}
        {tab === "billing"     && <BillingTab practiceId={profile?.practice_id} profile={profile} />}
        {tab === "chw"         && <CHWTab practiceId={profile?.practice_id} profile={profile} />}
        {tab === "prl"         && <PRLTab />}
        {tab === "hedis"       && <HEDISTab practiceId={profile?.practice_id} profile={profile} isAdmin={isAdmin} />}
      </div>
    </div>
  );
}

// --- Local Tab Button ---------------------------------------------------------
function TabButton({ active, children, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "10px 16px",
        fontSize: 13,
        fontWeight: 600,
        fontFamily: "inherit",
        border: "none",
        cursor: "pointer",
        background: "transparent",
        color: active ? C.teal : C.textSecondary,
        borderBottom: active ? "2px solid " + C.teal : "2px solid transparent",
        marginBottom: -1,
        transition: "color 0.15s, border-color 0.15s",
      }}
    >
      {children}
    </button>
  );
}
