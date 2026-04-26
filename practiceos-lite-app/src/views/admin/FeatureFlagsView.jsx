// ═══════════════════════════════════════════════════════════════════════════════
// src/views/admin/FeatureFlagsView.jsx
// Manages global feature flags (kill switches, compliance gates) and
// per-practice flag rollout. Per-practice flags use a multi-select checkbox
// picker so a single flag can be enabled across any subset of practices.
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../auth/AuthProvider";
import { C } from "../../lib/tokens";
import { Btn, Card, Modal, Input, Loader, ErrorBanner } from "../../components/ui";

const CATEGORY_LABELS = {
  kill_switch:  "Kill switch",
  beta:         "Beta",
  compliance:   "Compliance",
  experimental: "Experimental",
};

const CATEGORY_COLORS = {
  kill_switch:  { color: C.red,   bg: "#fef2f2" },
  beta:         { color: C.violet || "#6D28D9", bg: C.violetBg || "#EDE9FE" },
  compliance:   { color: C.teal,  bg: C.tealBg },
  experimental: { color: C.amber, bg: C.amberBg },
};

export default function FeatureFlagsView() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [flags, setFlags] = useState([]);
  const [practices, setPractices] = useState([]);
  const [enablements, setEnablements] = useState([]); // [{flag_id, practice_id, ...}]
  const [pickerFlag, setPickerFlag] = useState(null); // flag whose practices are being edited

  const load = async () => {
    try {
      setLoading(true);
      const [fRes, pRes, eRes] = await Promise.all([
        supabase.from("feature_flags").select("*").order("scope").order("key"),
        supabase.from("practices").select("id, name, subscription_tier").order("name"),
        supabase.from("feature_flag_practices").select("*"),
      ]);
      if (fRes.error) throw fRes.error;
      if (pRes.error) throw pRes.error;
      if (eRes.error) throw eRes.error;
      setFlags(fRes.data || []);
      setPractices(pRes.data || []);
      setEnablements(eRes.data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const toggleGlobal = async (flag) => {
    try {
      const { error } = await supabase.from("feature_flags")
        .update({ global_enabled: !flag.global_enabled })
        .eq("id", flag.id);
      if (error) throw error;
      load();
    } catch (e) {
      alert("Failed to toggle flag: " + e.message);
    }
  };

  if (loading) return <div style={{ padding: 40 }}><Loader /></div>;

  const globalFlags = flags.filter(f => f.scope === "global");
  const perPracticeFlags = flags.filter(f => f.scope === "per_practice");

  return (
    <div style={{ padding: 20 }}>
      {error && <ErrorBanner message={error} />}

      {/* Global flags */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary }}>Global flags</div>
          <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 1 }}>Affect every practice. Kill switches and compliance gates.</div>
        </div>
        {globalFlags.length === 0 ? (
          <div style={{ fontSize: 12, color: C.textTertiary, padding: "8px 0" }}>No global flags defined.</div>
        ) : globalFlags.map(f => {
          const cat = CATEGORY_COLORS[f.category] || { color: C.textSecondary, bg: C.bgTertiary };
          return (
            <div key={f.id} style={{
              display: "flex", alignItems: "center", gap: 14,
              padding: 14,
              border: "0.5px solid " + C.borderLight,
              borderRadius: 8,
              marginBottom: 8,
              background: f.global_enabled ? C.tealBg : C.bgPrimary,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                  <code style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>{f.key}</code>
                  {f.category && (
                    <span style={{
                      fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
                      padding: "2px 6px", borderRadius: 3,
                      color: cat.color, background: cat.bg,
                      border: "0.5px solid " + cat.color,
                    }}>{CATEGORY_LABELS[f.category]}</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: C.textSecondary, lineHeight: 1.45 }}>{f.description}</div>
              </div>
              <Toggle on={!!f.global_enabled} onClick={() => toggleGlobal(f)} />
            </div>
          );
        })}
      </Card>

      {/* Per-practice flags */}
      <Card>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary }}>Per-practice flags</div>
          <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 1 }}>Selectively enable for any subset of practices.</div>
        </div>
        {perPracticeFlags.length === 0 ? (
          <div style={{ fontSize: 12, color: C.textTertiary, padding: "8px 0" }}>No per-practice flags defined.</div>
        ) : perPracticeFlags.map(f => {
          const enabledRows = enablements.filter(e => e.flag_id === f.id && e.enabled);
          const cat = CATEGORY_COLORS[f.category] || { color: C.textSecondary, bg: C.bgTertiary };
          return (
            <div key={f.id} style={{
              display: "flex", alignItems: "center", gap: 14,
              padding: 14,
              border: "0.5px solid " + C.borderLight,
              borderRadius: 8,
              marginBottom: 8,
              background: C.bgPrimary,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                  <code style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>{f.key}</code>
                  {f.category && (
                    <span style={{
                      fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
                      padding: "2px 6px", borderRadius: 3,
                      color: cat.color, background: cat.bg,
                      border: "0.5px solid " + cat.color,
                    }}>{CATEGORY_LABELS[f.category]}</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: C.textSecondary, lineHeight: 1.45, marginBottom: 4 }}>{f.description}</div>
                <div style={{ fontSize: 11, color: C.teal, fontWeight: 600 }}>
                  {enabledRows.length === 0 ? "Enabled for no practices" : "Enabled for " + enabledRows.length + " practice" + (enabledRows.length === 1 ? "" : "s")}
                </div>
              </div>
              <Btn size="sm" variant="outline" onClick={() => setPickerFlag(f)}>Manage practices</Btn>
            </div>
          );
        })}
      </Card>

      {pickerFlag && (
        <PracticePickerModal
          flag={pickerFlag}
          practices={practices}
          enablements={enablements.filter(e => e.flag_id === pickerFlag.id)}
          onClose={() => setPickerFlag(null)}
          onDone={() => { setPickerFlag(null); load(); }}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Multi-select practice picker for per-practice flag rollout
// ═══════════════════════════════════════════════════════════════════════════════
function PracticePickerModal({ flag, practices, enablements, onClose, onDone }) {
  const { profile } = useAuth();
  const [selected, setSelected] = useState(() => new Set(enablements.filter(e => e.enabled).map(e => e.practice_id)));
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return practices;
    const s = search.toLowerCase();
    return practices.filter(p => p.name.toLowerCase().includes(s));
  }, [practices, search]);

  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const selectAll = () => setSelected(new Set(filtered.map(p => p.id)));
  const clearAll  = () => setSelected(new Set());

  const apply = async () => {
    setBusy(true);
    setErr(null);
    try {
      const currentlyEnabled = new Set(enablements.filter(e => e.enabled).map(e => e.practice_id));
      const toAdd    = [...selected].filter(id => !currentlyEnabled.has(id));
      const toRemove = [...currentlyEnabled].filter(id => !selected.has(id));

      // Add new enablements (or update existing rows from disabled to enabled)
      for (const pid of toAdd) {
        const existing = enablements.find(e => e.practice_id === pid);
        if (existing) {
          const { error } = await supabase.from("feature_flag_practices")
            .update({ enabled: true, enabled_at: new Date().toISOString(), enabled_by: profile.id })
            .eq("id", existing.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("feature_flag_practices").insert({
            flag_id:     flag.id,
            practice_id: pid,
            enabled:     true,
            enabled_by:  profile.id,
          });
          if (error) throw error;
        }
      }

      // Remove (delete rows entirely so the flag is fully revoked, not soft-disabled)
      for (const pid of toRemove) {
        const existing = enablements.find(e => e.practice_id === pid);
        if (existing) {
          const { error } = await supabase.from("feature_flag_practices")
            .delete()
            .eq("id", existing.id);
          if (error) throw error;
        }
      }
      onDone();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={"Enable " + flag.key} onClose={onClose} maxWidth={560}>
      <div style={{ marginBottom: 14, fontSize: 12, color: C.textSecondary, lineHeight: 1.5 }}>
        Select practices that should have this feature enabled. Changes take effect immediately and are audited.
      </div>
      <Input label="Search practices" value={search} onChange={setSearch} placeholder="Type to filter..." />
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, fontSize: 11 }}>
        <div style={{ color: C.textTertiary }}>
          <b style={{ color: C.textPrimary }}>{selected.size}</b> of {practices.length} selected
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={selectAll} style={{ background: "none", border: "none", color: C.teal, fontSize: 11, fontWeight: 600, cursor: "pointer", padding: 0 }}>Select all visible</button>
          <span style={{ color: C.borderMid }}>·</span>
          <button onClick={clearAll} style={{ background: "none", border: "none", color: C.red, fontSize: 11, fontWeight: 600, cursor: "pointer", padding: 0 }}>Clear all</button>
        </div>
      </div>
      <div style={{ maxHeight: 300, overflowY: "auto", border: "0.5px solid " + C.borderLight, borderRadius: 8, marginBottom: 14 }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 20, textAlign: "center", fontSize: 12, color: C.textTertiary }}>No practices match.</div>
        ) : filtered.map(p => {
          const checked = selected.has(p.id);
          return (
            <label key={p.id} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "10px 14px",
              borderBottom: "0.5px solid " + C.borderLight,
              cursor: "pointer",
              background: checked ? C.tealBg : "transparent",
            }}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(p.id)}
                style={{ accentColor: C.teal }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 500, color: C.textPrimary }}>{p.name}</div>
                <div style={{ fontSize: 10, color: C.textTertiary, marginTop: 1 }}>{p.subscription_tier}</div>
              </div>
            </label>
          );
        })}
      </div>
      {err && <div style={{ padding: 10, background: "#fef2f2", border: "0.5px solid " + C.red, borderRadius: 6, color: C.red, fontSize: 12, marginBottom: 12 }}>{err}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        <Btn onClick={apply} disabled={busy}>{busy ? "Applying..." : "Apply changes"}</Btn>
      </div>
    </Modal>
  );
}

function Toggle({ on, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        position: "relative",
        width: 36, height: 20,
        background: on ? C.teal : C.borderMid,
        borderRadius: 10,
        cursor: "pointer",
        transition: "all 0.18s",
        flexShrink: 0,
      }}
    >
      <div style={{
        position: "absolute", top: 2, left: on ? 18 : 2,
        width: 16, height: 16,
        background: "#fff",
        borderRadius: "50%",
        transition: "all 0.18s",
        boxShadow: "0 1px 2px rgba(0,0,0,0.15)",
      }} />
    </div>
  );
}
