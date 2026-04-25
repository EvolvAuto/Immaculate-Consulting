// ═══════════════════════════════════════════════════════════════════════════════
// ScribeModal v2 - AI Scribe with smart per-section Insert decisions.
//
// v2 (Apr 2026): Per-section decisions (Insert/Replace/Append/Skip) for CC + SOAP.
//                Modal returns a resolved patch instead of a raw draft.
// v1: Blind append into existing fields.
//
// Audio capture -> Whisper transcription -> Claude draft (CC + SOAP) ->
// per-section apply -> patch returned to encounter editor.
//
// Phases:
//   idle         - initial state; user clicks "Start recording"
//   recording    - actively capturing via MediaRecorder
//   uploading    - audio blob uploading to Storage
//   transcribing - Whisper running
//   drafting     - Claude generating CC + SOAP draft
//   ready        - draft ready for review and per-section apply
//   error        - something failed; user can retry or close
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { C } from "../lib/tokens";
import { Btn, Modal, Textarea } from "./ui";

const MAX_RECORDING_MIN = 30;

// CC has Replace/Skip when populated, Insert/Skip when empty (no Append - one-line field).
// SOAP fields have Replace/Append/Skip when populated, Insert/Skip when empty.
const SECTIONS = [
  { key: "chief_complaint", label: "Chief Complaint", rows: 2, allowAppend: false, defaultIfBoth: "replace" },
  { key: "subjective",      label: "Subjective",      rows: 3, allowAppend: true,  defaultIfBoth: "append" },
  { key: "objective",       label: "Objective",       rows: 3, allowAppend: true,  defaultIfBoth: "append" },
  { key: "assessment",      label: "Assessment",      rows: 3, allowAppend: true,  defaultIfBoth: "append" },
  { key: "plan",            label: "Plan",            rows: 3, allowAppend: true,  defaultIfBoth: "append" },
];

function fmtTime(sec) {
  if (!sec || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
}

function wordCount(text) {
  if (!text) return 0;
  return String(text).trim().split(/\s+/).filter(Boolean).length;
}

function hasContent(text) {
  return !!(text && String(text).trim() !== "");
}

export default function ScribeModal({ encounter, practiceId, profile, onClose, onInsert }) {
  const [phase, setPhase]           = useState("idle");
  const [errorMsg, setErrorMsg]     = useState(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [paused, setPaused]         = useState(false);
  const [transcript, setTranscript] = useState("");
  const [draft, setDraft]           = useState(null);
  const [decisions, setDecisions]   = useState({});
  const [sessionId, setSessionId]   = useState(null);

 const mediaRecorderRef = useRef(null);
  const audioChunksRef   = useRef([]);
  const streamRef        = useRef(null);
  const tickRef          = useRef(null);
  const startTimeRef     = useRef(0);   // start of the CURRENT recording segment
  const accumulatedRef   = useRef(0);   // total seconds across all segments before current

  // VU meter wiring
  const audioCtxRef       = useRef(null);
  const analyserRef       = useRef(null);
  const meterFrameRef     = useRef(0);
  const [levels, setLevels] = useState(() => new Array(32).fill(0));

  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      teardownMeter();
    };
  }, []);

  // When the draft arrives, compute sensible default decisions per section.
  useEffect(() => {
    if (!draft) return;
    const defaults = {};
    for (const s of SECTIONS) {
      const aiHas      = hasContent(draft[s.key]);
      const currentHas = hasContent(encounter[s.key]);
      if (!aiHas) {
        defaults[s.key] = "skip";          // AI returned nothing for this section
      } else if (!currentHas) {
        defaults[s.key] = "insert";        // Empty target - auto-fill
      } else {
        defaults[s.key] = s.defaultIfBoth; // Both populated - per-field default
      }
    }
    setDecisions(defaults);
  }, [draft, encounter]);

  function stopTimer() {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
  }
  function stopStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    teardownMeter();
  }

  function teardownMeter() {
    if (meterFrameRef.current) {
      cancelAnimationFrame(meterFrameRef.current);
      meterFrameRef.current = 0;
    }
    if (analyserRef.current) {
      try { analyserRef.current.disconnect(); } catch (e) { /* ignore */ }
      analyserRef.current = null;
    }
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close(); } catch (e) { /* ignore */ }
      audioCtxRef.current = null;
    }
    setLevels(new Array(32).fill(0));
  }

  function startMeter(stream) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;

      const buf = new Uint8Array(analyser.fftSize);
      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(buf);
        // RMS amplitude over the buffer, normalized to 0..1
        let sumSq = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128; // -1..1
          sumSq += v * v;
        }
        const rms = Math.sqrt(sumSq / buf.length);
        // Boost so quiet speech reads visibly; clamp to 1.
        const level = Math.min(1, rms * 2.4);
        setLevels((prev) => {
          const next = prev.slice(1);
          next.push(level);
          return next;
        });
        meterFrameRef.current = requestAnimationFrame(tick);
      };
      meterFrameRef.current = requestAnimationFrame(tick);
    } catch (e) {
      console.warn("[Scribe] VU meter init failed:", e?.message || e);
    }
  }

  async function startRecording() {
    setErrorMsg(null);
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Your browser does not support audio recording.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      audioChunksRef.current = [];

      let mimeType = "audio/webm";
      if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
        mimeType = "audio/webm;codecs=opus";
      } else if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported("audio/mp4")) {
        mimeType = "audio/mp4";
      }

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };
      recorder.onstop = handleRecorderStop;
      recorder.start();
      startMeter(stream);

      startTimeRef.current = Date.now();
      accumulatedRef.current = 0;
      setElapsedSec(0);
      setPaused(false);
      tickRef.current = setInterval(() => {
        const sec = accumulatedRef.current + Math.floor((Date.now() - startTimeRef.current) / 1000);
        setElapsedSec(sec);
        if (sec >= MAX_RECORDING_MIN * 60) stopRecording();
      }, 250);

      setPhase("recording");
    } catch (e) {
      stopStream();
      const name = e && e.name ? e.name : "";
      const rawMsg = e && e.message ? e.message : String(e);
      let msg;
      if (name === "NotAllowedError" || rawMsg.includes("Permission denied")) {
        msg = "Microphone access is blocked for this site. Click the lock icon in the address bar, set Microphone to Allow, then reload the page and try again.";
      } else if (name === "NotFoundError") {
        msg = "No microphone detected on this device. Plug in a mic or check your audio hardware.";
      } else if (name === "NotReadableError") {
        msg = "The microphone is being used by another app. Close other apps using the mic (Zoom, Meet, etc.) and try again.";
      } else if (name === "SecurityError") {
        msg = "Recording requires a secure (HTTPS) connection.";
      } else {
        msg = "Could not start recording: " + rawMsg;
      }
      setErrorMsg(msg);
      setPhase("error");
    }
  }

  function pauseRecording() {
    try {
      const r = mediaRecorderRef.current;
      if (r && r.state === "recording") {
        r.pause();
        // Bank the current segment's elapsed time and stop ticking the timer.
        accumulatedRef.current += Math.floor((Date.now() - startTimeRef.current) / 1000);
        stopTimer();
        setPaused(true);
      }
    } catch (e) {
      console.warn("[Scribe] pause failed:", e?.message || e);
    }
  }

  function resumeRecording() {
    try {
      const r = mediaRecorderRef.current;
      if (r && r.state === "paused") {
        r.resume();
        // New segment starts now; timer ticks from the banked accumulator.
        startTimeRef.current = Date.now();
        setPaused(false);
        tickRef.current = setInterval(() => {
          const sec = accumulatedRef.current + Math.floor((Date.now() - startTimeRef.current) / 1000);
          setElapsedSec(sec);
          if (sec >= MAX_RECORDING_MIN * 60) stopRecording();
        }, 250);
      }
    } catch (e) {
      console.warn("[Scribe] resume failed:", e?.message || e);
    }
  }

  function stopRecording() {
    try {
      const r = mediaRecorderRef.current;
      if (r && r.state !== "inactive") {
        // .stop() works from both 'recording' and 'paused' states.
        r.stop();
      }
    } catch (e) { /* fall through to cleanup */ }
    stopTimer();
    setPaused(false);
  }

 async function handleRecorderStop() {
    // Use accumulated recording time (excludes pauses) so Whisper cost is accurate.
    // If currently paused at stop time, accumulator already has the full total.
    // If currently recording at stop time, add the in-flight segment.
    const durationSec = Math.max(
      1,
      paused
        ? accumulatedRef.current
        : accumulatedRef.current + Math.floor((Date.now() - startTimeRef.current) / 1000)
    );
    const recorder = mediaRecorderRef.current;
    const mimeType = recorder ? (recorder.mimeType || "audio/webm") : "audio/webm";
    const blob = new Blob(audioChunksRef.current, { type: mimeType });
    audioChunksRef.current = [];
    stopStream();

    if (!blob || blob.size < 1024) {
      setErrorMsg("Recording was too short or empty. Please try again.");
      setPhase("error");
      return;
    }

    setPhase("uploading");
    try {
      const ext = mimeType.includes("mp4") ? "mp4" : mimeType.includes("ogg") ? "ogg" : "webm";

      const { data: row, error: insErr } = await supabase
        .from("cmd_scribe_sessions")
        .insert({
          practice_id: practiceId,
          patient_id:  encounter.patient_id || null,
          encounter_id: encounter.id || null,
          status: "recording",
          audio_duration_sec: durationSec,
          audio_mime_type: mimeType,
          audio_size_bytes: blob.size,
          created_by: profile.id,
        })
        .select("id")
        .single();
      if (insErr) throw new Error("Could not create scribe session: " + insErr.message);
      const sid = row.id;
      setSessionId(sid);

      const path = practiceId + "/" + sid + "." + ext;
      const { error: upErr } = await supabase.storage
        .from("cmd-scribe-audio")
        .upload(path, blob, { contentType: mimeType, upsert: false });
      if (upErr) throw new Error("Audio upload failed: " + upErr.message);

      const { error: pathErr } = await supabase
        .from("cmd_scribe_sessions")
        .update({ audio_storage_path: path, status: "uploaded" })
        .eq("id", sid);
      if (pathErr) throw new Error("Could not save audio path: " + pathErr.message);

      setPhase("transcribing");
      const transcribeRes = await invokeFn("cmd-scribe-transcribe", { sessionId: sid });
      if (transcribeRes.error) throw new Error(transcribeRes.error);
      setTranscript(String(transcribeRes.transcript || ""));
      if (!transcribeRes.transcript || !String(transcribeRes.transcript).trim()) {
        throw new Error("Transcript came back empty. Audio may have been silent or unclear.");
      }

      setPhase("drafting");
      const draftRes = await invokeFn("cmd-scribe-soap-draft", { sessionId: sid });
      if (draftRes.error) throw new Error(draftRes.error);
      setDraft(draftRes.draft || null);
      setPhase("ready");
    } catch (e) {
      setErrorMsg(e.message || String(e));
      setPhase("error");
    }
  }

  async function invokeFn(name, body) {
    try {
      const { data, error } = await supabase.functions.invoke(name, { body });
      if (error) {
        let msg = error.message || String(error);
        if (data && data.error) msg = data.error;
        return { error: msg };
      }
      if (data && data.error) return { error: data.error };
      return data || {};
    } catch (e) {
      return { error: e.message || String(e) };
    }
  }

  // Resolve per-section decisions into a single patch the encounter editor
  // can shallow-merge into its state.
  function buildPatch() {
    if (!draft) return {};
    const patch = {};
    for (const s of SECTIONS) {
      const decision = decisions[s.key] || "skip";
      if (decision === "skip") continue;
      const aiVal = String(draft[s.key] || "");
      const currentVal = String(encounter[s.key] || "");
      if (decision === "insert" || decision === "replace") {
        patch[s.key] = aiVal;
      } else if (decision === "append") {
        patch[s.key] = currentVal ? currentVal + "\n\n" + aiVal : aiVal;
      }
    }
    return patch;
  }

  async function handleApply() {
    if (!draft) return;
    const patch = buildPatch();

    if (sessionId) {
      // Mark the session as inserted; the audit trigger fires server-side.
      try {
        await supabase
          .from("cmd_scribe_sessions")
          .update({ status: "inserted", inserted_into_encounter_at: new Date().toISOString() })
          .eq("id", sessionId);
      } catch (e) {
        console.warn("[ScribeModal] could not mark session inserted:", e?.message || e);
      }
    }

    onInsert(patch, sessionId);
  }

  async function handleDiscard() {
    if (sessionId) {
      try {
        await supabase.from("cmd_scribe_sessions")
          .update({ status: "discarded", discarded_at: new Date().toISOString() })
          .eq("id", sessionId);
      } catch (e) { /* swallow; user wants to leave */ }
    }
    onClose();
  }

  function handleRetry() {
    setErrorMsg(null);
    setSessionId(null);
    setDraft(null);
    setDecisions({});
    setTranscript("");
    setElapsedSec(0);
    setPhase("idle");
  }

  const isBusy = phase === "uploading" || phase === "transcribing" || phase === "drafting";
  const closeHandler = isBusy
    ? () => {}
    : (phase === "ready"
        ? handleDiscard
        : (phase === "recording" ? () => { stopRecording(); onClose(); } : onClose));

  // Apply enabled when at least one section has a non-skip decision.
  const anyNonSkip = SECTIONS.some((s) => decisions[s.key] && decisions[s.key] !== "skip");

  return (
    <Modal title="AI Scribe" onClose={closeHandler} maxWidth={720}>
      {phase === "idle" && (
        <div>
          <div style={{ padding: 16, background: C.tealBg, border: "1px solid " + C.tealBorder, borderRadius: 8, marginBottom: 12, fontSize: 12, color: C.textSecondary, lineHeight: 1.5 }}>
            <div style={{ fontWeight: 700, color: C.textPrimary, marginBottom: 6 }}>How this works</div>
            Record yourself dictating the encounter. Whisper transcribes the audio, then Claude drafts a Chief Complaint and SOAP note. You decide per section whether to insert, replace, append, or skip. Audio is stored encrypted and purged automatically.
          </div>
          <div style={{ padding: 12, background: C.amberBg, borderRadius: 8, marginBottom: 16, fontSize: 11, color: C.textSecondary, lineHeight: 1.5 }}>
            <b>HIPAA reminder:</b> Audio leaves Supabase to OpenAI Whisper and Anthropic Claude. Both vendors must have signed BAAs before this is used on real patients.
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Btn variant="outline" onClick={onClose}>Cancel</Btn>
            <Btn onClick={startRecording}>Start Recording</Btn>
          </div>
        </div>
      )}

      {phase === "recording" && (
        <div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "32px 16px", background: C.bgSecondary, borderRadius: 8, marginBottom: 16 }}>
            <div style={{
              width: 72, height: 72, borderRadius: 36,
              background: paused ? C.amber : C.red,
              display: "flex", alignItems: "center", justifyContent: "center",
              marginBottom: 16,
              boxShadow: paused ? "0 0 0 8px rgba(133,79,11,0.15)" : "0 0 0 8px rgba(220,38,38,0.15)",
              animation: paused ? "none" : "scribePulse 1.6s ease-in-out infinite",
            }}>
              {paused ? (
                <div style={{ display: "flex", gap: 4 }}>
                  <div style={{ width: 5, height: 18, background: "white", borderRadius: 1 }} />
                  <div style={{ width: 5, height: 18, background: "white", borderRadius: 1 }} />
                </div>
              ) : (
                <div style={{ width: 14, height: 14, borderRadius: "50%", background: "white" }} />
              )}
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: C.textPrimary, marginBottom: 6 }}>{fmtTime(elapsedSec)}</div>

            {/* VU meter: 32 bars, rolling ~1s window. Color matches recording state. */}
            <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 36, marginBottom: 8, padding: "0 2px" }}>
              {levels.map((lv, i) => {
                const h = Math.max(2, Math.round(lv * 36));
                return (
                  <div key={i} style={{
                    width: 5,
                    height: h,
                    borderRadius: 1,
                    background: paused ? C.borderMid : C.red,
                    opacity: paused ? 0.5 : (0.45 + (i / levels.length) * 0.55), // fade older samples
                    transition: "height 60ms linear",
                  }} />
                );
              })}
            </div>

            <div style={{ fontSize: 11, color: paused ? C.amber : C.textTertiary, fontWeight: paused ? 700 : 400 }}>
              {paused ? "Paused" : "Recording. Max " + MAX_RECORDING_MIN + " minutes."}
            </div>
            <style>{"@keyframes scribePulse { 0%, 100% { box-shadow: 0 0 0 8px rgba(220,38,38,0.15); } 50% { box-shadow: 0 0 0 14px rgba(220,38,38,0.05); } }"}</style>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            {paused
              ? <Btn variant="outline" onClick={resumeRecording}>Resume</Btn>
              : <Btn variant="outline" onClick={pauseRecording}>Pause</Btn>
            }
            <Btn onClick={stopRecording}>Stop and Process</Btn>
          </div>
        </div>
      )}

      {isBusy && (
        <div style={{ padding: 32, textAlign: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.textPrimary, marginBottom: 8 }}>
            {phase === "uploading"    && "Uploading audio..."}
            {phase === "transcribing" && "Transcribing with Whisper..."}
            {phase === "drafting"     && "Generating draft..."}
          </div>
          <div style={{ fontSize: 11, color: C.textTertiary }}>
            {phase === "uploading"    && "Securing the recording in encrypted storage."}
            {phase === "transcribing" && "Usually a few seconds per minute of audio."}
            {phase === "drafting"     && "Claude is structuring the transcript into Chief Complaint and SOAP."}
          </div>
          <div style={{ marginTop: 24, height: 4, background: C.borderLight, borderRadius: 2, overflow: "hidden", position: "relative" }}>
            <div style={{ position: "absolute", top: 0, left: 0, width: "40%", height: "100%", background: C.teal, animation: "scribeBar 1.4s ease-in-out infinite" }} />
          </div>
          <style>{"@keyframes scribeBar { 0% { transform: translateX(-100%); } 50% { transform: translateX(80%); } 100% { transform: translateX(220%); } }"}</style>
        </div>
      )}

      {phase === "ready" && draft && (
        <div>
          {draft.note && (
            <div style={{ padding: 10, background: C.amberBg, borderRadius: 8, marginBottom: 14, fontSize: 12, color: C.textPrimary, lineHeight: 1.5 }}>
              <b>Reviewer note:</b> {draft.note}
            </div>
          )}

          {SECTIONS.map((s) => {
            const aiVal      = String(draft[s.key] || "");
            const aiHas      = hasContent(aiVal);
            const currentVal = String(encounter[s.key] || "");
            const currentHas = hasContent(currentVal);
            const decision   = decisions[s.key] || "skip";

            // AI returned nothing for this section: compact "skipped" row, no textarea.
            if (!aiHas) {
              return (
                <div key={s.key} style={{ padding: "8px 10px", marginBottom: 10, background: C.bgSecondary, borderRadius: 6, fontSize: 11, color: C.textTertiary }}>
                  <b style={{ color: C.textSecondary }}>{s.label}:</b> AI did not generate content for this section.
                </div>
              );
            }

            const options = currentHas
              ? (s.allowAppend ? ["replace", "append", "skip"] : ["replace", "skip"])
              : ["insert", "skip"];

            const cw = wordCount(currentVal);
            const contextMsg = currentHas
              ? "Encounter has " + cw + " word" + (cw === 1 ? "" : "s") + " in " + s.label + "."
              : "Encounter " + s.label + " is empty.";

            return (
              <div key={s.key} style={{ marginBottom: 14 }}>
                <Textarea
                  label={s.label}
                  value={aiVal}
                  onChange={(v) => setDraft({ ...draft, [s.key]: v })}
                  rows={s.rows}
                />
                <div style={{
                  marginTop: -6,
                  padding: "6px 10px",
                  background: currentHas ? C.amberBg : C.tealBg,
                  borderRadius: 6,
                  fontSize: 11,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                }}>
                  <span style={{ color: C.textSecondary, flex: "1 1 auto", minWidth: 200 }}>
                    {contextMsg}
                  </span>
                  <div style={{ display: "flex", gap: 10 }}>
                    {options.map((opt) => (
                      <label key={opt} style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", fontSize: 11, color: C.textPrimary, textTransform: "capitalize" }}>
                        <input
                          type="radio"
                          name={"decision-" + s.key}
                          checked={decision === opt}
                          onChange={() => setDecisions({ ...decisions, [s.key]: opt })}
                        />
                        {opt}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}

          <details style={{ marginTop: 4, marginBottom: 12 }}>
            <summary style={{ cursor: "pointer", fontSize: 11, color: C.textTertiary, padding: "4px 0" }}>View transcript</summary>
            <div style={{ padding: 10, background: C.bgSecondary, borderRadius: 6, fontSize: 11, color: C.textSecondary, marginTop: 6, whiteSpace: "pre-wrap", maxHeight: 160, overflowY: "auto" }}>
              {transcript}
            </div>
          </details>

          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 8, borderTop: "0.5px solid " + C.borderLight, paddingTop: 12 }}>
            <Btn variant="outline" onClick={handleDiscard}>Discard</Btn>
            <Btn onClick={handleApply} disabled={!anyNonSkip}>Apply</Btn>
          </div>
        </div>
      )}

      {phase === "error" && (
        <div>
          <div style={{ padding: 12, background: "#fef2f2", border: "1px solid " + C.red, borderRadius: 8, marginBottom: 16, fontSize: 12, color: C.red, lineHeight: 1.5 }}>
            {errorMsg || "Something went wrong."}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Btn variant="outline" onClick={onClose}>Close</Btn>
            <Btn onClick={handleRetry}>Try Again</Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}
