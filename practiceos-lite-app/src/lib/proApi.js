// ═══════════════════════════════════════════════════════════════════════════════
// proApi - wrappers over supabase.functions.invoke + direct Pro table queries.
//
// v3 CHANGES:
// - invoke() now reads error.context.body (stream) when available so we get
//   the server's actual JSON error message instead of "Failed to send a
//   request to the Edge Function"
// - listInboundSmsWithDrafts disambiguates the double FK to messages table
//   using the !inbound_message_id hint
// ═══════════════════════════════════════════════════════════════════════════════

import { supabase } from "./supabaseClient";

async function invoke(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    // supabase-js returns a FunctionsHttpError whose .context holds the raw
    // Response object. Read the body as text so we can surface the server's
    // JSON error rather than the generic wrapper message.
    let serverMsg = null;
    let serverPayload = null;
    try {
      if (error.context && typeof error.context.text === "function") {
        const text = await error.context.text();
        if (text) {
          try {
            serverPayload = JSON.parse(text);
            serverMsg = serverPayload.error || serverPayload.detail || text.slice(0, 300);
          } catch {
            serverMsg = text.slice(0, 300);
          }
        }
      }
    } catch (_readErr) {
      // Response body already consumed or unavailable -- fall through to error.message
    }

    const msg = serverMsg || error.message || "Unknown error";
    const err = new Error(msg);
    err.status = (error.context && error.context.status) || error.status || 500;
    err.payload = serverPayload;
    err.raw = error;
    throw err;
  }
  return data;
}

export const proApi = {
  assistantQuery: ({ query, conversationId }) =>
    invoke("pro-assistant-query", { query, conversationId }),

  outreachGenerate: ({ assistantMessageId, channel, tone, max_patients }) =>
    invoke("pro-outreach-generate", { assistantMessageId, channel, tone, max_patients }),

  outreachSend: ({ draftId, edited_body }) =>
    invoke("pro-outreach-send", { draftId, edited_body }),

  inboundSmsDraft: ({ messageId }) =>
    invoke("pro-inbound-sms-draft", { messageId }),

  capBoostPurchase: ({ messages_added, amount_usd, note }) =>
    invoke("pro-cap-boost-purchase", { messages_added, amount_usd, note }),
};

// Supported boost packages - keep in sync with pro-cap-boost-purchase edge fn
export const BOOST_PACKAGES = [
  { messages_added: 1000,  amount_usd: 20,  label: "1,000 messages",   value_desc: "$20" },
  { messages_added: 2500,  amount_usd: 45,  label: "2,500 messages",   value_desc: "$45 - save 10%" },
  { messages_added: 5000,  amount_usd: 80,  label: "5,000 messages",   value_desc: "$80 - save 20%" },
  { messages_added: 10000, amount_usd: 150, label: "10,000 messages",  value_desc: "$150 - save 25%" },
];

// Roles allowed to purchase cap boosts (matches edge function gate)
export const PURCHASE_ROLES = ["Owner", "Manager", "Billing"];

// ───────────────────────────────────────────────────────────────────────────────
// Direct DB helpers for Pro tables (RLS gates appropriately)
// ───────────────────────────────────────────────────────────────────────────────

export async function fetchUsageThisMonth() {
  const { data, error } = await supabase.rpc("my_pro_usage_this_month");
  if (error) throw new Error(error.message);
  if (Array.isArray(data) && data.length > 0) return data[0];
  return data ? data : { used: 0, cap: 0, remaining: 0 };
}

export async function fetchBoostsThisMonth() {
  const { data, error } = await supabase.rpc("my_pro_boosts_this_month");
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

export async function listConversations(limit = 30) {
  const { data, error } = await supabase
    .from("pro_assistant_conversations")
    .select("id, title, last_message_at, is_archived, created_at")
    .eq("is_archived", false)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ? data : [];
}

export async function fetchConversation(conversationId) {
  const { data: convo, error: cErr } = await supabase
    .from("pro_assistant_conversations")
    .select("id, title, last_message_at, created_at")
    .eq("id", conversationId)
    .single();
  if (cErr) throw new Error(cErr.message);
  const { data: msgs, error: mErr } = await supabase
    .from("pro_assistant_messages")
    .select("id, role, content, query_spec, result_data, result_count, created_at, error_message")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (mErr) throw new Error(mErr.message);
  return { conversation: convo, messages: msgs ? msgs : [] };
}

export async function archiveConversation(conversationId) {
  const { error } = await supabase
    .from("pro_assistant_conversations")
    .update({ is_archived: true })
    .eq("id", conversationId);
  if (error) throw new Error(error.message);
}

export async function renameConversation(conversationId, title) {
  const { error } = await supabase
    .from("pro_assistant_conversations")
    .update({ title })
    .eq("id", conversationId);
  if (error) throw new Error(error.message);
}

export async function listOutreachBatches(limit = 50) {
  const { data, error } = await supabase
    .from("pro_outreach_batches")
    .select("id, title, status, total_drafts, drafts_approved, drafts_sent, drafts_rejected, created_at, context_summary, template_used")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ? data : [];
}

export async function fetchBatchWithDrafts(batchId) {
  const { data: batch, error: bErr } = await supabase
    .from("pro_outreach_batches")
    .select("id, title, status, total_drafts, drafts_approved, drafts_sent, drafts_rejected, created_at, context_summary, template_used")
    .eq("id", batchId)
    .single();
  if (bErr) throw new Error(bErr.message);
  const { data: drafts, error: dErr } = await supabase
    .from("pro_outreach_drafts")
    .select("id, patient_id, channel, draft_body, edited_body, final_body, reason, status, reviewed_at, sent_at, error_message, context, patients(first_name, last_name, mrn, phone_mobile, sms_opt_out)")
    .eq("batch_id", batchId)
    .order("created_at", { ascending: true });
  if (dErr) throw new Error(dErr.message);
  return { batch, drafts: drafts ? drafts : [] };
}

export async function updateDraftBody(draftId, edited_body) {
  const { error } = await supabase
    .from("pro_outreach_drafts")
    .update({ edited_body })
    .eq("id", draftId);
  if (error) throw new Error(error.message);
}

export async function updateDraftStatus(draftId, status) {
  const validStatuses = ["Draft", "Approved", "Rejected"];
  if (!validStatuses.includes(status)) throw new Error("Invalid status: " + status);
  const { error } = await supabase
    .from("pro_outreach_drafts")
    .update({ status })
    .eq("id", draftId);
  if (error) throw new Error(error.message);
}

// NOTE: pro_inbound_sms_drafts has TWO FKs to messages (inbound_message_id,
// sent_message_id). PostgREST requires the !inbound_message_id hint to pick
// which one to embed.
export async function listInboundSmsWithDrafts(limit = 50) {
  const { data, error } = await supabase
    .from("pro_inbound_sms_drafts")
    .select("id, practice_id, inbound_message_id, patient_id, draft_body, edited_body, final_body, classification, confidence, status, created_at, context, messages!inbound_message_id(body, thread_id, created_at, patients(first_name, last_name, mrn, phone_mobile))")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ? data : [];
}

export async function listInboundSmsNeedingDraft(limit = 50) {
  const { data: drafts } = await supabase
    .from("pro_inbound_sms_drafts")
    .select("inbound_message_id")
    .limit(500);
  const seen = new Set((drafts ? drafts : []).map((d) => d.inbound_message_id));
  const { data: msgs, error } = await supabase
    .from("messages")
    .select("id, patient_id, body, created_at, thread_id, patients(first_name, last_name, mrn)")
    .eq("direction", "Inbound")
    .eq("channel", "SMS")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (msgs ? msgs : []).filter((m) => !seen.has(m.id));
}
