import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { C } from "../lib/tokens";
import { Card, SectionHead } from "../components/ui";
import CHWTab from "./CHWTab";
import PRLTab from "./care-management/PRLTab";
import HEDISTab from "./care-management/HEDISTab";
import VBPContractsTab from "./care-management/VBPContractsTab";
import OutboundTab from "./care-management/OutboundTab";
import PlanConnectionsTab from "./care-management/PlanConnectionsTab";
import RegistryTab from "./care-management/RegistryTab";
import TouchpointsTab from "./care-management/TouchpointsTab";
import PlansTab from "./care-management/PlansTab";
import BillingTab from "./care-management/BillingTab";
import PlanAssignmentsTab from "./care-management/PlanAssignmentsTab";  
import AmhQualityDashboardTab from "./care-management/AmhQualityDashboardTab";
import ClaimsTab from "./care-management/claims/ClaimsTab";
import { supabase } from "../lib/supabaseClient";

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

const TAB_KEYS = ["registry", "touchpoints", "plans", "billing", "chw", "prl", "hedis", "claims", "vbp", "quality", "outbound", "connections", "assignments"];
const TAB_META = {
  registry:    { label: "Registry",           icon: "\u25A3" },
  touchpoints: { label: "Touchpoints",        icon: "\u25C9" },
  plans:       { label: "Plans",              icon: "\u25A4" },
  billing:     { label: "Billing Readiness",  icon: "\u25A5" },
  chw:         { label: "CHW Coordination",   icon: "\u25C8" },
  prl:         { label: "PRL",                icon: "\u25A6" },
  hedis:       { label: "HEDIS",              icon: "\u25A7" },
  claims:      { label: "Claims",             icon: "\u25C7" },
  vbp:         { label: "VBP Contracts",      icon: "\u25A8" },
  quality:     { label: "Quality Dashboard",  icon: "\u2605" },
  outbound:    { label: "Quality Submissions", icon: "\u25A9" },
  connections: { label: "Plan Connections",   icon: "\u25CE" },
  assignments: { label: "Plan Assignments",   icon: "\u25CA" },
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
  const location = useLocation();
  const role = profile?.role;
  const canAccess = role && (CM_ROLES.has(role) || role === "CHW");
  const isAdmin = role && ADMIN_ROLES.has(role);
  // Initial tab can be set by navigation state, e.g. when the VBP contract
  // form saves it sends users back here with state: { tab: "vbp" }. Falls
  // back to "registry" for direct visits or browser refresh.
  const [tab, setTab] = useState(location.state?.tab || "registry");
  // Drives the amber count badge on the Claims tab. Updated on mount and
  // again whenever ClaimsTab calls onUnmatchedChange after a match action.
  const [claimsUnmatchedCount, setClaimsUnmatchedCount] = useState(0);

  // Role-based tab visibility. Computed unconditionally (no hooks below this
  // point can be skipped by the early-return below).
  //   CHW:                              Registry + Touchpoints + CHW
  //   Clinical (CM / Supervising CM):   all clinical tabs, no PRL
  //   Admin (Owner / Manager):          all tabs including PRL
  // Admin tabs (PRL, VBP) are gated; clinical roles see only clinical tabs.
  const visibleTabs = role === "CHW"
    ? ["registry", "touchpoints", "chw"]
    : isAdmin
      ? TAB_KEYS
      : ["registry", "touchpoints", "plans", "billing", "chw", "hedis", "claims", "quality", "assignments"];
  // Keep tab valid for role. MUST run before any conditional return below,
  // or React's hook-ordering check will fire error #310 when auth loads
  // asynchronously (first render no role -> early return -> fewer hooks;
  // next render role loads -> more hooks -> crash).
  useEffect(() => {
    if (!visibleTabs.includes(tab)) setTab(visibleTabs[0]);
  }, [role]); // eslint-disable-line react-hooks/exhaustive-deps

  // Same-route deep-link tab routing. Cross-page navigations (e.g. the VBP
  // form save into /care-management) trigger a fresh mount, so the useState
  // initializer above already reads state.tab. But same-page navigations
  // (e.g. Quality Dashboard's "View open gaps" CTA -> navigate with state
  // tab: "hedis") do NOT remount this component, so the initializer is
  // stale. This effect picks up the new state.tab value and switches.
  useEffect(() => {
    const incomingTab = location.state?.tab;
    if (incomingTab && incomingTab !== tab && visibleTabs.includes(incomingTab)) {
      setTab(incomingTab);
    }
  }, [location.state?.tab]); // eslint-disable-line react-hooks/exhaustive-deps

  // One-time fetch so the Claims tab badge is correct on first paint.
  // ClaimsTab also calls setClaimsUnmatchedCount via onUnmatchedChange
  // after each refresh / match action, keeping the badge in sync.
  useEffect(() => {
    if (!profile?.practice_id) return;
    let cancelled = false;
    (async () => {
      try {
        const { count } = await supabase
          .from("cm_amh_claim_headers_unified")
          .select("id", { count: "exact", head: true })
          .eq("reconciliation_status", "Unmatched");
        if (!cancelled) setClaimsUnmatchedCount(count || 0);
      } catch (e) { /* badge silently stays at 0 if RLS denies or table missing */ }
    })();
    return () => { cancelled = true; };
  }, [profile?.practice_id]);

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
              {k === "claims" && claimsUnmatchedCount > 0 && (
                <span style={{
                  marginLeft: 6,
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "1px 7px",
                  borderRadius: 999,
                  background: "#FAEEDA",
                  color: "#854F0B",
                }}>
                  {claimsUnmatchedCount}
                </span>
              )}
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
        {tab === "vbp"         && <VBPContractsTab practiceId={profile?.practice_id} isAdmin={isAdmin} />}
        {tab === "outbound"    && <OutboundTab practiceId={profile?.practice_id} isAdmin={isAdmin} />}
        {tab === "connections" && <PlanConnectionsTab practiceId={profile?.practice_id} isAdmin={isAdmin} />}
        {/* Plan Assignments and Quality Dashboard are part of the AMH CM Add-On,    */}
        {/* NOT standard Command. TODO: gate visibility on practice_addons once      */}
        {/* amh_cm_* SKUs are seeded. For now the in-tab "Add-on" pill signals the   */}
        {/* positioning visually.                                                    */}
        {tab === "assignments" && <PlanAssignmentsTab practiceId={profile?.practice_id} currentUser={profile} />}
        {tab === "quality"     && <AmhQualityDashboardTab practiceId={profile?.practice_id} currentUser={profile} />}
        {tab === "claims"      && <ClaimsTab practiceId={profile?.practice_id} onUnmatchedChange={setClaimsUnmatchedCount} />}
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
