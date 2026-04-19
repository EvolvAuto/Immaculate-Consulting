// ═══════════════════════════════════════════════════════════════════════════════
// src/views/portal/AccountSwitcher.jsx  (v2)
//
// v2 changes:
//   - Hidden entirely when user has no proxy access (only 1 accessible patient).
//     Single-account users don't need a switcher.
//   - Adds visible "FAMILY ACCESS - VIEWING AS" section label so the control is
//     clearly findable.
//   - When user is in proxy mode (viewing a delegated chart), shows a prominent
//     amber banner above the switcher so they always know whose chart it is.
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useState, useRef } from "react";
import { supabase } from "../../lib/supabaseClient";
import { C } from "../../lib/tokens";

export default function AccountSwitcher({ activePatientId, homePatientId }) {
  const [open, setOpen]           = useState(false);
  const [accounts, setAccounts]   = useState([]);
  const [switching, setSwitching] = useState(false);
  const [loaded, setLoaded]       = useState(false);
  const wrapRef = useRef(null);

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
        const { data: patients, error } = await supabase.from("patients")
          .select("id, first_name, last_name")
          .order("last_name");
        if (error) throw error;

        const { data: grants } = await supabase.from("patient_proxies")
          .select("patient_id, relationship, permission, display_label")
          .eq("status", "Active");
        const grantByPatient = Object.fromEntries((grants || []).map(g => [g.patient_id, g]));

        const list = (patients || []).map(p => {
          const isSelf = p.id === homePatientId;
          const grant  = grantByPatient[p.id];
          return {
            id:         p.id,
            name:       (p.first_name + " " + p.last_name).trim(),
            is_self:    isSelf,
            label:      isSelf
                          ? "My account"
                          : (grant && grant.display_label) ? grant.display_label
                          : (grant ? grant.relationship : "Proxy"),
            permission: grant && grant.permission,
            is_active:  p.id === activePatientId,
          };
        });

        list.sort((a, b) => {
          if (a.is_self && !b.is_self) return -1;
          if (!a.is_self && b.is_self) return 1;
          if (a.is_active && !b.is_active) return -1;
          if (!a.is_active && b.is_active) return 1;
          return a.name.localeCompare(b.name);
        });

        if (!cancelled) {
          setAccounts(list);
          setLoaded(true);
        }
      } catch (_e) {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [activePatientId, homePatientId]);

  // Don't render anything until we've loaded
  if (!loaded) return null;

  // Single-account users get no switcher at all
  if (accounts.length <= 1) return null;

  const active = accounts.find(a => a.is_active) || accounts[0];
  const inProxyMode = active && !active.is_self;

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

      await supabase.auth.refreshSession();
      window.location.reload();
    } catch (e) {
      setSwitching(false);
      alert("Could not switch: " + (e.message || e));
    }
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", padding: "0 8px" }}>

      {inProxyMode && (
        <div style={{
          marginBottom: 6, padding: "6px 10px",
          background: C.amberBg, border: "0.5px solid " + C.amberBorder,
          borderRadius: 6,
          fontSize: 10, lineHeight: 1.35, color: C.amber,
        }}>
          <div style={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, fontSize: 9 }}>
            Viewing proxy account
          </div>
          <div style={{ marginTop: 2 }}>
            You are viewing <strong>{active.name}</strong>'s chart. Use the switcher below to return to your own account.
          </div>
        </div>
      )}

      <div style={{
        fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
        textTransform: "uppercase", color: C.textTertiary,
        padding: "0 2px", marginBottom: 4,
      }}>
        Family Access - Viewing As
      </div>

      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={switching}
        style={{
          width: "100%",
          background: inProxyMode ? C.amberBg : C.bgSecondary,
          border: "0.5px solid " + (inProxyMode ? C.amberBorder : C.borderMid),
          borderRadius: 6,
          padding: "8px 10px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          cursor: switching ? "default" : "pointer",
          fontFamily: "inherit",
          textAlign: "left",
        }}
      >
        <div style={{
          width: 26, height: 26, borderRadius: "50%",
          background: active.is_self ? C.teal : C.amberMid,
          color: "#fff", fontSize: 10, fontWeight: 700,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}>
          {initials(active.name)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 12, fontWeight: 600, color: C.textPrimary,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {active.name}
          </div>
          <div style={{ fontSize: 10, color: C.textSecondary }}>
            {active.label}{active.permission && !active.is_self ? " - " + active.permission : ""}
          </div>
        </div>
        <div style={{ fontSize: 10, color: C.textTertiary }}>{open ? "▲" : "▼"}</div>
      </button>

      {open && (
        <div style={{
          position: "absolute",
          bottom: "calc(100% - 4px)",
          left: 8, right: 8,
          background: "#fff",
          border: "0.5px solid " + C.borderMid,
          borderRadius: 6,
          boxShadow: "0 -4px 16px rgba(0,0,0,0.12)",
          maxHeight: 300,
          overflowY: "auto",
          zIndex: 100,
        }}>
          <div style={{
            padding: "8px 10px", borderBottom: "0.5px solid " + C.borderLight,
            fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
            textTransform: "uppercase", color: C.textTertiary,
            background: C.bgSecondary,
          }}>
            Switch to account
          </div>
          {accounts.map(acc => (
            <button
              key={acc.id}
              type="button"
              onClick={() => doSwitch(acc.id)}
              disabled={switching}
              style={{
                width: "100%",
                padding: "10px 12px",
                background: acc.is_active ? C.tealBg : "transparent",
                border: "none",
                borderBottom: "0.5px solid " + C.borderLight,
                cursor: switching ? "default" : "pointer",
                display: "flex",
                gap: 8,
                alignItems: "center",
                textAlign: "left",
                fontFamily: "inherit",
              }}
            >
              <div style={{
                width: 24, height: 24, borderRadius: "50%",
                background: acc.is_self ? C.teal : C.amberMid,
                color: "#fff", fontSize: 10, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
              }}>{initials(acc.name)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 12, fontWeight: 600, color: C.textPrimary,
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}>
                  {acc.name}
                </div>
                <div style={{ fontSize: 10, color: C.textSecondary }}>
                  {acc.label}{acc.permission && !acc.is_self ? " - " + acc.permission : ""}
                </div>
              </div>
              {acc.is_active && (
                <span style={{ fontSize: 10, color: C.teal, fontWeight: 700 }}>✓</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function initials(name) {
  return String(name || "").trim().split(/\s+/).slice(0, 2)
    .map(w => w[0] || "").join("").toUpperCase() || "?";
}
