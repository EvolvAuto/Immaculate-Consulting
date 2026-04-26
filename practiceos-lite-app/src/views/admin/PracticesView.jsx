// ═══════════════════════════════════════════════════════════════════════════════
// src/views/admin/PracticesView.jsx
// Operational view of all practices. Different lens from Subscriptions
// (which is billing-focused). Shows operational metadata: patient count,
// last activity, staff roster size, onboarding completeness signal.
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../auth/AuthProvider";
import { C } from "../../lib/tokens";
import { Badge, Btn, Card, Modal, Input, Select, Loader, ErrorBanner } from "../../components/ui";

const TIER_VARIANTS = { Lite: "neutral", Pro: "violet", Command: "teal" };

const LIFECYCLE_OPTIONS = [
  { value: "pending_activation", label: "Pending Activation (default — waiting for go-live)" },
  { value: "trial",              label: "Trial (free trial period)" },
  { value: "active",             label: "Active (paying immediately)" },
];

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
  if (dy < 30) return dy + "d ago";
  return d.toLocaleDateString();
}

export default function PracticesView() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [successInfo, setSuccessInfo] = useState(null);

  const load = async () => {
    try {
      setLoading(true);
      const { data: practices, error: pErr } = await supabase
        .from("practices")
        .select("id, name, subscription_tier, lifecycle_status, created_at, city, state")
        .order("name");
      if (pErr) throw pErr;

      // Pull aggregate counts for each practice in parallel.
      const enriched = await Promise.all((practices || []).map(async (p) => {
        const [patientsRes, staffRes, lastEncRes] = await Promise.all([
          supabase.from("patients").select("id", { count: "exact", head: true }).eq("practice_id", p.id),
          supabase.from("users").select("id", { count: "exact", head: true }).eq("practice_id", p.id).eq("is_active", true),
          supabase.from("encounters").select("created_at").eq("practice_id", p.id).order("created_at", { ascending: false }).limit(1),
        ]);
        return {
          ...p,
          patient_count: patientsRes.count || 0,
          staff_count:   staffRes.count    || 0,
          last_activity: lastEncRes.data?.[0]?.created_at || null,
        };
      }));

      setRows(enriched);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  if (loading) return <div style={{ padding: 40 }}><Loader /></div>;

  return (
    <div style={{ padding: 20 }}>
      {error && <ErrorBanner message={error} />}
      <Card>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary }}>All practices</div>
            <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 1 }}>{rows.length} total</div>
          </div>
          <Btn size="sm" variant="primary" onClick={() => setCreateModalOpen(true)}>+ New practice</Btn>
        </div>

        <div style={{ border: "0.5px solid " + C.borderLight, borderRadius: 8, overflow: "hidden" }}>
          <div style={{
            display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr 60px",
            gap: 10, padding: "10px 14px",
            background: C.bgSecondary,
            fontSize: 10, fontWeight: 700,
            color: C.textTertiary,
            textTransform: "uppercase", letterSpacing: "0.06em",
            borderBottom: "0.5px solid " + C.borderLight,
          }}>
            <div>Practice</div>
            <div>Tier</div>
            <div>Lifecycle</div>
            <div>Patients</div>
            <div>Staff</div>
            <div>Last activity</div>
            <div></div>
          </div>
          {rows.map(r => (
            <div key={r.id} style={{
              display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr 60px",
              gap: 10, padding: "12px 14px",
              borderBottom: "0.5px solid " + C.borderLight,
              fontSize: 12, alignItems: "center",
            }}>
              <div>
                <div style={{ fontWeight: 600, color: C.textPrimary, marginBottom: 2 }}>{r.name}</div>
                <div style={{ fontSize: 10, color: C.textTertiary }}>
                  {r.city ? r.city + (r.state ? ", " + r.state : "") + " · " : ""}{r.id.slice(0, 8)}
                </div>
              </div>
              <div><Badge label={r.subscription_tier} variant={TIER_VARIANTS[r.subscription_tier] || "neutral"} size="xs" /></div>
              <div style={{ color: C.textPrimary }}>{r.lifecycle_status}</div>
              <div style={{ fontWeight: 600, color: C.textPrimary }}>{r.patient_count.toLocaleString()}</div>
              <div style={{ fontWeight: 600, color: C.textPrimary }}>{r.staff_count}</div>
              <div style={{ color: C.textSecondary }}>{fmtRelative(r.last_activity)}</div>
              <div><Btn size="sm" variant="ghost" onClick={() => alert("Practice deep-dive view: deferred to onboarding wizard build")}>→</Btn></div>
            </div>
          ))}
        </div>
      </Card>

      {createModalOpen && (
        <NewPracticeModal
          onClose={() => setCreateModalOpen(false)}
          onSuccess={(info) => {
            setCreateModalOpen(false);
            setSuccessInfo(info);
            load();
          }}
        />
      )}
      {successInfo && (
        <SuccessModal info={successInfo} onClose={() => setSuccessInfo(null)} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// New practice creation modal - 3 steps: identity, subscription, owner
// Calls the admin-create-practice edge function which handles auth user
// creation + practice insert + add-on grants + history write atomically.
// ═══════════════════════════════════════════════════════════════════════════════
function NewPracticeModal({ onClose, onSuccess }) {
  const { session } = useAuth();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [catalog, setCatalog] = useState([]);

  const [form, setForm] = useState({
    practice_name:     "",
    city:              "",
    state:             "",
    subscription_tier: "Pro",
    lifecycle_status:  "pending_activation",
    go_live_date:      "",
    trial_ends_at:     "",
    owner_email:       "",
    owner_full_name:   "",
    owner_role:        "Owner",
    addon_skus:        [],
    send_setup_email:  true,
  });
  const set = (k) => (v) => setForm(p => ({ ...p, [k]: v }));

  // Load addon catalog so we can show eligible add-ons in step 2
  useEffect(() => {
    supabase.from("subscription_addons")
      .select("id, sku, name, eligible_tiers, monthly_price_cents, status")
      .neq("status", "deprecated")
      .then(({ data }) => setCatalog(data || []));
  }, []);

  const eligibleAddons = catalog.filter(c =>
    c.eligible_tiers.includes(form.subscription_tier) && c.status === "live"
  );

  const toggleAddon = (sku) => {
    setForm(p => ({
      ...p,
      addon_skus: p.addon_skus.includes(sku)
        ? p.addon_skus.filter(s => s !== sku)
        : [...p.addon_skus, sku],
    }));
  };

  const canAdvance = () => {
    if (step === 1) return form.practice_name.trim().length > 0;
    if (step === 2) {
      if (form.lifecycle_status === "trial" && !form.trial_ends_at) return false;
      return true;
    }
    if (step === 3) {
      return form.owner_email.includes("@") &&
             form.owner_full_name.trim().length > 0 &&
             ["Owner", "Manager"].includes(form.owner_role);
    }
    return false;
  };

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-create-practice`;
      const res = await fetch(fnUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${session?.access_token}`,
          "Content-Type":  "application/json",
        },
        body: JSON.stringify(form),
      });
      const result = await res.json();
      if (!res.ok || !result.ok) {
        const msg = result?.error || `HTTP ${res.status}`;
        const detail = result?.detail ? ` — ${result.detail}` : "";
        throw new Error(msg + detail);
      }
      onSuccess(result);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={"Create new practice · Step " + step + " of 3"} onClose={onClose} maxWidth={560}>
      <div style={{ display: "flex", gap: 4, marginBottom: 18 }}>
        {[1, 2, 3].map(s => (
          <div key={s} style={{
            flex: 1, height: 3, borderRadius: 2,
            background: s <= step ? C.teal : C.borderLight,
          }} />
        ))}
      </div>

      {step === 1 && (
        <>
          <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 14 }}>
            Practice identity. Name is required; address fields help operationally but can be filled in later.
          </div>
          <Input label="Practice name *" value={form.practice_name} onChange={set("practice_name")} placeholder="e.g. Maple Family Medicine" />
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
            <Input label="City" value={form.city} onChange={set("city")} placeholder="Durham" />
            <Input label="State" value={form.state} onChange={set("state")} placeholder="NC" />
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 14 }}>
            Choose tier, starting lifecycle state, and any add-ons. Add-ons can be granted now or activated later via the Subscriptions panel.
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.textSecondary, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Subscription tier</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {["Lite", "Pro", "Command"].map(t => {
                const sel = form.subscription_tier === t;
                return (
                  <button key={t} onClick={() => set("subscription_tier")(t)}
                    style={{
                      padding: "12px 8px",
                      border: "0.5px solid " + (sel ? C.teal : C.borderLight),
                      borderRadius: 8,
                      background: sel ? C.tealBg : C.bgPrimary,
                      cursor: "pointer", fontFamily: "inherit",
                      textAlign: "center",
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 700, color: sel ? C.teal : C.textPrimary }}>{t}</div>
                    <div style={{ fontSize: 10, color: C.textTertiary, marginTop: 2 }}>
                      {t === "Lite" ? "$399/mo" : t === "Pro" ? "$899/mo" : "$1,799/mo"}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.textSecondary, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Starting lifecycle state</div>
            <Select
              value={form.lifecycle_status}
              onChange={set("lifecycle_status")}
              options={LIFECYCLE_OPTIONS}
            />
          </div>

          {form.lifecycle_status === "pending_activation" && (
            <Input label="Go-live date (optional)" type="date" value={form.go_live_date} onChange={set("go_live_date")} />
          )}
          {form.lifecycle_status === "trial" && (
            <Input label="Trial ends * (required for trial state)" type="date" value={form.trial_ends_at} onChange={set("trial_ends_at")} />
          )}

          {eligibleAddons.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.textSecondary, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Add-ons eligible for {form.subscription_tier} (optional)
              </div>
              {eligibleAddons.map(a => {
                const checked = form.addon_skus.includes(a.sku);
                return (
                  <label key={a.id} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "10px 12px",
                    border: "0.5px solid " + (checked ? C.tealBorder : C.borderLight),
                    borderRadius: 7, cursor: "pointer",
                    background: checked ? C.tealBg : "transparent",
                    marginBottom: 6,
                  }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleAddon(a.sku)}
                      style={{ accentColor: C.teal }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 500, color: C.textPrimary }}>{a.name}</div>
                      <div style={{ fontSize: 10, color: C.textTertiary, marginTop: 1 }}>
                        ${(a.monthly_price_cents / 100).toFixed(2)}/mo
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </>
      )}

      {step === 3 && (
        <>
          <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 14 }}>
            Create the first user account for this practice. They will receive a password setup email and choose their own password on first login.
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.textSecondary, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>This user is</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {["Owner", "Manager"].map(r => {
                const sel = form.owner_role === r;
                return (
                  <button key={r} onClick={() => set("owner_role")(r)}
                    style={{
                      padding: "12px 8px",
                      border: "0.5px solid " + (sel ? C.teal : C.borderLight),
                      borderRadius: 8,
                      background: sel ? C.tealBg : C.bgPrimary,
                      cursor: "pointer", fontFamily: "inherit",
                      textAlign: "center",
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 700, color: sel ? C.teal : C.textPrimary }}>
                      {r === "Owner" ? "Owner" : "Practice Manager"}
                    </div>
                    <div style={{ fontSize: 10, color: C.textTertiary, marginTop: 2 }}>
                      {r === "Owner" ? "Full admin access" : "Operational admin, no billing"}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <Input label="Full name *" value={form.owner_full_name} onChange={set("owner_full_name")} placeholder="Dr. Sarah Patel" />
          <Input label="Email * (password setup link goes here)" value={form.owner_email} onChange={set("owner_email")} placeholder="sarah@maplefamilymed.com" />

          <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", border: "0.5px solid " + C.borderLight, borderRadius: 7, marginTop: 6 }}>
            <input
              type="checkbox"
              checked={form.send_setup_email}
              onChange={(e) => set("send_setup_email")(e.target.checked)}
              style={{ accentColor: C.teal }}
            />
            <span style={{ fontSize: 12, color: C.textPrimary }}>Send password setup email immediately</span>
          </label>
        </>
      )}

      {err && <div style={{ padding: 10, background: "#fef2f2", border: "0.5px solid " + C.red, borderRadius: 6, color: C.red, fontSize: 12, marginTop: 14 }}>{err}</div>}

      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 18, borderTop: "0.5px solid " + C.borderLight, paddingTop: 14 }}>
        <Btn variant="ghost" onClick={onClose} disabled={busy}>Cancel</Btn>
        <div style={{ display: "flex", gap: 8 }}>
          {step > 1 && (
            <Btn variant="outline" onClick={() => setStep(s => s - 1)} disabled={busy}>← Back</Btn>
          )}
          {step < 3 ? (
            <Btn onClick={() => setStep(s => s + 1)} disabled={!canAdvance() || busy}>Next →</Btn>
          ) : (
            <Btn onClick={submit} disabled={!canAdvance() || busy}>
              {busy ? "Creating..." : "Create practice"}
            </Btn>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Success modal shown after creation
// ═══════════════════════════════════════════════════════════════════════════════
function SuccessModal({ info, onClose }) {
  return (
    <Modal title="Practice created successfully" onClose={onClose} maxWidth={500}>
      <div style={{ padding: 14, background: C.tealBg, border: "0.5px solid " + C.tealBorder, borderRadius: 8, marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.textPrimary, marginBottom: 8 }}>
          ✓ {info.practice.name} is ready
        </div>
        <div style={{ fontSize: 12, color: C.textSecondary, lineHeight: 1.6 }}>
          <div><b>Tier:</b> {info.practice.subscription_tier}</div>
          <div><b>Lifecycle:</b> {info.practice.lifecycle_status}</div>
          <div><b>Owner:</b> {info.owner.email} ({info.owner.role})</div>
          {info.addons_granted?.length > 0 && (
            <div><b>Add-ons granted:</b> {info.addons_granted.join(", ")}</div>
          )}
        </div>
      </div>

      {info.setup_email_sent ? (
        <div style={{ padding: 12, background: C.bgSecondary, border: "0.5px solid " + C.borderLight, borderRadius: 8, marginBottom: 14, fontSize: 12 }}>
          <div style={{ fontWeight: 600, color: C.textPrimary, marginBottom: 4 }}>📧 Password setup email sent</div>
          <div style={{ color: C.textSecondary, lineHeight: 1.5 }}>
            {info.owner.email} will receive a link to set their password and log in.
          </div>
        </div>
      ) : info.setup_email_error ? (
        <div style={{ padding: 12, background: C.amberBg, border: "0.5px solid " + C.amberBorder, borderRadius: 8, marginBottom: 14, fontSize: 12 }}>
          <div style={{ fontWeight: 600, color: C.textPrimary, marginBottom: 4 }}>⚠ Setup email failed</div>
          <div style={{ color: C.textSecondary, lineHeight: 1.5 }}>
            Practice and account were created, but the setup email could not be sent: <code>{info.setup_email_error}</code>. The user can click "Forgot password" on the login page to trigger another setup link.
          </div>
        </div>
      ) : (
        <div style={{ padding: 12, background: C.amberBg, border: "0.5px solid " + C.amberBorder, borderRadius: 8, marginBottom: 14, fontSize: 12 }}>
          <div style={{ fontWeight: 600, color: C.textPrimary, marginBottom: 4 }}>⚠ No setup email sent</div>
          <div style={{ color: C.textSecondary, lineHeight: 1.5 }}>
            You opted not to send a setup email. Have the owner click "Forgot password" on the login page when they're ready to set up their account.
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Btn onClick={onClose}>Done</Btn>
      </div>
    </Modal>
  );
}
