// ═══════════════════════════════════════════════════════════════════════════════
// PracticeOS Lite — DB helpers (thin wrapper around supabase client)
// Every write logs to audit_log; PHI reads log on-demand via logRead().
// ═══════════════════════════════════════════════════════════════════════════════

import { supabase } from "./supabaseClient";

// ─── Audit logging (SECURITY DEFINER RPC) ─────────────────────────────────────
export const logAudit = async ({ action, entityType, entityId, patientId = null, details = {}, success = true, errorMessage = null }) => {
  try {
    const { error } = await supabase.rpc("log_audit", {
      p_action: action,                  // 'Create' | 'Read' | 'Update' | 'Delete' | 'Export' | 'Print' | 'Break The Glass'
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_patient_id: patientId,
      p_details: details,
      p_success: success,
      p_error: errorMessage,             // DB function param is p_error (was p_error_message - caused schema-cache 404)
    });
    if (error) console.warn("[audit]", error.message);
  } catch (e) {
    console.warn("[audit] exception", e);
  }
};

// Convenience: one-shot PHI read log
export const logRead = (entityType, entityId, patientId = null, details = {}) =>
  logAudit({ action: "Read", entityType, entityId, patientId, details });

// ─── Generic list query scoped by RLS ─────────────────────────────────────────
// RLS handles practice_id filtering; we just select().
export const listRows = async (table, { select = "*", filters = {}, order = null, ascending = true, limit = null } = {}) => {
  let q = supabase.from(table).select(select);
  Object.entries(filters).forEach(([k, v]) => {
    if (v === null) q = q.is(k, null);
    else if (Array.isArray(v)) q = q.in(k, v);
    else q = q.eq(k, v);
  });
  if (order) q = q.order(order, { ascending });
  if (limit) q = q.limit(limit);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
};

// ─── Insert with practice_id injected ─────────────────────────────────────────
export const insertRow = async (table, row, practiceId, { audit = null } = {}) => {
  const payload = { ...row };
  if (practiceId && !payload.practice_id) payload.practice_id = practiceId;
  const { data, error } = await supabase.from(table).insert(payload).select().single();
  if (error) throw error;
  if (audit) await logAudit({ action: "Create", entityType: audit.entityType, entityId: data.id, patientId: audit.patientId || null, details: audit.details || {} });
  return data;
};

// ─── Update by id ─────────────────────────────────────────────────────────────
export const updateRow = async (table, id, patch, { audit = null } = {}) => {
  const { data, error } = await supabase.from(table).update(patch).eq("id", id).select().single();
  if (error) throw error;
  if (audit) await logAudit({ action: "Update", entityType: audit.entityType, entityId: id, patientId: audit.patientId || null, details: audit.details || patch });
  return data;
};

// ─── Soft / hard delete ───────────────────────────────────────────────────────
export const deleteRow = async (table, id, { audit = null } = {}) => {
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) throw error;
  if (audit) await logAudit({ action: "Delete", entityType: audit.entityType, entityId: id, patientId: audit.patientId || null });
  return true;
};

// ─── Realtime subscription helper ─────────────────────────────────────────────
// Returns an unsubscribe fn. Filters server-side on practice_id when provided.
export const subscribeTable = (table, { practiceId = null, onChange }) => {
  const ch = supabase
    .channel(`pos-${table}-${practiceId || "all"}-${Date.now()}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table,
        ...(practiceId ? { filter: `practice_id=eq.${practiceId}` } : {}),
      },
      (payload) => onChange(payload)
    )
    .subscribe();
  return () => { supabase.removeChannel(ch); };
};

// ─── Break the Glass (Provider accessing chart outside their panel) ───────────
export const breakTheGlass = async ({ patientId, reason, reasonCategory = "Emergency" }) => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
  const { data, error } = await supabase.from("break_the_glass_events").insert({
    user_id: user.id,
    patient_id: patientId,
    reason,
    reason_category: reasonCategory,
    expires_at: expiresAt,
  }).select().single();
  if (error) throw error;
  await logAudit({ action: "Break The Glass", entityType: "patients", entityId: patientId, patientId, details: { reason, reasonCategory } });
  return data;
};

// ─── Fetch a patient with common joined context ───────────────────────────────
export const fetchPatientFull = async (patientId) => {
  const [patient, appts, encounters, insurance] = await Promise.all([
    supabase.from("patients").select("*").eq("id", patientId).single(),
    supabase.from("appointments").select("*").eq("patient_id", patientId).order("appt_date", { ascending: false }).limit(50),
    supabase.from("encounters").select("*").eq("patient_id", patientId).order("encounter_date", { ascending: false }).limit(20),
    supabase.from("insurance_policies").select("*").eq("patient_id", patientId).eq("is_active", true).order("rank"),
  ]);
  if (patient.error) throw patient.error;
  await logRead("patients", patientId, patientId);
  return {
    patient: patient.data,
    appointments: appts.data || [],
    encounters: encounters.data || [],
    insurance: insurance.data || [],
  };
};
