// ═══════════════════════════════════════════════════════════════════════════════
// ScribeModal - AI Scribe V1 (Command tier, Shallow Scribe)
// Audio capture -> Whisper transcription -> Claude SOAP draft -> insert into encounter.
// Opens from EncounterEditor (ClinicalView).
//
// Phases:
//   idle         - initial state; user clicks "Start recording"
//   recording    - actively capturing via MediaRecorder
//   uploading    - audio blob uploading to Storage
//   transcribing - Whisper running
//   drafting     - Claude generating SOAP draft
//   ready        - draft ready for review and insert
//   error        - something failed; user can retry or close
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { C } from "../lib/tokens";
import { Btn, Modal, Textarea } from "./ui";

// Cap recording length to avoid huge uploads. Whisper accepts up to 25MB raw.
const MAX_RECORDING_MIN = 30;

function fmtTime(sec) {
  if (!sec || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
}

export default function ScribeModal({ encounter, practiceId, profile, onClose, onInsert }) {
  const [phase, setPhase]           = useState("idle");
  const [errorMsg, setErrorMsg]     = useState(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [draft, setDraft]           = useState(null);
  const [sessionId, setSessionId]   = useState(null);

  // Refs for media capture
  const mediaRecorderRef = useRef(null);
  const audioChunksRef   = useRef([]);
  const streamRef        = useRef(null);
  const tickRef          = useRef(null);
  const startTimeRef     = useRef(0);

  useEffect(() => {
    return () => {
      // Cleanup on unmount
      if (tickRef.current) clearInterval(tickRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  function stopTimer() {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
  }
  function stopStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
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

      // Pick a mime that Whisper accepts and the browser supports
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

      startTimeRef.current = Date.now();
      setElapsedSec(0);
      tickRef.current = setInterval(() => {
        const sec = Math.floor((Date.now() - startTimeRef.current) / 1000);
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

  function stopRecording() {
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
    } catch (e) { /* fall through to cleanup */ }
    stopTimer();
  }

  async function handleRecorderStop() {
    const durationSec = Math.max(1, Math.floor((Date.now() - startTimeRef.current) / 1000));
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

      // 1. Insert session row first so we have a stable id for the storage path.
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

      // 2. Upload audio to Storage at {practice_id}/{session_id}.{ext}
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

      // 3. Transcribe
      setPhase("transcribing");
      const transcribeRes = await invokeFn("cmd-scribe-transcribe", { sessionId: sid });
      if (transcribeRes.error) throw new Error(transcribeRes.error);
      setTranscript(String(transcribeRes.transcript || ""));
      if (!transcribeRes.transcript || !String(transcribeRes.transcript).trim()) {
        throw new Error("Transcript came back empty. Audio may have been silent or unclear.");
      }

      // 4. SOAP draft
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

  function handleInsert() {
    if (!draft) return;
    onInsert(draft, sessionId);
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
    setTranscript("");
    setElapsedSec(0);
    setPhase("idle");
  }

  const isBusy = phase === "uploading" || phase === "transcribing" || phase === "drafting";
  const closeHandler = isBusy ? () => {} : (phase === "ready" ? handleDiscard : (phase === "recording" ? () => { stopRecording(); onClose(); } : onClose));

  return (
    <Modal title="AI Scribe" onClose={closeHandler} maxWidth={680}>
      {phase === "idle" && (
        <div>
          <div style={{ padding: 16, background: C.tealBg, border: "1px solid " + C.tealBorder, borderRadius: 8, marginBottom: 12, fontSize: 12, color: C.textSecondary, lineHeight: 1.5 }}>
            <div style={{ fontWeight: 700, color: C.textPrimary, marginBottom: 6 }}>How this works</div>
            Record yourself dictating the encounter. Whisper transcribes the audio, then Claude drafts a SOAP note. You review, edit, and insert it into the encounter. Audio is stored encrypted and purged automatically.
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
            <div style={{ width: 72, height: 72, borderRadius: 36, background: C.red, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16, boxShadow: "0 0 0 8px rgba(220,38,38,0.15)", animation: "scribePulse 1.6s ease-in-out infinite" }}>
              <div style={{ width: 14, height: 14, borderRadius: "50%", background: "white" }} />
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: C.textPrimary, marginBottom: 6 }}>{fmtTime(elapsedSec)}</div>
            <div style={{ fontSize: 11, color: C.textTertiary }}>Recording. Max {MAX_RECORDING_MIN} minutes.</div>
            <style>{"@keyframes scribePulse { 0%, 100% { box-shadow: 0 0 0 8px rgba(220,38,38,0.15); } 50% { box-shadow: 0 0 0 14px rgba(220,38,38,0.05); } }"}</style>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Btn onClick={stopRecording}>Stop and Process</Btn>
          </div>
        </div>
      )}

      {isBusy && (
        <div style={{ padding: 32, textAlign: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.textPrimary, marginBottom: 8 }}>
            {phase === "uploading"    && "Uploading audio..."}
            {phase === "transcribing" && "Transcribing with Whisper..."}
            {phase === "drafting"     && "Generating SOAP draft..."}
          </div>
          <div style={{ fontSize: 11, color: C.textTertiary }}>
            {phase === "uploading"    && "Securing the recording in encrypted storage."}
            {phase === "transcribing" && "Usually a few seconds per minute of audio."}
            {phase === "drafting"     && "Claude is structuring the transcript into SOAP format."}
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
            <div style={{ padding: 10, background: C.amberBg, borderRadius: 8, marginBottom: 12, fontSize: 12, color: C.textPrimary, lineHeight: 1.5 }}>
              <b>Reviewer note:</b> {draft.note}
            </div>
          )}
          <Textarea label="Subjective" value={draft.subjective} onChange={(v) => setDraft({ ...draft, subjective: v })} rows={3} />
          <Textarea label="Objective"  value={draft.objective}  onChange={(v) => setDraft({ ...draft, objective:  v })} rows={3} />
          <Textarea label="Assessment" value={draft.assessment} onChange={(v) => setDraft({ ...draft, assessment: v })} rows={3} />
          <Textarea label="Plan"       value={draft.plan}       onChange={(v) => setDraft({ ...draft, plan:       v })} rows={3} />

          <details style={{ marginTop: 4, marginBottom: 12 }}>
            <summary style={{ cursor: "pointer", fontSize: 11, color: C.textTertiary, padding: "4px 0" }}>View transcript</summary>
            <div style={{ padding: 10, background: C.bgSecondary, borderRadius: 6, fontSize: 11, color: C.textSecondary, marginTop: 6, whiteSpace: "pre-wrap", maxHeight: 160, overflowY: "auto" }}>
              {transcript}
            </div>
          </details>

          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 8, borderTop: "0.5px solid " + C.borderLight, paddingTop: 12 }}>
            <Btn variant="outline" onClick={handleDiscard}>Discard</Btn>
            <Btn onClick={handleInsert}>Insert into Encounter</Btn>
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
