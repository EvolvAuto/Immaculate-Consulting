// ═══════════════════════════════════════════════════════════════════════════════
// src/views/InsuranceUpdatesView.jsx
//
// Staff-side review queue for patient-submitted insurance updates.
// Reads insurance_update_requests, shows the requested changes side-by-side
// with the current policy on file (if any), and lets staff either:
//   - Approve & Apply: upserts insurance_policies for (patient, rank), stamps
//     the request as 'Approved' with applied_policy_id
//   - Reject: marks request 'Rejected' with a required reason the patient sees
//
// Handles both primary (rank=1) and secondary (rank=2) requests.
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../auth/AuthProvider";
import { C } from "../lib/tokens";
import { logAudit } from "../lib/db";
import {
  Badge, Btn, Card, Modal, Input, FL, SectionHead, Loader, ErrorBanner, EmptyState,
} from "../components/ui";

export default function InsuranceUpdatesView() {
  const { practiceId, profile } = useAuth();
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [statusFilter, setStatusFilter] = useState("Pending Review");
  const [requests, setRequests] = useState([]);
  const [patientsById, setPatientsById] = useState({});
  const [policiesByKey, setPoliciesByKey] = useState({}); // "patientId-rank" -> policy
  const [acting, setActing]     = useState(null); // { req, mode: 'apply'|'reject' }

  const load = async () => {
    try {
      setLoading(true);
      setError(null);

      const [rRes, pRes] = await Promise.all([
        supabase.from("insurance_update_requests")
          .select("*")
          .eq("practice_id", practiceId)
          .order("created_at", { ascending: false })
          .limit(200),
        supabase.from("insurance_policies")
          .select("*")
          .eq("practice_id", practiceId),
      ]);
      if (rRes.error) throw rRes.error;
      if (pRes.error) throw pRes.error;

      const reqs = rRes.data || [];
      const pols = pRes.data || [];

      // Bulk-load patients referenced in requests
      const patientIds = [...new Set(reqs.map(r => r.patient_id))];
      let patientsMap = {};
      if (patientIds.length > 0) {
        const { data: pts } = await supabase.from("patients")
          .select("id, first_name, last_name, mrn, date_of_birth")
          .in("id", patientIds);
        patientsMap = Object.fromEntries((pts || []).map(p => [p.id, p]));
      }

      const policyMap = {};
      pols.forEach(p => { policyMap[p.patient_id + "-" + p.rank] = p; });

      setRequests(reqs);
      setPatientsById(patientsMap);
      setPoliciesByKey(policyMap);
    } catch (e) {
      setError((e && e.message) || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (practiceId) load(); }, [practiceId]);

  const counts = useMemo(() => {
    const c = { All: requests.length, "Pending Review": 0, Approved: 0, Rejected: 0 };
    requests.forEach(r => { c[r.status] = (c[r.status] || 0) + 1; });
    return c;
  }, [requests]);

  const filtered = useMemo(() => {
    if (statusFilter === "All") return requests;
    return requests.filter(r => r.status === statusFilter);
  }, [requests, statusFilter]);

  if (loading) return <Loader />;
  if (error)   return <ErrorBanner msg={error} />;

  return (
    <div>
      <SectionHead
        title="Insurance Updates"
        sub="Review patient-submitted changes to primary and secondary coverage. Approving applies the change to the patient's chart."
      />

      {/* Status filter pills */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {["Pending Review", "Approved", "Rejected", "All"].map(s => {
          const active = statusFilter === s;
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              style={{
                padding: "6px 12px", borderRadius: 20,
                border: "0.5px solid " + (active ? C.tealBorder : C.borderMid),
                background: active ? C.tealBg : "#fff",
                color: active ? C.teal : C.textSecondary,
                fontSize: 11, fontWeight: 600, cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {s} ({counts[s] || 0})
            </button>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <EmptyState title={"No " + statusFilter.toLowerCase() + " requests"} />
      )}

      {filtered.map(r => {
        const pt = patientsById[r.patient_id];
        const currentPolicy = policiesByKey[r.patient_id + "-" + r.rank];
        return (
          <RequestRow
            key={r.id}
            req={r}
            patient={pt}
            currentPolicy={currentPolicy}
            onApply={() => setActing({ req: r, mode: "apply" })}
            onReject={() => setActing({ req: r, mode: "reject" })}
          />
        );
      })}

      {acting && (
        <ActionModal
          action={acting}
          currentPolicy={policiesByKey[acting.req.patient_id + "-" + acting.req.rank]}
          reviewerId={profile && profile.id}
          onClose={() => setActing(null)}
          onDone={() => { setActing(null); load(); }}
        />
      )}
    </div>
  );
}

// ─── Single request row with inline side-by-side comparison ────────────────
function RequestRow({ req, patient, currentPolicy, onApply, onReject }) {
  const submitted = new Date(req.created_at).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          {/* Header row: patient name, rank badge, mrn */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary }}>
              {patient ? (patient.first_name + " " + patient.last_name) : "Unknown patient"}
            </div>
            <Badge label={req.rank === 1 ? "Primary" : "Secondary"}
                   variant={req.rank === 1 ? "teal" : "purple"} />
            {patient && patient.mrn && (
              <span style={{ fontSize: 10, color: C.textTertiary, fontFamily: "'DM Mono', monospace" }}>
                MRN {patient.mrn}
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: C.textTertiary, marginBottom: 10 }}>
            Submitted {submitted}
          </div>

          {/* Side-by-side comparison */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <ComparisonBlock
              title="Current on file"
              tone="neutral"
              values={[
                ["Payer",        currentPolicy && currentPolicy.payer_name],
                ["Member ID",    currentPolicy && currentPolicy.member_id],
                ["Group #",      currentPolicy && currentPolicy.group_number],
                ["Plan",         currentPolicy && currentPolicy.plan_name],
                ["Subscriber",   currentPolicy && [(currentPolicy.subscriber_first_name || ""), (currentPolicy.subscriber_last_name || "")].filter(Boolean).join(" ")],
                ["Relationship", currentPolicy && currentPolicy.subscriber_relation],
              ]}
              empty={!currentPolicy}
            />
            <ComparisonBlock
              title="Patient submitted"
              tone="requested"
              values={[
                ["Payer",        req.payer_name],
                ["Member ID",    req.member_id],
                ["Group #",      req.group_number],
                ["Plan",         req.plan_name],
                ["Subscriber",   req.subscriber_name],
                ["Relationship", req.relationship],
              ]}
              compareTo={currentPolicy}
            />
          </div>

          {req.notes && (
            <div style={{
              marginTop: 10, padding: "8px 12px",
              background: C.bgSecondary, borderRadius: 5,
              fontSize: 11, color: C.textSecondary, fontStyle: "italic",
            }}>
              Patient note: {req.notes}
            </div>
          )}

          {req.status === "Rejected" && req.review_note && (
            <div style={{
              marginTop: 10, padding: "8px 12px",
              background: C.redBg, border: "0.5px solid " + C.redBorder, borderRadius: 5,
              fontSize: 11, color: C.red,
            }}>
              Rejected: {req.review_note}
            </div>
          )}

          {req.status === "Approved" && (
            <div style={{
              marginTop: 10, padding: "8px 12px",
              background: C.tealBg, border: "0.5px solid " + C.tealBorder, borderRadius: 5,
              fontSize: 11, color: C.teal,
            }}>
              Applied to patient chart
              {req.reviewed_at ? " on " + new Date(req.reviewed_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""}
              {req.review_note ? " - " + req.review_note : ""}
            </div>
          )}
        </div>

        {/* Right rail: status + actions */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", minWidth: 140 }}>
          <Badge label={req.status}
                 variant={req.status === "Approved" ? "teal" :
                          req.status === "Rejected" ? "red" : "amber"} />
          {req.status === "Pending Review" && (
            <>
              <Btn onClick={onApply}>Approve & Apply</Btn>
              <Btn variant="secondary" onClick={onReject}>Reject</Btn>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

// ─── Side-by-side comparison block; flags diffs on the "requested" side ─────
function ComparisonBlock({ title, values, empty, tone, compareTo }) {
  const bg = tone === "requested" ? C.tealBg : "#fff";
  const borderColor = tone === "requested" ? C.tealBorder : C.borderLight;
  const titleColor = tone === "requested" ? C.teal : C.textTertiary;

  const compareFields = compareTo ? {
    payer_name:   compareTo.payer_name,
    member_id:    compareTo.member_id,
    group_number: compareTo.group_number,
    plan_name:    compareTo.plan_name,
    subscriber:   [(compareTo.subscriber_first_name || ""), (compareTo.subscriber_last_name || "")].filter(Boolean).join(" "),
    relationship: compareTo.subscriber_relation,
  } : null;
  const compareMap = {
    "Payer": compareFields && compareFields.payer_name,
    "Member ID": compareFields && compareFields.member_id,
    "Group #": compareFields && compareFields.group_number,
    "Plan": compareFields && compareFields.plan_name,
    "Subscriber": compareFields && compareFields.subscriber,
    "Relationship": compareFields && compareFields.relationship,
  };

  if (empty) {
    return (
      <div style={{ padding: 10, border: "0.5px solid " + borderColor, borderRadius: 6, background: C.bgSecondary }}>
        <div style={{
          fontSize: 9, color: titleColor, fontWeight: 700,
          textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4,
        }}>{title}</div>
        <div style={{ fontSize: 11, color: C.textTertiary, fontStyle: "italic" }}>No policy on file</div>
      </div>
    );
  }

  return (
    <div style={{ padding: 10, border: "0.5px solid " + borderColor, borderRadius: 6, background: bg }}>
      <div style={{
        fontSize: 9, color: titleColor, fontWeight: 700,
        textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6,
      }}>{title}</div>
      {values.map(([label, v]) => {
        const existing = compareMap[label];
        const changed = compareFields && String(v || "").trim() !== String(existing || "").trim();
        return (
          <div key={label} style={{
            display: "flex", justifyContent: "space-between", fontSize: 11, padding: "2px 0",
            color: v ? C.textPrimary : C.textTertiary,
          }}>
            <span style={{ color: C.textTertiary }}>{label}</span>
            <span style={{
              fontWeight: changed ? 700 : 400,
              color: changed ? C.amber : undefined,
              textAlign: "right",
            }}>
              {v || "-"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Action modal: Approve & Apply / Reject with reason ────────────────────
function ActionModal({ action, currentPolicy, reviewerId, onClose, onDone }) {
  const { req, mode } = action;
  const [note, setNote]     = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState(null);

  const apply = async () => {
    setSaving(true); setErr(null);
    try {
      // Split "First Last" name into first + last for insurance_policies schema
      const subName = (req.subscriber_name || "").trim();
      let first = null, last = null;
      if (subName) {
        const parts = subName.split(/\s+/);
        first = parts[0];
        last = parts.length > 1 ? parts.slice(1).join(" ") : null;
      }

      const policyPayload = {
        practice_id:           req.practice_id,
        patient_id:            req.patient_id,
        rank:                  req.rank,
        payer_name:            req.payer_name || "Unknown",
        // payer_category is an enum and required. Keep existing category if updating,
        // otherwise default to "Commercial"; staff can correct it on the patient chart.
        payer_category:        (currentPolicy && currentPolicy.payer_category) || "Commercial",
        member_id:             req.member_id || "Unknown",
        group_number:          req.group_number || null,
        plan_name:             req.plan_name || null,
        subscriber_first_name: first,
        subscriber_last_name:  last,
        subscriber_dob:        req.subscriber_dob || null,
        subscriber_relation:   req.relationship || "Self",
        is_active:             true,
        updated_at:            new Date().toISOString(),
      };

      let policyId;
      if (currentPolicy) {
        const { error } = await supabase
          .from("insurance_policies")
          .update(policyPayload)
          .eq("id", currentPolicy.id);
        if (error) throw error;
        policyId = currentPolicy.id;
      } else {
        const { data, error } = await supabase
          .from("insurance_policies")
          .insert(policyPayload)
          .select("id")
          .single();
        if (error) throw error;
        policyId = data.id;
      }

      const { error: uErr } = await supabase
        .from("insurance_update_requests")
        .update({
          status:            "Approved",
          reviewed_by:       reviewerId,
          reviewed_at:       new Date().toISOString(),
          review_note:       note.trim() || null,
          applied_policy_id: policyId,
        })
        .eq("id", req.id);
      if (uErr) throw uErr;

      logAudit({
        action: "Update",
        entityType: "insurance_update_request",
        entityId: req.id,
        details: { status: "Approved", rank: req.rank, policy_id: policyId },
      }).catch(() => {});

      onDone();
    } catch (e) {
      setErr((e && e.message) || String(e));
      setSaving(false);
    }
  };

  const reject = async () => {
    if (!note.trim()) {
      setErr("A reason is required when rejecting an update. The patient will see this in their portal.");
      return;
    }
    setSaving(true); setErr(null);
    try {
      const { error } = await supabase
        .from("insurance_update_requests")
        .update({
          status:      "Rejected",
          reviewed_by: reviewerId,
          reviewed_at: new Date().toISOString(),
          review_note: note.trim(),
        })
        .eq("id", req.id);
      if (error) throw error;

      logAudit({
        action: "Update",
        entityType: "insurance_update_request",
        entityId: req.id,
        details: { status: "Rejected", rank: req.rank, reason: note.trim() },
      }).catch(() => {});

      onDone();
    } catch (e) {
      setErr((e && e.message) || String(e));
      setSaving(false);
    }
  };

  const title = mode === "apply"
    ? ("Approve & Apply " + (req.rank === 1 ? "Primary" : "Secondary") + " Update")
    : ("Reject " + (req.rank === 1 ? "Primary" : "Secondary") + " Update");

  const subtitle = mode === "apply"
    ? (currentPolicy
        ? "This will update the existing " + (req.rank === 1 ? "primary" : "secondary") + " insurance policy on the patient chart."
        : "This will create a new " + (req.rank === 1 ? "primary" : "secondary") + " insurance policy on the patient chart.")
    : "The patient will see this reason in their portal.";

  return (
    <Modal onClose={onClose}>
      <div style={{ padding: 16, minWidth: 420, maxWidth: 520 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4, color: C.textPrimary }}>{title}</div>
        <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 14 }}>{subtitle}</div>

        {err && (
          <div style={{
            fontSize: 11, color: C.red, background: C.redBg,
            border: "0.5px solid " + C.redBorder, padding: "6px 10px",
            borderRadius: 4, marginBottom: 10,
          }}>{err}</div>
        )}

        <FL label={mode === "apply" ? "Review note (optional)" : "Reason for rejection (required)"}>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder={mode === "apply"
              ? "e.g. Verified with payer on 4/19. Effective 4/1/2026."
              : "e.g. Member ID does not match records. Please send a copy of your insurance card."}
            style={{
              width: "100%", padding: "8px 10px",
              fontSize: 12, fontFamily: "inherit",
              border: "0.5px solid " + C.borderMid, borderRadius: 5,
              boxSizing: "border-box", resize: "vertical",
            }}
          />
        </FL>

        <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
          <Btn variant="ghost" onClick={onClose} disabled={saving}>Cancel</Btn>
          {mode === "apply"
            ? <Btn onClick={apply} disabled={saving}>{saving ? "Applying..." : "Approve & Apply"}</Btn>
            : <Btn variant="danger" onClick={reject} disabled={saving}>{saving ? "Rejecting..." : "Reject"}</Btn>}
        </div>
      </div>
    </Modal>
  );
}
