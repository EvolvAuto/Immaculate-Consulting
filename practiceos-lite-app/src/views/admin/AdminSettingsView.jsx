// ═══════════════════════════════════════════════════════════════════════════════
// src/views/admin/AdminSettingsView.jsx
// Meta layer: super admin roster, add-on catalog management, billing config.
// Named AdminSettingsView (not SettingsView) to avoid collision with the
// existing top-level SettingsView at /settings.
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../auth/AuthProvider";
import { C } from "../../lib/tokens";
import { Btn, Card, Modal, Input, Loader, ErrorBanner, Badge } from "../../components/ui";

const TIER_VARIANTS = { Lite: "neutral", Pro: "violet", Command: "teal" };

function fmtMoney(cents) {
  if (cents == null) return "—";
  return "$" + (cents / 100).toFixed(2);
}

function fmtRelative(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return min + "m ago";
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + "h ago";
  const dy = Math.floor(hr / 24);
  return dy + "d ago";
}

export default function AdminSettingsView() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [admins, setAdmins] = useState([]);
  const [adminProfiles, setAdminProfiles] = useState({});
  const [catalog, setCatalog] = useState([]);
  const [practiceAddons, setPracticeAddons] = useState([]);
  const [grantModal, setGrantModal] = useState(false);
  const [editAddon, setEditAddon] = useState(null);

  const load = async () => {
    try {
      setLoading(true);
      const [aRes, cRes, paRes] = await Promise.all([
        supabase.from("super_admins").select("*").order("granted_at"),
        supabase.from("subscription_addons").select("*").order("name"),
        supabase.from("practice_addons").select("addon_id, status"),
      ]);
      if (aRes.error) throw aRes.error;
      if (cRes.error) throw cRes.error;
      if (paRes.error) throw paRes.error;
      setAdmins(aRes.data || []);
      setCatalog(cRes.data || []);
      setPracticeAddons(paRes.data || []);

      // Hydrate admin user emails / names from public.users
      const userIds = (aRes.data || []).map(a => a.user_id);
      if (userIds.length > 0) {
        const { data: users } = await supabase.from("users").select("id, email, full_name").in("id", userIds);
        const profileMap = {};
        (users || []).forEach(u => { profileMap[u.id] = u; });
        setAdminProfiles(profileMap);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  if (loading) return <div style={{ padding: 40 }}><Loader /></div>;

  const adoptionBySku = {};
  practiceAddons.forEach(pa => {
    if (pa.status === "active") {
      adoptionBySku[pa.addon_id] = (adoptionBySku[pa.addon_id] || 0) + 1;
    }
  });

  return (
    <div style={{ padding: 20 }}>
      {error && <ErrorBanner message={error} />}

      {/* Super admin roster */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary }}>Super admin access</div>
            <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 1 }}>Users with platform-wide super admin privileges · {admins.filter(a => !a.revoked_at).length} active</div>
          </div>
          <Btn size="sm" variant="primary" onClick={() => setGrantModal(true)}>+ Grant access</Btn>
        </div>
        <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "6px 8px 6px 0", borderBottom: "0.5px solid " + C.borderLight, fontSize: 10, fontWeight: 600, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em" }}>Name</th>
              <th style={{ textAlign: "left", padding: "6px 8px 6px 0", borderBottom: "0.5px solid " + C.borderLight, fontSize: 10, fontWeight: 600, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em" }}>Email</th>
              <th style={{ textAlign: "left", padding: "6px 8px 6px 0", borderBottom: "0.5px solid " + C.borderLight, fontSize: 10, fontWeight: 600, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em" }}>Granted</th>
              <th style={{ textAlign: "left", padding: "6px 8px 6px 0", borderBottom: "0.5px solid " + C.borderLight, fontSize: 10, fontWeight: 600, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em" }}>Status</th>
              <th style={{ textAlign: "right", padding: "6px 8px 6px 0", borderBottom: "0.5px solid " + C.borderLight, fontSize: 10, fontWeight: 600, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em" }}></th>
            </tr>
          </thead>
          <tbody>
            {admins.map(a => {
              const profile = adminProfiles[a.user_id];
              return (
                <tr key={a.id}>
                  <td style={{ padding: "8px 8px 8px 0", borderBottom: "0.5px solid " + C.borderLight, color: C.textPrimary, fontWeight: 500 }}>
                    {profile?.full_name || "—"}
                  </td>
                  <td style={{ padding: "8px 8px 8px 0", borderBottom: "0.5px solid " + C.borderLight, color: C.textSecondary }}>
                    {profile?.email || a.user_id.slice(0, 8)}
                  </td>
                  <td style={{ padding: "8px 8px 8px 0", borderBottom: "0.5px solid " + C.borderLight, color: C.textSecondary }}>
                    {fmtRelative(a.granted_at)}
                  </td>
                  <td style={{ padding: "8px 8px 8px 0", borderBottom: "0.5px solid " + C.borderLight }}>
                    {a.revoked_at
                      ? <Badge label="Revoked" variant="red" size="xs" />
                      : <Badge label="Active" variant="green" size="xs" />}
                  </td>
                  <td style={{ padding: "8px 0 8px 0", borderBottom: "0.5px solid " + C.borderLight, textAlign: "right" }}>
                    {!a.revoked_at && (
                      <Btn size="sm" variant="ghost" onClick={() => alert("Revoke flow: Phase 2 (requires confirmation modal)")}>Revoke</Btn>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {/* Add-on catalog */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary }}>Add-on catalog</div>
            <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 1 }}>Master list of available add-ons · {catalog.length} total</div>
          </div>
          <Btn size="sm" variant="outline" onClick={() => alert("New add-on creation: Phase 2 (requires Stripe price ID)")}>+ New add-on</Btn>
        </div>
        <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "6px 8px 6px 0", borderBottom: "0.5px solid " + C.borderLight, fontSize: 10, fontWeight: 600, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em" }}>Name</th>
              <th style={{ textAlign: "left", padding: "6px 8px 6px 0", borderBottom: "0.5px solid " + C.borderLight, fontSize: 10, fontWeight: 600, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em" }}>Eligible tiers</th>
              <th style={{ textAlign: "left", padding: "6px 8px 6px 0", borderBottom: "0.5px solid " + C.borderLight, fontSize: 10, fontWeight: 600, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em" }}>Price</th>
              <th style={{ textAlign: "left", padding: "6px 8px 6px 0", borderBottom: "0.5px solid " + C.borderLight, fontSize: 10, fontWeight: 600, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em" }}>Quota</th>
              <th style={{ textAlign: "left", padding: "6px 8px 6px 0", borderBottom: "0.5px solid " + C.borderLight, fontSize: 10, fontWeight: 600, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em" }}>Status</th>
              <th style={{ textAlign: "right", padding: "6px 8px 6px 0", borderBottom: "0.5px solid " + C.borderLight, fontSize: 10, fontWeight: 600, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em" }}>Adopted</th>
              <th style={{ textAlign: "right", padding: "6px 8px 6px 0", borderBottom: "0.5px solid " + C.borderLight, fontSize: 10, fontWeight: 600, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em" }}></th>
            </tr>
          </thead>
          <tbody>
            {catalog.map(c => (
              <tr key={c.id}>
                <td style={{ padding: "8px 8px 8px 0", borderBottom: "0.5px solid " + C.borderLight, color: C.textPrimary, fontWeight: 500 }}>{c.name}</td>
                <td style={{ padding: "8px 8px 8px 0", borderBottom: "0.5px solid " + C.borderLight }}>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {c.eligible_tiers.map(t => (
                      <Badge key={t} label={t} variant={TIER_VARIANTS[t] || "neutral"} size="xs" />
                    ))}
                  </div>
                </td>
                <td style={{ padding: "8px 8px 8px 0", borderBottom: "0.5px solid " + C.borderLight, color: C.textPrimary, fontWeight: 600 }}>
                  {fmtMoney(c.monthly_price_cents)}
                  {c.billing_model === "metered" && c.overage_price_cents != null && (
                    <span style={{ color: C.textTertiary, fontWeight: 400 }}> + {fmtMoney(c.overage_price_cents)}/over</span>
                  )}
                </td>
                <td style={{ padding: "8px 8px 8px 0", borderBottom: "0.5px solid " + C.borderLight, color: C.textSecondary }}>
                  {c.included_quota != null ? c.included_quota.toLocaleString() : "unlimited"}
                </td>
                <td style={{ padding: "8px 8px 8px 0", borderBottom: "0.5px solid " + C.borderLight }}>
                  <Badge label={c.status} variant={c.status === "live" ? "green" : c.status === "pre-launch" ? "amber" : "neutral"} size="xs" />
                </td>
                <td style={{ padding: "8px 8px 8px 0", borderBottom: "0.5px solid " + C.borderLight, color: C.textSecondary, textAlign: "right" }}>
                  {adoptionBySku[c.id] || 0} practice{adoptionBySku[c.id] === 1 ? "" : "s"}
                </td>
                <td style={{ padding: "8px 0", borderBottom: "0.5px solid " + C.borderLight, textAlign: "right" }}>
                  <Btn size="sm" variant="ghost" onClick={() => setEditAddon(c)}>Edit</Btn>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Billing config defaults */}
      <Card>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary }}>Billing settings</div>
          <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 1 }}>Stripe integration mode · grace periods · retention policies</div>
        </div>
        <ConfigRow
          label="Stripe mode"
          helper="Switch to live keys before billing real clients"
          value={<Badge label="Test mode" variant="amber" size="xs" />}
        />
        <ConfigRow
          label="Past-due grace window"
          helper="Days before active → delinquent"
          value={<span style={{ fontWeight: 600, color: C.textPrimary }}>14 days</span>}
        />
        <ConfigRow
          label="Cancelled retention"
          helper="HIPAA-compliant data retention after cancellation"
          value={<span style={{ fontWeight: 600, color: C.textPrimary }}>6 years</span>}
        />
        <ConfigRow
          label="Default trial length"
          helper="Days before trial → expired"
          value={<span style={{ fontWeight: 600, color: C.textPrimary }}>14 days</span>}
          last
        />
      </Card>

      {grantModal && (
        <GrantSuperAdminModal onClose={() => setGrantModal(false)} onDone={() => { setGrantModal(false); load(); }} />
      )}
      {editAddon && (
        <EditAddonModal addon={editAddon} onClose={() => setEditAddon(null)} onDone={() => { setEditAddon(null); load(); }} />
      )}
    </div>
  );
}

function ConfigRow({ label, helper, value, last }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "10px 0",
      borderBottom: last ? "none" : "0.5px solid " + C.borderLight,
    }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 500, color: C.textPrimary }}>{label}</div>
        <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 1 }}>{helper}</div>
      </div>
      <div>{value}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Grant super admin access modal
// ═══════════════════════════════════════════════════════════════════════════════
function GrantSuperAdminModal({ onClose, onDone }) {
  const { profile } = useAuth();
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async () => {
    if (!email.trim()) { setErr("Enter an email"); return; }
    setBusy(true);
    setErr(null);
    try {
      // Look up user by email
      const { data: user, error: lookupErr } = await supabase.from("users")
        .select("id, email, full_name")
        .eq("email", email.trim().toLowerCase())
        .maybeSingle();
      if (lookupErr) throw lookupErr;
      if (!user) {
        setErr("No PracticeOS user found with that email. They must sign in at least once before you can grant super admin access.");
        return;
      }
      const { error } = await supabase.from("super_admins").insert({
        user_id:    user.id,
        granted_by: profile.id,
        notes:      notes || null,
      });
      if (error) throw error;
      onDone();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Grant super admin access" onClose={onClose} maxWidth={460}>
      <div style={{ marginBottom: 14, fontSize: 12, color: C.textSecondary, lineHeight: 1.5 }}>
        Granting super admin access exposes the Administrator section, RLS-bypassed audit log, and platform-wide subscription controls. This action is audited.
      </div>
      <Input label="User email" value={email} onChange={setEmail} placeholder="someone@immaculate-consulting.org" />
      <Input label="Reason / notes (optional)" value={notes} onChange={setNotes} placeholder="e.g. Operations support, IC contractor" />
      {err && <div style={{ padding: 10, background: "#fef2f2", border: "0.5px solid " + C.red, borderRadius: 6, color: C.red, fontSize: 12, marginBottom: 12 }}>{err}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        <Btn onClick={submit} disabled={busy}>{busy ? "Granting..." : "Grant access"}</Btn>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Edit add-on modal (price, quota, status)
// ═══════════════════════════════════════════════════════════════════════════════
function EditAddonModal({ addon, onClose, onDone }) {
  const [price, setPrice] = useState((addon.monthly_price_cents / 100).toString());
  const [overage, setOverage] = useState(addon.overage_price_cents != null ? (addon.overage_price_cents / 100).toString() : "");
  const [quota, setQuota] = useState(addon.included_quota?.toString() || "");
  const [status, setStatus] = useState(addon.status);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const priceNum = Math.round(Number(price) * 100);
      const overageNum = overage ? Math.round(Number(overage) * 100) : null;
      const quotaNum = quota ? parseInt(quota, 10) : null;
      const { error } = await supabase.from("subscription_addons").update({
        monthly_price_cents: priceNum,
        overage_price_cents: overageNum,
        included_quota:      quotaNum,
        status,
      }).eq("id", addon.id);
      if (error) throw error;
      onDone();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={"Edit " + addon.name} onClose={onClose} maxWidth={500}>
      <div style={{ marginBottom: 14, fontSize: 12, color: C.textSecondary }}>
        SKU: <code style={{ background: C.bgTertiary, padding: "1px 6px", borderRadius: 3, fontSize: 11 }}>{addon.sku}</code>
      </div>
      <Input label="Monthly price (USD)" value={price} onChange={setPrice} placeholder="499.00" />
      {addon.billing_model === "metered" && (
        <Input label="Overage price per unit (USD)" value={overage} onChange={setOverage} placeholder="5.00" />
      )}
      <Input label={addon.billing_model === "metered" ? "Included quota (units/mo)" : "Included quota (leave empty if unlimited)"} value={quota} onChange={setQuota} placeholder="50" />
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.textSecondary, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Status</div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: "100%", padding: "8px 10px", border: "0.5px solid " + C.borderMid, borderRadius: 6, fontSize: 13, fontFamily: "inherit", background: C.bgPrimary }}>
          <option value="live">Live</option>
          <option value="pre-launch">Pre-launch</option>
          <option value="deprecated">Deprecated</option>
        </select>
      </div>
      {err && <div style={{ padding: 10, background: "#fef2f2", border: "0.5px solid " + C.red, borderRadius: 6, color: C.red, fontSize: 12, marginBottom: 12 }}>{err}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        <Btn onClick={submit} disabled={busy}>{busy ? "Saving..." : "Save changes"}</Btn>
      </div>
    </Modal>
  );
}
