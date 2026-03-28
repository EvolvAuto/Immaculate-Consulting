/**
 * VapiAssistant.jsx
 * Real-time voice layer for IC-BOS using the Vapi Web SDK.
 * Connects to assistant: df8c2625-0efa-491e-9dd1-a32e8ad9b24f
 *
 * Energy Core orb — ambient glow + orbital rings + pulsing core.
 * Listening state: waveform bar replaces text area.
 * Theme: 2C-III — charcoal #1f2937 bar, white bold text.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import Vapi from "@vapi-ai/web";

const VAPI_PUBLIC_KEY  = import.meta.env.VITE_VAPI_PUBLIC_KEY;
const ASSISTANT_ID     = import.meta.env.VITE_VAPI_ASSISTANT_ID;
const M = "var(--mono)";

// ── Tab keyword map ───────────────────────────────────────────────────
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

const FORM_KEYWORDS = {
  client:  ["add a client", "new client", "add client", "create client"],
  deal:    ["add a deal", "new deal", "add deal", "new prospect", "add prospect"],
  task:    ["add a task", "new task", "add task", "create task"],
  invoice: ["add an invoice", "new invoice", "add invoice", "create invoice", "log invoice"],
  comm:    ["log a call", "log a meeting", "log an email", "log comms", "log communication", "add comms"],
};

function detectForm(text) {
  const lower = text.toLowerCase();
  for (const [formId, keywords] of Object.entries(FORM_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return formId;
  }
  return null;
}
function detectTab(text) {
  const lower = text.toLowerCase();
  for (const [tabId, keywords] of Object.entries(TAB_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return tabId;
  }
  return null;
}

// ── Energy Core Orb ───────────────────────────────────────────────────
function EnergyOrb({ size = 56, fast = false }) {
  const speed = fast ? 0.6 : 1;
  const core  = size * 0.32;
  const shell = size * 0.68;
  const ring1 = size * 0.78;
  const ring2 = size * 0.82;
  const ring3 = size * 0.95;
  const glow  = size * 1.1;
  const ptSize  = size * 0.085;
  const ptOrbit = size * 0.42;

  return (
    <div style={{
      position: "relative",
      width: size, height: size,
      display: "flex", alignItems: "center", justifyContent: "center",
      flexShrink: 0,
    }}>
      <style>{`
        @keyframes ic-core-pulse {
          0%,100% {
            box-shadow: 0 0 ${size*0.22}px ${size*0.07}px rgba(255,160,0,0.9),
                        0 0 ${size*0.55}px ${size*0.18}px rgba(255,100,0,0.6),
                        0 0 ${size*1.0}px  ${size*0.36}px rgba(255,60,0,0.3);
          }
          50% {
            box-shadow: 0 0 ${size*0.32}px ${size*0.12}px rgba(255,200,0,1),
                        0 0 ${size*0.8}px  ${size*0.28}px rgba(255,120,0,0.8),
                        0 0 ${size*1.4}px  ${size*0.5}px  rgba(255,60,0,0.4);
            transform: scale(1.08);
          }
        }
        @keyframes ic-shell-pulse {
          0%,100% { border-color: rgba(255,140,0,0.25); }
          50%      { border-color: rgba(255,180,0,0.5); }
        }
        @keyframes ic-glow-pulse {
          0%,100% { transform: scale(1);    opacity: 0.6; }
          50%      { transform: scale(1.18); opacity: 1; }
        }
        @keyframes ic-ring1 {
          from { transform: rotateX(70deg) rotateZ(0deg); }
          to   { transform: rotateX(70deg) rotateZ(360deg); }
        }
        @keyframes ic-ring2 {
          from { transform: rotateX(55deg) rotateY(20deg) rotateZ(0deg); }
          to   { transform: rotateX(55deg) rotateY(20deg) rotateZ(360deg); }
        }
        @keyframes ic-ring3 {
          from { transform: rotateX(20deg) rotateY(60deg) rotateZ(0deg); }
          to   { transform: rotateX(20deg) rotateY(60deg) rotateZ(360deg); }
        }
        @keyframes ic-pt1 {
          from { transform: rotateX(70deg) rotateZ(0deg); }
          to   { transform: rotateX(70deg) rotateZ(360deg); }
        }
        @keyframes ic-pt2 {
          from { transform: rotateX(55deg) rotateY(20deg) rotateZ(0deg); }
          to   { transform: rotateX(55deg) rotateY(20deg) rotateZ(360deg); }
        }
        @keyframes ic-flare1 { from { transform: rotateZ(0deg); }   to { transform: rotateZ(360deg); } }
        @keyframes ic-flare2 { from { transform: rotateZ(0deg); }   to { transform: rotateZ(360deg); } }
      `}</style>

      {/* Ambient glow */}
      <div style={{
        position: "absolute", width: glow, height: glow, borderRadius: "50%",
        background: `radial-gradient(circle, rgba(255,120,0,0.18) 0%, rgba(255,60,0,0.08) 50%, transparent 75%)`,
        animation: `ic-glow-pulse ${2*speed}s ease-in-out infinite`,
        zIndex: 1, pointerEvents: "none",
      }} />

      {/* Ring 3 — outermost */}
      <div style={{
        position: "absolute", width: ring3, height: ring3, borderRadius: "50%",
        border: "1px solid rgba(255,200,80,0.28)",
        animation: `ic-ring3 ${8*speed}s linear infinite`,
        transformStyle: "preserve-3d", zIndex: 2, pointerEvents: "none",
      }} />

      {/* Ring 2 */}
      <div style={{
        position: "absolute", width: ring2, height: ring2, borderRadius: "50%",
        border: "1px solid rgba(255,120,0,0.42)",
        animation: `ic-ring2 ${5*speed}s linear infinite reverse`,
        transformStyle: "preserve-3d", zIndex: 2, pointerEvents: "none",
      }} />

      {/* Ring 1 — main bright */}
      <div style={{
        position: "absolute", width: ring1, height: ring1, borderRadius: "50%",
        border: "1.5px solid rgba(255,160,40,0.72)",
        boxShadow: `0 0 ${size*0.14}px rgba(255,140,0,0.35)`,
        animation: `ic-ring1 ${3*speed}s linear infinite`,
        transformStyle: "preserve-3d", zIndex: 2, pointerEvents: "none",
      }} />

      {/* Energy shell */}
      <div style={{
        position: "absolute", width: shell, height: shell, borderRadius: "50%",
        background: `radial-gradient(circle at 35% 30%, rgba(255,200,80,0.14), rgba(255,100,0,0.06) 50%, transparent 70%)`,
        border: "1px solid rgba(255,140,0,0.22)",
        animation: `ic-shell-pulse ${2*speed}s ease-in-out infinite`,
        zIndex: 3, pointerEvents: "none",
      }} />

      {/* Core */}
      <div style={{
        position: "absolute", width: core, height: core, borderRadius: "50%",
        background: "radial-gradient(circle at 40% 38%, #fff8e0, #ffcc44 28%, #ff8800 58%, #cc4400)",
        animation: `ic-core-pulse ${2*speed}s ease-in-out infinite`,
        zIndex: 4, pointerEvents: "none",
      }} />

      {/* Flare 1 */}
      <div style={{
        position: "absolute",
        width: size*0.035, height: size*0.5,
        background: "linear-gradient(to bottom, rgba(255,220,80,0.9), transparent)",
        borderRadius: "50%",
        top: `calc(50% - ${size*0.6}px)`,
        left: `calc(50% - ${size*0.018}px)`,
        transformOrigin: `${size*0.018}px ${size*0.6}px`,
        animation: `ic-flare1 ${3*speed}s linear infinite`,
        boxShadow: `0 0 ${size*0.07}px rgba(255,200,0,0.5)`,
        zIndex: 5, pointerEvents: "none",
      }} />

      {/* Flare 2 */}
      <div style={{
        position: "absolute",
        width: size*0.028, height: size*0.38,
        background: "linear-gradient(to bottom, rgba(255,160,40,0.8), transparent)",
        borderRadius: "50%",
        top: `calc(50% - ${size*0.48}px)`,
        left: `calc(50% - ${size*0.014}px)`,
        transformOrigin: `${size*0.014}px ${size*0.48}px`,
        animation: `ic-flare2 ${4.5*speed}s linear infinite reverse`,
        boxShadow: `0 0 ${size*0.06}px rgba(255,140,0,0.4)`,
        zIndex: 5, pointerEvents: "none",
      }} />

      {/* Orbiting particle 1 */}
      <div style={{
        position: "absolute",
        width: ptSize, height: ptSize, borderRadius: "50%",
        background: "radial-gradient(circle, #fff8c0, #ffcc00)",
        boxShadow: `0 0 ${ptSize*1.4}px ${ptSize*0.5}px rgba(255,200,0,0.9)`,
        top: `-${ptSize/2}px`, left: `calc(50% - ${ptSize/2}px)`,
        transformOrigin: `${ptSize/2}px ${ptOrbit + ptSize/2}px`,
        animation: `ic-pt1 ${3*speed}s linear infinite`,
        zIndex: 6, pointerEvents: "none",
      }} />

      {/* Orbiting particle 2 */}
      <div style={{
        position: "absolute",
        width: ptSize*0.75, height: ptSize*0.75, borderRadius: "50%",
        background: "radial-gradient(circle, #ffeeaa, #ff8800)",
        boxShadow: `0 0 ${ptSize}px ${ptSize*0.4}px rgba(255,160,0,0.8)`,
        top: `-${ptSize*0.38}px`, left: `calc(50% - ${ptSize*0.38}px)`,
        transformOrigin: `${ptSize*0.38}px ${ptOrbit*1.05 + ptSize*0.38}px`,
        animation: `ic-pt2 ${5*speed}s linear infinite reverse`,
        opacity: 0.82, zIndex: 6, pointerEvents: "none",
      }} />
    </div>
  );
}

// ── Waveform bars (listening state) ──────────────────────────────────
function Waveform({ side = "left" }) {
  const bars      = [6, 12, 18, 22, 26, 20, 28];
  const delays    = [0, 0.08, 0.16, 0.04, 0.2, 0.12, 0.3];
  const durations = [0.7, 0.85, 0.6, 0.9, 0.75, 0.65, 1.0];
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 2.5, height: 28,
      transform: side === "right" ? "scaleX(-1)" : "none",
    }}>
      {bars.map((h, i) => (
        <div key={i} style={{
          width: 2.5, height: h, borderRadius: 2,
          background: i === 4 || i === 6 ? "rgba(42,182,215,0.85)" : "rgba(42,182,215,0.5)",
          animation: `ic-wave ${durations[i]}s ease-in-out ${delays[i]}s infinite alternate`,
        }} />
      ))}
      <style>{`
        @keyframes ic-wave {
          from { transform: scaleY(0.28); opacity: 0.45; }
          to   { transform: scaleY(1);    opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────
export default function VapiAssistant({ onTabChange, onOpenForm }) {
  const vapiRef = useRef(null);
  const inRef   = useRef(null);

  const [active,     setActive]     = useState(false);
  const [vState,     setVState]     = useState("idle");
  const [transcript, setTranscript] = useState("");
  const [response,   setResponse]   = useState("");
  const [textInput,  setTextInput]  = useState("");

  // ── Init Vapi SDK ─────────────────────────────────────────────────
  useEffect(() => {
    if (!VAPI_PUBLIC_KEY) {
      console.warn("IC-BOS: VITE_VAPI_PUBLIC_KEY not set");
      return;
    }
    const vapi = new Vapi(VAPI_PUBLIC_KEY);
    vapiRef.current = vapi;

    vapi.on("call-start",   () => { setVState("listening"); setResponse("IC-BOS voice active. Ask me anything."); });
    vapi.on("call-end",     () => { setActive(false); setVState("idle"); setTranscript(""); });
    vapi.on("error",        (e) => { console.error("Vapi error:", e); setVState("error"); setResponse("Connection error. Try again."); setActive(false); });
    vapi.on("speech-start", () => setVState("listening"));
    vapi.on("speech-end",   () => setVState("speaking"));

    vapi.on("message", (msg) => {
      if (msg.type === "transcript" && msg.role === "user") {
        setTranscript(msg.transcript);
        const tab = detectTab(msg.transcript);
        if (tab && onTabChange) onTabChange(tab);
        const form = detectForm(msg.transcript);
        if (form && onOpenForm) onOpenForm(form);
      }
      if (msg.type === "transcript" && msg.role === "assistant" && msg.transcriptType === "final") {
        setResponse(msg.transcript);
        setVState("listening");
        const tab = detectTab(msg.transcript);
        if (tab && onTabChange) onTabChange(tab);
      }
    });

    return () => { vapi.stop(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Toggle call ──────────────────────────────────────────────────
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

  // ── Send typed text ──────────────────────────────────────────────
  const sendText = useCallback(() => {
    const vapi = vapiRef.current;
    if (!vapi || !textInput.trim()) return;
    vapi.send({ type: "add-message", message: { role: "user", content: textInput.trim() } });
    setTranscript(textInput.trim());
    setTextInput("");
    setVState("speaking");
  }, [textInput]);

  // ── Keyboard shortcut ────────────────────────────────────────────
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

  useEffect(() => {
    if (active) setTimeout(() => inRef.current?.focus(), 150);
  }, [active]);

  const isListening  = vState === "listening";
  const isSpeaking   = vState === "speaking";
  const isConnecting = vState === "connecting";
  const isError      = vState === "error";

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div style={{
      position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 100,
      padding: "10px 24px 14px",
      /* 2C-III: charcoal bar matching the tab row */
      background: "#1f2937",
      borderTop: "1px solid #374151",
    }}>

      {/* ── LISTENING STATE — waveform bar ── */}
      {isListening && (
        <div style={{
          maxWidth: 720, margin: "0 auto",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 14,
          background: "linear-gradient(135deg, #060f22, #0a1e3a)",
          border: "1px solid rgba(42,182,215,0.5)",
          borderRadius: 40,
          padding: "10px 14px 10px 20px",
          boxShadow: "0 0 0 1px rgba(42,182,215,0.1), 0 0 28px rgba(42,182,215,0.18), inset 0 0 32px rgba(42,182,215,0.05)",
          animation: "ic-bar-glow 2s ease-in-out infinite",
          position: "relative", overflow: "hidden",
        }}>
          <style>{`
            @keyframes ic-bar-glow {
              0%,100% { box-shadow: 0 0 0 1px rgba(42,182,215,0.1), 0 0 28px rgba(42,182,215,0.18); border-color: rgba(42,182,215,0.5); }
              50%      { box-shadow: 0 0 0 1px rgba(42,182,215,0.2), 0 0 46px rgba(42,182,215,0.35); border-color: rgba(42,182,215,0.75); }
            }
            @keyframes ic-top-glow {
              0%,100% { opacity: 0.55; }
              50%      { opacity: 1; }
            }
            @keyframes ic-text-pulse {
              0%,100% { text-shadow: 0 0 18px rgba(42,182,215,0.55); color: #e8f6ff; }
              50%      { text-shadow: 0 0 32px rgba(42,182,215,0.9), 0 0 55px rgba(42,182,215,0.4); color: #ffffff; }
            }
          `}</style>

          {/* Top edge glow */}
          <div style={{
            position: "absolute", top: 0, left: "15%", right: "15%", height: 1,
            background: "linear-gradient(90deg, transparent, rgba(42,182,215,0.8), rgba(160,235,255,1), rgba(42,182,215,0.8), transparent)",
            animation: "ic-top-glow 2s ease-in-out infinite",
            pointerEvents: "none",
          }} />

          <Waveform side="left" />

          <div style={{
            fontSize: 15, fontWeight: 700, letterSpacing: 0.3, color: "#ffffff",
            animation: "ic-text-pulse 2s ease-in-out infinite",
            flex: 1, textAlign: "center",
          }}>
            Listening...
          </div>

          <Waveform side="right" />

          <div onClick={toggleCall} title="Tap to end" style={{ cursor: "pointer", marginLeft: 6 }}>
            <EnergyOrb size={48} fast />
          </div>
        </div>
      )}

      {/* ── ALL OTHER STATES — standard bar ── */}
      {!isListening && (
        <div style={{
          maxWidth: 720, margin: "0 auto",
          display: "flex", alignItems: "center", gap: 12,
          /* Slightly lighter charcoal pill on charcoal bar */
          background: active ? "rgba(42,182,215,0.06)" : "#2d3748",
          border: `1px solid ${active ? "rgba(42,182,215,0.25)" : "#4b5563"}`,
          borderRadius: 40,
          padding: "6px 6px 6px 20px",
          transition: "all 0.3s",
        }}>

          {/* Text / transcript area */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
            {active && response && (
              <div style={{
                fontSize: 11, color: "#a8c8e8", lineHeight: 1.4,
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
              placeholder={
                isConnecting ? "Connecting to IC-BOS..." :
                isSpeaking   ? "Speaking..." :
                isError      ? "Error — click orb to retry" :
                active       ? "Type or speak to IC-BOS..." :
                               "Press orb to activate IC-BOS..."
              }
              value={textInput}
              onChange={e => setTextInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && textInput.trim()) sendText(); }}
              disabled={!active}
              style={{
                background: "none", border: "none", outline: "none",
                /* White bold text on charcoal — matches spec */
                color: "#ffffff",
                fontWeight: 700,
                fontSize: 13,
                fontFamily: "inherit",
                width: "100%",
                opacity: active ? 1 : 0.9,
              }}
            />
          </div>

          {/* Energy Core orb button */}
          <div
            onClick={toggleCall}
            title={active ? "End call" : "Start voice session"}
            style={{ cursor: "pointer", position: "relative" }}
          >
            {isConnecting && (
              <>
                <span style={{
                  position: "absolute", inset: -6, borderRadius: "50%",
                  border: "2px solid rgba(255,160,0,0.3)",
                  animation: "pr 1.5s ease-out infinite",
                  pointerEvents: "none",
                }} />
                <span style={{
                  position: "absolute", inset: -14, borderRadius: "50%",
                  border: "1px solid rgba(255,120,0,0.15)",
                  animation: "pr 1.5s ease-out 0.5s infinite",
                  pointerEvents: "none",
                }} />
              </>
            )}
            <EnergyOrb size={56} fast={isSpeaking} />
          </div>
        </div>
      )}

      {/* Status line — visible on charcoal */}
      <div style={{ textAlign: "center", marginTop: 5 }}>
        {vState === "idle" ? (
          <span style={{ fontSize: 9, color: "#6b7280" }}>
            Click orb or{" "}
            <kbd style={{
              padding: "1px 4px",
              background: "#374151",
              borderRadius: 3, fontSize: 8,
              border: "1px solid #4b5563",
              color: "#9ca3af",
            }}>
              ⌘K
            </kbd>
          </span>
        ) : (
          <span style={{
            fontSize: 9, fontFamily: M,
            color: isError ? "#f87171" : isConnecting ? "#fbbf24" : isSpeaking ? "#4ade80" : "#2ab6d7",
          }}>
            {isError ? "Error — try again" : isConnecting ? "Connecting..." : isSpeaking ? "Speaking..." : ""}
          </span>
        )}
      </div>
    </div>
  );
}
