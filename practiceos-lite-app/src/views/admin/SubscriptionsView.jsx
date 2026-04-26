// ═══════════════════════════════════════════════════════════════════════════════
// src/views/admin/SubscriptionsView.jsx
// Practice list + detail panel. Manage lifecycle, add-ons, proration,
// transitions, and Stripe sync state.
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../auth/AuthProvider";
import { C } from "../../lib/tokens";
import { Badge, Btn, Card, Modal, Input, Loader, ErrorBanner } from "../../components/ui";

const LIFECYCLE_LABELS = {
  prospect:           "Prospect",
  pending_activation: "Pending",
  trial:              "Trial",
  active:             "Active",
  past_due:           "Past Due",
  delinquent:         "Delinquent",
  paused:             "Paused",
  cancelled:          "Cancelled",
  archived:           "Archived",
};

const LIFECYCLE_VARIANTS = {
  prospect:           "neutral",
  pending_activation: "blue",
  trial:              "violet",
  active:             "green",
  past_due:           "amber",
  delinquent:         "red",
  paused:             "amber",
  cancelled:          "red",
  archived:           "neutral",
};

const FILTER_CHIPS = [
  { key: "all",        label: "All" },
  { key: "active",     label: "Active" },
  { key: "trial",      label: "Trial" },
  { key: "pending",    label: "Pending" },
  { key: "past_due",   label: "Past Due" },
  { key: "delinquent", label: "Delinquent" },
  { key: "paused",     label: "Paused" },
  { key: "cancelled",  label: "Cancelled" },
];

function fmtMoney(cents) {
  if (cents == null) return "—";
  const dollars = Math.abs(cents) / 100;
  const sign = cents < 0 ? "-" : "";
  return sign + "$" + dollars.toFixed(2);
}

function fmtDate(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function SubscriptionsView() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [practices, setPractices] = useState([]);
  const [addonsCatalog, setAddonsCatalog] = useState([]);
  const [practiceAddons, setPracticeAddons] = useState({}); // practiceId -> addons[]
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  const load = async () => {
    try {
      setLoading(true);
      const [pRes, aRes, paRes] = await Promise.all([
        supabase.from("practices")
          .select("id, name, subscription_tier, lifecycle_status, lifecycle_status_changed_at, go_live_date, trial_ends_at, paused_until, past_due_since, cancelled_at, data_retention_until, stripe_customer_id, stripe_subscription_id, stripe_status, billing_cycle_anchor, ai_message_cap_override, created_at")
          .order("name", { ascending: true }),
        supabase.from("subscription_addons").select("*").order("name"),
        supabase.from("practice_addons")
          .select("id, practice_id, addon_id, status, activated_at, effective_date, cancelled_at, custom_quota_override, subscription_addons(sku, name, monthly_price_cents, included_quota, status)")
          .in("status", ["active", "pending"]),
      ]);
      if (pRes.error) throw pRes.error;
      if (aRes.error) throw aRes.error;
      if (paRes.error) throw paRes.error;

      setPractices(pRes.data || []);
      setAddonsCatalog(aRes.data || []);

      const addonsByPractice = {};
      (paRes.data || []).forEach(row => {
        if (!addonsByPractice[row.practice_id]) addonsByPractice[row.practice_id] = [];
        addonsByPractice[row.practice_id].push(row);
      });
      setPracticeAddons(addonsByPractice);

      if (!selectedId && pRes.data && pRes.data.length > 0) {
        setSelectedId(pRes.data[0].id);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const displayed = useMemo(() => {
    return practices.filter(p => {
      if (filter !== "all") {
        if (filter === "pending" && p.lifecycle_status !== "pending_activation") return false;
        if (filter !== "pending" && p.lifecycle_status !== filter) return false;
      }
      if (search.trim()) {
        const s = search.toLowerCase();
        if (!p.name.toLowerCase().includes(s)) return false;
      }
      return true;
    });
  }, [practices, filter, search]);

  const selected = practices.find(p => p.id === selectedId);

  if (loading) return <div style={{ padding: 40 }}><Loader /></div>;

  return (
    <div style={{ padding: 20, height: "calc(100vh - 168px)", display: "flex", flexDirection: "column" }}>
      {error && <ErrorBanner message={error} />}
      <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: 16, flex: 1, minHeight: 0 }}>
        {/* List panel */}
        <div style={{ background: C.bgPrimary, border: "0.5px solid " + C.borderLight, borderRadius: 10, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "12px 14px 8px", borderBottom: "0.5px solid " + C.borderLight }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search practice name..."
              style={{
                width: "100%",
                background: C.bgSecondary,
                border: "0.5px solid " + C.borderLight,
                borderRadius: 7,
                padding: "7px 10px",
                fontSize: 12,
                fontFamily: "inherit",
                outline: "none",
                color: C.textPrimary,
              }}
            />
          </div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", padding: "8px 14px", borderBottom: "0.5px solid " + C.borderLight }}>
            {FILTER_CHIPS.map(chip => {
              const active = filter === chip.key;
              return (
                <button
                  key={chip.key}
                  onClick={() => setFilter(chip.key)}
                  style={{
                    fontSize: 10, fontWeight: 600,
                    textTransform: "uppercase", letterSpacing: "0.06em",
                    padding: "3px 8px",
                    borderRadius: 4,
                    background: active ? C.tealBg : "transparent",
                    color: active ? C.teal : C.textTertiary,
                    border: "0.5px solid " + (active ? C.tealBorder : C.borderLight),
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >{chip.label}</button>
              );
            })}
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {displayed.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", fontSize: 12, color: C.textTertiary }}>
                No practices match.
              </div>
            ) : displayed.map(p => {
              const isSelected = p.id === selectedId;
              const addons = practiceAddons[p.id] || [];
              return (
                <div
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  style={{
                    padding: "12px 14px",
                    borderBottom: "0.5px solid " + C.borderLight,
                    cursor: "pointer",
                    position: "relative",
                    background: isSelected ? C.tealBg : "transparent",
                  }}
                >
                  {isSelected && <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 2, background: C.teal }} />}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: C.textPrimary }}>{p.name}</span>
                    <Badge label={LIFECYCLE_LABELS[p.lifecycle_status]} variant={LIFECYCLE_VARIANTS[p.lifecycle_status]} size="xs" />
                  </div>
                  <div style={{ fontSize: 11, color: C.textTertiary, marginBottom: 6 }}>
                    {p.subscription_tier} {addons.length > 0 ? "· " + addons.length + " add-on" + (addons.length === 1 ? "" : "s") : ""}
                  </div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    <Badge label={p.subscription_tier} variant={p.subscription_tier === "Command" ? "teal" : p.subscription_tier === "Pro" ? "violet" : "neutral"} size="xs" />
                    {addons.map(a => (
                      <span key={a.id} style={{
                        fontSize: 9.5, fontWeight: 600,
                        padding: "2px 6px",
                        borderRadius: 3,
                        background: C.tealBg,
                        color: C.teal,
                        border: "0.5px solid " + C.tealBorder,
                      }}>+ {a.subscription_addons.name}</span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Detail panel */}
        {selected ? (
          <PracticeDetailPanel
            practice={selected}
            addons={practiceAddons[selected.id] || []}
            catalog={addonsCatalog}
            profile={profile}
            onChange={load}
          />
        ) : (
          <div style={{ background: C.bgPrimary, border: "0.5px solid " + C.borderLight, borderRadius: 10, padding: 40, textAlign: "center", color: C.textTertiary }}>
            Select a practice from the list.
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Practice detail panel
// ═══════════════════════════════════════════════════════════════════════════════
function PracticeDetailPanel({ practice, addons, catalog, profile, onChange }) {
  const [history, setHistory] = useState([]);
  const [requests, setRequests] = useState([]);
  const [transitionModal, setTransitionModal] = useState(null);
  const [addonModal, setAddonModal] = useState(null);

  const loadAux = async () => {
    const [hRes, rRes] = await Promise.all([
      supabase.from("subscription_change_history")
        .select("*")
        .eq("practice_id", practice.id)
        .order("created_at", { ascending: false })
        .limit(10),
      supabase.from("subscription_change_requests")
        .select("*")
        .eq("practice_id", practice.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
    ]);
    setHistory(hRes.data || []);
    setRequests(rRes.data || []);
  };

  useEffect(() => {
    if (practice?.id) loadAux();
    /* eslint-disable-next-line */
  }, [practice?.id]);

  const eligibleAddons = catalog.filter(c => {
    if (!c.eligible_tiers.includes(practice.subscription_tier)) return false;
    if (c.status === "deprecated") return false;
    return true;
  });

  const activeAddonsBySku = {};
  addons.forEach(a => { activeAddonsBySku[a.subscription_addons.sku] = a; });

  const monthlyTotalCents = (() => {
    const tierBase = practice.subscription_tier === "Command" ? 179900
                   : practice.subscription_tier === "Pro"     ? 89900
                   : practice.subscription_tier === "Lite"    ? 39900
                   : 0;
    const addonsTotal = addons.reduce((sum, a) => sum + (a.subscription_addons.monthly_price_cents || 0), 0);
    return tierBase + addonsTotal;
  })();

  return (
    <div style={{ background: C.bgPrimary, border: "0.5px solid " + C.borderLight, borderRadius: 10, overflowY: "auto" }}>
      {/* Header */}
      <div style={{ padding: "18px 22px", borderBottom: "0.5px solid " + C.borderLight, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.textPrimary, letterSpacing: "-0.01em", marginBottom: 4 }}>
            {practice.name}
          </div>
          <div style={{ fontSize: 11, color: C.textTertiary, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span>{practice.id.slice(0, 8)}</span>
            <span style={{ color: C.borderMid }}>·</span>
            <span>{LIFECYCLE_LABELS[practice.lifecycle_status]} since {fmtDate(practice.lifecycle_status_changed_at)}</span>
            {practice.stripe_customer_id && (
              <>
                <span style={{ color: C.borderMid }}>·</span>
                <span style={{ color: C.teal, fontWeight: 600 }}>Stripe linked</span>
              </>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <ViewAsOwnerButton practice={practice} />
          <Btn size="sm" variant="outline" onClick={() => setTransitionModal(true)}>Change state</Btn>
        </div>
      </div>

      <div style={{ padding: "18px 22px" }}>
        {/* Stat row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
          <Card>
            <div style={{ fontSize: 10, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5, fontWeight: 600 }}>Subscription</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: C.textPrimary }}>{practice.subscription_tier}</div>
            <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 3 }}>
              {fmtMoney(monthlyTotalCents)}/mo {addons.length > 0 ? "(base + " + addons.length + " add-on" + (addons.length === 1 ? "" : "s") + ")" : ""}
            </div>
          </Card>
          <Card>
            <div style={{ fontSize: 10, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5, fontWeight: 600 }}>Lifecycle</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: C.textPrimary }}>{LIFECYCLE_LABELS[practice.lifecycle_status]}</div>
            <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 3 }}>
              {practice.lifecycle_status === "trial" && practice.trial_ends_at ? "Trial ends " + fmtDate(practice.trial_ends_at)
               : practice.lifecycle_status === "paused" && practice.paused_until ? "Resumes " + fmtDate(practice.paused_until)
               : practice.lifecycle_status === "past_due" && practice.past_due_since ? "Past due since " + fmtDate(practice.past_due_since)
               : practice.lifecycle_status === "pending_activation" && practice.go_live_date ? "Go-live " + practice.go_live_date
               : "—"}
            </div>
          </Card>
          <Card>
            <div style={{ fontSize: 10, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5, fontWeight: 600 }}>AI cap override</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: C.textPrimary }}>{practice.ai_message_cap_override == null ? "Default" : practice.ai_message_cap_override.toLocaleString()}</div>
            <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 3 }}>{practice.ai_message_cap_override == null ? "Using tier default" : "Per-practice override"}</div>
          </Card>
        </div>

        {/* Add-ons */}
        <Card style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary }}>Add-ons</div>
              <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 1 }}>Eligible based on tier · {practice.subscription_tier}</div>
            </div>
          </div>
          {eligibleAddons.length === 0 ? (
            <div style={{ fontSize: 12, color: C.textTertiary, padding: "12px 0" }}>
              No add-ons available for the {practice.subscription_tier} tier.
            </div>
          ) : eligibleAddons.map(a => {
            const active = activeAddonsBySku[a.sku];
            const isLocked = a.status === "pre-launch";
            return (
              <div
                key={a.id}
                style={{
                  display: "flex", alignItems: "center", gap: 14,
                  padding: 14,
                  border: "0.5px solid " + (active ? C.tealBorder : C.borderLight),
                  borderRadius: 8,
                  background: active ? C.tealBg : C.bgPrimary,
                  marginBottom: 8,
                  opacity: isLocked ? 0.55 : 1,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary, display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                    {a.name}
                    {isLocked && (
                      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", padding: "2px 6px", borderRadius: 3, background: C.bgTertiary, color: C.textTertiary, border: "0.5px solid " + C.borderLight }}>Pre-launch</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: C.textSecondary, lineHeight: 1.45 }}>{a.description}</div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary }}>{fmtMoney(a.monthly_price_cents)}/mo</div>
                  <div style={{ fontSize: 10, color: C.textTertiary }}>
                    {a.included_quota != null ? a.included_quota + " incl." : "unlimited"}
                  </div>
                </div>
                <Btn
                  size="sm"
                  variant={active ? "outline" : "primary"}
                  onClick={() => setAddonModal({ catalog: a, active })}
                  disabled={isLocked}
                >
                  {active ? "Manage" : "Activate"}
                </Btn>
              </div>
            );
          })}
        </Card>

        {/* Pending requests */}
        {requests.length > 0 && (
          <Card style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary }}>Pending requests from owner</div>
                <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 1 }}>{requests.length} awaiting review</div>
              </div>
            </div>
            {requests.map(r => (
              <div key={r.id} style={{
                padding: "10px 0",
                borderBottom: "0.5px solid " + C.borderLight,
                display: "flex", alignItems: "center", gap: 10,
              }}>
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", padding: "2px 6px", borderRadius: 3, background: C.violetBg || "#EDE9FE", color: C.violet || "#6D28D9", border: "0.5px solid " + (C.violetBorder || "#C4B5FD") }}>
                  {r.request_type.replace(/_/g, " ")}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.textPrimary, marginBottom: 1 }}>
                    {r.details?.summary || JSON.stringify(r.details).slice(0, 80)}
                  </div>
                  <div style={{ fontSize: 11, color: C.textTertiary }}>
                    Requested {fmtDate(r.created_at)}
                  </div>
                </div>
                <Btn size="sm" variant="outline" onClick={() => alert("Review flow: not yet wired")}>Review</Btn>
              </div>
            ))}
          </Card>
        )}

        {/* History */}
        <Card style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary }}>Recent transitions</div>
              <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 1 }}>Last {history.length} of all events</div>
            </div>
          </div>
          {history.length === 0 ? (
            <div style={{ fontSize: 12, color: C.textTertiary }}>No transitions yet.</div>
          ) : (
            <div style={{ position: "relative", paddingLeft: 22 }}>
              <div style={{ position: "absolute", left: 7, top: 6, bottom: 6, width: 1, background: C.borderLight }} />
              {history.map(h => (
                <div key={h.id} style={{ position: "relative", paddingBottom: 14 }}>
                  <div style={{
                    position: "absolute", left: -19, top: 5,
                    width: 7, height: 7, borderRadius: "50%",
                    background: C.teal, border: "1.5px solid " + C.teal,
                  }} />
                  <div style={{ fontSize: 10, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, marginBottom: 1 }}>
                    {fmtDate(h.created_at)}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.textPrimary }}>
                    {h.change_type === "state_change"
                      ? "State: " + (h.from_value?.lifecycle_status || "?") + " → " + (h.to_value?.lifecycle_status || "?")
                      : h.change_type.replace(/_/g, " ")}
                  </div>
                  {h.reason && <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 1 }}>{h.reason}</div>}
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Stripe state */}
        <Card>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary }}>Stripe</div>
              <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 1 }}>{practice.stripe_customer_id ? "Connected" : "Not yet linked"}</div>
            </div>
          </div>
          <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
            <tbody>
              <tr><td style={{ padding: "8px 0", color: C.textSecondary, borderBottom: "0.5px solid " + C.borderLight, width: "30%" }}>Customer</td><td style={{ color: C.textPrimary, fontWeight: 500, borderBottom: "0.5px solid " + C.borderLight }}>{practice.stripe_customer_id || "—"}</td></tr>
              <tr><td style={{ padding: "8px 0", color: C.textSecondary, borderBottom: "0.5px solid " + C.borderLight }}>Subscription</td><td style={{ color: C.textPrimary, fontWeight: 500, borderBottom: "0.5px solid " + C.borderLight }}>{practice.stripe_subscription_id || "—"}</td></tr>
              <tr><td style={{ padding: "8px 0", color: C.textSecondary, borderBottom: "0.5px solid " + C.borderLight }}>Stripe status</td><td style={{ color: C.textPrimary, fontWeight: 500, borderBottom: "0.5px solid " + C.borderLight }}>{practice.stripe_status || "—"}</td></tr>
              <tr><td style={{ padding: "8px 0", color: C.textSecondary }}>Cycle anchor</td><td style={{ color: C.textPrimary, fontWeight: 500 }}>{fmtDate(practice.billing_cycle_anchor)}</td></tr>
            </tbody>
          </table>
        </Card>
      </div>

      {transitionModal && (
        <TransitionModal
          practice={practice}
          onClose={() => setTransitionModal(null)}
          onDone={() => { setTransitionModal(null); onChange(); }}
        />
      )}
      {addonModal && (
        <AddonModal
          practice={practice}
          catalog={addonModal.catalog}
          active={addonModal.active}
          profile={profile}
          onClose={() => setAddonModal(null)}
          onDone={() => { setAddonModal(null); onChange(); }}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Lifecycle transition modal
// ═══════════════════════════════════════════════════════════════════════════════
const LEGAL_TRANSITIONS = {
  prospect:           ["pending_activation"],
  pending_activation: ["trial", "active"],
  trial:              ["active", "cancelled"],
  active:             ["past_due", "paused", "cancelled"],
  past_due:           ["active", "delinquent", "cancelled"],
  delinquent:         ["active", "cancelled"],
  paused:             ["active", "cancelled"],
  cancelled:          ["archived"],
  archived:           [],
};

function TransitionModal({ practice, onClose, onDone }) {
  const [toState, setToState] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const options = LEGAL_TRANSITIONS[practice.lifecycle_status] || [];

  const submit = async () => {
    if (!toState) return;
    setBusy(true);
    setErr(null);
    try {
      const { data, error } = await supabase.rpc("transition_practice_lifecycle", {
        p_practice_id: practice.id,
        p_to_state:    toState,
        p_reason:      reason || null,
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
    <Modal title="Change lifecycle state" onClose={onClose} maxWidth={480}>
      <div style={{ marginBottom: 14, fontSize: 12, color: C.textSecondary }}>
        Current state: <b style={{ color: C.textPrimary }}>{LIFECYCLE_LABELS[practice.lifecycle_status]}</b>
      </div>
      {options.length === 0 ? (
        <div style={{ padding: 12, background: C.bgTertiary, borderRadius: 8, fontSize: 12, color: C.textTertiary }}>
          No valid transitions from this state.
        </div>
      ) : (
        <>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.textSecondary, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Transition to</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {options.map(opt => (
                <label key={opt} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", border: "0.5px solid " + (toState === opt ? C.teal : C.borderLight), borderRadius: 7, cursor: "pointer", background: toState === opt ? C.tealBg : "transparent" }}>
                  <input type="radio" checked={toState === opt} onChange={() => setToState(opt)} />
                  <span style={{ fontSize: 13, color: C.textPrimary, fontWeight: 500 }}>{LIFECYCLE_LABELS[opt]}</span>
                </label>
              ))}
            </div>
          </div>
          <Input label="Reason (optional)" value={reason} onChange={setReason} placeholder="e.g. Client requested 60-day pause" />
          {err && <div style={{ padding: 10, background: "#fef2f2", border: "0.5px solid " + C.red, borderRadius: 6, color: C.red, fontSize: 12, marginBottom: 12 }}>{err}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
            <Btn variant="outline" onClick={onClose}>Cancel</Btn>
            <Btn onClick={submit} disabled={!toState || busy}>{busy ? "Working..." : "Apply"}</Btn>
          </div>
        </>
      )}
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Add-on activate / deactivate modal with proration preview
// ═══════════════════════════════════════════════════════════════════════════════
function AddonModal({ practice, catalog, active, profile, onClose, onDone }) {
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const action = active ? "addon_remove" : "addon_add";

  useEffect(() => {
    let cancelled = false;
    supabase.rpc("preview_subscription_change", {
      p_practice_id: practice.id,
      p_change_type: action,
      p_params: { sku: catalog.sku },
    }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) setErr(error.message);
      else setPreview(data);
    });
    return () => { cancelled = true; };
  }, [practice.id, action, catalog.sku]);

  const apply = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (active) {
        // Remove
        const { error } = await supabase.from("practice_addons")
          .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
          .eq("id", active.id);
        if (error) throw error;
        await supabase.from("subscription_change_history").insert({
          practice_id:     practice.id,
          change_type:     "addon_removed",
          from_value:      { sku: catalog.sku, status: "active" },
          to_value:        { sku: catalog.sku, status: "cancelled" },
          effective_date:  new Date().toISOString(),
          proration_amount_cents: preview?.delta_cents || null,
          reason:          "Removed via Administrator panel",
          created_by:      profile.id,
        });
      } else {
        // Add
        const { error } = await supabase.from("practice_addons").insert({
          practice_id:           practice.id,
          addon_id:              catalog.id,
          status:                "active",
          activated_at:          new Date().toISOString(),
          effective_date:        new Date().toISOString(),
          billing_cycle_anchor:  new Date().toISOString(),
          created_by:            profile.id,
        });
        if (error) throw error;
        await supabase.from("subscription_change_history").insert({
          practice_id:     practice.id,
          change_type:     "addon_added",
          from_value:      null,
          to_value:        { sku: catalog.sku, status: "active" },
          effective_date:  new Date().toISOString(),
          proration_amount_cents: preview?.delta_cents || null,
          reason:          "Activated via Administrator panel",
          created_by:      profile.id,
        });
      }
      onDone();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={active ? "Remove " + catalog.name : "Activate " + catalog.name} onClose={onClose} maxWidth={520}>
      <div style={{ marginBottom: 14, fontSize: 12, color: C.textSecondary }}>
        {active ? (
          <>This will deactivate <b style={{ color: C.textPrimary }}>{catalog.name}</b> for {practice.name}. The unused portion of this billing cycle will be credited.</>
        ) : (
          <>This will activate <b style={{ color: C.textPrimary }}>{catalog.name}</b> for {practice.name} immediately. Prorated charge for the remaining cycle is shown below.</>
        )}
      </div>
      {preview && !preview.error ? (
        <div style={{ background: C.tealBg, border: "0.5px dashed " + C.tealBorder, borderRadius: 8, padding: "12px 14px", marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.teal, marginBottom: 8 }}>Proration preview</div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0", color: C.textSecondary }}>
            <span>Days remaining in cycle</span>
            <span style={{ color: C.textPrimary, fontWeight: 600 }}>{preview.remaining_days} of {preview.total_days}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0 8px", color: C.textSecondary, borderBottom: "0.5px solid " + C.tealBorder }}>
            <span>{active ? "Credit (unused portion)" : "Prorated charge"}</span>
            <span style={{ color: C.textPrimary, fontWeight: 600 }}>{fmtMoney(preview.delta_cents)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, paddingTop: 8, color: C.textPrimary, fontWeight: 700 }}>
            <span>Effective</span>
            <span>Immediately</span>
          </div>
        </div>
      ) : preview?.error ? (
        <div style={{ padding: 10, background: "#fef2f2", border: "0.5px solid " + C.red, borderRadius: 6, color: C.red, fontSize: 12, marginBottom: 12 }}>
          Preview unavailable: {preview.error}
        </div>
      ) : (
        <div style={{ padding: 12, fontSize: 12, color: C.textTertiary }}>Calculating preview...</div>
      )}
      {err && <div style={{ padding: 10, background: "#fef2f2", border: "0.5px solid " + C.red, borderRadius: 6, color: C.red, fontSize: 12, marginBottom: 12 }}>{err}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        <Btn onClick={apply} disabled={busy} variant={active ? "danger" : "primary"}>
          {busy ? "Working..." : (active ? "Deactivate" : "Activate")}
        </Btn>
      </div>
    </Modal>
  );
}
// ═══════════════════════════════════════════════════════════════════════════════
// View as Owner button - opens read-only spectator mode for the given practice.
// Confirms with the user, captures an optional reason, then triggers the
// AuthProvider.enterSpectator() action. The whole app transparently re-renders
// as the spectated practice; SpectatorBanner shows persistently.
// ═══════════════════════════════════════════════════════════════════════════════
function ViewAsOwnerButton({ practice }) {
  const { enterSpectator } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const enter = async () => {
    setBusy(true);
    setErr(null);
    try {
      await enterSpectator(practice.id, reason || null);
      setOpen(false);
      // Navigate to the spectated practice's dashboard so the read-only
      // session lands on a meaningful page instead of staying on the admin panel.
      navigate("/dashboard");
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Btn size="sm" variant="outline" onClick={() => setOpen(true)}>View as Owner →</Btn>
      {open && (
        <Modal title="Enter spectator mode" onClose={() => setOpen(false)} maxWidth={460}>
          <div style={{ padding: 12, background: C.amberBg, border: "0.5px solid " + C.amberBorder, borderRadius: 8, marginBottom: 14, fontSize: 12, color: C.textPrimary, lineHeight: 1.5 }}>
            <b>Read-only spectator mode.</b> You will see PracticeOS as <b>{practice.name}</b>'s owner sees it. All writes (form saves, toggles, deletes) will be blocked. This session is audit-logged as a Break-The-Glass event.
          </div>
          <Input label="Reason (optional, but recommended)" value={reason} onChange={setReason} placeholder="e.g. Debugging client-reported scheduling issue" />
          {err && <div style={{ padding: 10, background: "#fef2f2", border: "0.5px solid " + C.red, borderRadius: 6, color: C.red, fontSize: 12, marginBottom: 12 }}>{err}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Btn variant="outline" onClick={() => setOpen(false)}>Cancel</Btn>
            <Btn onClick={enter} disabled={busy}>{busy ? "Entering..." : "Enter spectator mode"}</Btn>
          </div>
        </Modal>
      )}
    </>
  );
}
