/**
 * VapiAssistant.jsx
 * Real-time voice layer for IC-BOS using the Vapi Web SDK.
 * Connects to assistant: df8c2625-0efa-491e-9dd1-a32e8ad9b24f
 *
 * Drop-in replacement for the mock voice bar in IC-BOS.jsx.
 * Props:
 *   onTabChange(tabId) — called when Vapi assistant navigates to a tab
 */

import { useState, useEffect, useRef, useCallback } from "react";
import Vapi from "@vapi-ai/web";

const VAPI_PUBLIC_KEY  = import.meta.env.VITE_VAPI_PUBLIC_KEY;
const ASSISTANT_ID     = import.meta.env.VITE_VAPI_ASSISTANT_ID;
const M = "var(--mono)";

// Tab keyword map — maps assistant speech to IC-BOS tab IDs
const TAB_KEYWORDS = {
  overview:      ["overview", "home", "dashboard", "briefing", "standup", "morning"],
  pipeline:      ["pipeline", "deals", "prospect", "sales", "lead"],
  clients:       ["client", "health"],
  roi:           ["roi", "return", "value", "recover", "impact"],
  financials:    ["financ", "revenue", "mrr", "cash", "money", "arr"],
  invoicing:     ["invoice", "billing", "payment", "overdue", "collect"],
  automations:   ["automat", "make", "scenario", "error", "workflow"],
  onboarding:    ["onboard", "go-live", "golive", "uat", "deploy", "implementation"],
  capacity:      ["capacity", "bandwidth", "workload", "utilization"],
  profitability: ["profit", "margin", "effective rate"],
  renewals:      ["renewal", "churn", "retain"],
  proposal:      ["proposal", "propose", "quote"],
  salesprep:     ["prep", "discovery call", "sales call"],
  tasks:         ["task", "todo", "action item", "priority"],
  comms:         ["commun", "contact", "touchpoint"],
  report:        ["weekly report", "week summary", "this week"],
};

function detectTab(text) {
  const lower = text.toLowerCase();
  for (const [tabId, keywords] of Object.entries(TAB_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return tabId;
  }
  return null;
}

export default function VapiAssistant({ onTabChange }) {
  const vapiRef  = useRef(null);
  const inRef    = useRef(null);

  const [active,     setActive]     = useState(false);   // call in progress
  const [vState,     setVState]     = useState("idle");  // idle | connecting | listening | speaking | error
  const [transcript, setTranscript] = useState("");      // live transcript
  const [response,   setResponse]   = useState("");      // last assistant message
  const [textInput,  setTextInput]  = useState("");      // typed fallback input

  // ── Initialise Vapi SDK once ─────────────────────────────────────────
  useEffect(() => {
    if (!VAPI_PUBLIC_KEY) {
      console.warn("IC-BOS: VITE_VAPI_PUBLIC_KEY not set");
      return;
    }

    const vapi = new Vapi(VAPI_PUBLIC_KEY);
    vapiRef.current = vapi;

    // Call lifecycle
    vapi.on("call-start",  () => { setVState("listening"); setResponse("IC-BOS voice active. Ask me anything."); });
    vapi.on("call-end",    () => { setActive(false); setVState("idle"); setTranscript(""); });
    vapi.on("error",       (e) => { console.error("Vapi error:", e); setVState("error"); setResponse("Connection error. Try again."); setActive(false); });

    // Live transcript (user speech)
    vapi.on("speech-start", () => setVState("listening"));
    vapi.on("speech-end",   () => setVState("speaking"));

    // Message events — assistant responses + tab navigation
    vapi.on("message", (msg) => {
      // Live transcript from user
      if (msg.type === "transcript" && msg.role === "user") {
        setTranscript(msg.transcript);
        // Detect tab navigation intent in user speech
        const tab = detectTab(msg.transcript);
        if (tab && onTabChange) onTabChange(tab);
      }

      // Assistant final response
      if (msg.type === "transcript" && msg.role === "assistant" && msg.transcriptType === "final") {
        setResponse(msg.transcript);
        setVState("listening");
        // Also detect tab in assistant response (assistant may say "opening pipeline...")
        const tab = detectTab(msg.transcript);
        if (tab && onTabChange) onTabChange(tab);
      }
    });

    return () => {
      vapi.stop();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Start / stop call ───────────────────────────────────────────────
  const toggleCall = useCallback(async () => {
    const vapi = vapiRef.current;
    if (!vapi) return;

    if (active) {
      vapi.stop();
      setActive(false);
      setVState("idle");
      setTranscript("");
      return;
    }

    setActive(true);
    setVState("connecting");
    setResponse("");
    try {
      await vapi.start(ASSISTANT_ID);
    } catch (err) {
      console.error("Vapi start error:", err);
      setVState("error");
      setResponse("Could not connect. Check your mic permissions.");
      setActive(false);
    }
  }, [active]);

  // ── Typed fallback — send text message to Vapi assistant ────────────
  const sendText = useCallback(() => {
    const vapi = vapiRef.current;
    if (!vapi || !textInput.trim()) return;
    vapi.send({ type: "add-message", message: { role: "user", content: textInput.trim() } });
    setTranscript(textInput.trim());
    setTextInput("");
    setVState("speaking");
  }, [textInput]);

  // ── Keyboard shortcut ⌘K / Ctrl+K ───────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        toggleCall();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggleCall]);

  // Focus text input when call goes active
  useEffect(() => {
    if (active) setTimeout(() => inRef.current?.focus(), 150);
  }, [active]);

  // ── Orb state styles ─────────────────────────────────────────────────
  const orbColors = {
    idle:       "radial-gradient(circle at 40% 40%,#374151,#1f2937 60%,#111827)",
    connecting: "radial-gradient(circle at 40% 40%,#f59e0b,#d97706 60%,#b45309)",
    listening:  "radial-gradient(circle at 40% 40%,#6366f1,#4f46e5 60%,#3730a3)",
    speaking:   "radial-gradient(circle at 40% 40%,#10b981,#059669 60%,#047857)",
    error:      "radial-gradient(circle at 40% 40%,#ef4444,#dc2626 60%,#b91c1c)",
  };

  const orbShadows = {
    idle:       "0 0 0 2px rgba(55,65,81,0.2)",
    connecting: "0 0 0 3px rgba(245,158,11,0.2),0 0 28px rgba(245,158,11,0.15)",
    listening:  "0 0 0 3px rgba(99,102,241,0.2),0 0 28px rgba(99,102,241,0.2)",
    speaking:   "0 0 0 3px rgba(16,185,129,0.2),0 0 28px rgba(16,185,129,0.2)",
    error:      "0 0 0 3px rgba(239,68,68,0.2),0 0 28px rgba(239,68,68,0.15)",
  };

  const stateLabel = {
    idle:       "Click orb or",
    connecting: "Connecting...",
    listening:  "Listening...",
    speaking:   "Speaking...",
    error:      "Error — try again",
  };

  // ── Orb icon ─────────────────────────────────────────────────────────
  const OrbIcon = () => {
    const strokeColor = active ? "#e0e7ff" : "#9ca3af";
    if (vState === "listening") {
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
          stroke={strokeColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"
            fill="rgba(224,231,255,0.15)"/>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
          <line x1="12" y1="19" x2="12" y2="22"/>
        </svg>
      );
    }
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
        stroke={strokeColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"
          fill={active ? "rgba(224,231,255,0.1)" : "none"}/>
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
      </svg>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div style={{
      position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 100,
      padding: "12px 24px 16px",
      background: "linear-gradient(to top,rgba(10,10,15,0.98) 65%,transparent)",
    }}>
      <div style={{
        maxWidth: 720, margin: "0 auto",
        display: "flex", alignItems: "center", gap: 12,
        background: active ? "rgba(99,102,241,0.05)" : "rgba(255,255,255,0.025)",
        border: `1px solid ${active ? "rgba(99,102,241,0.15)" : "rgba(255,255,255,0.05)"}`,
        borderRadius: 16, padding: "6px 6px 6px 20px",
        transition: "all 0.3s",
      }}>

        {/* Text / transcript area */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
          {active && response && (
            <div style={{
              fontSize: 11, color: "#a5b4fc", lineHeight: 1.4,
              maxHeight: 75, overflow: "auto",
              animation: "fu 0.3s ease", whiteSpace: "pre-line",
            }}>
              {response}
            </div>
          )}
          {active && transcript && transcript !== textInput && (
            <div style={{ fontSize: 10, color: "#6b7280", fontStyle: "italic", fontFamily: M }}>
              You: {transcript}
            </div>
          )}
          <input
            ref={inRef}
            type="text"
            placeholder={active ? "Type or speak to IC-BOS..." : "Press orb to activate IC-BOS..."}
            value={textInput}
            onChange={e => setTextInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && textInput.trim()) sendText(); }}
            disabled={!active}
            style={{
              background: "none", border: "none", outline: "none",
              color: "#e5e7eb", fontSize: 12.5, fontFamily: "inherit",
              width: "100%", opacity: active ? 1 : 0.4,
            }}
          />
        </div>

        {/* Voice orb */}
        <button
          onClick={toggleCall}
          title={active ? "End call" : "Start voice session"}
          style={{
            position: "relative", width: 56, height: 56,
            borderRadius: "50%", border: "none", cursor: "pointer", flexShrink: 0,
            background: orbColors[vState] ?? orbColors.idle,
            boxShadow: orbShadows[vState] ?? orbShadows.idle,
            transition: "all 0.4s",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {/* Pulse rings when active */}
          {active && (
            <>
              <span style={{
                position: "absolute", inset: -5, borderRadius: "50%",
                border: "2px solid rgba(99,102,241,0.25)",
                animation: "pr 2s ease-out infinite",
              }}/>
              <span style={{
                position: "absolute", inset: -12, borderRadius: "50%",
                border: "1px solid rgba(99,102,241,0.1)",
                animation: "pr 2s ease-out infinite 0.5s",
              }}/>
            </>
          )}
          <OrbIcon />
        </button>
      </div>

      {/* Status line */}
      <div style={{ textAlign: "center", marginTop: 5 }}>
        {vState === "idle" ? (
          <span style={{ fontSize: 9, color: "#4b5563" }}>
            Click orb or{" "}
            <kbd style={{
              padding: "1px 4px", background: "rgba(255,255,255,0.04)",
              borderRadius: 3, fontSize: 8, border: "1px solid rgba(255,255,255,0.06)",
            }}>
              ⌘K
            </kbd>
          </span>
        ) : (
          <span style={{
            fontSize: 9, fontFamily: M,
            color: vState === "error" ? "#f87171" :
                   vState === "connecting" ? "#fbbf24" :
                   vState === "speaking" ? "#10b981" : "#818cf8",
          }}>
            {stateLabel[vState]}
          </span>
        )}
      </div>
    </div>
  );
}
