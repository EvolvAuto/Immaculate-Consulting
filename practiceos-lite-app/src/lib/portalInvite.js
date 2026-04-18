// ═══════════════════════════════════════════════════════════════════════════════
// src/lib/portalInvite.js
// Staff helpers for sending portal activation invitations.
// Matches live schema: patients.portal_user_id (set by edge function on activation),
// patients.portal_enabled (flipped here), portal_invitations + portal_notifications.
// ═══════════════════════════════════════════════════════════════════════════════

import { supabase, logAudit } from "./supabaseClient";

function randomToken(bytes = 24) {
  const arr = new Uint8Array(bytes);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < bytes; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  const bin = Array.from(arr).map(b => String.fromCharCode(b)).join("");
  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Create an activation invite row + notification event. Returns { ok, invite }.
 * Make.com consumes portal_notifications and sends the email via Resend.
 */
export async function sendPortalInvite({ practiceId, patientId, email, invitedBy }) {
  if (!practiceId || !patientId || !email) {
    throw new Error("Missing practiceId, patientId, or email");
  }
  const token = randomToken(24);
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  const { data: invite, error } = await supabase.from("portal_invitations").insert({
    practice_id: practiceId,
    patient_id:  patientId,
    email:       email.toLowerCase().trim(),
    token,
    status:      "Pending",
    invited_by:  invitedBy || null,
    expires_at:  expiresAt,
  }).select().single();
  if (error) throw error;

  const appUrl = import.meta.env.VITE_APP_URL ||
                 (typeof window !== "undefined" ? window.location.origin : "");

  // Queue a notification event for Make.com to deliver
  try {
    await supabase.from("portal_notifications").insert({
      practice_id: practiceId,
      patient_id:  patientId,
      event:       "invite_sent",
      channel:     "email",
      recipient:   email,
      payload: {
        token,
        activation_url: appUrl + "/activate?token=" + token,
        expires_at: expiresAt,
        invite_id: invite.id,
      },
      status: "Pending",
    });
  } catch (_e) {
    // Non-fatal - staff can use Copy Link fallback until Make.com is wired up
  }

  // Flag the patient as portal-enabled
  try {
    await supabase.from("patients")
      .update({ portal_enabled: true })
      .eq("id", patientId);
  } catch (_e) { /* non-fatal */ }

  logAudit({
    action:     "Create",
    entityType: "portal_invitation",
    entityId:   invite.id,
    details:    { patient_id: patientId, email },
  }).catch(() => {});

  return { ok: true, invite };
}

export async function revokePortalInvite(inviteId) {
  const { error } = await supabase.from("portal_invitations")
    .update({ status:"Revoked", revoked_at: new Date().toISOString() })
    .eq("id", inviteId);
  if (error) throw error;
  logAudit({
    action:"Update", entityType:"portal_invitation",
    entityId: inviteId, details:{ status:"Revoked" },
  }).catch(() => {});
}

export function buildActivationUrl(token) {
  const appUrl = import.meta.env.VITE_APP_URL ||
                 (typeof window !== "undefined" ? window.location.origin : "");
  return appUrl + "/activate?token=" + token;
}
