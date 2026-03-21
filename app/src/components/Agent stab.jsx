// ═══════════════════════════════════════════════════════════════════════
// AgentsTab.jsx  —  IC-BOS Phase 6 Task 6
// Command Center: Agent Status Board + Activity Feed + Recording Upload
// All data is mock until Phase 6 live-wiring step (second-to-last task)
// ═══════════════════════════════════════════════════════════════════════

import { useState, useRef, useCallback } from "react";

const M = "var(--mono)";

// ─── Mock Data ───────────────────────────────────────────────────────
// Mock agent definitions with status, last run, and result summaries.
// These will be replaced by live agent_activity Supabase queries later.
const MOCK_AGENTS = [
  {
    id: 1,
    name: "Proposal Generator",
    shortName: "Proposals",
    icon: "📄",
    trigger: "on-demand",
    description: "Generates scoped proposals from deal data + discovery notes",
    status: "idle",         // idle | running | done | error
    lastRun: "2 hours ago",
    lastResult: "Generated proposal for Sunrise Family Medicine ($6,500/mo)",
    runtime: "~12s",
    tab: "pipeline",
  },
  {
    id: 2,
    name: "Discovery Analyzer",
    shortName: "Discovery",
    icon: "🔍",
    trigger: "on-demand",
    description: "Scores discovery calls and extracts pain points from transcripts",
    status: "done",
    lastRun: "1 hour ago",
    lastResult: "Chapel Hill Family Med call scored 78/100 — 3 pain points extracted",
    runtime: "~18s",
    tab: "salesprep",
  },
  {
    id: 3,
    name: "Onboarding Orchestrator",
    shortName: "Onboarding",
    icon: "🚀",
    trigger: "on-demand",
    description: "Builds full onboarding plans + task lists for new Closed Won clients",
    status: "idle",
    lastRun: "3 days ago",
    lastResult: "Generated 22-task onboarding plan for Coastal Dermatology",
    runtime: "~20s",
    tab: "onboarding",
  },
  {
    id: 4,
    name: "Weekly Digest",
    shortName: "Digest",
    icon: "📊",
    trigger: "scheduled",
    description: "Generates weekly narrative digest with priorities and trends",
    status: "idle",
    lastRun: "Monday 7am",
    lastResult: "Week of Mar 17 digest delivered — 3 priority actions surfaced",
    runtime: "~15s",
    tab: "report",
  },
  {
    id: 5,
    name: "Client Success Analyst",
    shortName: "CS Analyst",
    icon: "❤️",
    trigger: "on-demand",
    description: "Analyzes client health trends and flags churn risk early",
    status: "idle",
    lastRun: "Yesterday",
    lastResult: "Chapel Hill flagged at moderate churn risk — renewal in 4 months",
    runtime: "~10s",
    tab: "clients",
  },
  {
    id: 6,
    name: "Renewal Risk Predictor",
    shortName: "Renewals",
    icon: "🔮",
    trigger: "scheduled",
    description: "Scores renewal probability and drafts retention talking points",
    status: "idle",
    lastRun: "2 days ago",
    lastResult: "Fayetteville Urgent Care renewal score: 88/100 — low risk",
    runtime: "~12s",
    tab: "renewals",
  },
  {
    id: 7,
    name: "Outreach Personalizer",
    shortName: "Outreach",
    icon: "✉️",
    trigger: "on-demand",
    description: "Drafts personalized cold outreach emails from deal context",
    status: "idle",
    lastRun: "4 days ago",
    lastResult: "Drafted outreach for Durham Community Health — focus: Medicaid no-show ROI",
    runtime: "~8s",
    tab: "pipeline",
  },
  {
    id: 8,
    name: "Collections Assistant",
    shortName: "Collections",
    icon: "💰",
    trigger: "scheduled",
    description: "Drafts escalating follow-ups for overdue invoices and flags AR risk",
    status: "error",
    lastRun: "Today 6am",
    lastResult: "Error: Invoice table query timed out — retrying at next schedule",
    runtime: "~15s",
    tab: "invoicing",
  },
  {
    id: 9,
    name: "Competitive Intel",
    shortName: "Intel",
    icon: "🧠",
    trigger: "on-demand",
    description: "Researches prospect pain points and surfaces IC talking points",
    status: "idle",
    lastRun: "5 days ago",
    lastResult: "Research notes updated for Blue Ridge Ortho — NextGen pain points added",
    runtime: "~20s",
    tab: "pipeline",
  },
];

// Mock activity feed — will be replaced by live agent_activity table query
const MOCK_ACTIVITY = [
  {
    id: "a1",
    agentName: "Proposal Generator",
    agentIcon: "📄",
    action: "created proposal",
    targetLabel: "Sunrise Family Medicine",
    targetType: "deal",
    resultSummary: "Tier 2 · $6,500/mo · 3 automations scoped",
    status: "done",
    timestamp: "4 min ago",
    tab: "pipeline",
  },
  {
    id: "a2",
    agentName: "Discovery Analyzer",
    agentIcon: "🔍",
    action: "scored discovery call",
    targetLabel: "Chapel Hill Family Med",
    targetType: "client",
    resultSummary: "Score: 78/100 · Pain points: insurance lag, no-show rates, staff burnout",
    status: "done",
    timestamp: "1 hour ago",
    tab: "salesprep",
  },
  {
    id: "a3",
    agentName: "Collections Assistant",
    agentIcon: "💰",
    action: "failed to process",
    targetLabel: "INV-2026-021 (Fayetteville Urgent Care)",
    targetType: "invoice",
    resultSummary: "Query timeout — retrying at next scheduled run",
    status: "error",
    timestamp: "2 hours ago",
    tab: "invoicing",
  },
  {
    id: "a4",
    agentName: "Client Success Analyst",
    agentIcon: "❤️",
    action: "analyzed health",
    targetLabel: "Chapel Hill Family Med",
    targetType: "client",
    resultSummary: "Moderate churn risk detected · Recommend proactive check-in this week",
    status: "done",
    timestamp: "Yesterday",
    tab: "clients",
  },
  {
    id: "a5",
    agentName: "Weekly Digest",
    agentIcon: "📊",
    action: "generated digest",
    targetLabel: "Week of Mar 17",
    targetType: "report",
    resultSummary: "3 priority actions · 1 at-risk client · $45K pipeline needs follow-up",
    status: "done",
    timestamp: "Monday 7am",
    tab: "report",
  },
  {
    id: "a6",
    agentName: "Renewal Risk Predictor",
    agentIcon: "🔮",
    action: "scored renewal probability",
    targetLabel: "Fayetteville Urgent Care",
    targetType: "client",
    resultSummary: "Renewal score: 88/100 · Draft retention talking points generated",
    status: "done",
    timestamp: "2 days ago",
    tab: "renewals",
  },
  {
    id: "a7",
    agentName: "Onboarding Orchestrator",
    agentIcon: "🚀",
    action: "generated onboarding plan",
    targetLabel: "Coastal Dermatology",
    targetType: "client",
    resultSummary: "22 tasks across 5 phases · Kickoff email drafted",
    status: "done",
    timestamp: "3 days ago",
    tab: "onboarding",
  },
  {
    id: "a8",
    agentName: "Outreach Personalizer",
    agentIcon: "✉️",
    action: "drafted outreach",
    targetLabel: "Durham Community Health",
    targetType: "deal",
    resultSummary: "Focus angle: Medicaid no-show ROI at $28% baseline · Subject line included",
    status: "done",
    timestamp: "4 days ago",
    tab: "pipeline",
  },
];

// Meeting types for recording upload selector
const MEETING_TYPES = [
  { value: "discovery", label: "Discovery Call", agent: "Discovery Analyzer" },
  { value: "checkin", label: "Client Check-in", agent: "CS Analyst" },
  { value: "renewal", label: "Renewal Conversation", agent: "Renewal Risk Predictor" },
  { value: "followup", label: "Follow-up Call", agent: "Discovery Analyzer" },
];

// Accepted file types
const AUDIO_TYPES = ["audio/mpeg", "audio/mp4", "audio/wav", "audio/x-wav", "audio/m4a", "audio/x-m4a"];
const TEXT_TYPES = ["text/plain", "application/pdf"];
const ACCEPT_EXTS = ".mp3,.m4a,.wav,.txt,.pdf";

// ─── Status helpers ──────────────────────────────────────────────────
function statusDot(status) {
  // Returns animated dot style based on agent status
  const base = { width: 8, height: 8, borderRadius: "50%", flexShrink: 0, display: "inline-block" };
  if (status === "running")
    return (
      <span style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center", width: 14, height: 14, flexShrink: 0 }}>
        <span style={{ ...base, width: 8, height: 8, background: "#38bdf8", position: "absolute" }} />
        <span style={{ width: 14, height: 14, borderRadius: "50%", background: "rgba(56,189,248,0.25)", position: "absolute", animation: "pr 1.4s ease-out infinite" }} />
      </span>
    );
  const colors = { idle: "#4b5563", done: "#4ade80", error: "#f87171" };
  return <span style={{ ...base, background: colors[status] || "#4b5563", flexShrink: 0 }} />;
}

function StatusBadge({ status }) {
  const cfg = {
    idle:    { bg: "rgba(75,85,99,0.15)",    border: "rgba(75,85,99,0.25)",    color: "#6b7280", label: "Idle" },
    running: { bg: "rgba(56,189,248,0.10)",  border: "rgba(56,189,248,0.25)",  color: "#38bdf8", label: "Running" },
    done:    { bg: "rgba(74,222,128,0.08)",  border: "rgba(74,222,128,0.18)",  color: "#4ade80", label: "Done" },
    error:   { bg: "rgba(248,113,113,0.08)", border: "rgba(248,113,113,0.18)", color: "#f87171", label: "Error" },
  };
  const s = cfg[status] || cfg.idle;
  return (
    <span style={{ fontSize: 9, fontWeight: 700, color: s.color, background: s.bg, border: `1px solid ${s.border}`, borderRadius: 4, padding: "2px 7px", textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: M }}>
      {s.label}
    </span>
  );
}

// ─── Agent Card ──────────────────────────────────────────────────────
function AgentCard({ agent, onRun, onTabNav }) {
  const isOnDemand = agent.trigger === "on-demand";
  const isRunning = agent.status === "running";
  const isError = agent.status === "error";

  return (
    <div
      style={{
        background: isError
          ? "rgba(248,113,113,0.04)"
          : isRunning
          ? "rgba(56,189,248,0.04)"
          : "rgba(255,255,255,0.025)",
        border: `1px solid ${
          isError
            ? "rgba(248,113,113,0.12)"
            : isRunning
            ? "rgba(56,189,248,0.14)"
            : "rgba(255,255,255,0.06)"
        }`,
        borderRadius: 12,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        transition: "border-color 0.2s",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Indigo accent top bar for agent-branded items */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: isRunning ? "linear-gradient(90deg,#38bdf8,#818cf8)" : isError ? "rgba(248,113,113,0.4)" : "rgba(99,102,241,0.25)", borderRadius: "12px 12px 0 0" }} />

      {/* Header row */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginTop: 4 }}>
        <span style={{ fontSize: 20, lineHeight: 1, flexShrink: 0 }}>{agent.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#e5e7eb" }}>{agent.name}</span>
            <StatusBadge status={agent.status} />
            {agent.trigger === "scheduled" && (
              <span style={{ fontSize: 9, color: "#6b7280", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 4, padding: "1px 5px", fontFamily: M }}>⏱ Scheduled</span>
            )}
          </div>
          <p style={{ fontSize: 10, color: "#6b7280", marginTop: 3, lineHeight: 1.4 }}>{agent.description}</p>
        </div>
      </div>

      {/* Last result */}
      <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 7, padding: "8px 10px" }}>
        <div style={{ fontSize: 9, color: "#4b5563", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: M, marginBottom: 3 }}>Last Run · {agent.lastRun}</div>
        <div style={{ fontSize: 10.5, color: isError ? "#f87171" : "#9ca3af", lineHeight: 1.4 }}>{agent.lastResult}</div>
      </div>

      {/* Footer: runtime + action */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 9, color: "#4b5563", fontFamily: M }}>Runtime {agent.runtime}</span>
        <div style={{ display: "flex", gap: 6 }}>
          {/* Navigate to the relevant tab */}
          <button
            onClick={() => onTabNav(agent.tab)}
            style={{ fontSize: 10, color: "#818cf8", background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.12)", borderRadius: 6, padding: "4px 9px", cursor: "pointer" }}
          >
            View Tab →
          </button>
          {/* Run button only for on-demand agents */}
          {isOnDemand && (
            <button
              onClick={() => onRun(agent.id)}
              disabled={isRunning}
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: isRunning ? "#38bdf8" : "#a5b4fc",
                background: isRunning ? "rgba(56,189,248,0.08)" : "rgba(99,102,241,0.12)",
                border: `1px solid ${isRunning ? "rgba(56,189,248,0.2)" : "rgba(99,102,241,0.2)"}`,
                borderRadius: 6,
                padding: "4px 10px",
                cursor: isRunning ? "not-allowed" : "pointer",
                opacity: isRunning ? 0.8 : 1,
                transition: "all 0.15s",
              }}
            >
              {isRunning ? "Running..." : "▶ Run"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Activity Feed ───────────────────────────────────────────────────
function ActivityFeed({ activities, onTabNav, filterAgent, setFilterAgent }) {
  const agentNames = ["All", ...Array.from(new Set(activities.map(a => a.agentName)))];

  const filtered = filterAgent === "All" || !filterAgent
    ? activities
    : activities.filter(a => a.agentName === filterAgent);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Filter bar */}
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 9, color: "#6b7280", fontFamily: M, marginRight: 2 }}>FILTER</span>
        {agentNames.map(name => (
          <button
            key={name}
            onClick={() => setFilterAgent(name)}
            style={{
              fontSize: 9.5,
              fontWeight: 500,
              color: filterAgent === name || (!filterAgent && name === "All") ? "#a5b4fc" : "#6b7280",
              background: filterAgent === name || (!filterAgent && name === "All") ? "rgba(99,102,241,0.12)" : "transparent",
              border: `1px solid ${filterAgent === name || (!filterAgent && name === "All") ? "rgba(99,102,241,0.2)" : "rgba(255,255,255,0.06)"}`,
              borderRadius: 5,
              padding: "3px 8px",
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            {name === "All" ? "All Agents" : name.replace("Generator", "Gen.").replace("Analyzer", "Analyzer").replace("Orchestrator", "Orch.")}
          </button>
        ))}
        <button
          onClick={() => {}}
          style={{ marginLeft: "auto", fontSize: 9, color: "#6b7280", background: "transparent", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 5, padding: "3px 8px", cursor: "pointer" }}
          title="Archive all entries (coming soon)"
        >
          Archive All
        </button>
      </div>

      {/* Entries */}
      {filtered.length === 0 && (
        <div style={{ textAlign: "center", padding: "32px 0", color: "#4b5563", fontSize: 12 }}>
          No activity yet for this agent.
        </div>
      )}
      {filtered.map((entry, i) => (
        <div
          key={entry.id}
          onClick={() => onTabNav(entry.tab)}
          style={{
            display: "flex",
            gap: 12,
            alignItems: "flex-start",
            padding: "12px 14px",
            borderRadius: 10,
            background: "rgba(255,255,255,0.02)",
            border: `1px solid ${entry.status === "error" ? "rgba(248,113,113,0.1)" : "rgba(255,255,255,0.05)"}`,
            cursor: "pointer",
            transition: "background 0.15s, border-color 0.15s",
            animation: `fu 0.3s ease ${i * 30}ms both`,
          }}
          onMouseEnter={e => { e.currentTarget.style.background = "rgba(99,102,241,0.05)"; e.currentTarget.style.borderColor = "rgba(99,102,241,0.12)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.02)"; e.currentTarget.style.borderColor = entry.status === "error" ? "rgba(248,113,113,0.1)" : "rgba(255,255,255,0.05)"; }}
        >
          {/* Icon + status dot */}
          <div style={{ position: "relative", flexShrink: 0, marginTop: 1 }}>
            <span style={{ fontSize: 18, lineHeight: 1 }}>{entry.agentIcon}</span>
            <span style={{ position: "absolute", bottom: -2, right: -3, width: 8, height: 8, borderRadius: "50%", background: entry.status === "error" ? "#f87171" : "#4ade80", border: "1.5px solid #0a0a0f" }} />
          </div>

          {/* Content */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", marginBottom: 3 }}>
              {/* Agent name badge — indigo, consistent with agent visual token */}
              <span style={{ fontSize: 9, fontWeight: 700, color: "#818cf8", background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.15)", borderRadius: 4, padding: "1px 5px", fontFamily: M }}>
                🤖 {entry.agentName}
              </span>
              <span style={{ fontSize: 11.5, color: "#e5e7eb" }}>{entry.action}</span>
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#c4b5fd", marginBottom: 2 }}>{entry.targetLabel}</div>
            <div style={{ fontSize: 10.5, color: "#9ca3af", lineHeight: 1.4 }}>{entry.resultSummary}</div>
          </div>

          {/* Timestamp + target type */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
            <span style={{ fontSize: 10, color: "#4b5563", fontFamily: M }}>{entry.timestamp}</span>
            <span style={{ fontSize: 9, color: "#6b7280", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 4, padding: "1px 5px", textTransform: "capitalize" }}>{entry.targetType}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Recording Upload Panel ──────────────────────────────────────────
function RecordingUploadPanel() {
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState(null);
  const [meetingType, setMeetingType] = useState("discovery");
  const [clientName, setClientName] = useState("");
  const [uploadState, setUploadState] = useState("idle"); // idle | uploading | transcribing | analyzing | done | error
  const [costEstimate, setCostEstimate] = useState(null);
  const [recentUploads] = useState([
    { name: "chapel-hill-checkin-mar10.mp3", type: "Client Check-in", client: "Chapel Hill Family Med", duration: "28 min", status: "done", transcript: true, analysis: true, date: "Mar 10" },
    { name: "sunrise-discovery-mar05.m4a", type: "Discovery Call", client: "Sunrise Family Medicine", duration: "42 min", status: "done", transcript: true, analysis: true, date: "Mar 05" },
  ]);
  const fileInputRef = useRef();

  const isAudio = file && (AUDIO_TYPES.includes(file.type) || file.name.match(/\.(mp3|m4a|wav)$/i));
  const isText = file && (TEXT_TYPES.includes(file.type) || file.name.match(/\.(txt|pdf)$/i));

  const handleFile = useCallback((f) => {
    if (!f) return;
    setFile(f);
    setUploadState("idle");
    // Estimate cost for audio files (~$0.006/min, rough estimate from file size)
    if (AUDIO_TYPES.includes(f.type) || f.name.match(/\.(mp3|m4a|wav)$/i)) {
      // Rough estimate: 1MB ~= 1 min of compressed audio
      const estMins = Math.round(f.size / (1024 * 1024));
      const estCost = (estMins * 0.006).toFixed(2);
      setCostEstimate({ mins: estMins, cost: estCost });
    } else {
      setCostEstimate(null);
    }
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  // Simulate upload progress through states
  const handleUpload = useCallback(() => {
    if (!file || !clientName.trim()) return;
    const states = ["uploading", "transcribing", "analyzing", "done"];
    let idx = 0;
    setUploadState(states[idx]);
    const advance = () => {
      idx++;
      if (idx < states.length) {
        setUploadState(states[idx]);
        setTimeout(advance, idx === 1 ? 2200 : 1400);
      }
    };
    setTimeout(advance, 1200);
  }, [file, clientName]);

  const handleReset = () => {
    setFile(null); setClientName(""); setUploadState("idle"); setCostEstimate(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const uploadProgressSteps = [
    { key: "uploading",   label: "Uploading",    icon: "⬆️" },
    { key: "transcribing",label: "Transcribing", icon: "🎙️" },
    { key: "analyzing",   label: "Analyzing",    icon: "🤖" },
    { key: "done",        label: "Done",         icon: "✅" },
  ];
  const stepIdx = uploadProgressSteps.findIndex(s => s.key === uploadState);

  const selectedMeeting = MEETING_TYPES.find(m => m.value === meetingType);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => !file && fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? "#818cf8" : file ? "rgba(99,102,241,0.3)" : "rgba(255,255,255,0.1)"}`,
          borderRadius: 12,
          padding: "24px 20px",
          textAlign: "center",
          cursor: file ? "default" : "pointer",
          background: dragOver ? "rgba(99,102,241,0.05)" : file ? "rgba(99,102,241,0.03)" : "transparent",
          transition: "all 0.2s",
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT_EXTS}
          style={{ display: "none" }}
          onChange={e => handleFile(e.target.files[0])}
        />
        {!file ? (
          <>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🎙️</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#e5e7eb", marginBottom: 4 }}>Drop audio or transcript here</div>
            <div style={{ fontSize: 11, color: "#6b7280" }}>MP3, M4A, WAV — or TXT, PDF transcript</div>
            <div style={{ fontSize: 10, color: "#4b5563", marginTop: 4, fontFamily: M }}>Max 100MB · Audio ~$0.006/min to transcribe</div>
          </>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 12, textAlign: "left" }}>
            <span style={{ fontSize: 28 }}>{isAudio ? "🎵" : "📄"}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#e5e7eb", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</div>
              <div style={{ fontSize: 10, color: "#6b7280", marginTop: 2 }}>
                {(file.size / (1024 * 1024)).toFixed(1)} MB
                {isAudio && " · Audio file"}
                {isText && " · Transcript"}
              </div>
              {costEstimate && (
                <div style={{ fontSize: 10, color: "#fbbf24", marginTop: 3, fontFamily: M }}>
                  ~{costEstimate.mins} min · Est. ${costEstimate.cost} to transcribe
                </div>
              )}
            </div>
            {uploadState === "idle" && (
              <button
                onClick={e => { e.stopPropagation(); handleReset(); }}
                style={{ fontSize: 14, color: "#6b7280", background: "transparent", border: "none", cursor: "pointer", padding: "4px 6px" }}
              >×</button>
            )}
          </div>
        )}
      </div>

      {/* Configuration: meeting type + client */}
      {file && uploadState === "idle" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, animation: "fu 0.3s ease both" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={{ fontSize: 10, color: "#6b7280", display: "block", marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: M }}>Meeting Type</label>
              <select
                value={meetingType}
                onChange={e => setMeetingType(e.target.value)}
                style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.4)", color: "#e5e7eb", fontSize: 11.5, fontFamily: "inherit", outline: "none" }}
              >
                {MEETING_TYPES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 10, color: "#6b7280", display: "block", marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: M }}>Client / Prospect Name</label>
              <input
                value={clientName}
                onChange={e => setClientName(e.target.value)}
                placeholder="e.g. Chapel Hill Family Med"
                style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.4)", color: "#e5e7eb", fontSize: 11.5, fontFamily: "inherit", outline: "none" }}
              />
            </div>
          </div>

          {/* Agent routing info */}
          {selectedMeeting && (
            <div style={{ background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.12)", borderRadius: 8, padding: "8px 12px", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 14 }}>🤖</span>
              <span style={{ fontSize: 11, color: "#9ca3af" }}>Will be routed to <span style={{ color: "#a5b4fc", fontWeight: 600 }}>{selectedMeeting.agent}</span> after transcription</span>
            </div>
          )}

          <button
            onClick={handleUpload}
            disabled={!clientName.trim()}
            style={{
              padding: "10px 0",
              borderRadius: 8,
              border: "none",
              background: clientName.trim() ? "linear-gradient(135deg,#6366f1,#8b5cf6)" : "rgba(255,255,255,0.06)",
              color: clientName.trim() ? "white" : "#4b5563",
              fontSize: 12,
              fontWeight: 700,
              cursor: clientName.trim() ? "pointer" : "not-allowed",
              transition: "all 0.2s",
              letterSpacing: "0.02em",
            }}
          >
            {isAudio ? "Upload & Transcribe" : "Upload Transcript"} →
          </button>
        </div>
      )}

      {/* Progress indicator */}
      {file && uploadState !== "idle" && (
        <div style={{ animation: "fu 0.3s ease both" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 14 }}>
            {uploadProgressSteps.map((step, idx2) => {
              const isActive = step.key === uploadState;
              const isPast = uploadProgressSteps.findIndex(s => s.key === uploadState) > idx2;
              const isFuture = !isActive && !isPast;
              return (
                <div key={step.key} style={{ display: "flex", alignItems: "center", flex: 1 }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flex: "0 0 auto" }}>
                    <div style={{
                      width: 30, height: 30, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14,
                      background: isPast ? "rgba(74,222,128,0.15)" : isActive ? "rgba(99,102,241,0.2)" : "rgba(255,255,255,0.04)",
                      border: `2px solid ${isPast ? "#4ade80" : isActive ? "#818cf8" : "rgba(255,255,255,0.08)"}`,
                      transition: "all 0.4s",
                    }}>
                      {isPast ? "✓" : step.icon}
                    </div>
                    <span style={{ fontSize: 9, color: isActive ? "#a5b4fc" : isPast ? "#4ade80" : "#4b5563", fontFamily: M, fontWeight: isActive ? 700 : 400 }}>{step.label}</span>
                  </div>
                  {idx2 < uploadProgressSteps.length - 1 && (
                    <div style={{ flex: 1, height: 2, background: isPast ? "rgba(74,222,128,0.3)" : "rgba(255,255,255,0.06)", margin: "0 4px", marginBottom: 18, transition: "background 0.4s" }} />
                  )}
                </div>
              );
            })}
          </div>

          {uploadState === "done" ? (
            <div style={{ background: "rgba(74,222,128,0.06)", border: "1px solid rgba(74,222,128,0.15)", borderRadius: 10, padding: "12px 16px" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#4ade80", marginBottom: 4 }}>✅ Analysis complete</div>
              <div style={{ fontSize: 11, color: "#9ca3af", lineHeight: 1.5 }}>
                Transcript saved. {selectedMeeting?.agent} has analyzed this recording and written results to {clientName}.
              </div>
              <button onClick={handleReset} style={{ marginTop: 10, fontSize: 10.5, color: "#818cf8", background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.15)", borderRadius: 6, padding: "5px 12px", cursor: "pointer" }}>
                Upload Another
              </button>
            </div>
          ) : (
            <div style={{ background: "rgba(99,102,241,0.05)", border: "1px solid rgba(99,102,241,0.1)", borderRadius: 10, padding: "12px 16px" }}>
              <div style={{ fontSize: 11, color: "#9ca3af" }}>
                {uploadState === "uploading" && "Uploading to DigitalOcean server..."}
                {uploadState === "transcribing" && "Transcribing via OpenAI Whisper API..."}
                {uploadState === "analyzing" && `Routing to ${selectedMeeting?.agent} for analysis...`}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Recent uploads */}
      {recentUploads.length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: M, marginBottom: 8 }}>Recent Uploads</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {recentUploads.map((u, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 8 }}>
                <span style={{ fontSize: 16 }}>🎵</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: "#e5e7eb", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.client}</div>
                  <div style={{ fontSize: 10, color: "#6b7280" }}>{u.type} · {u.duration} · {u.date}</div>
                </div>
                <div style={{ display: "flex", gap: 5 }}>
                  {u.transcript && (
                    <button style={{ fontSize: 9, color: "#38bdf8", background: "rgba(56,189,248,0.08)", border: "1px solid rgba(56,189,248,0.12)", borderRadius: 4, padding: "2px 7px", cursor: "pointer" }}>
                      Transcript
                    </button>
                  )}
                  {u.analysis && (
                    <button style={{ fontSize: 9, color: "#818cf8", background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.12)", borderRadius: 4, padding: "2px 7px", cursor: "pointer" }}>
                      Analysis
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN AgentsTab EXPORT
// ═══════════════════════════════════════════════════════════════════════
export default function AgentsTab({ onTabNav }) {
  const [agents, setAgents] = useState(MOCK_AGENTS);
  const [activity] = useState(MOCK_ACTIVITY);
  const [filterAgent, setFilterAgent] = useState("All");
  const [activePanel, setActivePanel] = useState("status"); // status | feed | upload

  // Counts for header badges
  const runningCount = agents.filter(a => a.status === "running").length;
  const errorCount   = agents.filter(a => a.status === "error").length;
  const doneCount    = agents.filter(a => a.status === "done").length;

  // Simulate running an agent (mock — no real API call yet)
  const handleRun = (agentId) => {
    setAgents(prev => prev.map(a =>
      a.id === agentId ? { ...a, status: "running" } : a
    ));
    // Simulate completion after 3s
    setTimeout(() => {
      setAgents(prev => prev.map(a =>
        a.id === agentId
          ? { ...a, status: "done", lastRun: "Just now", lastResult: `Mock run complete — no agent built yet (Phase 6 Task 9+)` }
          : a
      ));
    }, 3000);
  };

  const panelTabs = [
    { id: "status", label: "Status Board", badge: runningCount > 0 ? runningCount : errorCount > 0 ? errorCount : null, badgeColor: runningCount > 0 ? "#38bdf8" : "#f87171" },
    { id: "feed",   label: "Activity Feed", badge: activity.length, badgeColor: "#6b7280" },
    { id: "upload", label: "Upload Recording", badge: null },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Tab header */}
      <div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: "#f0f0f0" }}>Agent Command Center</h2>
          {/* Live indicator when any agent is running */}
          {runningCount > 0 && (
            <span style={{ fontSize: 9, color: "#38bdf8", fontFamily: M, display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#38bdf8", display: "inline-block", animation: "pr 1.2s ease-out infinite" }}/>
              {runningCount} RUNNING
            </span>
          )}
        </div>
        <p style={{ fontSize: 11, color: "#6b7280" }}>
          9 Claude-powered agents · {doneCount} completed · {errorCount > 0 ? `${errorCount} error` : "0 errors"} ·
          {" "}<span style={{ color: "#4b5563", fontFamily: M }}>Live data wiring: Phase 6 Step 17</span>
        </p>
      </div>

      {/* Summary KPI bar */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
        {[
          { label: "Total Agents", value: agents.length, color: "#e5e7eb" },
          { label: "Running Now", value: runningCount, color: "#38bdf8" },
          { label: "Errors Today", value: errorCount, color: errorCount > 0 ? "#f87171" : "#6b7280" },
          { label: "Activity Entries", value: activity.length, color: "#818cf8" },
        ].map((kpi, i) => (
          <div key={i} style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ fontSize: 9, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: M, marginBottom: 4 }}>{kpi.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: kpi.color, fontFamily: M, lineHeight: 1 }}>{kpi.value}</div>
          </div>
        ))}
      </div>

      {/* Panel selector */}
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: 0 }}>
        {panelTabs.map(pt => (
          <button
            key={pt.id}
            onClick={() => setActivePanel(pt.id)}
            style={{
              padding: "8px 14px",
              borderRadius: "8px 8px 0 0",
              border: "none",
              borderBottom: activePanel === pt.id ? "2px solid #818cf8" : "2px solid transparent",
              background: activePanel === pt.id ? "rgba(99,102,241,0.08)" : "transparent",
              color: activePanel === pt.id ? "#a5b4fc" : "#6b7280",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: activePanel === pt.id ? 600 : 400,
              transition: "all 0.15s",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {pt.label}
            {pt.badge !== null && (
              <span style={{
                fontSize: 9, fontWeight: 700, color: pt.badgeColor,
                background: `${pt.badgeColor}18`,
                border: `1px solid ${pt.badgeColor}30`,
                borderRadius: 10, padding: "1px 5px", fontFamily: M,
              }}>{pt.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* Panel: Agent Status Board */}
      {activePanel === "status" && (
        <div style={{ animation: "fu 0.3s ease both" }}>
          {runningCount > 0 && (
            <div style={{ background: "rgba(56,189,248,0.05)", border: "1px solid rgba(56,189,248,0.1)", borderRadius: 10, padding: "10px 14px", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#38bdf8", flexShrink: 0, animation: "pr 1.2s ease-out infinite" }} />
              <span style={{ fontSize: 11, color: "#7dd3fc" }}>{runningCount} agent{runningCount > 1 ? "s" : ""} currently running — results will appear in Activity Feed when complete</span>
            </div>
          )}
          {errorCount > 0 && (
            <div style={{ background: "rgba(248,113,113,0.05)", border: "1px solid rgba(248,113,113,0.1)", borderRadius: 10, padding: "10px 14px", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, color: "#fca5a5" }}>⚠️ {errorCount} agent encountered an error — check Collections Assistant below</span>
            </div>
          )}

          {/* On-demand agents */}
          <div style={{ fontSize: 10, fontWeight: 600, color: "#4b5563", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: M, marginBottom: 8 }}>
            On-Demand — Manual Trigger
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 12, marginBottom: 20 }}>
            {agents.filter(a => a.trigger === "on-demand").map(agent => (
              <AgentCard key={agent.id} agent={agent} onRun={handleRun} onTabNav={onTabNav} />
            ))}
          </div>

          {/* Scheduled agents */}
          <div style={{ fontSize: 10, fontWeight: 600, color: "#4b5563", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: M, marginBottom: 8 }}>
            Scheduled — Auto-Trigger via Make.com
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 12 }}>
            {agents.filter(a => a.trigger === "scheduled").map(agent => (
              <AgentCard key={agent.id} agent={agent} onRun={handleRun} onTabNav={onTabNav} />
            ))}
          </div>
        </div>
      )}

      {/* Panel: Activity Feed */}
      {activePanel === "feed" && (
        <div style={{ animation: "fu 0.3s ease both" }}>
          <ActivityFeed
            activities={activity}
            onTabNav={onTabNav}
            filterAgent={filterAgent}
            setFilterAgent={setFilterAgent}
          />
        </div>
      )}

      {/* Panel: Recording Upload */}
      {activePanel === "upload" && (
        <div style={{ animation: "fu 0.3s ease both", maxWidth: 560 }}>
          <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 14, lineHeight: 1.5 }}>
            Upload a call recording or transcript. Audio is transcribed via OpenAI Whisper (~$0.006/min), then automatically routed to the correct agent based on meeting type.
          </div>
          <RecordingUploadPanel />
        </div>
      )}

    </div>
  );
}
