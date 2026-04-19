// ═══════════════════════════════════════════════════════════════════════════════
// src/views/portal/PortalLabs.jsx
// Lab results. Matches live schema: result_unit, is_abnormal, is_critical,
// released_to_portal, lab_name, test_name. RLS filters released_to_portal=true.
// ═══════════════════════════════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import { supabase, logAudit } from "../../lib/supabaseClient";
import { C, Panel, Badge, Btn, Empty, InfoBox, fmtDate } from "./_ui.jsx";

export default function PortalLabs({ patientId }) {
  const [labs, setLabs] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data, error } = await supabase.from("lab_results")
          .select("id, lab_name, test_code, test_name, result_value, result_unit, reference_range, is_abnormal, is_critical, collected_at, resulted_at, released_at, patient_notes")
          .eq("patient_id", patientId)
          .eq("released_to_portal", true)
          .order("resulted_at", { ascending: false, nullsFirst: false })
          .order("collected_at", { ascending: false, nullsFirst: false })
          .limit(100);
        if (!active) return;
        if (error) console.warn("[labs] load failed:", error.message);
        setLabs(data || []);
        logAudit({ action:"Read", entityType:"lab_results", entityId:patientId }).catch(()=>{});
      } catch (e) {
        console.warn("[labs] load exception:", e?.message || e);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [patientId]);

  if (loading) return <Empty title="Loading lab results..." />;
  if (labs.length === 0)
    return <Empty title="No lab results yet" subtitle="When your provider releases results, they will appear here." />;

  const grouped = groupLabs(labs);

  return (
    <div>
      <InfoBox>
        Results shown here have been released to you by your provider. For questions about any
        result, send a secure message to your care team.
      </InfoBox>

      {grouped.map(g => {
        const isOpen = !!expanded[g.key];
        const hasAbnormal = g.rows.some(r => r.is_abnormal);
        const hasCritical = g.rows.some(r => r.is_critical);
        return (
          <Panel key={g.key}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
              <div>
                <div style={{ fontSize:13, fontWeight:600, color:C.textPrimary }}>{g.panel}</div>
                <div style={{ fontSize:11, color:C.textTertiary, marginTop:2 }}>
                  {g.collected_at ? "Collected " + fmtDate(g.collected_at) : ""}
                  {g.released_at ? " - Released " + fmtDate(g.released_at) : ""}
                </div>
              </div>
              <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
                {hasCritical ? <Badge label="Critical Result" variant="red" /> :
                 hasAbnormal ? <Badge label="Some Abnormal" variant="amber" /> :
                                <Badge label="All Normal" variant="teal" />}
                <Btn variant="secondary"
                     onClick={() => setExpanded({ ...expanded, [g.key]: !isOpen })}>
                  {isOpen ? "Collapse" : "View Results"}
                </Btn>
              </div>
            </div>

            {isOpen && (
              <div style={{ marginTop:12, overflowX:"auto" }}>
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                  <thead>
                    <tr style={{ background:C.bgSecondary }}>
                      <Th>Test</Th><Th>Result</Th><Th>Ref Range</Th><Th>Status</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map(r => (
                      <tr key={r.id} style={{ borderTop:"0.5px solid " + C.borderLight }}>
                        <Td>{r.test_name || r.test_code || "--"}</Td>
                        <Td>
                          <span style={{ fontWeight:600, color: r.is_critical ? C.red : (r.is_abnormal ? C.amber : C.green) }}>
                            {r.result_value}
                            {r.result_unit && <span style={{ fontSize:10, color:C.textTertiary, fontWeight:400, marginLeft:4 }}>{r.result_unit}</span>}
                          </span>
                        </Td>
                        <Td><span style={{ color:C.textSecondary }}>{r.reference_range || "--"}</span></Td>
                        <Td>
                          {r.is_critical ? <Badge label="Critical" variant="red" /> :
                           r.is_abnormal ? <Badge label="Abnormal" variant="amber" /> :
                                            <Badge label="Normal" variant="teal" />}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {g.rows.some(r => r.patient_notes) && (
                  <div style={{
                    marginTop:10, padding:"8px 12px", background:C.tealBg,
                    border:"0.5px solid " + C.tealBorder, borderRadius:6,
                    fontSize:11.5, color:C.tealDark, lineHeight:1.55,
                  }}>
                    <strong>Note from your provider: </strong>
                    {g.rows.filter(r => r.patient_notes).map(r => r.patient_notes).join(" - ")}
                  </div>
                )}
              </div>
            )}
          </Panel>
        );
      })}
    </div>
  );
}

function Th({ children }) {
  return <th style={{ padding:"7px 10px", textAlign:"left", fontSize:10, fontWeight:600,
    textTransform:"uppercase", letterSpacing:"0.05em", color:C.textTertiary }}>{children}</th>;
}
function Td({ children }) {
  return <td style={{ padding:"9px 10px", fontSize:12, color:C.textPrimary }}>{children}</td>;
}

function groupLabs(labs) {
  const map = {}, out = [];
  labs.forEach(l => {
    const dateKey = (l.resulted_at || l.collected_at || "").slice(0, 10);
    const key = (l.lab_name || "Lab") + "|" + dateKey;
    if (!map[key]) {
      map[key] = { key, panel: l.lab_name || "Lab", collected_at: l.collected_at, released_at: l.released_at, rows: [] };
      out.push(map[key]);
    }
    map[key].rows.push(l);
  });
  return out;
}
