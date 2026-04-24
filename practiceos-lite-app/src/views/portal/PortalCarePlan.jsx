// ═══════════════════════════════════════════════════════════════════════════════
// src/views/portal/PortalCarePlan.jsx
// Patient-facing care plan tab. Lists Active plans the care team has shared
// (portal_shared_at IS NOT NULL). Each plan can be viewed in detail:
//   - Fresh 24h signed PDF URL
//   - Summary (goals count, interventions count, first 5 goals)
//   - Acknowledge button (portal self-ack) if not already acknowledged
//   - Read-only ack confirmation if already acknowledged (by patient or staff)
//
// Backend: cmp-patient-self-ack-plan edge function (action: view|ack).
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { C, Panel, Badge, Btn, SectionHead, fmtDate } from "./_ui.jsx";

export default function PortalCarePlan({ patient, practice, patientId, refreshBadges }) {
  const [plans, setPlans]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [activePlan, setActivePlan] = useState(null);

  const load = async () => {
    if (!patientId) { setLoading(false); return; }
    try {
      setLoading(true);
      setError(null);
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
      <Panel>
        <div style={{ fontSize:12, color:C.textTertiary, padding:8, textAlign:"center" }}>
          Loading your care plans...
        </div>
      </Panel>
    );
  }

  if (activePlan) {
    return (
      <CarePlanDetail
        planSummary={activePlan}
        onClose={() => { setActivePlan(null); load(); if (refreshBadges) refreshBadges(); }}
      />
    );
  }

  return (
    <div>
      <div style={{ marginBottom:14 }}>
        <div style={{ fontSize:17, fontWeight:600, color:C.textPrimary }}>My Care Plan</div>
        <div style={{ fontSize:12, color:C.textSecondary, marginTop:3 }}>
          Plans your care team has shared with you. Tap a plan to read it and confirm.
        </div>
      </div>

      {error && (
        <Panel>
          <div style={{ fontSize:12, color:C.red }}>{error}</div>
        </Panel>
      )}

      {plans.length === 0 ? (
        <Panel>
          <div style={{ textAlign:"center", padding:"24px 12px" }}>
            <div style={{ fontSize:32, marginBottom:8 }}>📋</div>
            <div style={{ fontSize:13, fontWeight:600, color:C.textPrimary, marginBottom:4 }}>
              No care plans shared yet
            </div>
            <div style={{ fontSize:12, color:C.textSecondary }}>
              If your care team creates a care plan for you, it will appear here.
            </div>
          </div>
        </Panel>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {plans.map((p) => (
            <div
              key={p.id}
              onClick={() => setActivePlan(p)}
              style={{
                background: C.bgPrimary,
                border: "0.5px solid " + C.borderLight,
                borderLeft: p.member_ack_at
                  ? "3px solid " + C.tealMid
                  : "3px solid " + C.amberMid,
                borderRadius: 10,
                padding: "14px 16px",
                cursor: "pointer",
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
              }}
            >
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:700, color:C.textPrimary }}>
                  {p.plan_type || "Care Plan"} <span style={{ fontWeight:400, color:C.textTertiary }}>v{p.version}</span>
                </div>
                <div style={{ fontSize:11, color:C.textTertiary, marginTop:3 }}>
                  Shared {p.portal_shared_at ? fmtDate(p.portal_shared_at) : "-"}
                  {p.next_review_due && " · Next review " + fmtDate(p.next_review_due)}
                </div>
              </div>
              <div style={{ flexShrink:0 }}>
                {p.member_ack_at ? (
                  <Badge label="Acknowledged" variant="teal" />
                ) : (
                  <Badge label="Needs review" variant="amber" />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail view: fetches fresh signed URL + summary, lets patient ack.
// ─────────────────────────────────────────────────────────────────────────────
function CarePlanDetail({ planSummary, onClose }) {
  const [detail, setDetail]     = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [ackNotes, setAckNotes] = useState("");
  const [acking, setAcking]     = useState(false);

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
      <div>
        <div style={{ marginBottom:14, display:"flex", alignItems:"center", gap:12 }}>
          <Btn variant="ghost" onClick={onClose}>← Back</Btn>
          <div style={{ fontSize:17, fontWeight:600 }}>Loading your care plan...</div>
        </div>
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div>
        <div style={{ marginBottom:14, display:"flex", alignItems:"center", gap:12 }}>
          <Btn variant="ghost" onClick={onClose}>← Back</Btn>
        </div>
        <Panel>
          <div style={{ fontSize:12, color:C.red }}>{error}</div>
        </Panel>
      </div>
    );
  }

  if (!detail) return null;

  const isAcked = !!detail.already_acknowledged;
  const ackRoleLabel = detail.member_ack_role === "Member"
    ? "by you via the patient portal"
    : detail.member_ack_method
      ? "by your care team (" + String(detail.member_ack_method).toLowerCase() + ")"
      : "by your care team";

  return (
    <div>
      <div style={{ marginBottom:14, display:"flex", alignItems:"center", gap:12 }}>
        <Btn variant="ghost" onClick={onClose}>← Back</Btn>
        <div>
          <div style={{ fontSize:17, fontWeight:600, color:C.textPrimary }}>
            {detail.plan_type || "Care Plan"} <span style={{ fontWeight:400, color:C.textTertiary }}>v{detail.version}</span>
          </div>
          {detail.practice_name && (
            <div style={{ fontSize:11, color:C.textTertiary, marginTop:2 }}>{detail.practice_name}</div>
          )}
        </div>
      </div>

      {error && (
        <Panel>
          <div style={{ fontSize:12, color:C.red }}>{error}</div>
        </Panel>
      )}

      <Panel>
        <div style={{ fontSize:12, color:C.textSecondary, marginBottom:12, lineHeight:1.6 }}>
          This is your care plan. It was prepared by your care team to summarize your goals,
          the steps you and your team will take, and when we'll check in next.
        </div>

        <div style={{
          display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))",
          gap:10, marginBottom:14,
        }}>
          <Field label="Plan date"    value={detail.assessment_date ? fmtDate(detail.assessment_date) : "-"} />
          <Field label="Next check-in" value={detail.next_review_due ? fmtDate(detail.next_review_due) : "-"} />
          <Field label="Goals"        value={String(detail.goals_count) + " goal" + (detail.goals_count === 1 ? "" : "s")} />
          <Field label="Action steps" value={String(detail.interventions_count) + " step" + (detail.interventions_count === 1 ? "" : "s")} />
        </div>

        {Array.isArray(detail.goals_preview) && detail.goals_preview.length > 0 && (
          <div style={{ marginBottom:14 }}>
            <div style={{
              fontSize:10, fontWeight:600, textTransform:"uppercase",
              letterSpacing:"0.06em", color:C.textTertiary, marginBottom:8,
            }}>Your goals</div>
            <ul style={{ margin:0, paddingLeft:20, fontSize:13, color:C.textPrimary, lineHeight:1.6 }}>
              {detail.goals_preview.map((g, idx) => <li key={idx} style={{ marginBottom:4 }}>{g}</li>)}
            </ul>
            {detail.goals_count > detail.goals_preview.length && (
              <div style={{ fontSize:11, color:C.textTertiary, marginTop:6, fontStyle:"italic" }}>
                ...plus {detail.goals_count - detail.goals_preview.length} more in the full plan.
              </div>
            )}
          </div>
        )}

        {detail.signed_url && (
          <Btn
            variant="primary"
            onClick={() => window.open(detail.signed_url, "_blank", "noopener,noreferrer")}
          >
            Open full care plan (PDF)
          </Btn>
        )}
      </Panel>

      {isAcked ? (
        <Panel accent={C.tealMid}>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <div style={{
              width:36, height:36, borderRadius:"50%", background:C.tealBg,
              color:C.teal, fontSize:18, fontWeight:700,
              display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0,
            }}>✓</div>
            <div>
              <div style={{ fontSize:13, fontWeight:700, color:C.teal }}>
                Acknowledged {detail.member_ack_at ? "on " + fmtDate(detail.member_ack_at) : ""}
              </div>
              <div style={{ fontSize:11, color:C.textTertiary, marginTop:2 }}>
                Recorded {ackRoleLabel}.
              </div>
            </div>
          </div>
        </Panel>
      ) : (
        <Panel accent={C.amberMid}>
          <SectionHead title="Review and acknowledge" />
          <div style={{ fontSize:12, color:C.textSecondary, marginBottom:12, lineHeight:1.6 }}>
            Please open the full care plan PDF above and read it over. When you're ready,
            confirm that you've reviewed it. You can also add a note or question for your
            care team (optional).
          </div>
          <textarea
            value={ackNotes}
            onChange={(e) => setAckNotes(e.target.value)}
            placeholder="Optional note (e.g. I'd like to talk about goal #2 at our next visit)"
            rows={3}
            style={{
              width:"100%", boxSizing:"border-box",
              padding:"8px 10px", fontSize:12, lineHeight:1.5,
              border:"0.5px solid " + C.borderMid, borderRadius:6,
              fontFamily:"inherit", resize:"vertical", outline:"none",
              background:C.bgPrimary, color:C.textPrimary,
              marginBottom:10,
            }}
          />
          <div style={{ display:"flex", justifyContent:"flex-end" }}>
            <Btn variant="primary" disabled={acking} onClick={handleAck}>
              {acking ? "Saving..." : "I've reviewed my care plan"}
            </Btn>
          </div>
        </Panel>
      )}
    </div>
  );
}

const Field = ({ label, value }) => (
  <div>
    <div style={{
      fontSize:9.5, fontWeight:600, textTransform:"uppercase",
      letterSpacing:"0.06em", color:C.textTertiary, marginBottom:3,
    }}>{label}</div>
    <div style={{ fontSize:13, color: value ? C.textPrimary : C.textTertiary }}>{value || "-"}</div>
  </div>
);
