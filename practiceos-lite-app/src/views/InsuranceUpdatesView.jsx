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

import { useEffect, useMemo, useRef, useState } from "react";
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
    <div style={{ paddingTop: 12 }}>
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
            practiceId={practiceId}
            onApply={(ocrPatch) => setActing({ req: r, mode: "apply", ocrPatch: ocrPatch || {} })}
            onReject={() => setActing({ req: r, mode: "reject" })}
            onRequestReload={load}
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
function RequestRow({ req, patient, currentPolicy, practiceId, onApply, onReject, onRequestReload }) {
  const submitted = new Date(req.created_at).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });

  // Local mirror of the OCR fields on this request. We re-fetch on mount so the
  // status reflects any processing that happened after the page loaded, and we
  // poll while the status is Queued or Running.
  const [ocr, setOcr] = useState({
    status:         req.ocr_status || "None",
    extracted:      req.ocr_extracted || null,
    attempts:       req.ocr_attempts || 0,
    error:          req.ocr_error || null,
    completed_at:   req.ocr_completed_at || null,
  });
  // Map of field-name -> accepted OCR value. Keys match what apply() consumes:
  // payer_name, member_id, group_number, plan_name, subscriber_name, subscriber_dob, relationship
  const [ocrPatch, setOcrPatch] = useState({});
  const pollRef = useRef(null);

  const fetchOcr = async () => {
    const { data, error } = await supabase
      .from("insurance_update_requests")
      .select("ocr_status, ocr_extracted, ocr_attempts, ocr_error, ocr_completed_at")
      .eq("id", req.id)
      .single();
    if (!error && data) {
      setOcr({
        status:       data.ocr_status || "None",
        extracted:    data.ocr_extracted || null,
        attempts:     data.ocr_attempts || 0,
        error:        data.ocr_error || null,
        completed_at: data.ocr_completed_at || null,
      });
    }
  };

  // Initial fetch + polling loop
  useEffect(() => {
    fetchOcr();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req.id]);

  useEffect(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (ocr.status === "Queued" || ocr.status === "Running") {
      pollRef.current = setInterval(fetchOcr, 3000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ocr.status]);

  const handleAcceptField = (field, value) => {
    setOcrPatch(prev => Object.assign({}, prev, { [field]: value }));
  };

  const handleAcceptAllHighConfidence = () => {
    if (!ocr.extracted || !ocr.extracted.extractions) return;
    const patch = {};
    const ex = ocr.extracted.extractions;
    const mappings = [
      ["payer_name",       "payer_name"],
      ["member_id",        "member_id"],
      ["group_number",     "group_number"],
      ["plan_name",        "plan_name"],
      ["subscriber_name",  "subscriber_name"],
      ["subscriber_dob",   "subscriber_dob"],
    ];
    mappings.forEach(([ocrKey, reqKey]) => {
      const f = ex[ocrKey];
      if (f && f.confidence === "high" && f.value) patch[reqKey] = f.value;
    });
    setOcrPatch(patch);
  };

  const handleClearPatch = () => setOcrPatch({});

  const handleRerun = async () => {
    try {
      setOcr(prev => Object.assign({}, prev, { status: "Queued", error: null }));
      const { data: sessionRes } = await supabase.auth.getSession();
      const token = sessionRes && sessionRes.session ? sessionRes.session.access_token : null;
      const { data, error } = await supabase.functions.invoke("pro-insurance-ocr", {
        body: { request_id: req.id },
        headers: token ? { Authorization: "Bearer " + token } : {},
      });
      if (error) throw error;
      if (data && data.error) throw new Error(data.error);
      // fetchOcr will pick up the new state via the polling loop
    } catch (e) {
      setOcr(prev => Object.assign({}, prev, {
        status: "Failed",
        error: (e && e.message) || String(e),
      }));
    }
  };

  // Merge patch into request view for the comparison column so reviewers see
  // the effect of their accepted OCR values before hitting Approve & Apply.
  const patchedReq = Object.assign({}, req, ocrPatch);
  const hasPatch = Object.keys(ocrPatch).length > 0;

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
              title={hasPatch ? "Patient submitted + OCR overrides" : "Patient submitted"}
              tone="requested"
              values={[
                ["Payer",        patchedReq.payer_name],
                ["Member ID",    patchedReq.member_id],
                ["Group #",      patchedReq.group_number],
                ["Plan",         patchedReq.plan_name],
                ["Subscriber",   patchedReq.subscriber_name],
                ["Relationship", patchedReq.relationship],
              ]}
              patchedFields={ocrPatch}
              compareTo={currentPolicy}
            />
          </div>

          <CardThumbnails front={req.front_image_url} back={req.back_image_url} />

          {/* AI-extracted fields panel */}
          <OCRSuggestionPanel
            ocr={ocr}
            req={req}
            patchedReq={patchedReq}
            ocrPatch={ocrPatch}
            onAcceptField={handleAcceptField}
            onAcceptAllHighConfidence={handleAcceptAllHighConfidence}
            onClearPatch={handleClearPatch}
            onRerun={handleRerun}
          />

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
              <Btn onClick={() => onApply(ocrPatch)}>Approve & Apply</Btn>
              <Btn variant="secondary" onClick={onReject}>Reject</Btn>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

// ─── Side-by-side comparison block; flags diffs on the "requested" side ─────
function ComparisonBlock({ title, values, empty, tone, compareTo, patchedFields }) {
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
  const patchedMap = {
    "Payer":        patchedFields && Object.prototype.hasOwnProperty.call(patchedFields, "payer_name"),
    "Member ID":    patchedFields && Object.prototype.hasOwnProperty.call(patchedFields, "member_id"),
    "Group #":      patchedFields && Object.prototype.hasOwnProperty.call(patchedFields, "group_number"),
    "Plan":         patchedFields && Object.prototype.hasOwnProperty.call(patchedFields, "plan_name"),
    "Subscriber":   patchedFields && Object.prototype.hasOwnProperty.call(patchedFields, "subscriber_name"),
    "Relationship": patchedFields && Object.prototype.hasOwnProperty.call(patchedFields, "relationship"),
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
        const fromOcr = patchedMap[label];
        return (
          <div key={label} style={{
            display: "flex", justifyContent: "space-between", fontSize: 11, padding: "2px 0",
            color: v ? C.textPrimary : C.textTertiary,
          }}>
            <span style={{ color: C.textTertiary }}>
              {label}
              {fromOcr && (
                <span style={{
                  marginLeft: 4, fontSize: 8, fontWeight: 700,
                  color: C.teal, background: "#fff",
                  border: "0.5px solid " + C.tealBorder, borderRadius: 3,
                  padding: "1px 4px", letterSpacing: 0.3,
                }}>AI</span>
              )}
            </span>
            <span style={{
              fontWeight: changed ? 700 : 400,
              color: fromOcr ? C.teal : (changed ? C.amber : undefined),
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

// ─── AI-extracted insurance card fields panel ──────────────────────────────
// Displays OCR status, extracted fields with confidence indicators, and
// per-field accept buttons that apply values into the request patch before
// the reviewer clicks Approve & Apply.
function OCRSuggestionPanel({ ocr, req, patchedReq, ocrPatch, onAcceptField, onAcceptAllHighConfidence, onClearPatch, onRerun }) {
  const status    = ocr.status || "None";
  const extracted = ocr.extracted;

  // The underlying request isn't in a state where OCR makes sense
  if (!req.front_image_url) return null;
  // Already approved/rejected: show a compact read-only summary if extraction exists
  const isTerminalRequest = req.status !== "Pending Review";

  // Status chip coloring
  const statusChip = (() => {
    if (status === "Success")  return { bg: C.tealBg,  fg: C.teal,   border: C.tealBorder,  label: "AI extracted" };
    if (status === "Running")  return { bg: C.amberBg || "#fef3c7", fg: C.amber || "#b45309", border: C.amberBorder || "#fcd34d", label: "AI reading card…" };
    if (status === "Queued")   return { bg: C.amberBg || "#fef3c7", fg: C.amber || "#b45309", border: C.amberBorder || "#fcd34d", label: "AI queued" };
    if (status === "Failed")   return { bg: C.redBg,   fg: C.red,    border: C.redBorder,    label: "AI read failed" };
    if (status === "Skipped")  return { bg: C.bgSecondary, fg: C.textTertiary, border: C.borderMid, label: "AI skipped" };
    return { bg: C.bgSecondary, fg: C.textTertiary, border: C.borderMid, label: "AI not run" };
  })();

  const canRerun = status === "Failed" || status === "Success" || status === "None" || status === "Skipped";
  const isPolling = status === "Queued" || status === "Running";

  const highConfidenceCount = (() => {
    if (!extracted || !extracted.extractions) return 0;
    let n = 0;
    Object.values(extracted.extractions).forEach(f => {
      if (f && f.confidence === "high" && f.value) n++;
    });
    return n;
  })();

  // Field definitions: label, OCR key (in extracted.extractions), request key (for the patch)
  const fields = [
    { label: "Payer",        ocrKey: "payer_name",      reqKey: "payer_name" },
    { label: "Member ID",    ocrKey: "member_id",       reqKey: "member_id" },
    { label: "Group #",      ocrKey: "group_number",    reqKey: "group_number" },
    { label: "Plan",         ocrKey: "plan_name",       reqKey: "plan_name" },
    { label: "Subscriber",   ocrKey: "subscriber_name", reqKey: "subscriber_name" },
    { label: "DOB",          ocrKey: "subscriber_dob",  reqKey: "subscriber_dob" },
  ];
  // Secondary fields shown below a divider (no reqKey -> informational only, no accept button)
  const secondaryFields = [
    { label: "Effective",             ocrKey: "effective_date" },
    { label: "Office copay",          ocrKey: "copay_office_visit" },
    { label: "Specialist copay",      ocrKey: "copay_specialist" },
    { label: "Urgent care copay",     ocrKey: "copay_urgent_care" },
    { label: "ER copay",              ocrKey: "copay_er" },
    { label: "Rx BIN",                ocrKey: "bin" },
    { label: "Rx PCN",                ocrKey: "pcn" },
    { label: "Rx Group",              ocrKey: "rx_group" },
    { label: "Member services",       ocrKey: "member_services_phone" },
    { label: "Claims phone",          ocrKey: "claims_phone" },
  ];

  return (
    <div style={{
      marginTop: 12,
      border: "0.5px solid " + statusChip.border,
      borderRadius: 6,
      background: status === "Success" ? "#fff" : C.bgSecondary,
      overflow: "hidden",
    }}>
      {/* Header strip */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 12px", background: statusChip.bg, gap: 8, flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{
            fontSize: 9, fontWeight: 700, color: statusChip.fg,
            textTransform: "uppercase", letterSpacing: 0.5,
            padding: "2px 6px", background: "#fff",
            border: "0.5px solid " + statusChip.border, borderRadius: 3,
          }}>{statusChip.label}</span>
          {extracted && extracted.image_quality && (
            <span style={{ fontSize: 10, color: C.textTertiary }}>
              Image quality: <strong style={{ color: C.textSecondary }}>{extracted.image_quality}</strong>
            </span>
          )}
          {status === "Success" && highConfidenceCount > 0 && (
            <span style={{ fontSize: 10, color: C.textTertiary }}>
              {highConfidenceCount} high-confidence {highConfidenceCount === 1 ? "field" : "fields"}
            </span>
          )}
          {isPolling && (
            <span style={{ fontSize: 10, color: C.textTertiary, fontStyle: "italic" }}>
              Checking every 3 seconds…
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {!isTerminalRequest && Object.keys(ocrPatch || {}).length > 0 && (
            <button onClick={onClearPatch}
                    style={{
                      fontSize: 10, padding: "3px 8px",
                      background: "#fff", color: C.textSecondary,
                      border: "0.5px solid " + C.borderMid, borderRadius: 4,
                      cursor: "pointer", fontFamily: "inherit",
                    }}>
              Clear overrides
            </button>
          )}
          {!isTerminalRequest && status === "Success" && highConfidenceCount > 0 && (
            <button onClick={onAcceptAllHighConfidence}
                    style={{
                      fontSize: 10, padding: "3px 8px",
                      background: C.teal, color: "#fff",
                      border: "0.5px solid " + C.teal, borderRadius: 4,
                      cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
                    }}>
              Accept all high-confidence
            </button>
          )}
          {!isTerminalRequest && canRerun && (
            <button onClick={onRerun}
                    style={{
                      fontSize: 10, padding: "3px 8px",
                      background: "#fff", color: C.teal,
                      border: "0.5px solid " + C.tealBorder, borderRadius: 4,
                      cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
                    }}>
              {status === "None" ? "Run AI extract" : "Re-run AI"}
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      {status === "Failed" && (
        <div style={{ padding: 10, fontSize: 11, color: C.red }}>
          {ocr.error ? ocr.error : "AI extraction failed."}
          {ocr.attempts >= 3 && (
            <div style={{ marginTop: 4, fontSize: 10, color: C.textTertiary }}>
              Max attempts ({ocr.attempts}) reached. Reviewer should enter fields manually.
            </div>
          )}
        </div>
      )}

      {isPolling && (
        <div style={{ padding: 10, fontSize: 11, color: C.textSecondary, fontStyle: "italic" }}>
          Reading card image… this usually takes 5-15 seconds.
        </div>
      )}

      {status === "Success" && extracted && extracted.extractions && (
        <div style={{ padding: 10 }}>
          {/* Payer category suggestion */}
          {extracted.suggested_payer_category && (
            <div style={{
              marginBottom: 10, padding: "6px 10px",
              background: C.tealBg, border: "0.5px solid " + C.tealBorder, borderRadius: 4,
              fontSize: 11, color: C.teal,
            }} title={extracted.payer_category_reasoning || ""}>
              <strong>Suggested payer category:</strong> {extracted.suggested_payer_category}
              {extracted.payer_category_reasoning && (
                <div style={{ fontSize: 10, color: C.textSecondary, marginTop: 2, fontStyle: "italic" }}>
                  {extracted.payer_category_reasoning}
                </div>
              )}
            </div>
          )}

          {/* Primary fields with accept buttons */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}>
            {fields.map(f => {
              const extraction = extracted.extractions[f.ocrKey];
              if (!extraction) return null;
              return (
                <OCRFieldRow
                  key={f.ocrKey}
                  label={f.label}
                  extraction={extraction}
                  currentRequestValue={req[f.reqKey]}
                  appliedValue={ocrPatch[f.reqKey]}
                  isTerminal={isTerminalRequest}
                  onAccept={() => onAcceptField(f.reqKey, extraction.value)}
                />
              );
            })}
          </div>

          {/* Secondary fields (no accept buttons, no request-mapping) */}
          <details style={{ fontSize: 11, color: C.textSecondary }}>
            <summary style={{ cursor: "pointer", color: C.textTertiary, fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>
              Additional extracted fields
            </summary>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginTop: 6 }}>
              {secondaryFields.map(f => {
                const extraction = extracted.extractions[f.ocrKey];
                if (!extraction || !extraction.value) return null;
                return (
                  <div key={f.ocrKey} style={{
                    display: "flex", justifyContent: "space-between",
                    fontSize: 10, padding: "2px 6px",
                    background: C.bgSecondary, borderRadius: 3,
                  }}>
                    <span style={{ color: C.textTertiary }}>{f.label}</span>
                    <span style={{ color: C.textPrimary, fontWeight: 500 }}>{extraction.value}</span>
                  </div>
                );
              })}
            </div>
          </details>

          {/* Warnings */}
          {Array.isArray(extracted.warnings) && extracted.warnings.length > 0 && (
            <div style={{
              marginTop: 10, padding: "6px 10px",
              background: C.amberBg || "#fef3c7",
              border: "0.5px solid " + (C.amberBorder || "#fcd34d"),
              borderRadius: 4, fontSize: 11, color: C.amber || "#b45309",
            }}>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>Reviewer notes</div>
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                {extracted.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Single OCR field row: label, value, confidence, optional Accept button ─
function OCRFieldRow({ label, extraction, currentRequestValue, appliedValue, isTerminal, onAccept }) {
  const value       = extraction.value;
  const confidence  = extraction.confidence || "none";
  const hasValue    = value !== null && value !== undefined && String(value).trim() !== "";

  // Visual: high=teal dot, medium=amber, low=grey, none=hidden
  const confDot = {
    high:   { bg: C.teal, title: "High confidence" },
    medium: { bg: C.amber || "#f59e0b", title: "Medium confidence" },
    low:    { bg: C.textTertiary, title: "Low confidence" },
    none:   null,
  }[confidence];

  const matches = hasValue && String(value).trim() === String(currentRequestValue || "").trim();
  const isApplied = appliedValue !== undefined;

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "4px 8px", background: isApplied ? C.tealBg : "#fff",
      border: "0.5px solid " + (isApplied ? C.tealBorder : C.borderLight),
      borderRadius: 4, fontSize: 11, gap: 8,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flex: 1 }}>
        {confDot && (
          <span title={confDot.title} style={{
            display: "inline-block", width: 6, height: 6, borderRadius: "50%",
            background: confDot.bg, flexShrink: 0,
          }} />
        )}
        <span style={{ color: C.textTertiary, fontSize: 10, flexShrink: 0 }}>{label}</span>
        <span style={{
          color: hasValue ? C.textPrimary : C.textTertiary,
          fontWeight: hasValue ? 600 : 400,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {hasValue ? value : "—"}
        </span>
      </div>
      {!isTerminal && hasValue && !matches && !isApplied && (
        <button onClick={onAccept}
                title={"Replace " + label + " with AI value"}
                style={{
                  fontSize: 9, padding: "2px 6px",
                  background: "#fff", color: C.teal,
                  border: "0.5px solid " + C.tealBorder, borderRadius: 3,
                  cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
                  flexShrink: 0,
                }}>
          Use
        </button>
      )}
      {isApplied && (
        <span style={{
          fontSize: 9, fontWeight: 700, color: C.teal,
          padding: "2px 6px", background: "#fff",
          border: "0.5px solid " + C.tealBorder, borderRadius: 3, flexShrink: 0,
        }}>✓ Applied</span>
      )}
      {matches && !isApplied && (
        <span style={{
          fontSize: 9, color: C.textTertiary, fontStyle: "italic", flexShrink: 0,
        }}>matches</span>
      )}
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
      // Merge OCR overrides (accepted via "Use" buttons) on top of the raw
      // patient-submitted request before building the policy payload.
      const patch = (action && action.ocrPatch) || {};
      const effective = Object.assign({}, req, patch);

      // Split "First Last" name into first + last for insurance_policies schema
      const subName = (effective.subscriber_name || "").trim();
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
        payer_name:            effective.payer_name || "Unknown",
        payer_category:        inferPayerCategory(effective.payer_name) ||
                               (currentPolicy && currentPolicy.payer_category) ||
                               "Commercial",
        member_id:             effective.member_id || "Unknown",
        group_number:          effective.group_number || null,
        plan_name:             effective.plan_name || null,
        subscriber_first_name: first,
        subscriber_last_name:  last,
        subscriber_dob:        effective.subscriber_dob || null,
        subscriber_relation:   effective.relationship || "Self",
       is_active:             true,
        card_front_url:        req.front_image_url || (currentPolicy && currentPolicy.card_front_url) || null,
        card_back_url:         req.back_image_url  || (currentPolicy && currentPolicy.card_back_url)  || null,
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

    const patchKeys = Object.keys((action && action.ocrPatch) || {});
      logAudit({
        action: "Update",
        entityType: "insurance_update_request",
        entityId: req.id,
        details: {
          status: "Approved",
          rank: req.rank,
          policy_id: policyId,
          ocr_fields_accepted: patchKeys,
        },
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

  const ocrPatchKeys = mode === "apply" && action && action.ocrPatch
    ? Object.keys(action.ocrPatch)
    : [];
  const ocrPatchLabels = ocrPatchKeys.map(k => ({
    payer_name: "Payer",
    member_id: "Member ID",
    group_number: "Group #",
    plan_name: "Plan",
    subscriber_name: "Subscriber",
    subscriber_dob: "DOB",
    relationship: "Relationship",
  }[k] || k));

  return (
    <Modal onClose={onClose}>
      <div style={{ padding: 16, minWidth: 420, maxWidth: 520 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4, color: C.textPrimary }}>{title}</div>
        <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 14 }}>{subtitle}</div>

        {ocrPatchLabels.length > 0 && (
          <div style={{
            fontSize: 11, color: C.teal, background: C.tealBg,
            border: "0.5px solid " + C.tealBorder, padding: "6px 10px",
            borderRadius: 4, marginBottom: 10,
          }}>
            <strong>AI overrides applied to:</strong> {ocrPatchLabels.join(", ")}
          </div>
        )}

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
// ─── Insurance card thumbnail pair + full-size viewer ────────────────────
function CardThumbnails({ front, back }) {
  if (!front && !back) return null;
  return (
    <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
      {front && <CardThumb path={front} label="Front of card" />}
      {back  && <CardThumb path={back}  label="Back of card" />}
    </div>
  );
}

function CardThumb({ path, label }) {
  const [url, setUrl]       = useState(null);
  const [showFull, setFull] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.storage
        .from("insurance-cards")
        .createSignedUrl(path, 3600);
      if (!cancelled && data) setUrl(data.signedUrl);
    })();
    return () => { cancelled = true; };
  }, [path]);

  const isPdf = path.toLowerCase().endsWith(".pdf");

  if (!url) {
    return (
      <div style={{
        width: 120, height: 80, background: C.bgSecondary,
        borderRadius: 4, display: "flex", alignItems: "center",
        justifyContent: "center", fontSize: 10, color: C.textTertiary,
      }}>Loading...</div>
    );
  }

  return (
    <>
      <button type="button" onClick={() => setFull(true)}
              title={"Open " + label}
              style={{
                padding: 0, background: "transparent",
                border: "0.5px solid " + C.borderMid, borderRadius: 4,
                cursor: "pointer", overflow: "hidden",
                width: 120, height: 80, position: "relative",
              }}>
        {isPdf ? (
          <div style={{
            width: "100%", height: "100%", display: "flex",
            alignItems: "center", justifyContent: "center",
            background: C.redBg, color: C.red, fontSize: 22, fontWeight: 700,
          }}>PDF</div>
        ) : (
          <img src={url} alt={label}
               style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        )}
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0,
          background: "rgba(0,0,0,0.55)", color: "#fff",
          fontSize: 9, fontWeight: 600, padding: "2px 4px", textAlign: "center",
        }}>{label}</div>
      </button>

      {showFull && (
        <Modal onClose={() => setFull(false)}>
          <div style={{ padding: 16, maxWidth: "90vw", maxHeight: "90vh" }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{label}</div>
            {isPdf ? (
              <iframe src={url} title={label}
                      style={{ width: "80vw", height: "75vh", border: 0 }} />
            ) : (
              <img src={url} alt={label}
                   style={{ maxWidth: "80vw", maxHeight: "75vh", display: "block" }} />
            )}
            <div style={{ marginTop: 10, textAlign: "right" }}>
              <a href={url} target="_blank" rel="noopener noreferrer"
                 style={{ fontSize: 11, color: C.teal, textDecoration: "none", fontFamily: "inherit" }}>
                Open in new tab ↗
              </a>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
// ─── Payer category auto-detection ────────────────────────────────────────
// Maps payer names from the NC_PAYER_OPTIONS list (and common variants) to
// the payer_category enum. Returns null when uncertain, which falls back to
// existing policy category or defaults to Commercial.
function inferPayerCategory(payerName) {
  if (!payerName) return null;
  const n = payerName.toLowerCase();

  // Tailored Plans (behavioral health + I/DD)
  const tailored = ["alliance health", "trillium health", "vaya health", "partners health management"];
  if (tailored.some(t => n.includes(t))) return "NC Medicaid - Tailored";

  // Standard Medicaid MCOs
  const standard = ["amerihealth caritas", "carolina complete health", "healthy blue",
                    "unitedhealthcare community plan", "wellcare of nc", "nc medicaid direct"];
  if (standard.some(t => n.includes(t))) return "NC Medicaid - Standard";

  // Generic Medicaid catch-all
  if (n.includes("medicaid")) return "NC Medicaid - Other";

  // Medicare (traditional + advantage)
  if (n.includes("medicare")) return "Medicare";

  // Military / VA - closest enum match is Other
  if (n.includes("tricare") || n.includes("military") || n.includes("veterans") || n.includes("va")) {
    return "Other";
  }

  // Self-pay
  if (n.includes("self-pay") || n.includes("no insurance") || n.includes("self pay")) {
    return "Other";
  }

  // Commercial plans
  const commercial = ["blue cross blue shield", "bcbs", "aetna", "cigna", "unitedhealthcare",
                      "humana", "ambetter", "molina", "nc state health plan"];
  if (commercial.some(t => n.includes(t))) return "Commercial";

  // Unknown - let caller decide fallback
  return null;
}
