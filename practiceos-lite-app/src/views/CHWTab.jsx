// src/views/CHWTab.jsx
//
// CHW Coordination tab for the Care Management Console.
//
// Surfaces the NC Medicaid TCM April 2022 guidance requirements:
//   - Each CHW is DIRECTED by a Care Manager (or Supervising CM)
//   - A single CM can direct up to 2.0 FTE of CHW oversight (enforced by
//     cm_chw_asg_fte_cap trigger on insert/update)
//   - Conflict-of-interest check required when a CHW's employer is a
//     different organization than the directing practice; may be overridden
//     with written rationale
//
// v1 scope:
//   - "By Care Manager" primary view with FTE gauge per CM
//   - CHW directory panel (all CHWs at practice with credentialing summary)
//   - New assignment modal
//   - Assignment detail modal with End Assignment action
//   - Clicking a CHW opens a read-only credentialing detail modal
//
// v1 simplifications (deferred):
//   - CHW creation/credentialing edit (managed via Team admin elsewhere)
//   - Suspended status workflow
//   - Annual SCCT recert reminders
//   - Conflict-of-interest quarterly review cron

import { useState, useEffect, useMemo } from "react";
import { supabase } from "../lib/supabaseClient";
import { C } from "../lib/tokens";
import { Badge, Btn, Card, Modal, Loader, EmptyState, ErrorBanner, FL } from "../components/ui";

// NC Medicaid cap on CHW oversight per directing CM
const FTE_CAP = 2.00;

// Roles eligible to direct CHWs (matches the cm_chw_asg_role_check trigger)
const DIRECTING_ROLES = ["Care Manager", "Supervising Care Manager", "Care Manager Supervisor"];

// Common inline style snippets. Kept local to avoid cross-file coupling.
const inputStyle = {
  width: "100%",
  padding: "8px 10px",
  fontSize: 13,
  border: "0.5px solid " + C.borderLight,
  borderRadius: 6,
  background: C.bgPrimary,
  color: C.textPrimary,
  fontFamily: "inherit",
};
const selectStyle = { ...inputStyle };

export default function CHWTab({ practiceId, profile }) {
  const [assignments, setAssignments] = useState([]);
  const [chws, setChws]               = useState([]);
  const [cms, setCms]                 = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);

  const [view, setView]               = useState("by_cm"); // by_cm | directory
  const [selectedAsg, setSelectedAsg] = useState(null);
  const [selectedChw, setSelectedChw] = useState(null);
  const [showNewAsg, setShowNewAsg]   = useState(false);

  const role = profile?.role;
  const canCreate = role && role !== "CHW";

  const load = () => {
    if (!practiceId) return;
    setLoading(true);
    Promise.all([
      supabase
        .from("cm_chw_assignments")
        .select("id, chw_user_id, care_manager_user_id, status, started_at, ended_at, end_reason, fte_fraction, conflict_org_name, conflict_org_tin, conflict_check_performed_at, conflict_check_result, conflict_override_rationale, conflict_override_by, notes, chw_user:users!cm_chw_assignments_chw_user_id_fkey(id, full_name, chw_cert_type, chw_employer_org), care_manager_user:users!cm_chw_assignments_care_manager_user_id_fkey(id, full_name, role)")
        .eq("practice_id", practiceId)
        .order("started_at", { ascending: false }),
      supabase
        .from("users")
        .select("id, full_name, email, chw_cert_type, chw_nc_chwa_cert_number, chw_cert_issued_at, chw_cert_expires_at, chw_onboarded_at, chw_scct_score, chw_training_completed, chw_field_time_majority, chw_employer_org, chw_employer_tin, chw_residence_county, chw_lived_experience_notes, is_active")
        .eq("practice_id", practiceId)
        .eq("role", "CHW")
        .order("full_name", { ascending: true }),
      supabase
        .from("users")
        .select("id, full_name, role")
        .eq("practice_id", practiceId)
        .in("role", DIRECTING_ROLES)
        .eq("is_active", true)
        .order("full_name", { ascending: true }),
    ]).then(([aRes, chwRes, cmRes]) => {
      if (aRes.error) setError(aRes.error.message);
      else setAssignments(aRes.data || []);
      setChws(chwRes.data || []);
      setCms(cmRes.data || []);
      setLoading(false);
    });
  };

  useEffect(() => { load(); }, [practiceId]);

  // Compute FTE totals per CM (only Active assignments count)
  const fteByManager = useMemo(() => {
    const totals = new Map();
    for (const a of assignments) {
      if (a.status !== "Active") continue;
      const current = totals.get(a.care_manager_user_id) || 0;
      totals.set(a.care_manager_user_id, current + Number(a.fte_fraction || 0));
    }
    return totals;
  }, [assignments]);

  // KPIs
  const kpis = useMemo(() => {
    const activeAsg = assignments.filter(a => a.status === "Active");
    const withConflict = activeAsg.filter(a => a.conflict_org_name);
    // CMs at or above 80% of cap
    let nearCap = 0;
    for (const [, total] of fteByManager) {
      if (total >= FTE_CAP * 0.8) nearCap++;
    }
    return {
      chwCount:       chws.filter(c => c.is_active !== false).length,
      activeAsgCount: activeAsg.length,
      withConflict:   withConflict.length,
      nearCap,
    };
  }, [chws, assignments, fteByManager]);

  // Group active assignments by CM for the "By CM" view
  const asgByManager = useMemo(() => {
    const map = new Map();
    for (const cm of cms) map.set(cm.id, []);
    for (const a of assignments) {
      if (a.status !== "Active") continue;
      if (!map.has(a.care_manager_user_id)) map.set(a.care_manager_user_id, []);
      map.get(a.care_manager_user_id).push(a);
    }
    return map;
  }, [cms, assignments]);

  return (
    <div>
      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
        <KpiBox label="CHWs on staff"      value={kpis.chwCount}       />
        <KpiBox label="Active assignments" value={kpis.activeAsgCount} />
        <KpiBox label="With COI override"  value={kpis.withConflict}   variant={kpis.withConflict > 0 ? "amber" : "neutral"} hint="Conflict-of-interest override in place" />
        <KpiBox label="CMs near FTE cap"   value={kpis.nearCap}        variant={kpis.nearCap > 0 ? "amber" : "neutral"} hint="80% of 2.0 FTE or more" />
      </div>

      {/* View toggle + action bar */}
      <Card style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, padding: 12 }}>
        <div style={{ display: "flex", gap: 6 }}>
          <Btn size="sm" variant={view === "by_cm"     ? "primary" : "ghost"} onClick={() => setView("by_cm")}>By Care Manager</Btn>
          <Btn size="sm" variant={view === "directory" ? "primary" : "ghost"} onClick={() => setView("directory")}>CHW Directory</Btn>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {canCreate && (
            <Btn variant="primary" size="sm" onClick={() => setShowNewAsg(true)}>+ New assignment</Btn>
          )}
          <Btn variant="outline" size="sm" onClick={load}>Refresh</Btn>
        </div>
      </Card>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {loading ? (
        <Card><Loader label="Loading CHW coordination..." /></Card>
      ) : view === "by_cm" ? (
        cms.length === 0 ? (
          <Card><EmptyState title="No directing care managers" message="Add a Care Manager or Supervising Care Manager to the practice team first." /></Card>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 12 }}>
            {cms.map(cm => (
              <CMCard
                key={cm.id}
                cm={cm}
                fte={fteByManager.get(cm.id) || 0}
                assignments={asgByManager.get(cm.id) || []}
                onClickAssignment={setSelectedAsg}
                onClickChw={setSelectedChw}
              />
            ))}
          </div>
        )
      ) : (
        <Card>
          {chws.length === 0 ? (
            <EmptyState title="No CHWs on staff" message="Add Community Health Workers via Team admin. Each CHW needs role='CHW' and the credentialing fields populated." />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12, padding: 4 }}>
              {chws.map(chw => (
                <CHWDirectoryCard key={chw.id} chw={chw} onClick={() => setSelectedChw(chw)} />
              ))}
            </div>
          )}
        </Card>
      )}

      {selectedAsg && (
        <AssignmentDetailModal
          assignment={selectedAsg}
          userId={profile?.id}
          canEnd={canCreate}
          onClose={() => setSelectedAsg(null)}
          onUpdated={() => { setSelectedAsg(null); load(); }}
        />
      )}
      {selectedChw && (
        <CHWDetailModal chw={selectedChw} onClose={() => setSelectedChw(null)} />
      )}
      {showNewAsg && (
        <NewAssignmentModal
          practiceId={practiceId}
          userId={profile?.id}
          chws={chws}
          cms={cms}
          existingActive={assignments.filter(a => a.status === "Active")}
          fteByManager={fteByManager}
          onClose={() => setShowNewAsg(false)}
          onCreated={() => { setShowNewAsg(false); load(); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CMCard - one directing Care Manager with FTE gauge and assigned CHWs
// ---------------------------------------------------------------------------

function CMCard({ cm, fte, assignments, onClickAssignment, onClickChw }) {
  const pct = Math.min(100, Math.round((fte / FTE_CAP) * 100));
  const over80 = fte >= FTE_CAP * 0.8;
  const barColor = fte >= FTE_CAP ? C.red : over80 ? "#d97706" : C.green;

  return (
    <Card style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary }}>{cm.full_name}</div>
        <div style={{ fontSize: 11, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.05em" }}>{cm.role}</div>
      </div>

      {/* FTE gauge */}
      <div style={{ marginTop: 12, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
          <span style={{ fontSize: 11, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>
            CHW oversight FTE
          </span>
          <span style={{ fontSize: 13, fontWeight: 700, color: barColor, fontFamily: "monospace" }}>
            {fte.toFixed(2)} / {FTE_CAP.toFixed(2)}
          </span>
        </div>
        <div style={{ height: 8, borderRadius: 4, background: C.bgSecondary, overflow: "hidden" }}>
          <div style={{ width: pct + "%", height: "100%", background: barColor, transition: "width 0.3s" }} />
        </div>
        {fte >= FTE_CAP && (
          <div style={{ fontSize: 11, color: C.red, marginTop: 4, fontWeight: 600 }}>
            At cap - additional assignments will be blocked by DB trigger
          </div>
        )}
      </div>

      {/* Assignments */}
      <div style={{ fontSize: 11, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700, marginBottom: 8 }}>
        Directed CHWs ({assignments.length})
      </div>
      {assignments.length === 0 ? (
        <div style={{ fontSize: 12, color: C.textTertiary, fontStyle: "italic" }}>No active CHW assignments</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {assignments.map(a => (
            <AssignmentRow key={a.id} assignment={a} onClickAssignment={onClickAssignment} onClickChw={onClickChw} />
          ))}
        </div>
      )}
    </Card>
  );
}

function AssignmentRow({ assignment, onClickAssignment, onClickChw }) {
  const chw = assignment.chw_user;
  const hasConflict = !!assignment.conflict_org_name;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "8px 10px", background: C.bgSecondary, borderRadius: 6, fontSize: 13,
    }}>
      <button
        type="button"
        onClick={() => onClickChw && chw && onClickChw(chw)}
        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontWeight: 600, color: C.textPrimary, fontSize: 13, textAlign: "left" }}
      >
        {chw?.full_name || "(unknown)"}
      </button>
      <div style={{ fontSize: 11, color: C.textTertiary }}>{chw?.chw_cert_type}</div>
      <div style={{ marginLeft: "auto", fontFamily: "monospace", fontSize: 12, color: C.textSecondary }}>
        {Number(assignment.fte_fraction).toFixed(2)} FTE
      </div>
      {hasConflict && <Badge label="COI" variant="amber" size="xs" />}
      <Btn size="sm" variant="ghost" onClick={() => onClickAssignment(assignment)}>Details</Btn>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CHWDirectoryCard - one CHW in the directory view
// ---------------------------------------------------------------------------

function CHWDirectoryCard({ chw, onClick }) {
  const external = chw.chw_employer_org && chw.chw_employer_tin && chw.chw_employer_tin !== "12-3456789";
  const certDaysLeft = chw.chw_cert_expires_at
    ? Math.ceil((new Date(chw.chw_cert_expires_at) - Date.now()) / (1000 * 60 * 60 * 24))
    : null;
  const certExpiringSoon = certDaysLeft !== null && certDaysLeft < 90;

  return (
    <div
      onClick={onClick}
      style={{
        padding: 14, border: "0.5px solid " + C.borderLight, borderRadius: 8, background: C.bgPrimary,
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.textPrimary }}>{chw.full_name}</div>
        <Badge label={chw.chw_cert_type || "None"} variant={chw.chw_cert_type ? "blue" : "neutral"} size="xs" />
      </div>
      <div style={{ fontSize: 11, color: C.textTertiary, marginBottom: 8 }}>
        {chw.chw_nc_chwa_cert_number || "no cert ID"}
      </div>
      <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 4 }}>
        <strong>Employer:</strong> {chw.chw_employer_org || "-"}
      </div>
      {chw.chw_residence_county && (
        <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 4 }}>
          <strong>County:</strong> {chw.chw_residence_county}
        </div>
      )}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 8 }}>
        {external && <Badge label="EXTERNAL EMPLOYER" variant="amber" size="xs" />}
        {certExpiringSoon && <Badge label={"CERT IN " + certDaysLeft + "D"} variant="red" size="xs" />}
        {chw.chw_field_time_majority && <Badge label="FIELD TIME >50%" variant="green" size="xs" />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AssignmentDetailModal - view an assignment + end it if needed
// ---------------------------------------------------------------------------

function AssignmentDetailModal({ assignment, userId, canEnd, onClose, onUpdated }) {
  const [showEnd, setShowEnd] = useState(false);
  const [endReason, setEndReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const chw = assignment.chw_user;
  const cm  = assignment.care_manager_user;
  const hasConflict = !!assignment.conflict_org_name;
  const title = (chw?.full_name || "CHW") + " --> " + (cm?.full_name || "CM");

  const endAssignment = async () => {
    if (!endReason.trim()) { setError("End reason required"); return; }
    setSaving(true); setError(null);
    try {
      const { error: updErr } = await supabase
        .from("cm_chw_assignments")
        .update({
          status: "Ended",
          ended_at: new Date().toISOString(),
          end_reason: endReason.trim(),
          updated_by: userId || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", assignment.id);
      if (updErr) throw updErr;
      onUpdated();
    } catch (e) { setError(e.message); setSaving(false); }
  };

  return (
    <Modal title={"Assignment: " + title} onClose={onClose} width={700}>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {/* End-assignment inline form */}
      {showEnd ? (
        <div style={{ padding: 12, marginBottom: 16, background: C.amberBg, border: "0.5px solid " + C.amberBorder, borderRadius: 8 }}>
          <FL>End reason (required)</FL>
          <input type="text" value={endReason} onChange={e => setEndReason(e.target.value)} placeholder="e.g. CHW left the practice, reassignment to different CM, etc." style={inputStyle} />
          <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
            <Btn variant="ghost" size="sm" onClick={() => { setShowEnd(false); setEndReason(""); }}>Cancel</Btn>
            <Btn variant="primary" size="sm" disabled={saving || !endReason.trim()} onClick={endAssignment} style={{ background: C.red, borderColor: C.red }}>
              {saving ? "Ending..." : "Confirm end assignment"}
            </Btn>
          </div>
        </div>
      ) : canEnd && assignment.status === "Active" && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16, paddingBottom: 12, borderBottom: "0.5px solid " + C.borderLight }}>
          <Btn variant="outline" size="sm" onClick={() => setShowEnd(true)} style={{ color: C.red, borderColor: C.redBorder }}>End assignment</Btn>
        </div>
      )}

      {/* Summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
        <DF label="Status">
          <Badge label={assignment.status} variant={assignment.status === "Active" ? "green" : "neutral"} size="xs" />
        </DF>
        <DF label="FTE fraction">{Number(assignment.fte_fraction).toFixed(2)}</DF>
        <DF label="Started">{new Date(assignment.started_at).toLocaleDateString()}</DF>
        <DF label="CHW cert">{chw?.chw_cert_type || "-"}</DF>
        <DF label="CHW employer">{chw?.chw_employer_org || "-"}</DF>
        <DF label="Direction role">{cm?.role || "-"}</DF>
        {assignment.ended_at && <DF label="Ended">{new Date(assignment.ended_at).toLocaleDateString()}</DF>}
        {assignment.end_reason && <DF label="End reason" wide>{assignment.end_reason}</DF>}
      </div>

      {/* Conflict of interest block (if present) */}
      {hasConflict && (
        <div style={{ marginBottom: 20, padding: 12, background: C.amberBg, border: "0.5px solid " + C.amberBorder, borderRadius: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 8 }}>
            Conflict of interest
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>
            <div><strong>External employer:</strong> {assignment.conflict_org_name}{assignment.conflict_org_tin ? " (TIN " + assignment.conflict_org_tin + ")" : ""}</div>
            {assignment.conflict_check_performed_at && (
              <div style={{ marginTop: 4 }}><strong>Check performed:</strong> {new Date(assignment.conflict_check_performed_at).toLocaleDateString()}</div>
            )}
            {assignment.conflict_check_result && (
              <div style={{ marginTop: 4 }}><strong>Result:</strong> {assignment.conflict_check_result}</div>
            )}
            {assignment.conflict_override_rationale && (
              <div style={{ marginTop: 8, padding: 8, background: C.bgPrimary, borderRadius: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 4 }}>Override rationale</div>
                {assignment.conflict_override_rationale}
              </div>
            )}
          </div>
        </div>
      )}

      {assignment.notes && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 8 }}>Notes</div>
          <div style={{ fontSize: 13, padding: "8px 12px", background: C.bgSecondary, borderRadius: 8 }}>{assignment.notes}</div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// CHWDetailModal - full credentialing view for a single CHW
// ---------------------------------------------------------------------------

function CHWDetailModal({ chw, onClose }) {
  const training = chw.chw_training_completed || {};
  const trainingKeys = Object.keys(training);
  const completed = trainingKeys.filter(k => training[k] === true);
  const pending = trainingKeys.filter(k => training[k] === false);

  return (
    <Modal title={"CHW: " + chw.full_name} onClose={onClose} width={760}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
        <DF label="Certification">{chw.chw_cert_type || "None"}</DF>
        <DF label="Cert number" monospace>{chw.chw_nc_chwa_cert_number || "-"}</DF>
        <DF label="SCCT score">{chw.chw_scct_score ? Number(chw.chw_scct_score).toFixed(1) : "-"}</DF>
        <DF label="Issued">{chw.chw_cert_issued_at ? new Date(chw.chw_cert_issued_at).toLocaleDateString() : "-"}</DF>
        <DF label="Expires">{chw.chw_cert_expires_at ? new Date(chw.chw_cert_expires_at).toLocaleDateString() : "-"}</DF>
        <DF label="Onboarded">{chw.chw_onboarded_at ? new Date(chw.chw_onboarded_at).toLocaleDateString() : "-"}</DF>
        <DF label="Employer" wide>{chw.chw_employer_org || "-"}{chw.chw_employer_tin ? " (TIN " + chw.chw_employer_tin + ")" : ""}</DF>
        <DF label="Residence county">{chw.chw_residence_county || "-"}</DF>
        <DF label="Field time >50%">{chw.chw_field_time_majority ? "Yes" : "No"}</DF>
        <DF label="Email" monospace wide>{chw.email}</DF>
      </div>

      {/* Training completion */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 8 }}>
          Training ({completed.length} complete, {pending.length} pending)
        </div>
        {trainingKeys.length === 0 ? (
          <div style={{ fontSize: 12, color: C.textTertiary, fontStyle: "italic" }}>No training modules tracked</div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {trainingKeys.map(k => (
              <div key={k} style={{
                padding: "4px 10px", borderRadius: 12, fontSize: 11, fontWeight: 600,
                background: training[k] ? C.greenBg : C.bgSecondary,
                color: training[k] ? C.green : C.textTertiary,
                border: "0.5px solid " + (training[k] ? C.greenBorder : C.borderLight),
              }}>
                {training[k] ? "\u2713 " : ""}{k.replace(/_/g, " ")}
              </div>
            ))}
          </div>
        )}
      </div>

      {chw.chw_lived_experience_notes && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textSecondary, marginBottom: 8 }}>
            Lived experience / background
          </div>
          <div style={{ fontSize: 13, padding: "8px 12px", background: C.bgSecondary, borderRadius: 8 }}>
            {chw.chw_lived_experience_notes}
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// NewAssignmentModal - create a new CHW-CM assignment
// ---------------------------------------------------------------------------

function NewAssignmentModal({ practiceId, userId, chws, cms, existingActive, fteByManager, onClose, onCreated }) {
  const [chwId, setChwId] = useState("");
  const [cmId, setCmId]   = useState("");
  const [fte, setFte]     = useState("1.00");
  const [notes, setNotes] = useState("");

  // Conflict fields - populated automatically if the selected CHW's employer differs
  const [coiOrg, setCoiOrg] = useState("");
  const [coiTin, setCoiTin] = useState("");
  const [coiRationale, setCoiRationale] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);

  const selectedChw = useMemo(() => chws.find(c => c.id === chwId) || null, [chws, chwId]);
  const selectedCm  = useMemo(() => cms.find(c => c.id === cmId) || null, [cms, cmId]);

  // Auto-populate conflict block if CHW employer looks external (v1 heuristic:
  // any CHW whose employer org string is non-empty and doesn't match the
  // practice's common employer name). Users can override before saving.
  useEffect(() => {
    if (!selectedChw) { setCoiOrg(""); setCoiTin(""); return; }
    // Simple heuristic: if CHW shares employer with most practice CHWs, it's
    // not a conflict. Otherwise prefill.
    const practiceEmployers = chws
      .filter(c => c.chw_employer_tin && c.id !== selectedChw.id)
      .map(c => c.chw_employer_tin);
    const isExternal = selectedChw.chw_employer_tin
      && !practiceEmployers.includes(selectedChw.chw_employer_tin);
    if (isExternal) {
      setCoiOrg(selectedChw.chw_employer_org || "");
      setCoiTin(selectedChw.chw_employer_tin || "");
    } else {
      setCoiOrg(""); setCoiTin("");
    }
  }, [selectedChw, chws]);

  // Duplicate check: is there already an Active assignment for this (CHW, CM)?
  const duplicateWarning = useMemo(() => {
    if (!chwId || !cmId) return null;
    const dup = existingActive.find(a => a.chw_user_id === chwId && a.care_manager_user_id === cmId);
    return dup ? "An active assignment already exists between this CHW and CM. End the existing one first." : null;
  }, [chwId, cmId, existingActive]);

  // FTE cap check: projected total after this assignment
  const fteWarning = useMemo(() => {
    if (!cmId || !fte) return null;
    const current = fteByManager.get(cmId) || 0;
    const projected = current + parseFloat(fte || "0");
    if (projected > FTE_CAP) {
      return "Projected total FTE for this CM would be " + projected.toFixed(2) + ", exceeding the " + FTE_CAP.toFixed(2) + " cap. Reduce FTE or end another assignment first.";
    }
    return null;
  }, [cmId, fte, fteByManager]);

  const save = async () => {
    if (!chwId) { setError("Pick a CHW"); return; }
    if (!cmId)  { setError("Pick a directing care manager"); return; }
    const fteNum = parseFloat(fte);
    if (isNaN(fteNum) || fteNum <= 0 || fteNum > FTE_CAP) { setError("FTE must be between 0 and " + FTE_CAP.toFixed(2)); return; }
    if (duplicateWarning) { setError(duplicateWarning); return; }
    if (fteWarning)       { setError(fteWarning); return; }
    if (coiOrg && !coiRationale.trim()) { setError("Conflict-of-interest override rationale required when CHW has an external employer"); return; }

    setSaving(true); setError(null);

    const nowIso = new Date().toISOString();
    const payload = {
      practice_id:           practiceId,
      chw_user_id:           chwId,
      care_manager_user_id:  cmId,
      fte_fraction:          fteNum,
      status:                "Active",
      started_at:            nowIso,
      notes:                 notes.trim() || null,
      created_by:            userId || null,
    };
    if (coiOrg) {
      payload.conflict_org_name = coiOrg.trim();
      payload.conflict_org_tin  = coiTin.trim() || null;
      payload.conflict_check_performed_at = nowIso;
      payload.conflict_check_performed_by = userId || null;
      payload.conflict_check_result       = "Override approved with written rationale";
      payload.conflict_override_rationale = coiRationale.trim();
      payload.conflict_override_by        = userId || null;
    }

    try {
      const { error: insErr } = await supabase.from("cm_chw_assignments").insert(payload);
      if (insErr) throw insErr;
      onCreated();
    } catch (e) { setError(e.message || "Failed to create assignment"); setSaving(false); }
  };

  return (
    <Modal title="New CHW assignment" onClose={onClose} width={720}>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <FL>CHW</FL>
          <select value={chwId} onChange={e => setChwId(e.target.value)} style={selectStyle}>
            <option value="">-- Pick a CHW --</option>
            {chws.filter(c => c.is_active !== false).map(c => (
              <option key={c.id} value={c.id}>
                {c.full_name} ({c.chw_cert_type || "no cert"})
              </option>
            ))}
          </select>
        </div>

        <div>
          <FL>Directing care manager</FL>
          <select value={cmId} onChange={e => setCmId(e.target.value)} style={selectStyle}>
            <option value="">-- Pick a CM --</option>
            {cms.map(c => {
              const cur = fteByManager.get(c.id) || 0;
              const headroom = FTE_CAP - cur;
              return (
                <option key={c.id} value={c.id}>
                  {c.full_name} ({c.role}) - {cur.toFixed(2)}/{FTE_CAP.toFixed(2)} FTE used
                </option>
              );
            })}
          </select>
          {cmId && (
            <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 4 }}>
              Current: {(fteByManager.get(cmId) || 0).toFixed(2)} FTE / Cap: {FTE_CAP.toFixed(2)} FTE
            </div>
          )}
        </div>

        <div>
          <FL>FTE fraction</FL>
          <input type="number" step="0.05" min="0.05" max="2" value={fte} onChange={e => setFte(e.target.value)} style={inputStyle} />
          <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 4 }}>1.00 = full-time; 0.50 = half-time</div>
        </div>

        <div style={{ gridColumn: "1 / -1" }}>
          <FL>Notes (optional)</FL>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
        </div>
      </div>

      {/* Conflict-of-interest block - shown when prefilled from external employer */}
      {coiOrg && (
        <div style={{ marginTop: 16, padding: 12, background: C.amberBg, border: "0.5px solid " + C.amberBorder, borderRadius: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textPrimary, marginBottom: 8 }}>
            Conflict of interest detected
          </div>
          <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 12 }}>
            This CHW is employed by <strong>{coiOrg}</strong>, a different organization than the practice. Per NC Medicaid TCM guidance, a written override rationale is required.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
            <div>
              <FL>Org name</FL>
              <input type="text" value={coiOrg} onChange={e => setCoiOrg(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <FL>Org TIN</FL>
              <input type="text" value={coiTin} onChange={e => setCoiTin(e.target.value)} style={{ ...inputStyle, fontFamily: "monospace" }} />
            </div>
          </div>
          <FL>Override rationale (required)</FL>
          <textarea value={coiRationale} onChange={e => setCoiRationale(e.target.value)} rows={3} placeholder="e.g. Written MOU in place specifying non-duplicative engagement. Quarterly review cadence. Etc." style={{ ...inputStyle, resize: "vertical" }} />
        </div>
      )}

      {duplicateWarning && (
        <div style={{ marginTop: 12, padding: 10, background: C.redBg, border: "0.5px solid " + C.redBorder, borderRadius: 8, fontSize: 12, color: C.textPrimary }}>
          <strong>Duplicate:</strong> {duplicateWarning}
        </div>
      )}
      {fteWarning && (
        <div style={{ marginTop: 12, padding: 10, background: C.redBg, border: "0.5px solid " + C.redBorder, borderRadius: 8, fontSize: 12, color: C.textPrimary }}>
          <strong>FTE cap:</strong> {fteWarning}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" disabled={saving || !!duplicateWarning || !!fteWarning} onClick={save}>
          {saving ? "Creating..." : "Create assignment"}
        </Btn>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Small helpers local to this file
// ---------------------------------------------------------------------------

function KpiBox({ label, value, hint, variant }) {
  const accent = variant === "amber" ? "#d97706" : variant === "red" ? C.red : C.textPrimary;
  return (
    <Card style={{ padding: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textTertiary, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: accent, lineHeight: 1.1 }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 4 }}>{hint}</div>}
    </Card>
  );
}

function DF({ label, children, wide, monospace }) {
  return (
    <div style={{ gridColumn: wide ? "1 / -1" : "auto" }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textTertiary, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, color: C.textPrimary, fontFamily: monospace ? "monospace" : "inherit" }}>{children}</div>
    </div>
  );
}
