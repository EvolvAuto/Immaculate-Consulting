// ═══════════════════════════════════════════════════════════════════════════════
// src/views/portal/PatientProxyManager.jsx
//
// A portal-authenticated patient uses this screen to:
//   - Invite a family member / caregiver to access their chart by email
//   - See a list of active grants
//   - Change permissions (View Only <-> Full Access)
//   - Revoke access
//
// Typical scope: a spouse, adult child, or other trusted adult. For a minor
// child's account, the parent grants themselves access from the parent portal,
// not from the child's portal. Staff can also configure grants from the chart.
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { C, Panel, Badge, Btn, Field, Input, Select, Empty, SectionHead, Toast, InfoBox, fmtDate } from "./_ui.jsx";

const RELATIONSHIPS = ["Parent", "Legal Guardian", "Spouse", "Adult Child", "Power of Attorney", "Other"];
const PERMISSIONS   = ["View Only", "Full Access"];

export default function PatientProxyManager({ patientId, patient }) {
  const [proxies, setProxies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [form, setForm] = useState({
    grantee_email: "", relationship: "Spouse", permission: "Full Access", display_label: "",
  });
  const [toast, setToast] = useState(null);

  const load = async () => {
    const { data } = await supabase
      .from("patient_proxies")
      .select("id, relationship, permission, status, display_label, granted_at, expires_at, revoked_at, proxy_user_id")
      .eq("patient_id", patientId)
      .order("status", { ascending: true })
      .order("granted_at", { ascending: false });

    // Separately fetch grantee emails from users (join in app, not in query,
    // because users row might not exist if grantee is a new account)
    const ids = (data || []).map(r => r.proxy_user_id);
    let emailMap = {};
    if (ids.length > 0) {
      const { data: users } = await supabase.from("users")
        .select("id, email, full_name").in("id", ids);
      emailMap = Object.fromEntries((users || []).map(u => [u.id, u]));
    }
    setProxies((data || []).map(p => ({ ...p, grantee: emailMap[p.proxy_user_id] })));
  };

  useEffect(() => {
    let active = true;
    (async () => { try { await load(); } finally { if (active) setLoading(false); } })();
    return () => { active = false; };
  }, [patientId]);

  const showToast = (msg, ms = 4000) => {
    setToast(msg);
    setTimeout(() => setToast(null), ms);
  };

  const submit = async () => {
    if (!form.grantee_email.trim()) { showToast("Enter an email address."); return; }
    setInviting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Please sign out and back in, then retry.");

      const url = supabase.supabaseUrl.replace(/\/+$/, "") + "/functions/v1/grant-proxy-access";
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": "Bearer " + session.access_token,
          "apikey":        supabase.supabaseKey,
        },
        body: JSON.stringify({
          grantee_email: form.grantee_email.trim(),
          relationship:  form.relationship,
          permission:    form.permission,
          display_label: form.display_label.trim() || null,
        }),
      });
      const payload = await resp.json().catch(() => ({}));

      if (payload.needs_registration) {
        showToast(payload.message, 7000);
        setInviting(false);
        return;
      }
      if (!resp.ok || payload.error) throw new Error(payload.error || ("HTTP " + resp.status));

      showToast("Access granted to " + form.grantee_email.trim(), 5000);
      setForm({ grantee_email: "", relationship: "Spouse", permission: "Full Access", display_label: "" });
      await load();
    } catch (e) {
      showToast("Could not grant: " + (e.message || e), 6000);
    } finally {
      setInviting(false);
    }
  };

  const revoke = async (grant) => {
    if (!window.confirm("Revoke " + (grant.grantee?.email || "this person") + "'s access?")) return;
    try {
      const { error } = await supabase.from("patient_proxies")
        .update({
          status:        "Revoked",
          revoked_at:    new Date().toISOString(),
          revoked_reason: "Revoked by patient",
        })
        .eq("id", grant.id);
      if (error) throw error;
      showToast("Access revoked.");
      await load();
    } catch (e) {
      showToast("Could not revoke: " + (e.message || e));
    }
  };

  const changePermission = async (grant, newPermission) => {
    try {
      const { error } = await supabase.from("patient_proxies")
        .update({ permission: newPermission })
        .eq("id", grant.id);
      if (error) throw error;
      showToast("Permission updated.");
      await load();
    } catch (e) {
      showToast("Could not update: " + (e.message || e));
    }
  };

  if (loading) return <Empty title="Loading access settings..." />;

  const active  = proxies.filter(p => p.status === "Active");
  const revoked = proxies.filter(p => p.status !== "Active");

  return (
    <div>
      <Toast show={!!toast} msg={toast || ""} />

      <InfoBox>
        Grant trusted family members or caregivers access to your chart. They can
        message your care team, view your visit summaries, and manage appointments
        on your behalf. You can change or revoke access anytime.
      </InfoBox>

      <Panel accent={C.tealMid}>
        <SectionHead title="Grant new access" />
        <Field label="Email address of the person you're granting access to">
          <Input value={form.grantee_email} onChange={v => setForm({ ...form, grantee_email: v })}
                 placeholder="name@example.com" type="email" />
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Their relationship to you">
            <Select value={form.relationship} onChange={v => setForm({ ...form, relationship: v })}
                    options={RELATIONSHIPS} />
          </Field>
          <Field label="Permission level">
            <Select value={form.permission} onChange={v => setForm({ ...form, permission: v })}
                    options={PERMISSIONS} />
          </Field>
        </div>
        <Field label="Label (optional - what they'll see in their account switcher)">
          <Input value={form.display_label} onChange={v => setForm({ ...form, display_label: v })}
                 placeholder={"e.g. " + ((patient && patient.first_name) || "My") + "'s chart"} />
        </Field>
        <div style={{ fontSize: 11, color: C.textTertiary, marginBottom: 10 }}>
          <strong>View Only</strong>: They can see your information but cannot send messages or submit forms on your behalf.<br />
          <strong>Full Access</strong>: They can also message your care team, submit intake forms, and request refills.
        </div>
        <Btn onClick={submit} disabled={inviting}>{inviting ? "Granting..." : "Grant access"}</Btn>
      </Panel>

      {active.length > 0 && (
        <>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: C.textTertiary, margin: "18px 0 8px", fontWeight: 600 }}>
            People with access ({active.length})
          </div>
          {active.map(p => (
            <Panel key={p.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>
                    {p.grantee?.full_name || p.grantee?.email || "Pending"}
                  </div>
                  <div style={{ fontSize: 11, color: C.textSecondary, marginTop: 2 }}>
                    {p.grantee?.email || ""} - {p.relationship}
                  </div>
                  <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 4 }}>
                    Granted {fmtDate(p.granted_at)}{p.expires_at ? " - Expires " + fmtDate(p.expires_at) : ""}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <Badge label={p.permission} variant={p.permission === "Full Access" ? "teal" : "neutral"} />
                  {p.permission === "View Only" ? (
                    <Btn size="sm" variant="secondary" onClick={() => changePermission(p, "Full Access")}>Grant Full</Btn>
                  ) : (
                    <Btn size="sm" variant="secondary" onClick={() => changePermission(p, "View Only")}>Limit to View</Btn>
                  )}
                  <Btn size="sm" variant="danger" onClick={() => revoke(p)}>Revoke</Btn>
                </div>
              </div>
            </Panel>
          ))}
        </>
      )}

      {revoked.length > 0 && (
        <>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: C.textTertiary, margin: "18px 0 8px", fontWeight: 600 }}>
            Revoked / expired ({revoked.length})
          </div>
          {revoked.map(p => (
            <Panel key={p.id} style={{ opacity: 0.6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 12, color: C.textSecondary }}>
                    {p.grantee?.email || "Unknown"} - {p.relationship}
                  </div>
                  <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>
                    {p.status === "Revoked" ? "Revoked " + fmtDate(p.revoked_at) : "Expired " + fmtDate(p.expires_at)}
                  </div>
                </div>
                <Badge label={p.status} variant="red" />
              </div>
            </Panel>
          ))}
        </>
      )}
    </div>
  );
}
