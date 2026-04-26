// ═══════════════════════════════════════════════════════════════════════════════
// src/views/admin/PracticesView.jsx
// Operational view of all practices + new-practice creation flow.
//
// New practice flow (4 steps):
//   1. Identity        - name + full address
//   2. Subscription    - tier + lifecycle + add-ons
//   3. Provider seats  - number of NPI-billable clinicians + cost preview
//   4. Owner / Manager - first user account + optional provider record
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../auth/AuthProvider";
import { C } from "../../lib/tokens";
import { Badge, Btn, Card, Modal, Input, Select, Loader, ErrorBanner } from "../../components/ui";

// ── Tier base prices in cents (kept in sync with the catalog UI labels) ─────
const TIER_BASE_CENTS = { Lite: 39900, Pro: 89900, Command: 179900 };
const TIER_VARIANTS   = { Lite: "neutral", Pro: "violet", Command: "teal" };

// Seat SKUs per tier - mirrors what the edge function expects
const SEAT_SKU_BY_TIER = {
  Lite:    "provider_seat_lite",
  Pro:     "provider_seat_pro",
  Command: "provider_seat_command",
};

const LIFECYCLE_OPTIONS = [
  { value: "pending_activation", label: "Pending Activation (default — waiting for go-live)" },
  { value: "trial",              label: "Trial (free trial period)" },
  { value: "active",             label: "Active (paying immediately)" },
];

// Credentials that count as billable providers (per IC policy)
const BILLABLE_CREDENTIALS = [
  "MD", "DO", "NP", "PA", "CNM",
  "Psychiatrist", "Psychologist",
  "LCSW", "LCMHC", "LMFT",
];

const fmtMoney = (cents) => "$" + (cents / 100).toFixed(2);

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
// New practice creation modal
// ═══════════════════════════════════════════════════════════════════════════════
function NewPracticeModal({ onClose, onSuccess }) {
  const { session } = useAuth();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [catalog, setCatalog] = useState([]);

  const [form, setForm] = useState({
    practice_name:     "",
    address_line_1:    "",
    address_line_2:    "",
    city:              "",
    state:             "",
    zip:               "",
    subscription_tier: "Pro",
    lifecycle_status:  "pending_activation",
    go_live_date:      "",
    trial_ends_at:     "",
    addon_skus:        [],
    provider_seat_count: 1,
    owner_email:       "",
    owner_full_name:   "",
    owner_role:        "Owner",
    owner_is_provider: false,
    owner_provider_credential: "MD",
    owner_provider_npi:        "",
    owner_provider_specialty:  "",
  });
  const set = (k) => (v) => setForm(p => ({ ...p, [k]: v }));

  // Load addon catalog so step 2 can show non-seat add-ons. Filter out
  // seat SKUs since those are handled in their own step with quantity input.
  useEffect(() => {
    supabase.from("subscription_addons")
      .select("id, sku, name, eligible_tiers, monthly_price_cents, status")
      .neq("status", "deprecated")
      .then(({ data }) => setCatalog((data || []).filter(c => !c.sku.startsWith("provider_seat_"))));
  }, []);

  const eligibleAddons = catalog.filter(c =>
    c.eligible_tiers.includes(form.subscription_tier) && c.status === "live"
  );

  // Live cost preview
  const seatPriceCents = (() => {
    const t = form.subscription_tier;
    return t === "Lite" ? 9900 : t === "Pro" ? 19900 : 44900;
  })();
  const baseCents       = TIER_BASE_CENTS[form.subscription_tier] || 0;
  const seatTotalCents  = seatPriceCents * (form.provider_seat_count || 0);
  const addonTotalCents = eligibleAddons
    .filter(a => form.addon_skus.includes(a.sku))
    .reduce((sum, a) => sum + (a.monthly_price_cents || 0), 0);
  const monthlyTotalCents = baseCents + seatTotalCents + addonTotalCents;

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
    if (step === 3) return form.provider_seat_count >= 0 && form.provider_seat_count <= 100;
    if (step === 4) {
      if (!form.owner_email.includes("@")) return false;
      if (!form.owner_full_name.trim())    return false;
      if (!["Owner", "Manager"].includes(form.owner_role)) return false;
      if (form.owner_is_provider && !form.owner_provider_credential) return false;
      return true;
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
    <Modal title={"Create new practice · Step " + step + " of 4"} onClose={onClose} maxWidth={620}>
      <div style={{ display: "flex", gap: 4, marginBottom: 18 }}>
        {[1, 2, 3, 4].map(s => (
          <div key={s} style={{
            flex: 1, height: 3, borderRadius: 2,
            background: s <= step ? C.teal : C.borderLight,
          }} />
        ))}
      </div>

      {/* STEP 1: identity + address */}
      {step === 1 && (
        <>
          <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 14 }}>
            Practice identity. Name is required; address can be filled in later. Multi-location practices: enter the primary address here, additional locations can be added later.
          </div>
          <Input label="Practice name *" value={form.practice_name} onChange={set("practice_name")} placeholder="Maple Family Medicine" />
          <Input label="Address line 1" value={form.address_line_1} onChange={set("address_line_1")} placeholder="100 Main Street" />
          <Input label="Address line 2 (suite, floor, etc.)" value={form.address_line_2} onChange={set("address_line_2")} placeholder="Suite 200" />
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 10 }}>
            <Input label="City" value={form.city} onChange={set("city")} placeholder="Durham" />
            <Input label="State" value={form.state} onChange={set("state")} placeholder="NC" />
            <Input label="ZIP" value={form.zip} onChange={set("zip")} placeholder="27701" />
          </div>
        </>
      )}

      {/* STEP 2: subscription */}
      {step === 2 && (
        <>
          <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 14 }}>
            Choose tier, starting lifecycle state, and any add-ons. The base tier fee covers system access for the practice; provider seats are separate (next step).
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
                      {fmtMoney(TIER_BASE_CENTS[t])}/mo base
                    </div>
                    <div style={{ fontSize: 9, color: C.textTertiary, marginTop: 1 }}>
                      + {t === "Lite" ? "$99" : t === "Pro" ? "$199" : "$449"}/seat
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
                Optional add-ons for {form.subscription_tier}
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
                    <input type="checkbox" checked={checked} onChange={() => toggleAddon(a.sku)} style={{ accentColor: C.teal }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 500, color: C.textPrimary }}>{a.name}</div>
                      <div style={{ fontSize: 10, color: C.textTertiary, marginTop: 1 }}>{fmtMoney(a.monthly_price_cents)}/mo</div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* STEP 3: provider seats */}
      {step === 3 && (
        <>
          <div style={{ padding: 14, background: C.bgSecondary, border: "0.5px solid " + C.borderLight, borderRadius: 8, marginBottom: 16, fontSize: 12, color: C.textPrimary, lineHeight: 1.6 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>What counts as a billable provider?</div>
            <div style={{ color: C.textSecondary }}>
              Each <b>NPI-credentialed clinician</b> who creates billable encounters under their own NPI requires a paid seat: MD, DO, NP, PA, CNM, psychiatrist, psychologist, LCSW, LCMHC, LMFT.
            </div>
            <div style={{ color: C.textSecondary, marginTop: 8 }}>
              <b>No seat needed for:</b> RNs, LPNs, MAs, care managers, care coordinators, CHWs, scribes, billers, and admin staff. They get free PracticeOS accounts as part of the practice subscription.
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.textSecondary, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Number of billable providers</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Btn size="sm" variant="outline"
                disabled={form.provider_seat_count <= 0}
                onClick={() => set("provider_seat_count")(Math.max(0, form.provider_seat_count - 1))}>−</Btn>
              <input
                type="number"
                min="0" max="100"
                value={form.provider_seat_count}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  set("provider_seat_count")(Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0);
                }}
                style={{
                  width: 80, textAlign: "center",
                  padding: "8px 10px",
                  border: "0.5px solid " + C.borderMid,
                  borderRadius: 6,
                  fontSize: 16, fontWeight: 700,
                  fontFamily: "inherit",
                  color: C.textPrimary,
                }}
              />
              <Btn size="sm" variant="outline"
                onClick={() => set("provider_seat_count")(Math.min(100, form.provider_seat_count + 1))}>+</Btn>
              <span style={{ fontSize: 12, color: C.textTertiary }}>
                × {fmtMoney(seatPriceCents)}/mo each ({form.subscription_tier})
              </span>
            </div>
            {form.provider_seat_count === 0 && (
              <div style={{ fontSize: 11, color: C.amber, marginTop: 8 }}>
                Note: 0 seats means no providers can create encounters yet. You can add seats later via the Subscriptions panel.
              </div>
            )}
          </div>

          {/* Live cost preview */}
          <div style={{ padding: 14, background: C.tealBg, border: "0.5px solid " + C.tealBorder, borderRadius: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.teal, marginBottom: 8 }}>Monthly cost preview</div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0", color: C.textSecondary }}>
              <span>{form.subscription_tier} base</span>
              <span style={{ color: C.textPrimary, fontWeight: 600 }}>{fmtMoney(baseCents)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0", color: C.textSecondary }}>
              <span>{form.provider_seat_count} provider seat{form.provider_seat_count === 1 ? "" : "s"} × {fmtMoney(seatPriceCents)}</span>
              <span style={{ color: C.textPrimary, fontWeight: 600 }}>{fmtMoney(seatTotalCents)}</span>
            </div>
            {addonTotalCents > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0", color: C.textSecondary }}>
                <span>{form.addon_skus.length} additional add-on{form.addon_skus.length === 1 ? "" : "s"}</span>
                <span style={{ color: C.textPrimary, fontWeight: 600 }}>{fmtMoney(addonTotalCents)}</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "8px 0 0", marginTop: 4, borderTop: "0.5px solid " + C.tealBorder, color: C.textPrimary, fontWeight: 700 }}>
              <span>Total</span>
              <span>{fmtMoney(monthlyTotalCents)}/mo</span>
            </div>
          </div>
        </>
      )}

      {/* STEP 4: owner */}
      {step === 4 && (
        <>
          <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 14 }}>
            Create the first user account. They'll receive an invite email with a link to set their password and log in.
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
          <Input label="Email * (invite link goes here)" value={form.owner_email} onChange={set("owner_email")} placeholder="sarah@maplefamilymed.com" />

          <label style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "12px 14px",
            border: "0.5px solid " + (form.owner_is_provider ? C.tealBorder : C.borderLight),
            borderRadius: 8,
            background: form.owner_is_provider ? C.tealBg : "transparent",
            marginTop: 10, cursor: "pointer",
          }}>
            <input type="checkbox" checked={form.owner_is_provider}
              onChange={(e) => set("owner_is_provider")(e.target.checked)}
              style={{ accentColor: C.teal }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: C.textPrimary }}>This user is also a billable provider</div>
              <div style={{ fontSize: 11, color: C.textSecondary, marginTop: 2, lineHeight: 1.4 }}>
                Check this if the user creates encounters under their own NPI (MD/DO/NP/PA, etc). A provider record will be created and counted against your {form.provider_seat_count} purchased seat{form.provider_seat_count === 1 ? "" : "s"}.
              </div>
            </div>
          </label>

          {form.owner_is_provider && (
            <div style={{ marginTop: 12, padding: 14, background: C.bgSecondary, border: "0.5px solid " + C.borderLight, borderRadius: 8 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Select label="Credential *" value={form.owner_provider_credential} onChange={set("owner_provider_credential")}
                  options={BILLABLE_CREDENTIALS} />
                <Input label="NPI (optional)" value={form.owner_provider_npi} onChange={set("owner_provider_npi")} placeholder="1234567890" />
              </div>
              <Input label="Specialty (optional)" value={form.owner_provider_specialty} onChange={set("owner_provider_specialty")} placeholder="Family Medicine" />
              {form.provider_seat_count === 0 && (
                <div style={{ fontSize: 11, color: C.amber, marginTop: 8 }}>
                  Heads up: you set provider seats to 0 in the previous step. The owner is being marked as a provider but won't have a seat allocated. Go back and bump seats to ≥1 if needed.
                </div>
              )}
            </div>
          )}
        </>
      )}

      {err && <div style={{ padding: 10, background: "#fef2f2", border: "0.5px solid " + C.red, borderRadius: 6, color: C.red, fontSize: 12, marginTop: 14 }}>{err}</div>}

      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 18, borderTop: "0.5px solid " + C.borderLight, paddingTop: 14 }}>
        <Btn variant="ghost" onClick={onClose} disabled={busy}>Cancel</Btn>
        <div style={{ display: "flex", gap: 8 }}>
          {step > 1 && (
            <Btn variant="outline" onClick={() => setStep(s => s - 1)} disabled={busy}>← Back</Btn>
          )}
          {step < 4 ? (
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
// Success modal
// ═══════════════════════════════════════════════════════════════════════════════
function SuccessModal({ info, onClose }) {
  return (
    <Modal title="Practice created successfully" onClose={onClose} maxWidth={520}>
      <div style={{ padding: 14, background: C.tealBg, border: "0.5px solid " + C.tealBorder, borderRadius: 8, marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.textPrimary, marginBottom: 8 }}>
          ✓ {info.practice.name} is ready
        </div>
        <div style={{ fontSize: 12, color: C.textSecondary, lineHeight: 1.6 }}>
          <div><b>Tier:</b> {info.practice.subscription_tier}</div>
          <div><b>Lifecycle:</b> {info.practice.lifecycle_status}</div>
          <div><b>Owner:</b> {info.owner.email} ({info.owner.role})</div>
          {info.owner.provider_id && <div><b>Provider record:</b> created and linked to user account</div>}
          <div><b>Provider seats granted:</b> {info.provider_seats_granted}</div>
          {info.addons_granted?.length > 0 && (
            <div><b>Add-ons:</b> {info.addons_granted.map(a => a.sku + (a.quantity > 1 ? ` (×${a.quantity})` : "")).join(", ")}</div>
          )}
        </div>
      </div>

      <div style={{ padding: 12, background: C.bgSecondary, border: "0.5px solid " + C.borderLight, borderRadius: 8, marginBottom: 14, fontSize: 12 }}>
        <div style={{ fontWeight: 600, color: C.textPrimary, marginBottom: 4 }}>📧 Invite email sent</div>
        <div style={{ color: C.textSecondary, lineHeight: 1.5 }}>
          {info.owner.email} will receive an invite link to set their password and log in. The link expires in 24 hours. If they don't see it, ask them to check spam, then resend from the user's row in this admin panel.
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Btn onClick={onClose}>Done</Btn>
      </div>
    </Modal>
  );
}
