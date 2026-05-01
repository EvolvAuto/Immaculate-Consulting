// ═══════════════════════════════════════════════════════════════════════════
// src/views/care-management/PlanConnectionsTab.jsx
//
// Per-practice metadata for HOW supplemental data submissions get delivered
// to each plan. NO credentials stored - just operational docs (host, dir,
// contact, cadence). Used to prefill the MarkSent flow in OutboundTab.
// Owner / Manager only; gated by parent + defense-in-depth here.
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { supabase } from "../../lib/supabaseClient";
import { C } from "../../lib/tokens";
import { Card, SectionHead, Btn, Badge, Modal, Loader, FL, Input, Select, Textarea } from "../../components/ui";
import { insertRow, updateRow } from "../../lib/db";
import { NC_HEALTH_PLANS_GROUPED, PLAN_LABEL } from "./constants";

const DELIVERY_METHODS = [
  { value: "Manual SFTP", label: "Manual SFTP" },
  { value: "Auto SFTP",   label: "Auto SFTP (deferred)" },
  { value: "Email",       label: "Email" },
  { value: "Plan Portal", label: "Plan Portal" },
  { value: "Other",       label: "Other" },
];

const STATUS_VARIANT = {
  "Active":        { label: "Active",        variant: "green" },
  "Pending Setup": { label: "Pending Setup", variant: "amber" },
  "Inactive":      { label: "Inactive",      variant: "neutral" },
};

const CADENCE_OPTIONS = ["Monthly", "Quarterly", "Annually", "Ad-hoc"];

// ─── Main ────────────────────────────────────────────────────────────────
export default function PlanConnectionsTab({ practiceId, isAdmin }) {
  const { profile } = useAuth();

  const [profiles, setProfiles]       = useState([]);
  const [credentials, setCredentials] = useState([]); // one per profile_id
  const [contracts, setContracts]     = useState([]); // for "plans without profile" KPI
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [editing, setEditing]         = useState(null); // null | profile object | {} for new
  const [credEditing, setCredEditing] = useState(null); // null | profile object (manage creds for that profile)
  const [filter, setFilter]           = useState("Active+Pending");

  // Fast lookup: profile_id -> credential row
  const credByProfile = useMemo(() => {
    const m = {};
    for (const c of credentials) m[c.profile_id] = c;
    return m;
  }, [credentials]);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const [pRes, cRes, vRes] = await Promise.all([
        supabase.from("cm_plan_delivery_profiles")
          .select("*")
          .eq("practice_id", practiceId)
          .order("payer_short_name"),
        supabase.from("cm_plan_delivery_credentials")
          .select("id, profile_id, auth_type, status, last_tested_at, last_test_result, last_test_error, last_rotated_at")
          .eq("practice_id", practiceId),
        supabase.from("cm_vbp_contracts")
          .select("payer_short_name")
          .eq("practice_id", practiceId)
          .in("status", ["Active", "Draft"]),
      ]);
      if (pRes.error) throw pRes.error;
      if (cRes.error) throw cRes.error;
      if (vRes.error) throw vRes.error;
      setProfiles(pRes.data || []);
      setCredentials(cRes.data || []);
      setContracts(vRes.data || []);
    } catch (e) {
      setError(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (practiceId) refresh(); }, [practiceId]);

  const kpis = useMemo(() => {
    const k = { total: profiles.length, active: 0, pending: 0, inactive: 0 };
    for (const p of profiles) {
      if (p.status === "Active") k.active++;
      else if (p.status === "Pending Setup") k.pending++;
      else if (p.status === "Inactive") k.inactive++;
    }
    const profilePayers = new Set(profiles.filter(p => p.status !== "Inactive").map(p => p.payer_short_name));
    const contractPayers = new Set(contracts.map(c => c.payer_short_name));
    let unconfigured = 0;
    for (const p of contractPayers) if (!profilePayers.has(p)) unconfigured++;
    k.unconfigured = unconfigured;
    return k;
  }, [profiles, contracts]);

  const filtered = useMemo(() => {
    return profiles.filter(p => {
      if (filter === "Active+Pending") return p.status !== "Inactive";
      if (filter === "Active") return p.status === "Active";
      return true;
    });
  }, [profiles, filter]);

  if (!isAdmin) {
    return (
      <Card style={{ padding: 24, textAlign: "center" }}>
        <SectionHead title="Plan Connections" />
        <div style={{ marginTop: 12, fontSize: 13, color: C.textSecondary }}>
          Owner / Manager only.
        </div>
      </Card>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <SectionHead title="Plan Connections" />
          <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 4 }}>
            Document HOW supplemental data submissions get delivered to each plan. SFTP host, email, portal URL, contact info, cadence. No credentials stored. Prefills the Mark Sent flow in Outbound Submissions.
          </div>
        </div>
        <Btn onClick={() => setEditing({})}>+ New connection</Btn>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        <KPICard label="Total connections" value={kpis.total} />
        <KPICard label="Active" value={kpis.active} accent={C.teal} />
        <KPICard label="Pending setup" value={kpis.pending} accent={kpis.pending > 0 ? C.amber : null} />
        <KPICard
          label="Plans without a connection"
          value={kpis.unconfigured}
          accent={kpis.unconfigured > 0 ? C.amber : null}
          hint="From your active VBP contracts"
        />
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <span style={{ fontSize: 12, color: C.textSecondary }}>Show:</span>
        {[["Active+Pending", "Active + Pending"], ["Active", "Active only"], ["All", "All including inactive"]].map(([v, label]) => (
          <Chip key={v} active={filter === v} onClick={() => setFilter(v)}>{label}</Chip>
        ))}
      </div>

      {loading ? (
        <Loader label="Loading connections..." />
      ) : error ? (
        <Card style={{ padding: 16, background: "#fef2f2", border: "0.5px solid " + C.red, color: C.red, fontSize: 12 }}>
          {error}
        </Card>
      ) : filtered.length === 0 ? (
        <Card style={{ padding: 32, textAlign: "center" }}>
          <div style={{ fontSize: 14, color: C.textSecondary, marginBottom: 8 }}>
            {profiles.length === 0
              ? "No plan connections yet. Click \"+ New connection\" to add one."
              : "No connections match the current filter."}
          </div>
        </Card>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 12 }}>
          {filtered.map(p => (
            <ConnectionCard
              key={p.id}
              connection={p}
              credential={credByProfile[p.id] || null}
              onEdit={() => setEditing(p)}
              onManageCreds={() => setCredEditing(p)}
            />
          ))}
        </div>
      )}

      {editing !== null && (
        <ConnectionEditModal
          connection={editing}
          practiceId={practiceId}
          existingPayers={new Set(profiles.filter(p => p.id !== editing.id).map(p => p.payer_short_name))}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }}
        />
      )}

      {credEditing !== null && (
        <CredentialManageModal
          profile={credEditing}
          credential={credByProfile[credEditing.id] || null}
          onClose={() => setCredEditing(null)}
          onSaved={() => { setCredEditing(null); refresh(); }}
          onJumpToProfileEdit={() => { setEditing(credEditing); setCredEditing(null); }}
        />
      )}
    </div>
  );
}

// ─── Connection card ────────────────────────────────────────────────────
function ConnectionCard({ connection: p, credential, onEdit, onManageCreds }) {
  const variant = STATUS_VARIANT[p.status] || { label: p.status, variant: "neutral" };
  const isSFTP = p.delivery_method === "Manual SFTP" || p.delivery_method === "Auto SFTP";

  let summary = "";
  if (isSFTP) {
    if (p.sftp_host) {
      summary = (p.sftp_username ? p.sftp_username + "@" : "") + p.sftp_host
        + (p.sftp_port && p.sftp_port !== 22 ? ":" + p.sftp_port : "");
      if (p.sftp_directory) summary += " · " + p.sftp_directory;
    } else summary = "(SFTP host not yet set)";
  } else if (p.delivery_method === "Email") {
    summary = p.email_to || "(email not yet set)";
  } else if (p.delivery_method === "Plan Portal") {
    summary = p.portal_url || "(portal URL not yet set)";
  } else if (p.delivery_method === "Other") {
    summary = "(see notes)";
  }

  // Credential status sub-badge (SFTP only)
  let credLabel = null;
  let credVariant = "neutral";
  if (isSFTP) {
    if (!credential) {
      credLabel = "No credentials"; credVariant = "amber";
    } else if (credential.status === "Active" && credential.last_test_result === "Success") {
      credLabel = "Creds OK"; credVariant = "green";
    } else if (credential.status === "Pending Test") {
      credLabel = "Creds untested"; credVariant = "amber";
    } else if (credential.status === "Test Failed" || credential.last_test_result === "Auth Failed" || credential.last_test_result === "Connection Failed") {
      credLabel = "Creds failing"; credVariant = "red";
    } else {
      credLabel = "Creds " + credential.status; credVariant = "neutral";
    }
  }

  return (
    <Card style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, cursor: "pointer" }} onClick={onEdit}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.textPrimary }}>
            {p.display_name || PLAN_LABEL[p.payer_short_name] || p.payer_short_name}
          </div>
          <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>{p.delivery_method}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
          <Badge label={variant.label} variant={variant.variant} size="xs" />
          {credLabel && <Badge label={credLabel} variant={credVariant} size="xs" />}
        </div>
      </div>

      <div onClick={onEdit} style={{
        fontSize: 11, color: C.textSecondary, fontFamily: "monospace",
        wordBreak: "break-all", padding: "6px 8px", background: C.bgSecondary,
        borderRadius: 4, minHeight: 26, cursor: "pointer",
      }}>
        {summary}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.textTertiary, paddingTop: 4 }}>
        <span>
          Cadence: {p.expected_cadence || "—"}
          {p.expected_day_of_month ? " (day " + p.expected_day_of_month + ")" : ""}
        </span>
        <span>
          {p.last_submitted_at ? "Last sent: " + new Date(p.last_submitted_at).toLocaleDateString() : "Never sent"}
        </span>
      </div>

      {isSFTP && (
        <div style={{ display: "flex", gap: 6, paddingTop: 6, borderTop: "0.5px solid " + C.borderLight }}>
          <Btn variant="outline" size="sm" onClick={onEdit}>Edit profile</Btn>
          <Btn size="sm" onClick={onManageCreds}>
            {credential ? "Manage credentials" : "+ Add credentials"}
          </Btn>
        </div>
      )}
    </Card>
  );
}

// ─── Edit / create modal ────────────────────────────────────────────────
function ConnectionEditModal({ connection, practiceId, existingPayers, onClose, onSaved }) {
  const isNew = !connection.id;
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);

  const [form, setForm] = useState(() => ({
    payer_short_name:    connection.payer_short_name || "",
    display_name:        connection.display_name || "",
    delivery_method:     connection.delivery_method || "Manual SFTP",
    status:              connection.status || "Pending Setup",
    sftp_host:           connection.sftp_host || "",
    sftp_port:           connection.sftp_port || 22,
    sftp_username:       connection.sftp_username || "",
    outbound_directory:  connection.outbound_directory || connection.sftp_directory || "",
    inbound_directory:   connection.inbound_directory || "",
    sftp_uses_ssh_key:   connection.sftp_uses_ssh_key || false,
    sftp_pgp_required:   connection.sftp_pgp_required || false,
    email_to:            connection.email_to || "",
    email_cc:            connection.email_cc || "",
    email_subject_template: connection.email_subject_template || "",
    portal_url:          connection.portal_url || "",
    portal_username:     connection.portal_username || "",
    naming_convention_override: connection.naming_convention_override || "",
    expected_cadence:    connection.expected_cadence || "Monthly",
    expected_day_of_month: connection.expected_day_of_month || "",
    plan_contact_name:   connection.plan_contact_name || "",
    plan_contact_email:  connection.plan_contact_email || "",
    plan_contact_phone:  connection.plan_contact_phone || "",
    notes:               connection.notes || "",
  }));

  const set = (patch) => setForm(prev => ({ ...prev, ...patch }));

  const isSFTP = form.delivery_method === "Manual SFTP" || form.delivery_method === "Auto SFTP";
  const isEmail = form.delivery_method === "Email";
  const isPortal = form.delivery_method === "Plan Portal";

  const validate = () => {
    if (!form.payer_short_name) return "Payer / health plan is required";
    if (isNew && existingPayers.has(form.payer_short_name)) {
      return "A connection profile for this plan already exists. Edit the existing one instead.";
    }
    if (isSFTP && !form.sftp_host) return "SFTP host is required for SFTP delivery";
    if (isSFTP && !form.outbound_directory) return "Outbound directory is required for SFTP delivery";
    if (isEmail && !form.email_to) return "Email recipient is required for Email delivery";
    if (isPortal && !form.portal_url) return "Portal URL is required for Portal delivery";
    if (form.expected_day_of_month) {
      const d = parseInt(form.expected_day_of_month, 10);
      if (isNaN(d) || d < 1 || d > 31) return "Day of month must be between 1 and 31";
    }
    return null;
  };

  const save = async () => {
    const v = validate();
    if (v) { setError(v); return; }
    setError(null);
    setSaving(true);
    try {
      const clean = (s) => (s === "" ? null : s);
      const payload = {
        practice_id: practiceId,
        payer_short_name: form.payer_short_name,
        display_name: clean(form.display_name),
        delivery_method: form.delivery_method,
        status: form.status,
        sftp_host: clean(form.sftp_host),
        sftp_port: form.sftp_port ? parseInt(form.sftp_port, 10) : null,
        sftp_username: clean(form.sftp_username),
        outbound_directory: clean(form.outbound_directory),
        inbound_directory: clean(form.inbound_directory),
        sftp_directory: clean(form.outbound_directory),  // legacy field stays in sync with outbound
        sftp_uses_ssh_key: !!form.sftp_uses_ssh_key,
        sftp_pgp_required: !!form.sftp_pgp_required,
        email_to: clean(form.email_to),
        email_cc: clean(form.email_cc),
        email_subject_template: clean(form.email_subject_template),
        portal_url: clean(form.portal_url),
        portal_username: clean(form.portal_username),
        naming_convention_override: clean(form.naming_convention_override),
        expected_cadence: clean(form.expected_cadence),
        expected_day_of_month: form.expected_day_of_month ? parseInt(form.expected_day_of_month, 10) : null,
        plan_contact_name: clean(form.plan_contact_name),
        plan_contact_email: clean(form.plan_contact_email),
        plan_contact_phone: clean(form.plan_contact_phone),
        notes: clean(form.notes),
      };

      if (isNew) {
        await insertRow("cm_plan_delivery_profiles", payload, practiceId, {
          audit: { entityType: "cm_plan_delivery_profiles", details: { action: "created", payer: form.payer_short_name } },
        });
      } else {
        await updateRow("cm_plan_delivery_profiles", connection.id, payload, {
          audit: { entityType: "cm_plan_delivery_profiles", details: { action: "updated", payer: form.payer_short_name } },
        });
      }
      onSaved();
    } catch (e) {
      setError(e.message || "Save failed");
      setSaving(false);
    }
  };

  return (
    <Modal title={isNew ? "New plan connection" : "Edit connection"} onClose={onClose} maxWidth={720}>
      <SectionLabel>Plan</SectionLabel>
      <FL>Payer / health plan *</FL>
      <select value={form.payer_short_name} onChange={e => set({ payer_short_name: e.target.value })}
        disabled={!isNew}
        style={{ width: "100%", padding: "8px 10px", border: "0.5px solid " + C.borderMid, borderRadius: 4, fontSize: 13, fontFamily: "inherit", background: !isNew ? C.bgSecondary : "#fff", marginBottom: 10 }}>
        <option value="">Select a plan...</option>
        {NC_HEALTH_PLANS_GROUPED.map(group => (
          <optgroup key={group.group} label={group.group}>
            {group.options.map(opt => (
              <option key={opt.short} value={opt.short}>{opt.label}</option>
            ))}
          </optgroup>
        ))}
      </select>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Input label="Display name (optional)" value={form.display_name} onChange={v => set({ display_name: v })}
          placeholder={PLAN_LABEL[form.payer_short_name] || ""} />
        <Select label="Status" value={form.status} onChange={v => set({ status: v })}
          options={["Active", "Pending Setup", "Inactive"]} />
      </div>

      <SectionLabel>Delivery</SectionLabel>
      <FL>Method *</FL>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {DELIVERY_METHODS.map(m => (
          <MethodButton key={m.value}
            active={form.delivery_method === m.value}
            onClick={() => set({ delivery_method: m.value })}>
            {m.label}
          </MethodButton>
        ))}
      </div>

      {isSFTP && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
            <Input label="SFTP host *" value={form.sftp_host} onChange={v => set({ sftp_host: v })}
              placeholder="sftp.healthyblue.example.com" />
            <Input label="Port" type="number" value={form.sftp_port} onChange={v => set({ sftp_port: v })} placeholder="22" />
          </div>
          <Input label="Username" value={form.sftp_username} onChange={v => set({ sftp_username: v })}
            placeholder="practice_tin_123456789" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Input label="Outbound directory * (where we PUT files)" value={form.outbound_directory}
              onChange={v => set({ outbound_directory: v })}
              placeholder="/inbox/supplemental_data/" />
            <Input label="Inbound directory (where we GET files)" value={form.inbound_directory}
              onChange={v => set({ inbound_directory: v })}
              placeholder="/outbox/" />
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 4, marginBottom: 10 }}>
            <Checkbox checked={form.sftp_uses_ssh_key} onChange={v => set({ sftp_uses_ssh_key: v })}>
              Uses SSH key authentication (vs password)
            </Checkbox>
            <Checkbox checked={form.sftp_pgp_required} onChange={v => set({ sftp_pgp_required: v })}>
              PGP encryption required
            </Checkbox>
          </div>
          {form.delivery_method === "Auto SFTP" && (
            <div style={{ padding: "8px 12px", background: C.tealBg, border: "0.5px solid " + C.tealBorder, borderRadius: 6, fontSize: 11, color: C.textPrimary, marginBottom: 10 }}>
              Auto SFTP delivers each monthly submission automatically using the saved credentials below. Save credentials and Test the connection at least once; the monthly cron handles future sends without a Mark Sent click.
            </div>
          )}
        </>
      )}

      {isEmail && (
        <>
          <Input label="Send to *" value={form.email_to} onChange={v => set({ email_to: v })}
            placeholder="supplemental-data@plan.com" />
          <Input label="CC (optional)" value={form.email_cc} onChange={v => set({ email_cc: v })}
            placeholder="hedis-team@plan.com" />
          <Input label="Subject line template (optional)" value={form.email_subject_template} onChange={v => set({ email_subject_template: v })}
            placeholder="Supplemental Data Submission - {PRACTICE} - {MY}" />
        </>
      )}

      {isPortal && (
        <>
          <Input label="Portal URL *" value={form.portal_url} onChange={v => set({ portal_url: v })}
            placeholder="https://provider.plan.com/hedis-supplemental" />
          <Input label="Portal username (optional, no password)" value={form.portal_username} onChange={v => set({ portal_username: v })}
            placeholder="practice_tin_123456789" />
          <div style={{ padding: "8px 12px", background: C.bgSecondary, borderRadius: 6, fontSize: 11, color: C.textSecondary, marginBottom: 10 }}>
            Username is for reference only. Don't enter passwords here - use a password manager.
          </div>
        </>
      )}

      <SectionLabel>Cadence & format</SectionLabel>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Select label="Expected cadence" value={form.expected_cadence} onChange={v => set({ expected_cadence: v })}
          options={CADENCE_OPTIONS} />
        <Input label="Day of month (1-31)" type="number" value={form.expected_day_of_month}
          onChange={v => set({ expected_day_of_month: v })} placeholder="(optional)" />
      </div>
      <Input label="Naming convention override (optional)" value={form.naming_convention_override}
        onChange={v => set({ naming_convention_override: v })}
        placeholder="Default: {PAYER}_EMR_CMHN_{TIMESTAMP}.txt" />

      <SectionLabel>Plan contact</SectionLabel>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Input label="Contact name" value={form.plan_contact_name} onChange={v => set({ plan_contact_name: v })} />
        <Input label="Contact email" value={form.plan_contact_email} onChange={v => set({ plan_contact_email: v })} />
      </div>
      <Input label="Contact phone" value={form.plan_contact_phone} onChange={v => set({ plan_contact_phone: v })} />

      <Textarea label="Notes" value={form.notes} onChange={v => set({ notes: v })} rows={3}
        placeholder="Anything to remember about this plan's quirks - file format preferences, gotchas, retry rules..." />

      {error && (
        <div style={{ marginTop: 8, padding: "8px 12px", background: "#fef2f2", border: "0.5px solid " + C.red, borderRadius: 6, fontSize: 12, color: C.red }}>
          {error}
        </div>
      )}

      <div style={{ marginTop: 16, paddingTop: 12, borderTop: "0.5px solid " + C.borderLight, display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn variant="outline" onClick={onClose} disabled={saving}>Cancel</Btn>
        <Btn onClick={save} disabled={saving}>{saving ? "Saving..." : (isNew ? "Create connection" : "Save changes")}</Btn>
      </div>
    </Modal>
  );
}

// ─── Credential management modal ──────────────────────────────────────────
// Add or rotate SFTP credentials for a Plan Connection. Plaintext is sent
// to the hedis-credential-save edge function which writes it into Supabase
// Vault encrypted. After save we offer a one-click "Test connection" that
// hits hedis-outbound-test-credentials and reflects the result on the cred.
function CredentialManageModal({ profile, credential, onClose, onSaved, onJumpToProfileEdit }) {
  const isRotate = !!credential;

  // Detect incomplete profile - the test/deliver edge fns need at least
  // sftp_host AND sftp_username. Surface this up front instead of letting
  // the user save creds and discover the gap on Test.
  const missingFields = [];
  if (!profile.sftp_host) missingFields.push("SFTP host");
  if (!profile.sftp_username) missingFields.push("SFTP username");
  const profileIncomplete = missingFields.length > 0;

  const [authType, setAuthType] = useState(credential?.auth_type || "password");
  const [password, setPassword] = useState("");
  const [sshKey, setSshKey]     = useState("");
  const [passphrase, setPassphrase] = useState("");

  const [saving, setSaving]     = useState(false);
  const [testing, setTesting]   = useState(false);
  const [error, setError]       = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [savedJustNow, setSavedJustNow] = useState(false);

  const validate = () => {
    if (authType === "password" && !password.trim()) return "Password is required.";
    if (authType === "ssh_key" && !sshKey.trim()) return "SSH private key is required.";
    if (authType === "ssh_key" && sshKey.trim() && !sshKey.includes("BEGIN") && !sshKey.includes("PRIVATE KEY")) {
      return "SSH key doesn't look like a PEM-formatted private key. Paste the full block including 'BEGIN ... PRIVATE KEY' lines.";
    }
    return null;
  };

  const save = async () => {
    const v = validate();
    if (v) { setError(v); return; }
    setError(null);
    setTestResult(null);
    setSaving(true);
    try {
      const body = {
        profile_id: profile.id,
        auth_type: authType,
      };
      if (authType === "password") {
        body.password = password;
      } else {
        body.ssh_private_key = sshKey;
        if (passphrase.trim()) body.ssh_passphrase = passphrase;
      }

      const { data, error: invErr } = await supabase.functions.invoke("hedis-credential-save", { body });
      if (invErr) {
        let msg = invErr.message;
        try {
          const ctx = invErr.context;
          if (ctx && typeof ctx.text === "function") {
            const txt = await ctx.text();
            const parsed = JSON.parse(txt);
            if (parsed.error) msg = parsed.error;
          }
        } catch (_) {}
        throw new Error(msg);
      }
      if (!data?.credential_id) throw new Error("Save did not return a credential_id");

      setPassword("");
      setSshKey("");
      setPassphrase("");
      setSavedJustNow(true);
    } catch (e) {
      setError(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    if (!credential?.id && !savedJustNow) {
      setError("Save the credential before testing.");
      return;
    }
    setError(null);
    setTesting(true);
    setTestResult(null);
    try {
      let credentialId = credential?.id;
      if (!credentialId) {
        const { data } = await supabase
          .from("cm_plan_delivery_credentials")
          .select("id")
          .eq("profile_id", profile.id)
          .maybeSingle();
        credentialId = data?.id;
      }
      if (!credentialId) throw new Error("Could not locate the saved credential.");

      const { data, error: invErr } = await supabase.functions.invoke("hedis-outbound-test-credentials", {
        body: { credential_id: credentialId },
      });

      if (invErr) {
        let msg = invErr.message;
        let category = null;
        try {
          const ctx = invErr.context;
          if (ctx && typeof ctx.text === "function") {
            const txt = await ctx.text();
            const parsed = JSON.parse(txt);
            if (parsed.error) msg = parsed.error;
            if (parsed.category) category = parsed.category;
          }
        } catch (_) {}
        setTestResult({ success: false, message: (category ? category + ": " : "") + msg });
        return;
      }
      if (data?.status === "success") {
        setTestResult({ success: true, message: "Connection successful.", directory_check: data.directory_check });
      } else {
        setTestResult({ success: false, message: (data?.category || "Failed") + ": " + (data?.error || "Unknown error") });
      }
    } catch (e) {
      setTestResult({ success: false, message: e.message || String(e) });
    } finally {
      setTesting(false);
    }
  };

  const close = () => {
    if (saving || testing) return;
    onSaved();
    onClose();
  };

  const planLabel = profile.display_name || PLAN_LABEL[profile.payer_short_name] || profile.payer_short_name;

  return (
    <Modal title={(isRotate ? "Rotate credentials: " : "Add credentials: ") + planLabel} onClose={close} maxWidth={680}>
      <div style={{ marginBottom: 12, padding: "10px 12px", background: C.bgSecondary, borderRadius: 6, fontSize: 12, color: C.textPrimary, lineHeight: 1.55 }}>
        Credentials are stored encrypted in our secure vault. Once saved, plaintext is never visible - not to us, not back to you. To rotate, save a new value here. To remove credentials, contact support.
      </div>

      <div style={{ marginBottom: 12, padding: "10px 12px", border: "0.5px solid " + C.borderLight, borderRadius: 6, fontSize: 12 }}>
        <div style={{ fontSize: 10, color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6, fontWeight: 600 }}>
          Connection target
        </div>
        <div style={{ fontFamily: "monospace", fontSize: 11, color: profileIncomplete ? C.textTertiary : C.textPrimary }}>
          {profile.sftp_username || "(username missing)"}
          @{profile.sftp_host || "(host missing)"}
          {profile.sftp_port && profile.sftp_port !== 22 ? ":" + profile.sftp_port : ""}
          {profile.sftp_directory ? " - " + profile.sftp_directory : ""}
        </div>
      </div>

      {profileIncomplete && (
        <div style={{ marginBottom: 12, padding: "10px 12px", background: "#fffbeb", border: "0.5px solid " + C.amberBorder, borderRadius: 6, fontSize: 12, color: C.textPrimary }}>
          <div style={{ fontWeight: 600, color: C.amber, marginBottom: 4 }}>
            Profile is missing: {missingFields.join(", ")}
          </div>
          <div style={{ fontSize: 11, color: C.textSecondary, marginBottom: 8 }}>
            You can save credentials now, but the test and SFTP delivery will fail until these fields are filled in on the connection profile.
          </div>
          {onJumpToProfileEdit && (
            <Btn variant="outline" size="sm" onClick={onJumpToProfileEdit}>
              Edit profile to add {missingFields[0]}
            </Btn>
          )}
        </div>
      )}

      {isRotate && (
        <div style={{ marginBottom: 12, padding: "8px 12px", background: "#fffbeb", border: "0.5px solid " + C.amberBorder, borderRadius: 6, fontSize: 11, color: C.amber }}>
          Existing credentials will be replaced. Last rotated: {credential.last_rotated_at ? new Date(credential.last_rotated_at).toLocaleString() : "(initial setup)"}.
        </div>
      )}

      <FL>Authentication type *</FL>
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        <MethodButton active={authType === "password"} onClick={() => setAuthType("password")}>
          Password
        </MethodButton>
        <MethodButton active={authType === "ssh_key"} onClick={() => setAuthType("ssh_key")}>
          SSH key
        </MethodButton>
      </div>

      {authType === "password" ? (
        <PasswordInputWithToggle
          label="SFTP password *"
          value={password}
          onChange={setPassword}
          placeholder={isRotate ? "New password (existing will be replaced)" : "Password from plan onboarding email"}
        />
      ) : (
        <>
          <FL>SSH private key (PEM) *</FL>
          <textarea
            value={sshKey}
            onChange={e => setSshKey(e.target.value)}
            placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----"}
            spellCheck={false}
            style={{
              width: "100%", padding: "8px 10px", border: "0.5px solid " + C.borderMid,
              borderRadius: 4, fontSize: 11, fontFamily: "monospace", minHeight: 140,
              marginBottom: 10, resize: "vertical",
            }}
          />
          <Input
            label="Passphrase (optional, only if key is encrypted)"
            type="password"
            value={passphrase}
            onChange={setPassphrase}
          />
        </>
      )}

      {savedJustNow && !testResult && (
        <div style={{ marginTop: 8, padding: "8px 12px", background: C.tealBg, border: "0.5px solid " + C.tealBorder, borderRadius: 6, fontSize: 12, color: C.textPrimary }}>
          Credentials saved securely. Click "Test connection" to verify they work against the plan's SFTP server.
        </div>
      )}

      {testResult && (
        <div style={{
          marginTop: 8, padding: "10px 12px", borderRadius: 6, fontSize: 12,
          background: testResult.success ? C.tealBg : "#fef2f2",
          border: "0.5px solid " + (testResult.success ? C.tealBorder : C.red),
          color: testResult.success ? C.textPrimary : C.red,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {testResult.success ? "OK: " : "FAIL: "}{testResult.message}
          </div>
          {testResult.directory_check && (
            <div style={{ fontSize: 11, color: C.textSecondary }}>
              {testResult.directory_check.listed
                ? "Directory listed: " + testResult.directory_check.entry_count + " entries"
                : "Directory check failed: " + (testResult.directory_check.error || "unknown")}
            </div>
          )}
        </div>
      )}

      {/* Inbound files panel - configures + triggers polls */}
      {(credential || savedJustNow) && profile.inbound_directory && (
        <InboundFilesPanel profile={profile} />
      )}

      {error && (
        <div style={{ marginTop: 8, padding: "8px 12px", background: "#fef2f2", border: "0.5px solid " + C.red, borderRadius: 6, fontSize: 12, color: C.red }}>
          {error}
        </div>
      )}

      <div style={{ marginTop: 16, paddingTop: 12, borderTop: "0.5px solid " + C.borderLight, display: "flex", gap: 8, justifyContent: "space-between" }}>
        <Btn variant="outline" onClick={close} disabled={saving || testing}>Close</Btn>
        <div style={{ display: "flex", gap: 8 }}>
          {(credential || savedJustNow) && (
            <Btn variant="outline" onClick={test} disabled={saving || testing}>
              {testing ? "Testing..." : "Test connection"}
            </Btn>
          )}
          <Btn onClick={save} disabled={saving || testing}>
            {saving ? "Saving..." : (isRotate ? "Rotate credentials" : "Save credentials")}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}
// ─── Small helpers ────────────────────────────────────────────────────────
function SectionLabel({ children }) {
  return (
    <div style={{
      marginTop: 14, marginBottom: 8, paddingBottom: 4,
      borderBottom: "0.5px solid " + C.borderLight,
      fontSize: 11, fontWeight: 700, color: C.textSecondary,
      textTransform: "uppercase", letterSpacing: 0.4,
    }}>{children}</div>
  );
}

function MethodButton({ active, children, onClick }) {
  return (
    <button type="button" onClick={onClick}
      style={{
        padding: "8px 14px", fontSize: 12, fontWeight: active ? 600 : 500,
        border: "0.5px solid " + (active ? C.teal : C.borderMid),
        background: active ? C.tealBg : "#fff",
        color: active ? C.teal : C.textPrimary,
        borderRadius: 4, cursor: "pointer", fontFamily: "inherit",
      }}>{children}</button>
  );
}

function Checkbox({ checked, onChange, children }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.textPrimary, cursor: "pointer" }}>
      <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)}
        style={{ width: 14, height: 14, cursor: "pointer" }} />
      {children}
    </label>
  );
}

// Password input with a show/hide eye toggle. Clean, accessible, no
// dependencies. Useful so admins can verify they typed the password
// correctly before saving / rotating credentials.
function PasswordInputWithToggle({ label, value, onChange, placeholder }) {
  const [visible, setVisible] = useState(false);
  return (
    <div style={{ marginBottom: 10 }}>
      <FL>{label}</FL>
      <div style={{ position: "relative" }}>
        <input
          type={visible ? "text" : "password"}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder || ""}
          autoComplete="new-password"
          spellCheck={false}
          style={{
            width: "100%", padding: "8px 60px 8px 10px",
            border: "0.5px solid " + C.borderMid, borderRadius: 4,
            fontSize: 13, fontFamily: "inherit", background: "#fff",
            boxSizing: "border-box",
          }}
        />
        <button
          type="button"
          onClick={() => setVisible(v => !v)}
          tabIndex={-1}
          style={{
            position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
            background: "none", border: "none",
            color: C.textSecondary, fontSize: 11, cursor: "pointer",
            padding: "4px 8px", fontFamily: "inherit",
          }}
          aria-label={visible ? "Hide password" : "Show password"}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
    </div>
  );
}

function KPICard({ label, value, accent, hint }) {
  return (
    <Card style={{ padding: 12 }}>
      <div style={{ fontSize: 11, color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: accent || C.textPrimary, lineHeight: 1.1 }}>{value}</div>
      {hint && <div style={{ fontSize: 10, color: C.textTertiary, marginTop: 4 }}>{hint}</div>}
    </Card>
  );
}

function Chip({ active, children, onClick }) {
  return (
    <button onClick={onClick}
      style={{
        padding: "6px 12px", fontSize: 12, fontWeight: active ? 600 : 500,
        border: "0.5px solid " + (active ? C.teal : C.borderMid),
        background: active ? C.tealBg : "#fff",
        color: active ? C.teal : C.textPrimary,
        borderRadius: 16, cursor: "pointer", fontFamily: "inherit",
      }}>{children}</button>
  );
}

// ─── Inbound files panel ─────────────────────────────────────────────────
// Lives inside the CredentialManageModal once SFTP creds are configured and
// the profile has an inbound_directory. Lets admin:
//   - Configure per (plan, file_type) filename patterns
//   - Test that patterns match files on the plan SFTP (no download)
//   - Trigger a real poll (downloads matched files, stages in cm_inbound_files)
//   - See recent files received + last poll history

const FILE_TYPE_OPTIONS = [
  { value: "prl",                label: "Patient Risk List (PRL)" },
  { value: "member_assignment",  label: "Member Assignment (834 EDI)" },
  { value: "claims_encounter",   label: "Claims & Encounter Data" },
  { value: "pharmacy_lockin",    label: "Pharmacy Lock-in Members" },
  { value: "pharmacy_claims",    label: "Pharmacy Claims" },
  { value: "icns",               label: "Initial Care Needs Screening (ICNS)" },
];

const FILE_TYPE_LABEL = {};
for (const o of FILE_TYPE_OPTIONS) FILE_TYPE_LABEL[o.value] = o.label;

function InboundFilesPanel({ profile }) {
  const [configs, setConfigs]     = useState([]);
  const [files, setFiles]         = useState([]);
  const [polls, setPolls]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [editingConfig, setEditingConfig] = useState(null); // null | config row | {} for new
  const [testResult, setTestResult] = useState(null);
  const [pollResult, setPollResult] = useState(null);
  const [running, setRunning]     = useState(null); // null | 'test' | 'poll'

  const refresh = async () => {
    setLoading(true);
    try {
      const [cRes, fRes, pRes] = await Promise.all([
        supabase.from("cm_inbound_file_configs")
          .select("*")
          .eq("profile_id", profile.id)
          .order("file_type"),
        supabase.from("cm_inbound_files")
          .select("id, remote_filename, file_type, content_bytes, status, received_at, parsed_at, parse_error")
          .eq("profile_id", profile.id)
          .order("received_at", { ascending: false })
          .limit(20),
        supabase.from("cm_inbound_poll_attempts")
          .select("id, status, files_listed, files_matched, files_downloaded, files_duplicate, files_failed, duration_ms, attempted_at, error_message")
          .eq("profile_id", profile.id)
          .order("attempted_at", { ascending: false })
          .limit(10),
      ]);
      setConfigs(cRes.data || []);
      setFiles(fRes.data || []);
      setPolls(pRes.data || []);
    } catch (e) {
      console.error("InboundFilesPanel refresh failed:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, [profile.id]);

  const runTest = async () => {
    setRunning("test");
    setTestResult(null);
    setPollResult(null);
    try {
      const { data, error: invErr } = await supabase.functions.invoke("amh-inbound-test", {
        body: { profile_id: profile.id },
      });
      if (invErr) {
        let msg = invErr.message;
        try {
          const ctx = invErr.context;
          if (ctx && typeof ctx.text === "function") {
            const txt = await ctx.text();
            const parsed = JSON.parse(txt);
            if (parsed.error) msg = parsed.error;
          }
        } catch (_) {}
        setTestResult({ success: false, message: msg });
      } else if (data?.status === "success") {
        setTestResult({
          success: true,
          message: "Listed " + data.total_files + " files; " + (data.matches?.length || 0) + " matched, " + (data.unmatched_count || 0) + " unmatched.",
          matches: data.matches || [],
          unmatched: data.unmatched || [],
        });
      } else {
        setTestResult({ success: false, message: (data?.category || "Failed") + ": " + (data?.error || "Unknown") });
      }
    } catch (e) {
      setTestResult({ success: false, message: e.message || String(e) });
    } finally {
      setRunning(null);
    }
  };

  const runPoll = async () => {
    setRunning("poll");
    setTestResult(null);
    setPollResult(null);
    try {
      const { data, error: invErr } = await supabase.functions.invoke("amh-inbound-poll", {
        body: { profile_id: profile.id, triggered_via: "Manual" },
      });
      if (invErr) {
        let msg = invErr.message;
        try {
          const ctx = invErr.context;
          if (ctx && typeof ctx.text === "function") {
            const txt = await ctx.text();
            const parsed = JSON.parse(txt);
            if (parsed.error) msg = parsed.error;
          }
        } catch (_) {}
        setPollResult({ success: false, message: msg });
      } else if (data?.status === "success") {
        setPollResult({
          success: true,
          message: "Stored " + (data.files_stored || 0) + " new files; " + (data.files_duplicate || 0) + " duplicate, " + (data.files_failed || 0) + " failed.",
        });
        await refresh();
      } else {
        setPollResult({ success: false, message: (data?.poll_status || "Failed") + ": " + (data?.error || "Unknown") });
      }
    } catch (e) {
      setPollResult({ success: false, message: e.message || String(e) });
    } finally {
      setRunning(null);
    }
  };

  return (
    <div style={{ marginTop: 16, paddingTop: 12, borderTop: "0.5px solid " + C.borderLight }}>
      <SectionLabel>Inbound files</SectionLabel>
      <div style={{ fontSize: 11, color: C.textSecondary, marginBottom: 10, lineHeight: 1.55 }}>
        Configure which files this plan sends from <code style={{ fontFamily: "monospace" }}>{profile.inbound_directory}</code>. Patterns use glob syntax (<code style={{ fontFamily: "monospace" }}>*</code> matches anything).
      </div>

      {/* Configs list */}
      {loading ? (
        <div style={{ fontSize: 11, color: C.textTertiary, padding: 8 }}>Loading...</div>
      ) : configs.length === 0 ? (
        <div style={{ padding: "8px 12px", background: C.bgSecondary, borderRadius: 6, fontSize: 11, color: C.textSecondary, marginBottom: 8 }}>
          No file types configured yet. Click "+ Add file type" to register the first pattern.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
          {configs.map(c => (
            <div key={c.id} style={{
              display: "grid", gridTemplateColumns: "180px 1fr 90px 70px", gap: 8,
              padding: "6px 10px", border: "0.5px solid " + C.borderLight, borderRadius: 4,
              fontSize: 11, alignItems: "center",
            }}>
              <span style={{ fontWeight: 600 }}>{FILE_TYPE_LABEL[c.file_type] || c.file_type}</span>
              <code style={{ fontFamily: "monospace", color: C.textSecondary }}>{c.filename_pattern}</code>
              <span style={{ color: C.textTertiary }}>{c.expected_cadence || "—"}</span>
              <button onClick={() => setEditingConfig(c)}
                style={{ background: "none", border: "0.5px solid " + C.borderMid, borderRadius: 4, padding: "2px 8px", fontSize: 10, cursor: "pointer", color: C.textSecondary }}>
                Edit
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        <Btn variant="outline" size="sm" onClick={() => setEditingConfig({})}>+ Add file type</Btn>
        {configs.length > 0 && (
          <>
            <Btn variant="outline" size="sm" onClick={runTest} disabled={!!running}>
              {running === "test" ? "Testing..." : "Test patterns"}
            </Btn>
            <Btn size="sm" onClick={runPoll} disabled={!!running}>
              {running === "poll" ? "Polling..." : "Poll now"}
            </Btn>
          </>
        )}
      </div>

      {testResult && (
        <div style={{
          marginBottom: 8, padding: "8px 12px", borderRadius: 6, fontSize: 11,
          background: testResult.success ? C.tealBg : "#fef2f2",
          border: "0.5px solid " + (testResult.success ? C.tealBorder : C.red),
          color: testResult.success ? C.textPrimary : C.red,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{testResult.success ? "Test OK: " : "Test FAIL: "}{testResult.message}</div>
          {testResult.matches?.length > 0 && (
            <div style={{ marginTop: 4, fontSize: 10, color: C.textSecondary }}>
              Matched: {testResult.matches.map(m => m.filename).join(", ")}
            </div>
          )}
          {testResult.unmatched?.length > 0 && (
            <div style={{ marginTop: 2, fontSize: 10, color: C.textTertiary }}>
              Unmatched (sample): {testResult.unmatched.slice(0, 5).map(u => u.filename).join(", ")}
              {testResult.unmatched.length > 5 ? " ..." : ""}
            </div>
          )}
        </div>
      )}

      {pollResult && (
        <div style={{
          marginBottom: 8, padding: "8px 12px", borderRadius: 6, fontSize: 11,
          background: pollResult.success ? C.tealBg : "#fef2f2",
          border: "0.5px solid " + (pollResult.success ? C.tealBorder : C.red),
          color: pollResult.success ? C.textPrimary : C.red,
        }}>
          <div style={{ fontWeight: 600 }}>{pollResult.success ? "Poll OK: " : "Poll FAIL: "}{pollResult.message}</div>
        </div>
      )}

      {/* Recent files table */}
      {files.length > 0 && (
        <>
          <div style={{ fontSize: 10, color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600, marginTop: 12, marginBottom: 4 }}>
            Recent files received
          </div>
          <div style={{ maxHeight: 200, overflow: "auto", border: "0.5px solid " + C.borderLight, borderRadius: 4 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ background: C.bgSecondary, borderBottom: "0.5px solid " + C.borderLight }}>
                  <th style={{ textAlign: "left", padding: "6px 10px", fontWeight: 600, color: C.textSecondary, fontSize: 10 }}>FILENAME</th>
                  <th style={{ textAlign: "left", padding: "6px 10px", fontWeight: 600, color: C.textSecondary, fontSize: 10 }}>TYPE</th>
                  <th style={{ textAlign: "left", padding: "6px 10px", fontWeight: 600, color: C.textSecondary, fontSize: 10 }}>BYTES</th>
                  <th style={{ textAlign: "left", padding: "6px 10px", fontWeight: 600, color: C.textSecondary, fontSize: 10 }}>STATUS</th>
                  <th style={{ textAlign: "left", padding: "6px 10px", fontWeight: 600, color: C.textSecondary, fontSize: 10 }}>RECEIVED</th>
                </tr>
              </thead>
              <tbody>
                {files.map(f => (
                  <tr key={f.id} style={{ borderBottom: "0.5px solid " + C.borderLight }}>
                    <td style={{ padding: "6px 10px", fontFamily: "monospace", fontSize: 10 }}>{f.remote_filename}</td>
                    <td style={{ padding: "6px 10px" }}>{FILE_TYPE_LABEL[f.file_type] || f.file_type}</td>
                    <td style={{ padding: "6px 10px", color: C.textSecondary }}>{f.content_bytes}</td>
                    <td style={{ padding: "6px 10px" }}>
                      <Badge label={f.status} variant={f.status === "parsed" ? "green" : f.status === "failed" ? "red" : "neutral"} size="xs" />
                    </td>
                    <td style={{ padding: "6px 10px", color: C.textTertiary, fontSize: 10 }}>
                      {new Date(f.received_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {polls.length > 0 && (
        <>
          <div style={{ fontSize: 10, color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600, marginTop: 12, marginBottom: 4 }}>
            Recent polls
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 120, overflow: "auto" }}>
            {polls.map(p => (
              <div key={p.id} style={{
                display: "grid", gridTemplateColumns: "100px 70px 1fr 90px 100px", gap: 6,
                padding: "4px 8px", fontSize: 10, color: C.textSecondary,
                borderBottom: "0.5px solid " + C.borderLight,
              }}>
                <Badge label={p.status} variant={p.status === "Success" ? "green" : (p.status === "Partial" ? "amber" : "red")} size="xs" />
                <span>{p.duration_ms}ms</span>
                <span style={{ color: C.textTertiary }}>
                  {p.files_listed}L / {p.files_matched}M / {p.files_downloaded}D / {p.files_duplicate}=
                </span>
                <span style={{ color: p.files_failed > 0 ? C.red : C.textTertiary }}>
                  {p.files_failed > 0 ? p.files_failed + " failed" : ""}
                </span>
                <span style={{ color: C.textTertiary, fontSize: 9 }}>
                  {new Date(p.attempted_at).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {editingConfig !== null && (
        <InboundConfigEditModal
          config={editingConfig}
          profile={profile}
          existingTypes={new Set(configs.filter(c => c.id !== editingConfig.id).map(c => c.file_type))}
          onClose={() => setEditingConfig(null)}
          onSaved={() => { setEditingConfig(null); refresh(); }}
        />
      )}
    </div>
  );
}

// ─── Inbound config edit modal (nested inside Manage Credentials) ──────
function InboundConfigEditModal({ config, profile, existingTypes, onClose, onSaved }) {
  const isNew = !config.id;
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);
  const [deleting, setDeleting] = useState(false);

  const [form, setForm] = useState(() => ({
    file_type:        config.file_type || "",
    filename_pattern: config.filename_pattern || "",
    // pattern_type defaults to glob; regex available via SQL for power-user edge cases
    pattern_type:     config.pattern_type || "glob",
    expected_cadence: config.expected_cadence || "Monthly",
    active:           config.active !== false,
  }));

  const set = (patch) => setForm(prev => ({ ...prev, ...patch }));

  const validate = () => {
    if (!form.file_type) return "File type is required";
    if (isNew && existingTypes.has(form.file_type)) return "This file type is already configured for this plan. Edit the existing one instead.";
    if (!form.filename_pattern.trim()) return "Filename pattern is required";
    return null;
  };

  const save = async () => {
    const v = validate();
    if (v) { setError(v); return; }
    setError(null);
    setSaving(true);
    try {
      const payload = {
        practice_id: profile.practice_id,
        profile_id: profile.id,
        payer_short_name: profile.payer_short_name,
        file_type: form.file_type,
        filename_pattern: form.filename_pattern.trim(),
        pattern_type: form.pattern_type,
        expected_cadence: form.expected_cadence,
        active: form.active,
      };
      if (isNew) {
        const { error: insErr } = await supabase.from("cm_inbound_file_configs").insert(payload);
        if (insErr) throw insErr;
      } else {
        const { error: updErr } = await supabase.from("cm_inbound_file_configs")
          .update(payload).eq("id", config.id);
        if (updErr) throw updErr;
      }
      onSaved();
    } catch (e) {
      setError(e.message || "Save failed");
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm("Delete this file type config? Recent inbound files of this type will keep their existing classifications.")) return;
    setDeleting(true);
    try {
      const { error: delErr } = await supabase.from("cm_inbound_file_configs").delete().eq("id", config.id);
      if (delErr) throw delErr;
      onSaved();
    } catch (e) {
      setError(e.message || "Delete failed");
      setDeleting(false);
    }
  };

  return (
    <Modal title={isNew ? "Add inbound file type" : "Edit inbound file type"} onClose={onClose} maxWidth={520}>
      <div style={{ marginBottom: 12, fontSize: 11, color: C.textSecondary, lineHeight: 1.55 }}>
        Plans drop files in <code style={{ fontFamily: "monospace" }}>{profile.inbound_directory}</code> with predictable names that change each month - for example, <code style={{ fontFamily: "monospace" }}>AMH_834_20260428.txt</code> in April, <code style={{ fontFamily: "monospace" }}>AMH_834_20260528.txt</code> in May. Tell us the file type and the naming pattern, using <code style={{ fontFamily: "monospace" }}>*</code> as a wildcard for the parts that change. So <code style={{ fontFamily: "monospace" }}>AMH_834_*.txt</code> matches every monthly 834 file no matter the date.
      </div>

      <FL>File type *</FL>
      <select
        value={form.file_type}
        onChange={e => set({ file_type: e.target.value })}
        disabled={!isNew}
        style={{
          width: "100%", padding: "8px 10px",
          border: "0.5px solid " + C.borderMid, borderRadius: 4,
          fontSize: 13, fontFamily: "inherit",
          background: !isNew ? C.bgSecondary : "#fff",
          marginBottom: 10,
        }}
      >
        <option value="">Select a file type...</option>
        {FILE_TYPE_OPTIONS.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>

      <Input label="Filename pattern *" value={form.filename_pattern}
        onChange={v => set({ filename_pattern: v })}
        placeholder="AMH_834_*.txt" />

      <Select label="Expected cadence" value={form.expected_cadence}
        onChange={v => set({ expected_cadence: v })}
        options={CADENCE_OPTIONS} />

      <div style={{ marginTop: 10, marginBottom: 10 }}>
        <Checkbox checked={form.active} onChange={v => set({ active: v })}>
          Active (poll will match this pattern)
        </Checkbox>
      </div>

      {error && (
        <div style={{ marginTop: 8, padding: "8px 12px", background: "#fef2f2", border: "0.5px solid " + C.red, borderRadius: 6, fontSize: 12, color: C.red }}>
          {error}
        </div>
      )}

      <div style={{ marginTop: 16, paddingTop: 12, borderTop: "0.5px solid " + C.borderLight, display: "flex", gap: 8, justifyContent: "space-between" }}>
        {!isNew ? (
          <Btn variant="outline" size="sm" onClick={remove} disabled={saving || deleting}
            style={{ color: C.red, borderColor: C.red }}>
            {deleting ? "Deleting..." : "Delete"}
          </Btn>
        ) : <span />}
        <div style={{ display: "flex", gap: 8 }}>
          <Btn variant="outline" onClick={onClose} disabled={saving || deleting}>Cancel</Btn>
          <Btn onClick={save} disabled={saving || deleting}>{saving ? "Saving..." : (isNew ? "Add" : "Save")}</Btn>
        </div>
      </div>
    </Modal>
  );
}
