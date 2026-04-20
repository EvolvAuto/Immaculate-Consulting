// ═══════════════════════════════════════════════════════════════════════════════
// AssistantView — Pro AI Practice Assistant.
// Left: conversation list. Right: chat view with input + structured results.
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { C } from "../../lib/tokens";
import { Btn, Card, Loader, ErrorBanner, EmptyState, Modal, Input, Select, TopBar } from "../../components/ui";
import ProGate from "../../components/pro/ProGate";
import ProUsageMeter from "../../components/pro/ProUsageMeter";
import {
  proApi,
  listConversations,
  fetchConversation,
  archiveConversation,
  renameConversation,
} from "../../lib/proApi";

const SUGGESTED_PROMPTS = [
  "Who's overdue for an A1C check in the last 180 days?",
  "Show me patients who haven't been contacted in 60 days",
  "Which appointments tomorrow are still unconfirmed?",
  "Who no-showed in the last 7 days?",
  "Find patients overdue for their annual exam",
  "Show pending refill requests",
];

export default function AssistantView() {
  return (
    <ProGate feature="AI Practice Assistant">
      <AssistantInner />
    </ProGate>
  );
}

function AssistantInner() {
  const { practiceId } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [active, setActive] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [usageKey, setUsageKey] = useState(0);

  const loadConversations = async () => {
    try {
      const rows = await listConversations();
      setConversations(rows);
    } catch (e) { setError(e.message); }
  };

  useEffect(() => { if (practiceId) loadConversations(); }, [practiceId]);

  const loadActive = async (id) => {
    if (!id) { setActive(null); return; }
    try {
      setLoading(true); setError(null);
      const full = await fetchConversation(id);
      setActive(full);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadActive(activeId); }, [activeId]);

  const startNew = () => { setActiveId(null); setActive(null); };

  const handleSend = async (text) => {
    if (!text || !text.trim()) return;
    try {
      setLoading(true); setError(null);
      const res = await proApi.assistantQuery({ query: text.trim(), conversationId: activeId });
      if (res.error && !res.conversationId) { setError(res.error); return; }
      const nextId = res.conversationId;
      setActiveId(nextId);
      // Force reload of this conversation (optimistic UI skipped for simplicity)
      await loadActive(nextId);
      await loadConversations();
      setUsageKey((k) => k + 1);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopBar
        title="AI Practice Assistant"
        sub="Ask questions about your practice in plain English"
        actions={<ProUsageMeter refreshKey={usageKey} />}
      />
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <ConvoSidebar
          conversations={conversations}
          activeId={activeId}
          onPick={setActiveId}
          onNew={startNew}
          onReload={loadConversations}
        />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {error && <ErrorBanner message={error} />}
          {loading && !active ? (
            <Loader />
          ) : !activeId ? (
            <NewConvoPlaceholder onSuggestion={handleSend} disabled={loading} />
          ) : (
            <ConversationPane
              data={active}
              onSendFollowup={handleSend}
              onOutreachGenerated={async () => { await loadActive(activeId); setUsageKey((k) => k + 1); }}
              loading={loading}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Conversation list sidebar ────────────────────────────────────────────────
function ConvoSidebar({ conversations, activeId, onPick, onNew, onReload }) {
  const [menuForId, setMenuForId] = useState(null);
  const [renaming, setRenaming] = useState(null);

  const handleRename = async (id, newTitle) => {
    try {
      await renameConversation(id, newTitle);
      setRenaming(null);
      setMenuForId(null);
      onReload();
    } catch (e) { alert(e.message); }
  };

  const handleArchive = async (id) => {
    if (!confirm("Archive this conversation? You can still see it in archived list.")) return;
    try {
      await archiveConversation(id);
      setMenuForId(null);
      onReload();
      if (activeId === id) onPick(null);
    } catch (e) { alert(e.message); }
  };

  return (
    <div style={{
      width: 260,
      borderRight: "0.5px solid " + C.borderLight,
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    }}>
      <div style={{ padding: 12, borderBottom: "0.5px solid " + C.borderLight }}>
        <Btn size="sm" onClick={onNew} style={{ width: "100%" }}>+ New conversation</Btn>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {conversations.length === 0 && (
          <div style={{ padding: 16, fontSize: 12, color: C.textTertiary, textAlign: "center" }}>
            No conversations yet. Start by asking a question.
          </div>
        )}
        {conversations.map((c) => (
          <div
            key={c.id}
            onClick={() => onPick(c.id)}
            style={{
              padding: "10px 12px",
              cursor: "pointer",
              background: c.id === activeId ? C.tealBg || "#E6F4EF" : "transparent",
              borderLeft: c.id === activeId ? "3px solid " + (C.teal || "#1D9E75") : "3px solid transparent",
              position: "relative",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 500, color: C.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {c.title}
            </div>
            <div style={{ fontSize: 10, color: C.textTertiary, marginTop: 2 }}>
              {c.last_message_at ? new Date(c.last_message_at).toLocaleString() : "Not yet sent"}
            </div>
            <div
              onClick={(e) => { e.stopPropagation(); setMenuForId(menuForId === c.id ? null : c.id); }}
              style={{ position: "absolute", top: 8, right: 8, fontSize: 16, color: C.textTertiary, cursor: "pointer", padding: 2 }}
              title="More"
            >⋯</div>
            {menuForId === c.id && (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: "absolute", top: 28, right: 8, zIndex: 5,
                  background: "#fff", border: "0.5px solid " + C.borderLight, borderRadius: 6,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.08)", padding: 4, minWidth: 120,
                }}
              >
                <div style={{ padding: "6px 10px", fontSize: 12, cursor: "pointer", color: C.textPrimary }}
                  onClick={() => { setRenaming(c); setMenuForId(null); }}>
                  Rename
                </div>
                <div style={{ padding: "6px 10px", fontSize: 12, cursor: "pointer", color: "#DC2626" }}
                  onClick={() => handleArchive(c.id)}>
                  Archive
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {renaming && (
        <RenameModal
          initial={renaming.title}
          onClose={() => setRenaming(null)}
          onSave={(t) => handleRename(renaming.id, t)}
        />
      )}
    </div>
  );
}

function RenameModal({ initial, onClose, onSave }) {
  const [t, setT] = useState(initial || "");
  return (
    <Modal title="Rename conversation" onClose={onClose}>
      <Input label="Title" value={t} onChange={setT} />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
        <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
        <Btn onClick={() => onSave(t.trim() || "Untitled")}>Save</Btn>
      </div>
    </Modal>
  );
}

// ─── Placeholder when no conversation selected ───────────────────────────────
function NewConvoPlaceholder({ onSuggestion, disabled }) {
  const [text, setText] = useState("");
  return (
    <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <Card>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.textPrimary, marginBottom: 8 }}>
            What would you like to know?
          </div>
          <div style={{ fontSize: 13, color: C.textSecondary, marginBottom: 14 }}>
            Ask about your patients, upcoming appointments, overdue measurements, or anything else in your practice data. I'll search for you.
          </div>
          <Composer
            value={text}
            onChange={setText}
            onSubmit={() => { const v = text.trim(); if (v) { setText(""); onSuggestion(v); } }}
            disabled={disabled}
            placeholder="e.g., Who's overdue for an A1C check?"
          />
        </Card>

        <div style={{ marginTop: 20, fontSize: 12, color: C.textTertiary, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase" }}>
          Suggested questions
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
          {SUGGESTED_PROMPTS.map((p) => (
            <div
              key={p}
              onClick={() => { if (!disabled) onSuggestion(p); }}
              style={{
                padding: 12,
                border: "0.5px solid " + C.borderLight,
                borderRadius: 8,
                fontSize: 13,
                color: C.textPrimary,
                cursor: disabled ? "not-allowed" : "pointer",
                background: "#fff",
                opacity: disabled ? 0.5 : 1,
              }}
            >{p}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Conversation pane ─────────────────────────────────────────────────────
function ConversationPane({ data, onSendFollowup, onOutreachGenerated, loading }) {
  const [text, setText] = useState("");
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [data, loading]);

  if (!data) return <Loader />;
  const { conversation, messages } = data;

  return (
    <>
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 24 }}>
        <div style={{ maxWidth: 820, margin: "0 auto" }}>
          <div style={{ fontSize: 11, color: C.textTertiary, textAlign: "center", marginBottom: 20 }}>
            {conversation.title}
          </div>
          {messages.map((m) => <MessageBubble key={m.id} msg={m} onOutreachGenerated={onOutreachGenerated} />)}
          {loading && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.textTertiary, fontSize: 12, padding: 12 }}>
              <Loader small /> Thinking...
            </div>
          )}
        </div>
      </div>
      <div style={{ borderTop: "0.5px solid " + C.borderLight, padding: 12, background: "#fff" }}>
        <div style={{ maxWidth: 820, margin: "0 auto" }}>
          <Composer
            value={text}
            onChange={setText}
            onSubmit={() => { const v = text.trim(); if (v) { setText(""); onSendFollowup(v); } }}
            disabled={loading}
            placeholder="Ask a follow-up question..."
          />
        </div>
      </div>
    </>
  );
}

function Composer({ value, onChange, onSubmit, disabled, placeholder }) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        rows={2}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit(); }
        }}
        style={{
          flex: 1,
          padding: 10,
          border: "0.5px solid " + C.borderLight,
          borderRadius: 6,
          fontSize: 13,
          fontFamily: "inherit",
          color: C.textPrimary,
          resize: "none",
          outline: "none",
        }}
      />
      <Btn onClick={onSubmit} disabled={disabled || !value.trim()}>Send</Btn>
    </div>
  );
}

// ─── Single message bubble ─────────────────────────────────────────────────
function MessageBubble({ msg, onOutreachGenerated }) {
  if (msg.role === "user") {
    return (
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <div style={{
          maxWidth: "80%",
          padding: "10px 14px",
          background: C.teal || "#1D9E75",
          color: "#fff",
          borderRadius: 12,
          borderBottomRightRadius: 2,
          fontSize: 13,
          lineHeight: 1.45,
        }}>
          {msg.content}
        </div>
      </div>
    );
  }

  // Assistant
  const qs = msg.query_spec || {};
  const results = (msg.result_data && msg.result_data.results) ? msg.result_data.results : [];
  const followupOffer = qs.followup_offer || "none";

  return (
    <div style={{ display: "flex", marginBottom: 16 }}>
      <div style={{ maxWidth: "95%", width: "100%" }}>
        {msg.error_message && (
          <div style={{ fontSize: 12, color: "#DC2626", marginBottom: 6 }}>
            {msg.error_message}
          </div>
        )}
        <div style={{
          padding: "10px 14px",
          background: "#F7F9FB",
          border: "0.5px solid " + C.borderLight,
          borderRadius: 12,
          borderBottomLeftRadius: 2,
          fontSize: 13,
          color: C.textPrimary,
          lineHeight: 1.5,
        }}>
          {msg.content || "(no response text)"}
        </div>

        {results.length > 0 && (
          <div style={{ marginTop: 10, marginLeft: 4 }}>
            <ResultTable results={results} intent={qs.intent} />
            {followupOffer === "draft_outreach" && (
              <DraftOutreachAction
                assistantMessageId={msg.id}
                patientCount={results.filter((r) => r.patient_id).length}
                onGenerated={onOutreachGenerated}
              />
            )}
          </div>
        )}
        {results.length === 0 && msg.result_count !== null && msg.result_count !== undefined && !msg.error_message && (
          <div style={{ marginTop: 8, fontSize: 12, color: C.textTertiary, marginLeft: 4 }}>
            No matching records.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Result table ──────────────────────────────────────────────────────────
function ResultTable({ results, intent }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? results : results.slice(0, 8);

  // Column set based on intent
  const cols = columnsForIntent(intent, results[0] || {});

  return (
    <div style={{
      border: "0.5px solid " + C.borderLight,
      borderRadius: 8,
      overflow: "hidden",
      background: "#fff",
    }}>
      <div style={{ padding: "8px 12px", fontSize: 11, color: C.textTertiary, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase", borderBottom: "0.5px solid " + C.borderLight }}>
        {results.length} result{results.length === 1 ? "" : "s"}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#FAFBFC" }}>
              {cols.map((c) => (
                <th key={c.key} style={{
                  textAlign: "left", padding: "8px 10px",
                  fontSize: 11, fontWeight: 600, color: C.textSecondary,
                  borderBottom: "0.5px solid " + C.borderLight,
                }}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i} style={{ borderBottom: i < shown.length - 1 ? "0.5px solid " + C.borderLight : "none" }}>
                {cols.map((c) => (
                  <td key={c.key} style={{ padding: "8px 10px", color: C.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 220 }}>
                    {c.render ? c.render(r) : (r[c.key] !== null && r[c.key] !== undefined ? String(r[c.key]) : "-")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {results.length > 8 && (
        <div
          onClick={() => setShowAll((v) => !v)}
          style={{ padding: "8px 12px", fontSize: 12, color: C.teal || "#1D9E75", cursor: "pointer", borderTop: "0.5px solid " + C.borderLight, textAlign: "center" }}
        >
          {showAll ? "Show less" : "Show all " + results.length + " results"}
        </div>
      )}
    </div>
  );
}

function columnsForIntent(intent, sample) {
  const has = (k) => sample && Object.prototype.hasOwnProperty.call(sample, k);
  if (has("mrn") && has("name") && has("phone")) {
    const cols = [
      { key: "name",  label: "Patient" },
      { key: "mrn",   label: "MRN" },
      { key: "phone", label: "Phone" },
    ];
    if (has("dob")) cols.push({ key: "dob", label: "DOB" });
    if (has("last_measurement_at")) cols.push({
      key: "last_measurement_at", label: "Last Measured",
      render: (r) => r.last_measurement_at ? new Date(r.last_measurement_at).toLocaleDateString() : "Never",
    });
    if (has("last_annual")) cols.push({
      key: "last_annual", label: "Last Annual",
      render: (r) => r.last_annual ? new Date(r.last_annual).toLocaleDateString() : "None",
    });
    if (has("appt_date")) cols.push({ key: "appt_date", label: "Date" });
    if (has("appt_type")) cols.push({ key: "appt_type", label: "Type" });
    if (has("sms_opt_out")) cols.push({
      key: "sms_opt_out", label: "SMS",
      render: (r) => r.sms_opt_out ? "Opt-out" : "OK",
    });
    return cols;
  }
  // Fallback: first 5 scalar keys
  if (!sample) return [];
  const keys = Object.keys(sample).filter((k) => {
    const v = sample[k];
    return v === null || typeof v !== "object";
  }).slice(0, 6);
  return keys.map((k) => ({ key: k, label: k.replace(/_/g, " ") }));
}

// ─── Draft outreach action ─────────────────────────────────────────────────
function DraftOutreachAction({ assistantMessageId, patientCount, onGenerated }) {
  const [open, setOpen] = useState(false);
  const [tone, setTone] = useState("warm");
  const [channel, setChannel] = useState("SMS");
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState(null);
  const [result, setResult] = useState(null);

  const run = async () => {
    try {
      setRunning(true); setErr(null);
      const res = await proApi.outreachGenerate({ assistantMessageId, channel, tone, max_patients: 100 });
      setResult(res);
      onGenerated && onGenerated();
    } catch (e) { setErr(e.message); }
    finally { setRunning(false); }
  };

  return (
    <>
      <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
        <Btn size="sm" onClick={() => setOpen(true)} disabled={patientCount === 0}>
          Draft outreach for {patientCount} patient{patientCount === 1 ? "" : "s"}
        </Btn>
      </div>

      {open && (
        <Modal title="Draft outreach" onClose={() => { setOpen(false); setResult(null); setErr(null); }}>
          {!result ? (
            <>
              <div style={{ fontSize: 13, color: C.textSecondary, marginBottom: 12 }}>
                I'll generate one SMS template from the list of {patientCount} patients, then expand it for each patient. Staff must approve each draft before sending. No messages are sent yet.
              </div>
              <Select
                label="Channel"
                value={channel}
                onChange={setChannel}
                options={[{ value: "SMS", label: "SMS" }]}
              />
              <Select
                label="Tone"
                value={tone}
                onChange={setTone}
                options={[
                  { value: "warm",     label: "Warm (default)" },
                  { value: "clinical", label: "Clinical" },
                  { value: "urgent",   label: "Urgent" },
                ]}
              />
              {err && <div style={{ fontSize: 12, color: "#DC2626", marginTop: 8 }}>{err}</div>}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
                <Btn variant="secondary" onClick={() => setOpen(false)}>Cancel</Btn>
                <Btn onClick={run} disabled={running}>{running ? "Drafting..." : "Draft " + patientCount + " messages"}</Btn>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 13, color: C.textPrimary, marginBottom: 8 }}>
                {result.totalDrafts} draft{result.totalDrafts === 1 ? "" : "s"} ready for review.
              </div>
              <Card style={{ padding: 12, background: "#FAFBFC" }}>
                <div style={{ fontSize: 11, color: C.textTertiary, fontWeight: 600, marginBottom: 4 }}>TEMPLATE</div>
                <div style={{ fontSize: 13, color: C.textPrimary, fontFamily: "ui-monospace, monospace" }}>
                  {result.template}
                </div>
              </Card>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
                <Btn variant="secondary" onClick={() => { setOpen(false); setResult(null); }}>Close</Btn>
                <Btn onClick={() => { window.location.hash = "#/pro/outreach/" + result.batchId; setOpen(false); }}>
                  Review and send
                </Btn>
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
