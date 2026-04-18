// ═══════════════════════════════════════════════════════════════════════════════
// EligibilityView — eligibility pulse exception worklist (flagged rows)
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../auth/AuthProvider";
import { C } from "../lib/tokens";
import { updateRow, logAudit } from "../lib/db";
import { toISODate } from "../components/constants";
import { Badge, Btn, Card, Modal, TopBar, TabBar, FL, SectionHead, Loader, ErrorBanner, EmptyState, Textarea } from "../components/ui";

const STATUS_VAR = {
  "Verified":     "green",
  "Not Verified": "red",
  "Inactive":     "red",
  "Pending":      "amber",
  "Error":        "neutral",
};

export default function EligibilityView() {
  const { practiceId, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [checks, setChecks] = useState([]);
  const [filter, setFilter] = useState("flagged");
  const [reviewing, setReviewing] = useState(null);

  const load = async () => {
    try {
      setLoading(true);
      let q = supabase.from("eligibility_checks")
        .select("*, patients(first_name, last_name, date_of_birth), insurance_policies(payer_name, member_id, payer_category), appointments(appt_date, start_slot, appt_type)")
        .order("checked_at", { ascending: false }).limit(200);
      if (filter === "flagged") q = q.eq("flagged_for_review", true).is("reviewed_at", null);
      else if (filter === "issues") q = q.in("status", ["Not Verified", "Inactive", "Error"]);
      else if (filter === "today") q = q.gte("checked_at", `${toISODate()}T00:00:00`);
      const { data, error } = await q;
      if (error) throw error;
      setChecks(data || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (practiceId) load(); }, [practiceId, filter]);

  const markReviewed = async (check, note = null) => {
    try {
      await updateRow("eligibility_checks", check.id, {
        flagged_for_review: false,
        reviewed_at: new Date().toISOString(),
        reviewed_by: profile?.id,
      }, { audit: { entityType: "eligibility_checks", patientId: check.patient_id, details: { note } } });
      setChecks((prev) => prev.filter((c) => c.id !== check.id));
      setReviewing(null);
    } catch (e) { setError(e.message); }
  };

  if (loading) return <div style={{ flex: 1 }}><TopBar title="Eligibility" /><Loader /></div>;

  const flaggedCount = checks.filter((c) => c.flagged_for_review).length;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar title="Eligibility Pulse" sub={filter === "flagged" ? `${flaggedCount} need review` : `${checks.length} checks shown`}
        actions={<TabBar tabs={[["flagged", `Flagged (${flaggedCount})`], ["issues", "Issues"], ["today", "Today"], ["all", "All"]]} active={filter} onChange={setFilter} />} />

      <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
        {error && <ErrorBanner message={error} />}
        {checks.length === 0 ? <EmptyState icon="✅" title="Nothing to review" sub={filter === "flagged" ? "No eligibility checks are flagged right now." : "No checks match this filter."} />
          : <Card style={{ padding: 0, overflow: "hidden", maxWidth: 1100, margin: "0 auto" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr 0.8fr 1fr 100px", padding: "10px 14px", fontSize: 10, fontWeight: 700, color: C.textSecondary, textTransform: "uppercase", letterSpacing: "0.05em", background: C.bgSecondary, borderBottom: `0.5px solid ${C.borderLight}` }}>
              <div>Patient</div><div>Payer</div><div>Appt</div><div>Status</div><div>Issue</div><div></div>
            </div>
            {checks.map((c) => (
              <div key={c.id} style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr 0.8fr 1fr 100px", padding: "12px 14px", fontSize: 12, borderBottom: `0.5px solid ${C.borderLight}`, alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 600, color: C.textPrimary }}>
                    {c.patients ? `${c.patients.first_name} ${c.patients.last_name}` : "—"}
                  </div>
                  <div style={{ fontSize: 10, color: C.textTertiary }}>DOB {c.patients?.date_of_birth}</div>
                </div>
                <div>
                  <div style={{ fontWeight: 500, color: C.textPrimary }}>{c.insurance_policies?.payer_name || "—"}</div>
                  <div style={{ fontSize: 10, color: C.textTertiary }}>{c.insurance_policies?.payer_category}</div>
                </div>
                <div style={{ color: C.textSecondary }}>
                  {c.appointments ? c.appointments.appt_date : new Date(c.checked_at).toLocaleDateString()}
                </div>
                <Badge label={c.status} variant={STATUS_VAR[c.status] || "neutral"} size="xs" />
                <div style={{ fontSize: 11, color: C.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.error_message || (c.status === "Inactive" ? "Coverage inactive" : c.status === "Not Verified" ? "Could not verify" : "—")}
                </div>
                <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                  <Btn size="sm" variant="outline" onClick={() => setReviewing(c)}>Review</Btn>
                </div>
              </div>
            ))}
          </Card>
        }
      </div>

      {reviewing && <ReviewModal check={reviewing} onClose={() => setReviewing(null)} onResolve={markReviewed} />}
    </div>
  );
}

function ReviewModal({ check, onClose, onResolve }) {
  const [note, setNote] = useState("");
  return (
    <Modal title="Review Eligibility Check" onClose={onClose} maxWidth={560}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
        <div><FL>Patient</FL><div style={{ fontSize: 13 }}>{check.patients?.first_name} {check.patients?.last_name}</div></div>
        <div><FL>Checked At</FL><div style={{ fontSize: 13 }}>{new Date(check.checked_at).toLocaleString()}</div></div>
        <div><FL>Payer</FL><div style={{ fontSize: 13 }}>{check.insurance_policies?.payer_name || "—"}</div></div>
        <div><FL>Member ID</FL><div style={{ fontSize: 13, fontFamily: "monospace" }}>{check.insurance_policies?.member_id || "—"}</div></div>
        <div><FL>Status</FL><Badge label={check.status} variant={STATUS_VAR[check.status]} /></div>
        <div><FL>Copay</FL><div style={{ fontSize: 13 }}>{check.copay_amount ? `$${check.copay_amount}` : "—"}</div></div>
      </div>
      {check.error_message && (
        <div style={{ padding: 10, background: C.redBg, borderRadius: 6, fontSize: 12, color: C.red, marginBottom: 14 }}>
          {check.error_message}
        </div>
      )}
      <SectionHead title="Recommended Actions" />
      <ul style={{ fontSize: 12, color: C.textSecondary, paddingLeft: 20, marginBottom: 14 }}>
        {check.status === "Inactive" && <li>Contact patient to update insurance on file before the appointment</li>}
        {check.status === "Not Verified" && <li>Call payer to manually verify, then update the policy record</li>}
        {check.status === "Error" && <li>Re-run the eligibility check via the Make.com scenario or NCTracks portal</li>}
        <li>Flag the appointment for copay collection confirmation at check-in</li>
      </ul>
      <Textarea label="Resolution Note (optional)" value={note} onChange={setNote} rows={3} />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        <Btn onClick={() => onResolve(check, note)}>Mark Reviewed</Btn>
      </div>
    </Modal>
  );
}
