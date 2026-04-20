// ═══════════════════════════════════════════════════════════════════════════════
// ProUsageMeter - shows monthly AI message usage vs cap. Polls every 30s.
// Shows a "Buy more" CTA when approaching or exceeding the cap. Role-gated:
// only Owner/Manager/Billing see the purchase CTA.
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { fetchUsageThisMonth, PURCHASE_ROLES } from "../../lib/proApi";
import { useAuth } from "../../auth/AuthProvider";
import { C } from "../../lib/tokens";
import CapBoostModal from "./CapBoostModal";

export default function ProUsageMeter({ refreshKey, onBoostPurchased }) {
  const { role } = useAuth();
  const [usage, setUsage] = useState(null);
  const [err, setErr] = useState(null);
  const [showModal, setShowModal] = useState(false);

  const load = () => {
    fetchUsageThisMonth()
      .then((u) => { setUsage(u); setErr(null); })
      .catch((e) => setErr(e.message));
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  if (err) return <div style={{ fontSize: 11, color: C.textTertiary }}>Usage: unavailable</div>;
  if (!usage) return null;

  const used = Number(usage.used || 0);
  const cap = Number(usage.cap || 0);
  const remaining = Number(usage.remaining || 0);
  const pct = cap > 0 ? Math.round((used / cap) * 100) : 0;
  const cappedPct = Math.min(100, pct);

  const warn = pct >= 80 && pct < 95;
  const critical = pct >= 95 && pct < 100;
  const overCap = pct >= 100;

  const barColor = overCap ? "#DC2626" : critical ? "#DC2626" : warn ? "#D08A2E" : "#1D9E75";
  const canPurchase = PURCHASE_ROLES.includes(role);

  const handleBoosted = () => {
    setShowModal(false);
    load();
    if (typeof onBoostPurchased === "function") onBoostPurchased();
  };

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, minWidth: 200 }}>
        <div style={{ fontSize: 11, color: overCap ? "#DC2626" : C.textTertiary, fontWeight: overCap ? 700 : 500 }}>
          {used.toLocaleString()} of {cap.toLocaleString()} AI messages
          {overCap && " (" + (used - cap).toLocaleString() + " over)"}
        </div>
        <div style={{ width: 200, height: 4, background: C.borderLight, borderRadius: 2, overflow: "hidden", position: "relative" }}>
          <div style={{ width: cappedPct + "%", height: "100%", background: barColor, transition: "width 0.3s" }} />
          {overCap && (
            <div style={{
              position: "absolute", top: 0, right: 0,
              width: 3, height: "100%",
              background: "#7F1D1D", borderRadius: 0,
            }} />
          )}
        </div>

        {(warn || critical || overCap) && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
            <span style={{
              fontSize: 10,
              fontWeight: 600,
              color: overCap ? "#DC2626" : critical ? "#DC2626" : "#B45309",
            }}>
              {overCap
                ? "Over monthly cap - service continues"
                : critical
                  ? remaining.toLocaleString() + " left this month"
                  : "Approaching monthly cap"}
            </span>
            {canPurchase && (warn || critical || overCap) && (
              <span
                onClick={() => setShowModal(true)}
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#1D9E75",
                  cursor: "pointer",
                  textDecoration: "underline",
                  textDecorationStyle: "dotted",
                }}
              >
                Buy more
              </span>
            )}
          </div>
        )}
      </div>

      {showModal && (
        <CapBoostModal
          onClose={() => setShowModal(false)}
          onPurchased={handleBoosted}
          currentUsed={used}
          currentCap={cap}
        />
      )}
    </>
  );
}
