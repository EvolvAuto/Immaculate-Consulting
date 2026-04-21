// ═══════════════════════════════════════════════════════════════════════════════
// src/views/portal/PortalHRSNView.jsx
//
// Patient-facing HRSN screener. Rendered inside PortalShell when tab = "hrsn"
// (typically reached via deep link from the practice's outreach SMS/email).
//
// States:
//   1. Loading                                  - fetching recent submissions
//   2. Completed (recent screening exists)      - thank-you + summary
//   3. Form                                     - renders HOPScreenerForm
//   4. Submitted (just finished)                - confirmation
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import HOPScreenerForm from "../../components/hrsn/HOPScreenerForm";

const C = {
  teal: "#0F6E56", tealMid: "#1D9E75", tealBg: "#E1F5EE", tealBorder: "#9FE1CB",
  amber: "#854F0B", amberBg: "#FAEEDA", amberBorder: "#FAC775",
  bgPrimary: "#ffffff", bgSecondary: "#f7f7f5",
  textPrimary: "#1a1a18", textSecondary: "#6b6a63", textTertiary: "#9c9b94",
  borderLight: "rgba(0,0,0,0.08)", borderMid: "rgba(0,0,0,0.18)",
};

// How recently does a submission count as "already done"?
const RECENT_DAYS = 14;

export default function PortalHRSNView(props) {
  const patient     = props.patient;
  const patientId   = props.patientId;
  const practiceId  = props.practiceId;
  const refreshBadges = props.refreshBadges;

  const [loading, setLoading]           = useState(true);
  const [existingRecent, setExisting]   = useState(null);
  const [justSubmitted, setSubmitted]   = useState(null);
  const [retakeRequested, setRetake]    = useState(false);
  const [fetchError, setFetchError]     = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async function() {
      if (!patientId) return;
      try {
        const { data, error } = await supabase
          .from("screener_responses")
          .select("id, completed_at, ai_summary_status, flags")
          .eq("patient_id", patientId)
          .eq("screener_type", "HRSN")
          .order("completed_at", { ascending: false })
          .limit(1);
        if (cancelled) return;
        if (error) throw error;
        const last = (data && data[0]) ? data[0] : null;
        if (last) {
          const daysAgo = (Date.now() - new Date(last.completed_at).getTime()) / 86400000;
          if (daysAgo <= RECENT_DAYS) {
            setExisting(last);
          }
        }
      } catch (e) {
        if (!cancelled) setFetchError(e && e.message ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return function() { cancelled = true; };
  }, [patientId]);

  const handleSubmit = async function(payload) {
    // Insert is gated by screener_patient_insert RLS: patient_id and
    // practice_id must match JWT claims.
    const { data, error } = await supabase
      .from("screener_responses")
      .insert({
        practice_id:       practiceId,
        patient_id:        patientId,
        screener_type:     "HRSN",
        administered_via:  "Patient Portal",
        completion_mode:   "Portal Self",
        responses:         payload.responses,
        flags:             payload.flags,
        total_score:       payload.total_score,
        severity:          payload.severity,
        requires_followup: payload.requires_followup,
        completed_at:      new Date().toISOString(),
      })
      .select("id, ai_summary_status")
      .single();
    if (error) throw error;

    setSubmitted(data);
    setExisting(null);
    setRetake(false);
    if (refreshBadges) refreshBadges();
  };

  if (loading) {
    return (
      <div style={centerBox}>
        <div style={{ fontSize: 13, color: C.textSecondary }}>Loading...</div>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div style={centerBox}>
        <div style={{
          padding: "14px 18px", background: "#FCEBEB",
          border: "0.5px solid #F5B8B8", color: "#A32D2D",
          borderRadius: 6, fontSize: 13, maxWidth: 520,
        }}>
          Could not load screening status: {fetchError}
        </div>
      </div>
    );
  }

  if (justSubmitted) {
    return (
      <SubmittedState patient={patient} />
    );
  }

  if (existingRecent && !retakeRequested) {
    return (
      <AlreadyCompletedState
        recent={existingRecent}
        onRetake={function() { setRetake(true); }}
      />
    );
  }

  return (
    <HOPScreenerForm
      completionMode="Portal Self"
      patientName={patient ? ((patient.first_name || "") + " " + (patient.last_name || "")).trim() : null}
      onSubmit={handleSubmit}
    />
  );
}

// ───────────────────────────────────────────────────────────────────────────────
// States
// ───────────────────────────────────────────────────────────────────────────────

function SubmittedState({ patient }) {
  return (
    <div style={centerBox}>
      <div style={{
        background: C.tealBg, border: "0.5px solid " + C.tealBorder,
        borderRadius: 10, padding: "24px 28px", maxWidth: 560, textAlign: "center",
      }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>{"\u2713"}</div>
        <div style={{ fontSize: 17, fontWeight: 700, color: C.teal, marginBottom: 8 }}>
          Thank you{patient && patient.first_name ? ", " + patient.first_name : ""}.
        </div>
        <div style={{ fontSize: 13, color: C.textPrimary, lineHeight: 1.6, marginBottom: 8 }}>
          Your screening has been submitted. Your care team will review your answers
          before your next visit and follow up with any resources that may help.
        </div>
        <div style={{ fontSize: 12, color: C.textSecondary, lineHeight: 1.5 }}>
          You can now close this page. If you need to update anything, your care
          team can update it with you at your visit.
        </div>
      </div>
    </div>
  );
}

function AlreadyCompletedState({ recent, onRetake }) {
  const when = new Date(recent.completed_at).toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });
  return (
    <div style={centerBox}>
      <div style={{
        background: C.bgPrimary, border: "0.5px solid " + C.borderLight,
        borderRadius: 10, padding: "24px 28px", maxWidth: 560, textAlign: "center",
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary, marginBottom: 10 }}>
          You completed a social needs screening on {when}
        </div>
        <div style={{ fontSize: 13, color: C.textSecondary, lineHeight: 1.6, marginBottom: 16 }}>
          You don't need to complete it again right now. Your care team has your
          most recent answers on file. If something in your life has changed, you
          can update your screening below.
        </div>
        <button
          onClick={onRetake}
          style={{
            background: "#fff", color: C.teal,
            border: "0.5px solid " + C.tealBorder,
            padding: "9px 18px", borderRadius: 6,
            fontSize: 13, fontWeight: 600, cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Update my screening
        </button>
      </div>
    </div>
  );
}

const centerBox = {
  minHeight: "60vh",
  display: "flex", alignItems: "center", justifyContent: "center",
  padding: 24,
};
