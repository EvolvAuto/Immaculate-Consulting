// ═══════════════════════════════════════════════════════════════════════════════
// ProUsageMeter — shows monthly AI message usage vs cap. Polls every 30s.
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { fetchUsageThisMonth } from "../../lib/proApi";
import { C } from "../../lib/tokens";

export default function ProUsageMeter({ refreshKey }) {
  const [usage, setUsage] = useState(null);
  const [err, setErr] = useState(null);

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
  const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  const warn = pct >= 80;
  const critical = pct >= 95;

  const barColor = critical ? "#DC2626" : warn ? "#D08A2E" : "#1D9E75";

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, minWidth: 180 }}>
      <div style={{ fontSize: 11, color: C.textTertiary, fontWeight: 500 }}>
        {used.toLocaleString()} of {cap.toLocaleString()} AI messages this month
      </div>
      <div style={{ width: 180, height: 4, background: C.borderLight, borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: pct + "%", height: "100%", background: barColor, transition: "width 0.3s" }} />
      </div>
      {critical && (
        <div style={{ fontSize: 10, color: "#DC2626", fontWeight: 600 }}>
          {remaining} remaining - quota nearly exhausted
        </div>
      )}
    </div>
  );
}
