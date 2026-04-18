// ═══════════════════════════════════════════════════════════════════════════════
// src/views/portal/PortalDocuments.jsx
// Lists consents. Live schema has no 'status' column - status is derived from
// signed_at / revoked_at / expires_at. consent_type is an enum.
// ═══════════════════════════════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import { supabase, logAudit } from "../../lib/supabaseClient";
import { C, Panel, Badge, Btn, Empty, InfoBox, fmtDate } from "./_ui.jsx";

// Matches the consent_type enum in the database.
const CONSENT_TYPES = [
  { key:"HIPAA Privacy",          description:"Acknowledgment of Notice of Privacy Practices" },
  { key:"General Treatment",      description:"Consent to receive medical treatment" },
  { key:"Financial Policy",       description:"Financial responsibility and billing terms" },
  { key:"Telehealth",             description:"Consent to receive care via telehealth" },
  { key:"Patient Portal",         description:"Use of this patient portal" },
  { key:"Release of Information", description:"Authorization to release medical records" },
];

function deriveStatus(c) {
  if (!c) return { label:"Not on File", variant:"neutral" };
  if (c.revoked_at) return { label:"Revoked", variant:"red" };
  if (c.expires_at && new Date(c.expires_at) < new Date()) return { label:"Expired", variant:"amber" };
  if (c.signed_at) return { label:"Signed", variant:"teal" };
  return { label:"Not Signed", variant:"amber" };
}

export default function PortalDocuments({ patientId }) {
  const [consents, setConsents] = useState([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data, error } = await supabase.from("consents")
          .select("id, consent_type, version, signed_at, signed_method, signed_by_name, relationship, expires_at, revoked_at, revoked_reason, document_url")
          .eq("patient_id", patientId)
          .order("signed_at", { ascending:false, nullsFirst:false });
        if (!active) return;
        if (error) console.warn("[consents] load failed:", error.message);
        setConsents(data || []);
        logAudit({ action:"Read", entityType:"consents", entityId:patientId }).catch(()=>{});
      } catch (e) {
        console.warn("[consents] exception:", e?.message || e);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [patientId]);

  if (loading) return <Empty title="Loading documents..." />;

  const byType = {};
  consents.forEach(c => {
    if (!byType[c.consent_type]) byType[c.consent_type] = [];
    byType[c.consent_type].push(c);
  });

  const seenTypes = Object.keys(byType);
  const extras = seenTypes.filter(t => !CONSENT_TYPES.some(c => c.key === t));
  const allTypes = [
    ...CONSENT_TYPES,
    ...extras.map(e => ({ key:e, description:"" })),
  ];

  return (
    <div>
      <InfoBox>
        This is your record of consents and documents you have signed at the practice.
        To sign or update a consent, contact the front desk at your next visit. (In-portal
        e-signing is planned for a future release.)
      </InfoBox>

      {allTypes.map(t => {
        const signed = (byType[t.key] || [])[0]; // latest
        const status = deriveStatus(signed);
        return (
          <Panel key={t.key} accent={signed && !signed.revoked_at && !isExpired(signed) ? C.tealMid : undefined}>
            <div style={{
              display:"flex", justifyContent:"space-between", alignItems:"flex-start",
              flexWrap:"wrap", gap:10,
            }}>
              <div style={{ flex:1, minWidth:200 }}>
                <div style={{ fontSize:13, fontWeight:600, color:C.textPrimary }}>{t.key}</div>
                {t.description && (
                  <div style={{ fontSize:11, color:C.textTertiary, marginTop:2 }}>{t.description}</div>
                )}
                {signed && (
                  <div style={{ fontSize:11, color:C.textSecondary, marginTop:6 }}>
                    Signed {fmtDate(signed.signed_at)}
                    {signed.version ? " - v" + signed.version : ""}
                    {signed.signed_method ? " via " + signed.signed_method : ""}
                    {signed.expires_at ? " - Expires " + fmtDate(signed.expires_at) : ""}
                  </div>
                )}
                {signed && signed.revoked_at && (
                  <div style={{ fontSize:11, color:C.red, marginTop:3, fontStyle:"italic" }}>
                    Revoked {fmtDate(signed.revoked_at)}{signed.revoked_reason ? ": " + signed.revoked_reason : ""}
                  </div>
                )}
              </div>
              <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                <Badge label={status.label} variant={status.variant} />
                {signed && signed.document_url && (
                  <Btn variant="ghost" onClick={() => window.open(signed.document_url, "_blank", "noopener")}>View</Btn>
                )}
              </div>
            </div>
          </Panel>
        );
      })}

      {seenTypes.length === 0 && (
        <InfoBox variant="amber">
          No signed consents are on file yet. You will be asked to sign required consents
          at your first in-person visit.
        </InfoBox>
      )}
    </div>
  );
}

function isExpired(c) {
  return c.expires_at && new Date(c.expires_at) < new Date();
}
