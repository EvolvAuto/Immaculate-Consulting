// ═══════════════════════════════════════════════════════════════════════════════
// StaffView — users + providers management (invite via Edge Function placeholder)
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../auth/AuthProvider";
import { C } from "../lib/tokens";
import { listRows, insertRow, updateRow } from "../lib/db";
import { initialsOf, ROLE_META } from "../components/constants";
import { Badge, Btn, Card, Modal, Input, Select, Avatar, TopBar, TabBar, Toggle, FL, Loader, ErrorBanner, EmptyState } from "../components/ui";

const ROLES = ["Owner", "Manager", "Provider", "Medical Assistant", "Front Desk", "Billing"];
const COLOR_PRESETS = ["#3B82F6", "#1D9E75", "#10B981", "#8B5CF6", "#D08A2E", "#F59E0B", "#EF4444", "#EC4899", "#06B6D4", "#84CC16"];

export default function StaffView() {
  const { practiceId } = useAuth();
  const [tab, setTab] = useState("users");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [users, setUsers] = useState([]);
  const [providers, setProviders] = useState([]);
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(null);

  const load = async () => {
    try {
      setLoading(true);
      const [u, p] = await Promise.all([
        listRows("users", { order: "full_name" }),
        listRows("providers", { order: "last_name" }),
      ]);
      setUsers(u);
      setProviders(p);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (practiceId) load(); }, [practiceId]);

  const saveUser = async (u) => {
    try {
      const patch = { full_name: u.full_name, role: u.role, phone: u.phone, title: u.title, provider_id: u.provider_id || null, is_active: u.is_active };
      if (u.id) await updateRow("users", u.id, patch, { audit: { entityType: "users" } });
      else alert("Creating new users requires inviting them via Supabase Auth (Edge Function — not yet wired). For now, invite via Supabase Dashboard and edit their role here after they sign up.");
      load();
      setEditing(null);
    } catch (e) { setError(e.message); }
  };

  const saveProvider = async (p) => {
    try {
      const patch = {
        first_name: p.first_name, last_name: p.last_name, credential: p.credential,
        specialty: p.specialty, npi: p.npi, dea: p.dea, color: p.color,
        default_duration: parseInt(p.default_duration) || 30, is_active: p.is_active,
        user_id: p.user_id || null,
      };
      if (p.id) await updateRow("providers", p.id, patch, { audit: { entityType: "providers" } });
      else await insertRow("providers", patch, practiceId, { audit: { entityType: "providers" } });
      load();
      setEditing(null);
      setAdding(null);
    } catch (e) { setError(e.message); }
  };

  if (loading) return <div style={{ flex: 1 }}><TopBar title="Staff" /><Loader /></div>;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar title="Staff" sub={`${users.length} users · ${providers.length} providers`}
        actions={<>
          <TabBar tabs={[["users", `Users (${users.length})`], ["providers", `Providers (${providers.length})`]]} active={tab} onChange={setTab} />
          {tab === "providers" && <Btn size="sm" onClick={() => setAdding({ first_name: "", last_name: "", credential: "MD", color: COLOR_PRESETS[Math.floor(Math.random() * COLOR_PRESETS.length)], default_duration: 30, is_active: true })}>+ Add Provider</Btn>}
        </>} />

      <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
        {error && <ErrorBanner message={error} />}

        {tab === "users" && (
          users.length === 0 ? <EmptyState icon="👥" title="No users" />
          : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12, maxWidth: 1100, margin: "0 auto" }}>
            {users.map((u) => {
              const meta = ROLE_META[u.role] || ROLE_META.Patient;
              return (
                <Card key={u.id} onClick={() => setEditing({ ...u, __type: "user" })} style={{ cursor: "pointer", opacity: u.is_active ? 1 : 0.55 }}>
                  <div style={{ display: "flex", gap: 12 }}>
                    <Avatar initials={initialsOf(...(u.full_name || "").split(" "))} size={40} color={meta.color} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: C.textPrimary }}>{u.full_name || "(no name)"}</div>
                      <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.email}</div>
                      <div style={{ marginTop: 6 }}><Badge label={u.role} variant="teal" size="xs" /></div>
                      {!u.is_active && <div style={{ marginTop: 4 }}><Badge label="Inactive" variant="neutral" size="xs" /></div>}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {tab === "providers" && (
          providers.length === 0 ? <EmptyState icon="⚕" title="No providers" sub="Add providers before scheduling appointments." action={<Btn onClick={() => setAdding({ first_name: "", last_name: "", credential: "MD", color: C.teal, default_duration: 30, is_active: true })}>+ Add Provider</Btn>} />
          : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12, maxWidth: 1100, margin: "0 auto" }}>
            {providers.map((p) => (
              <Card key={p.id} onClick={() => setEditing({ ...p, __type: "provider" })} style={{ cursor: "pointer", opacity: p.is_active ? 1 : 0.55 }}>
                <div style={{ display: "flex", gap: 12 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 8, background: p.color, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 14 }}>
                    {initialsOf(p.first_name, p.last_name)}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>Dr. {p.first_name} {p.last_name}</div>
                    <div style={{ fontSize: 11, color: C.textTertiary }}>{p.credential}{p.specialty && ` · ${p.specialty}`}</div>
                    <div style={{ fontSize: 10, color: C.textTertiary, marginTop: 2 }}>NPI {p.npi || "—"} · {p.default_duration}-min default</div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {editing && editing.__type === "user" && <UserForm user={editing} providers={providers} onClose={() => setEditing(null)} onSave={saveUser} />}
      {editing && editing.__type === "provider" && <ProviderForm provider={editing} users={users} onClose={() => setEditing(null)} onSave={saveProvider} />}
      {adding && <ProviderForm provider={adding} users={users} onClose={() => setAdding(null)} onSave={saveProvider} />}
    </div>
  );
}

function UserForm({ user, providers, onClose, onSave }) {
  const [u, setU] = useState(user);
  const set = (k) => (v) => setU((p) => ({ ...p, [k]: v }));
  return (
    <Modal title="Edit User" onClose={onClose} maxWidth={480}>
      <Input label="Full Name" value={u.full_name} onChange={set("full_name")} />
      <div style={{ marginBottom: 14 }}>
        <FL>Email</FL>
        <div style={{ fontSize: 13, color: C.textSecondary }}>{u.email} <span style={{ fontSize: 10, color: C.textTertiary }}>(managed in Supabase Auth)</span></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Select label="Role" value={u.role} onChange={set("role")} options={ROLES} />
        <Input label="Title" value={u.title} onChange={set("title")} />
        <Input label="Phone" value={u.phone} onChange={set("phone")} />
        <Select label="Link to Provider" value={u.provider_id || ""} onChange={set("provider_id")}
          options={[{ value: "", label: "— None —" }, ...providers.map((p) => ({ value: p.id, label: `Dr. ${p.first_name} ${p.last_name}` }))]} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, marginBottom: 14 }}>
        <FL>Active</FL>
        <Toggle value={u.is_active} onChange={set("is_active")} />
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        <Btn onClick={() => onSave(u)}>Save</Btn>
      </div>
    </Modal>
  );
}

function ProviderForm({ provider, users, onClose, onSave }) {
  const [p, setP] = useState(provider);
  const set = (k) => (v) => setP((x) => ({ ...x, [k]: v }));
  return (
    <Modal title={provider.id ? "Edit Provider" : "New Provider"} onClose={onClose} maxWidth={520}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Input label="First Name" value={p.first_name} onChange={set("first_name")} />
        <Input label="Last Name" value={p.last_name} onChange={set("last_name")} />
        <Input label="Credential (MD, NP, PA)" value={p.credential} onChange={set("credential")} />
        <Input label="Specialty" value={p.specialty} onChange={set("specialty")} />
        <Input label="NPI" value={p.npi} onChange={set("npi")} />
        <Input label="DEA" value={p.dea} onChange={set("dea")} />
        <Input label="Default Duration (min)" type="number" value={p.default_duration} onChange={set("default_duration")} />
        <Select label="Linked User" value={p.user_id || ""} onChange={set("user_id")}
          options={[{ value: "", label: "— None —" }, ...users.map((u) => ({ value: u.id, label: u.full_name || u.email }))]} />
      </div>
      <FL>Color</FL>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
        {COLOR_PRESETS.map((c) => (
          <button key={c} onClick={() => set("color")(c)} style={{
            width: 28, height: 28, borderRadius: "50%", background: c,
            border: p.color === c ? `3px solid ${C.textPrimary}` : "2px solid #fff",
            boxShadow: "0 0 0 1px rgba(0,0,0,0.1)", cursor: "pointer",
          }} />
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <FL>Active</FL>
        <Toggle value={p.is_active} onChange={set("is_active")} />
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        <Btn onClick={() => onSave(p)}>{provider.id ? "Save" : "Create"}</Btn>
      </div>
    </Modal>
  );
}
