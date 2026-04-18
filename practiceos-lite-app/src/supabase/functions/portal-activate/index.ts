// ═══════════════════════════════════════════════════════════════════════════════
// supabase/functions/portal-activate/index.ts
//
// Endpoints:
//   POST /portal-activate { action: "verify", token, dob, phoneLast4 }
//     - verifies token + patient identity, returns { ok, email, patientId }
//
//   POST /portal-activate { action: "complete", token, dob, phoneLast4, password }
//     - creates or updates auth user, sets password, stamps activated_at,
//       links patients.user_id <-> auth.user.id, returns { ok, email }
//
// Auth: public (invoked by activation page). Uses service role internally.
//
// Deploy:
//   supabase functions deploy portal-activate --no-verify-jwt
//   supabase secrets set PORTAL_APP_URL=https://practiceos.immaculate-consulting.org
// ═══════════════════════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

// Extract last 4 digits from a phone (ignores formatting)
function last4(phone: string | null | undefined): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  return digits.slice(-4);
}

// Compare DOB (YYYY-MM-DD strings)
function sameDate(a: string | null, b: string): boolean {
  if (!a) return false;
  return a.slice(0, 10) === b.slice(0, 10);
}

// Look up invitation + patient, return both or error
async function loadInviteAndPatient(token: string) {
  const { data: inv, error } = await admin
    .from("portal_invitations")
    .select("id, patient_id, practice_id, email, status, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (error) throw new Error("lookup failed: " + error.message);
  if (!inv) return { error: "Invitation not found" };
  if (inv.status === "Activated") return { error: "This invitation has already been used. Please sign in normally." };
  if (inv.status === "Revoked")   return { error: "This invitation has been revoked. Contact your practice." };
  if (new Date(inv.expires_at) < new Date()) {
    await admin.from("portal_invitations").update({ status: "Expired" }).eq("id", inv.id);
    return { error: "This invitation has expired. Contact your practice to request a new link." };
  }

  const { data: pt, error: pErr } = await admin
    .from("patients")
    .select("id, first_name, last_name, date_of_birth, primary_phone, mobile_phone, user_id")
    .eq("id", inv.patient_id)
    .maybeSingle();

  if (pErr || !pt) return { error: "Patient record not found." };

  return { inv, pt };
}

function verifyIdentity(pt: any, dob: string, phoneLast4: string): boolean {
  if (!sameDate(pt.date_of_birth, dob)) return false;
  const want = phoneLast4.replace(/\D/g, "").slice(-4);
  if (want.length !== 4) return false;
  const p1 = last4(pt.primary_phone);
  const p2 = last4(pt.mobile_phone);
  return want === p1 || want === p2;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const { action, token, dob, phoneLast4, password } = body || {};
  if (!action || !token) return json({ error: "Missing action or token" }, 400);

  // ── VERIFY ──────────────────────────────────────────────────────────────────
  if (action === "verify") {
    if (!dob || !phoneLast4) return json({ error: "Missing identity fields" }, 400);
    const r = await loadInviteAndPatient(token);
    if (r.error) return json({ error: r.error }, 400);

    if (!verifyIdentity(r.pt, dob, phoneLast4)) {
      return json({ error: "Identity could not be verified. Please check your date of birth and the last 4 digits of your phone number." }, 401);
    }

    return json({
      ok: true,
      email: r.inv.email,
      patientName: `${r.pt.first_name} ${r.pt.last_name}`,
    });
  }

  // ── COMPLETE ────────────────────────────────────────────────────────────────
  if (action === "complete") {
    if (!dob || !phoneLast4 || !password) return json({ error: "Missing required fields" }, 400);
    if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);

    const r = await loadInviteAndPatient(token);
    if (r.error) return json({ error: r.error }, 400);
    if (!verifyIdentity(r.pt, dob, phoneLast4)) {
      return json({ error: "Identity verification failed." }, 401);
    }

    const email = r.inv.email.toLowerCase().trim();
    const patientId = r.pt.id;
    const practiceId = r.inv.practice_id;

    // Check if auth user already exists for this email
    let authUserId: string | null = null;
    const { data: existing } = await admin.auth.admin.listUsers();
    const match = existing?.users?.find((u: any) => (u.email || "").toLowerCase() === email);

    if (match) {
      authUserId = match.id;
      // Update password + app_metadata
      const { error: updErr } = await admin.auth.admin.updateUserById(authUserId, {
        password,
        email_confirm: true,
        app_metadata: {
          ...(match.app_metadata || {}),
          role: "Patient",
          patient_id: patientId,
          practice_id: practiceId,
        },
      });
      if (updErr) return json({ error: "Could not update credentials: " + updErr.message }, 500);
    } else {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: {
          role: "Patient",
          patient_id: patientId,
          practice_id: practiceId,
        },
      });
      if (createErr || !created?.user) {
        return json({ error: "Could not create account: " + (createErr?.message || "unknown") }, 500);
      }
      authUserId = created.user.id;
    }

    // Upsert users row
    const fullName = `${r.pt.first_name} ${r.pt.last_name}`.trim();
    const { error: uErr } = await admin.from("users").upsert({
      id:          authUserId,
      email,
      full_name:   fullName,
      role:        "Patient",
      practice_id: practiceId,
      patient_id:  patientId,
      is_active:   true,
    }, { onConflict: "id" });
    if (uErr) return json({ error: "Could not create profile: " + uErr.message }, 500);

    // Link patients.user_id if not already
    if (!r.pt.user_id || r.pt.user_id !== authUserId) {
      await admin.from("patients").update({ user_id: authUserId }).eq("id", patientId);
    }

    // Stamp invitation activated
    await admin.from("portal_invitations").update({
      status: "Activated",
      activated_at: new Date().toISOString(),
    }).eq("id", r.inv.id);

    // Audit log (best effort)
    try {
      await admin.rpc("log_audit", {
        p_action: "Create",
        p_entity_type: "portal_activation",
        p_entity_id:   authUserId,
        p_details: { patient_id: patientId, email },
      });
    } catch (_e) { /* best effort */ }

    return json({ ok: true, email });
  }

  return json({ error: "Unknown action" }, 400);
});
