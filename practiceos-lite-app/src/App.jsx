// ═══════════════════════════════════════════════════════════════════════════════
// src/App.jsx
// Router entry point. All navigation is now URL-based via react-router-dom.
// Shell chrome lives in Layout.jsx; this file just wires routes to views.
// ═══════════════════════════════════════════════════════════════════════════════

import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import ProtectedRoute  from "./auth/ProtectedRoute";
import SuperAdminRoute from "./auth/SuperAdminRoute";
import ActivatePortal  from "./auth/ActivatePortal";
import Layout          from "./Layout";

// Views -----------------------------------------------------------------------
import DashboardView        from "./views/DashboardView";
import ScheduleView         from "./views/ScheduleView";
import PatientsView     from "./views/PatientsView";
import PatientChartPage from "./views/patient/PatientChartPage";
import QueueView            from "./views/QueueView";
import TasksView            from "./views/TasksView";
import ClinicalView         from "./views/ClinicalView";
import InboxView            from "./views/InboxView";
import StaffView            from "./views/StaffView";
import ReportsView          from "./views/ReportsView";
import SettingsView         from "./views/SettingsView";
import EligibilityView      from "./views/EligibilityView";
import WaitlistView         from "./views/WaitlistView";
import InsightsView         from "./views/InsightsView";
import ComplianceView       from "./views/ComplianceView";
import InsuranceUpdatesView from "./views/InsuranceUpdatesView";
import PortalView           from "./views/PortalView";

// Command tier views (tier + role gate is inside each view)
import CareManagementView   from "./views/CareManagementView";
import VBPContractFormPage  from "./views/care-management/VBPContractFormPage";

// Super admin (Administrator) section
import AdministratorView    from "./views/admin/AdministratorView";

// Pro tier views (tier gate is inside each view)
import ProAssistantView        from "./views/pro/AssistantView";
import ProOutreachReviewView   from "./views/pro/OutreachReviewView";
import ProInboundSMSReviewView from "./views/pro/InboundSMSReviewView";
import ProChartPrepView        from "./views/pro/ProChartPrepView";
import ProHRSNView             from "./views/pro/ProHRSNView";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public route: patient invite activation flow.
            Runs OUTSIDE ProtectedRoute so unauthenticated patients
            can land here from their invite email. */}
        <Route path="/activate" element={<ActivatePortal />} />

        {/* All other routes require auth, and render inside the Layout shell. */}
        <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          {/* Default landing: redirect root to dashboard. */}
          <Route index element={<Navigate to="/dashboard" replace />} />

          <Route path="/dashboard"         element={<DashboardView />} />
          <Route path="/schedule"          element={<ScheduleView />} />
          <Route path="/patients"          element={<PatientsView />} />
          {/* Patient chart - splat catches all tab sub-routes (info, appts,
              notes, hedis, plan, etc). Tab list lives in PatientChartPage's
              VALID_TABS constant; adding a new tab does NOT require editing
              this file. Unknown sub-paths fall through to PatientChartPage's
              own urlTab fallback (defaults to "info") rather than bouncing
              the user to /dashboard. */}
          <Route path="/patients/:id/*" element={<PatientChartPage />} />
          <Route path="/queue"             element={<QueueView />} />
          <Route path="/tasks"             element={<TasksView />} />
          <Route path="/clinical"          element={<ClinicalView />} />
          <Route path="/inbox"             element={<InboxView />} />
          <Route path="/staff"             element={<StaffView />} />
          <Route path="/reports"           element={<ReportsView />} />
          <Route path="/settings"          element={<SettingsView />} />
          <Route path="/eligibility"       element={<EligibilityView />} />
          <Route path="/waitlist"          element={<WaitlistView />} />
          <Route path="/insights"          element={<InsightsView />} />
          <Route path="/compliance"        element={<ComplianceView />} />
          <Route path="/insurance-updates" element={<InsuranceUpdatesView />} />
          <Route path="/portal"            element={<PortalView />} />

          {/* Pro tier */}
          <Route path="/pro/assistant"   element={<ProAssistantView />} />
          <Route path="/pro/outreach"    element={<ProOutreachReviewView />} />
          <Route path="/pro/inbound-sms" element={<ProInboundSMSReviewView />} />
          <Route path="/pro/chart-prep"  element={<ProChartPrepView />} />
          <Route path="/pro/hrsn"        element={<ProHRSNView />} />

          {/* Command tier */}
          <Route path="/care-management" element={<CareManagementView />} />
          {/* VBP contract form is full-page (not a sub-tab); list view lives
              inside CareManagementView's VBP Contracts tab. /new must precede
              /:id so the literal route wins over the param route. */}
          <Route path="/care-management/vbp-contracts/new" element={<VBPContractFormPage />} />
          <Route path="/care-management/vbp-contracts/:id" element={<VBPContractFormPage />} />

          {/* Super admin section. Splat catches sub-tabs (subscriptions, practices, health, flags, audit, settings).
              SuperAdminRoute redirects non-super-admins to /dashboard before AdministratorView mounts.
              Defense-in-depth: rail item is conditional (Layout), route is gated (here), and DB has RLS. */}
          <Route path="/admin/*" element={<SuperAdminRoute><AdministratorView /></SuperAdminRoute>} />

          {/* Any unknown protected URL falls back to dashboard. */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
