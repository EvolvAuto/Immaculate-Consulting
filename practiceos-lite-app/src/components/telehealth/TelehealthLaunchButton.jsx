// ═══════════════════════════════════════════════════════════════════════════════
// src/components/telehealth/TelehealthLaunchButton.jsx
// Staff-facing button that opens the provider's telehealth room URL in a new
// tab and stamps appointments.telehealth_attestation_at. Renders nothing for
// non-telehealth appointments. Shows a configuration warning if the appointment
// is telehealth but no room URL was stamped (provider has no settings row yet).
// ═══════════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { C } from "../../lib/tokens";

export default function TelehealthLaunchButton({
  appointment,
  size = "sm",
  onLaunched,
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const isTelehealth = appointment?.appt_type === "Telehealth";
  if (!isTelehealth) return null;

  if (!appointment.telehealth_room_url) {
    return (
      <div style={{
        padding: "6px 10px",
        background: C.amberBg,
        border: "0.5px solid " + C.amberBorder,
        borderRadius: 6,
        fontSize: 11,
        color: C.amber,
        fontWeight: 500,
      }}>
        Telehealth room not configured for this provider
      </div>
    );
  }

  const handleLaunch = async () => {
    setError(null);
    setBusy(true);
    try {
      const nowIso = new Date().toISOString();
      const { error: updErr } = await supabase
        .from("appointments")
        .update({ telehealth_attestation_at: nowIso })
        .eq("id", appointment.id);
      if (updErr) throw updErr;

      window.open(appointment.telehealth_room_url, "_blank", "noopener,noreferrer");
      if (onLaunched) onLaunched(nowIso);
    } catch (err) {
      console.error("[telehealth] launch failed:", err);
      setError(err.message ? err.message : "Failed to launch visit");
    } finally {
      setBusy(false);
    }
  };

  const padding = size === "sm" ? "6px 12px" : "10px 16px";
  const fontSize = size === "sm" ? 12 : 14;

  return (
    <div>
      <button
        onClick={handleLaunch}
        disabled={busy}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: padding,
          background: busy ? "#7DD3C0" : C.tealMid,
          color: "#fff",
          border: "none",
          borderRadius: 6,
          fontSize: fontSize,
          fontWeight: 600,
          cursor: busy ? "not-allowed" : "pointer",
          fontFamily: "inherit",
        }}
      >
        {busy ? "Launching..." : "Start Telehealth Visit"}
      </button>
      {error && (
        <div style={{
          fontSize: 11,
          color: C.red,
          marginTop: 4,
          fontFamily: "inherit",
        }}>
          {error}
        </div>
      )}
    </div>
  );
}
