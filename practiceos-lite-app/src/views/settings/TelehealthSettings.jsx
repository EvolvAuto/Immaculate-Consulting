// ═══════════════════════════════════════════════════════════════════════════════
// src/views/settings/TelehealthSettings.jsx
// Telehealth tab inside SettingsView. Owner/Manager-only writes (enforced by
// RLS on practices and provider_telehealth_settings). Two parts:
//   1. Practice toggle: enable telehealth + pick the video vendor (Doxy etc).
//   2. Per-provider room URL list. Saving here triggers the DB to propagate
//      the URL to all that provider's future Telehealth appointments via
//      trg_propagate_telehealth_url_change.
// No PHI lives in the video vendor; PracticeOS only stores the room URL and
// a per-visit attestation timestamp on the appointment row.
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { C } from "../../lib/tokens";
import { Btn, Card, Loader, ErrorBanner, EmptyState, FL, SectionHead, Toggle } from "../../components/ui";

const PROVIDER_OPTIONS = [
  { value: "Doxy",            label: "Doxy.me",         help: "Free tier includes a signed BAA. Each provider gets a personal room URL like https://doxy.me/dr-lastname." },
  { value: "Zoom Healthcare", label: "Zoom Healthcare", help: "Requires Zoom Healthcare plan with executed BAA." },
  { value: "Google Meet BAA", label: "Google Meet",     help: "Only with Google Workspace + signed BAA. Use the meet.google.com URL." },
  { value: "Other",           label: "Other",           help: "Any HIPAA-compliant video service with an executed BAA." },
];

export default function TelehealthSettings({ practiceId, canEdit }) {
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
        setDraft(providerId, { room_url: data.room_url, is_active: data.is_active });
      } else {
        const { data, error: e } = await supabase.from("provider_telehealth_settings")
          .insert({ practice_id: practiceId, provider_id: providerId, room_url: url, is_active: true })
          .select().single();
        if (e) throw e;
        setSettingsByProviderId((s) => ({ ...s, [providerId]: data }));
        setDraft(providerId, { room_url: data.room_url, is_active: data.is_active });
      }
      flashSuccess("Saved. Future telehealth appointments updated.");
    } catch (e) { setError(e.message); }
  };

  const deactivateProvider = async (providerId) => {
    const existing = settingsByProviderId[providerId];
    if (!existing) return;
    if (!confirm("Deactivate this provider's video room? Their future telehealth appointments will lose their room link until you re-save it.")) return;
    try {
      const { data, error: e } = await supabase.from("provider_telehealth_settings")
        .update({ is_active: false })
        .eq("id", existing.id).select().single();
      if (e) throw e;
      setSettingsByProviderId((s) => ({ ...s, [providerId]: data }));
      setDraft(providerId, { room_url: data.room_url, is_active: false });
      flashSuccess("Deactivated. Room link cleared from future appointments.");
    } catch (e) { setError(e.message); }
  };

  const reactivateProvider = async (providerId) => {
    const existing = settingsByProviderId[providerId];
    if (!existing) return;
    try {
      const { data, error: e } = await supabase.from("provider_telehealth_settings")
        .update({ is_active: true })
        .eq("id", existing.id).select().single();
      if (e) throw e;
      setSettingsByProviderId((s) => ({ ...s, [providerId]: data }));
      setDraft(providerId, { room_url: data.room_url, is_active: true });
      flashSuccess("Reactivated. Future telehealth appointments updated.");
    } catch (e) { setError(e.message); }
  };

  if (loading) return <Loader />;
  if (!practice) return <ErrorBanner message="Practice not found" />;

  const enabled = !!practice.telehealth_enabled;
  const vendor = practice.telehealth_provider;
  const vendorMeta = PROVIDER_OPTIONS.find((o) => o.value === vendor);

  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>
      <div style={{ marginBottom: 16, fontSize: 12, color: C.textSecondary, lineHeight: 1.55 }}>
        PracticeOS does not host video. We integrate with your existing HIPAA-compliant
        video vendor by storing each provider's room URL and stamping appointments
        flagged as Telehealth. No PHI is sent to the video vendor by PracticeOS.
      </div>

      {error && <div style={{ marginBottom: 12 }}><ErrorBanner message={error} /></div>}
      {success && (
        <div style={{
          marginBottom: 12, padding: "8px 12px", borderRadius: 6,
          background: C.tealBg, border: `0.5px solid ${C.tealBorder}`,
          fontSize: 12, color: C.teal,
        }}>{success}</div>
      )}

      <SectionHead title="Practice settings" />
      <Card style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 0 12px", borderBottom: `0.5px solid ${C.borderLight}` }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>Enable telehealth</div>
            <div style={{ fontSize: 11, color: C.textSecondary, marginTop: 2 }}>
              When on, "Telehealth" appointments stamp room URLs and surface Join/Start buttons.
            </div>
          </div>
          <Toggle value={enabled} onChange={togglePracticeEnabled} disabled={!canEdit} />
        </div>

        <div style={{ paddingTop: 12 }}>
          <FL>Video vendor</FL>
          <select
            value={vendor || ""}
            onChange={(e) => setVendor(e.target.value)}
            disabled={!canEdit || !enabled}
            style={{
              width: "100%", padding: "9px 12px",
              border: `1px solid ${C.borderMid}`, borderRadius: 8,
              fontSize: 13, fontFamily: "inherit",
              background: (canEdit && enabled) ? "#fff" : C.bgSecondary,
              opacity: (canEdit && enabled) ? 1 : 0.6,
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
            const isDirty = canEdit && (existing
              ? draft.room_url !== existing.room_url
              : !!(draft.room_url && draft.room_url.trim()));

            return (
              <Card key={p.id} style={{ opacity: (isActive || !existing) ? 1 : 0.6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>
                      Dr. {p.first_name} {p.last_name}
                      {p.credential && <span style={{ fontSize: 11, color: C.textTertiary, fontWeight: 400, marginLeft: 6 }}>{p.credential}</span>}
                    </div>
                    <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>
                      {existing && isActive ? "Active" : existing ? "Deactivated" : "Not configured"}
                    </div>
                  </div>
                  {canEdit && existing && (
                    isActive
                      ? <Btn size="sm" variant="ghost" onClick={() => deactivateProvider(p.id)}>Deactivate</Btn>
                      : <Btn size="sm" variant="ghost" onClick={() => reactivateProvider(p.id)}>Reactivate</Btn>
                  )}
                </div>

                <input
                  type="url"
                  value={draft.room_url || ""}
                  onChange={(e) => setDraft(p.id, { room_url: e.target.value })}
                  disabled={!canEdit}
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
                    background: canEdit ? "#fff" : C.bgSecondary,
                  }}
                />

                {isDirty && (
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 8 }}>
                    <Btn size="sm" variant="outline" onClick={() => setDraft(p.id, {
                      room_url: existing ? existing.room_url : "",
                      is_active: existing ? existing.is_active : true,
                    })}>Discard</Btn>
                    <Btn size="sm" onClick={() => saveProvider(p.id)}>Save</Btn>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
