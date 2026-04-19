// ═══════════════════════════════════════════════════════════════════════════════
// src/views/portal/PortalVisits.jsx
// Read-only list of signed encounters. Shows vitals, diagnoses, care instructions,
// prescriptions, labs ordered. RLS restricts to status='Signed' only.
// ═══════════════════════════════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import { supabase, logAudit } from "../../lib/supabaseClient";
import { C, Panel, Badge, Btn, SectionHead, Empty, fmtDate } from "./_ui.jsx";

export default function PortalVisits({ patientId, practiceId }) {
  const [encounters, setEncounters] = useState([]);
  const [providers, setProviders]   = useState([]);
  const [selected, setSelected]     = useState(null);
  const [loading, setLoading]       = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [e, p] = await Promise.all([
          supabase.from("encounters")
            .select("id, encounter_date, appt_type, provider_id, status, vitals, diagnoses, cpt_codes, orders, referrals, plan, chief_complaint, subjective, objective, assessment, created_at")
            .eq("patient_id", patientId).eq("status", "Signed")
            .order("encounter_date", { ascending:false }).limit(30),
          supabase.from("providers")
            .select("id, first_name, last_name, credential")
            .eq("practice_id", practiceId),
        ]);
        if (!active) return;
        setEncounters(e.data || []);
        setProviders(p.data || []);
        if ((e.data || []).length > 0) setSelected((e.data[0] || {}).id);
        logAudit({ action:"Read", entityType:"encounters", entityId:patientId }).catch(()=>{});
      } catch (ex) {
        console.warn("[visits] load failed:", ex?.message || ex);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [patientId, practiceId]);

  const providerLabel = (id) => {
    const p = providers.find(x => x.id === id);
    return p ? ("Dr. " + p.last_name + ", " + p.credential) : "Your provider";
  };

  if (loading) return <Empty title="Loading visit summaries..." />;
  if (encounters.length === 0)
    return <Empty title="No visit summaries yet" subtitle="Signed notes from your visits will appear here." />;

  const v = encounters.find(x => x.id === selected) || encounters[0];

  return (
    <div>
      {/* Visit selector pills */}
      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:12 }}>
        {encounters.map(e => (
          <button key={e.id} onClick={() => setSelected(e.id)} style={{
            padding:"5px 10px", borderRadius:20, border:"0.5px solid " + C.borderMid,
            fontSize:11, fontWeight:500, cursor:"pointer", fontFamily:"inherit",
            background: selected === e.id ? C.tealBg : "transparent",
            color:     selected === e.id ? C.teal   : C.textSecondary,
            borderColor: selected === e.id ? C.tealBorder : C.borderMid,
          }}>{fmtDate(e.encounter_date)} - {e.appt_type || "Visit"}</button>
        ))}
      </div>

      <Panel accent={C.tealMid}>
        <div style={{
          display:"flex", justifyContent:"space-between", alignItems:"flex-start",
          flexWrap:"wrap", gap:8,
        }}>
          <div>
            <div style={{ fontSize:10, color:C.textTertiary, marginBottom:2 }}>{fmtDate(v.encounter_date)}</div>
            <div style={{ fontSize:15, fontWeight:700, color:C.textPrimary }}>
              {v.appt_type || "Visit"}
            </div>
            <div style={{ fontSize:11, color:C.textSecondary, marginTop:2 }}>{providerLabel(v.provider_id)}</div>
          </div>
          <Badge label="Signed" variant="teal" />
        </div>

        {v.vitals && Object.keys(v.vitals || {}).length > 0 && (
          <div style={{
            display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(85px, 1fr))", gap:6, marginTop:12,
          }}>
            {Object.entries(v.vitals).map(([k, val]) => (
              <div key={k} style={{
                background:C.bgSecondary, borderRadius:6, padding:"8px 10px", textAlign:"center",
              }}>
                <div style={{
                  fontSize:9, textTransform:"uppercase", letterSpacing:"0.5px", color:C.textTertiary,
                }}>{prettyVital(k)}</div>
                <div style={{ fontSize:12, fontWeight:700, color:C.teal, marginTop:3 }}>{String(val)}</div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {v.chief_complaint && (
        <Section title="Chief Complaint"><Body>{v.chief_complaint}</Body></Section>
      )}

      {v.assessment && (
        <Section title="Assessment"><Body>{v.assessment}</Body></Section>
      )}

      {v.plan && (
        <Section title="Plan / Care Instructions"><Body>{v.plan}</Body></Section>
      )}

      {v.diagnoses && Array.isArray(v.diagnoses) && v.diagnoses.length > 0 && (
        <Section title="Diagnoses">
          {v.diagnoses.map((d, i) => (
            <div key={i} style={{
              background:C.bgSecondary, padding:"6px 10px", borderRadius:5,
              fontFamily:"'DM Mono', monospace", fontSize:12, color:C.textPrimary, marginBottom:4,
            }}>
              {typeof d === "object" ? ((d.code || "") + " - " + (d.description || "")) : String(d)}
            </div>
          ))}
        </Section>
      )}

      {v.orders && Array.isArray(v.orders) && v.orders.length > 0 && (
        <Section title="Labs / Orders">
          <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
            {v.orders.map((o, i) => (
              <Badge key={i} label={typeof o === "object" ? (o.name || o.code || "Order") : String(o)} variant="blue" />
            ))}
          </div>
        </Section>
      )}

      {v.referrals && Array.isArray(v.referrals) && v.referrals.length > 0 && (
        <Section title="Referrals">
          {v.referrals.map((r, i) => (
            <Body key={i}>
              {typeof r === "object" ? ((r.specialty || "") + ": " + (r.provider || r.notes || "")) : String(r)}
            </Body>
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <Panel>
      <div style={{
        fontSize:10, textTransform:"uppercase", letterSpacing:"0.5px",
        color:C.textTertiary, marginBottom:8, fontWeight:600,
      }}>{title}</div>
      {children}
    </Panel>
  );
}

function Body({ children }) {
  return <div style={{ fontSize:12, color:C.textPrimary, lineHeight:1.65, whiteSpace:"pre-wrap" }}>{children}</div>;
}

function prettyVital(k) {
  const map = { bp:"BP", hr:"Heart Rate", wt:"Weight", ht:"Height", temp:"Temp", o2:"O2 Sat", rr:"Resp Rate", bmi:"BMI" };
  return map[k] || k.toUpperCase();
}
