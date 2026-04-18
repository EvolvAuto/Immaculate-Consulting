// ═══════════════════════════════════════════════════════════════════════════════
// src/views/SettingsView.jsx
// Stub — to be fleshed out from PracticeOSLite_Full.jsx in the next build session.
// ═══════════════════════════════════════════════════════════════════════════════

import { C } from "../lib/tokens";

export default function SettingsView() {
  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      padding: 24, overflow: "hidden",
    }}>
      <div style={{
        fontFamily: "'Inter', sans-serif",
        fontSize: 18, fontWeight: 700, color: C.textPrimary,
        marginBottom: 4,
      }}>Settings</div>
      <div style={{ fontSize: 12, color: C.textTertiary, marginBottom: 20 }}>
        To be wired in the next build session.
      </div>
      <div style={{
        flex: 1,
        background: C.bgPrimary,
        border: `0.5px solid ${C.borderLight}`,
        borderRadius: 12,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: C.textTertiary, fontSize: 13,
      }}>
        Placeholder for Settings view
      </div>
    </div>
  );
}
