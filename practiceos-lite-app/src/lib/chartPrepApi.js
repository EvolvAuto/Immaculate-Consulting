// chartPrepApi.js - client helpers for the Pro Chart Prep feature.
//
// Destination in the deployed repo: src/lib/chartPrepApi.js
//
// This REPLACES the earlier version uploaded for Phase 2. New exports:
//   - nextBusinessDayForPractice(practiceId)
//   - chartPrepSummaryForDate(practiceId, apptDate)
//
// Everything else is unchanged from the Phase 2 upload.

import { supabase } from "./supabaseClient";

// ----------------------------------------------------------------------------
// Internal: call a browser-facing edge function and surface the server's
// error body in the thrown error so the UI can show it.
// ----------------------------------------------------------------------------

async function invoke(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let msg = error.message || "Function invocation failed";
    try {
      if (error.context && typeof error.context.text === "function") {
        const txt = await error.context.text();
        if (txt) msg = msg + " | " + txt.slice(0, 500);
      }
    } catch (_e) {
      // best effort
    }
    throw new Error(msg);
  }
  return data;
}

// ----------------------------------------------------------------------------
// Chart prep notes
// ----------------------------------------------------------------------------

export async function listChartPrepNotesForDate(practiceId, apptDate) {
  const { data, error } = await supabase
    .from("pro_chart_prep_notes")
    .select([
      "id",
      "appointment_id",
      "patient_id",
      "provider_id",
      "appt_date",
      "one_line_summary",
      "chief_reason",
      "key_problems",
      "overdue_measures",
      "recent_changes",
      "suggested_agenda",
      "flags",
      "historical_arc",
      "sdoh_summary",
      "device_notes",
      "vaccine_notes",
      "status",
      "error_message",
      "generation_attempts",
      "last_attempt_at",
      "reviewed_by",
      "reviewed_at",
      "provider_note",
      "model",
      "input_tokens",
      "output_tokens",
      "created_at",
      "updated_at",
      "patients:patient_id ( first_name, last_name, mrn, date_of_birth, gender, pronouns )",
      "providers:provider_id ( first_name, last_name )",
      "appointments:appointment_id ( start_slot, appt_type, chief_complaint, confirmation_status, status )",
    ].join(", "))
    .eq("practice_id", practiceId)
    .eq("appt_date", apptDate)
    .order("appt_date", { ascending: true });
  if (error) throw new Error(error.message);

  const sorted = (data || []).slice().sort((a, b) => {
    const sa = (a.appointments && a.appointments.start_slot) || 0;
    const sb = (b.appointments && b.appointments.start_slot) || 0;
    return sa - sb;
  });
  return sorted;
}

export async function fetchChartPrepNote(noteId) {
  const { data, error } = await supabase
    .from("pro_chart_prep_notes")
    .select([
      "id",
      "appointment_id",
      "patient_id",
      "provider_id",
      "appt_date",
      "one_line_summary",
      "chief_reason",
      "key_problems",
      "overdue_measures",
      "recent_changes",
      "suggested_agenda",
      "flags",
      "historical_arc",
      "sdoh_summary",
      "device_notes",
      "vaccine_notes",
      "status",
      "error_message",
      "generation_attempts",
      "last_attempt_at",
      "reviewed_at",
      "provider_note",
      "model",
      "patients:patient_id ( first_name, last_name, mrn, date_of_birth, gender, pronouns )",
      "providers:provider_id ( first_name, last_name )",
      "appointments:appointment_id ( start_slot, appt_type, chief_complaint, confirmation_status, status )",
    ].join(", "))
    .eq("id", noteId)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function markChartPrepReviewed(noteId, providerNote) {
  const patch = {
    status: "Reviewed",
    reviewed_at: new Date().toISOString(),
  };
  if (providerNote !== undefined) patch.provider_note = providerNote;
  const { data, error } = await supabase
    .from("pro_chart_prep_notes")
    .update(patch)
    .eq("id", noteId)
    .select("id, status, reviewed_at, provider_note")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function regenerateChartPrep(appointmentId) {
  return invoke("pro-chart-prep-regenerate", { appointment_id: appointmentId });
}

// ----------------------------------------------------------------------------
// Business-day resolution (respects practice_hours + holidays + preferences)
// ----------------------------------------------------------------------------

// Returns a YYYY-MM-DD string representing the next business day for the
// practice. If the RPC errors for any reason, falls back to a plain client-side
// "next weekday" calculation so the caller always gets a date.
export async function nextBusinessDayForPractice(practiceId) {
  try {
    const { data, error } = await supabase.rpc("next_business_day_for_practice", {
      p_practice_id: practiceId,
    });
    if (error) throw error;
    if (data) return data;
  } catch (_e) {
    // fall through to client-side fallback
  }
  return nextWeekdayClient();
}

function nextWeekdayClient() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Convenience combo for the Dashboard widget - resolves next business day,
// fetches the notes, and returns { apptDate, notes } in one call.
export async function chartPrepSummaryForNextBusinessDay(practiceId) {
  const apptDate = await nextBusinessDayForPractice(practiceId);
  const notes = await listChartPrepNotesForDate(practiceId, apptDate);
  return { apptDate, notes };
}

// ----------------------------------------------------------------------------
// System alerts
// ----------------------------------------------------------------------------

export async function listOpenSystemAlerts(practiceId) {
  const { data, error } = await supabase
    .from("pro_system_alerts")
    .select("id, alert_type, severity, title, message, ticket_ref, details, created_at, status, email_sent_at")
    .eq("practice_id", practiceId)
    .eq("status", "Open")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function acknowledgeSystemAlert(alertId) {
  const { data, error } = await supabase
    .from("pro_system_alerts")
    .update({
      status: "Acknowledged",
      acknowledged_at: new Date().toISOString(),
    })
    .eq("id", alertId)
    .select("id, status")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

// ----------------------------------------------------------------------------
// Helpers for the view
// ----------------------------------------------------------------------------

export function formatSlotTime(slot) {
  if (slot === null || slot === undefined) return "";
  const totalMinutes = Number(slot) * 15;
  if (!Number.isFinite(totalMinutes)) return "";
  const h24 = Math.floor(totalMinutes / 60);
  const m   = totalMinutes % 60;
  const h12 = ((h24 + 11) % 12) + 1;
  const ampm = h24 < 12 ? "AM" : "PM";
  const mm = String(m).padStart(2, "0");
  return h12 + ":" + mm + " " + ampm;
}

export function patientDisplayName(patient) {
  if (!patient) return "Unknown patient";
  const first = patient.first_name || "";
  const last  = patient.last_name || "";
  const name  = (first + " " + last).trim();
  return name || "Unknown patient";
}

export function patientAge(patient) {
  if (!patient || !patient.date_of_birth) return null;
  const dob = new Date(patient.date_of_birth);
  if (isNaN(dob.getTime())) return null;
  const diffMs = Date.now() - dob.getTime();
  return Math.floor(diffMs / (365.25 * 86400000));
}

export function providerDisplayName(provider) {
  if (!provider) return null;
  const last = provider.last_name || "";
  return last ? ("Dr. " + last) : null;
}

export function flagCounts(flags) {
  const counts = { high: 0, medium: 0, low: 0 };
  if (!Array.isArray(flags)) return counts;
  for (const f of flags) {
    const sev = (f && f.severity ? String(f.severity) : "").toLowerCase();
    if (sev === "high") counts.high += 1;
    else if (sev === "medium") counts.medium += 1;
    else if (sev === "low") counts.low += 1;
  }
  return counts;
}
