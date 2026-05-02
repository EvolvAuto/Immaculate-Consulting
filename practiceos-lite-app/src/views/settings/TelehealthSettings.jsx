// ═══════════════════════════════════════════════════════════════════════════════
// src/views/settings/TelehealthSettings.jsx
// Owner/Manager-only screen. Two parts:
//   1. Practice toggle: enable telehealth + pick the video vendor (Doxy etc).
//   2. Per-provider room URL list. Saving here triggers the DB to propagate
//      the URL to all that provider's future Telehealth appointments.
// No PHI lives in the video vendor; PracticeOS only stores the room URL.
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../auth/AuthProvider";
import { C } from "../../lib/tokens";
import { Btn, Card, Loader, ErrorBanner, EmptyState, FL, SectionHead } from "../../components/ui";

const PROVIDER_OPTIONS = [
  { value: "Doxy",            label: "Doxy.me",         help: "Free tier includes BAA. Add /your-room-name to the provider URL." },
  { value: "Zoom Healthcare", label: "Zoom Healthcare", help: "Requires Zoom Healthcare plan with executed BAA." },
  { value: "Google Meet BAA", label: "Google Meet",     help: "Only with Google Workspace + signed BAA. Use the meet.google.com URL." },
  { value: "Other",           label: "Other",           help: "Any HIPAA-compliant video service with an executed BAA." },
];

export default function TelehealthSettings() {
  const { practiceId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [practice, setPractice] = useState(null);
  const [providers, setProviders] = useState([]);
  const [settingsByProviderId, setSettingsByProviderId] = useState({});
  const [drafts, setDrafts] = useState({});

  const reload = async () => {
    if (!practiceId) return;
    try {
      setLoading(true);
      setError(null);
      const [pr, pv, ts] = await Promise.all([
        supabase.from("practices").select("id, name, telehealth_enabled, telehealth_provider").eq("id", practiceId).single(),
        supabase.from("providers").select("id, first_name, last_name, credential, is_active").eq("practice_id", practiceId).eq("is_active", true).order("last_name"),
        supabase.from("provider_telehealth_settings").select("*").eq("practice_id", practiceId),
      ]);
      if (pr.error) throw pr.error;
      if (pv.error) throw pv.error;
      if (ts.error) throw ts.error;
      setPractice(pr.data);
      setProviders(pv.data || []);
      const byId = {};
      const draftSeed = {};
      for (const row of (ts.data || [])) {
        byId[row.provider_id] = row;
        draftSeed[row.provider_id] = { room_url: row.room_url, is_active: row.is_active };
      }
      setSettingsByProviderId(byId);
      setDrafts(draftSeed);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [practiceId]);

  const flashSuccess = (msg) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 2500);
  };

  const togglePracticeEnabled = async (next) => {
    try {
      const { error: e } = await supabase.from("practices")
        .update({ telehealth_enabled: next })
        .eq("id", practiceId);
      if (e) throw e;
      setPractice((p) => ({ ...p, telehealth_enabled: next }));
      flashSuccess(next ? "Telehealth enabled" : "Telehealth disabled");
    } catch (e) { setError(e.message); }
  };

  const setVendor = async (vendor) => {
    try {
      const { error: e } = await supabase.from("practices")
        .update({ telehealth_provider: vendor || null })
        .eq("id", practiceId);
      if (e) throw e;
      setPractice((p) => ({ ...p, telehealth_provider: vendor || null }));
      flashSuccess("Vendor saved");
    } catch (e) { setError(e.message); }
  };

  const setDraft = (providerId, patch) => {
    setDrafts((d) => ({ ...d, [providerId]: { ...(d[providerId] || {}), ...patch } }));
  };

  const saveProvider = async (providerId) => {
    const draft = drafts[providerId] || {};
    const url = (draft.room_url || "").trim();
    if (!url) { setError("Room URL is required"); return; }
    if (!/^https?:\/\//i.test(url)) { setError("Room URL must start with http:// or https://"); return; }
    try {
      setError(null);
      const existing = settingsByProviderId[providerId];
      if (existing) {
        const { data, error: e } = await supabase.from("provider_telehealth_settings")
          .update({ room_url: url, is_active: draft.is_active !== false })
          .eq("id", existing.id).select().single();
        if (e) throw e;
        setSettingsByProviderId((s) => ({ ...s, [providerId]: data }));
      } else {
        const { data, error: e } = await supabase.from("provider_telehealth_settings")
          .insert({ practice_id: practiceId, provider_id: providerId, room_url: url, is_active: true })
          .select().single();
        if (e) throw e;
        setSettingsByProviderId((s) => ({ ...s, [providerId]: data }));
      }
      flashSuccess("Saved. Future telehealth appointments updated.");
    } catch (e) { setError(e.message); }
  };

  const removeProvider = async (providerId) => {
    const existing = settingsByProviderId[providerId];
    if (!existing) return;
    if (!confirm("Deactivate this provider's video room? Their future telehealth appointments will lose their room link until you re-save it.")) return;
    try {
      const { data, error: e } = await supabase.from("provider_telehealth_settings")
        .update({ is_active: false })
        .eq("id", existing.id).select().single();
      if (e) throw e;
      setSettingsByProviderId((s) => ({ ...s, [providerId]: data }));
      setDraft(providerId, { is_active: false });
      flashSuccess("Deactivated.");
    } catch (e) { setError(e.message); }
  };

  if (loading) return <Loader />;
  if (!practice) return <ErrorBanner message="Practice not found" />;

  const enabled = !!practice.telehealth_enabled;
  const vendor = practice.telehealth_provider;
  const vendorMeta = PROVIDER_OPTIONS.find((o) => o.value === vendor);

  return (
    <div style={{ padding: "20px 24px", maxWidth: 920, margin: "0 auto" }}>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: C.textPrimary, marginBottom: 4 }}>Telehealth</div>
        <div style={{ fontSize: 12, color: C.textSecondary, lineHeight: 1.55, maxWidth: 680 }}>
          PracticeOS does not host video. We integrate with your existing HIPAA-compliant
          video vendor by storing each provider's room URL and stamping appointments
          flagged as Telehealth. No PHI is sent to the video vendor by PracticeOS.
        </div>
      </div>

      {error && <div style={{ marginBottom: 12 }}><ErrorBanner message={error} /></div>}
      {success && (
        <div style={{
          marginBottom: 12, padding: "8px 12px", borderRadius: 6,
          background: C.tealBg, border: `0.5px solid ${C.tealBorder}`,
          fontSize: 12, color: C.teal,
        }}>{success}</div>
      )}

      {/* Practice-level toggle */}
      <Card style={{ padding: 16, marginBottom: 18 }}>
        <SectionHead title="Practice settings" />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: `0.5px solid ${C.borderLight}` }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>Enable telehealth</div>
            <div style={{ fontSize: 11, color: C.textSecondary, marginTop: 2 }}>
              When on, "Telehealth" appointments stamp room URLs and surface Join/Start buttons.
            </div>
          </div>
          <button
            onClick={() => togglePracticeEnabled(!enabled)}
            style={{
              width: 44, height: 24, borderRadius: 12, border: "none", padding: 2,
              background: enabled ? C.tealMid : C.borderMid, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: enabled ? "flex-end" : "flex-start",
              transition: "background 120ms",
            }}
            aria-label={enabled ? "Disable telehealth" : "Enable telehealth"}
          >
            <span style={{
              width: 20, height: 20, borderRadius: "50%", background: "#fff",
              boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
            }} />
          </button>
        </div>

        <div style={{ padding: "12px 0 0" }}>
          <FL>Video vendor</FL>
          <select
            value={vendor || ""}
            onChange={(e) => setVendor(e.target.value)}
            disabled={!enabled}
            style={{
              width: "100%", padding: "9px 12px",
              border: `1px solid ${C.borderMid}`, borderRadius: 8,
              fontSize: 13, fontFamily: "inherit",
              background: enabled ? "#fff" : C.bgSecondary,
              opacity: enabled ? 1 : 0.6,
            }}
          >
            <option value="">Select a vendor...</option>
            {PROVIDER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {vendorMeta && (
            <div style={{ fontSize: 11, color: C.textSecondary, marginTop: 6 }}>
              {vendorMeta.help}
            </div>
          )}
        </div>
      </Card>

      {/* Per-provider room URLs */}
      <Card style={{ padding: 16 }}>
        <SectionHead
          title="Provider video rooms"
          sub="One room URL per provider. Saving propagates to that provider's future Telehealth appointments."
        />

        {!enabled && (
          <div style={{
            padding: "10px 12px", background: C.amberBg, border: `0.5px solid ${C.amberBorder}`,
            borderRadius: 6, fontSize: 12, color: C.amber, marginBottom: 12,
          }}>
            Telehealth is currently disabled. Provider rooms can be configured but won't be used until you enable telehealth above.
          </div>
        )}

        {providers.length === 0 ? (
          <EmptyState icon="👥" title="No active providers" sub="Add providers in Staff first." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {providers.map((p) => {
              const draft = drafts[p.id] || {};
              const existing = settingsByProviderId[p.id];
              const isActive = existing ? existing.is_active : false;
              const isDirty = existing
                ? (draft.room_url !== existing.room_url || draft.is_active !== existing.is_active)
                : !!(draft.room_url && draft.room_url.trim());

              return (
                <div key={p.id} style={{
                  padding: 12, border: `0.5px solid ${C.borderLight}`, borderRadius: 8,
                  display: "flex", flexDirection: "column", gap: 8,
                  opacity: isActive || !existing ? 1 : 0.6,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>
                        Dr. {p.first_name} {p.last_name}
                        {p.credential && <span style={{ fontSize: 11, color: C.textTertiary, fontWeight: 400, marginLeft: 6 }}>{p.credential}</span>}
                      </div>
                      <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>
                        {existing && isActive ? "Active" : existing ? "Deactivated" : "Not configured"}
                      </div>
                    </div>
                    {existing && isActive && (
                      <Btn size="sm" variant="ghost" onClick={() => removeProvider(p.id)}>Deactivate</Btn>
                    )}
                  </div>

                  <input
                    type="url"
                    value={draft.room_url || ""}
                    onChange={(e) => setDraft(p.id, { room_url: e.target.value })}
                    placeholder={
                      vendor === "Doxy"            ? "https://doxy.me/dr-lastname" :
                      vendor === "Zoom Healthcare" ? "https://zoom.us/j/0000000000" :
                      vendor === "Google Meet BAA" ? "https://meet.google.com/abc-defg-hij" :
                                                     "https://your-video-vendor.com/room"
                    }
                    style={{
                      width: "100%", padding: "8px 12px",
                      border: `1px solid ${C.borderMid}`, borderRadius: 6,
                      fontSize: 13, fontFamily: "monospace",
                    }}
                  />

                  {isDirty && (
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                      <Btn size="sm" variant="outline" onClick={() => setDraft(p.id, {
                        room_url: existing ? existing.room_url : "",
                        is_active: existing ? existing.is_active : true,
                      })}>Discard</Btn>
                      <Btn size="sm" onClick={() => saveProvider(p.id)}>Save</Btn>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
