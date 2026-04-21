// ═══════════════════════════════════════════════════════════════════════════════
// src/lib/hrsnApi.js
// Supabase query helpers for Pro HRSN feature:
//   - listRecentScreenings: Recent HRSN responses (joined with patient names)
//   - listReferralDrafts:   Drafts awaiting review (sorted urgent -> low)
//   - updateReferralDraft:  Edit/approve/dismiss/mark-sent
//   - markResponseReviewed: Provider acknowledges the AI summary
// ═══════════════════════════════════════════════════════════════════════════════

import { supabase } from "./supabaseClient";

const PRIORITY_ORDER = { urgent: 0, high: 1, medium: 2, low: 3 };

export async function listRecentScreenings(practiceId, limit) {
  const n = limit || 20;
  const { data, error } = await supabase
    .from("screener_responses")
    .select(
      "id, patient_id, screener_type, administered_via, completion_mode, " +
      "responses, flags, requires_followup, completed_at, " +
      "ai_summary, ai_summary_status, ai_summary_generated_at, ai_summary_error, " +
      "ai_summary_model, ai_summary_attempts, reviewed_at, reviewed_by, " +
      "patients:patient_id ( id, first_name, last_name, mrn )"
    )
    .eq("practice_id", practiceId)
    .eq("screener_type", "HRSN")
    .order("completed_at", { ascending: false })
    .limit(n);
  if (error) throw error;
  return data || [];
}

export async function listReferralDrafts(practiceId, opts) {
  const statuses = (opts && opts.statuses) || ["Draft"];
  const limit    = (opts && opts.limit) || 50;
  const { data, error } = await supabase
    .from("hrsn_referral_drafts")
    .select(
      "id, patient_id, screener_response_id, domain, priority, " +
      "nccare360_category, packet_narrative, staff_edited_narrative, " +
      "staff_notes, status, sent_via, reviewed_by, reviewed_at, sent_at, " +
      "created_at, updated_at, " +
      "patients:patient_id ( id, first_name, last_name, mrn )"
    )
    .eq("practice_id", practiceId)
    .in("status", statuses)
    .limit(limit);
  if (error) throw error;
  return (data || []).sort(function(a, b) {
    const pa = PRIORITY_ORDER[a.priority];
    const pb = PRIORITY_ORDER[b.priority];
    const paN = (pa === undefined) ? 99 : pa;
    const pbN = (pb === undefined) ? 99 : pb;
    if (paN !== pbN) return paN - pbN;
    return new Date(b.created_at) - new Date(a.created_at);
  });
}

export async function updateReferralDraft(draftId, updates, user) {
  const patch = Object.assign({}, updates);
  if (updates.status && user && user.id) {
    patch.reviewed_by = user.id;
    patch.reviewed_at = new Date().toISOString();
  }
  if (updates.status === "Sent") {
    patch.sent_at = new Date().toISOString();
  }
  const { data, error } = await supabase
    .from("hrsn_referral_drafts")
    .update(patch)
    .eq("id", draftId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Dedicated send helper - captures method + recipient + stamps sent_at.
// sentVia must be one of: 'NCCARE360 Portal' | 'NCCARE360 API' | 'Email' |
// 'Fax' | 'Phone' | 'Printed / In-person' | 'Other'
export async function markReferralSent(draftId, meta, user) {
  const patch = {
    status: "Sent",
    sent_via: meta.sent_via,
    sent_to_recipient: meta.sent_to_recipient || null,
    sent_at: new Date().toISOString(),
  };
  if (user && user.id) {
    patch.reviewed_by = user.id;
    patch.reviewed_at = new Date().toISOString();
  }
  const { data, error } = await supabase
    .from("hrsn_referral_drafts")
    .update(patch)
    .eq("id", draftId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function markResponseReviewed(responseId, user) {
  const patch = { reviewed_at: new Date().toISOString() };
  if (user && user.id) patch.reviewed_by = user.id;
  const { data, error } = await supabase
    .from("screener_responses")
    .update(patch)
    .eq("id", responseId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export function getEffectiveNarrative(draft) {
  // Returns the edited narrative if staff edited it, else the AI draft.
  // NOT async - used directly inside useState() initialization.
  if (!draft) return "";
  return draft.staff_edited_narrative || draft.packet_narrative || "";
}
