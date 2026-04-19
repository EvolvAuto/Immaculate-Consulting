// ═══════════════════════════════════════════════════════════════════════════════
// src/views/portal/AccountSwitcher.jsx
//
// Rendered in the patient portal sidebar. Shows a dropdown with:
//   - "My account" (the grantee's own patient record)
//   - All patients they have active proxy grants to
//
// Selecting a different account calls switch-active-patient, which updates the
// JWT's patient_id claim; we then force a refreshSession() and reload so all
// RLS-scoped queries re-run against the new patient.
//
// If the user has no proxy grants, the switcher collapses to just a name label.
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useState, useRef } from "react";
import { supabase } from "../../lib/supabaseClient";
import { C } from "../../lib/tokens";

export default function AccountSwitcher({ activePatientId, homePatientId }) {
  const [open, setOpen]           = useState(false);
  const [accounts, setAccounts]   = useState([]);
  const [switching, setSwitching] = useState(false);
  const [loadErr, setLoadErr]     = useState(null);
  const wrapRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Accessible patients via RLS (uses my_accessible_patient_ids helper)
        const { data: patients, error } = await supabase.from("patients")
          .select("id, first_name, last_name, date_of_birth")
          .order("last_name");
        if (error) throw error;

        // Proxy grants (only rows this user is the grantee on)
        const { data: grants } = await supabase.from("patient_proxies")
          .select("patient_id, relationship, permission, display_label")
          .eq("status", "Active");
        const grantByPatient = Object.fromEntries((grants || []).map(g => [g.patient_id, g]));

        const list = (patients || []).map(p => {
          const isSelf = p.id === homePatientId;
          const grant  = grantByPatient[p.id];
          return {
            id:          p.id,
            name:        (p.first_name + " " + p.last_name).trim(),
            is_self:     isSelf,
            label:       isSelf
                           ? "My account"
                           : (grant && grant.display_label) ? grant.display_label
                           : (grant ? grant.relationship : "Proxy"),
            permission:  grant?.permission,
            is_active:   p.id === activePatientId,
          };
        });

        // Sort: self first, then active, then others alphabetical
        list.sort((a, b) => {
          if (a.is_self && !b.is_self) return -1;
          if (!a.is_self && b.is_self) return 1;
          if (a.is_active && !b.is_active) return -1;
          if (!a.is_active && b.is_active) return 1;
          return a.name.localeCompare(b.name);
        });

        if (!cancelled) setAccounts(list);
      } catch (e) {
        if (!cancelled) setLoadErr(e.message || "Failed to load accounts");
      }
    })();
    return () => { cancelled = true; };
  }, [activePatientId, homePatientId]);

  const active = accounts.find(a => a.is_active) || accounts[0];
  const canSwitch = accounts.length > 1;

  const doSwitch = async (targetId) => {
    if (targetId === activePatientId || switching) return;
    setSwitching(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Session expired");

      const url = supabase.supabaseUrl.replace(/\/+$/, "") + "/functions/v1/switch-active-patient";
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": "Bearer " + session.access_token,
          "apikey":        supabase.supabaseKey,
        },
        body: JSON.stringify({ target_patient_id: targetId }),
      });
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok || payload.error) throw new Error(payload.error || ("HTTP " + resp.status));

      // Force a new JWT to be issued with the new claims, then reload
      await supabase.auth.refreshSession();
      window.location.reload();
    } catch (e) {
      setSwitching(false);
      alert("Could not switch: " + (e.message || e));
    }
  };

  if (!active || loadErr) {
    return (
      <div style={{ fontSize: 11, color: C.textTertiary, padding: "8px 12px" }}>
        {loadErr || "Loading..."}
      </div>
    );
  }

  return (
    <div ref={wrapRef} style={{ position: "relative", marginTop: 8 }}>
      <button
        type="button"
        onClick={() => canSwitch && setOpen(!open)}
        disabled={!canSwitch || switching}
        style={{
          width: "100%",
          background: "rgba(255,255,255,0.04)",
          border: "0.5px solid rgba(255,255,255,0.1)",
          borderRadius: 6,
          padding: "8px 10px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          cursor: canSwitch ? "pointer" : "default",
          fontFamily: "inherit",
          textAlign: "left",
          color: "#fff",
        }}
      >
        <div style={{
          width: 26, height: 26, borderRadius: "50%",
          background: active.is_self ? C.teal : C.purple,
          color: "#fff", fontSize: 11, fontWeight: 700,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}>
          {initials(active.name)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {active.name}
          </div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.55)" }}>
            {active.label}{active.permission && !active.is_self ? " - " + active.permission : ""}
          </div>
        </div>
        {canSwitch && (
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)" }}>{open ? "▲" : "▼"}</div>
        )}
      </button>

      {open && (
        <div style={{
          position: "absolute",
          bottom: "calc(100% + 6px)",
          left: 0, right: 0,
          background: C.navBg,
          border: "0.5px solid rgba(255,255,255,0.12)",
          borderRadius: 6,
          boxShadow: "0 -4px 16px rgba(0,0,0,0.3)",
          maxHeight: 300,
          overflowY: "auto",
          zIndex: 100,
        }}>
          {accounts.map(acc => (
            <button
              key={acc.id}
              type="button"
              onClick={() => doSwitch(acc.id)}
              disabled={switching}
              style={{
                width: "100%",
                padding: "10px 12px",
                background: acc.is_active ? "rgba(255,255,255,0.08)" : "transparent",
                border: "none",
                borderBottom: "0.5px solid rgba(255,255,255,0.06)",
                cursor: "pointer",
                color: "#fff",
                display: "flex",
                gap: 8,
                alignItems: "center",
                textAlign: "left",
                fontFamily: "inherit",
              }}
            >
              <div style={{
                width: 24, height: 24, borderRadius: "50%",
                background: acc.is_self ? C.teal : C.purple,
                fontSize: 10, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
              }}>{initials(acc.name)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {acc.name}
                </div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.55)" }}>{acc.label}</div>
              </div>
              {acc.is_active && <span style={{ fontSize: 10, color: C.tealLight }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function initials(name) {
  return String(name || "").trim().split(/\s+/).slice(0, 2).map(w => w[0] || "").join("").toUpperCase() || "?";
}
