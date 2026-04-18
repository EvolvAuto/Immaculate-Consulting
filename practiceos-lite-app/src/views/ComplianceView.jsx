// ═══════════════════════════════════════════════════════════════════════════════
// ComplianceView — audit_log feed, BTG events, BAA tracker, revision history
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../auth/AuthProvider";
import { C } from "../lib/tokens";
import { updateRow } from "../lib/db";
import { toISODate } from "../components/constants";
import { Badge, Btn, Card, TopBar, TabBar, Modal, Input, Select, Textarea, FL, SectionHead, Loader, ErrorBanner, EmptyState } from "../components/ui";

const BAA_STATUS_VAR = { "Active": "green", "Expired": "red", "Pending Signature": "amber", "Terminated": "neutral" };
const ACTION_VAR = { "Create": "teal", "Read": "blue", "Update": "amber", "Delete": "red", "Break The Glass": "red", "Export": "purple", "Print": "neutral", "Login": "neutral", "Logout": "neutral", "Failed Login": "red" };

export default function ComplianceView() {
  const { practiceId } = useAuth();
  const [tab, setTab] = useState("audit");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [audit, setAudit] = useState([]);
  const [btg, setBtg] = useState([]);
  const [baa, setBaa] = useState([]);
  const [revisions, setRevisions] = useState([]);
  const [addingBaa, setAddingBaa] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      const [a, t, b, r] = await Promise.all([
        supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(200),
        supabase.from("break_the_glass_events").select("*, users!break_the_glass_events_user_id_fkey(full_name), patients(first_name, last_name)").order("started_at", { ascending: false }).limit(50),
        supabase.from("baa_records").select("*").order("expiration_date", { ascending: true, nullsFirst: false }),
        supabase.from("revision_history").select("*, users!revision_history_changed_by_fkey(full_name)").order("created_at", { ascending: false }).limit(50),
      ]);
      if (a.error) throw a.error;
      setAudit(a.data || []);
      setBtg(t.data || []);
      setBaa(b.data || []);
      setRevisions(r.data || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (practiceId) load(); }, [practiceId]);

  const reviewBtg = async (event, verdict) => {
    try {
      await updateRow("break_the_glass_events", event.id, {
        reviewed: true, reviewed_at: new Date().toISOString(), review_verdict: verdict,
      });
      load();
    } catch (e) { setError(e.message); }
  };

  if (loading) return <div style={{ flex: 1 }}><TopBar title="Compliance" /><Loader /></div>;

  const expiringBaa = baa.filter((b) => b.status === "Active" && b.expiration_date &&
    (new Date(b.expiration_date) - new Date()) < 60 * 24 * 60 * 60 * 1000).length;
  const pendingBtg = btg.filter((e) => !e.reviewed).length;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar title="Compliance" sub="HIPAA audit & governance"
        actions={<TabBar
          tabs={[
            ["audit", `Audit Log`],
            ["btg", `BTG (${pendingBtg})`],
            ["baa", `BAA${expiringBaa ? ` (${expiringBaa}⚠)` : ""}`],
            ["revisions", `Revisions`],
          ]}
          active={tab} onChange={setTab} />} />

      <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
        {error && <ErrorBanner message={error} />}

        {tab === "audit" && (
          audit.length === 0 ? <EmptyState icon="🔒" title="No audit entries yet" />
          : <Card style={{ padding: 0, overflow: "hidden", maxWidth: 1200, margin: "0 auto" }}>
            <div style={{ display: "grid", gridTemplateColumns: "180px 140px 100px 140px 1fr 80px", padding: "10px 14px", fontSize: 10, fontWeight: 700, color: C.textSecondary, textTransform: "uppercase", letterSpacing: "0.05em", background: C.bgSecondary, borderBottom: `0.5px solid ${C.borderLight}` }}>
              <div>When</div><div>User</div><div>Role</div><div>Action</div><div>Entity</div><div>Status</div>
            </div>
            {audit.map((a) => (
              <div key={a.id} style={{ display: "grid", gridTemplateColumns: "180px 140px 100px 140px 1fr 80px", padding: "8px 14px", fontSize: 11, borderBottom: `0.5px solid ${C.borderLight}`, alignItems: "center" }}>
                <div style={{ color: C.textSecondary, fontFamily: "monospace", fontSize: 10 }}>{new Date(a.created_at).toLocaleString()}</div>
                <div style={{ color: C.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.user_email || "—"}</div>
                <div style={{ color: C.textSecondary }}>{a.user_role || "—"}</div>
                <Badge label={a.action} variant={ACTION_VAR[a.action] || "neutral"} size="xs" />
                <div style={{ color: C.textSecondary, fontFamily: "monospace", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {a.entity_type}{a.entity_id ? ` ${a.entity_id.slice(0, 8)}` : ""}
                </div>
                {a.success ? <Badge label="OK" variant="green" size="xs" /> : <Badge label="FAIL" variant="red" size="xs" />}
              </div>
            ))}
          </Card>
        )}

        {tab === "btg" && (
          btg.length === 0 ? <EmptyState icon="🔓" title="No BTG events" sub="Break-the-glass events are logged when users access charts outside their normal scope." />
          : <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 900, margin: "0 auto" }}>
            {btg.map((e) => (
              <Card key={e.id} style={{ padding: 14, borderLeft: e.reviewed ? `3px solid ${C.textTertiary}` : `3px solid ${C.red}` }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <Badge label="BREAK THE GLASS" variant="red" size="xs" />
                      <Badge label={e.reason_category} variant="neutral" size="xs" />
                      {e.reviewed ? <Badge label={`Reviewed: ${e.review_verdict || "—"}`} variant="neutral" size="xs" /> : <Badge label="Pending Review" variant="amber" size="xs" />}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>
                      {e.users?.full_name || "Unknown user"} accessed {e.patients ? `${e.patients.first_name} ${e.patients.last_name}` : "—"}
                    </div>
                    <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 4 }}>Reason: <i>{e.reason}</i></div>
                    <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 4 }}>
                      Started: {new Date(e.started_at).toLocaleString()}
                      {e.expires_at && ` · Expires: ${new Date(e.expires_at).toLocaleString()}`}
                    </div>
                  </div>
                  {!e.reviewed && <div style={{ display: "flex", gap: 4 }}>
                    <Btn size="sm" variant="outline" onClick={() => reviewBtg(e, "Justified")}>Justified</Btn>
                    <Btn size="sm" variant="danger" onClick={() => reviewBtg(e, "Unjustified")}>Flag</Btn>
                  </div>}
                </div>
              </Card>
            ))}
          </div>
        )}

        {tab === "baa" && (
          <>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12, maxWidth: 900, margin: "0 auto 12px" }}>
              <Btn size="sm" onClick={() => setAddingBaa(true)}>+ Add BAA</Btn>
            </div>
            {baa.length === 0 ? <EmptyState icon="📋" title="No BAAs on file" sub="Track Business Associate Agreements with all vendors who handle PHI." />
              : <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 900, margin: "0 auto" }}>
                {baa.map((b) => {
                  const daysLeft = b.expiration_date ? Math.ceil((new Date(b.expiration_date) - new Date()) / (24 * 60 * 60 * 1000)) : null;
                  const expiringSoon = daysLeft != null && daysLeft < 60 && daysLeft > 0;
                  return (
                    <Card key={b.id} style={{ padding: 14 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                            <div style={{ fontSize: 14, fontWeight: 700 }}>{b.vendor_name}</div>
                            <Badge label={b.status} variant={BAA_STATUS_VAR[b.status]} size="xs" />
                            {expiringSoon && <Badge label={`Expires in ${daysLeft}d`} variant="amber" size="xs" />}
                          </div>
                          <div style={{ fontSize: 12, color: C.textSecondary }}>{b.service_description || "—"}</div>
                          <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 4 }}>
                            {b.signed_date && `Signed ${b.signed_date}`}
                            {b.effective_date && ` · Effective ${b.effective_date}`}
                            {b.expiration_date && ` · Expires ${b.expiration_date}`}
                            {b.auto_renew && " · Auto-renews"}
                          </div>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            }
          </>
        )}

        {tab === "revisions" && (
          revisions.length === 0 ? <EmptyState icon="📝" title="No revisions" sub="Amendments to signed encounters will appear here." />
          : <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 900, margin: "0 auto" }}>
            {revisions.map((r) => (
              <Card key={r.id} style={{ padding: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <Badge label={`Rev ${r.revision_number}`} variant="amber" size="xs" />
                  <div style={{ fontSize: 12, fontFamily: "monospace", color: C.textSecondary }}>{r.entity_type} {r.entity_id.slice(0, 8)}</div>
                  <div style={{ marginLeft: "auto", fontSize: 11, color: C.textTertiary }}>{new Date(r.created_at).toLocaleString()}</div>
                </div>
                <div style={{ fontSize: 12, color: C.textPrimary }}>{r.users?.full_name || "Unknown"}: {r.change_reason || "(no reason given)"}</div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {addingBaa && <BaaForm practiceId={practiceId} onClose={() => setAddingBaa(false)} onAdded={() => { setAddingBaa(false); load(); }} />}
    </div>
  );
}

function BaaForm({ onClose, onAdded, practiceId }) {
  const [f, setF] = useState({ vendor_name: "", service_description: "", status: "Pending Signature", signed_date: "", effective_date: "", expiration_date: "", auto_renew: false });
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const save = async () => {
    if (!f.vendor_name.trim()) return;
    try {
      await supabase.from("baa_records").insert({
        practice_id: practiceId,
        vendor_name: f.vendor_name,
        service_description: f.service_description || null,
        status: f.status,
        signed_date: f.signed_date || null,
        effective_date: f.effective_date || null,
        expiration_date: f.expiration_date || null,
        auto_renew: f.auto_renew,
      });
      onAdded();
    } catch (e) { alert(e.message); }
  };
  return (
    <Modal title="Add BAA Record" onClose={onClose} maxWidth={520}>
      <Input label="Vendor Name *" value={f.vendor_name} onChange={set("vendor_name")} />
      <Textarea label="Service Description" value={f.service_description} onChange={set("service_description")} rows={2} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Select label="Status" value={f.status} onChange={set("status")} options={["Active", "Expired", "Pending Signature", "Terminated"]} />
        <Input label="Signed Date" type="date" value={f.signed_date} onChange={set("signed_date")} />
        <Input label="Effective Date" type="date" value={f.effective_date} onChange={set("effective_date")} />
        <Input label="Expiration Date" type="date" value={f.expiration_date} onChange={set("expiration_date")} />
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        <Btn onClick={save}>Save BAA</Btn>
      </div>
    </Modal>
  );
}
