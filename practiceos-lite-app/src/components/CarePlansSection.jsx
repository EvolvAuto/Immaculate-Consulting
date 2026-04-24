// ═══════════════════════════════════════════════════════════════════════════════
// CarePlansSection - patient-facing list of care plans shared to portal
//
// Renders under the Profile tab in PortalView. Shows only plans where
// cm_care_plans.portal_shared_at IS NOT NULL AND plan_status = 'Active'.
// Patient can tap a plan to view summary + open PDF. If plan is unacknowledged,
// an "I've reviewed my care plan" button is shown. After ack, the acknowledgment
// timestamp is displayed read-only.
//
// Staff-captured acks (Phone / In Person / Video) done via PlanDetailModal
// render here as read-only too - the patient just sees they're already
// on record.
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { C } from "../lib/tokens";
import { Badge, Btn, Card, SectionHead, EmptyState, ErrorBanner, Textarea } from "./ui";

export default function CarePlansSection({ patientId }) {
  const [plans, setPlans]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [activePlan, setActivePlan] = useState(null);  // detail mode

  const load = async () => {
    if (!patientId) { setLoading(false); return; }
    try {
      setLoading(true);
      const { data, error: qErr } = await supabase
        .from("cm_care_plans")
        .select("id, plan_type, version, assessment_date, next_review_due, portal_shared_at, document_generated_at, member_ack_at, member_ack_method, member_ack_role")
        .eq("patient_id", patientId)
        .eq("plan_status", "Active")
        .not("portal_shared_at", "is", null)
        .order("portal_shared_at", { ascending: false });
      if (qErr) throw qErr;
      setPlans(data || []);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [patientId]);

  if (loading) {
    return (
    <div id="portal-care-plans-anchor" style={{ marginTop: 20, scrollMarginTop: 80 }}>
      <SectionHead title="My Care Plans" sub="Plans your care team has shared with you" />
        <Card>
          <div style={{ fontSize: 12, color: C.textTertiary, padding: 8, textAlign: "center" }}>
            Loading your care plans...
          </div>
        </Card>
      </div>
    );
  }

  if (activePlan) {
    return (
      <CarePlanDetail
        planSummary={activePlan}
        onClose={() => { setActivePlan(null); load(); }}
      />
    );
  }

  return (
    <div style={{ marginTop: 20 }}>
      <SectionHead title="My Care Plans" sub="Plans your care team has shared with you" />
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      {plans.length === 0 ? (
        <EmptyState
          icon="📋"
          title="No care plans shared yet"
          sub="If your care team creates a care plan for you, it will appear here."
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {plans.map((p) => (
            <Card
              key={p.id}
              onClick={() => setActivePlan(p)}
              style={{
                cursor: "pointer",
                borderLeft: p.member_ack_at
                  ? "3px solid " + C.green
                  : "3px solid " + C.amber,
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>
                    {p.plan_type || "Care Plan"} (v{p.version})
                  </div>
                  <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>
                    Shared {p.portal_shared_at ? new Date(p.portal_shared_at).toLocaleDateString() : "-"}
                    {p.next_review_due && " · Next review " + new Date(p.next_review_due + "T12:00:00").toLocaleDateString()}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  {p.member_ack_at ? (
                    <Badge label="Acknowledged" variant="green" size="xs" />
                  ) : (
                    <Badge label="Needs review" variant="amber" size="xs" />
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail view: fetches fresh signed URL + summary from edge function, then
// lets patient open the PDF and optionally acknowledge.
// ─────────────────────────────────────────────────────────────────────────────
function CarePlanDetail({ planSummary, onClose }) {
  const [detail, setDetail]     = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [ackNotes, setAckNotes] = useState("");
  const [acking, setAcking]     = useState(false);
  const [ackDone, setAckDone]   = useState(false);

  const callEdge = async (action, extraBody) => {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess?.session?.access_token;
    if (!token) throw new Error("Not signed in");
    const url = supabase.supabaseUrl + "/functions/v1/cmp-patient-self-ack-plan";
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": "Bearer " + token,
      },
      body: JSON.stringify({ plan_id: planSummary.id, action, ...(extraBody || {}) }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body?.error || "Request failed");
    return body;
  };

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const body = await callEdge("view");
        setDetail(body);
      } catch (e) {
        setError(e.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [planSummary.id]);

  const handleAck = async () => {
    setAcking(true); setError(null);
    try {
      const body = await callEdge("ack", ackNotes.trim() ? { notes: ackNotes.trim() } : {});
      setAckDone(true);
      setDetail((d) => d ? {
        ...d,
        already_acknowledged: true,
        member_ack_at:        body.member_ack_at,
        member_ack_method:    body.member_ack_method,
        member_ack_role:      body.member_ack_role,
      } : d);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setAcking(false);
    }
  };

  if (loading) {
    return (
      <div style={{ marginTop: 20 }}>
        <SectionHead
          title="Care Plan"
          action={<Btn variant="ghost" size="sm" onClick={onClose}>Back</Btn>}
        />
        <Card>
          <div style={{ fontSize: 12, color: C.textTertiary, padding: 8, textAlign: "center" }}>
            Loading care plan...
          </div>
        </Card>
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div style={{ marginTop: 20 }}>
        <SectionHead
          title="Care Plan"
          action={<Btn variant="ghost" size="sm" onClick={onClose}>Back</Btn>}
        />
        <ErrorBanner message={error} />
      </div>
    );
  }

  if (!detail) return null;

  const isAcked = !!detail.already_acknowledged;
  const ackRoleLabel = detail.member_ack_role === "Member"
    ? "by you via portal"
    : detail.member_ack_method
      ? "by your care team (" + String(detail.member_ack_method).toLowerCase() + ")"
      : "by your care team";

  return (
    <div style={{ marginTop: 20 }}>
      <SectionHead
        title={(detail.plan_type || "Care Plan") + " (v" + detail.version + ")"}
        sub={detail.practice_name || null}
        action={<Btn variant="ghost" size="sm" onClick={onClose}>Back</Btn>}
      />

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <Card style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 10, lineHeight: 1.5 }}>
          This is your care plan. It was prepared by your care team to summarize your goals,
          the steps you and your team will take, and when we'll check in next.
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <Field label="Plan date" value={detail.assessment_date ? new Date(detail.assessment_date + "T12:00:00").toLocaleDateString() : "-"} />
          <Field label="Next check-in" value={detail.next_review_due ? new Date(detail.next_review_due + "T12:00:00").toLocaleDateString() : "-"} />
          <Field label="Goals" value={String(detail.goals_count) + " goal" + (detail.goals_count === 1 ? "" : "s")} />
          <Field label="Action steps" value={String(detail.interventions_count) + " step" + (detail.interventions_count === 1 ? "" : "s")} />
        </div>

        {Array.isArray(detail.goals_preview) && detail.goals_preview.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textTertiary, marginBottom: 6 }}>
              Your goals
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: C.textPrimary, lineHeight: 1.5 }}>
              {detail.goals_preview.map((g, idx) => <li key={idx}>{g}</li>)}
            </ul>
            {detail.goals_count > detail.goals_preview.length && (
              <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 6, fontStyle: "italic" }}>
                ...plus {detail.goals_count - detail.goals_preview.length} more in the full plan.
              </div>
            )}
          </div>
        )}

        {detail.signed_url && (
          <div style={{ marginTop: 16 }}>
            <Btn
              variant="primary"
              size="sm"
              onClick={() => window.open(detail.signed_url, "_blank", "noopener,noreferrer")}
            >
              Open full care plan (PDF)
            </Btn>
          </div>
        )}
      </Card>

      {isAcked ? (
        <Card style={{ borderLeft: "3px solid " + C.green }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 22 }}>✓</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.green }}>
                Acknowledged {detail.member_ack_at ? "on " + new Date(detail.member_ack_at).toLocaleDateString() : ""}
              </div>
              <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>
                Recorded {ackRoleLabel}.
              </div>
            </div>
          </div>
        </Card>
      ) : (
        <Card>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
            Review and acknowledge
          </div>
          <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 12, lineHeight: 1.5 }}>
            Please open the full care plan PDF above and read it over. When you're ready,
            confirm that you've reviewed it. You can also add a note or question for your
            care team (optional).
          </div>
          <Textarea
            label="Note for your care team (optional)"
            value={ackNotes}
            onChange={setAckNotes}
            rows={3}
            placeholder="Example: I'd like to talk about goal #2 at our next visit."
          />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
            <Btn
              variant="primary"
              disabled={acking || ackDone}
              onClick={handleAck}
            >
              {acking ? "Saving..." : ackDone ? "Acknowledged" : "I've reviewed my care plan"}
            </Btn>
          </div>
        </Card>
      )}
    </div>
  );
}

const Field = ({ label, value }) => (
  <div>
    <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.textTertiary, marginBottom: 2 }}>
      {label}
    </div>
    <div style={{ fontSize: 13, color: value ? C.textPrimary : C.textTertiary }}>{value || "-"}</div>
  </div>
);
