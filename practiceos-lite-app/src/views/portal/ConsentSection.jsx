// ═══════════════════════════════════════════════════════════════════════════════
// src/views/portal/ConsentSection.jsx  (v2)
//
// Uses a direct fetch() call to the sign-consent Edge Function instead of
// supabase.functions.invoke() - this rules out supabase-js wrapper quirks as
// a cause of the "Failed to send a request" silent-preflight issue. We also
// force supabase.auth.refreshSession() before the call to handle JWTs that
// expired while the user was on the page.
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { C } from "../../lib/tokens";

export default function ConsentSection({ patientName = "", onComplete, onClose }) {
  const [loading, setLoading]     = useState(true);
  const [docs, setDocs]           = useState([]);
  const [viewedIds, setViewedIds] = useState({});
  const [checkedIds, setCheckedIds] = useState({});
  const [typedSig, setTypedSig]   = useState("");
  const [viewing, setViewing]     = useState(null);
  const [saving, setSaving]       = useState(false);
  const [banner, setBanner]       = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase
          .from("consent_documents")
          .select("id, consent_type, title, version, body_markdown, effective_from")
          .is("effective_to", null)
          .is("retired_at", null)
          .order("title");
        if (error) throw error;
        setDocs(data || []);
      } catch (e) {
        setBanner({ kind: "error", msg: "Could not load consent policies: " + e.message });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const requiredSigned = docs.length > 0 && docs.every(d => checkedIds[d.id]);
  const sigMatches = typedSig.trim().toLowerCase() === (patientName || "").trim().toLowerCase();
  const canSave = requiredSigned && sigMatches && !saving;

  const handleSave = async () => {
    setBanner(null);
    if (!requiredSigned) { setBanner({ kind: "error", msg: "Please review and check all required policies." }); return; }
    if (!typedSig.trim()) { setBanner({ kind: "error", msg: "Please type your full legal name to sign." }); return; }
    if (!sigMatches) { setBanner({ kind: "error", msg: "The name you typed does not match your patient record (" + patientName + ")." }); return; }

    setSaving(true);

    // ─── Force a session refresh, then pull the JWT explicitly ───────────
    let accessToken = null;
    try {
      await supabase.auth.refreshSession().catch(() => {});
      const { data: { session } } = await supabase.auth.getSession();
      accessToken = session && session.access_token ? session.access_token : null;
    } catch (_e) { /* fall through */ }

    if (!accessToken) {
      setSaving(false);
      setBanner({ kind: "error", msg: "Your login session has expired. Please log out, sign in again, and retry." });
      return;
    }

    // ─── Resolve Supabase URL + anon key ─────────────────────────────────
    const SUPABASE_URL =
      (supabase && supabase.supabaseUrl) ||
      (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_SUPABASE_URL) ||
      "";
    const ANON_KEY =
      (supabase && supabase.supabaseKey) ||
      (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_SUPABASE_ANON_KEY) ||
      "";

    if (!SUPABASE_URL || !ANON_KEY) {
      setSaving(false);
      setBanner({ kind: "error", msg: "Could not resolve Supabase config. Contact support." });
      return;
    }

    const url = SUPABASE_URL.replace(/\/+$/, "") + "/functions/v1/sign-consent";
    const signed = [];
    const failed = [];

    for (const doc of docs) {
      if (!checkedIds[doc.id]) continue;
      try {
        const resp = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type":  "application/json",
            "Authorization": "Bearer " + accessToken,
            "apikey":        ANON_KEY,
          },
          body: JSON.stringify({
            consent_document_id: doc.id,
            typed_name:          typedSig.trim(),
            signed_by_name:      typedSig.trim(),
            relationship:        "self",
          }),
        });
        const payload = await resp.json().catch(() => ({}));
        if (!resp.ok || payload.error) {
          throw new Error(payload.error || ("HTTP " + resp.status));
        }
        signed.push({ title: doc.title, consent_id: payload.consent_id });
      } catch (e) {
        failed.push({ title: doc.title, error: (e && e.message) || "Unknown error" });
      }
    }

    setSaving(false);

    if (failed.length > 0) {
      setBanner({
        kind: "error",
        msg: "Could not sign: " + failed.map(f => f.title + " (" + f.error + ")").join("; "),
      });
      return;
    }

    setBanner({ kind: "ok", msg: "Successfully signed " + signed.length + " consent" + (signed.length === 1 ? "" : "s") + "." });
    if (onComplete) onComplete({ signed, skipped: docs.filter(d => !checkedIds[d.id]).map(d => d.title) });
  };

  if (loading) return <div style={s.loading}>Loading consent policies...</div>;

  return (
    <div>
      <div style={s.intro}>
        By checking the boxes below, you acknowledge you have <strong>read</strong> each policy in full.
        Click <em>View Policy</em> to review the document before you sign. Signed policies are recorded
        with your typed name, the date, and a cryptographic hash of the exact document text for your legal
        protection. You can request paper copies at check-in.
      </div>

      {banner && (
        <div style={banner.kind === "error" ? s.bannerErr : s.bannerOk}>{banner.msg}</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
        {docs.map(doc => {
          const viewed = !!viewedIds[doc.id];
          const checked = !!checkedIds[doc.id];
          return (
            <div key={doc.id} style={s.row}>
              <label style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, cursor: viewed ? "pointer" : "not-allowed", opacity: viewed ? 1 : 0.75 }}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!viewed}
                  onChange={e => setCheckedIds(prev => ({ ...prev, [doc.id]: e.target.checked }))}
                  style={{ accentColor: C.teal, width: 16, height: 16 }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>{doc.title}</div>
                  <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>
                    Version {doc.version}{viewed ? "" : " - please view before signing"}
                  </div>
                </div>
              </label>
              <button
                type="button"
                onClick={() => { setViewing(doc); setViewedIds(prev => ({ ...prev, [doc.id]: true })); }}
                style={viewed ? s.viewBtnOutline : s.viewBtn}
              >
                {viewed ? "View Again" : "View Policy"}
              </button>
            </div>
          );
        })}
      </div>

      <div style={{ marginBottom: 6, fontSize: 11, fontWeight: 700, color: C.textSecondary, letterSpacing: 0.5, textTransform: "uppercase" }}>
        Digital Signature (type your full name)
      </div>
      <input
        type="text"
        value={typedSig}
        onChange={e => setTypedSig(e.target.value)}
        placeholder={patientName || "Full legal name"}
        style={s.sigInput}
      />
      <div style={{ fontSize: 11, color: sigMatches || !typedSig ? C.textTertiary : C.red, marginTop: 6 }}>
        {typedSig && !sigMatches
          ? "Name must match your patient record: " + patientName
          : "By typing your name, you sign the checked policies above."}
      </div>

      <div style={s.actions}>
        <button type="button" disabled={!canSave} onClick={handleSave} style={canSave ? s.primaryBtn : s.primaryBtnDisabled}>
          {saving ? "Signing..." : "Save and Mark Complete"}
        </button>
        <button type="button" onClick={onClose} style={s.ghostBtn}>Close</button>
      </div>

      {viewing && (<PolicyModal doc={viewing} onClose={() => setViewing(null)} />)}
    </div>
  );
}

function PolicyModal({ doc, onClose }) {
  return (
    <div style={s.modalBackdrop} onClick={onClose}>
      <div style={s.modalCard} onClick={e => e.stopPropagation()}>
        <div style={s.modalHeader}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.textPrimary }}>{doc.title}</div>
            <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>
              Version {doc.version} - Effective {doc.effective_from}
            </div>
          </div>
          <button type="button" onClick={onClose} style={s.modalClose}>x</button>
        </div>
        <div style={s.modalBody}>
          <MarkdownBlock text={doc.body_markdown} />
        </div>
        <div style={s.modalFooter}>
          <button type="button" onClick={onClose} style={s.primaryBtn}>I have read this policy</button>
        </div>
      </div>
    </div>
  );
}

function MarkdownBlock({ text }) {
  const lines = String(text || "").split(/\r?\n/);
  const blocks = [];
  let listBuf = null;

  const flushList = () => {
    if (listBuf) {
      blocks.push(<ul key={"ul" + blocks.length} style={{ paddingLeft: 22, margin: "6px 0" }}>
        {listBuf.map((li, i) => <li key={i} style={{ fontSize: 13, color: C.textPrimary, lineHeight: 1.6, marginBottom: 4 }} dangerouslySetInnerHTML={{ __html: renderInline(li) }} />)}
      </ul>);
      listBuf = null;
    }
  };

  lines.forEach((ln, i) => {
    if (/^#{3}\s+/.test(ln))      { flushList(); blocks.push(<h4 key={i} style={s.h4}>{ln.replace(/^#{3}\s+/, "")}</h4>); }
    else if (/^#{2}\s+/.test(ln)) { flushList(); blocks.push(<h3 key={i} style={s.h3}>{ln.replace(/^#{2}\s+/, "")}</h3>); }
    else if (/^#\s+/.test(ln))    { flushList(); blocks.push(<h2 key={i} style={s.h2}>{ln.replace(/^#\s+/, "")}</h2>); }
    else if (/^\s*[-*]\s+/.test(ln)) {
      if (!listBuf) listBuf = [];
      listBuf.push(ln.replace(/^\s*[-*]\s+/, ""));
    } else if (ln.trim() === "") {
      flushList();
      blocks.push(<div key={i} style={{ height: 8 }} />);
    } else {
      flushList();
      blocks.push(<p key={i} style={s.para} dangerouslySetInnerHTML={{ __html: renderInline(ln) }} />);
    }
  });
  flushList();
  return <div>{blocks}</div>;
}

function renderInline(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
}

const s = {
  loading: { padding: 24, textAlign: "center", color: C.textTertiary, fontSize: 12 },
  intro: { fontSize: 12, color: C.textSecondary, background: C.tealBg, border: "0.5px solid " + C.tealBorder, borderRadius: 6, padding: "10px 14px", marginBottom: 14, lineHeight: 1.6 },
  bannerErr: { fontSize: 12, color: C.red, background: C.redBg, border: "0.5px solid " + C.redBorder, borderRadius: 6, padding: "8px 12px", marginBottom: 12 },
  bannerOk:  { fontSize: 12, color: C.green, background: C.greenBg, border: "0.5px solid " + C.greenBorder, borderRadius: 6, padding: "8px 12px", marginBottom: 12 },
  row: { display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: C.bgSecondary, border: "0.5px solid " + C.borderLight, borderRadius: 6 },
  viewBtn:        { fontSize: 11, fontWeight: 600, padding: "5px 12px", borderRadius: 5, background: C.teal, color: "#fff", border: "none", cursor: "pointer", fontFamily: "inherit" },
  viewBtnOutline: { fontSize: 11, fontWeight: 600, padding: "5px 12px", borderRadius: 5, background: "#fff", color: C.teal, border: "0.5px solid " + C.tealBorder, cursor: "pointer", fontFamily: "inherit" },
  sigInput: { width: "100%", padding: "10px 12px", fontSize: 14, fontFamily: "inherit", border: "0.5px solid " + C.borderLight, borderRadius: 6, boxSizing: "border-box" },
  actions: { display: "flex", gap: 8, marginTop: 18, alignItems: "center" },
  primaryBtn:         { fontSize: 12, fontWeight: 700, padding: "9px 18px", borderRadius: 6, background: C.teal,      color: "#fff", border: "none", cursor: "pointer", fontFamily: "inherit" },
  primaryBtnDisabled: { fontSize: 12, fontWeight: 700, padding: "9px 18px", borderRadius: 6, background: C.textTertiary, color: "#fff", border: "none", cursor: "not-allowed", fontFamily: "inherit", opacity: 0.6 },
  ghostBtn:           { fontSize: 12, fontWeight: 600, padding: "9px 16px", borderRadius: 6, background: "transparent", color: C.textSecondary, border: "0.5px solid " + C.borderLight, cursor: "pointer", fontFamily: "inherit" },

  modalBackdrop: { position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 },
  modalCard:     { background: "#fff", borderRadius: 10, width: "min(720px, 100%)", maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 10px 40px rgba(0,0,0,0.25)" },
  modalHeader:   { display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "14px 20px", borderBottom: "0.5px solid " + C.borderLight },
  modalClose:    { background: "transparent", border: "none", fontSize: 18, color: C.textTertiary, cursor: "pointer", padding: 4 },
  modalBody:     { padding: "16px 20px", overflowY: "auto", flex: 1 },
  modalFooter:   { padding: "12px 20px", borderTop: "0.5px solid " + C.borderLight, display: "flex", justifyContent: "flex-end" },

  h2:   { fontSize: 16, fontWeight: 700, color: C.textPrimary, margin: "12px 0 6px" },
  h3:   { fontSize: 14, fontWeight: 700, color: C.textPrimary, margin: "10px 0 5px" },
  h4:   { fontSize: 13, fontWeight: 600, color: C.textPrimary, margin: "8px 0 4px" },
  para: { fontSize: 13, color: C.textPrimary, lineHeight: 1.65, margin: "6px 0" },
};
