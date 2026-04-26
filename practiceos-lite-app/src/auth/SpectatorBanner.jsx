// ═══════════════════════════════════════════════════════════════════════════════
// src/auth/SpectatorBanner.jsx
// Persistent banner shown app-wide when a super admin is in "View as Owner"
// spectator mode. Visually impossible to miss. One-click exit.
//
// Renders at the top of the main content area in Layout.jsx, above all
// other content including the ProSystemAlertBanner.
// ═══════════════════════════════════════════════════════════════════════════════

import { useAuth } from "./AuthProvider";
import { C } from "../lib/tokens";

export default function SpectatorBanner() {
  const { spectator, exitSpectator } = useAuth();
  if (!spectator) return null;

  return (
    <div style={{
      background: "linear-gradient(90deg, " + C.amber + " 0%, #B57009 100%)",
      color: "#fff",
      padding: "10px 20px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 16,
      fontSize: 13,
      fontWeight: 500,
      boxShadow: "0 2px 0 0 rgba(0,0,0,0.15)",
      position: "relative",
      zIndex: 100,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
        <span style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 22, height: 22,
          borderRadius: 11,
          background: "rgba(255,255,255,0.22)",
          fontSize: 13,
          flexShrink: 0,
        }}>👁</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, letterSpacing: "-0.005em" }}>
            Spectator mode · viewing as <span style={{ textDecoration: "underline" }}>{spectator.practice_name}</span>
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.85)", marginTop: 1 }}>
            Read-only · all writes blocked · this session is audit-logged · acting as {spectator.acting_role || "owner"}
          </div>
        </div>
      </div>
      <button
        onClick={exitSpectator}
        style={{
          background: "rgba(255,255,255,0.2)",
          color: "#fff",
          border: "0.5px solid rgba(255,255,255,0.4)",
          borderRadius: 7,
          padding: "7px 14px",
          fontSize: 12,
          fontWeight: 600,
          fontFamily: "inherit",
          cursor: "pointer",
          letterSpacing: "-0.005em",
          flexShrink: 0,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.32)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.2)"; }}
      >
        Exit spectator mode
      </button>
    </div>
  );
}
