// ProSystemAlertBanner.jsx
//
// Destination in the deployed repo: src/components/pro/ProSystemAlertBanner.jsx
//
// Mount this inside your main app chrome (App.jsx) for Pro / Command tier
// practices. It polls open system alerts every 2 minutes, renders a banner
// for the most recent unacknowledged one, and lets Owners / Managers dismiss.
//
// Data sources:
//   - listOpenSystemAlerts(practiceId)
//   - acknowledgeSystemAlert(alertId)

import React, { useCallback, useEffect, useState } from "react";
import { listOpenSystemAlerts, acknowledgeSystemAlert } from "../../lib/chartPrepApi";

const POLL_INTERVAL_MS = 120000; // 2 min

function severityColors(severity) {
  const s = (severity || "").toLowerCase();
  if (s === "critical") return { bg: "#fef2f2", border: "#dc2626", text: "#7f1d1d" };
  if (s === "warning")  return { bg: "#fffbeb", border: "#d97706", text: "#78350f" };
  return { bg: "#eff6ff", border: "#2563eb", text: "#1e3a8a" };
}

export default function ProSystemAlertBanner({ practiceId, role, tier }) {
  const [alerts, setAlerts] = useState([]);
  const [dismissing, setDismissing] = useState(false);

  // Only Pro / Command practices see this, and only Owner / Manager can dismiss.
  const isEligibleTier = tier === "Pro" || tier === "Command";
  const canDismiss = role === "Owner" || role === "Manager";

  const load = useCallback(async () => {
    if (!practiceId || !isEligibleTier) return;
    try {
      const rows = await listOpenSystemAlerts(practiceId);
      setAlerts(rows);
    } catch (err) {
      // Fail silently - a broken banner should never block the rest of the app.
      // eslint-disable-next-line no-console
      console.error("[ProSystemAlertBanner]", err.message || err);
    }
  }, [practiceId, isEligibleTier]);

  useEffect(() => {
    load();
    if (!isEligibleTier) return undefined;
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [load, isEligibleTier]);

  if (!isEligibleTier || alerts.length === 0) return null;

  const alert = alerts[0]; // show the most recent
  const colors = severityColors(alert.severity);

  const handleDismiss = async () => {
    if (dismissing) return;
    setDismissing(true);
    try {
      await acknowledgeSystemAlert(alert.id);
      setAlerts((prev) => prev.filter((a) => a.id !== alert.id));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[ProSystemAlertBanner] dismiss failed", err.message || err);
    } finally {
      setDismissing(false);
    }
  };

  const hiddenCount = alerts.length - 1;

  return (
    <div
      style={{
        backgroundColor: colors.bg,
        borderBottom: "2px solid " + colors.border,
        color: colors.text,
        padding: "10px 20px",
        display: "flex",
        alignItems: "center",
        gap: 16,
        fontSize: 14,
        lineHeight: 1.45,
      }}
    >
      <div style={{ fontSize: 20, flexShrink: 0 }}>
        {alert.severity === "Critical" ? "\u26A0" : "\u2139"}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>
          {alert.title}
          {hiddenCount > 0 && (
            <span style={{ fontWeight: 400, marginLeft: 8, opacity: 0.75 }}>
              (+{hiddenCount} more)
            </span>
          )}
        </div>
        <div style={{ opacity: 0.9, marginTop: 2 }}>
          Ticket <code style={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            background: "rgba(0,0,0,0.05)",
            padding: "1px 6px",
            borderRadius: 3,
          }}>{alert.ticket_ref}</code>
          {" "}- Contact support@immaculate-consulting.org with this ticket ID.
        </div>
      </div>
      {canDismiss && (
        <button
          onClick={handleDismiss}
          disabled={dismissing}
          style={{
            background: "transparent",
            border: "1px solid " + colors.border,
            color: colors.text,
            padding: "6px 14px",
            borderRadius: 4,
            cursor: dismissing ? "default" : "pointer",
            fontSize: 13,
            fontWeight: 500,
            opacity: dismissing ? 0.6 : 1,
            flexShrink: 0,
          }}
        >
          {dismissing ? "Dismissing..." : "Acknowledge"}
        </button>
      )}
    </div>
  );
}
