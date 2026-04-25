// ═══════════════════════════════════════════════════════════════════════════════
// src/views/patient/PatientChartPage.jsx
// Routed at /patients/:id/:tab? - full-page chart surface.
// Loads its own patient by :id param. Tab state lives in the URL (/screening,
// /insurance, etc) so deep-linking and browser back/forward work correctly.
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../auth/AuthProvider";
import { C } from "../../lib/tokens";
import { insertRow, updateRow, logRead } from "../../lib/db";
import { ageFromDOB, formatPhone, initialsOf, APPT_STATUS_VARIANT, NC_PAYERS } from "../../components/constants";
import { Badge, Btn, Card, Modal, Input, Select, TabBar, FL, Avatar, SectionHead, Loader, ErrorBanner, EmptyState } from "../../components/ui";
import InvitePatientModal from "../InvitePatientModal";
import AssignFormsModal from "../AssignFormsModal";
import GrantFamilyAccessModal from "../GrantFamilyAccessModal";
import StartScreeningModal from "../../components/hrsn/StartScreeningModal";
import TrendsTab from "./TrendsTab";
import MedicationsTab from "./MedicationsTab";

// ─── Constants ───────────────────────────────────────────────────────────────
const HRSN_DOMAIN_KEYS = [
  { key: "food_insecurity",      label: "Food" },
  { key: "housing_instability",  label: "Housing" },
  { key: "housing_quality",      label: "Housing qual." },
  { key: "transportation",       label: "Transport" },
  { key: "utilities",            label: "Utilities" },
  { key: "interpersonal_safety", label: "Safety" },
];

const SCREENER_SEVERITY_COLORS = {
  "Minimal": C.green, "Mild": C.blue, "Moderate": C.amber,
  "Moderately Severe": "#f59e0b", "Severe": C.red,
  "Low Risk": C.green, "Moderate Risk": C.amber, "High Risk": C.red,
};

const VALID_TABS = ["info", "appts", "notes", "trends", "meds", "screening", "clinical", "insurance"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ═══════════════════════════════════════════════════════════════════════════════
// PatientChartPage
// ═══════════════════════════════════════════════════════════════════════════════
export default function PatientChartPage() {
  const { id: patientId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { profile, practiceId, tier } = useAuth();
  const isProTier = ["Pro", "Command"].includes(tier);

  // Derive current tab from URL. /patients/:id -> default to 'info'.
  // /patients/:id/screening -> 'screening'. Invalid segment falls back to 'info'.
  const urlTab = location.pathname.split("/")[3] || "info";
  const tab = VALID_TABS.includes(urlTab) ? urlTab : "info";
  // Preserve location.state across tab changes so the Back button's returnTo
  // survives when the user clicks through multiple tabs.
  const setTab = (t) => navigate(`/patients/${patientId}/${t}`, { state: location.state });

  const [patient, setPatient] = useState(null);
  const [loadingPatient, setLoadingPatient] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [appts, setAppts] = useState([]);
  const [encounters, setEncounters] = useState([]);
  const [insurance, setInsurance] = useState([]);
  const [screeners, setScreeners] = useState([]);
  // Care Management enrollments + reference labels for the chart strip.
  // Loaded alongside the patient so the strip renders on first paint.
  const [enrollments, setEnrollments] = useState([]);
  const [popLabels, setPopLabels] = useState({});
  const [editing, setEditing] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showAssignForms, setShowAssignForms] = useState(false);
  const [showGrantAccess, setShowGrantAccess] = useState(false);
  const [showStartScreening, setShowStartScreening] = useState(false);

  // Back navigation: use the explicit returnTo stamped on location.state by
  // whichever view sent us here (PatientsView, DashboardView, ScheduleView,
  // etc). Deep-link entries don't have state, so fall back to /patients.
  // Reliable under auth redirects, unlike useNavigationType (which gets
  // clobbered by post-login navigate() calls).
  const handleBack = () => {
    const returnTo = location.state?.returnTo;
    if (returnTo) {
      navigate(returnTo);
    } else {
      navigate("/patients");
    }
  };

  // Load the patient when the URL :id changes.
  useEffect(() => {
    if (!patientId || !practiceId) return;
    // Short-circuit on malformed UUIDs to avoid raw Postgres "invalid input
    // syntax" errors. Treated the same as not-found.
    if (!UUID_RE.test(patientId)) {
      setPatient(null);
      setLoadError(null);
      setLoadingPatient(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setLoadingPatient(true);
        setLoadError(null);
        const { data, error } = await supabase
          .from("patients")
          .select("*, pcp:providers!patients_pcp_provider_id_fkey(first_name, last_name)")
          .eq("id", patientId)
          .single();
        if (error) throw error;
        if (cancelled) return;
        await logRead("patients", patientId, patientId);
        setPatient(data);
      } catch (e) {
        if (!cancelled) setLoadError(e.message);
      } finally {
        if (!cancelled) setLoadingPatient(false);
      }
    })();
    return () => { cancelled = true; };
  }, [patientId, practiceId]);

  // Load related data once patient is loaded.
  const reload = async () => {
    if (!patientId) return;
    const [a, e, i, s, enr] = await Promise.all([
      supabase.from("appointments").select("id, appt_date, start_slot, appt_type, status, providers(last_name)").eq("patient_id", patientId).order("appt_date", { ascending: false }).limit(30),
      supabase.from("encounters").select("id, encounter_date, status, appt_type, chief_complaint, assessment, provider_id, providers(first_name, last_name)").eq("patient_id", patientId).order("encounter_date", { ascending: false }).limit(20),
      supabase.from("insurance_policies").select("*").eq("patient_id", patientId).order("rank"),
      supabase.from("screener_responses").select("*").eq("patient_id", patientId).order("completed_at", { ascending: false }).limit(20),
      supabase.from("cm_enrollments")
        .select("id, program_type, health_plan_type, cm_provider_type, acuity_tier, enrollment_status, payer_name, hop_active, priority_populations, php_risk_score_category, php_risk_evidence, population_segment, waiver_service, tcl_member_status, plan_unable_to_reach, prl_last_synced_at")
        .eq("patient_id", patientId)
        .neq("enrollment_status", "Disenrolled")
        .order("enrolled_at", { ascending: false }),
    ]);
    setAppts(a.data || []);
    setEncounters(e.data || []);
    setInsurance(i.data || []);
    setScreeners(s.data || []);
    setEnrollments(enr.data || []);
  };
  useEffect(() => { if (patient) reload(); }, [patient?.id]);

  // Load priority population labels once. Small static set; cached in state
  // so the strip can render "CMARC" not "001".
  useEffect(() => {
    supabase
      .from("cm_reference_codes")
      .select("code, label")
      .eq("category", "priority_population")
      .eq("is_active", true)
      .then(({ data }) => {
        const m = {};
        for (const r of data || []) m[r.code] = r.label;
        setPopLabels(m);
      });
  }, []);

  const onUpdate = (u) => { setPatient((prev) => ({ ...prev, ...u })); };

  // ── Loading / error states ──────────────────────────────────────────────────
  if (loadingPatient) {
    return (
      <div style={{ padding: 40, display: "flex", justifyContent: "center" }}>
        <Loader />
      </div>
    );
  }
  if (loadError) {
    return (
      <div style={{ padding: 24 }}>
        <ErrorBanner message={loadError} />
        <div style={{ marginTop: 16 }}>
          <Btn variant="outline" onClick={handleBack}>← Back</Btn>
        </div>
      </div>
    );
  }
  if (!patient) {
    return (
      <div style={{ padding: 24 }}>
        <EmptyState icon="👤" title="Patient not found" sub="This record may have been removed or you don't have access." />
        <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
          <Btn variant="outline" onClick={handleBack}>← Back</Btn>
        </div>
      </div>
    );
  }

  const hrsnScreeners = screeners.filter((s) => s.screener_type === "HRSN");
  const latestHrsn = hrsnScreeners[0];
  const mentalHealthScreeners = screeners.filter((s) => ["PHQ-9", "PHQ-2", "GAD-7", "AUDIT-C"].includes(s.screener_type));

  return (
    <div style={{ padding: "20px 24px", maxWidth: 1280, margin: "0 auto", width: "100%" }}>
      {/* Back link - stays on grey page background */}
      <div style={{ marginBottom: 14 }}>
        <Btn variant="ghost" size="sm" onClick={handleBack}>← Back</Btn>
      </div>

      {/* White chart surface - gives inner borders + grey panels contrast against the grey page.
          Before this, the chart lived inside a <Modal> which supplied the white bg. */}
      <div style={{
        background: "#fff",
        borderRadius: 12,
        border: `0.5px solid ${C.borderLight}`,
        padding: "24px 28px",
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
      }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <Avatar initials={initialsOf(patient.first_name, patient.last_name)} size={48} color={C.tealMid} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{patient.first_name} {patient.last_name}</div>
          <div style={{ fontSize: 12, color: C.textSecondary }}>
            DOB {patient.date_of_birth} ({ageFromDOB(patient.date_of_birth)} y/o {patient.gender}) · MRN {patient.mrn || "—"}
          </div>
        </div>
        <Badge label={patient.status} variant={patient.status === "Active" ? "green" : "neutral"} />
      </div>

      {enrollments.length > 0 && (
        <CareManagementStrip enrollments={enrollments} popLabels={popLabels} />
      )}

      <div style={{ marginBottom: 16 }}>
        <TabBar
          tabs={[
            ["info", "Info"],
            ["appts", `Appts (${appts.length})`],
            ["notes", `Notes (${encounters.length})`],
            ["trends", "Trends"],
            ["meds", "Medications"],
            ["screening", `Screenings (${hrsnScreeners.length + mentalHealthScreeners.length})`],
            ["clinical", "Clinical"],
            ["insurance", `Insurance (${insurance.length})`],
          ]}
          active={tab} onChange={setTab} />
      </div>

      {tab === "info" && (
        editing
          ? <PatientEditForm patient={patient} onSave={async (patch) => {
              try {
                const u = await updateRow("patients", patient.id, patch,
                  { audit: { entityType: "patients", patientId: patient.id, details: { fields: Object.keys(patch) } } });
                onUpdate(u); setEditing(false);
              } catch (e) { alert(e.message); }
            }} onCancel={() => setEditing(false)} />
          : (
            <div>
              {isProTier && (
                <HRSNSummaryWidget
                  latest={latestHrsn}
                  count={hrsnScreeners.length}
                  onOpenScreeningsTab={() => setTab("screening")}
                />
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <Field label="Mobile Phone" value={formatPhone(patient.phone_mobile)} />
                <Field label="Email" value={patient.email} />
                <Field label="Preferred Language" value={patient.preferred_language} />
                <Field label="Pronouns" value={patient.pronouns} />
                <Field label="Address" value={[patient.address_line1, patient.city, patient.state, patient.zip].filter(Boolean).join(", ")} span={2} />
                <Field label="County" value={patient.county} />
                <Field label="Interpreter Needed" value={patient.interpreter_needed ? "Yes" : "No"} />
                <Field label="Emergency Contact" value={patient.emergency_contact_name} />
                <Field label="Emergency Phone" value={formatPhone(patient.emergency_contact_phone)} />
                <Field label="SMS Opt-Out" value={patient.sms_opt_out ? "Yes" : "No"} />
                <Field label="Portal Enabled" value={patient.portal_enabled ? "Yes" : "No"} />
                <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                  <Btn variant="outline" onClick={() => setShowGrantAccess(true)}>Grant family access</Btn>
                  <Btn variant="outline" onClick={() => setShowAssignForms(true)}>Assign forms</Btn>
                  <Btn variant="outline" onClick={() => setShowInvite(true)}>Invite to portal</Btn>
                  {isProTier && (
                    <Btn variant="outline" onClick={() => setShowStartScreening(true)}>Start HRSN screening</Btn>
                  )}
                  <Btn variant="outline" onClick={() => setEditing(true)}>Edit patient</Btn>
                </div>
              </div>
            </div>
          )
      )}

      {tab === "appts" && (
        appts.length === 0 ? <EmptyState icon="📅" title="No appointment history" />
        : <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {appts.map((a) => (
            <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 10px", border: `0.5px solid ${C.borderLight}`, borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: C.textSecondary, minWidth: 100 }}>{a.appt_date}</div>
              <div style={{ flex: 1, fontSize: 12 }}>{a.appt_type}{a.providers && ` · Dr. ${a.providers.last_name}`}</div>
              <Badge label={a.status} variant={APPT_STATUS_VARIANT[a.status] || "neutral"} size="xs" />
            </div>
          ))}
        </div>
      )}

      {tab === "notes" && (
        encounters.length === 0 ? <EmptyState icon="📝" title="No clinical notes" />
        : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {encounters.map((e) => (
            <Card key={e.id} style={{ padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>{e.encounter_date} · {e.appt_type}</div>
                <Badge label={e.status} variant={e.status === "Signed" ? "green" : e.status === "Amended" ? "amber" : "neutral"} size="xs" />
              </div>
              {e.chief_complaint && <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 4 }}><b>CC:</b> {e.chief_complaint}</div>}
              {e.assessment && <div style={{ fontSize: 12, color: C.textSecondary }}><b>A:</b> {e.assessment.slice(0, 180)}{e.assessment.length > 180 ? "…" : ""}</div>}
              {e.providers && <div style={{ fontSize: 10, color: C.textTertiary, marginTop: 6 }}>Dr. {e.providers.first_name} {e.providers.last_name}</div>}
            </Card>
          ))}
        </div>
      )}

      {tab === "clinical" && (
        <div>
          <SectionHead title="Allergies" />
          <div style={{ marginBottom: 16, display: "flex", flexWrap: "wrap", gap: 6 }}>
            {(patient.allergies || []).length === 0 ? <div style={{ fontSize: 12, color: C.textTertiary }}>None on file</div>
              : (patient.allergies || []).map((a, i) => {
                  // Supports string entries, legacy {substance, name} shapes, and the
                  // current {allergen, reaction, severity} shape. Render reaction/severity
                  // inline so provider sees the clinically-relevant detail at a glance.
                  const label = typeof a === "string"
                    ? a
                    : (a.allergen || a.substance || a.name || "Unknown allergen");
                  const detail = typeof a === "object"
                    ? [a.reaction, a.severity].filter(Boolean).join(" - ")
                    : "";
                  return (
                    <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <Badge label={label} variant="red" />
                      {detail && <span style={{ fontSize: 11, color: C.textSecondary }}>{detail}</span>}
                    </span>
                  );
                })}
          </div>
          <SectionHead title="Active Medications" />
          <div style={{ marginBottom: 16 }}>
            {(patient.medications || []).length === 0 ? <div style={{ fontSize: 12, color: C.textTertiary }}>None on file</div>
              : (patient.medications || []).map((m, i) => {
                  const name  = typeof m === "string" ? m : (m.name || m.drug || m.medication || "Unknown medication");
                  const dose  = typeof m === "object" ? (m.dose || m.dosage || "") : "";
                  const freq  = typeof m === "object" ? (m.frequency || m.freq || "") : "";
                  const route = typeof m === "object" ? (m.route || "") : "";
                  return (
                    <div key={i} style={{ padding: "6px 10px", border: `0.5px solid ${C.borderLight}`, borderRadius: 6, marginBottom: 4, fontSize: 12 }}>
                      {[name, dose, route, freq].filter(Boolean).join(" ")}
                    </div>
                  );
                })}
          </div>
          <SectionHead title="Problem List" />
          <div>
            {(patient.problem_list || []).length === 0 ? <div style={{ fontSize: 12, color: C.textTertiary }}>None on file</div>
              : (patient.problem_list || []).map((pr, i) => {
                  if (typeof pr === "string") {
                    return (
                      <div key={i} style={{ padding: "6px 10px", border: `0.5px solid ${C.borderLight}`, borderRadius: 6, marginBottom: 4, fontSize: 12 }}>
                        {pr}
                      </div>
                    );
                  }
                  const code = pr.code || pr.icd10 || "";
                  const desc = pr.description || pr.name || pr.condition || "Unknown condition";
                  return (
                    <div key={i} style={{ padding: "6px 10px", border: `0.5px solid ${C.borderLight}`, borderRadius: 6, marginBottom: 4, fontSize: 12 }}>
                      {code ? `${code} - ${desc}` : desc}
                    </div>
                  );
                })}
          </div>
        </div>
      )}

      {tab === "insurance" && (
        <InsuranceTab patient={patient} insurance={insurance} practiceId={practiceId} onReload={reload} />
      )}

      {tab === "screening" && (
        <ScreeningsTab
          hrsnScreeners={hrsnScreeners}
          mental={mentalHealthScreeners}
          isProTier={isProTier}
          onStartScreening={() => setShowStartScreening(true)}
        />
      )}
      {tab === "trends" && <TrendsTab patient={patient} />}
      {tab === "meds" && <MedicationsTab patient={patient} />}
      </div>
      {/* end white chart surface */}

      {showInvite && (
        <InvitePatientModal
          patient={patient}
          practiceId={practiceId}
          onClose={() => setShowInvite(false)}
        />
      )}
      {showAssignForms && (
        <AssignFormsModal
          patient={patient}
          practiceId={practiceId}
          onClose={() => setShowAssignForms(false)}
        />
      )}
      {showGrantAccess && (
        <GrantFamilyAccessModal
          patient={patient}
          onClose={() => setShowGrantAccess(false)}
        />
      )}
      {showStartScreening && (
        <StartScreeningModal
          practiceId={practiceId}
          currentUser={profile}
          initialPatient={patient}
          onClose={() => setShowStartScreening(false)}
          onSubmitted={() => { reload(); }}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Screenings tab
// ═══════════════════════════════════════════════════════════════════════════════
function ScreeningsTab({ hrsnScreeners, mental, isProTier, onStartScreening }) {
  if (hrsnScreeners.length === 0 && mental.length === 0) {
    return (
      <div>
        <EmptyState icon="📋" title="No screeners on file" sub="HRSN / PHQ-9 / GAD-7 / AUDIT-C screeners will appear here once completed." />
        {isProTier && (
          <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
            <Btn onClick={onStartScreening}>Start HRSN screening</Btn>
          </div>
        )}
      </div>
    );
  }

  const mostRecentHrsn = hrsnScreeners[0];

  return (
    <div>
      {hrsnScreeners.length > 0 && (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <SectionHead
              title="HRSN (Health-Related Social Needs)"
              sub={hrsnScreeners.length > 1
                ? `${hrsnScreeners.length} screenings on file - most recent ${new Date(mostRecentHrsn.completed_at).toLocaleDateString()}`
                : `Completed ${new Date(mostRecentHrsn.completed_at).toLocaleDateString()}`}
            />
            {isProTier && (
              <Btn size="sm" onClick={onStartScreening}>+ New screening</Btn>
            )}
          </div>

          {isProTier && hrsnScreeners.length >= 2 && (
            <HRSNLongitudinalTable screenings={hrsnScreeners.slice(0, 3)} />
          )}

          <HRSNScreeningCard screening={mostRecentHrsn} isLatest={true} />

          {hrsnScreeners.length > 1 && (
            <details style={{ marginTop: 10 }}>
              <summary style={{
                cursor: "pointer", fontSize: 12, fontWeight: 600, color: C.textSecondary,
                padding: "8px 4px",
              }}>
                Show {hrsnScreeners.length - 1} older screening{hrsnScreeners.length - 1 === 1 ? "" : "s"}
              </summary>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                {hrsnScreeners.slice(1).map((s) => (
                  <HRSNScreeningCard key={s.id} screening={s} isLatest={false} />
                ))}
              </div>
            </details>
          )}
        </>
      )}

      {mental.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <SectionHead title="Mental Health Screeners" />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {mental.map((s) => (
              <Card key={s.id} style={{ padding: 12, borderLeft: `3px solid ${SCREENER_SEVERITY_COLORS[s.severity] || C.textSecondary}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{s.screener_type}</div>
                  <Badge label={`Score: ${s.total_score ?? "—"}`} variant="teal" size="xs" />
                  {s.severity && <Badge label={s.severity} variant={s.severity === "Severe" || s.severity === "Moderately Severe" ? "red" : s.severity === "Moderate" ? "amber" : "neutral"} size="xs" />}
                  {s.requires_followup && <Badge label="Follow-up" variant="amber" size="xs" />}
                  <div style={{ marginLeft: "auto", fontSize: 11, color: C.textTertiary }}>{new Date(s.completed_at).toLocaleDateString()}</div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// HRSN summary widget
// ═══════════════════════════════════════════════════════════════════════════════
function HRSNSummaryWidget({ latest, count, onOpenScreeningsTab }) {
  if (!latest) {
    return (
      <div style={{
        background: C.bgSecondary, border: `0.5px solid ${C.borderLight}`,
        borderRadius: 8, padding: "10px 14px", marginBottom: 14,
        display: "flex", alignItems: "center", gap: 12,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.textPrimary, marginBottom: 2 }}>
            Social Needs (HRSN)
          </div>
          <div style={{ fontSize: 11, color: C.textSecondary }}>
            No HRSN screenings on file for this patient.
          </div>
        </div>
        <Btn size="sm" variant="ghost" onClick={onOpenScreeningsTab}>View</Btn>
      </div>
    );
  }

  const summary = latest.ai_summary || {};
  const domains = summary.domains || {};
  const positiveDomains = Object.keys(domains).filter(k => domains[k] && domains[k].status === "positive");
  const hasUrgent = !!summary.urgent_safety_alert;
  const when = new Date(latest.completed_at).toLocaleDateString();

  return (
    <div style={{
      background: hasUrgent ? "#FEE2E2" : C.bgSecondary,
      border: `0.5px solid ${hasUrgent ? "#DC2626" : C.borderLight}`,
      borderRadius: 8, padding: "10px 14px", marginBottom: 14,
      display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
    }}>
      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.textPrimary }}>
            Social Needs (HRSN)
          </div>
          {hasUrgent && (
            <span style={{
              background: "#DC2626", color: "#fff",
              fontSize: 9, fontWeight: 700, letterSpacing: "0.05em",
              padding: "2px 7px", borderRadius: 3, textTransform: "uppercase",
            }}>
              Urgent alert
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: C.textSecondary, marginBottom: 6 }}>
          Last screened {when}
          {count > 1 ? ` · ${count} on file` : ""}
        </div>
        {positiveDomains.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {positiveDomains.map(d => {
              const meta = HRSN_DOMAIN_KEYS.find(k => k.key === d);
              return (
                <span key={d} style={{
                  background: "#FEF3C7", color: "#92400E",
                  fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 10,
                }}>
                  {meta ? meta.label : d}
                </span>
              );
            })}
          </div>
        ) : (
          <div style={{ fontSize: 11, color: C.textTertiary, fontStyle: "italic" }}>
            No positive screens
          </div>
        )}
      </div>
      <Btn size="sm" onClick={onOpenScreeningsTab}>View screenings</Btn>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// HRSN longitudinal table + pills
// ═══════════════════════════════════════════════════════════════════════════════
function HRSNLongitudinalTable({ screenings }) {
  return (
    <div style={{
      marginBottom: 14,
      border: `0.5px solid ${C.borderLight}`,
      borderRadius: 8, overflow: "hidden",
    }}>
      <div style={{
        padding: "8px 12px", background: C.bgSecondary,
        fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
        color: C.textSecondary, textTransform: "uppercase",
      }}>
        Domain trend - last {screenings.length} screenings
      </div>
      <div style={{
        display: "grid",
        gridTemplateColumns: `140px repeat(${screenings.length}, 1fr)`,
        fontSize: 11,
      }}>
        <div style={{ padding: "8px 12px", background: C.bgSecondary, borderTop: `0.5px solid ${C.borderLight}`, fontWeight: 600, color: C.textSecondary }}>
          Domain
        </div>
        {screenings.map((s) => (
          <div key={s.id} style={{ padding: "8px 12px", background: C.bgSecondary, borderTop: `0.5px solid ${C.borderLight}`, fontWeight: 600, color: C.textSecondary }}>
            {new Date(s.completed_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" })}
          </div>
        ))}

        {HRSN_DOMAIN_KEYS.map((d) => (
          <DomainTrendRow key={d.key} domain={d} screenings={screenings} />
        ))}
      </div>
    </div>
  );
}

function DomainTrendRow({ domain, screenings }) {
  return (
    <>
      <div style={{ padding: "7px 12px", borderTop: `0.5px solid ${C.borderLight}`, color: C.textPrimary, fontWeight: 500 }}>
        {domain.label}
      </div>
      {screenings.map((s) => {
        const d = (s.ai_summary && s.ai_summary.domains && s.ai_summary.domains[domain.key]) || null;
        const status = d ? d.status : null;
        return (
          <div key={s.id} style={{ padding: "7px 12px", borderTop: `0.5px solid ${C.borderLight}` }}>
            <DomainStatusPill status={status} severity={d ? d.severity : null} />
          </div>
        );
      })}
    </>
  );
}

function DomainStatusPill({ status, severity }) {
  if (!status) {
    return <span style={{ fontSize: 10, color: C.textTertiary }}>—</span>;
  }
  if (status === "positive") {
    return (
      <span style={{
        background: "#FEF3C7", color: "#92400E",
        fontSize: 9, fontWeight: 700, letterSpacing: "0.05em",
        padding: "2px 7px", borderRadius: 3, textTransform: "uppercase",
      }}>
        Pos{severity ? ` · ${severity}` : ""}
      </span>
    );
  }
  if (status === "partial") {
    return (
      <span style={{
        background: "#E0F2FE", color: "#075985",
        fontSize: 9, fontWeight: 700, letterSpacing: "0.05em",
        padding: "2px 7px", borderRadius: 3, textTransform: "uppercase",
      }}>
        Partial
      </span>
    );
  }
  return (
    <span style={{ fontSize: 10, color: C.textTertiary }}>Neg</span>
  );
}

function HRSNScreeningCard({ screening, isLatest }) {
  const summary = screening.ai_summary || {};
  const domains = summary.domains || {};
  const positive = Object.keys(domains).filter(k => domains[k] && domains[k].status === "positive");
  const hasUrgent = !!summary.urgent_safety_alert;
  const aiReady = screening.ai_summary_status === "Success";

  return (
    <Card style={{
      marginBottom: 10,
      borderLeft: hasUrgent
        ? `4px solid #DC2626`
        : positive.length > 0
          ? `4px solid #D97706`
          : `4px solid ${C.tealMid}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
        {isLatest && <Badge label="Latest" variant="teal" size="xs" />}
        <div style={{ fontSize: 12, fontWeight: 600, color: C.textPrimary }}>
          {new Date(screening.completed_at).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
        </div>
        {hasUrgent && <Badge label="Urgent alert" variant="red" size="xs" />}
        {positive.map(p => {
          const meta = HRSN_DOMAIN_KEYS.find(k => k.key === p);
          return <Badge key={p} label={meta ? meta.label : p} variant="amber" size="xs" />;
        })}
        <div style={{ marginLeft: "auto", fontSize: 10, color: C.textTertiary }}>
          {screening.completion_mode || screening.administered_via || "—"}
        </div>
      </div>

      {aiReady && summary.summary_paragraph && (
        <div style={{ fontSize: 12, color: C.textPrimary, lineHeight: 1.55, marginBottom: 8 }}>
          {summary.summary_paragraph}
        </div>
      )}

      {!aiReady && screening.ai_summary_status && (
        <div style={{ fontSize: 11, color: C.textTertiary, fontStyle: "italic" }}>
          AI summary: {screening.ai_summary_status}
        </div>
      )}

      {summary.suggested_cadence && summary.suggested_cadence.months && (
        <div style={{ fontSize: 11, color: C.textSecondary, marginTop: 6 }}>
          <span style={{ fontWeight: 700 }}>Suggested cadence:</span> {summary.suggested_cadence.months} months
        </div>
      )}
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Insurance tab
// ═══════════════════════════════════════════════════════════════════════════════
function InsuranceTab({ patient, insurance, practiceId, onReload }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);

  const deactivate = async (id) => {
    if (!confirm("Remove this insurance policy?")) return;
    try {
      await updateRow("insurance_policies", id, { is_active: false },
        { audit: { entityType: "insurance_policies", patientId: patient.id } });
      onReload();
    } catch (e) { alert(e.message); }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <SectionHead title="Insurance Policies" />
        <Btn size="sm" onClick={() => setAdding(true)}>+ Add Policy</Btn>
      </div>
      {insurance.length === 0 ? <EmptyState icon="💳" title="No insurance on file" />
        : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {insurance.map((p) => (
            <Card key={p.id} style={{ padding: 12, opacity: p.is_active ? 1 : 0.55 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{p.payer_name}</div>
                    <Badge label={`Rank ${p.rank}`} variant="teal" size="xs" />
                    {!p.is_active && <Badge label="Inactive" variant="neutral" size="xs" />}
                  </div>
                  <div style={{ fontSize: 11, color: C.textTertiary, marginBottom: 4 }}>{p.payer_category}</div>
                  <div style={{ fontSize: 12, color: C.textSecondary }}>
                    Member ID: <code>{p.member_id}</code>{p.group_number && ` · Group: ${p.group_number}`}
                  </div>
                  {p.copay_primary != null && <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 4 }}>Copay: ${p.copay_primary}</div>}
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  <Btn size="sm" variant="outline" onClick={() => setEditing(p)}>Edit</Btn>
                  {p.is_active && <Btn size="sm" variant="ghost" onClick={() => deactivate(p.id)}>Remove</Btn>}
                </div>
              </div>
            </Card>
          ))}
        </div>}

      {(adding || editing) && <InsuranceFormModal
        initial={editing || { rank: (insurance.length + 1), is_active: true }}
        patientId={patient.id} practiceId={practiceId}
        onClose={() => { setAdding(false); setEditing(null); }}
        onSaved={() => { setAdding(false); setEditing(null); onReload(); }} />}
    </div>
  );
}

function InsuranceFormModal({ initial, patientId, practiceId, onClose, onSaved }) {
  const [f, setF] = useState(initial);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));

  const handlePayerSelect = (payerName) => {
    const group = NC_PAYERS.find((g) => g.options.includes(payerName));
    setF((p) => ({ ...p, payer_name: payerName, payer_category: group?.category || "Other" }));
  };

  const save = async () => {
    if (!f.payer_name || !f.member_id) { alert("Payer and Member ID are required"); return; }
    try {
      const payload = {
        patient_id: patientId,
        payer_name: f.payer_name,
        payer_category: f.payer_category,
        member_id: f.member_id,
        group_number: f.group_number || null,
        rank: parseInt(f.rank) || 1,
        copay_primary: f.copay_primary != null && f.copay_primary !== "" ? parseFloat(f.copay_primary) : null,
        is_active: f.is_active !== false,
        effective_date: f.effective_date || null,
        termination_date: f.termination_date || null,
      };
      if (f.id) {
        await updateRow("insurance_policies", f.id, payload,
          { audit: { entityType: "insurance_policies", patientId } });
      } else {
        await insertRow("insurance_policies", payload, practiceId,
          { audit: { entityType: "insurance_policies", patientId } });
      }
      onSaved();
    } catch (e) { alert(e.message); }
  };

  return (
    <Modal title={f.id ? "Edit Insurance" : "Add Insurance"} onClose={onClose} maxWidth={520}>
      <FL>Payer *</FL>
      <select
        value={f.payer_name || ""}
        onChange={(e) => handlePayerSelect(e.target.value)}
        style={{ width: "100%", padding: "9px 12px", border: `1px solid ${C.borderMid}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", marginBottom: 14 }}
      >
        <option value="">Select payer...</option>
        {NC_PAYERS.map((group) => (
          <optgroup key={group.group} label={group.group}>
            {group.options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          </optgroup>
        ))}
      </select>

      {f.payer_category && (
        <div style={{ marginTop: -8, marginBottom: 14 }}>
          <Badge label={f.payer_category} variant="teal" size="xs" />
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
        <Input label="Member ID *" value={f.member_id} onChange={set("member_id")} />
        <Input label="Rank" type="number" value={f.rank} onChange={set("rank")} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Input label="Group Number" value={f.group_number} onChange={set("group_number")} />
        <Input label="Copay" type="number" value={f.copay_primary} onChange={set("copay_primary")} placeholder="0.00" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Input label="Effective Date" type="date" value={f.effective_date} onChange={set("effective_date")} />
        <Input label="Termination Date" type="date" value={f.termination_date} onChange={set("termination_date")} />
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        <Btn onClick={save}>{f.id ? "Save" : "Add Policy"}</Btn>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Edit form + Field helper
// ═══════════════════════════════════════════════════════════════════════════════
const GENDERS = ["Male", "Female", "Non-Binary", "Other", "Unknown"];

const Field = ({ label, value, span = 1 }) => (
  <div style={{ gridColumn: `span ${span}` }}>
    <FL>{label}</FL>
    <div style={{ fontSize: 13, color: value ? C.textPrimary : C.textTertiary }}>{value || "—"}</div>
  </div>
);

// ═══════════════════════════════════════════════════════════════════════════════
// CareManagementStrip - compact provider-facing summary of the patient's
// active CM enrollments. Renders above the chart tabs so providers see CM
// context on every tab open.
//
// Layout:
//   - One-line summary always visible: program + acuity + plan-risk pill +
//     priority population pills + HOP/UTR flags + "Open in CM" link
//   - "More" toggle reveals plan perspective panel: PRL sync date, plan UTR,
//     plan risk evidence, population segment, waiver, plus per-enrollment
//     drilldown if there's more than one active.
//
// Hidden when patient has no Active/Pending enrollments (caller-side guard).
// ═══════════════════════════════════════════════════════════════════════════════
function CareManagementStrip({ enrollments, popLabels }) {
  const [expanded, setExpanded] = useState(false);

  // Pick the primary enrollment by status rank (Active > Pending > On Hold).
  // Show others below in expanded view if any.
  const STATUS_RANK = { Active: 3, Pending: 2, "On Hold": 1 };
  const ranked = [...enrollments].sort(
    (a, b) => (STATUS_RANK[b.enrollment_status] || 0) - (STATUS_RANK[a.enrollment_status] || 0)
  );
  const primary = ranked[0];
  const others = ranked.slice(1);

  return (
    <div style={{
      marginBottom: 14,
      border: `0.5px solid ${C.borderLight}`,
      borderRadius: 8,
      background: "#FAFAFA",
      overflow: "hidden",
    }}>
      <CareManagementStripRow enrollment={primary} popLabels={popLabels} isPrimary={true} />

      {expanded && (
        <CareManagementStripDetail enrollment={primary} popLabels={popLabels} />
      )}

      {expanded && others.map(e => (
        <div key={e.id} style={{ borderTop: `0.5px solid ${C.borderLight}` }}>
          <CareManagementStripRow enrollment={e} popLabels={popLabels} isPrimary={false} />
          <CareManagementStripDetail enrollment={e} popLabels={popLabels} />
        </div>
      ))}

      <div style={{
        borderTop: `0.5px solid ${C.borderLight}`,
        padding: "4px 12px",
        textAlign: "center",
      }}>
        <button
          onClick={() => setExpanded(v => !v)}
          style={{
            background: "transparent",
            border: "none",
            fontSize: 11,
            fontWeight: 600,
            color: C.textSecondary,
            cursor: "pointer",
            padding: "2px 8px",
            fontFamily: "inherit",
          }}
        >
          {expanded
            ? "Collapse"
            : (others.length > 0 ? `More (${others.length + 1} enrollments)` : "More plan detail")}
        </button>
      </div>
    </div>
  );
}

// One-line summary row for a single enrollment. Used both for the primary
// (always shown) and any additional active enrollments (shown when expanded).
// ASCII-only: no middle dots, em dashes, or arrows. The Chromebook + GitHub
// web editor paste path mangles non-ASCII characters and breaks esbuild.
function CareManagementStripRow({ enrollment, popLabels, isPrimary }) {
  const e = enrollment;
  const planRiskMap = {
    H: { label: "Plan risk: High",     color: C.red,           bg: "#FEE2E2" },
    M: { label: "Plan risk: Moderate", color: "#854F0B",       bg: "#FEF3C7" },
    L: { label: "Plan risk: Low",      color: C.textSecondary, bg: C.bgSecondary },
    N: { label: "Plan risk: Unscored", color: C.textTertiary,  bg: C.bgSecondary },
  };
  const planRisk = e.php_risk_score_category ? planRiskMap[e.php_risk_score_category] : null;

  const acuityColor = e.acuity_tier === "High" ? C.red
                    : e.acuity_tier === "Moderate" ? "#854F0B"
                    : e.acuity_tier === "Low" ? C.textSecondary
                    : C.textTertiary;

  const populations = Array.isArray(e.priority_populations) ? e.priority_populations : [];

  return (
    <div style={{
      padding: "10px 14px",
      display: "flex",
      alignItems: "center",
      gap: 10,
      flexWrap: "wrap",
    }}>
      <span style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: C.teal,
        background: C.tealBg,
        padding: "3px 8px",
        borderRadius: 3,
      }}>
        Care Mgmt
      </span>

      <span style={{ fontSize: 12, fontWeight: 600, color: C.textPrimary }}>
        {e.program_type}
      </span>
      <span style={{ fontSize: 12, color: acuityColor, fontWeight: 600 }}>
        {e.acuity_tier || "Unscored"} acuity
      </span>
      {!isPrimary && (
        <Badge label={e.enrollment_status} variant={e.enrollment_status === "Active" ? "green" : "neutral"} size="xs" />
      )}

      {planRisk && (
        <span style={{
          fontSize: 10,
          fontWeight: 700,
          color: planRisk.color,
          background: planRisk.bg,
          padding: "2px 7px",
          borderRadius: 3,
          letterSpacing: "0.04em",
        }}>
          {planRisk.label}
        </span>
      )}

      {populations.slice(0, 4).map(code => (
        <span key={code} style={{
          fontSize: 10,
          padding: "2px 8px",
          background: "#fff",
          border: "0.5px solid " + C.borderLight,
          borderRadius: 10,
          color: C.textSecondary,
          fontWeight: 600,
          whiteSpace: "nowrap",
        }}>
          {popLabels[code] || code}
        </span>
      ))}
      {populations.length > 4 && (
        <span style={{ fontSize: 10, color: C.textTertiary }}>
          +{populations.length - 4}
        </span>
      )}

      {e.hop_active && (
        <Badge label="HOP" variant="blue" size="xs" />
      )}
      {e.plan_unable_to_reach && (
        <span title="Health plan reports member as Unable to Reach in their last PRL">
          <Badge label="Plan UTR" variant="amber" size="xs" />
        </span>
      )}
    </div>
  );
}

// Expanded detail panel for a single enrollment - shows plan-perspective
// data sourced from the most recent inbound PRL. Only useful info; if nothing
// has synced yet, says so.
function CareManagementStripDetail({ enrollment, popLabels }) {
  const e = enrollment;
  if (!e.prl_last_synced_at) {
    return (
      <div style={{
        padding: "8px 14px",
        background: "#fff",
        borderTop: "0.5px solid " + C.borderLight,
        fontSize: 11,
        color: C.textTertiary,
        fontStyle: "italic",
      }}>
        No plan PRL data applied yet for this enrollment. Plan risk and priority populations will appear here once an inbound PRL is reconciled.
      </div>
    );
  }

  const isTailored = e.health_plan_type === "Tailored";
  const populations = Array.isArray(e.priority_populations) ? e.priority_populations : [];
  const populationLabels = populations.map(c => popLabels[c] || c);

  return (
    <div style={{
      padding: "10px 14px",
      background: "#fff",
      borderTop: "0.5px solid " + C.borderLight,
      fontSize: 11,
    }}>
      <div style={{
        fontSize: 10,
        color: C.textTertiary,
        fontStyle: "italic",
        marginBottom: 10,
        paddingBottom: 8,
        borderBottom: "0.5px solid " + C.borderLight,
        lineHeight: 1.5,
      }}>
        Two risk scores are tracked. Acuity is your practice's clinical assessment from touchpoints and assessment. Plan risk is the health plan's claims-based stratification, refreshed monthly via the inbound PRL.
      </div>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        gap: 12,
      }}>
      <DetailMicro label="Plan view synced" value={new Date(e.prl_last_synced_at).toLocaleDateString()} />
      <DetailMicro
        label="Priority populations"
        value={populationLabels.length > 0 ? populationLabels.join(", ") : "None reported"}
        span={2}
      />
      <DetailMicro label="Payer" value={e.payer_name || "Not on file"} />
      {isTailored && (
        <>
          <DetailMicro label="Population segment" value={e.population_segment || "Not set"} />
          <DetailMicro label="Waiver service" value={e.waiver_service || "None"} />
          <DetailMicro
            label="TCL status"
            value={e.tcl_member_status === null || e.tcl_member_status === undefined
              ? "Unknown"
              : e.tcl_member_status ? "Active" : "Not active"}
          />
        </>
      )}
      {e.php_risk_evidence && (
        <div style={{ gridColumn: "1 / -1", marginTop: 4 }}>
          <div style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            color: C.textTertiary,
            marginBottom: 3,
          }}>
            Plan risk evidence
          </div>
          <div style={{
            fontSize: 11,
            color: C.textSecondary,
            background: C.bgSecondary,
            padding: "6px 10px",
            borderRadius: 6,
            borderLeft: "2px solid " + C.borderLight,
          }}>
            {e.php_risk_evidence}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

function DetailMicro({ label, value, span = 1 }) {
  return (
    <div style={{ gridColumn: `span ${span}` }}>
      <div style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        color: C.textTertiary,
        marginBottom: 2,
      }}>
        {label}
      </div>
      <div style={{ fontSize: 12, color: C.textPrimary }}>
        {value}
      </div>
    </div>
  );
}

function PatientEditForm({ patient, onSave, onCancel }) {
  const [f, setF] = useState({ ...patient });
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Input label="First Name" value={f.first_name} onChange={set("first_name")} />
        <Input label="Last Name" value={f.last_name} onChange={set("last_name")} />
        <Input label="Preferred Name" value={f.preferred_name} onChange={set("preferred_name")} />
        <Input label="DOB" type="date" value={f.date_of_birth} onChange={set("date_of_birth")} />
        <Select label="Gender" value={f.gender} onChange={set("gender")} options={GENDERS} />
        <Input label="Pronouns" value={f.pronouns} onChange={set("pronouns")} />
        <Input label="Mobile" value={f.phone_mobile} onChange={set("phone_mobile")} />
        <Input label="Email" value={f.email} onChange={set("email")} />
        <Input label="Address" value={f.address_line1} onChange={set("address_line1")} style={{ gridColumn: "1 / -1" }} />
        <Input label="City" value={f.city} onChange={set("city")} />
        <Input label="State" value={f.state} onChange={set("state")} />
        <Input label="ZIP" value={f.zip} onChange={set("zip")} />
        <Input label="County" value={f.county} onChange={set("county")} />
        <Input label="MRN" value={f.mrn} onChange={set("mrn")} />
        <Input label="Emergency Contact" value={f.emergency_contact_name} onChange={set("emergency_contact_name")} />
        <Input label="Emergency Phone" value={f.emergency_contact_phone} onChange={set("emergency_contact_phone")} />
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
        <Btn variant="outline" onClick={onCancel}>Cancel</Btn>
        <Btn onClick={() => onSave({
          first_name: f.first_name, last_name: f.last_name, preferred_name: f.preferred_name,
          date_of_birth: f.date_of_birth, gender: f.gender, pronouns: f.pronouns,
          phone_mobile: f.phone_mobile, email: f.email,
          address_line1: f.address_line1, city: f.city, state: f.state, zip: f.zip, county: f.county,
          mrn: f.mrn, emergency_contact_name: f.emergency_contact_name, emergency_contact_phone: f.emergency_contact_phone,
        })}>Save Changes</Btn>
      </div>
    </div>
  );
}
