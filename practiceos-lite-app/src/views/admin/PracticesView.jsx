// ═══════════════════════════════════════════════════════════════════════════════
// src/views/admin/PracticesView.jsx
// Operational view of all practices. Different lens from Subscriptions
// (which is billing-focused). Shows operational metadata: patient count,
// last activity, staff roster size, onboarding completeness signal.
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { C } from "../../lib/tokens";
import { Badge, Btn, Card, Loader, ErrorBanner } from "../../components/ui";

const TIER_VARIANTS = { Lite: "neutral", Pro: "violet", Command: "teal" };

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
          <Btn size="sm" variant="primary" onClick={() => alert("New practice creation: not yet wired (Phase 2 with Stripe customer creation)")}>+ New practice</Btn>
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
              <div><Btn size="sm" variant="ghost" onClick={() => alert("Practice deep-dive view: Phase 2")}>→</Btn></div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
