import { useState, useEffect, useCallback, useRef, useMemo, createContext, useContext } from "react";
import VapiAssistant from "./VapiAssistant";
import { AddClientPanel, AddDealPanel, AddTaskPanel, AddInvoicePanel, AddCommPanel } from "./ICBOSForms";
import AgentsTab from "./AgentsTab";
import { supabase } from "../lib/supabaseClient";
import { useICBosData } from "../hooks/useSupabaseData";

// ─── Data Context ─────────────────────────────────────────────────────
// All sub-components read live data via useData() instead of module-level globals.
// ICBOS() populates the provider after running useICBosData() + field adapters.
const ICBOSCtx = createContext(null);
const useData = () => useContext(ICBOSCtx);

// ═══════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════
// IC-BOS — Immaculate Consulting Business Operating System
// Complete Business Operations System with Voice Layer
// 16 Tabs: Overview, Pipeline, Clients, ROI, Financials, Automations,
//   Capacity, Renewals, Proposals, Tasks, Comms, Invoicing,
//   Onboarding, Profitability, Sales Prep, Weekly Report
// ═══════════════════════════════════════════════════════════════════════

// ─── Data Store ──────────────────────────────────────────────────────
// Mock constants removed in Task 18.
// Live data provided via ICBOSCtx — see useICBosData() in ICBOS() below.
// CAPACITY stays local — CapTab manages consultant team state internally.

const STAGES = ["cold", "discovery", "proposal", "negotiation", "closed-won"];
const STAGE_LABELS = { cold: "Cold", discovery: "Discovery", proposal: "Proposal", negotiation: "Negotiation", "closed-won": "Closed Won" };
const STAGE_COLORS = {
  cold: { bg: "rgba(148,163,184,0.10)", border: "#64748b", text: "#94a3b8", dot: "#64748b" },
  discovery: { bg: "rgba(56,189,248,0.08)", border: "#0ea5e9", text: "#38bdf8", dot: "#0ea5e9" },
  proposal: { bg: "rgba(251,191,36,0.08)", border: "#f59e0b", text: "#fbbf24", dot: "#f59e0b" },
  negotiation: { bg: "rgba(168,85,247,0.08)", border: "#a855f7", text: "#c084fc", dot: "#a855f7" },
  "closed-won": { bg: "rgba(34,197,94,0.08)", border: "#22c55e", text: "#4ade80", dot: "#22c55e" },
};

// ─── Calc Engines ────────────────────────────────────────────────────
function calcClientROI(c) {
  const reduction = c.noShowBefore - c.noShowCurrent;
  const recoveredWk = (reduction / 100) * c.apptsPerWeek;
  const annualRev = recoveredWk * c.avgVisitValue * 52;
  const annualStaff = c.weeklyHoursSaved * c.staffHourlyRate * 52;
  const annualBenefit = annualRev + annualStaff;
  const annualCost = c.monthlyFee * 12;
  const roiPct = annualCost > 0 ? ((annualBenefit - annualCost) / annualCost) * 100 : 0;
  const moActive = Math.max(1, Math.round((Date.now() - new Date(c.goLive).getTime()) / 2592e6));
  const totalToDate = (annualBenefit / 12) * moActive;
  return { annualRev, annualStaff, annualBenefit, annualCost, roiPct, totalToDate, moActive, recoveredWk };
}

function calcProfitability(c) {
  const monthlyTimeValue = c.weeklyHoursSpent * 4.33 * 175; // $175/hr implied rate
  const monthlyCost = monthlyTimeValue + c.platformCost + 120; // + share of fixed costs
  const monthlyProfit = c.monthlyFee - c.platformCost - 120;
  const effectiveRate = c.weeklyHoursSpent > 0 ? monthlyProfit / (c.weeklyHoursSpent * 4.33) : 0;
  const margin = c.monthlyFee > 0 ? (monthlyProfit / c.monthlyFee) * 100 : 0;
  return { monthlyProfit, effectiveRate, margin, monthlyTimeValue, monthlyCost };
}
// ─── Voice Engine ────────────────────────────────────────────────────
// processVoice() removed in Task 18 — replaced by live Vapi SDK (VapiAssistant.jsx).
// All voice commands handled server-side via DigitalOcean webhook.

// ═══════════════════════════════════════════════════════════════════════
// SHARED UI
// ═══════════════════════════════════════════════════════════════════════
const M = "'JetBrains Mono',monospace";

function AnimNum({ value, prefix="", suffix="", dur=1200 }) {
  const [d, setD] = useState(0); const ref = useRef();
  useEffect(() => { const s=performance.now(); const anim=(n)=>{const p=Math.min((n-s)/dur,1);setD(Math.round((1-Math.pow(1-p,3))*value));if(p<1)ref.current=requestAnimationFrame(anim);}; ref.current=requestAnimationFrame(anim); return()=>cancelAnimationFrame(ref.current); }, [value,dur]);
  return <span>{prefix}{d.toLocaleString()}{suffix}</span>;
}

function Spark({ data, color="#4ade80", h=30, w=80 }) {
  if(!data||data.length<2) return null;
  const mx=Math.max(...data),mn=Math.min(...data),r=mx-mn||1;
  const pts=data.map((v,i)=>`${(i/(data.length-1))*w},${h-((v-mn)/r)*(h-4)-2}`).join(" ");
  return <svg width={w} height={h} style={{overflow:"visible"}}><polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" points={pts}/></svg>;
}

function KPI({ label, value, prefix, suffix, change, spark, sparkColor, delay=0 }) {
  return (
    <div style={{ background:"#0d2b4e", border:"1px solid rgba(42,182,215,0.15)", borderRadius:12, padding:"16px 18px", display:"flex", flexDirection:"column", gap:5, animation:`fu 0.5s ease ${delay}ms both`, position:"relative", overflow:"hidden" }}>
      <div style={{ position:"absolute", bottom:4, right:12, opacity:0.5 }}><Spark data={spark} color={sparkColor} h={28} w={60}/></div>
      <span style={{ fontSize:10, fontWeight:600, color:"#7aaacb", textTransform:"uppercase", letterSpacing:"0.08em", fontFamily:M }}>{label}</span>
      <span style={{ fontSize:24, fontWeight:700, color:"#f0f8ff", fontFamily:M, lineHeight:1 }}><AnimNum value={value} prefix={prefix} suffix={suffix}/></span>
      {change!==undefined&&<span style={{ fontSize:10, color:change>0?"#4ade80":"#f87171", fontFamily:M }}>{change>0?"▲":"▼"} {Math.abs(change)}%</span>}
    </div>
  );
}

function Panel({ title, subtitle, action, children, style:s }) {
  return (
    <div style={{ background:"#0d2b4e", border:"1px solid rgba(42,182,215,0.15)", borderRadius:12, padding:"18px 20px", ...s }}>
      {(title||action)&&<div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:subtitle?4:14 }}><span style={{ fontSize:13, fontWeight:600, color:"#f0f8ff" }}>{title}</span>{action}</div>}
      {subtitle&&<div style={{ fontSize:10.5, color:"#7aaacb", marginBottom:14, fontFamily:M }}>{subtitle}</div>}
      {children}
    </div>
  );
}

function TaskItem({ task, delay=0 }) {
  const [done,setDone]=useState(false);
  const pc={high:"#f87171",medium:"#fbbf24",low:"#6b7280"};
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 12px", borderRadius:7, background:done?"rgba(74,222,128,0.04)":"rgba(255,255,255,0.02)", border:`1px solid ${done?"rgba(74,222,128,0.08)":"rgba(255,255,255,0.04)"}`, animation:`fu 0.3s ease ${delay}ms both`, opacity:done?0.4:1, transition:"all 0.3s" }}>
      <button onClick={()=>setDone(!done)} style={{ width:16, height:16, borderRadius:4, border:`2px solid ${done?"#4ade80":pc[task.priority]}`, background:done?"#4ade80":"transparent", cursor:"pointer", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center" }}>{done&&<span style={{color:"#111",fontSize:10,fontWeight:800}}>✓</span>}</button>
      <span style={{ flex:1, fontSize:12, color:done?"#6b7280":"#e5e7eb", textDecoration:done?"line-through":"none" }}>{task.text}</span>
      <span style={{ fontSize:10, color:"#7aaacb", fontFamily:M, flexShrink:0 }}>{task.due}</span>
    </div>
  );
}

function RevChart({ data }) {
  if (!data || data.length < 2) return <div style={{height:120,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,color:"#4a6a8a"}}>No data yet</div>;
  const mx=Math.max(...data.map(d=>d.revenue));
  return (
    <div style={{ display:"flex", alignItems:"flex-end", gap:8, height:120, padding:"0 4px" }}>
      {data.map((d,i)=>(<div key={d.month} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4, animation:`fu 0.5s ease ${i*50}ms both` }}>
        <div style={{ display:"flex", alignItems:"flex-end", gap:2, height:100 }}>
          <div style={{ width:12, height:(d.revenue/mx)*90, borderRadius:"3px 3px 0 0", background:"linear-gradient(to top,#4f46e5,#818cf8)" }}/>
          <div style={{ width:8, height:(d.expenses/mx)*90, borderRadius:"3px 3px 0 0", background:"rgba(42,182,215,0.07)" }}/>
        </div>
        <span style={{ fontSize:9, color:"#7aaacb", fontFamily:M }}>{d.month}</span>
      </div>))}
    </div>
  );
}

function PipelineBoard({ canEdit = true, onRefresh }) {
  const { PIPELINE } = useData();
  const [proposalStates, setProposalStates] = useState({});
  const [outreachStates, setOutreachStates] = useState({});
  const [outreachResults, setOutreachResults] = useState({});
  const [expandedOutreach, setExpandedOutreach] = useState({});
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(null);

  const handleDeleteDeal = async (deal) => {
    if (deleteConfirm !== deal.id) {
      setDeleteConfirm(deal.id);
      setTimeout(() => setDeleteConfirm(null), 4000);
      return;
    }
    setDeleteLoading(deal.id);
    setDeleteConfirm(null);
    const { error } = await supabase.from("pipeline_deals").delete().eq("id", deal.supabase_id);
    setDeleteLoading(null);
    if (!error && onRefresh) onRefresh();
  };

  const handleGenerateProposal = async (deal) => {
    // Mock deals don't have real Supabase UUIDs — button is wired and ready for Task 17
    if (!deal.supabase_id) {
      setProposalStates(prev => ({ ...prev, [deal.id]: 'nomock' }));
      setTimeout(() => setProposalStates(prev => ({ ...prev, [deal.id]: null })), 3000);
      return;
    }
    setProposalStates(prev => ({ ...prev, [deal.id]: 'loading' }));
    try {
      const res = await fetch('https://api.immaculate-consulting.org/api/agents/generate-proposal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-vapi-secret': import.meta.env.VITE_VAPI_WEBHOOK_SECRET },
        body: JSON.stringify({ deal_id: deal.supabase_id })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Agent error');
      setProposalStates(prev => ({ ...prev, [deal.id]: 'done' }));
      if (onRefresh) onRefresh();
      setTimeout(() => setProposalStates(prev => ({ ...prev, [deal.id]: null })), 4000);
    } catch (err) {
      setProposalStates(prev => ({ ...prev, [deal.id]: 'error' }));
      setTimeout(() => setProposalStates(prev => ({ ...prev, [deal.id]: null })), 4000);
    }
  };
const handleGenerateOutreach = async (deal) => {
    setOutreachStates(prev => ({ ...prev, [deal.id]: "loading" }));
    try {
      const res = await fetch("https://api.immaculate-consulting.org/api/agents/outreach-personalizer", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-vapi-secret": import.meta.env.VITE_VAPI_WEBHOOK_SECRET },
        body: JSON.stringify({
          practice_name: deal.practice,
          specialty: deal.specialty,
          ehr: deal.ehr,
          tier: deal.tier,
          providers: deal.providers,
          payer_mix: deal.payer,
          no_show_baseline: deal.noShowBaseline,
          value: deal.value,
          contact_name: deal.contact,
          ehr_difficulty: deal.ehrDifficulty,
          ehr_notes: deal.ehrNotes,
          triggered_by: "manual_button"
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Outreach failed");
      setOutreachResults(prev => ({ ...prev, [deal.id]: data }));
      setOutreachStates(prev => ({ ...prev, [deal.id]: "done" }));
    } catch (err) {
      setOutreachStates(prev => ({ ...prev, [deal.id]: "error" }));
    }
  };
  return (
    <div style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:8 }}>
      {STAGES.map(stg=>{
        const deals=PIPELINE.filter(d=>d.stage===stg); const c=STAGE_COLORS[stg];
        return (<div key={stg} style={{ minWidth:185, flex:"1 0 185px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:6, padding:"0 2px" }}>
            <span style={{ width:6, height:6, borderRadius:"50%", background:c.dot }}/><span style={{ fontSize:10, fontWeight:600, color:c.text, textTransform:"uppercase", letterSpacing:"0.05em", fontFamily:M }}>{STAGE_LABELS[stg]}</span>
            <span style={{ fontSize:9, color:"#7aaacb", marginLeft:"auto", fontFamily:M }}>${deals.reduce((s,d)=>s+d.value,0).toLocaleString()}</span>
          </div>
          {deals.map(d=>{
            const ps = proposalStates[d.id];
            return (<div key={d.id} style={{ background:c.bg, border:`1px solid ${c.border}15`, borderRadius:9, padding:"10px 12px", marginBottom:6, position:"relative" }}>
              {canEdit && (
                <button
                  onClick={() => handleDeleteDeal(d)}
                  disabled={deleteLoading === d.id}
                  title={deleteConfirm === d.id ? "Click again to confirm delete" : "Remove deal"}
                  style={{ position:"absolute", top:6, right:6, width:18, height:18, borderRadius:4, border:`1px solid ${deleteConfirm===d.id?"rgba(248,113,113,0.5)":"rgba(255,255,255,0.08)"}`, background:deleteConfirm===d.id?"rgba(248,113,113,0.15)":"rgba(0,0,0,0.4)", color:deleteConfirm===d.id?"#f87171":"#f87171", cursor:"pointer", fontSize:10, display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.15s" }}
                >
                  {deleteLoading===d.id ? "…" : deleteConfirm===d.id ? "!" : "×"}
                </button>
              )}
              <div style={{ fontSize:12, fontWeight:600, color:"#f0f8ff", paddingRight: canEdit ? 20 : 0 }}>{d.practice}</div>
              <div style={{ fontSize:10, color:"#a8c8e8", marginTop:1 }}>{d.specialty} · {d.ehr}</div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:6 }}>
                <span style={{ fontSize:12, fontWeight:700, color:c.text, fontFamily:M }}>${d.value.toLocaleString()}/mo</span>
                <span style={{ fontSize:8, fontWeight:600, color:"#111", background:c.dot, borderRadius:4, padding:"1px 6px" }}>T{d.tier}</span>
              </div>
              <div style={{ fontSize:10, color:"#7aaacb", marginTop:5 }}>→ {d.nextAction}</div>
              {d.daysInStage>5&&<div style={{ fontSize:9, color:"#f87171", marginTop:3, fontFamily:M }}>⚠ {d.daysInStage}d in stage</div>}
             {/* Agent 7 — Generate Outreach button (Cold stage only) */}
              {d.stage === "cold" && (
                <div style={{ marginTop:8, paddingTop:8, borderTop:"1px solid rgba(42,182,215,0.15)" }}>
                  {outreachStates[d.id] === "loading" && <div style={{ fontSize:9, color:"#38bdf8", fontFamily:M, textAlign:"center", padding:"4px 0", display:"flex", alignItems:"center", justifyContent:"center", gap:4 }}><span style={{ width:6, height:6, borderRadius:"50%", background:"#38bdf8", display:"inline-block", animation:"pr 1.2s ease-out infinite" }}/>Writing outreach...</div>}
                  {outreachStates[d.id] === "error" && <div style={{ fontSize:9, color:"#f87171", fontFamily:M }}>✗ Error — try again</div>}
                  {outreachStates[d.id] === "done" && outreachResults[d.id] && (
                    <div>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:5 }}>
                        <span style={{ fontSize:9, color:"#4ade80", fontFamily:M }}>✓ Outreach ready</span>
                        <button onClick={() => setExpandedOutreach(prev => ({...prev, [d.id]: !prev[d.id]}))} style={{ fontSize:9, color:"#a5b4fc", background:"transparent", border:"1px solid rgba(99,102,241,0.2)", borderRadius:4, padding:"2px 6px", cursor:"pointer" }}>{expandedOutreach[d.id] ? "Hide" : "View"}</button>
                      </div>
                      {expandedOutreach[d.id] && (
                        <div style={{ background:"rgba(42,182,215,0.07)", borderRadius:6, padding:"8px 10px" }}>
                          <div style={{ fontSize:9, fontWeight:600, color:"#f0f8ff", marginBottom:4 }}>Subj: {outreachResults[d.id].subject}</div>
                          <div style={{ fontSize:10, color:"#a8c8e8", lineHeight:1.5, marginBottom:6, whiteSpace:"pre-wrap" }}>{outreachResults[d.id].body}</div>
                          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                            <span style={{ fontSize:9, color:"#7aaacb" }}>Follow up in {outreachResults[d.id].follow_up_timing}d</span>
                            <button onClick={() => navigator.clipboard?.writeText(`Subject: ${outreachResults[d.id].subject}\n\n${outreachResults[d.id].body}`)} style={{ fontSize:9, color:"#7aaacb", background:"transparent", border:"1px solid rgba(42,182,215,0.15)", borderRadius:4, padding:"2px 6px", cursor:"pointer" }}>Copy</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {(!outreachStates[d.id] || outreachStates[d.id] === null) && canEdit && (
                    <button onClick={() => handleGenerateOutreach(d)} style={{ width:"100%", padding:"5px 0", borderRadius:6, border:"1px solid rgba(99,102,241,0.2)", background:"rgba(99,102,241,0.08)", color:"#a5b4fc", cursor:"pointer", fontSize:9.5, fontWeight:600, display:"flex", alignItems:"center", justifyContent:"center", gap:4 }}>
                      🤖 Generate Outreach
                    </button>
                  )}
                </div>
              )}
              {/* Agent 1 — Generate Proposal button */}
              <div style={{ marginTop:d.stage==="cold"?4:8, paddingTop:8, borderTop:"1px solid rgba(42,182,215,0.15)" }}>
                {ps === 'done' && <div style={{ fontSize:9, color:"#4ade80", fontFamily:M }}>✓ Proposal created — check Proposals tab</div>}
                {ps === 'error' && <div style={{ fontSize:9, color:"#f87171", fontFamily:M }}>✗ Error — check agent logs</div>}
                {ps === 'nomock' && <div style={{ fontSize:9, color:"#fbbf24", fontFamily:M }}>⚡ Live data needed (Task 17)</div>}
               {(!ps || ps === null) && canEdit && (
                  <button
                    onClick={() => handleGenerateProposal(d)}
                    style={{ width:"100%", padding:"5px 0", borderRadius:6, border:"1px solid rgba(99,102,241,0.2)", background:"rgba(99,102,241,0.08)", color:"#a5b4fc", cursor:"pointer", fontSize:9.5, fontWeight:600, display:"flex", alignItems:"center", justifyContent:"center", gap:4 }}
                  >
                    🤖 Generate Proposal
                  </button>
                )}
                {ps === 'loading' && (
                  <div style={{ fontSize:9, color:"#38bdf8", fontFamily:M, textAlign:"center", padding:"4px 0", display:"flex", alignItems:"center", justifyContent:"center", gap:4 }}>
                    <span style={{ width:6, height:6, borderRadius:"50%", background:"#38bdf8", display:"inline-block", animation:"pr 1.2s ease-out infinite" }}/>
                    Generating...
                  </div>
                )}
              </div>
            </div>);
          })}
        </div>);
      })}
    </div>
  );
}
// ═══════════════════════════════════════════════════════════════════════
// FEATURE TABS
// ═══════════════════════════════════════════════════════════════════════
// CLIENTS TAB (with Agent 5 inline UI)
function ClientsTab({ onShowForm, canEdit = true, onDeleted }) {
  const { CLIENTS } = useData();
  const [analyzeStates, setAnalyzeStates] = useState({});
  const [analyzeResults, setAnalyzeResults] = useState({});
  const [reportStates, setReportStates] = useState({});
  const [reportResults, setReportResults] = useState({});
  const [expandedReport, setExpandedReport] = useState({});
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(null);

  const handleDeleteClient = async (client) => {
    if (deleteConfirm !== client.id) {
      setDeleteConfirm(client.id);
      setTimeout(() => setDeleteConfirm(null), 4000);
      return;
    }
    setDeleteLoading(client.id);
    setDeleteConfirm(null);
    const { error } = await supabase.from("clients").delete().eq("id", client.id);
    setDeleteLoading(null);
    if (!error && onDeleted) onDeleted();
  };

  const handleGenerateReport = async (client) => {
    setReportStates(prev => ({ ...prev, [client.id]: "loading" }));
    try {
      const res = await fetch("https://api.immaculate-consulting.org/api/agents/generate-client-report", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-vapi-secret": import.meta.env.VITE_VAPI_WEBHOOK_SECRET },
        body: JSON.stringify({
          client_name: client.name,
          tier: client.tier,
          ehr: client.ehr,
          status: client.status,
          health_score: client.healthScore,
          no_show_before: client.noShowBefore,
          no_show_current: client.noShowCurrent,
          weekly_hours_saved: client.weeklyHoursSaved,
          weekly_hours_spent: client.weeklyHoursSpent,
          monthly_fee: client.monthlyFee,
          automations: client.automations.join(", "),
          renewal_date: client.renewalDate,
          go_live_date: client.goLive,
          providers: client.providers,
          appts_per_week: client.apptsPerWeek,
          avg_visit_value: client.avgVisitValue,
          staff_hourly_rate: client.staffHourlyRate,
          platform_cost: client.platformCost,
          contact_log: client.contactLog
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Report generation failed");
      setReportResults(prev => ({ ...prev, [client.id]: data }));
      setReportStates(prev => ({ ...prev, [client.id]: "done" }));
    } catch (err) {
      setReportStates(prev => ({ ...prev, [client.id]: "error" }));
    }
  };

  const printClientReport = (client, report) => {
    const m = report.metrics || {};
    const today = new Date().toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' });
    const renewalColor = report.renewal_outlook === 'positive' ? '#16a34a' : report.renewal_outlook === 'at-risk' ? '#dc2626' : '#d97706';
    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html><html><head><title>Monthly Report - ${client.name}</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:'Segoe UI',Arial,sans-serif;color:#1e293b;max-width:850px;margin:0 auto;padding:40px 48px;font-size:13px;line-height:1.6}
      h1{color:#6366f1;font-size:24px;font-weight:800;margin-bottom:2px}
      h2{font-size:14px;font-weight:700;color:#1e293b;border-bottom:2px solid #6366f1;padding-bottom:6px;margin:24px 0 12px;text-transform:uppercase;letter-spacing:0.05em}
      h3{font-size:12px;font-weight:700;color:#334155;margin:12px 0 6px}
      .subtitle{color:#64748b;font-size:12px;margin-bottom:24px}
      .kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:12px 0}
      .kpi{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;text-align:center}
      .kpi .value{font-size:18px;font-weight:800;color:#6366f1}
      .kpi .value.green{color:#16a34a}
      .kpi .label{font-size:10px;color:#64748b;margin-top:2px}
      .highlight{background:#f0fdf4;border-left:3px solid #16a34a;padding:8px 12px;margin:6px 0;border-radius:0 6px 6px 0;font-size:12px}
      .rec{background:#f8fafc;border-left:3px solid #6366f1;padding:8px 12px;margin:6px 0;border-radius:0 6px 6px 0;font-size:12px}
      .priority{background:#fffbeb;border-left:3px solid #d97706;padding:8px 12px;margin:6px 0;border-radius:0 6px 6px 0;font-size:12px}
      .renewal-badge{display:inline-block;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;color:white;background:${renewalColor}}
      .two-col{display:grid;grid-template-columns:1fr 1fr;gap:20px}
      .section-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;margin:8px 0;font-size:12px;line-height:1.6}
      .footer{margin-top:32px;padding-top:12px;border-top:2px solid #e2e8f0;color:#64748b;font-size:11px;display:flex;justify-content:space-between}
      @media print{body{padding:20px 32px}}
    </style></head><body>

    <h1>Monthly Performance Report</h1>
    <div class="subtitle">
      ${client.name} &nbsp;·&nbsp; Tier ${client.tier} &nbsp;·&nbsp; ${client.ehr} &nbsp;·&nbsp;
      ${today} &nbsp;·&nbsp;
      <span class="renewal-badge">${(report.renewal_outlook||'').toUpperCase()}</span>
    </div>

    <h2>Performance at a Glance</h2>
    <div class="kpi-grid">
      <div class="kpi"><div class="value green">${m.noShowReduction}%</div><div class="label">No-Show Reduction</div></div>
      <div class="kpi"><div class="value">${m.recoveredAppts}</div><div class="label">Appts Recovered/Wk</div></div>
      <div class="kpi"><div class="value">$${(m.totalToDate||0).toLocaleString()}</div><div class="label">ROI to Date</div></div>
      <div class="kpi"><div class="value green">${m.roi}%</div><div class="label">Year 1 ROI</div></div>
      <div class="kpi"><div class="value">$${(m.annualRev||0).toLocaleString()}</div><div class="label">Annual Rev Recovered</div></div>
      <div class="kpi"><div class="value">$${(m.annualStaff||0).toLocaleString()}</div><div class="label">Annual Staff Savings</div></div>
      <div class="kpi"><div class="value">$${(m.totalBenefit||0).toLocaleString()}</div><div class="label">Total Annual Benefit</div></div>
      <div class="kpi"><div class="value">${m.moActive} mo</div><div class="label">Months Active</div></div>
    </div>

    <h2>Executive Summary</h2>
    <div class="section-box">${report.executive_summary}</div>

    <div class="two-col">
      <div>
        <h2>Performance Highlights</h2>
        ${(report.performance_highlights||[]).map(h=>`<div class="highlight">✓ ${h}</div>`).join('')}
      </div>
      <div>
        <h2>Recommendations</h2>
        ${(report.recommendations||[]).map(r=>`<div class="rec">→ ${r}</div>`).join('')}
      </div>
    </div>

    <h2>No-Show Analysis</h2>
    <div class="section-box">${report.no_show_analysis}</div>

    <h2>Automation Performance</h2>
    <div class="section-box">${report.automation_performance}</div>

    <h2>Financial Return</h2>
    <div class="section-box">${report.roi_summary}</div>

    <h2>Next Month Priorities</h2>
    ${(report.next_month_priorities||[]).map(p=>`<div class="priority">▸ ${p}</div>`).join('')}

    <h2>Renewal Outlook</h2>
    <div class="section-box">${report.renewal_notes}</div>

    <div class="footer">
      <span>Immaculate Consulting | Monthly Performance Report | ${client.name}</span>
      <span>${today} | Confidential</span>
    </div>
    </body></html>`);
    win.document.close();
    setTimeout(() => { win.print(); }, 500);
  };

  const handleAnalyze = async (client) => {
    setAnalyzeStates(prev => ({ ...prev, [client.id]: "loading" }));
    try {
      const res = await fetch("https://api.immaculate-consulting.org/api/agents/client-success", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-vapi-secret": import.meta.env.VITE_VAPI_WEBHOOK_SECRET },
        body: JSON.stringify({
          client_name: client.name,
          health_score: client.healthScore,
          tier: client.tier,
          ehr: client.ehr,
          no_show_before: client.noShowBefore,
          no_show_current: client.noShowCurrent,
          weekly_hours_saved: client.weeklyHoursSaved,
          weekly_hours_spent: client.weeklyHoursSpent,
          monthly_fee: client.monthlyFee,
          automations: client.automations.join(", "),
          renewal_date: client.renewalDate,
          next_milestone: client.nextMilestone,
          triggered_by: "manual_button"
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analysis failed");
      setAnalyzeResults(prev => ({ ...prev, [client.id]: data }));
      setAnalyzeStates(prev => ({ ...prev, [client.id]: "done" }));
    } catch (err) {
      setAnalyzeStates(prev => ({ ...prev, [client.id]: "error" }));
    }
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <h2 style={{ fontSize:17, fontWeight:700, color:"#f0f8ff" }}>Client Health</h2>
          <p style={{ fontSize:11, color:"#7aaacb", marginTop:2 }}>{CLIENTS.length} clients · Agent 5 analysis available</p>
        </div>
        {onShowForm && <button onClick={onShowForm} style={{ fontSize:11, fontWeight:600, color:"#a5b4fc", background:"rgba(99,102,241,0.1)", border:"1px solid rgba(99,102,241,0.2)", borderRadius:6, padding:"5px 12px", cursor:"pointer" }}>+ Add Client</button>}
      </div>

      {/* At-risk banner */}
      {CLIENTS.filter(c=>c.healthScore<70).length>0&&(
        <div style={{ background:"rgba(248,113,113,0.05)", border:"1px solid rgba(248,113,113,0.1)", borderRadius:10, padding:"10px 14px", display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:11, color:"#f87171" }}>⚠️ {CLIENTS.filter(c=>c.healthScore<70).length} client{CLIENTS.filter(c=>c.healthScore<70).length>1?"s":""} at risk — health score below 70</span>
        </div>
      )}

      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        {CLIENTS.map((c,i)=>{
          const sc = c.healthScore>=90?"#4ade80":c.healthScore>=70?"#fbbf24":"#f87171";
          const stc = { active:"#4ade80", onboarding:"#38bdf8" };
          const isAtRisk = c.healthScore < 70;
          const noShowImprovement = c.noShowBefore - c.noShowCurrent;
          const trend = noShowImprovement > 5 ? "up" : noShowImprovement > 0 ? "flat" : "down";
          const trendIcon = trend==="up"?"↑":trend==="flat"?"→":"↓";
          const trendColor = trend==="up"?"#4ade80":trend==="flat"?"#fbbf24":"#f87171";
          const as = analyzeStates[c.id];
          const ar = analyzeResults[c.id];

          return (
            <div key={c.id} style={{ background: isAtRisk?"rgba(248,113,113,0.04)":"rgba(255,255,255,0.02)", border:`1px solid ${isAtRisk?"rgba(248,113,113,0.12)":"rgba(255,255,255,0.05)"}`, borderRadius:12, padding:"14px 16px", animation:`fu 0.4s ease ${i*50}ms both`, position:"relative" }}>
              {/* Top row */}
              <div style={{ display:"grid", gridTemplateColumns:"2fr .7fr .8fr .8fr .8fr 1fr auto", gap:8, alignItems:"center", fontSize:12 }}>
               <div>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <span style={{ fontWeight:600, color:"#f0f8ff" }}>{c.name}</span>
                    {isAtRisk&&<span style={{ fontSize:8, fontWeight:700, color:"#f87171", background:"rgba(248,113,113,0.12)", padding:"1px 6px", borderRadius:4, fontFamily:M }}>AT RISK</span>}
                    {canEdit && (
                      <button
                        onClick={() => handleDeleteClient(c)}
                        disabled={deleteLoading === c.id}
                        title={deleteConfirm === c.id ? "Click again to confirm delete" : "Remove client"}
                        style={{ width:16, height:16, borderRadius:4, border:`1px solid ${deleteConfirm===c.id?"rgba(248,113,113,0.5)":"rgba(255,255,255,0.08)"}`, background:deleteConfirm===c.id?"rgba(248,113,113,0.15)":"rgba(0,0,0,0.4)", color:"#f87171", cursor:"pointer", fontSize:10, display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.15s", flexShrink:0 }}
                      >
                        {deleteLoading===c.id ? "…" : deleteConfirm===c.id ? "!" : "×"}
                      </button>
                    )}
                  </div>
                  <div style={{ fontSize:10, color:"#7aaacb", marginTop:1 }}>T{c.tier} · {c.ehr}</div>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                  <span style={{ width:5, height:5, borderRadius:"50%", background:stc[c.status]||"#6b7280" }}/>
                  <span style={{ color:stc[c.status]||"#6b7280", fontSize:10, textTransform:"capitalize" }}>{c.status}</span>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                  <span style={{ fontWeight:700, color:sc, fontFamily:M }}>{c.healthScore}</span>
                  <span style={{ fontSize:11, color:trendColor }}>{trendIcon}</span>
                </div>
                <div style={{ fontFamily:M }}>
                  <span style={{ color:"#f0f8ff" }}>{c.noShowCurrent}%</span>
                  {noShowImprovement>0&&<span style={{ color:"#4ade80", fontSize:9, marginLeft:3 }}>↓{noShowImprovement.toFixed(1)}</span>}
                </div>
                <span style={{ fontFamily:M, color:"#f0f8ff" }}>${c.monthlyFee.toLocaleString()}</span>
                <span style={{ fontSize:10.5, color:"#a8c8e8" }}>{c.nextMilestone}</span>
                {/* Analyze + Report buttons */}
                <div style={{ display:"flex", flexDirection:"column", gap:4, alignItems:"flex-end" }}>
                  {(!as||as===null)&&canEdit&&<button onClick={()=>handleAnalyze(c)} style={{ fontSize:9.5, fontWeight:600, color:"#a5b4fc", background:"rgba(99,102,241,0.08)", border:"1px solid rgba(99,102,241,0.15)", borderRadius:6, padding:"4px 10px", cursor:"pointer", whiteSpace:"nowrap" }}>🤖 Analyze</button>}
                  {as==="loading"&&<span style={{ fontSize:9, color:"#38bdf8", fontFamily:M, display:"flex", alignItems:"center", gap:4 }}><span style={{ width:6, height:6, borderRadius:"50%", background:"#38bdf8", animation:"pr 1.2s ease-out infinite" }}/>Running...</span>}
                  {as==="done"&&<span style={{ fontSize:9, color:"#4ade80", fontFamily:M }}>✓ Done</span>}
                  {as==="error"&&<span style={{ fontSize:9, color:"#f87171", fontFamily:M }}>✗ Error</span>}
                  {/* Monthly Report button */}
                  {canEdit && c.status === "active" && (
                    <button
                      onClick={() => reportStates[c.id] === "done"
                        ? setExpandedReport(prev => ({...prev, [c.id]: !prev[c.id]}))
                        : handleGenerateReport(c)
                      }
                      disabled={reportStates[c.id] === "loading"}
                      style={{ fontSize:9.5, fontWeight:600, color:"#fbbf24", background:"rgba(251,191,36,0.08)", border:"1px solid rgba(251,191,36,0.15)", borderRadius:6, padding:"4px 10px", cursor:"pointer", whiteSpace:"nowrap", opacity: reportStates[c.id] === "loading" ? 0.6 : 1 }}
                    >
                      {reportStates[c.id] === "loading" ? "⏳ Generating..." : reportStates[c.id] === "done" ? "📋 View Report" : "📋 Monthly Report"}
                    </button>
                  )}
                </div>
              </div>

              {/* Analysis result panel */}
              {as==="done"&&ar&&(
  <div style={{ marginTop:12, paddingTop:12, borderTop:"1px solid rgba(42,182,215,0.15)", display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, animation:"fu 0.3s ease both" }}>
    <div style={{ padding:"8px 10px", background:"rgba(42,182,215,0.07)", borderRadius:7, textAlign:"center" }}>
      <div style={{ fontSize:9, color:"#7aaacb", fontFamily:M, textTransform:"uppercase", marginBottom:3 }}>Health Score</div>
      <div style={{ fontSize:20, fontWeight:800, color:ar.health_score>=70?"#4ade80":ar.health_score>=40?"#fbbf24":"#f87171", fontFamily:M }}>{ar.health_score}</div>
      <div style={{ fontSize:9, color: ar.risk_level==="high"?"#f87171":ar.risk_level==="medium"?"#fbbf24":"#4ade80", fontWeight:600, textTransform:"uppercase", marginTop:2 }}>{ar.risk_level} risk</div>
    </div>
    <div style={{ padding:"8px 10px", background:"rgba(42,182,215,0.07)", borderRadius:7 }}>
      <div style={{ fontSize:9, color:"#f87171", fontFamily:M, textTransform:"uppercase", fontWeight:600, marginBottom:4 }}>Risk Factors</div>
      {ar.risk_factors?.slice(0,2).map((p,pi)=><div key={pi} style={{ fontSize:10, color:"#f0f8ff", marginBottom:2 }}>• {p}</div>)}
    </div>
    <div style={{ padding:"8px 10px", background:"rgba(42,182,215,0.07)", borderRadius:7 }}>
      <div style={{ fontSize:9, color:"#4ade80", fontFamily:M, textTransform:"uppercase", fontWeight:600, marginBottom:4 }}>Interventions</div>
      {ar.recommended_interventions?.slice(0,2).map((s,si)=><div key={si} style={{ fontSize:10, color:"#f0f8ff", marginBottom:2 }}>• {s}</div>)}
    </div>
    {ar.renewal_talking_points?.length>0&&(
      <div style={{ padding:"8px 10px", background:"rgba(251,191,36,0.04)", border:"1px solid rgba(251,191,36,0.1)", borderRadius:7 }}>
        <div style={{ fontSize:9, color:"#fbbf24", fontFamily:M, textTransform:"uppercase", fontWeight:600, marginBottom:4 }}>Renewal Outlook: {ar.renewal_outlook}</div>
        {ar.renewal_talking_points.slice(0,2).map((t,ti)=><div key={ti} style={{ fontSize:10, color:"#f0f8ff", marginBottom:2 }}>• {t}</div>)}
      </div>
    )}
    {ar.upsell_opportunity&&(
      <div style={{ padding:"8px 10px", background:"rgba(74,222,128,0.04)", border:"1px solid rgba(74,222,128,0.1)", borderRadius:7 }}>
        <div style={{ fontSize:9, color:"#4ade80", fontFamily:M, textTransform:"uppercase", fontWeight:600, marginBottom:4 }}>Upsell Opportunity</div>
        <div style={{ fontSize:10, color:"#f0f8ff" }}>{ar.upsell_opportunity}</div>
      </div>
    )}
    <div style={{ gridColumn:"1/-1", padding:"8px 10px", background:"rgba(99,102,241,0.05)", border:"1px solid rgba(99,102,241,0.1)", borderRadius:7 }}>
      <div style={{ fontSize:9, color:"#818cf8", fontFamily:M, textTransform:"uppercase", fontWeight:600, marginBottom:3 }}>🤖 Agent Summary</div>
      <div style={{ fontSize:11, color:"#a8c8e8", lineHeight:1.4 }}>{ar.agent_summary}</div>
    </div>
  </div>
)}
              {/* Monthly Report result panel */}
              {reportStates[c.id] === "done" && reportResults[c.id] && expandedReport[c.id] && (
                <div style={{ marginTop:12, paddingTop:12, borderTop:"1px solid rgba(251,191,36,0.1)", animation:"fu 0.3s ease both" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                    <span style={{ fontSize:10, fontWeight:700, color:"#fbbf24", fontFamily:M, textTransform:"uppercase" }}>📋 Monthly Performance Report</span>
                    <button
                      onClick={() => printClientReport(c, reportResults[c.id])}
                      style={{ fontSize:10, color:"#fbbf24", background:"rgba(251,191,36,0.08)", border:"1px solid rgba(251,191,36,0.15)", borderRadius:6, padding:"4px 12px", cursor:"pointer" }}
                    >
                      📄 Download PDF
                    </button>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginBottom:10 }}>
                    {[
                      { label:"No-Show Reduction", value:`${reportResults[c.id].metrics?.noShowReduction}%`, color:"#4ade80" },
                      { label:"ROI to Date", value:`$${(reportResults[c.id].metrics?.totalToDate||0).toLocaleString()}`, color:"#818cf8" },
                      { label:"Annual Benefit", value:`$${(reportResults[c.id].metrics?.totalBenefit||0).toLocaleString()}`, color:"#fbbf24" },
                      { label:"Year 1 ROI", value:`${reportResults[c.id].metrics?.roi}%`, color:"#4ade80" },
                    ].map((kpi,ki) => (
                      <div key={ki} style={{ padding:"8px", background:"rgba(42,182,215,0.07)", borderRadius:6, textAlign:"center" }}>
                        <div style={{ fontSize:14, fontWeight:700, color:kpi.color, fontFamily:M }}>{kpi.value}</div>
                        <div style={{ fontSize:9, color:"#7aaacb", marginTop:2 }}>{kpi.label}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ padding:"10px 12px", background:"rgba(42,182,215,0.07)", borderRadius:7, marginBottom:8 }}>
                    <div style={{ fontSize:10, color:"#a8c8e8", marginBottom:4 }}>Executive Summary</div>
                    <div style={{ fontSize:11, color:"#f0f8ff", lineHeight:1.5 }}>{reportResults[c.id].executive_summary}</div>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                    <div style={{ padding:"10px 12px", background:"rgba(74,222,128,0.04)", border:"1px solid rgba(74,222,128,0.1)", borderRadius:7 }}>
                      <div style={{ fontSize:10, color:"#4ade80", fontFamily:M, textTransform:"uppercase", fontWeight:600, marginBottom:6 }}>Highlights</div>
                      {reportResults[c.id].performance_highlights?.slice(0,3).map((h,hi) => (
                        <div key={hi} style={{ fontSize:10, color:"#f0f8ff", marginBottom:3 }}>✓ {h}</div>
                      ))}
                    </div>
                    <div style={{ padding:"10px 12px", background:"rgba(99,102,241,0.04)", border:"1px solid rgba(99,102,241,0.1)", borderRadius:7 }}>
                      <div style={{ fontSize:10, color:"#818cf8", fontFamily:M, textTransform:"uppercase", fontWeight:600, marginBottom:6 }}>Recommendations</div>
                      {reportResults[c.id].recommendations?.slice(0,3).map((r,ri) => (
                        <div key={ri} style={{ fontSize:10, color:"#f0f8ff", marginBottom:3 }}>→ {r}</div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
// INVOICING (Feature 8) — with Agent 8 collections inline UI
function InvoicingTab({ canInvoice = true, canEdit = true }) {
  const { INVOICES } = useData();
  const [followUpStates, setFollowUpStates] = useState({});
  const [followUpResults, setFollowUpResults] = useState({});
  const [expandedEmail, setExpandedEmail] = useState({});

  const marchInvs = INVOICES.filter(i=>i.issued.startsWith("Mar"));
  const totalBilled = marchInvs.reduce((s,i)=>s+i.total,0);
  const collected = marchInvs.filter(i=>i.status==="paid").reduce((s,i)=>s+i.total,0);
  const overdue = INVOICES.filter(i=>i.status==="overdue");
  const pending = INVOICES.filter(i=>i.status==="pending");
  const totalAR = INVOICES.filter(i=>i.status!=="paid").reduce((s,i)=>s+i.total,0);
  const oldestOverdue = overdue.length>0 ? overdue.reduce((oldest,inv)=>new Date(inv.due)<new Date(oldest.due)?inv:oldest) : null;
  const stColors = { paid:"#4ade80", pending:"#fbbf24", overdue:"#f87171" };

  const handleDraftFollowUp = async (inv) => {
    setFollowUpStates(prev=>({...prev,[inv.id]:"loading"}));
    try {
      const res = await fetch("https://api.immaculate-consulting.org/api/agents/collections-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-vapi-secret": import.meta.env.VITE_VAPI_WEBHOOK_SECRET },
        body: JSON.stringify({
          client_name: inv.client,
          invoice_id: inv.id,
          amount: inv.total,
          due_date: inv.due + " 2026",
          invoice_type: inv.type,
          triggered_by: "manual_button"
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Draft failed");
      setFollowUpResults(prev=>({...prev,[inv.id]:data}));
      setFollowUpStates(prev=>({...prev,[inv.id]:"done"}));
    } catch (err) {
      setFollowUpStates(prev=>({...prev,[inv.id]:"error"}));
    }
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <h2 style={{ fontSize:17, fontWeight:700, color:"#f0f8ff" }}>Invoicing & Billing</h2>
        <button onClick={()=>document.dispatchEvent(new CustomEvent("ic-show-form",{detail:"invoice"}))} style={{ fontSize:11, fontWeight:600, color:"#a5b4fc", background:"rgba(99,102,241,0.1)", border:"1px solid rgba(99,102,241,0.2)", borderRadius:6, padding:"5px 12px", cursor:"pointer" }}>+ Add Invoice</button>
      </div>

      {/* Collections summary bar */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, padding:"12px 16px", background:"#0d2b4e", border:"1px solid rgba(42,182,215,0.15)", borderRadius:10 }}>
        <div>
          <div style={{ fontSize:9, color:"#7aaacb", fontFamily:M, textTransform:"uppercase", marginBottom:3 }}>Total A/R Outstanding</div>
          <div style={{ fontSize:18, fontWeight:700, color:"#fbbf24", fontFamily:M }}>${totalAR.toLocaleString()}</div>
        </div>
        <div>
          <div style={{ fontSize:9, color:"#7aaacb", fontFamily:M, textTransform:"uppercase", marginBottom:3 }}># Overdue</div>
          <div style={{ fontSize:18, fontWeight:700, color:overdue.length>0?"#f87171":"#4ade80", fontFamily:M }}>{overdue.length}</div>
        </div>
        <div>
          <div style={{ fontSize:9, color:"#7aaacb", fontFamily:M, textTransform:"uppercase", marginBottom:3 }}>Oldest Outstanding</div>
          <div style={{ fontSize:14, fontWeight:700, color:"#f87171", fontFamily:M }}>{oldestOverdue ? `${oldestOverdue.client} — Due ${oldestOverdue.due}` : "None"}</div>
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12 }}>
        <KPI label="Mar Billed" value={totalBilled} prefix="$" spark={[17500,20000,22000,24000,27500,27635]} sparkColor="#818cf8"/>
        <KPI label="Collected" value={collected} prefix="$" spark={[11000,15000,18000,22000,24500,6548]} sparkColor="#4ade80" delay={60}/>
        <KPI label="Pending" value={pending.reduce((s,i)=>s+i.total,0)} prefix="$" spark={[8000,6000,4000,3000,5000,14532]} sparkColor="#fbbf24" delay={120}/>
        <KPI label="Overdue" value={overdue.reduce((s,i)=>s+i.total,0)} prefix="$" spark={[0,0,2000,0,0,6555]} sparkColor="#f87171" delay={180}/>
      </div>

      {/* Invoice rows */}
      <div style={{ background:"#0d2b4e", border:"1px solid rgba(42,182,215,0.15)", borderRadius:12, overflow:"hidden" }}>
        <div style={{ display:"grid", gridTemplateColumns:"1.2fr 1.8fr 1.2fr 0.8fr 0.8fr 0.8fr 0.8fr 1fr", gap:6, padding:"10px 16px", borderBottom:"1px solid rgba(42,182,215,0.15)", fontSize:9.5, fontWeight:600, color:"#7aaacb", textTransform:"uppercase", fontFamily:M }}>
          <span>Invoice</span><span>Client</span><span>Type</span><span>Amount</span><span>Usage</span><span>Total</span><span>Status</span><span>Action</span>
        </div>
        {INVOICES.map((inv,i)=>{
          const fs = followUpStates[inv.id];
          const fr = followUpResults[inv.id];
          const isOverdue = inv.status==="overdue";
          const daysOverdue = isOverdue ? Math.round((Date.now()-new Date(inv.due))/864e5) : 0;
          return (
            <div key={inv.id}>
              <div style={{ display:"grid", gridTemplateColumns:"1.2fr 1.8fr 1.2fr 0.8fr 0.8fr 0.8fr 0.8fr 1fr", gap:6, alignItems:"center", padding:"10px 16px", borderBottom:"1px solid rgba(42,182,215,0.08)", fontSize:12, animation:`fu 0.3s ease ${i*30}ms both`, background:isOverdue?"rgba(248,113,113,0.03)":"transparent" }}>
                <span style={{ fontFamily:M, color:"#a8c8e8", fontSize:11 }}>{inv.id}</span>
                <span style={{ fontWeight:600, color:"#f0f8ff" }}>{inv.client}</span>
                <span style={{ fontSize:11, color:"#a8c8e8" }}>{inv.type}</span>
                <span style={{ fontFamily:M, color:"#f0f8ff" }}>${inv.amount.toLocaleString()}</span>
                <span style={{ fontFamily:M, color:"#7aaacb" }}>${inv.usageCost}</span>
                <span style={{ fontFamily:M, color:"#f0f8ff", fontWeight:600 }}>${inv.total.toLocaleString()}</span>
                <div style={{ display:"flex", alignItems:"center", gap:5, flexWrap:"wrap" }}>
                  <span style={{ fontSize:10, fontWeight:600, color:stColors[inv.status], textTransform:"uppercase" }}>{inv.status}</span>
                  {isOverdue&&<span style={{ fontSize:8, fontWeight:700, color:"#f87171", background:"rgba(248,113,113,0.15)", padding:"1px 5px", borderRadius:3, fontFamily:M }}>{daysOverdue}d</span>}
                  {inv.stripe_invoice_id&&inv.status==="paid"&&(
                    <span style={{ fontSize:8, fontWeight:700, color:"#818cf8", background:"rgba(99,102,241,0.1)", border:"1px solid rgba(99,102,241,0.2)", padding:"1px 5px", borderRadius:3, fontFamily:M }}>
                      ⚡ Stripe
                    </span>
                  )}
                </div>
                <div>
                  {isOverdue&&(!fs||fs===null)&&<button onClick={()=>handleDraftFollowUp(inv)} style={{ fontSize:9, fontWeight:600, color:"#a5b4fc", background:"rgba(99,102,241,0.08)", border:"1px solid rgba(99,102,241,0.15)", borderRadius:5, padding:"3px 8px", cursor:"pointer", whiteSpace:"nowrap" }}>🤖 Draft Follow-up</button>}
                  {fs==="loading"&&<span style={{ fontSize:9, color:"#38bdf8", fontFamily:M, display:"flex", alignItems:"center", gap:3 }}><span style={{ width:5, height:5, borderRadius:"50%", background:"#38bdf8", animation:"pr 1.2s ease-out infinite" }}/>Drafting...</span>}
                  {fs==="done"&&<button onClick={()=>setExpandedEmail(prev=>({...prev,[inv.id]:!prev[inv.id]}))} style={{ fontSize:9, color:"#4ade80", background:"rgba(74,222,128,0.08)", border:"1px solid rgba(74,222,128,0.15)", borderRadius:5, padding:"3px 8px", cursor:"pointer" }}>{expandedEmail[inv.id]?"Hide":"View Email"}</button>}
                  {fs==="error"&&<span style={{ fontSize:9, color:"#f87171", fontFamily:M }}>✗ Error</span>}
                </div>
              </div>
              {/* Agent-drafted email panel */}
              {fs==="done"&&fr&&expandedEmail[inv.id]&&(
  <div style={{ padding:"12px 16px", background:"rgba(99,102,241,0.04)", borderBottom:"1px solid rgba(42,182,215,0.08)", animation:"fu 0.3s ease both" }}>
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
        <span style={{ fontSize:10, fontWeight:700, color:"#818cf8", fontFamily:M }}>🤖 AGENT-DRAFTED FOLLOW-UP EMAIL</span>
        {fr.escalation_level&&<span style={{ fontSize:9, fontWeight:700, textTransform:"uppercase", color:fr.escalation_level==="final"?"#f87171":fr.escalation_level==="firm"?"#fbbf24":"#4ade80", background:fr.escalation_level==="final"?"rgba(248,113,113,0.1)":fr.escalation_level==="firm"?"rgba(251,191,36,0.1)":"rgba(74,222,128,0.1)", border:`1px solid ${fr.escalation_level==="final"?"rgba(248,113,113,0.2)":fr.escalation_level==="firm"?"rgba(251,191,36,0.2)":"rgba(74,222,128,0.2)"}`, borderRadius:4, padding:"1px 6px" }}>{fr.escalation_level}</span>}
        {fr.flag_for_service_pause&&<span style={{ fontSize:9, fontWeight:700, color:"#f87171", background:"rgba(248,113,113,0.1)", border:"1px solid rgba(248,113,113,0.2)", borderRadius:4, padding:"1px 6px" }}>⚠ FLAG: SERVICE PAUSE</span>}
      </div>
      <button onClick={()=>{navigator.clipboard?.writeText(`Subject: ${fr.subject||""}\n\n${fr.body||""}`);}} style={{ fontSize:9, color:"#7aaacb", background:"transparent", border:"1px solid rgba(42,182,215,0.15)", borderRadius:4, padding:"2px 8px", cursor:"pointer" }}>Copy</button>
    </div>
    {fr.subject&&<div style={{ fontSize:10, fontWeight:600, color:"#f0f8ff", marginBottom:8, padding:"6px 10px", background:"#0d2b4e", borderRadius:5 }}>Subject: {fr.subject}</div>}
    <div style={{ fontSize:11, color:"#a8c8e8", lineHeight:1.6, padding:"10px 12px", background:"rgba(42,182,215,0.07)", borderRadius:7, whiteSpace:"pre-wrap" }}>
      {fr.body}
    </div>
    {fr.recommended_action&&(
      <div style={{ marginTop:8, padding:"6px 10px", background:"rgba(99,102,241,0.06)", border:"1px solid rgba(99,102,241,0.1)", borderRadius:5 }}>
        <span style={{ fontSize:9, color:"#818cf8", fontFamily:M, textTransform:"uppercase", fontWeight:600 }}>Next Action: </span>
        <span style={{ fontSize:10, color:"#f0f8ff" }}>{fr.recommended_action}</span>
      </div>
    )}
  </div>
)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
// ONBOARDING TRACKER (Feature 9) — with Agent 3 inline UI
function OnboardingTab() {
  const { ONBOARDING } = useData();
  const [planStates, setPlanStates] = useState({});
  const [planResults, setPlanResults] = useState({});
  const [expandedKickoff, setExpandedKickoff] = useState({});
  const phaseColors = { complete:"#4ade80", "in-progress":"#fbbf24", upcoming:"#4b5563" };
  const [onboardingUpdateText, setOnboardingUpdateText] = useState("");
  const [onboardingUpdateStatus, setOnboardingUpdateStatus] = useState("note");
  const [savingUpdate, setSavingUpdate] = useState(false);
  const [onboardingUpdates, setOnboardingUpdates] = useState({});

  const fetchOnboardingUpdates = async (projectId) => {
    const { data } = await supabase
      .from("onboarding_updates")
      .select("*")
      .eq("onboarding_project_id", projectId)
      .order("created_at", { ascending: false });
    if (data) setOnboardingUpdates(prev => ({ ...prev, [projectId]: data }));
  };

  const saveOnboardingUpdate = async (proj) => {
    if (!onboardingUpdateText.trim()) return;
    setSavingUpdate(true);
    const { error } = await supabase.from("onboarding_updates").insert({
      update_text: onboardingUpdateText.trim(),
      status: onboardingUpdateStatus,
      phase_name: proj.phases?.find(p => p.status === "in-progress")?.name || null,
    });
    if (!error) {
      setOnboardingUpdateText("");
      fetchOnboardingUpdates(proj.id);
    }
    setSavingUpdate(false);
  };

  const handleGeneratePlan = async (proj) => {
    setPlanStates(prev => ({ ...prev, [proj.id]: "loading" }));
    try {
      const res = await fetch("https://api.immaculate-consulting.org/api/agents/generate-onboarding-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-vapi-secret": import.meta.env.VITE_VAPI_WEBHOOK_SECRET },
        body: JSON.stringify({
          client_name: proj.client,
          tier: proj.tier,
          ehr: proj.ehr,
          kickoff_date: proj.kickoff,
          target_go_live: proj.targetGoLive,
          risks: proj.risks.join(", "),
          providers: proj.phases.length
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Plan generation failed");
      setPlanResults(prev => ({ ...prev, [proj.id]: data }));
      setPlanStates(prev => ({ ...prev, [proj.id]: "done" }));
    } catch (err) {
      setPlanStates(prev => ({ ...prev, [proj.id]: "error" }));
    }
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      <div>
        <h2 style={{ fontSize:17, fontWeight:700, color:"#f0f8ff" }}>Onboarding Tracker</h2>
        <p style={{ fontSize:11, color:"#7aaacb", marginTop:2 }}>Agent 3 — Onboarding Orchestrator available per project</p>
      </div>

      {ONBOARDING.map((proj,pi)=>{
        const ps = planStates[proj.id];
        const pr = planResults[proj.id];

        return (
          <Panel key={proj.id} title={proj.client} subtitle={`Tier ${proj.tier} · ${proj.ehr} · Go-live: ${proj.targetGoLive} (${proj.daysToGoLive}d)`}
            action={
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                {(!ps||ps===null)&&<button onClick={()=>handleGeneratePlan(proj)} style={{ fontSize:10, fontWeight:600, color:"#a5b4fc", background:"rgba(99,102,241,0.08)", border:"1px solid rgba(99,102,241,0.15)", borderRadius:6, padding:"4px 10px", cursor:"pointer" }}>🤖 Generate Plan</button>}
                {ps==="loading"&&<span style={{ fontSize:10, color:"#38bdf8", fontFamily:M, display:"flex", alignItems:"center", gap:5 }}><span style={{ width:6, height:6, borderRadius:"50%", background:"#38bdf8", animation:"pr 1.2s ease-out infinite" }}/>Generating...</span>}
                {ps==="done"&&<span style={{ fontSize:10, color:"#4ade80", fontFamily:M }}>✓ Plan ready</span>}
                {ps==="error"&&<span style={{ fontSize:10, color:"#f87171", fontFamily:M }}>✗ Error</span>}
              </div>
            }
          >
            {/* Phase progress bar */}
            <div style={{ display:"flex", gap:4, marginBottom:16 }}>
              {proj.phases.map((ph,i)=>(
                <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", gap:4 }}>
                  <div style={{ height:6, borderRadius:3, background:ph.status==="complete"?"#4ade80":ph.status==="in-progress"?"linear-gradient(90deg,#fbbf24 60%,rgba(255,255,255,0.06) 60%)":"rgba(255,255,255,0.04)" }}/>
                  <span style={{ fontSize:9, fontWeight:600, color:phaseColors[ph.status], fontFamily:M, textTransform:"uppercase" }}>{ph.name}</span>
                  <span style={{ fontSize:9, color:"#7aaacb" }}>{ph.start} – {ph.end}</span>
                  {ph.notes&&<span style={{ fontSize:10, color:"#a8c8e8", lineHeight:1.3 }}>{ph.notes}</span>}
                </div>
              ))}
            </div>

            {/* Risks */}
            {proj.risks.length>0&&(
              <div style={{ padding:"10px 14px", background:"rgba(251,191,36,0.06)", border:"1px solid rgba(251,191,36,0.1)", borderRadius:8, marginBottom:12 }}>
                <div style={{ fontSize:10, fontWeight:600, color:"#fbbf24", fontFamily:M, marginBottom:4 }}>RISKS</div>
                {proj.risks.map((r,i)=><div key={i} style={{ fontSize:11, color:"#f0f8ff", marginBottom:2 }}>• {r}</div>)}
              </div>
            )}

            {/* Agent 3 result panel */}
            {ps==="done"&&pr&&(
              <div style={{ borderTop:"1px solid rgba(42,182,215,0.15)", paddingTop:12, display:"flex", flexDirection:"column", gap:10, animation:"fu 0.3s ease both" }}>
                <div style={{ fontSize:10, fontWeight:700, color:"#818cf8", fontFamily:M, textTransform:"uppercase", display:"flex", alignItems:"center", gap:6 }}>
                  🤖 Agent 3 — Onboarding Orchestrator
                </div>

                {/* Summary */}
                <div style={{ padding:"10px 12px", background:"rgba(99,102,241,0.05)", border:"1px solid rgba(99,102,241,0.1)", borderLeft:"3px solid #6366f1", borderRadius:7 }}>
                  <div style={{ fontSize:11, color:"#f0f8ff", lineHeight:1.5 }}>{pr.summary || pr.qualification_summary}</div>
                </div>

                {/* Task list */}
               {(pr.task_list||pr.next_steps)?.length>0&&(
                  <div style={{ padding:"10px 12px", background:"rgba(42,182,215,0.07)", borderRadius:7 }}>
                    <div style={{ fontSize:10, color:"#4ade80", fontFamily:M, textTransform:"uppercase", fontWeight:600, marginBottom:6 }}>Generated Task List ({(pr.task_list||pr.next_steps).length} tasks)</div>
                    {(pr.task_list||pr.next_steps).map((s,si)=>(
                      <div key={si} style={{ display:"flex", alignItems:"flex-start", gap:8, marginBottom:5 }}>
                        <span style={{ width:16, height:16, borderRadius:4, border:"1.5px solid rgba(99,102,241,0.3)", flexShrink:0, marginTop:1 }}/>
                        <span style={{ fontSize:11, color:"#f0f8ff", lineHeight:1.4 }}>{typeof s === 'object' ? `[${s.phase}] ${s.task} — ${s.owner} (${s.duration})` : s}</span>
                      </div>
                    ))}
                  </div>
                )}
                {/* Kickoff email */}
                {(pr.kickoff_email||pr.pain_points)&&(
                  <div>
                    <button
                      onClick={()=>setExpandedKickoff(prev=>({...prev,[proj.id]:!prev[proj.id]}))}
                      style={{ fontSize:10, color:"#818cf8", background:"rgba(99,102,241,0.08)", border:"1px solid rgba(99,102,241,0.12)", borderRadius:6, padding:"5px 12px", cursor:"pointer", marginBottom:6 }}
                    >
                      {expandedKickoff[proj.id] ? "Hide Kickoff Email" : "📧 View Kickoff Email Draft"}
                    </button>
                    {expandedKickoff[proj.id]&&(
                      <div style={{ padding:"12px 14px", background:"rgba(42,182,215,0.07)", borderRadius:8, animation:"fu 0.2s ease both" }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                          <span style={{ fontSize:10, color:"#7aaacb", fontFamily:M, textTransform:"uppercase" }}>Kickoff Email Draft</span>
                          <button onClick={()=>navigator.clipboard?.writeText(pr.pain_points.join("\n"))} style={{ fontSize:9, color:"#7aaacb", background:"transparent", border:"1px solid rgba(42,182,215,0.15)", borderRadius:4, padding:"2px 8px", cursor:"pointer" }}>Copy</button>
                        </div>
                     <div style={{ fontSize:11, color:"#f0f8ff", lineHeight:1.6 }}>{pr.kickoff_email?.body || (Array.isArray(pr.pain_points) ? pr.pain_points.join("\n") : pr.pain_points)}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
         {/* Progress Update Log */}
            <div style={{ marginTop:16, borderTop:"1px solid rgba(42,182,215,0.15)", paddingTop:16 }}>
              <p style={{ color:"#a8c8e8", fontSize:11, fontWeight:600, marginBottom:10, textTransform:"uppercase", letterSpacing:"0.05em" }}>Progress Log</p>
              <div style={{ display:"flex", gap:8, marginBottom:12 }}>
                <select
                  value={onboardingUpdateStatus}
                  onChange={e => setOnboardingUpdateStatus(e.target.value)}
                  style={{ background:"#1e293b", color:"#a8c8e8", border:"1px solid rgba(255,255,255,0.1)", borderRadius:6, padding:"6px 8px", fontSize:12 }}
                >
                  <option value="note">📝 Note</option>
                  <option value="milestone">🏆 Milestone</option>
                  <option value="blocker">🚧 Blocker</option>
                  <option value="resolved">✅ Resolved</option>
                </select>
                <input
                  value={onboardingUpdateText}
                  onChange={e => setOnboardingUpdateText(e.target.value)}
                  placeholder="Log a progress update..."
                  style={{ flex:1, background:"#1e293b", color:"#f0f8ff", border:"1px solid rgba(255,255,255,0.1)", borderRadius:6, padding:"6px 12px", fontSize:13 }}
                />
                <button
                  onClick={() => saveOnboardingUpdate(proj)}
                  disabled={savingUpdate || !onboardingUpdateText.trim()}
                  style={{ background:"#6366f1", color:"#f0f8ff", border:"none", borderRadius:6, padding:"6px 14px", fontSize:13, cursor:"pointer", opacity: savingUpdate ? 0.6 : 1 }}
                >
                  {savingUpdate ? "..." : "Log"}
                </button>
              </div>
              {(onboardingUpdates[proj.id] || []).slice(0, 5).map(u => (
                <div key={u.id} style={{ display:"flex", gap:10, marginBottom:8, alignItems:"flex-start" }}>
                  <span style={{ fontSize:16, lineHeight:1 }}>
                    {u.status === "milestone" ? "🏆" : u.status === "blocker" ? "🚧" : u.status === "resolved" ? "✅" : "📝"}
                  </span>
                  <div>
                    <p style={{ color:"#f0f8ff", fontSize:13, margin:0 }}>{u.update_text}</p>
                    <p style={{ color:"#4a6a8a", fontSize:11, margin:"2px 0 0" }}>
                      {u.phase_name && `${u.phase_name} · `}
                      {new Date(u.created_at).toLocaleDateString('en-US', { month:'short', day:'numeric' })}
                    </p>
                  </div>
                </div>
              ))}
              {(onboardingUpdates[proj.id] || []).length === 0 && (
                <p style={{ color:"#4a6a8a", fontSize:12, fontStyle:"italic" }}>No updates logged yet.</p>
              )}
            </div>
          </Panel>
        );
      })}
    </div>
  );
}

// PROFITABILITY (Feature 10)
function ProfitabilityTab() {
  const { CLIENTS } = useData();
  const active = CLIENTS.filter(c=>c.status==="active").map(c=>({...c, p:calcProfitability(c)})).sort((a,b)=>b.p.effectiveRate-a.p.effectiveRate);
  const bestRate = Math.max(...active.map(c=>c.p.effectiveRate));
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      <h2 style={{ fontSize:17, fontWeight:700, color:"#f0f8ff" }}>Client Profitability</h2>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12 }}>
        <KPI label="Avg Effective Rate" value={Math.round(active.reduce((s,c)=>s+c.p.effectiveRate,0)/active.length)} prefix="$" suffix="/hr" spark={[120,140,155,165,175,180]} sparkColor="#4ade80"/>
        <KPI label="Avg Margin" value={Math.round(active.reduce((s,c)=>s+c.p.margin,0)/active.length)} suffix="%" spark={[60,65,68,70,72,74]} sparkColor="#818cf8" delay={80}/>
        <KPI label="Total Monthly Profit" value={Math.round(active.reduce((s,c)=>s+c.p.monthlyProfit,0))} prefix="$" spark={[8000,11000,14000,16000,18000,19000]} sparkColor="#fbbf24" delay={160}/>
      </div>
      {active.map((c,i)=>{
        const barW = c.p.effectiveRate > 0 ? (c.p.effectiveRate / bestRate) * 100 : 0;
        const rateColor = c.p.effectiveRate >= 200 ? "#4ade80" : c.p.effectiveRate >= 100 ? "#fbbf24" : "#f87171";
        return (
          <div key={c.id} style={{ background:"#0d2b4e", border:"1px solid rgba(42,182,215,0.15)", borderRadius:10, padding:"16px 18px", animation:`fu 0.4s ease ${i*60}ms both` }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
              <div><span style={{ fontSize:13, fontWeight:600, color:"#f0f8ff" }}>{c.name}</span><span style={{ fontSize:11, color:"#7aaacb", marginLeft:8 }}>Tier {c.tier} · {c.ehr}</span></div>
              <span style={{ fontSize:20, fontWeight:800, color:rateColor, fontFamily:M }}>${Math.round(c.p.effectiveRate)}<span style={{ fontSize:11, fontWeight:400 }}>/hr</span></span>
            </div>
            <div style={{ height:8, borderRadius:4, background:"#0d2b4e", marginBottom:10 }}>
              <div style={{ height:"100%", borderRadius:4, background:rateColor, width:`${barW}%`, transition:"width 0.8s" }}/>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:8, fontSize:11 }}>
              {[
                { l:"MRR", v:`$${c.monthlyFee.toLocaleString()}`, cl:"#f0f0f0" },
                { l:"Platform Cost", v:`$${c.platformCost}`, cl:"#f87171" },
                { l:"Hours/wk", v:`${c.weeklyHoursSpent}h`, cl:"#38bdf8" },
                { l:"Monthly Profit", v:`$${Math.round(c.p.monthlyProfit).toLocaleString()}`, cl:"#4ade80" },
                { l:"Margin", v:`${Math.round(c.p.margin)}%`, cl:c.p.margin>=70?"#4ade80":"#fbbf24" },
              ].map((m,j)=>(
                <div key={j}><div style={{ fontSize:9, color:"#7aaacb", fontFamily:M, textTransform:"uppercase" }}>{m.l}</div><div style={{ fontSize:13, fontWeight:600, color:m.cl, fontFamily:M, marginTop:2 }}>{m.v}</div></div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// SALES PREP (Feature 11)
function SalesPrepTab({ canEdit = true }) {
  const { PIPELINE } = useData();
  const [selected, setSelected] = useState(null);
  // Sync selected when PIPELINE loads (first non-empty render)
  useEffect(() => {
    if (PIPELINE.length > 0 && !selected) {
      setSelected(PIPELINE.find(p=>p.stage==="discovery") || PIPELINE[0]);
    }
  }, [PIPELINE]);
  // All hooks must be before any conditional return
  const [analysisState, setAnalysisState] = useState(null);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [transcriptText, setTranscriptText] = useState("");
  const [showTranscriptInput, setShowTranscriptInput] = useState(false);
  const [researchState, setResearchState] = useState(null);
  const [researchResult, setResearchResult] = useState(null);

  const prospects = PIPELINE.filter(p=>p.stage!=="closed-won");
  if (!selected) return <div style={{padding:40,textAlign:"center",fontSize:12,color:"#4a6a8a"}}>Loading...</div>;
  const weeklyAppts = selected.providers * 25;
  const recovered = ((selected.noShowBaseline - 8) / 100) * weeklyAppts;
  const annualRev = recovered * 65 * 52;
  const annualStaff = 10 * 18 * 52 * 0.8;
  const tierPrice = { 1:3500, 2:6500, 3:10000 }[selected.tier];
  const roi = ((annualRev + annualStaff - tierPrice*12) / (tierPrice*12)) * 100;

  const handleAnalyzeCall = async () => {
    if (!transcriptText.trim()) return;
    setAnalysisState("loading");
    try {
      const res = await fetch("https://api.immaculate-consulting.org/api/agents/analyze-call", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-vapi-secret": import.meta.env.VITE_VAPI_WEBHOOK_SECRET },
        body: JSON.stringify({ transcript: transcriptText, meeting_type: "discovery", client_name: selected.practice })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analysis failed");
      setAnalysisResult(data);
      setAnalysisState("done");
    } catch (err) {
      console.error("Analysis error:", err);
      setAnalysisState("error");
    }
  };
const handleResearchProspect = async () => {
    setResearchState("loading");
    setResearchResult(null);
    try {
      const res = await fetch("https://api.immaculate-consulting.org/api/agents/competitive-intel", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-vapi-secret": import.meta.env.VITE_VAPI_WEBHOOK_SECRET },
        body: JSON.stringify({
          practice_name: selected.practice,
          specialty: selected.specialty,
          ehr: selected.ehr,
          tier: selected.tier,
          providers: selected.providers,
          payer_mix: selected.payer,
          no_show_baseline: selected.noShowBaseline,
          value: selected.value,
          contact_name: selected.contact,
          ehr_difficulty: selected.ehrDifficulty,
          ehr_notes: selected.ehrNotes,
          stage: selected.stage,
          days_in_stage: selected.daysInStage,
          triggered_by: "manual_button"
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Research failed");
      setResearchResult(data);
      setResearchState("done");
    } catch (err) {
      setResearchState("error");
    }
  };
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16, maxWidth:800 }}>
      <h2 style={{ fontSize:17, fontWeight:700, color:"#f0f8ff" }}>Sales Discovery Prep</h2>
      <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
        {prospects.map(p=>(<button key={p.id} onClick={()=>setSelected(p)} style={{ padding:"6px 12px", borderRadius:6, border:`1px solid ${selected.id===p.id?"#6366f1":"rgba(255,255,255,0.06)"}`, background:selected.id===p.id?"rgba(99,102,241,0.12)":"rgba(255,255,255,0.02)", color:selected.id===p.id?"#a5b4fc":"#9ca3af", cursor:"pointer", fontSize:11, fontFamily:"inherit" }}>{p.practice}</button>))}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
        <Panel title="Practice Profile">
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {[
              { l:"Practice", v:selected.practice },
              { l:"Specialty", v:selected.specialty },
              { l:"Providers", v:selected.providers },
              { l:"Payer Mix", v:selected.payer },
              { l:"Contact", v:selected.contact },
              { l:"Pipeline Stage", v:STAGE_LABELS[selected.stage] },
              { l:"Days in Stage", v:selected.daysInStage },
            ].map((r,i)=>(<div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"4px 0", borderBottom:"1px solid rgba(42,182,215,0.08)" }}>
              <span style={{ fontSize:11.5, color:"#7aaacb" }}>{r.l}</span>
              <span style={{ fontSize:11.5, fontWeight:600, color:"#f0f8ff" }}>{r.v}</span>
            </div>))}
          </div>
        </Panel>
        <Panel title="EHR Integration Intel">
          <div style={{ padding:"12px 14px", background:"rgba(42,182,215,0.07)", borderRadius:8, marginBottom:10 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
              <span style={{ fontSize:16, fontWeight:700, color:"#f0f8ff" }}>{selected.ehr}</span>
              <span style={{ fontSize:11, fontWeight:600, color:selected.ehrDifficulty.startsWith("2")?"#4ade80":selected.ehrDifficulty.startsWith("3")?"#fbbf24":"#fb923c", fontFamily:M }}>Difficulty {selected.ehrDifficulty}</span>
            </div>
            <div style={{ fontSize:11, color:"#a8c8e8", lineHeight:1.5 }}>{selected.ehrNotes}</div>
            <div style={{ fontSize:11, fontWeight:600, color:"#38bdf8", marginTop:6, fontFamily:M }}>Timeline: {selected.ehrTimeline}</div>
          </div>
        </Panel>
      </div>
      <Panel title="Pre-Calculated ROI Talking Points" subtitle={`Tier ${selected.tier} recommended at $${tierPrice.toLocaleString()}/mo`}>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10 }}>
          {[
            { l:"Current No-Show", v:`${selected.noShowBaseline}%`, sub:"Baseline", c:"#f87171" },
            { l:"Target No-Show", v:"8%", sub:"Industry best", c:"#4ade80" },
            { l:"Appointments Recovered", v:`${Math.round(recovered)}/wk`, sub:`From ${weeklyAppts} total/wk`, c:"#fbbf24" },
            { l:"Revenue Recovered/yr", v:`$${Math.round(annualRev).toLocaleString()}`, sub:"At $65 avg visit", c:"#4ade80" },
            { l:"Staff Savings/yr", v:`$${Math.round(annualStaff).toLocaleString()}`, sub:"~10h/wk at $18/hr", c:"#38bdf8" },
            { l:"Projected ROI", v:`${Math.round(roi)}%`, sub:"Year 1", c:roi>0?"#4ade80":"#f87171" },
          ].map((m,i)=>(<div key={i} style={{ padding:"10px 12px", background:"rgba(42,182,215,0.07)", borderRadius:8 }}>
            <div style={{ fontSize:9, color:"#7aaacb", fontFamily:M, textTransform:"uppercase" }}>{m.l}</div>
            <div style={{ fontSize:18, fontWeight:700, color:m.c, fontFamily:M, margin:"3px 0 1px" }}>{m.v}</div>
            <div style={{ fontSize:10, color:"#7aaacb" }}>{m.sub}</div>
          </div>))}
        </div>
      </Panel>
      {/* Agent 2 — Analyze Call */}
      <div style={{ background:"rgba(99,102,241,0.03)", border:"1px solid rgba(99,102,241,0.1)", borderRadius:12, padding:"16px 18px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
          <div>
            <div style={{ fontSize:13, fontWeight:600, color:"#f0f8ff" }}>🤖 Discovery Call Analyzer</div>
            <div style={{ fontSize:10, color:"#7aaacb", marginTop:2 }}>Paste a transcript to get BANT score, pain points, and next steps</div>
          </div>
          <button onClick={()=>setShowTranscriptInput(p=>!p)} style={{ fontSize:10, color:"#818cf8", background:"rgba(99,102,241,0.08)", border:"1px solid rgba(99,102,241,0.12)", borderRadius:6, padding:"5px 12px", cursor:"pointer" }}>
            {showTranscriptInput ? "Hide" : "Paste Transcript"}
          </button>
        </div>
        {showTranscriptInput && (
          <div style={{ display:"flex", flexDirection:"column", gap:8, animation:"fu 0.3s ease both" }}>
            <textarea
              value={transcriptText}
              onChange={e=>setTranscriptText(e.target.value)}
              placeholder="Paste call transcript here..."
              style={{ width:"100%", minHeight:120, padding:"10px 12px", borderRadius:8, border:"1px solid rgba(42,182,215,0.15)", background:"rgba(42,182,215,0.07)", color:"#f0f8ff", fontSize:11.5, fontFamily:"inherit", outline:"none", resize:"vertical" }}
            />
            <button
              onClick={handleAnalyzeCall}
              disabled={!transcriptText.trim() || analysisState==="loading"}
              style={{ padding:"9px 0", borderRadius:8, border:"none", background:transcriptText.trim()?"linear-gradient(135deg,#6366f1,#8b5cf6)":"rgba(255,255,255,0.06)", color:transcriptText.trim()?"white":"#4b5563", fontSize:12, fontWeight:700, cursor:transcriptText.trim()?"pointer":"not-allowed" }}
            >
              {analysisState==="loading" ? "Analyzing..." : "▶ Analyze Call"}
            </button>
          </div>
        )}
        {analysisState==="loading" && (
          <div style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 0", fontSize:11, color:"#38bdf8" }}>
            <span style={{ width:7, height:7, borderRadius:"50%", background:"#38bdf8", display:"inline-block", animation:"pr 1.2s ease-out infinite" }}/>
            Running Discovery Analyzer — usually 15-20 seconds...
          </div>
        )}
        {analysisState==="error" && <div style={{ fontSize:11, color:"#f87171", marginTop:8 }}>✗ Analysis failed — check agent logs</div>}
        {analysisState==="done" && analysisResult && (
          <div style={{ display:"flex", flexDirection:"column", gap:10, marginTop:10, animation:"fu 0.4s ease both" }}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8 }}>
              <div style={{ padding:"10px 12px", background:"rgba(42,182,215,0.07)", borderRadius:8, textAlign:"center" }}>
                <div style={{ fontSize:9, color:"#7aaacb", fontFamily:M, textTransform:"uppercase", marginBottom:4 }}>BANT Score</div>
                <div style={{ fontSize:24, fontWeight:800, color:analysisResult.bant_score>=70?"#4ade80":analysisResult.bant_score>=40?"#fbbf24":"#f87171", fontFamily:M }}>{analysisResult.bant_score}</div>
                <div style={{ fontSize:9, color:"#7aaacb" }}>/100</div>
              </div>
              <div style={{ padding:"10px 12px", background:"rgba(42,182,215,0.07)", borderRadius:8, textAlign:"center" }}>
                <div style={{ fontSize:9, color:"#7aaacb", fontFamily:M, textTransform:"uppercase", marginBottom:4 }}>Rec. Tier</div>
                <div style={{ fontSize:24, fontWeight:800, color:"#818cf8", fontFamily:M }}>{analysisResult.recommended_tier}</div>
              </div>
              <div style={{ padding:"10px 12px", background:"rgba(42,182,215,0.07)", borderRadius:8, textAlign:"center" }}>
                <div style={{ fontSize:9, color:"#7aaacb", fontFamily:M, textTransform:"uppercase", marginBottom:4 }}>Urgency</div>
                <div style={{ fontSize:16, fontWeight:700, color:analysisResult.follow_up_urgency==="high"?"#f87171":analysisResult.follow_up_urgency==="medium"?"#fbbf24":"#4ade80", fontFamily:M, textTransform:"uppercase" }}>{analysisResult.follow_up_urgency}</div>
              </div>
            </div>
            <div style={{ padding:"10px 12px", background:"rgba(42,182,215,0.07)", borderRadius:8 }}>
              <div style={{ fontSize:10, fontWeight:600, color:"#7aaacb", textTransform:"uppercase", fontFamily:M, marginBottom:5 }}>Summary</div>
              <div style={{ fontSize:11.5, color:"#f0f8ff", lineHeight:1.5 }}>{analysisResult.qualification_summary}</div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
              <div style={{ padding:"10px 12px", background:"rgba(42,182,215,0.07)", borderRadius:8 }}>
                <div style={{ fontSize:10, fontWeight:600, color:"#f87171", textTransform:"uppercase", fontFamily:M, marginBottom:5 }}>Pain Points</div>
                {analysisResult.pain_points?.map((p,i)=><div key={i} style={{ fontSize:11, color:"#f0f8ff", marginBottom:3 }}>• {p}</div>)}
              </div>
              <div style={{ padding:"10px 12px", background:"rgba(42,182,215,0.07)", borderRadius:8 }}>
                <div style={{ fontSize:10, fontWeight:600, color:"#4ade80", textTransform:"uppercase", fontFamily:M, marginBottom:5 }}>Next Steps</div>
                {analysisResult.next_steps?.map((s,i)=><div key={i} style={{ fontSize:11, color:"#f0f8ff", marginBottom:3 }}>• {s}</div>)}
              </div>
            </div>
            {analysisResult.ic_services_match?.length > 0 && (
              <div style={{ padding:"10px 12px", background:"rgba(99,102,241,0.06)", border:"1px solid rgba(99,102,241,0.1)", borderRadius:8 }}>
                <div style={{ fontSize:10, fontWeight:600, color:"#818cf8", textTransform:"uppercase", fontFamily:M, marginBottom:5 }}>IC Services Match</div>
                <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                  {analysisResult.ic_services_match.map((s,i)=><span key={i} style={{ fontSize:10, color:"#a5b4fc", background:"rgba(99,102,241,0.1)", border:"1px solid rgba(99,102,241,0.15)", borderRadius:4, padding:"2px 8px" }}>{s}</span>)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
  {/* Agent 9 — Research Prospect */}
      <div style={{ background:"rgba(99,102,241,0.03)", border:"1px solid rgba(99,102,241,0.1)", borderRadius:12, padding:"16px 18px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
          <div>
            <div style={{ fontSize:13, fontWeight:600, color:"#f0f8ff" }}>🤖 Competitive Intel Researcher</div>
            <div style={{ fontSize:10, color:"#7aaacb", marginTop:2 }}>Pain points, objections, talking points, and deal strategy for {selected.practice}</div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            {researchState==="loading"&&<span style={{ fontSize:9, color:"#38bdf8", fontFamily:M, display:"flex", alignItems:"center", gap:4 }}><span style={{ width:6, height:6, borderRadius:"50%", background:"#38bdf8", animation:"pr 1.2s ease-out infinite" }}/>Researching...</span>}
            {researchState==="error"&&<span style={{ fontSize:9, color:"#f87171", fontFamily:M }}>✗ Error</span>}
            {(!researchState||researchState===null)&&<button onClick={handleResearchProspect} style={{ fontSize:10, color:"#818cf8", background:"rgba(99,102,241,0.08)", border:"1px solid rgba(99,102,241,0.12)", borderRadius:6, padding:"5px 12px", cursor:"pointer" }}>Research Prospect</button>}
            {researchState==="done"&&<button onClick={handleResearchProspect} style={{ fontSize:10, color:"#7aaacb", background:"transparent", border:"1px solid rgba(42,182,215,0.15)", borderRadius:6, padding:"5px 12px", cursor:"pointer" }}>Re-run</button>}
          </div>
        </div>
        {researchState==="done"&&researchResult&&(
          <div style={{ display:"flex", flexDirection:"column", gap:10, animation:"fu 0.4s ease both" }}>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
              <div style={{ padding:"8px 10px", background:"rgba(42,182,215,0.07)", borderRadius:7, textAlign:"center" }}>
                <div style={{ fontSize:9, color:"#7aaacb", fontFamily:M, textTransform:"uppercase", marginBottom:3 }}>Confidence to Close</div>
                <div style={{ fontSize:22, fontWeight:800, color:researchResult.confidence_to_close>=70?"#4ade80":researchResult.confidence_to_close>=40?"#fbbf24":"#f87171", fontFamily:M }}>{researchResult.confidence_to_close}</div>
                <div style={{ fontSize:9, color:"#7aaacb" }}>/100</div>
              </div>
              <div style={{ gridColumn:"2/4", padding:"8px 10px", background:"rgba(99,102,241,0.06)", border:"1px solid rgba(99,102,241,0.1)", borderRadius:7 }}>
                <div style={{ fontSize:9, color:"#818cf8", fontFamily:M, textTransform:"uppercase", fontWeight:600, marginBottom:3 }}>Recommended Next Action</div>
                <div style={{ fontSize:11, color:"#f0f8ff", lineHeight:1.4 }}>{researchResult.recommended_next_action}</div>
              </div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
              <div style={{ padding:"8px 10px", background:"rgba(42,182,215,0.07)", borderRadius:7 }}>
                <div style={{ fontSize:9, color:"#f87171", fontFamily:M, textTransform:"uppercase", fontWeight:600, marginBottom:4 }}>Specialty Pain Points</div>
                {researchResult.specialty_pain_points?.map((p,i)=><div key={i} style={{ fontSize:10, color:"#f0f8ff", marginBottom:2 }}>• {p}</div>)}
              </div>
              <div style={{ padding:"8px 10px", background:"rgba(42,182,215,0.07)", borderRadius:7 }}>
                <div style={{ fontSize:9, color:"#4ade80", fontFamily:M, textTransform:"uppercase", fontWeight:600, marginBottom:4 }}>IC Advantages</div>
                {researchResult.ic_competitive_advantages?.map((a,i)=><div key={i} style={{ fontSize:10, color:"#f0f8ff", marginBottom:2 }}>• {a}</div>)}
              </div>
              <div style={{ padding:"8px 10px", background:"rgba(42,182,215,0.07)", borderRadius:7 }}>
                <div style={{ fontSize:9, color:"#fbbf24", fontFamily:M, textTransform:"uppercase", fontWeight:600, marginBottom:4 }}>Likely Objections</div>
                {researchResult.likely_objections?.map((o,i)=><div key={i} style={{ fontSize:10, color:"#f0f8ff", marginBottom:2 }}>• {o}</div>)}
              </div>
              <div style={{ padding:"8px 10px", background:"rgba(42,182,215,0.07)", borderRadius:7 }}>
                <div style={{ fontSize:9, color:"#38bdf8", fontFamily:M, textTransform:"uppercase", fontWeight:600, marginBottom:4 }}>Medicaid Talking Points</div>
                {researchResult.medicaid_talking_points?.map((t,i)=><div key={i} style={{ fontSize:10, color:"#f0f8ff", marginBottom:2 }}>• {t}</div>)}
              </div>
            </div>
            <div style={{ padding:"8px 10px", background:"rgba(99,102,241,0.05)", border:"1px solid rgba(99,102,241,0.1)", borderRadius:7 }}>
              <div style={{ fontSize:9, color:"#818cf8", fontFamily:M, textTransform:"uppercase", fontWeight:600, marginBottom:3 }}>🤖 Agent Summary</div>
              <div style={{ fontSize:11, color:"#a8c8e8", lineHeight:1.4 }}>{researchResult.agent_summary}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// WEEKLY REPORT (Feature 12)

// WEEKLY REPORT (Feature 12) — with Agent 4 digest + 3 Things to Act On
function WeeklyReportTab() {
  const { CLIENTS, PIPELINE, AUTOMATIONS, INVOICES, TASKS, FINANCIALS, ONBOARDING, CAPACITY } = useData();
  const [digestState, setDigestState] = useState(null); // null | loading | done | error
  const [digestResult, setDigestResult] = useState(null);

  const totalROI = CLIENTS.reduce((s,c)=>s+calcClientROI(c).totalToDate,0);
  const pipeVal = PIPELINE.reduce((s,d)=>s+d.value,0);
  const avgHealth = Math.round(CLIENTS.reduce((s,c)=>s+c.healthScore,0)/CLIENTS.length);
  const critAuto = AUTOMATIONS.filter(a=>a.status==="critical").length;
  const totalExecs = AUTOMATIONS.reduce((s,a)=>s+a.execsToday,0);
  const overdue = INVOICES.filter(i=>i.status==="overdue");
  const capPct = Math.round((CAPACITY.currentUtilization/CAPACITY.weeklyHoursAvailable)*100);
  const staleDeals = PIPELINE.filter(p=>p.daysInStage>5);

  const handleGenerateDigest = async () => {
    setDigestState("loading");
    try {
      const res = await fetch("https://api.immaculate-consulting.org/api/agents/generate-weekly-digest", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-vapi-secret": import.meta.env.VITE_VAPI_WEBHOOK_SECRET },
        body: JSON.stringify({
          mrr: FINANCIALS.mrr, arr: FINANCIALS.arr, cash: FINANCIALS.cashOnHand,
          margin: Math.round(((FINANCIALS.mrr-FINANCIALS.monthlyExpenses)/FINANCIALS.mrr)*100),
          active_clients: CLIENTS.filter(c=>c.status==="active").length,
          avg_health: avgHealth, pipeline_value: pipeVal, pipeline_deals: PIPELINE.length,
          stale_deals: staleDeals.length, overdue_invoices: overdue.length,
          overdue_amount: overdue.reduce((s,i)=>s+i.total,0),
          critical_automations: critAuto, capacity_pct: capPct,
          total_roi: Math.round(totalROI),
          high_priority_tasks: TASKS.filter(t=>t.priority==="high").length
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Digest failed");
      setDigestResult(data);
      setDigestState("done");
    } catch (err) {
      setDigestState("error");
    }
  };

  // Derived "3 Things to Act On" from live data
  const threeThings = [
    overdue.length > 0 && { priority: "high", text: `Follow up ${overdue.length} overdue invoice${overdue.length>1?"s":""} — $${overdue.reduce((s,i)=>s+i.total,0).toLocaleString()} outstanding` },
    critAuto > 0 && { priority: "high", text: `Fix ${critAuto} critical automation${critAuto>1?"s":""} — service reliability at risk` },
    staleDeals.length > 0 && { priority: "medium", text: `${staleDeals.length} stale deal${staleDeals.length>1?"s":""} need follow-up — ${staleDeals.map(d=>d.practice).join(", ")}` },
    CLIENTS.filter(c=>c.healthScore<70).length > 0 && { priority: "medium", text: `${CLIENTS.filter(c=>c.healthScore<70).length} at-risk client${CLIENTS.filter(c=>c.healthScore<70).length>1?"s":""} — schedule check-ins before renewal` },
    capPct > 80 && { priority: "medium", text: `Capacity at ${capPct}% — review hiring plan before closing next deal` },
  ].filter(Boolean).slice(0, 3);

  const sections = [
    { title: "Revenue & Financial Health", items: [
      { l:"MRR", v:`$${FINANCIALS.mrr.toLocaleString()}`, c:"#818cf8" },
      { l:"Cash on Hand", v:`$${FINANCIALS.cashOnHand.toLocaleString()}`, c:"#4ade80" },
      { l:"A/R Outstanding", v:`$${FINANCIALS.accountsReceivable.toLocaleString()}`, c:"#fbbf24" },
      { l:"Net Margin", v:`${Math.round(((FINANCIALS.mrr-FINANCIALS.monthlyExpenses)/FINANCIALS.mrr)*100)}%`, c:"#4ade80" },
      { l:"Overdue Invoices", v:overdue.length>0?`${overdue.length} ($${overdue.reduce((s,i)=>s+i.total,0).toLocaleString()})`:"None", c:overdue.length?"#f87171":"#4ade80" },
    ]},
    { title: "Pipeline & Sales", items: [
      { l:"Pipeline Deals", v:PIPELINE.length.toString(), c:"#818cf8" },
      { l:"Pipeline Value", v:`$${pipeVal.toLocaleString()}/mo`, c:"#fbbf24" },
      { l:"Stale Deals (>5d)", v:staleDeals.length.toString(), c:staleDeals.length?"#f87171":"#4ade80" },
      { l:"Next Actions", v:`${TASKS.filter(t=>t.category==="sales").length} sales tasks`, c:"#38bdf8" },
    ]},
    { title: "Client Health & Delivery", items: [
      { l:"Active Clients", v:CLIENTS.filter(c=>c.status==="active").length.toString(), c:"#4ade80" },
      { l:"Avg Health Score", v:avgHealth.toString(), c:avgHealth>=80?"#4ade80":"#fbbf24" },
      { l:"Total Value Recovered", v:`$${Math.round(totalROI).toLocaleString()}`, c:"#4ade80" },
      { l:"Onboarding Projects", v:ONBOARDING.length.toString(), c:"#38bdf8" },
    ]},
    { title: "Operations", items: [
      { l:"Automations Running", v:AUTOMATIONS.length.toString(), c:"#818cf8" },
      { l:"Executions Today", v:totalExecs.toString(), c:"#4ade80" },
      { l:"Critical Issues", v:critAuto.toString(), c:critAuto?"#f87171":"#4ade80" },
      { l:"Capacity Utilization", v:`${capPct}%`, c:capPct>85?"#f87171":"#4ade80" },
    ]},
  ];

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16, maxWidth:800 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <h2 style={{ fontSize:17, fontWeight:700, color:"#f0f8ff" }}>Weekly Business Report</h2>
          <p style={{ fontSize:11, color:"#7aaacb", marginTop:2, fontFamily:M }}>Week of March 17–21, 2026 · IC-BOS Weekly Digest</p>
        </div>
        <button
          onClick={handleGenerateDigest}
          disabled={digestState==="loading"}
          style={{ fontSize:11, fontWeight:600, color: digestState==="loading"?"#38bdf8":"#a5b4fc", background: digestState==="loading"?"rgba(56,189,248,0.08)":"rgba(99,102,241,0.1)", border:`1px solid ${digestState==="loading"?"rgba(56,189,248,0.2)":"rgba(99,102,241,0.2)"}`, borderRadius:6, padding:"6px 14px", cursor: digestState==="loading"?"not-allowed":"pointer", display:"flex", alignItems:"center", gap:6 }}
        >
          {digestState==="loading" ? (
            <><span style={{ width:7, height:7, borderRadius:"50%", background:"#38bdf8", animation:"pr 1.2s ease-out infinite" }}/>Generating...</>
          ) : "🤖 Generate Digest"}
        </button>
      </div>

      {/* 3 Things to Act On — always visible from live data */}
      <div style={{ background:"linear-gradient(135deg,rgba(99,102,241,0.06),rgba(139,92,246,0.04))", border:"1px solid rgba(99,102,241,0.15)", borderRadius:12, padding:"14px 18px" }}>
        <div style={{ fontSize:11, fontWeight:700, color:"#a5b4fc", marginBottom:10, display:"flex", alignItems:"center", gap:6 }}>
          ⚡ 3 Things to Act On This Week
        </div>
        {threeThings.length === 0 ? (
          <div style={{ fontSize:11, color:"#4ade80" }}>✓ No urgent actions — business is healthy this week</div>
        ) : (
          threeThings.map((item,i) => (
            <div key={i} style={{ display:"flex", alignItems:"flex-start", gap:10, marginBottom:i<threeThings.length-1?8:0 }}>
              <span style={{ fontSize:10, fontWeight:700, color:item.priority==="high"?"#f87171":"#fbbf24", background:item.priority==="high"?"rgba(248,113,113,0.12)":"rgba(251,191,36,0.12)", padding:"1px 6px", borderRadius:4, fontFamily:M, flexShrink:0, marginTop:1 }}>{item.priority.toUpperCase()}</span>
              <span style={{ fontSize:12, color:"#f0f8ff", lineHeight:1.4 }}>{item.text}</span>
            </div>
          ))
        )}
      </div>

      {/* AI Digest panel — shows after generation */}
      {digestState==="loading" && (
        <div style={{ background:"rgba(99,102,241,0.04)", border:"1px solid rgba(99,102,241,0.1)", borderRadius:12, padding:"16px 18px", display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ width:8, height:8, borderRadius:"50%", background:"#38bdf8", animation:"pr 1.2s ease-out infinite" }}/>
          <span style={{ fontSize:11, color:"#7dd3fc" }}>Agent 4 (Weekly Digest) is generating your narrative report...</span>
        </div>
      )}
      {digestState==="error" && (
        <div style={{ background:"rgba(248,113,113,0.05)", border:"1px solid rgba(248,113,113,0.1)", borderRadius:10, padding:"12px 16px", fontSize:11, color:"#f87171" }}>
          ✗ Digest generation failed — check agent logs
        </div>
      )}
      {digestState==="done" && digestResult && (
        <div style={{ background:"rgba(99,102,241,0.04)", border:"1px solid rgba(99,102,241,0.12)", borderLeft:"3px solid #6366f1", borderRadius:12, padding:"16px 18px", animation:"fu 0.4s ease both" }}>
          <div style={{ fontSize:10, fontWeight:700, color:"#818cf8", fontFamily:M, textTransform:"uppercase", marginBottom:10, display:"flex", alignItems:"center", gap:6 }}>
            🤖 Agent 4 — AI Narrative Digest
          </div>
         <div style={{ fontSize:12, color:"#f0f8ff", lineHeight:1.7, marginBottom:12 }}>{digestResult.narrative || digestResult.qualification_summary}</div>
          {(digestResult.top_priorities||digestResult.next_steps)?.length>0 && (
            <div>
              <div style={{ fontSize:10, color:"#4ade80", fontFamily:M, textTransform:"uppercase", fontWeight:600, marginBottom:6 }}>Top Priorities</div>
              {(digestResult.top_priorities||digestResult.next_steps).map((s,si)=>(
                <div key={si} style={{ display:"flex", alignItems:"flex-start", gap:8, marginBottom:6 }}>
                  <span style={{ fontSize:9, fontWeight:700, color:typeof s==="object"&&s.priority==="high"?"#f87171":"#fbbf24", background:typeof s==="object"&&s.priority==="high"?"rgba(248,113,113,0.12)":"rgba(251,191,36,0.12)", padding:"1px 6px", borderRadius:4, fontFamily:M, flexShrink:0, marginTop:1 }}>{typeof s==="object"?s.priority?.toUpperCase():String(si+1).padStart(2,"0")}</span>
                  <div>
                    <div style={{ fontSize:11.5, color:"#f0f8ff", lineHeight:1.4 }}>{typeof s==="object"?s.action:s}</div>
                    {typeof s==="object"&&s.reason&&<div style={{ fontSize:10, color:"#7aaacb", marginTop:2 }}>{s.reason}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Data sections */}
      {sections.map((sec,si)=>(
        <Panel key={si} title={sec.title}>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {sec.items.map((item,i)=>(
              <div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:"1px solid rgba(42,182,215,0.08)" }}>
                <span style={{ fontSize:12, color:"#a8c8e8" }}>{item.l}</span>
                <span style={{ fontSize:12, fontWeight:600, color:item.c, fontFamily:M }}>{item.v}</span>
              </div>
            ))}
          </div>
        </Panel>
      ))}
    </div>
  );
}

// ROI Tab (Feature 1)
function ROITab() {
  const { CLIENTS } = useData();
  const crs = CLIENTS.filter(c=>c.status==="active").map(c=>({...c,r:calcClientROI(c)}));
  const totalRec = crs.reduce((s,c)=>s+c.r.totalToDate,0);
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      <div style={{ textAlign:"center", padding:"20px 0 8px", animation:"fu 0.5s ease both" }}>
        <div style={{ fontSize:10, fontWeight:600, color:"#7aaacb", textTransform:"uppercase", letterSpacing:"0.1em", fontFamily:M, marginBottom:6 }}>Total Client Value Recovered</div>
        <div style={{ fontSize:44, fontWeight:800, color:"#4ade80", fontFamily:M, lineHeight:1 }}><AnimNum value={Math.round(totalRec)} prefix="$" dur={1800}/></div>
      </div>
      {crs.map((c,i)=>(
        <Panel key={c.id} title={c.name} subtitle={`Tier ${c.tier} · ${c.r.moActive} months · ${c.ehr}`}>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, fontSize:12 }}>
            {[{ l:"No-Show", v:`${c.noShowBefore}%→${c.noShowCurrent}%`, c:"#4ade80" },{ l:"Recovered", v:`$${Math.round(c.r.totalToDate).toLocaleString()}`, c:"#fbbf24" },{ l:"Hours/wk Saved", v:`${c.weeklyHoursSaved}h`, c:"#38bdf8" },{ l:"ROI", v:`${Math.round(c.r.roiPct)}%`, c:c.r.roiPct>0?"#4ade80":"#f87171" }].map((m,j)=>(
              <div key={j} style={{ padding:"8px 10px", background:"rgba(42,182,215,0.07)", borderRadius:7 }}>
                <div style={{ fontSize:9, color:"#7aaacb", fontFamily:M, textTransform:"uppercase" }}>{m.l}</div>
                <div style={{ fontSize:15, fontWeight:700, color:m.c, fontFamily:M, marginTop:2 }}>{m.v}</div>
              </div>
            ))}
          </div>
        </Panel>
      ))}
    </div>
  );
}

// Renewals Tab (Feature 2) — with Agent 6 inline UI
function RenewalsTab({ canEdit = true }) {
  const { CLIENTS } = useData();
  const [predictStates, setPredictStates] = useState({});
  const [predictResults, setPredictResults] = useState({});

  const handlePredictRisk = async (client) => {
    setPredictStates(prev => ({ ...prev, [client.id]: "loading" }));
    try {
      const daysToRenewal = Math.round((new Date(client.renewalDate) - Date.now()) / 864e5);
      const res = await fetch("https://api.immaculate-consulting.org/api/agents/renewal-predictor", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-vapi-secret": import.meta.env.VITE_VAPI_WEBHOOK_SECRET },
        body: JSON.stringify({
          client_name: client.name,
          health_score: client.healthScore,
          tier: client.tier,
          ehr: client.ehr,
          monthly_fee: client.monthlyFee,
          no_show_before: client.noShowBefore,
          no_show_current: client.noShowCurrent,
          weekly_hours_saved: client.weeklyHoursSaved,
          automations: client.automations.join(", "),
          renewal_date: client.renewalDate,
          days_to_renewal: daysToRenewal,
          next_milestone: client.nextMilestone,
          triggered_by: "manual_button"
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Prediction failed");
      setPredictResults(prev => ({ ...prev, [client.id]: data }));
      setPredictStates(prev => ({ ...prev, [client.id]: "done" }));
    } catch (err) {
      setPredictStates(prev => ({ ...prev, [client.id]: "error" }));
    }
  };

  const sorted = [...CLIENTS].sort((a,b)=>new Date(a.renewalDate)-new Date(b.renewalDate));

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
      <div>
        <h2 style={{ fontSize:17, fontWeight:700, color:"#f0f8ff" }}>Renewal Radar</h2>
        <p style={{ fontSize:11, color:"#7aaacb", marginTop:2 }}>Agent 6 — Renewal Risk Predictor available per client</p>
      </div>

      {sorted.map((c,i)=>{
        const d = Math.round((new Date(c.renewalDate)-Date.now())/864e5);
        const risk = c.healthScore<70&&d<60;
        const soon = d<=90;
        const bc = risk?"#f87171":soon?"#fbbf24":"#4ade80";
        const bw = Math.max(5,Math.min(100,(1-d/365)*100));
        const churnRisk = c.healthScore<65?"High":c.healthScore<80?"Medium":"Low";
        const churnColor = churnRisk==="High"?"#f87171":churnRisk==="Medium"?"#fbbf24":"#4ade80";
        const churnBg = churnRisk==="High"?"rgba(248,113,113,0.12)":churnRisk==="Medium"?"rgba(251,191,36,0.12)":"rgba(74,222,128,0.12)";
        const ps = predictStates[c.id];
        const pr = predictResults[c.id];

        return (
          <div key={c.id} style={{ background:risk?"rgba(248,113,113,0.05)":"rgba(255,255,255,0.02)", border:`1px solid ${risk?"rgba(248,113,113,0.12)":"rgba(255,255,255,0.05)"}`, borderRadius:10, padding:"14px 18px", animation:`fu 0.4s ease ${i*60}ms both` }}>

            {/* Header row */}
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <span style={{ fontSize:13, fontWeight:600, color:"#f0f8ff" }}>{c.name}</span>
                <span style={{ fontSize:10.5, color:"#7aaacb" }}>Tier {c.tier} · ${c.monthlyFee.toLocaleString()}/mo</span>
                {/* Churn risk badge */}
                <span style={{ fontSize:9, fontWeight:700, color:churnColor, background:churnBg, padding:"2px 8px", borderRadius:5, fontFamily:M }}>{churnRisk} Risk</span>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                {risk&&<span style={{ fontSize:9, fontWeight:700, color:"#f87171", background:"rgba(248,113,113,0.12)", padding:"2px 8px", borderRadius:5, fontFamily:M }}>AT RISK</span>}
                <span style={{ fontSize:11, fontWeight:600, color:bc, fontFamily:M }}>{d}d</span>
                {/* Predict Risk button */}
                {(!ps||ps===null)&&<button onClick={()=>handlePredictRisk(c)} style={{ fontSize:9.5, fontWeight:600, color:"#a5b4fc", background:"rgba(99,102,241,0.08)", border:"1px solid rgba(99,102,241,0.15)", borderRadius:6, padding:"4px 10px", cursor:"pointer" }}>🤖 Predict Risk</button>}
                {ps==="loading"&&<span style={{ fontSize:9, color:"#38bdf8", fontFamily:M, display:"flex", alignItems:"center", gap:4 }}><span style={{ width:6, height:6, borderRadius:"50%", background:"#38bdf8", animation:"pr 1.2s ease-out infinite" }}/>Analyzing...</span>}
                {ps==="done"&&<span style={{ fontSize:9, color:"#4ade80", fontFamily:M }}>✓ Done</span>}
                {ps==="error"&&<span style={{ fontSize:9, color:"#f87171", fontFamily:M }}>✗ Error</span>}
              </div>
            </div>

            {/* Progress bar */}
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
              <div style={{ flex:1, height:5, borderRadius:3, background:"#0d2b4e" }}>
                <div style={{ height:"100%", borderRadius:3, background:bc, width:`${bw}%` }}/>
              </div>
              <span style={{ fontSize:10, color:"#a8c8e8", fontFamily:M }}>{c.renewalDate}</span>
            </div>

            {/* Stats row */}
            <div style={{ display:"flex", gap:14, fontSize:10.5, color:"#a8c8e8" }}>
              <span>Health: <span style={{ color:c.healthScore>=80?"#4ade80":c.healthScore>=70?"#fbbf24":"#f87171", fontWeight:600 }}>{c.healthScore}</span></span>
              <span>No-Show: <span style={{ fontWeight:600, color:"#f0f8ff" }}>{c.noShowCurrent}%</span></span>
              <span>ARR: <span style={{ fontWeight:600, color:"#f0f8ff" }}>${(c.monthlyFee*12).toLocaleString()}</span></span>
              <span>Hours Saved/wk: <span style={{ fontWeight:600, color:"#4ade80" }}>{c.weeklyHoursSaved}h</span></span>
            </div>

            {/* Agent 6 result panel */}
            {ps==="done"&&pr&&(
              <div style={{ marginTop:12, paddingTop:12, borderTop:"1px solid rgba(42,182,215,0.15)", display:"flex", flexDirection:"column", gap:8, animation:"fu 0.3s ease both" }}>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8 }}>
                  <div style={{ padding:"8px 10px", background:"rgba(42,182,215,0.07)", borderRadius:7, textAlign:"center" }}>
                    <div style={{ fontSize:9, color:"#7aaacb", fontFamily:M, textTransform:"uppercase", marginBottom:3 }}>Renewal Score</div>
                    <div style={{ fontSize:22, fontWeight:800, color:pr.renewal_score>=70?"#4ade80":pr.renewal_score>=40?"#fbbf24":"#f87171", fontFamily:M }}>{pr.renewal_score}</div>
                    <div style={{ fontSize:9, color:"#7aaacb" }}>/100</div>
                  </div>
                  <div style={{ padding:"8px 10px", background:"rgba(42,182,215,0.07)", borderRadius:7, textAlign:"center" }}>
                    <div style={{ fontSize:9, color:"#7aaacb", fontFamily:M, textTransform:"uppercase", marginBottom:3 }}>Churn Risk</div>
                    <div style={{ fontSize:14, fontWeight:700, color:pr.churn_probability==="high"?"#f87171":pr.churn_probability==="medium"?"#fbbf24":"#4ade80", fontFamily:M, textTransform:"uppercase" }}>{pr.churn_probability}</div>
                  </div>
                  <div style={{ padding:"8px 10px", background:"rgba(42,182,215,0.07)", borderRadius:7, textAlign:"center" }}>
                    <div style={{ fontSize:9, color:"#7aaacb", fontFamily:M, textTransform:"uppercase", marginBottom:3 }}>Urgency</div>
                    <div style={{ fontSize:14, fontWeight:700, color:pr.urgency==="high"?"#f87171":pr.urgency==="medium"?"#fbbf24":"#4ade80", fontFamily:M, textTransform:"uppercase" }}>{pr.urgency}</div>
                  </div>
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                  <div style={{ padding:"8px 10px", background:"rgba(42,182,215,0.07)", borderRadius:7 }}>
                    <div style={{ fontSize:9, color:"#f87171", fontFamily:M, textTransform:"uppercase", fontWeight:600, marginBottom:4 }}>Churn Signals</div>
                    {pr.churn_signals?.slice(0,3).map((p,pi)=><div key={pi} style={{ fontSize:10, color:"#f0f8ff", marginBottom:2 }}>• {p}</div>)}
                  </div>
                  <div style={{ padding:"8px 10px", background:"rgba(42,182,215,0.07)", borderRadius:7 }}>
                    <div style={{ fontSize:9, color:"#4ade80", fontFamily:M, textTransform:"uppercase", fontWeight:600, marginBottom:4 }}>Renewal Talking Points</div>
                    {pr.renewal_talking_points?.slice(0,3).map((s,si)=><div key={si} style={{ fontSize:10, color:"#f0f8ff", marginBottom:2 }}>• {s}</div>)}
                  </div>
                </div>
                {pr.upsell_potential&&(
                  <div style={{ padding:"8px 10px", background:"rgba(74,222,128,0.04)", border:"1px solid rgba(74,222,128,0.1)", borderRadius:7 }}>
                    <div style={{ fontSize:9, color:"#4ade80", fontFamily:M, textTransform:"uppercase", fontWeight:600, marginBottom:3 }}>Upsell Potential</div>
                    <div style={{ fontSize:10, color:"#f0f8ff" }}>{pr.upsell_potential}</div>
                  </div>
                )}
                <div style={{ padding:"8px 10px", background:"rgba(99,102,241,0.05)", border:"1px solid rgba(99,102,241,0.1)", borderRadius:7 }}>
                  <div style={{ fontSize:9, color:"#818cf8", fontFamily:M, textTransform:"uppercase", fontWeight:600, marginBottom:3 }}>🤖 Agent Summary</div>
                  <div style={{ fontSize:11, color:"#a8c8e8", lineHeight:1.4 }}>{pr.agent_summary}</div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Proposal Builder (Feature 3) — Full service catalog
function ProposalTab() {
  const { PIPELINE } = useData();
  const [mode, setMode] = useState("managed");
  // ── Agent-generated proposals from Supabase ──────────────────────
  const [agentProposals, setAgentProposals] = useState([]);
  const [proposalsLoading, setProposalsLoading] = useState(true);
  const [expandedProposal, setExpandedProposal] = useState(null);

  useEffect(() => {
    supabase
      .from("proposals")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (data) setAgentProposals(data);
        setProposalsLoading(false);
      });
  }, []);

  const printAgentProposal = (p) => {
    const roi = p.roi_projection || {};
    const today = new Date();
    const dateStr = today.toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' });
    const validThru = new Date(today.setDate(today.getDate()+30)).toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' });
    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html><html><head><title>Proposal - ${p.practice_name}</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:'Segoe UI',Arial,sans-serif;color:#1e293b;max-width:850px;margin:0 auto;padding:40px 48px;font-size:13px;line-height:1.6}
      h1{color:#6366f1;font-size:26px;font-weight:800;margin-bottom:2px}
      h2{font-size:15px;font-weight:700;color:#1e293b;border-bottom:2px solid #6366f1;padding-bottom:6px;margin:28px 0 14px;text-transform:uppercase;letter-spacing:0.05em}
      h3{font-size:13px;font-weight:700;color:#334155;margin:16px 0 8px}
      .subtitle{color:#64748b;font-size:13px;margin-bottom:28px}
      .cover{margin-bottom:32px;padding-bottom:24px;border-bottom:3px solid #6366f1}
      .cover-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:16px}
      .cover-block p{font-size:12px;color:#475569;margin:2px 0}
      .cover-block strong{color:#1e293b;font-size:13px}
      .kpi-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:14px 0}
      .kpi{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;text-align:center}
      .kpi .value{font-size:20px;font-weight:800;color:#6366f1}
      .kpi .label{font-size:11px;color:#64748b;margin-top:3px}
      .content{white-space:pre-wrap;line-height:1.7;font-size:13px;color:#334155;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:14px 0}
      .email-box{background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:16px;margin:14px 0;white-space:pre-wrap;font-size:12px;color:#0c4a6e}
      .badge{display:inline-block;background:rgba(99,102,241,0.1);color:#6366f1;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600}
      .footer{margin-top:36px;padding-top:14px;border-top:2px solid #e2e8f0;color:#64748b;font-size:11px;display:flex;justify-content:space-between}
      @media print{body{padding:20px 32px}}
    </style></head><body>
    <div class="cover">
      <h1>Immaculate Consulting</h1>
      <div class="subtitle">Operations Transformation Proposal <span class="badge">AI Generated</span></div>
      <div class="cover-grid">
        <div class="cover-block">
          <strong>Prepared for:</strong>
          <p>${p.practice_name}</p>
          ${p.specialty ? `<p>${p.specialty}</p>` : ''}
          ${p.ehr ? `<p>EHR: ${p.ehr}</p>` : ''}
          ${p.tier ? `<p>Service Tier: Tier ${p.tier}</p>` : ''}
        </div>
        <div class="cover-block">
          <strong>Prepared by:</strong>
          <p>Immaculate Consulting</p>
          <p>Leonard Croom, Principal</p>
          <p>leonard@immaculate-consulting.org</p>
          <p style="margin-top:8px;font-size:11px;color:#94a3b8;">Date: ${dateStr}</p>
          <p style="font-size:11px;color:#94a3b8;">Valid Through: ${validThru}</p>
        </div>
      </div>
    </div>

    <h2>Investment Summary</h2>
    <div class="kpi-grid">
      ${p.monthly_fee ? `<div class="kpi"><div class="value">$${Number(p.monthly_fee).toLocaleString()}/mo</div><div class="label">Monthly Fee</div></div>` : ''}
      ${p.setup_fee ? `<div class="kpi"><div class="value">$${Number(p.setup_fee).toLocaleString()}</div><div class="label">Setup Fee</div></div>` : ''}
      ${p.monthly_fee ? `<div class="kpi"><div class="value">$${(Number(p.monthly_fee)*12 + Number(p.setup_fee||0)).toLocaleString()}</div><div class="label">Year 1 Total</div></div>` : ''}
      ${roi.annualBenefit ? `<div class="kpi"><div class="value">$${Math.round(roi.annualBenefit).toLocaleString()}</div><div class="label">Annual Benefit</div></div>` : ''}
      ${roi.roiPct ? `<div class="kpi"><div class="value">${Math.round(roi.roiPct)}%</div><div class="label">Year 1 ROI</div></div>` : ''}
      ${roi.paybackMonths ? `<div class="kpi"><div class="value">${roi.paybackMonths} mo</div><div class="label">Payback Period</div></div>` : ''}
    </div>

    ${p.proposal_content ? `<h2>Proposal Details</h2><div class="content">${p.proposal_content}</div>` : ''}
    ${p.follow_up_email ? `<h2>Follow-up Email Draft</h2><div class="email-box">${p.follow_up_email}</div>` : ''}

    <div class="footer">
      <span>Immaculate Consulting | immaculate-consulting.org | Leonard Croom</span>
      <span>Valid through ${validThru} | Confidential</span>
    </div>
    </body></html>`);
    win.document.close();
    setTimeout(() => { win.print(); }, 500);
  };
  const [pid, setPid] = useState(null);
  const [tier, setTier] = useState(2);
  const [selectedServices, setSelectedServices] = useState([]);
  const [selectedAddOns, setSelectedAddOns] = useState([]);

  // Set default pid once PIPELINE loads
  useEffect(() => { if (!pid && PIPELINE.length > 0) setPid(PIPELINE[0].id); }, [PIPELINE]);

  const prospect = PIPELINE.find(p=>p.id===pid) || PIPELINE[0] || null;
  if (!prospect) return <div style={{padding:40,textAlign:"center",fontSize:12,color:"#4a6a8a"}}>Loading proposals...</div>;

  // ── Service catalogs ──
  const managedTiers = {
    1: { n:"AI Starter", p:3500, desc:"1–3 providers", includes:"Appointment reminders (SMS+email), basic AI chat, insurance verification (100/mo), dashboard, 2 training sessions, unlimited support" },
    2: { n:"Productivity Suite", p:6500, desc:"4–10 providers", includes:"Everything in Tier 1 + AI Knowledge Hub, lab results routing, claims denial monitoring + appeal letters, unlimited verification, patient portal, advanced analytics, quarterly reviews" },
    3: { n:"Practice Transformation", p:10000, desc:"10+ providers", includes:"Everything in Tier 2 + custom AI agents, predictive analytics, capacity planning, multi-location automation, custom integrations, enterprise web apps included, dedicated team" },
  };

  const individualServices = [
    { id:"prompt", name:"Prompt Engineering", options:[{n:"Starter Pack (5 prompts)",p:750},{n:"Growth Pack (15 prompts)",p:1800}], type:"one-time" },
    { id:"training", name:"AI Staff Training", options:[{n:"Half-Day Workshop (3hr, 10 staff)",p:1200},{n:"Full-Day Workshop (6hr, 15 staff)",p:2200},{n:"Follow-Up Q&A (1hr)",p:200}], type:"one-time" },
    { id:"webapp", name:"Web App Development", options:[{n:"Simple (1-2 features, 2-3wk)",p:4500},{n:"Medium (3-5 features, 4-6wk)",p:9000},{n:"Complex (full system, 8-12wk)",p:18000}], type:"project", monthly:[250,400,750] },
    { id:"strategy", name:"AI Strategy Consultation", options:[{n:"Strategy Session (2hr + summary)",p:600},{n:"Full Assessment + Roadmap (half-day)",p:1500}], type:"one-time" },
    { id:"docs", name:"Document & SOP Creation", options:[{n:"Single SOP (1 workflow, 5pg)",p:250},{n:"SOP Bundle (5 SOPs)",p:1000},{n:"Full SOP Library (10-15 SOPs)",p:1800},{n:"Policy Manual (20-30pg)",p:2500},{n:"Staff Training Guide",p:750}], type:"one-time" },
    { id:"forms", name:"Forms, Workbooks & Templates", options:[{n:"Single form/template",p:150},{n:"Form Bundle (5 forms)",p:600},{n:"Simple workbook (3 sheets)",p:350},{n:"Advanced workbook (4+ sheets)",p:750},{n:"Ops Reporting Dashboard (Excel)",p:900}], type:"one-time" },
  ];

  const webAppAddOns = [
    { id:"ao-dash", name:"Operations Dashboard", priceRange:"$2,000–$5,000", price:3500, monthly:300 },
    { id:"ao-checkin", name:"Patient Check-In Kiosk", priceRange:"$1,500–$3,000", price:2250, monthly:200 },
    { id:"ao-workflow", name:"Staff Workflow Tool", priceRange:"$3,000–$6,000", price:4500, monthly:400 },
    { id:"ao-referral", name:"Referral Portal", priceRange:"$2,500–$5,000", price:3750, monthly:350 },
    { id:"ao-insver", name:"Insurance Verification Hub", priceRange:"$5,000–$7,000", price:6000, monthly:400 },
    { id:"ao-sched", name:"Staff Scheduling System", priceRange:"$8,000–$10,000", price:9000, monthly:500 },
  ];

  const toggleService = (svcId, optIdx) => {
    setSelectedServices(prev => {
      const key = `${svcId}-${optIdx}`;
      return prev.find(s=>s.key===key) ? prev.filter(s=>s.key!==key) : [...prev, { key, svcId, optIdx }];
    });
  };
  const toggleAddOn = (aoId) => {
    setSelectedAddOns(prev => prev.includes(aoId) ? prev.filter(x=>x!==aoId) : [...prev, aoId]);
  };

  // ── Price calculations ──
  const managedAnnual = mode !== "individual" ? managedTiers[tier].p * 12 : 0;
  const managedMonthly = mode !== "individual" ? managedTiers[tier].p : 0;

  const svcTotal = selectedServices.reduce((s, sel) => {
    const svc = individualServices.find(x=>x.id===sel.svcId);
    return s + (svc ? svc.options[sel.optIdx].p : 0);
  }, 0);

  const addOnOneTime = selectedAddOns.reduce((s, id) => s + (webAppAddOns.find(a=>a.id===id)?.price||0), 0);
  const addOnMonthly = selectedAddOns.reduce((s, id) => s + (webAppAddOns.find(a=>a.id===id)?.monthly||0), 0);

  // Bundle discount: 10% off individual services when 2+ selected in same quarter
  const uniqueSvcTypes = [...new Set(selectedServices.map(s=>s.svcId))];
  const bundleDiscount = uniqueSvcTypes.length >= 2 ? Math.round(svcTotal * 0.10) : 0;
  // $500 onboarding credit if individual client later enrolls in managed
  const onboardingCredit = mode === "mixed" && svcTotal > 0 ? 500 : 0;

  const totalOneTime = svcTotal + addOnOneTime - bundleDiscount - onboardingCredit;
  const totalMonthly = managedMonthly + addOnMonthly;
  const totalYear1 = totalOneTime + (totalMonthly * 12);

  // ── ROI (only for managed/mixed) ──
  const wk = prospect.providers * 25;
  const rec = mode !== "individual" ? ((prospect.noShowBaseline - 8) / 100) * wk : 0;
  const aRev = rec * 65 * 52;
  const aStaff = mode !== "individual" ? 10 * 18 * 52 * 0.8 : 0;
  const aBen = aRev + aStaff;
  const roi = totalYear1 > 0 ? ((aBen - totalYear1) / totalYear1) * 100 : 0;

  const Chip = ({active, onClick, children}) => (
    <button onClick={onClick} style={{ padding:"5px 11px", borderRadius:6, border:`1px solid ${active?"#6366f1":"rgba(255,255,255,0.06)"}`, background:active?"rgba(99,102,241,0.12)":"rgba(255,255,255,0.02)", color:active?"#a5b4fc":"#9ca3af", cursor:"pointer", fontSize:10.5, fontFamily:"inherit", transition:"all 0.15s" }}>{children}</button>
  );
// ── Proposal PDF Print helper ────────────────────────────────────────────
const printProposal = (prospect, totalOneTime, totalMonthly, totalYear1, roi, aRev, aStaff, aBen) => {
  const today = new Date();
  const dateStr = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const validThru = new Date(today.setDate(today.getDate() + 30)).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const noShowTarget = Math.max(8, Math.round(prospect.noShowBaseline * 0.5));
  const noShowReduction = prospect.noShowBaseline - noShowTarget;
  const noShowsPerWk = Math.round((prospect.noShowBaseline / 100) * prospect.apptsPerWeek);
  const recoveredAppts = Math.round((noShowReduction / 100) * prospect.apptsPerWeek);
  const paybackMonths = aBen > 0 ? Math.round((totalYear1 / aBen) * 12) : 0;
  const netYear1 = Math.round(aBen - totalYear1);
  const roiRatio = totalYear1 > 0 ? (aBen / totalYear1).toFixed(2) : 0;
  const tierName = totalMonthly >= 8000 ? 'Tier 3 — Enterprise' : totalMonthly >= 5000 ? 'Tier 2 — Professional' : 'Tier 1 — Essential';
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head><title>Proposal - ${prospect.practice}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',Arial,sans-serif;color:#1e293b;max-width:850px;margin:0 auto;padding:40px 48px;font-size:13px;line-height:1.6}
    h1{color:#6366f1;font-size:26px;font-weight:800;margin-bottom:2px}
    h2{font-size:15px;font-weight:700;color:#1e293b;border-bottom:2px solid #6366f1;padding-bottom:6px;margin:28px 0 14px;text-transform:uppercase;letter-spacing:0.05em}
    h3{font-size:13px;font-weight:700;color:#334155;margin:16px 0 8px}
    .subtitle{color:#64748b;font-size:13px;margin-bottom:28px}
    .cover{margin-bottom:32px;padding-bottom:24px;border-bottom:3px solid #6366f1}
    .cover-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:16px}
    .cover-block p{font-size:12px;color:#475569;margin:2px 0}
    .cover-block strong{color:#1e293b;font-size:13px}
    .kpi-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:14px 0}
    .kpi{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;text-align:center}
    .kpi .value{font-size:20px;font-weight:800;color:#6366f1}
    .kpi .value.green{color:#16a34a}
    .kpi .value.red{color:#dc2626}
    .kpi .label{font-size:11px;color:#64748b;margin-top:3px}
    .highlight-box{background:linear-gradient(135deg,rgba(99,102,241,0.06),rgba(99,102,241,0.02));border:1px solid rgba(99,102,241,0.2);border-radius:8px;padding:16px;margin:14px 0}
    .highlight-box p{margin:4px 0;font-size:12px;color:#334155}
    .bullet{margin:4px 0 4px 16px;font-size:12px;color:#334155}
    .bullet::before{content:"• ";color:#6366f1;font-weight:700}
    .two-col{display:grid;grid-template-columns:1fr 1fr;gap:20px}
    .investment-row{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #e2e8f0;font-size:12px}
    .investment-row.total{font-weight:700;font-size:13px;color:#6366f1;border-bottom:2px solid #6366f1;padding-top:10px}
    .phase{background:#f8fafc;border-left:3px solid #6366f1;padding:10px 14px;margin:8px 0;border-radius:0 6px 6px 0}
    .phase h4{font-size:12px;font-weight:700;color:#6366f1;margin-bottom:4px}
    .phase p{font-size:11px;color:#475569}
    .sig-block{margin-top:40px;display:grid;grid-template-columns:1fr 1fr;gap:40px}
    .sig-line{border-top:1px solid #334155;margin-top:40px;padding-top:6px;font-size:11px;color:#64748b}
    .footer{margin-top:36px;padding-top:14px;border-top:2px solid #e2e8f0;color:#64748b;font-size:11px;display:flex;justify-content:space-between}
    .badge{display:inline-block;background:rgba(99,102,241,0.1);color:#6366f1;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;margin-left:8px}
    @media print{body{padding:20px 32px}h2{page-break-after:avoid}.phase{page-break-inside:avoid}}
  </style></head><body>

  <!-- COVER -->
  <div class="cover">
    <h1>Immaculate Consulting</h1>
    <div class="subtitle">Operations Transformation Proposal</div>
    <div class="cover-grid">
      <div class="cover-block">
        <strong>Prepared for:</strong>
        <p>${prospect.practice}</p>
        <p>${prospect.specialty}</p>
        <p>${prospect.contact || ''}</p>
      </div>
      <div class="cover-block">
        <strong>Prepared by:</strong>
        <p>Immaculate Consulting</p>
        <p>Leonard Croom, Principal</p>
        <p>leonard@immaculate-consulting.org</p>
        <p style="margin-top:8px;font-size:11px;color:#94a3b8;">Date: ${dateStr}</p>
        <p style="font-size:11px;color:#94a3b8;">Valid Through: ${validThru}</p>
      </div>
    </div>
  </div>

  <!-- EXECUTIVE SUMMARY -->
  <h2>Executive Summary</h2>
  <p style="margin-bottom:12px">${prospect.practice} is experiencing a no-show rate of <strong>${prospect.noShowBaseline}%</strong> — approximately <strong>${noShowsPerWk} missed appointments per week</strong> — impacting both operational efficiency and revenue. Based on our discovery conversation, we understand your practice faces the following challenges:</p>

  <h3>Key Challenges Identified:</h3>
  <p class="bullet">No-show rate of ${prospect.noShowBaseline}% resulting in ~${noShowsPerWk} missed appointments per week</p>
  <p class="bullet">Staff time spent on manual appointment reminder calls and insurance verification</p>
  <p class="bullet">EHR integration complexity (${prospect.ehr}) creating administrative bottlenecks</p>
  <p class="bullet">Revenue leakage from unconfirmed appointments and claim denials</p>

  <h3>Proposed Solution:</h3>
  <p class="bullet"><strong>${tierName}</strong> — AI-powered automation package</p>
  <p class="bullet">Automated Appointment Reminders with 2-way SMS confirmation</p>
  <p class="bullet">Insurance Verification automation prior to appointments</p>
  <p class="bullet">Seamless ${prospect.ehr} integration via secure FHIR API</p>

  <h3>Expected Outcomes:</h3>
  <p class="bullet">Reduce no-show rate from ${prospect.noShowBaseline}% to ~${noShowTarget}% (${noShowReduction}% improvement)</p>
  <p class="bullet">Recover approximately <strong>${recoveredAppts} appointments/week</strong> — $${Math.round(aRev).toLocaleString()} annual revenue</p>
  <p class="bullet">Save staff time worth <strong>$${Math.round(aStaff).toLocaleString()}/year</strong> through automation</p>
  <p class="bullet">ROI of <strong>${Math.round(roi)}%</strong> in first 12 months | Payback period: <strong>${paybackMonths} months</strong></p>

  <div class="highlight-box">
    <p><strong>Monthly Service Fee:</strong> $${totalMonthly.toLocaleString()}/month</p>
    ${totalOneTime > 0 ? `<p><strong>One-Time Setup:</strong> $${totalOneTime.toLocaleString()}</p>` : ''}
    <p><strong>Total First Year Investment:</strong> $${totalYear1.toLocaleString()}</p>
    <p style="margin-top:8px;font-size:13px;font-weight:700;color:#16a34a">Total First Year Value: $${Math.round(aBen).toLocaleString()} &nbsp;|&nbsp; Net Benefit: $${netYear1 > 0 ? '+' : ''}${netYear1.toLocaleString()}</p>
  </div>

  <!-- PRACTICE OVERVIEW -->
  <h2>Understanding Your Current State</h2>
  <h3>Practice Overview:</h3>
  <p class="bullet">Practice Name: ${prospect.practice}</p>
  <p class="bullet">Specialty: ${prospect.specialty}</p>
  <p class="bullet">Providers: ${prospect.providers}</p>
  <p class="bullet">EHR System: ${prospect.ehr} (Integration difficulty: ${prospect.ehrDifficulty}, Timeline: ${prospect.ehrTimeline})</p>
  <p class="bullet">Payer Mix: ${prospect.payer}</p>
  <p class="bullet">Estimated patient volume: ~${prospect.apptsPerWeek} appointments/week</p>

  <h3>Current Operational Pain Points:</h3>
  <h3>1. High No-Show Rate</h3>
  <p class="bullet">Current no-show rate: ${prospect.noShowBaseline}% (~${noShowsPerWk} no-shows/week)</p>
  <p class="bullet">Annual lost revenue: $${Math.round((prospect.noShowBaseline/100) * prospect.apptsPerWeek * 65 * 52).toLocaleString()} (at $65/visit)</p>
  <p class="bullet">Staff time spent on manual reminder calls: 10-15 hours/week</p>

  <h3>2. Manual Administrative Burden</h3>
  <p class="bullet">Insurance verification done manually prior to appointments</p>
  <p class="bullet">Front desk staff capacity consumed by preventable manual tasks</p>
  <p class="bullet">Risk of claim denials from incomplete pre-authorization</p>

  <!-- OUR SOLUTION -->
  <h2>Our Solution: ${tierName}</h2>
  <p style="margin-bottom:14px">We propose implementing our ${tierName} service package, providing comprehensive AI-powered automation tailored to ${prospect.ehr} and the NC Medicaid payer environment.</p>

  <h3>1. Automated Appointment Reminders</h3>
  <p class="bullet">SMS and email reminders sent 48 and 24 hours before appointments</p>
  <p class="bullet">Personalized with provider name, time, and location</p>
  <p class="bullet">2-way SMS — patients confirm, cancel, or reschedule via text</p>
  <p class="bullet">Automatic ${prospect.ehr} status updates</p>
  <p class="bullet"><em>Expected impact: Reduce no-shows by 40-60%, eliminate 10-15 staff hours/week</em></p>

  <h3>2. Insurance Pre-Verification</h3>
  <p class="bullet">Automatic eligibility checks 48 hours before appointments</p>
  <p class="bullet">Flags coverage issues before the patient arrives</p>
  <p class="bullet">Reduces claim denials and day-of surprises</p>
  <p class="bullet"><em>Technology: ${prospect.ehr} API + Availity clearinghouse integration</em></p>

  <h3>Additional Features Included:</h3>
  <p class="bullet">${prospect.ehr} integration via secure FHIR API</p>
  <p class="bullet">HIPAA-compliant infrastructure and data handling</p>
  <p class="bullet">Real-time monitoring dashboard (IC-BOS)</p>
  <p class="bullet">Monthly performance analytics and reporting</p>
  <p class="bullet">Dedicated support during business hours</p>

  <!-- ROI ANALYSIS -->
  <h2>Return on Investment Analysis</h2>
  <div class="kpi-grid">
    <div class="kpi"><div class="value">$${Math.round(aRev).toLocaleString()}</div><div class="label">Revenue Recovered/Year</div></div>
    <div class="kpi"><div class="value">$${Math.round(aStaff).toLocaleString()}</div><div class="label">Staff Savings/Year</div></div>
    <div class="kpi"><div class="value">$${Math.round(aBen).toLocaleString()}</div><div class="label">Total Annual Benefit</div></div>
    <div class="kpi"><div class="value ${roi > 0 ? 'green' : 'red'}">${Math.round(roi)}%</div><div class="label">Year 1 ROI</div></div>
    <div class="kpi"><div class="value">${paybackMonths} mo</div><div class="label">Payback Period</div></div>
    <div class="kpi"><div class="value green">$${roiRatio}</div><div class="label">Return per $1 Invested</div></div>
  </div>

  <h3>ROI Summary:</h3>
  <div class="investment-row"><span>Total Annual Benefit</span><span>$${Math.round(aBen).toLocaleString()}</span></div>
  <div class="investment-row"><span>Year 1 Investment</span><span>-$${totalYear1.toLocaleString()}</span></div>
  <div class="investment-row total"><span>Net Year 1 Value</span><span style="color:${netYear1>0?'#16a34a':'#dc2626'}">$${netYear1 > 0 ? '+' : ''}${netYear1.toLocaleString()}</span></div>

  <!-- IMPLEMENTATION ROADMAP -->
  <h2>Implementation Roadmap</h2>
  <p style="margin-bottom:14px">Our proven 5-phase implementation ensures smooth deployment with minimal disruption. <strong>Total timeline: ${prospect.ehrTimeline} from contract to full production.</strong></p>
  <div class="phase"><h4>Phase 1 — Discovery & Setup (Week 1-2)</h4><p>Contract execution, kickoff meeting, ${prospect.ehr} integration access setup, system architecture design, baseline metrics establishment</p></div>
  <div class="phase"><h4>Phase 2 — Build (Week 3-4)</h4><p>${prospect.ehr} API integration development, automation workflow creation, SMS/email template customization, sandbox testing</p></div>
  <div class="phase"><h4>Phase 3 — Testing (Week 5)</h4><p>End-to-end UAT with real appointments, staff walkthrough, error handling validation, performance verification</p></div>
  <div class="phase"><h4>Phase 4 — Training & Go-Live (Week 6)</h4><p>2 live training sessions (up to 15 staff), go-live support, monitoring during first 48 hours intensive</p></div>
  <div class="phase"><h4>Phase 5 — Optimize (Week 7-8 and Ongoing)</h4><p>30-day intensive monitoring, workflow refinements, performance reporting, quarterly business reviews</p></div>

  <!-- INVESTMENT BREAKDOWN -->
  <h2>Investment Breakdown</h2>
  <div class="two-col">
    <div>
      ${totalMonthly > 0 ? `<div class="investment-row"><span>Monthly Service Fee (${tierName})</span><span>$${totalMonthly.toLocaleString()}/mo</span></div>
      <div class="investment-row"><span>Annual Service Fee (x12)</span><span>$${(totalMonthly*12).toLocaleString()}</span></div>` : ''}
      ${totalOneTime > 0 ? `<div class="investment-row"><span>One-Time Implementation Fee</span><span>$${totalOneTime.toLocaleString()}</span></div>` : ''}
      <div class="investment-row"><span>Est. Usage Costs (SMS, etc.)</span><span>~$50-100/mo</span></div>
      <div class="investment-row total"><span>Year 1 Total Investment</span><span>$${totalYear1.toLocaleString()}</span></div>
    </div>
    <div>
      <h3 style="margin-top:0">Payment Terms:</h3>
      <p class="bullet">Implementation fee: 50% at signing, 50% at go-live</p>
      <p class="bullet">Monthly service fee: Due 1st of month, Net 15</p>
      <p class="bullet">Payment: ACH, check, or credit card (3% fee)</p>
      <h3>Contract Terms:</h3>
      <p class="bullet">Initial term: 12 months from go-live</p>
      <p class="bullet">Auto-renewal: Month-to-month after initial term</p>
      <p class="bullet">Termination: 30-day written notice</p>
      <p class="bullet">SLA: 99% uptime guarantee</p>
    </div>
  </div>

  <!-- NEXT STEPS -->
  <h2>Next Steps to Get Started</h2>
  <p style="margin-bottom:12px">We are excited to partner with <strong>${prospect.practice}</strong> to transform your operations!</p>
  <div class="phase"><h4>1. Review This Proposal</h4><p>Share with key stakeholders. We are available for questions — leonard@immaculate-consulting.org</p></div>
  <div class="phase"><h4>2. Approve & Sign</h4><p>Review and sign the Master Services Agreement. Return via email or DocuSign.</p></div>
  <div class="phase"><h4>3. Kickoff</h4><p>Kickoff meeting within 2 business days of signed contract. Target go-live: ${prospect.ehrTimeline} from start date.</p></div>

  <!-- ACCEPTANCE -->
  <h2>Proposal Acceptance</h2>
  <p style="font-size:12px;margin-bottom:16px">By signing below, ${prospect.practice} accepts this proposal and authorizes Immaculate Consulting to proceed with implementation as described. This proposal, along with the attached Master Services Agreement, constitutes the complete agreement between parties.</p>
  <div class="sig-block">
    <div>
      <p style="font-size:12px;font-weight:600">For ${prospect.practice}:</p>
      <div class="sig-line">${prospect.contact || '[Contact Name]'}, [Title] &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date</div>
      <div class="sig-line" style="margin-top:28px">Print Name</div>
    </div>
    <div>
      <p style="font-size:12px;font-weight:600">For Immaculate Consulting:</p>
      <div class="sig-line">Leonard Croom, Principal &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date</div>
    </div>
  </div>

  <div class="footer">
    <span>Immaculate Consulting | immaculate-consulting.org | Leonard Croom</span>
    <span>Valid through ${validThru} | Confidential</span>
  </div>

  </body></html>`);
  win.document.close();
  setTimeout(() => { win.print(); }, 500);
};
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:14 }}>

      {/* ── Agent-Generated Proposals Section ── */}
      <div>
        <h2 style={{ fontSize:17, fontWeight:700, color:"#f0f8ff" }}>Agent-Generated Proposals</h2>
        <p style={{ fontSize:11, color:"#7aaacb", marginTop:2 }}>Created by Agent 1 — Proposal Generator</p>
      </div>
      {proposalsLoading ? (
        <p style={{ fontSize:12, color:"#7aaacb" }}>Loading proposals...</p>
      ) : agentProposals.length === 0 ? (
        <div style={{ padding:"16px", background:"#0d2b4e", border:"1px solid rgba(42,182,215,0.15)", borderRadius:8 }}>
          <p style={{ fontSize:12, color:"#7aaacb" }}>No agent-generated proposals yet. Use the Generate Proposal button on a Pipeline deal to create one.</p>
        </div>
      ) : (
        agentProposals.map(p => (
          <div key={p.id} style={{ background:"#0d2b4e", border:"1px solid rgba(99,102,241,0.15)", borderLeft:"3px solid #6366f1", borderRadius:8, padding:"14px 16px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
              <div>
                <div style={{ fontSize:13, fontWeight:600, color:"#f0f8ff" }}>{p.practice_name}</div>
                <div style={{ fontSize:11, color:"#7aaacb", marginTop:2 }}>
                  {p.specialty && `${p.specialty} · `}{p.ehr && `${p.ehr} · `}
                  {p.monthly_fee && `$${Number(p.monthly_fee).toLocaleString()}/mo · `}
                  Tier {p.tier}
                </div>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <span style={{
                  fontSize:10, fontWeight:600, padding:"2px 8px", borderRadius:4,
                  background: p.status==="Accepted" ? "rgba(74,222,128,0.1)" : p.status==="Sent" ? "rgba(56,189,248,0.1)" : p.status==="Declined" ? "rgba(248,113,113,0.1)" : "rgba(251,191,36,0.1)",
                  color: p.status==="Accepted" ? "#4ade80" : p.status==="Sent" ? "#38bdf8" : p.status==="Declined" ? "#f87171" : "#fbbf24"
                }}>{p.status}</span>
                <button
                  onClick={() => setExpandedProposal(expandedProposal === p.id ? null : p.id)}
                  style={{ fontSize:11, color:"#818cf8", background:"rgba(99,102,241,0.08)", border:"1px solid rgba(99,102,241,0.15)", borderRadius:6, padding:"4px 10px", cursor:"pointer" }}
                >
                  {expandedProposal === p.id ? "Hide" : "View"}
                </button>
                <button
                  onClick={() => printAgentProposal(p)}
                  style={{ fontSize:11, color:"#818cf8", background:"rgba(99,102,241,0.08)", border:"1px solid rgba(99,102,241,0.15)", borderRadius:6, padding:"4px 10px", cursor:"pointer" }}
                >
                  📄 PDF
                </button>
              </div>
            </div>
            {expandedProposal === p.id && p.proposal_content && (
              <div style={{ marginTop:12, padding:"12px", background:"rgba(42,182,215,0.07)", borderRadius:7, fontSize:12, color:"#f0f8ff", lineHeight:1.7, whiteSpace:"pre-wrap", maxHeight:300, overflowY:"auto" }}>
                {p.proposal_content}
              </div>
            )}
            <div style={{ fontSize:10, color:"#4a6a8a", marginTop:8 }}>
              🤖 Generated {new Date(p.created_at).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })}
            </div>
          </div>
        ))
      )}

      {/* Divider */}
      <div style={{ borderTop:"1px solid rgba(42,182,215,0.15)", paddingTop:14 }}>
        <h2 style={{ fontSize:17, fontWeight:700, color:"#f0f8ff" }}>Proposal Builder</h2>
      </div>

      {/* Prospect selector */}
      <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
        {PIPELINE.filter(p=>p.stage!=="closed-won").map(p=><Chip key={p.id} active={pid===p.id} onClick={()=>setPid(p.id)}>{p.practice}</Chip>)}
      </div>

      {/* Engagement type */}
      <div style={{ display:"flex", gap:6 }}>
        {[{id:"managed",l:"Managed Package",d:"Monthly retainer"},{id:"individual",l:"Individual Services",d:"One-time / project"},{id:"mixed",l:"Package + Services",d:"Best of both"}].map(m=>(
          <button key={m.id} onClick={()=>setMode(m.id)} style={{ flex:1, padding:"10px 14px", borderRadius:8, border:`1px solid ${mode===m.id?"#6366f1":"rgba(255,255,255,0.06)"}`, background:mode===m.id?"rgba(99,102,241,0.08)":"rgba(255,255,255,0.02)", cursor:"pointer", textAlign:"left" }}>
            <div style={{ fontSize:12, fontWeight:600, color:mode===m.id?"#a5b4fc":"#9ca3af" }}>{m.l}</div>
            <div style={{ fontSize:10, color:"#7aaacb", marginTop:2 }}>{m.d}</div>
          </button>
        ))}
      </div>

      {/* Managed tier selector */}
      {mode !== "individual" && (
        <Panel title="Managed Service Package" subtitle={`${prospect.providers} providers · Suggested: Tier ${prospect.providers<=3?1:prospect.providers<=10?2:3}`}>
          <div style={{ display:"flex", gap:6, marginBottom:12 }}>
            {[1,2,3].map(n=>(
              <button key={n} onClick={()=>setTier(n)} style={{ flex:1, padding:"10px 12px", borderRadius:8, border:`1px solid ${tier===n?"#6366f1":"rgba(255,255,255,0.06)"}`, background:tier===n?"rgba(99,102,241,0.08)":"rgba(255,255,255,0.02)", cursor:"pointer", textAlign:"left" }}>
                <div style={{ fontSize:11, fontWeight:600, color:tier===n?"#a5b4fc":"#9ca3af" }}>Tier {n}: {managedTiers[n].n}</div>
                <div style={{ fontSize:16, fontWeight:700, color:tier===n?"#f0f0f0":"#6b7280", fontFamily:M, marginTop:2 }}>${managedTiers[n].p.toLocaleString()}<span style={{ fontSize:10, fontWeight:400 }}>/mo</span></div>
                <div style={{ fontSize:9.5, color:"#7aaacb", marginTop:2 }}>{managedTiers[n].desc}</div>
              </button>
            ))}
          </div>
          <div style={{ fontSize:11, color:"#a8c8e8", lineHeight:1.5, padding:"10px 12px", background:"rgba(42,182,215,0.07)", borderRadius:7 }}>
            <span style={{ fontWeight:600, color:"#f0f8ff" }}>Includes: </span>{managedTiers[tier].includes}
          </div>
          {/* Web App Add-Ons */}
          <div style={{ marginTop:12 }}>
            <div style={{ fontSize:11, fontWeight:600, color:"#f0f8ff", marginBottom:8 }}>Web App Add-Ons {tier===3&&<span style={{ color:"#4ade80", fontWeight:400 }}>— included in Tier 3</span>}</div>
            {tier < 3 && <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:6 }}>
              {webAppAddOns.map(ao=>{
                const active = selectedAddOns.includes(ao.id);
                return (<button key={ao.id} onClick={()=>toggleAddOn(ao.id)} style={{ padding:"8px 10px", borderRadius:7, border:`1px solid ${active?"#6366f1":"rgba(255,255,255,0.05)"}`, background:active?"rgba(99,102,241,0.08)":"rgba(255,255,255,0.015)", cursor:"pointer", textAlign:"left", transition:"all 0.15s" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <span style={{ fontSize:11, fontWeight:active?600:400, color:active?"#a5b4fc":"#9ca3af" }}>{ao.name}</span>
                    <span style={{ width:14, height:14, borderRadius:4, border:`2px solid ${active?"#6366f1":"rgba(255,255,255,0.12)"}`, background:active?"#6366f1":"transparent", display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, color:"white" }}>{active&&"✓"}</span>
                  </div>
                  <div style={{ fontSize:10, color:"#7aaacb", fontFamily:M, marginTop:3 }}>{ao.priceRange} + ${ao.monthly}/mo</div>
                </button>);
              })}
            </div>}
          </div>
        </Panel>
      )}

      {/* Individual services */}
      {mode !== "managed" && (
        <Panel title="Individual Services" subtitle={uniqueSvcTypes.length>=2 ? "✨ 10% bundle discount applied (2+ services)" : "Select 2+ services for 10% bundle discount"}>
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {individualServices.map(svc=>(
              <div key={svc.id}>
                <div style={{ fontSize:12, fontWeight:600, color:"#f0f8ff", marginBottom:5 }}>
                  {svc.name}
                  <span style={{ fontSize:10, color:"#7aaacb", fontWeight:400, marginLeft:6 }}>{svc.type==="one-time"?"One-time":svc.type==="project"?"Project (30/40/30)":"Recurring"}</span>
                </div>
                <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                  {svc.options.map((opt, oi)=>{
                    const active = selectedServices.find(s=>s.key===`${svc.id}-${oi}`);
                    return (<button key={oi} onClick={()=>toggleService(svc.id, oi)} style={{ padding:"6px 10px", borderRadius:6, border:`1px solid ${active?"#6366f1":"rgba(255,255,255,0.06)"}`, background:active?"rgba(99,102,241,0.08)":"rgba(255,255,255,0.015)", cursor:"pointer", textAlign:"left", transition:"all 0.15s" }}>
                      <div style={{ fontSize:10.5, color:active?"#a5b4fc":"#9ca3af" }}>{opt.n}</div>
                      <div style={{ fontSize:12, fontWeight:700, color:active?"#f0f0f0":"#6b7280", fontFamily:M, marginTop:2 }}>${opt.p.toLocaleString()}</div>
                    </button>);
                  })}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Pricing Summary */}
      <Panel title="Proposal Summary" subtitle={`${prospect.practice} · ${prospect.providers} providers · ${prospect.ehr}`} style={{ background:"rgba(99,102,241,0.03)", border:"1px solid rgba(99,102,241,0.1)" }}>
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {mode !== "individual" && (
            <div style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:"1px solid rgba(42,182,215,0.08)" }}>
              <span style={{ fontSize:12, color:"#a8c8e8" }}>Managed — Tier {tier}: {managedTiers[tier].n}</span>
              <span style={{ fontSize:12, fontWeight:600, color:"#818cf8", fontFamily:M }}>${managedTiers[tier].p.toLocaleString()}/mo</span>
            </div>
          )}
          {selectedAddOns.map(id=>{const ao=webAppAddOns.find(a=>a.id===id);return ao&&(
            <div key={id} style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:"1px solid rgba(42,182,215,0.08)" }}>
              <span style={{ fontSize:12, color:"#a8c8e8" }}>Add-On: {ao.name}</span>
              <span style={{ fontSize:12, color:"#f0f8ff", fontFamily:M }}>${ao.price.toLocaleString()} + ${ao.monthly}/mo</span>
            </div>
          );})}
          {selectedServices.map(sel=>{const svc=individualServices.find(x=>x.id===sel.svcId);const opt=svc?.options[sel.optIdx];return opt&&(
            <div key={sel.key} style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:"1px solid rgba(42,182,215,0.08)" }}>
              <span style={{ fontSize:12, color:"#a8c8e8" }}>{svc.name}: {opt.n}</span>
              <span style={{ fontSize:12, color:"#f0f8ff", fontFamily:M }}>${opt.p.toLocaleString()}</span>
            </div>
          );})}
          {bundleDiscount > 0 && (
            <div style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:"1px solid rgba(42,182,215,0.08)" }}>
              <span style={{ fontSize:12, color:"#4ade80" }}>Bundle Discount (10% — 2+ individual services)</span>
              <span style={{ fontSize:12, fontWeight:600, color:"#4ade80", fontFamily:M }}>-${bundleDiscount.toLocaleString()}</span>
            </div>
          )}
          {onboardingCredit > 0 && (
            <div style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:"1px solid rgba(42,182,215,0.08)" }}>
              <span style={{ fontSize:12, color:"#4ade80" }}>Onboarding Credit (individual → managed)</span>
              <span style={{ fontSize:12, fontWeight:600, color:"#4ade80", fontFamily:M }}>-$500</span>
            </div>
          )}
        </div>
        {/* Totals */}
        <div style={{ display:"grid", gridTemplateColumns:totalMonthly>0?"repeat(3,1fr)":"repeat(2,1fr)", gap:10, marginTop:14, padding:"14px", background:"rgba(42,182,215,0.07)", borderRadius:8 }}>
          {totalOneTime > 0 && <div><div style={{ fontSize:9, color:"#7aaacb", fontFamily:M, textTransform:"uppercase" }}>One-Time / Project</div><div style={{ fontSize:22, fontWeight:800, color:"#f0f8ff", fontFamily:M, marginTop:2 }}>${totalOneTime.toLocaleString()}</div></div>}
          {totalMonthly > 0 && <div><div style={{ fontSize:9, color:"#7aaacb", fontFamily:M, textTransform:"uppercase" }}>Monthly Recurring</div><div style={{ fontSize:22, fontWeight:800, color:"#818cf8", fontFamily:M, marginTop:2 }}>${totalMonthly.toLocaleString()}<span style={{fontSize:11}}>/mo</span></div></div>}
          <div><div style={{ fontSize:9, color:"#7aaacb", fontFamily:M, textTransform:"uppercase" }}>Year 1 Total</div><div style={{ fontSize:22, fontWeight:800, color:"#fbbf24", fontFamily:M, marginTop:2 }}>${totalYear1.toLocaleString()}</div></div>
        </div>
      </Panel>

      {/* ROI (for managed/mixed) */}
      {mode !== "individual" && (
        <div style={{ display:"flex", gap:10, padding:"12px 14px", background:roi>0?"rgba(74,222,128,0.04)":"rgba(248,113,113,0.04)", borderRadius:8, border:`1px solid ${roi>0?"rgba(74,222,128,0.08)":"rgba(248,113,113,0.08)"}` }}>
          <div style={{ flex:1 }}><div style={{ fontSize:9, color:"#7aaacb", fontFamily:M }}>PROJ. REVENUE RECOVERED/YR</div><div style={{ fontSize:18, fontWeight:700, color:"#4ade80", fontFamily:M, marginTop:2 }}>${Math.round(aRev).toLocaleString()}</div><div style={{ fontSize:9, color:"#7aaacb" }}>{Math.round(rec)} appts/wk × $65</div></div>
          <div style={{ flex:1 }}><div style={{ fontSize:9, color:"#7aaacb", fontFamily:M }}>STAFF SAVINGS/YR</div><div style={{ fontSize:18, fontWeight:700, color:"#38bdf8", fontFamily:M, marginTop:2 }}>${Math.round(aStaff).toLocaleString()}</div><div style={{ fontSize:9, color:"#7aaacb" }}>~10h/wk × $18/hr</div></div>
          <div style={{ flex:1 }}><div style={{ fontSize:9, color:"#7aaacb", fontFamily:M }}>YEAR 1 ROI</div><div style={{ fontSize:18, fontWeight:700, color:roi>0?"#4ade80":"#f87171", fontFamily:M, marginTop:2 }}>{Math.round(roi)}%</div></div>
          <div style={{ flex:1 }}><div style={{ fontSize:9, color:"#7aaacb", fontFamily:M }}>3-YEAR NET BENEFIT</div><div style={{ fontSize:18, fontWeight:700, color:"#fbbf24", fontFamily:M, marginTop:2 }}>${Math.round((aBen*3)-(totalYear1+(totalMonthly*24))).toLocaleString()}</div></div>
        </div>
      )}

      {/* Payment terms note */}
      <div style={{ fontSize:10.5, color:"#7aaacb", lineHeight:1.5, padding:"10px 14px", background:"#0d2b4e", borderRadius:7 }}>
        <span style={{ fontWeight:600, color:"#a8c8e8" }}>Payment Terms: </span>
        {mode === "managed" && "Monthly subscription, billed on the 1st. No long-term contract — cancel anytime with 30 days notice."}
        {mode === "individual" && "One-time/project services: 30% at start / 40% at midpoint / 30% upon completion. Flat-fee services paid upfront."}
        {mode === "mixed" && "Package: monthly billing. Individual services: 30/40/30 or flat fee. $500 onboarding credit applied when enrolling in managed tier."}
        {uniqueSvcTypes.length >= 2 && " 10% bundle discount applied for engaging 2+ individual services in the same quarter."}
      </div>

      {/* Download PDF button */}
      <div style={{ display:"flex", justifyContent:"flex-end", marginTop:4 }}>
        <button
         onClick={() => printProposal(prospect, totalOneTime, totalMonthly, totalYear1, roi, aRev, aStaff, aBen)}
          style={{
            background:"rgba(99,102,241,0.12)", color:"#818cf8",
            border:"1px solid rgba(99,102,241,0.3)", borderRadius:"6px",
            padding:"8px 16px", fontSize:"13px", cursor:"pointer",
            display:"flex", alignItems:"center", gap:"6px", fontWeight:600
          }}
        >
          📄 Download PDF
        </button>
      </div>
    </div>
  );
}

// ── Automation last-run badge helper ─────────────────────────────────
function timeSinceRun(lastRun) {
  if (!lastRun) return "Never";
  if (typeof lastRun === "string" && !lastRun.includes("T")) return lastRun;
  const diff = Date.now() - new Date(lastRun).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// Automations Tab (Feature 4)
function AutoTab() {
  const { AUTOMATIONS } = useData();
  const stc={healthy:"#4ade80",warning:"#fbbf24",critical:"#f87171"};
  const crit=AUTOMATIONS.filter(a=>a.status==="critical");
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
      <h2 style={{ fontSize:17, fontWeight:700, color:"#f0f8ff" }}>Automation Health</h2>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12 }}>
        <KPI label="Automations" value={AUTOMATIONS.length} spark={[4,5,5,6,7,7]} sparkColor="#818cf8"/>
        <KPI label="Execs Today" value={AUTOMATIONS.reduce((s,a)=>s+a.execsToday,0)} spark={[320,410,480,530,560,569]} sparkColor="#4ade80" delay={60}/>
        <KPI label="Cost Today" value={Math.round(AUTOMATIONS.reduce((s,a)=>s+a.costToday,0)*100)/100} prefix="$" spark={[12,14,16,17,18,19]} sparkColor="#fbbf24" delay={120}/>
        <KPI label="Errors 24h" value={AUTOMATIONS.reduce((s,a)=>s+a.errors24h,0)} spark={[2,1,3,0,1,9]} sparkColor={crit.length?"#f87171":"#4ade80"} delay={180}/>
      </div>
      {crit.length>0&&<div style={{ background:"rgba(248,113,113,0.06)", border:"1px solid rgba(248,113,113,0.12)", borderRadius:10, padding:"12px 16px" }}>
        <div style={{ fontSize:10, fontWeight:700, color:"#f87171", fontFamily:M, marginBottom:6 }}>⚠ CRITICAL</div>
        {crit.map(a=><div key={a.id} style={{ fontSize:12, color:"#f0f8ff" }}><strong>{a.client}</strong> → {a.name}: {a.successRate}% success</div>)}
      </div>}
      {AUTOMATIONS.map((a,i)=>(<div key={a.id} style={{ display:"grid", gridTemplateColumns:"2fr 1fr 0.7fr 0.7fr 0.7fr 0.5fr", alignItems:"center", gap:6, padding:"10px 16px", background:"#0d2b4e", border:`1px solid ${a.status==="critical"?"rgba(248,113,113,0.1)":"rgba(255,255,255,0.04)"}`, borderRadius:8, animation:`fu 0.3s ease ${i*40}ms both`, fontSize:12 }}>
        <div><div style={{ fontWeight:600, color:"#f0f8ff" }}>{a.client}</div><div style={{ fontSize:10, color:"#7aaacb" }}>{a.name}</div></div>
        <div style={{ display:"flex", alignItems:"center", gap:5 }}><span style={{ width:6, height:6, borderRadius:"50%", background:stc[a.status] }}/><span style={{ color:stc[a.status], fontSize:10, fontWeight:600, textTransform:"uppercase" }}>{a.status}</span></div>
        <span style={{ fontFamily:M, color:"#f0f8ff" }}>{a.successRate}%</span>
        <span style={{ fontFamily:M, color:"#f0f8ff" }}>{a.execsToday}</span>
        <span style={{ fontFamily:M, color:"#f0f8ff" }}>${a.costToday.toFixed(2)}</span>
       <span style={{
          padding:"2px 8px", borderRadius:10, fontSize:11,
          background: a.status==="critical" ? "rgba(239,68,68,0.15)" : a.status==="warning" ? "rgba(251,191,36,0.1)" : "rgba(100,116,139,0.15)",
          color: a.status==="critical" ? "#fca5a5" : a.status==="warning" ? "#fbbf24" : "#94a3b8",
        }}>
          🕐 {timeSinceRun(a.lastRun)}
        </span>
      </div>))}
    </div>
  );
}
// ═══════════════════════════════════════════════════════════════════════
// TEAM TAB — HR + App Access Management (Principal only)
// ═══════════════════════════════════════════════════════════════════════
function TeamTab({ webhookSecret }) {
  const API = "https://api.immaculate-consulting.org";
  const HEADERS = { "Content-Type": "application/json", "x-vapi-secret": webhookSecret };

  // App users state
  const [appUsers, setAppUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState(null);

  // Invite form state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("consultant");
  const [inviteState, setInviteState] = useState(null); // null | loading | done | error
  const [inviteError, setInviteError] = useState("");

  // Role update state
  const [updatingRole, setUpdatingRole] = useState({});

  // Team members (HR) state — seeded with Leonard
  const [team, setTeam] = useState([
    { id: 1, name: "Leonard Croom", title: "Principal Consultant", type: "Full-Time", hoursPerWeek: 50, monthlyCost: 0, startDate: "2025-01-01", notes: "Founder" },
  ]);
  const [showAddMember, setShowAddMember] = useState(false);
  const [newMember, setNewMember] = useState({ name: "", title: "", type: "Full-Time", hoursPerWeek: 40, monthlyCost: 0, startDate: "", notes: "" });

  const roleColors = { principal: "#a5b4fc", consultant: "#4ade80", viewer: "#fbbf24" };
  const roleBg = { principal: "rgba(99,102,241,0.1)", consultant: "rgba(74,222,128,0.1)", viewer: "rgba(251,191,36,0.1)" };
  const roleBorder = { principal: "rgba(99,102,241,0.2)", consultant: "rgba(74,222,128,0.2)", viewer: "rgba(251,191,36,0.2)" };

  // Load app users on mount
  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    setUsersLoading(true);
    setUsersError(null);
    try {
      const res = await fetch(`${API}/api/admin/list-users`, { headers: HEADERS });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load users");
      setAppUsers(data.users);
    } catch (err) {
      setUsersError(err.message);
    } finally {
      setUsersLoading(false);
    }
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviteState("loading");
    setInviteError("");
    try {
      const res = await fetch(`${API}/api/admin/invite-user`, {
        method: "POST", headers: HEADERS,
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Invite failed");
      setInviteState("done");
      setInviteEmail("");
      setTimeout(() => { setInviteState(null); loadUsers(); }, 2000);
    } catch (err) {
      setInviteError(err.message);
      setInviteState("error");
      setTimeout(() => setInviteState(null), 4000);
    }
  };

  const handleRoleChange = async (userId, newRole) => {
    setUpdatingRole(prev => ({ ...prev, [userId]: true }));
    try {
      const res = await fetch(`${API}/api/admin/update-role`, {
        method: "PATCH", headers: HEADERS,
        body: JSON.stringify({ user_id: userId, role: newRole })
      });
      if (!res.ok) throw new Error("Update failed");
      setAppUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u));
    } catch (err) {
      alert("Failed to update role: " + err.message);
    } finally {
      setUpdatingRole(prev => ({ ...prev, [userId]: false }));
    }
  };

  const addTeamMember = () => {
    if (!newMember.name.trim()) return;
    setTeam(prev => [...prev, { ...newMember, id: Date.now() }]);
    setNewMember({ name: "", title: "", type: "Full-Time", hoursPerWeek: 40, monthlyCost: 0, startDate: "", notes: "" });
    setShowAddMember(false);
  };

  const removeTeamMember = (id) => {
    if (id === 1) return; // protect Leonard
    setTeam(prev => prev.filter(t => t.id !== id));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 900 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: "#f0f0f0" }}>Team</h2>
          <p style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>HR records and app access management</p>
        </div>
      </div>

      {/* ── Section 1: App Access ─────────────────────────────────── */}
      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(42,182,215,0.15)", borderRadius: 12, padding: "16px 18px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#e5e7eb" }}>App Access</div>
            <div style={{ fontSize: 10, color: "#6b7280", marginTop: 2 }}>Invite team members and manage their IC-BOS access level</div>
          </div>
          <button onClick={loadUsers} style={{ fontSize: 9, color: "#6b7280", background: "transparent", border: "1px solid rgba(42,182,215,0.15)", borderRadius: 5, padding: "3px 8px", cursor: "pointer" }}>↻ Refresh</button>
        </div>

        {/* Invite form */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8, marginBottom: 14, padding: "12px 14px", background: "rgba(99,102,241,0.04)", border: "1px solid rgba(99,102,241,0.1)", borderRadius: 9 }}>
          <input
            value={inviteEmail}
            onChange={e => setInviteEmail(e.target.value)}
            placeholder="Email address to invite..."
            style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid rgba(42,182,215,0.15)", background: "rgba(0,0,0,0.3)", color: "#e5e7eb", fontSize: 11, fontFamily: "inherit", outline: "none" }}
          />
          <select
            value={inviteRole}
            onChange={e => setInviteRole(e.target.value)}
            style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid rgba(42,182,215,0.15)", background: "rgba(0,0,0,0.3)", color: "#e5e7eb", fontSize: 11, fontFamily: "inherit", outline: "none", cursor: "pointer" }}
          >
            <option value="consultant">Consultant</option>
            <option value="viewer">Viewer</option>
            <option value="principal">Principal</option>
          </select>
          <button
            onClick={handleInvite}
            disabled={!inviteEmail.trim() || inviteState === "loading"}
            style={{ padding: "7px 14px", borderRadius: 6, border: "none", background: inviteEmail.trim() ? "linear-gradient(135deg,#6366f1,#8b5cf6)" : "rgba(255,255,255,0.06)", color: inviteEmail.trim() ? "white" : "#4b5563", fontSize: 11, fontWeight: 600, cursor: inviteEmail.trim() ? "pointer" : "not-allowed" }}
          >
            {inviteState === "loading" ? "Sending..." : inviteState === "done" ? "✓ Sent!" : "Send Invite"}
          </button>
        </div>
        {inviteState === "error" && <div style={{ fontSize: 10, color: "#f87171", marginBottom: 10 }}>✗ {inviteError}</div>}

        {/* Users table */}
        {usersLoading ? (
          <div style={{ fontSize: 11, color: "#6b7280", padding: "12px 0", textAlign: "center" }}>Loading users...</div>
        ) : usersError ? (
          <div style={{ fontSize: 11, color: "#f87171" }}>Error: {usersError}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {/* Header */}
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 8, padding: "4px 10px", fontSize: 9, color: "#94a3b8", fontFamily: M, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              <span>Email</span><span>Role</span><span>Last Sign In</span><span>Status</span>
            </div>
            {appUsers.map(u => (
              <div key={u.id} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 8, alignItems: "center", padding: "8px 10px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(42,182,215,0.08)", borderRadius: 7 }}>
                <span style={{ fontSize: 11, color: "#e5e7eb", fontFamily: M }}>{u.email}</span>
                <select
                  value={u.role}
                  onChange={e => handleRoleChange(u.id, e.target.value)}
                  disabled={updatingRole[u.id]}
                  style={{ padding: "3px 6px", borderRadius: 5, border: `1px solid ${roleBorder[u.role] || "rgba(255,255,255,0.08)"}`, background: roleBg[u.role] || "rgba(255,255,255,0.04)", color: roleColors[u.role] || "#9ca3af", fontSize: 10, fontWeight: 600, fontFamily: M, cursor: "pointer", outline: "none" }}
                >
                  <option value="principal">Principal</option>
                  <option value="consultant">Consultant</option>
                  <option value="viewer">Viewer</option>
                </select>
                <span style={{ fontSize: 10, color: "#94a3b8", fontFamily: M }}>{u.last_sign_in ? new Date(u.last_sign_in).toLocaleDateString() : "Never"}</span>
                <span style={{ fontSize: 9, fontWeight: 700, color: u.confirmed ? "#4ade80" : "#fbbf24", background: u.confirmed ? "rgba(74,222,128,0.1)" : "rgba(251,191,36,0.1)", borderRadius: 4, padding: "2px 7px", fontFamily: M, textTransform: "uppercase", display: "inline-block" }}>{u.confirmed ? "Active" : "Pending"}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Section 2: HR Records ──────────────────────────────────── */}
      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(42,182,215,0.15)", borderRadius: 12, padding: "16px 18px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#e5e7eb" }}>Team Members</div>
            <div style={{ fontSize: 10, color: "#6b7280", marginTop: 2 }}>{team.length} member{team.length !== 1 ? "s" : ""} · ${team.reduce((s, t) => s + Number(t.monthlyCost), 0).toLocaleString()}/mo total cost</div>
          </div>
          <button onClick={() => setShowAddMember(p => !p)} style={{ fontSize: 11, fontWeight: 600, color: "#a5b4fc", background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 6, padding: "5px 12px", cursor: "pointer" }}>+ Add Member</button>
        </div>

        {/* Add member form */}
        {showAddMember && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14, padding: "12px 14px", background: "rgba(99,102,241,0.04)", border: "1px solid rgba(99,102,241,0.1)", borderRadius: 9, animation: "fu 0.3s ease both" }}>
            {[
              { label: "Name", key: "name", type: "text", placeholder: "Full name" },
              { label: "Title", key: "title", type: "text", placeholder: "e.g. Jr. Consultant" },
              { label: "Start Date", key: "startDate", type: "date", placeholder: "" },
              { label: "Hours/Week", key: "hoursPerWeek", type: "number", placeholder: "40" },
              { label: "Monthly Cost ($)", key: "monthlyCost", type: "number", placeholder: "0" },
              { label: "Notes", key: "notes", type: "text", placeholder: "Optional" },
            ].map(f => (
              <div key={f.key}>
                <div style={{ fontSize: 9, color: "#6b7280", fontFamily: M, textTransform: "uppercase", marginBottom: 3 }}>{f.label}</div>
                <input
                  type={f.type}
                  value={newMember[f.key]}
                  onChange={e => setNewMember(prev => ({ ...prev, [f.key]: f.type === "number" ? Number(e.target.value) : e.target.value }))}
                  placeholder={f.placeholder}
                  style={{ width: "100%", padding: "6px 8px", borderRadius: 5, border: "1px solid rgba(42,182,215,0.15)", background: "rgba(0,0,0,0.3)", color: "#e5e7eb", fontSize: 11, fontFamily: "inherit", outline: "none" }}
                />
              </div>
            ))}
            <div style={{ gridColumn: "1/-1", display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
              <button onClick={() => setShowAddMember(false)} style={{ fontSize: 11, color: "#6b7280", background: "transparent", border: "1px solid rgba(42,182,215,0.15)", borderRadius: 6, padding: "5px 12px", cursor: "pointer" }}>Cancel</button>
              <button onClick={addTeamMember} style={{ fontSize: 11, fontWeight: 600, color: "white", background: "linear-gradient(135deg,#6366f1,#8b5cf6)", border: "none", borderRadius: 6, padding: "5px 16px", cursor: "pointer" }}>Add Member</button>
            </div>
          </div>
        )}

        {/* Team table */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1.5fr 1fr 1fr 1fr auto", gap: 8, padding: "4px 10px", fontSize: 9, color: "#94a3b8", fontFamily: M, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            <span>Name</span><span>Title</span><span>Type</span><span>Hrs/Wk</span><span>Mo. Cost</span><span></span>
          </div>
          {team.map(t => (
            <div key={t.id} style={{ display: "grid", gridTemplateColumns: "2fr 1.5fr 1fr 1fr 1fr auto", gap: 8, alignItems: "center", padding: "10px 10px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(42,182,215,0.08)", borderRadius: 7 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#e5e7eb" }}>{t.name}</div>
               {t.notes && <div style={{ fontSize: 9, color: "#a5b4fc" }}>{t.notes}</div>}
              </div>
              <span style={{ fontSize: 11, color: "#a5b4fc" }}>{t.title}</span>
              <span style={{ fontSize: 10, color: "#94a3b8", fontFamily: M }}>{t.type}</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: "#f0f0f0", fontFamily: M }}>{t.hoursPerWeek}h</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: t.monthlyCost > 0 ? "#f87171" : "#4ade80", fontFamily: M }}>{t.monthlyCost > 0 ? `$${Number(t.monthlyCost).toLocaleString()}` : "—"}</span>
              {t.id !== 1 ? (
                <button onClick={() => removeTeamMember(t.id)} style={{ fontSize: 9, color: "#6b7280", background: "transparent", border: "1px solid rgba(42,182,215,0.15)", borderRadius: 4, padding: "2px 6px", cursor: "pointer" }}>Remove</button>
              ) : <span/>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
// Capacity Tab (Feature 5) — Team-aware with hiring forecaster
function CapTab() {
  const { FINANCIALS, CLIENTS } = useData();
  const [team, setTeam] = useState([
    { id: 1, name: "Leonard", role: "Principal", hoursAvail: 50, delivery: 22, sales: 10, admin: 6, rate: 175, monthlyCost: 0, clients: ["Greenville Primary Care", "Chapel Hill Family Med", "Fayetteville Urgent Care", "Asheville Cardiology"] },
  ]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("Consultant");
  const [newHours, setNewHours] = useState(40);
  const [newCost, setNewCost] = useState(3000);

  const addConsultant = () => {
    if (!newName.trim()) return;
    setTeam(prev => [...prev, {
      id: Date.now(), name: newName, role: newRole,
      hoursAvail: newHours, delivery: 0, sales: 0, admin: 0,
      rate: 100, monthlyCost: newCost, clients: []
    }]);
    setNewName(""); setNewCost(3000); setShowAddForm(false);
  };

  const removeConsultant = (id) => {
    if (team.length <= 1) return; // can't remove Leonard
    setTeam(prev => prev.filter(t => t.id !== id));
  };

  // Team-wide calculations
  const teamHoursAvail = team.reduce((s, t) => s + t.hoursAvail, 0);
  const teamHoursUsed = team.reduce((s, t) => s + t.delivery + t.sales + t.admin, 0);
  const teamPct = Math.round((teamHoursUsed / teamHoursAvail) * 100);
  const teamFree = teamHoursAvail - teamHoursUsed;
  const teamMonthlyCost = team.reduce((s, t) => s + t.monthlyCost, 0);
  const netMRR = FINANCIALS.mrr - FINANCIALS.monthlyExpenses - teamMonthlyCost;

  // Hiring trigger analysis
  const hiringNeeded = teamPct > 80;
  const clientsPerConsultant = CLIENTS.length / team.length;
  const revenuePerConsultant = FINANCIALS.mrr / team.length;

  // What-if scenarios adjusted for team capacity
  const scenarios = [
    { l: "+ Tier 1 Client", h: 6, r: 3500 },
    { l: "+ Tier 2 Client", h: 9, r: 6500 },
    { l: "+ Tier 3 Client", h: 15, r: 10000 },
    { l: "Close Raleigh (T3)", h: 15, r: 12000 },
  ];

  // Hiring scenarios
  const hireScenarios = [
    { role: "Part-Time Contractor", hours: 20, cost: 3000, desc: "20h/wk, $150/hr avg" },
    { role: "Full-Time Consultant", hours: 40, cost: 5000, desc: "40h/wk, delivery focus" },
    { role: "Jr. Consultant", hours: 40, cost: 3500, desc: "40h/wk, training needed" },
  ];

  const Gauge = ({ pct: p, size = 140, label }) => {
    const color = p > 85 ? "#f87171" : p > 70 ? "#fbbf24" : "#4ade80";
    return (
      <svg width={size} height={size * 0.63} viewBox="0 0 150 95">
        <path d="M 18 85 A 57 57 0 0 1 132 85" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" strokeLinecap="round" />
        <path d="M 18 85 A 57 57 0 0 1 132 85" fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(Math.min(p, 100) / 100) * 179} 179`} />
        <text x="75" y="72" textAnchor="middle" fill="#f0f0f0" fontSize="24" fontWeight="800" fontFamily="'JetBrains Mono',monospace">{p}%</text>
        {label && <text x="75" y="90" textAnchor="middle" fill="#6b7280" fontSize="9" fontFamily="'JetBrains Mono',monospace">{label}</text>}
      </svg>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: "#f0f0f0" }}>Team Capacity & Forecaster</h2>
          <p style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{team.length} consultant{team.length > 1 ? "s" : ""} · {teamHoursAvail}h/wk total capacity</p>
        </div>
        <button onClick={() => setShowAddForm(!showAddForm)} style={{ padding: "6px 14px", borderRadius: 7, border: "1px solid rgba(99,102,241,0.2)", background: "rgba(99,102,241,0.08)", color: "#a5b4fc", cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}>
          {showAddForm ? "Cancel" : "+ Add Consultant"}
        </button>
      </div>

      {/* Add consultant form */}
      {showAddForm && (
        <div style={{ background: "rgba(99,102,241,0.04)", border: "1px solid rgba(99,102,241,0.12)", borderRadius: 10, padding: "14px 18px", animation: "fu 0.3s ease both" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#a5b4fc", marginBottom: 10 }}>New Consultant</div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1.5fr 1fr 1fr auto", gap: 8, alignItems: "end" }}>
            <div>
              <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 3 }}>Name</div>
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Name" style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid rgba(42,182,215,0.15)", background: "rgba(0,0,0,0.3)", color: "#e5e7eb", fontSize: 12, fontFamily: "inherit", outline: "none" }} />
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 3 }}>Role</div>
              <select value={newRole} onChange={e => setNewRole(e.target.value)} style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid rgba(42,182,215,0.15)", background: "rgba(0,0,0,0.3)", color: "#e5e7eb", fontSize: 12, fontFamily: "inherit", outline: "none" }}>
                <option value="Consultant">Consultant</option>
                <option value="Jr. Consultant">Jr. Consultant</option>
                <option value="Contractor">Contractor</option>
                <option value="Specialist">Specialist</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 3 }}>Hours/wk</div>
              <input type="number" value={newHours} onChange={e => setNewHours(Number(e.target.value))} style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid rgba(42,182,215,0.15)", background: "rgba(0,0,0,0.3)", color: "#e5e7eb", fontSize: 12, fontFamily: "'JetBrains Mono',monospace", outline: "none" }} />
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 3 }}>$/month</div>
              <input type="number" value={newCost} onChange={e => setNewCost(Number(e.target.value))} style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid rgba(42,182,215,0.15)", background: "rgba(0,0,0,0.3)", color: "#e5e7eb", fontSize: 12, fontFamily: "'JetBrains Mono',monospace", outline: "none" }} />
            </div>
            <button onClick={addConsultant} style={{ padding: "7px 16px", borderRadius: 6, border: "none", background: "#6366f1", color: "white", cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: "inherit" }}>Add</button>
          </div>
        </div>
      )}

      {/* Team KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10 }}>
        <KPI label="Team Utilization" value={teamPct} suffix="%" spark={[55, 60, 65, 70, 74, teamPct]} sparkColor={teamPct > 85 ? "#f87171" : "#4ade80"} />
        <KPI label="Team Free Hours" value={teamFree} suffix="h/wk" spark={[20, 18, 16, 14, 12, teamFree]} sparkColor="#38bdf8" delay={50} />
        <KPI label="Revenue / Consultant" value={Math.round(revenuePerConsultant)} prefix="$" suffix="/mo" spark={[11000, 15000, 18000, 22000, 24500, Math.round(revenuePerConsultant)]} sparkColor="#818cf8" delay={100} />
        <KPI label="Clients / Consultant" value={Math.round(clientsPerConsultant * 10) / 10} spark={[1, 2, 3, 3, 4, clientsPerConsultant]} sparkColor="#fbbf24" delay={150} />
        <KPI label="Team Overhead" value={teamMonthlyCost} prefix="$" suffix="/mo" spark={[0, 0, 0, 0, 0, teamMonthlyCost]} sparkColor="#6b7280" delay={200} />
      </div>

      {/* Hiring trigger alert */}
      {hiringNeeded && (
        <div style={{ background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.12)", borderRadius: 10, padding: "12px 16px", animation: "fu 0.4s ease both" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#fbbf24", marginBottom: 4 }}>📢 HIRING SIGNAL — Team at {teamPct}% capacity</div>
          <div style={{ fontSize: 11, color: "#9ca3af", lineHeight: 1.5 }}>
            With only {teamFree}h/wk free, you can't comfortably onboard a new Tier 2+ client without overloading. Consider adding capacity before closing the next deal. See hiring scenarios below.
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {/* Per-consultant utilization */}
        <Panel title="Individual Utilization">
          {team.map((t, ti) => {
            const used = t.delivery + t.sales + t.admin;
            const pct = Math.round((used / t.hoursAvail) * 100);
            const free = t.hoursAvail - used;
            const color = pct > 85 ? "#f87171" : pct > 70 ? "#fbbf24" : "#4ade80";
            return (
              <div key={t.id} style={{ padding: "12px 0", borderBottom: ti < team.length - 1 ? "1px solid rgba(42,182,215,0.08)" : "none", animation: `fu 0.3s ease ${ti * 60}ms both` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#e5e7eb" }}>{t.name}</span>
                    <span style={{ fontSize: 10, color: "#6b7280", marginLeft: 6 }}>{t.role}{t.monthlyCost > 0 ? ` · $${t.monthlyCost.toLocaleString()}/mo` : ""}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 16, fontWeight: 700, color, fontFamily: M }}>{pct}%</span>
                    {t.id !== 1 && <button onClick={() => removeConsultant(t.id)} style={{ width: 18, height: 18, borderRadius: 4, border: "1px solid rgba(248,113,113,0.2)", background: "rgba(248,113,113,0.06)", color: "#f87171", cursor: "pointer", fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>}
                  </div>
                </div>
                <div style={{ height: 8, borderRadius: 4, background: "rgba(255,255,255,0.04)", marginBottom: 6 }}>
                  <div style={{ height: "100%", borderRadius: 4, background: color, width: `${Math.min(pct, 100)}%`, transition: "width 0.5s" }} />
                </div>
                <div style={{ display: "flex", gap: 12, fontSize: 10, color: "#6b7280" }}>
                  {[{ l: "Delivery", h: t.delivery, c: "#818cf8" }, { l: "Sales", h: t.sales, c: "#fbbf24" }, { l: "Admin", h: t.admin, c: "#6b7280" }, { l: "Free", h: free, c: "#4ade80" }].map(b => (
                    <span key={b.l} style={{ display: "flex", alignItems: "center", gap: 3 }}>
                      <span style={{ width: 5, height: 5, borderRadius: 2, background: b.c }} />
                      {b.l}: <span style={{ fontWeight: 600, color: b.c, fontFamily: M }}>{b.h}h</span>
                    </span>
                  ))}
                </div>
                {t.clients.length > 0 && (
                  <div style={{ marginTop: 6, fontSize: 10, color: "#6b7280" }}>
                    Assigned: {t.clients.map((c, i) => <span key={i} style={{ color: "#9ca3af" }}>{c}{i < t.clients.length - 1 ? ", " : ""}</span>)}
                  </div>
                )}
              </div>
            );
          })}
        </Panel>

        {/* Team-wide gauge + breakdowns */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Panel title="Team Overview">
            <div style={{ textAlign: "center", margin: "4px 0 12px" }}>
              <Gauge pct={teamPct} label={`${teamHoursUsed}h / ${teamHoursAvail}h`} />
            </div>
            {[{ l: "Delivery", h: team.reduce((s, t) => s + t.delivery, 0), c: "#818cf8" }, { l: "Sales", h: team.reduce((s, t) => s + t.sales, 0), c: "#fbbf24" }, { l: "Admin", h: team.reduce((s, t) => s + t.admin, 0), c: "#6b7280" }, { l: "Free", h: teamFree, c: "#4ade80" }].map(b => (
              <div key={b.l} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                <span style={{ width: 50, fontSize: 10, color: "#9ca3af" }}>{b.l}</span>
                <div style={{ flex: 1, height: 6, borderRadius: 3, background: "rgba(255,255,255,0.04)" }}><div style={{ height: "100%", borderRadius: 3, background: b.c, width: `${(b.h / teamHoursAvail) * 100}%` }} /></div>
                <span style={{ fontSize: 11, fontWeight: 600, color: b.c, fontFamily: M, width: 28, textAlign: "right" }}>{b.h}h</span>
              </div>
            ))}
          </Panel>

          {/* What-if: new clients */}
          <Panel title="New Client Scenarios">
            {scenarios.map((s, i) => {
              const np = Math.round(((teamHoursUsed + s.h) / teamHoursAvail) * 100); const fits = np <= 100;
              return (<div key={i} style={{ padding: "8px 10px", background: "rgba(0,0,0,0.2)", borderRadius: 6, marginBottom: 5, border: `1px solid ${!fits ? "rgba(248,113,113,0.1)" : "rgba(42,182,215,0.04)"}` }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 11.5, fontWeight: 600, color: "#e5e7eb" }}>{s.l}</span><span style={{ fontSize: 10.5, fontWeight: 600, color: fits ? "#4ade80" : "#f87171", fontFamily: M }}>{np}%{!fits && " ⚠"}</span></div>
                <div style={{ fontSize: 10, color: "#6b7280", marginTop: 2 }}>+{s.h}h/wk · +${s.r.toLocaleString()}/mo · {fits ? `${teamFree - s.h}h remaining` : "Over capacity — hire first"}</div>
              </div>);
            })}
          </Panel>
        </div>
      </div>

      {/* Hiring Forecaster */}
      <Panel title="Hiring Forecaster" subtitle="Model the impact of adding a team member">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
          {hireScenarios.map((hs, i) => {
            const newTeamHours = teamHoursAvail + hs.hours;
            const newPct = Math.round((teamHoursUsed / newTeamHours) * 100);
            const newFree = newTeamHours - teamHoursUsed;
            const maxNewTier2 = Math.floor(newFree / 9);
            const revenueToBreakEven = hs.cost;
            const newNetMRR = FINANCIALS.mrr - FINANCIALS.monthlyExpenses - teamMonthlyCost - hs.cost;
            return (
              <div key={i} style={{ padding: "14px", background: "rgba(0,0,0,0.2)", borderRadius: 9, animation: `fu 0.4s ease ${i * 60}ms both` }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#e5e7eb", marginBottom: 2 }}>{hs.role}</div>
                <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 10 }}>{hs.desc}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {[
                    { l: "Team Capacity", v: `${newTeamHours}h/wk (+${hs.hours}h)`, c: "#38bdf8" },
                    { l: "Utilization After", v: `${newPct}%`, c: newPct > 70 ? "#fbbf24" : "#4ade80" },
                    { l: "Free Hours", v: `${newFree}h/wk`, c: "#4ade80" },
                    { l: "New T2 Clients Possible", v: `${maxNewTier2}`, c: "#818cf8" },
                    { l: "Monthly Cost", v: `$${hs.cost.toLocaleString()}`, c: "#f87171" },
                    { l: "Breakeven", v: `${Math.ceil(hs.cost / 6500 * 10) / 10} T2 clients`, c: "#fbbf24" },
                    { l: "Net MRR After Hire", v: `$${newNetMRR.toLocaleString()}`, c: newNetMRR > 0 ? "#4ade80" : "#f87171" },
                  ].map((row, j) => (
                    <div key={j} style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 10.5, color: "#6b7280" }}>{row.l}</span>
                      <span style={{ fontSize: 10.5, fontWeight: 600, color: row.c, fontFamily: M }}>{row.v}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 12, fontSize: 10.5, color: "#6b7280", lineHeight: 1.5, padding: "10px 12px", background: "rgba(255,255,255,0.015)", borderRadius: 7 }}>
          <span style={{ fontWeight: 600, color: "#9ca3af" }}>Hiring Rule of Thumb: </span>
          When team utilization stays above 80% for 2+ consecutive weeks, it's time to hire. A full-time consultant at $5K/mo pays for themselves with 1 new Tier 2 client ($6,500/mo) — and frees you to focus on sales and strategy.
        </div>
      </Panel>
    </div>
  );
}

// Comms Tab (Feature 7) — with agent visual tokens + recording upload shortcut
function CommsTab({ onTabNav }) {
  const { COMMS } = useData();
  const all = [...COMMS].sort((a,b) => new Date(b.date) - new Date(a.date));
  const tc = { email:"#38bdf8", call:"#4ade80", meeting:"#c084fc", sms:"#fbbf24" };

  // Mock agent-generated entries — these will come from Supabase in Task 17
  const agentEntries = new Set(["Mar 01", "Feb 28"]); // dates of mock agent-written entries

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:14, maxWidth:680 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <h2 style={{ fontSize:17, fontWeight:700, color:"#f0f8ff" }}>Communication Log</h2>
        <div style={{ display:"flex", gap:8 }}>
          {/* Recording upload shortcut */}
          <button
            onClick={() => onTabNav && onTabNav("agents")}
            style={{ fontSize:11, fontWeight:600, color:"#818cf8", background:"rgba(99,102,241,0.08)", border:"1px solid rgba(99,102,241,0.15)", borderRadius:6, padding:"5px 12px", cursor:"pointer" }}
          >
            🎙️ Upload Recording
          </button>
          <button
            onClick={() => document.dispatchEvent(new CustomEvent("ic-show-form", { detail:"comm" }))}
            style={{ fontSize:11, fontWeight:600, color:"#a5b4fc", background:"rgba(99,102,241,0.1)", border:"1px solid rgba(99,102,241,0.2)", borderRadius:6, padding:"5px 12px", cursor:"pointer" }}
          >
            + Log Comms
          </button>
        </div>
      </div>

      {/* Agent activity note */}
     <div style={{ fontSize:10, color:"#818cf8", padding:"6px 10px", background:"rgba(99,102,241,0.04)", border:"1px solid rgba(99,102,241,0.08)", borderRadius:7 }}>
        🤖 Entries with an indigo border were written by an IC-BOS agent. Upload a recording to auto-generate call entries.
      </div>

      <div style={{ position:"relative", paddingLeft:20 }}>
        <div style={{ position:"absolute", left:6, top:0, bottom:0, width:2, background:"#0d2b4e" }}/>
        {all.map((c,i) => {
          const isAgentEntry = agentEntries.has(c.date);
          return (
            <div key={i} style={{ position:"relative", marginBottom:10, animation:`fu 0.3s ease ${i*30}ms both` }}>
              <div style={{ position:"absolute", left:-17, top:3, width:12, height:12, borderRadius:"50%", background:tc[c.type], border:"2px solid #0a0a0f" }}/>
              <div style={{
                background: isAgentEntry ? "rgba(99,102,241,0.04)" : "rgba(255,255,255,0.02)",
                border: `1px solid ${isAgentEntry ? "rgba(99,102,241,0.2)" : "rgba(255,255,255,0.04)"}`,
                borderLeft: isAgentEntry ? "3px solid #6366f1" : "1px solid rgba(42,182,215,0.08)",
                borderRadius:8,
                padding:"8px 14px"
              }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:3 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <span style={{ fontSize:12, fontWeight:600, color:"#f0f8ff" }}>{c.client}</span>
                    {isAgentEntry && (
                      <span style={{ fontSize:8, fontWeight:700, color:"#818cf8", background:"rgba(99,102,241,0.12)", padding:"1px 5px", borderRadius:3, fontFamily:M }}>🤖 AGENT</span>
                    )}
                  </div>
                  <span style={{ fontSize:10, color:"#7aaacb", fontFamily:M }}>{c.date}</span>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                  <span style={{ fontSize:9, color:tc[c.type], fontWeight:600, textTransform:"uppercase", fontFamily:M }}>{c.type}</span>
                  <span style={{ fontSize:11, color:"#a8c8e8" }}>{c.note}</span>
                </div>
                {/* View Transcript / View Analysis buttons for call entries */}
                {c.type === "call" && (
                  <div style={{ display:"flex", gap:5, marginTop:6 }}>
                    <button style={{ fontSize:9, color:"#38bdf8", background:"rgba(56,189,248,0.08)", border:"1px solid rgba(56,189,248,0.12)", borderRadius:4, padding:"2px 7px", cursor:"pointer" }}>
                      View Transcript
                    </button>
                    <button style={{ fontSize:9, color:"#818cf8", background:"rgba(99,102,241,0.08)", border:"1px solid rgba(99,102,241,0.12)", borderRadius:4, padding:"2px 7px", cursor:"pointer" }}>
                      View Analysis
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
function TasksView({ onShowForm, canEdit }) {
  const { TASKS } = useData();
  const [showCompleted, setShowCompleted] = useState(false);
  const [completedTasks, setCompletedTasks] = useState([]);
  const [completedLoading, setCompletedLoading] = useState(false);
  const [search, setSearch] = useState("");

  const fetchCompleted = async () => {
    setCompletedLoading(true);
    const { data } = await supabase
      .from("tasks")
      .select("id, text, due_date, priority, category, completed, completed_at, created_at")
      .eq("completed", true)
      .order("completed_at", { ascending: false })
      .limit(100);
    setCompletedTasks(data ?? []);
    setCompletedLoading(false);
  };

  const handleToggleCompleted = () => {
    if (!showCompleted) fetchCompleted();
    setShowCompleted(p => !p);
    setSearch("");
  };

  const pMap = { critical:0, high:1, medium:2, low:3 };

  const filteredActive = [...TASKS]
    .sort((a,b) => {
      const x = pMap[a.priority] !== undefined ? pMap[a.priority] : 2;
      const y = pMap[b.priority] !== undefined ? pMap[b.priority] : 2;
      return x - y;
    })
    .filter(t => !search || t.text?.toLowerCase().includes(search.toLowerCase()));

  const filteredCompleted = completedTasks.filter(t =>
    !search || t.text?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12, maxWidth:680 }}>
      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <h2 style={{ fontSize:17, fontWeight:700, color:"#f0f8ff" }}>Action Items</h2>
        {canEdit && <button onClick={onShowForm} style={{ fontSize:11, fontWeight:600, color:"#a5b4fc", background:"rgba(99,102,241,0.1)", border:"1px solid rgba(99,102,241,0.2)", borderRadius:6, padding:"5px 12px", cursor:"pointer" }}>+ Add Task</button>}
      </div>

      {/* Search bar */}
      <div style={{ position:"relative" }}>
        <span style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", fontSize:13, color:"#4a6a8a" }}>🔍</span>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search tasks..."
          style={{ width:"100%", padding:"8px 12px 8px 32px", borderRadius:8, border:"1px solid rgba(42,182,215,0.15)", background:"rgba(42,182,215,0.05)", color:"#f0f8ff", fontSize:12, fontFamily:"inherit", outline:"none" }}
        />
        {search && <button onClick={()=>setSearch("")} style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", background:"transparent", border:"none", color:"#4a6a8a", cursor:"pointer", fontSize:14 }}>×</button>}
      </div>

      {/* Active tasks */}
      <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
        {filteredActive.length === 0 && (
          <div style={{ fontSize:12, color:"#4a6a8a", textAlign:"center", padding:"20px 0" }}>
            {search ? "No tasks match your search." : "No open tasks — you're all caught up! 🎉"}
          </div>
        )}
        {filteredActive.map((t,i) => <TaskItem key={t.id} task={t} delay={i*30}/>)}
      </div>

      {/* Completed toggle */}
      <button
        onClick={handleToggleCompleted}
        style={{ display:"flex", alignItems:"center", gap:8, background:"transparent", border:"1px solid rgba(42,182,215,0.1)", borderRadius:8, padding:"8px 14px", cursor:"pointer", color:"#4a6a8a", fontSize:11, fontFamily:"inherit", marginTop:4 }}
      >
        <span style={{ fontSize:10, color:"#4ade80" }}>{showCompleted ? "▲" : "▼"}</span>
        {showCompleted ? "Hide" : "Show"} completed tasks
        {completedTasks.length > 0 && <span style={{ fontSize:10, color:"#4ade80", background:"rgba(74,222,128,0.1)", borderRadius:4, padding:"1px 6px", fontFamily:M }}>{completedTasks.length}</span>}
      </button>

      {/* Completed tasks list */}
      {showCompleted && (
        <div style={{ display:"flex", flexDirection:"column", gap:5, animation:"fu 0.3s ease both" }}>
          {completedLoading && <div style={{ fontSize:11, color:"#4a6a8a", textAlign:"center", padding:"12px 0" }}>Loading...</div>}
          {!completedLoading && filteredCompleted.length === 0 && (
            <div style={{ fontSize:12, color:"#4a6a8a", textAlign:"center", padding:"12px 0" }}>
              {search ? "No completed tasks match your search." : "No completed tasks yet."}
            </div>
          )}
          {filteredCompleted.map((t, i) => (
            <div key={t.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 12px", borderRadius:7, background:"rgba(74,222,128,0.02)", border:"1px solid rgba(74,222,128,0.06)", opacity:0.5, animation:`fu 0.3s ease ${i*20}ms both` }}>
              <span style={{ width:16, height:16, borderRadius:4, background:"#4ade80", border:"2px solid #4ade80", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                <span style={{ color:"#111", fontSize:10, fontWeight:800 }}>✓</span>
              </span>
              <span style={{ flex:1, fontSize:12, color:"#6b7280", textDecoration:"line-through" }}>{t.text}</span>
              <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:2 }}>
                <span style={{ fontSize:9, color:"#4a6a8a", fontFamily:M }}>{t.category}</span>
                {t.completed_at && <span style={{ fontSize:9, color:"#4a6a8a", fontFamily:M }}>✓ {new Date(t.completed_at).toLocaleDateString("en-US",{month:"short",day:"numeric"})}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
// ═══════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════
export default function ICBOS() {
  const [tab, setTab] = useState("overview");

  const [showForm, setShowForm] = useState(null);
  const [showPulsePopover, setShowPulsePopover] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const [dismissedNotifs, setDismissedNotifs] = useState([]);
  const [userRole, setUserRole] = useState("principal"); // principal | consultant | viewer

  // Load user role from Supabase session app_metadata
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.app_metadata?.role) {
        setUserRole(session.user.app_metadata.role);
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user?.app_metadata?.role) {
        setUserRole(session.user.app_metadata.role);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // ─── Live Supabase Data ───────────────────────────────────────────────
  const icbos = useICBosData();

  // ─── Field-name adapters (Supabase snake_case -> UI camelCase) ────────
  const PIPELINE = (icbos.pipeline.data ?? []).map(d => ({
    ...d,
    supabase_id:    d.id,
    practice:       d.practice_name       ?? "",
    specialty:      d.specialty           ?? "",
    ehr:            d.ehr                 ?? "",
    stage:          (d.stage ?? "cold").toLowerCase().replace(/\s+/g, "-"),
    value:          Number(d.estimated_value  ?? 0),
    contact:        d.contact_name        ?? "",
    nextAction:     d.next_action         ?? "",
    daysInStage:    d.days_in_stage       ?? 0,
    tier:           d.tier                ?? 1,
    providers:      d.providers           ?? 1,
    payer:          d.payer_mix           ?? "",
    noShowBaseline: Number(d.no_show_baseline ?? 15),
    ehrDifficulty:  d.ehr_difficulty      ?? "3/5",
    ehrTimeline:    d.ehr_timeline        ?? "4-6 weeks",
    ehrNotes:       d.ehr_notes           ?? "",
  }));

  const CLIENTS = (icbos.clients.data ?? []).map(c => ({
    ...c,
    status:           (c.status ?? "active").toLowerCase(),
    healthScore:      Number(c.health_score       ?? 0),
    goLive:           c.go_live_date              ?? null,
    monthlyFee:       Number(c.monthly_fee        ?? 0),
    platformCost:     Number(c.platform_cost      ?? 0),
    noShowBefore:     Number(c.no_show_before     ?? 0),
    noShowCurrent:    Number(c.no_show_current    ?? 0),
    weeklyHoursSaved: Number(c.weekly_hours_saved ?? 0),
    weeklyHoursSpent: Number(c.weekly_hours_spent ?? 0),
    renewalDate:      c.renewal_date              ?? null,
    nextMilestone:    c.notes                     ?? "",
    providers:        Number(c.providers          ?? 1),
    apptsPerWeek:     Number(c.appts_per_week     ?? 0),
    avgVisitValue:    Number(c.avg_visit_value    ?? 65),
    staffHourlyRate:  Number(c.staff_hourly_rate  ?? 18),
    automations: [],
    contactLog:  [],
  }));

  const _fin = icbos.financials.data ?? {};
  const _cur = _fin.current ?? {};
  const FINANCIALS = {
    mrr:                Number(_cur.mrr                 ?? 0),
    arr:                Number(_cur.arr                 ?? 0),
    cashOnHand:         Number(_cur.cash_on_hand        ?? 0),
    accountsReceivable: Number(_cur.accounts_receivable ?? 0),
    monthlyExpenses:    Number(_cur.monthly_expenses    ?? 0),
    pipelineValue:      Number(_cur.pipeline_value      ?? 0),
    revenueHistory: (_fin.snapshots ?? []).map(s => ({
      month:    new Date(s.date + "T00:00:00").toLocaleString("en-US", { month: "short" }),
      revenue:  Number(s.mrr              ?? 0),
      expenses: Number(s.monthly_expenses ?? 0),
    })),
  };

  const INVOICES = (icbos.invoices.data ?? []).map(i => ({
    ...i,
    client:    i.clients?.name ?? "",
    amount:    Number(i.base_amount  ?? 0),
    usageCost: Number(i.usage_cost   ?? 0),
    total:     Number(i.total        ?? 0),
    issued:    i.issued_date ? new Date(i.issued_date + "T00:00:00").toLocaleString("en-US", { month: "short", day: "2-digit" }) : "",
    due:       i.due_date   ? new Date(i.due_date   + "T00:00:00").toLocaleString("en-US", { month: "short", day: "2-digit" }) : "",
    status:    (i.status ?? "pending").toLowerCase(),
    paidDate:  i.paid_date  ? new Date(i.paid_date  + "T00:00:00").toLocaleString("en-US", { month: "short", day: "2-digit" }) : null,
  }));

  const AUTOMATIONS = (icbos.automations.data ?? []).map((a, idx) => ({
    ...a,
    id:          a.id          ?? idx,
    client:      a.client_name ?? "",
    name:        a.automation_name ?? "",
    status:      (a.status ?? a.health_flag ?? "healthy").toLowerCase(),
    successRate: Number(a.success_rate ?? 100),
    execsToday:  Number(a.execs_today  ?? 0),
    lastRun:     a.last_run_at ? new Date(a.last_run_at).toLocaleString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }) : "No data",
    costToday:   Number(a.cost_today   ?? 0),
    errors24h:   Number(a.errors_24h   ?? 0),
  }));

  const TASKS = (icbos.tasks.data ?? []).map(t => ({
    ...t,
    due:       t.due_date ?? null,
    priority:  (t.priority ?? "medium").toLowerCase(),
    category:  t.category  ?? "general",
    completed: t.completed ?? false,
  }));

  const ONBOARDING = (icbos.onboarding.data ?? []).map(o => ({
    ...o,
    client:       o.clients?.name ?? o.client_name ?? "",
    tier:         o.clients?.tier ?? o.tier        ?? 1,
    ehr:          o.clients?.ehr  ?? o.ehr         ?? "",
    kickoff:      o.kickoff_date   ?? null,
    targetGoLive: o.target_go_live ?? null,
    daysToGoLive: o.target_go_live ? Math.ceil((new Date(o.target_go_live) - Date.now()) / 86400000) : 0,
    phases:   o.phases   ?? [],
    risks:    o.risks    ?? [],
    blockers: o.blockers ?? [],
  }));

  const COMMS = (icbos.comms.data ?? []).map(c => ({
    ...c,
    client: c.clients?.name ?? "",
    date:   c.comm_date ?? "",
    type:   (c.type ?? "note").toLowerCase(),
    note:   c.note ?? "",
  }));

  // CAPACITY stays local — CapTab manages consultant team state internally
  const CAPACITY = { weeklyHoursAvailable: 50, currentUtilization: 38, deliveryHours: 22, salesHours: 10, adminHours: 6 };

  const isPrincipal = userRole === "principal";
  const isConsultant = userRole === "consultant";
  const canEdit = isPrincipal || isConsultant; // can use agent buttons and add buttons
  const canInvoice = isPrincipal;             // create invoices, draft collections follow-ups
  const canViewFinancials = isPrincipal;      // financials, profitability, capacity

  useEffect(()=>{const h=(e)=>setShowForm(e.detail);document.addEventListener("ic-show-form",h);return()=>document.removeEventListener("ic-show-form",h);},[]);
  const allTabs = [
    { id:"overview", l:"Overview" }, { id:"agents", l:"Agents" }, { id:"pipeline", l:"Pipeline" },
    { id:"clients", l:"Clients" }, { id:"tasks", l:"Tasks" }, { id:"comms", l:"Comms" },
    { id:"onboarding", l:"Onboarding" }, { id:"automations", l:"Automations" },
    { id:"proposal", l:"Proposals" }, { id:"invoicing", l:"Invoicing" }, { id:"renewals", l:"Renewals" },
    { id:"roi", l:"ROI" }, { id:"financials", l:"Financials", principalOnly: true },
    { id:"capacity", l:"Capacity", principalOnly: true },
    { id:"profitability", l:"Profitability", principalOnly: true },
    { id:"team", l:"Team", principalOnly: true },
    { id:"salesprep", l:"Sales Prep" }, { id:"report", l:"Report" },
  ];
  const tabs = allTabs.filter(t => !t.principalOnly || canViewFinancials);

  const totalROI = useMemo(()=>CLIENTS.reduce((s,c)=>s+calcClientROI(c).totalToDate,0),[CLIENTS]);
  const critCount = AUTOMATIONS.filter(a=>a.status==="critical").length;
  const highTasks = TASKS.filter(t=>t.priority==="high").length;
  const overdueInvs = INVOICES.filter(i=>i.status==="overdue");
  const pipeVal = PIPELINE.reduce((s,d)=>s+d.value,0);
  
// ── Mock agent running state (will be replaced by live agent_activity query in Step 17)
  const runningAgents = []; // empty = all idle; populate to test pulse: e.g. ["Proposal Generator"]

  // ── Derive smart notifications from existing mock data ──────────────
  const allNotifs = [
    ...PIPELINE.filter(d => d.daysInStage >= 7).map(d => ({
      id: `stale-${d.id}`, type: "stale", color: "#fbbf24",
      icon: "⏳", tab: "pipeline",
      text: `${d.practice} stale — ${d.daysInStage} days in ${STAGE_LABELS[d.stage]}`,
    })),
    ...INVOICES.filter(i => i.status === "overdue").map(i => ({
      id: `overdue-${i.id}`, type: "overdue", color: "#f87171",
      icon: "💰", tab: "invoicing",
      text: `${i.client} invoice overdue — $${i.total.toLocaleString()} due ${i.due}`,
    })),
    ...CLIENTS.filter(c => c.healthScore < 70).map(c => ({
      id: `health-${c.id}`, type: "health", color: "#fb923c",
      icon: "❤️", tab: "clients",
      text: `${c.name} health score low — ${c.healthScore}/100`,
    })),
    ...CLIENTS.filter(c => {
      const days = Math.round((new Date(c.renewalDate) - Date.now()) / 864e5);
      return days > 0 && days <= 60;
    }).map(c => {
      const days = Math.round((new Date(c.renewalDate) - Date.now()) / 864e5);
      return {
        id: `renewal-${c.id}`, type: "renewal", color: "#818cf8",
        icon: "🔄", tab: "renewals",
        text: `${c.name} renewal in ${days} days — health ${c.healthScore}`,
      };
    }),
  ].filter(n => !dismissedNotifs.includes(n.id));
  const unreadCount = allNotifs.length;
  const isAnyAgentRunning = runningAgents.length > 0;
  
  return (
   <ICBOSCtx.Provider value={{ PIPELINE, CLIENTS, FINANCIALS, INVOICES, AUTOMATIONS, TASKS, ONBOARDING, CAPACITY, COMMS }}>
   <div style={{ minHeight:"100vh", background:"#071830", color:"#f0f8ff", fontFamily:"'Inter',-apple-system,sans-serif",  }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
        @keyframes fu{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pr{0%{transform:scale(1);opacity:.5}100%{transform:scale(1.3);opacity:0}}
        *{box-sizing:border-box;margin:0;padding:0;scrollbar-width:thin;scrollbar-color:#1e4060 transparent}
        ::-webkit-scrollbar{width:5px;height:5px}::-webkit-scrollbar-thumb{background:#1e4060;border-radius:3px}
        button{font-family:inherit}
      `}</style>

      <div style={{ position:"fixed", inset:0, zIndex:0, pointerEvents:"none", background:"transparent" }}/>

      {/* Header */}
      <header style={{ position:"sticky", top:0, zIndex:50, display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 24px", background:"#0d2b4e", backdropFilter:"blur(20px)", borderBottom:"1px solid rgba(42,182,215,0.15)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
         <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <div>
              <div style={{ fontSize:14, fontWeight:600, color:"#f0f8ff", letterSpacing:"-0.3px" }}>Immaculate Consulting</div>
              <div style={{ fontSize:9, color:"#7aaacb", letterSpacing:"0.5px" }}>Business Operating System</div>
            </div>
            <span style={{ fontSize:9, fontWeight:700, color:"#2ab6d7", background:"rgba(42,182,215,0.12)", border:"1px solid rgba(42,182,215,0.25)", borderRadius:4, padding:"2px 7px", letterSpacing:"0.5px" }}>IC-BOS</span>
          </div>
        </div>
        <nav style={{ display:"flex", gap:1, flexWrap:"wrap", justifyContent:"center", maxWidth:820 }}>
          {tabs.map(t=>(<button key={t.id} onClick={()=>setTab(t.id)} style={{ padding:"5px 9px", borderRadius:6, border:"none", cursor:"pointer", fontSize:10.5, fontWeight:500, background:tab===t.id?"rgba(42,182,215,0.15)":"transparent", color:tab===t.id?"#2ab6d7":"#f0f8ff", transition:"all 0.15s", position:"relative" }}>
            {t.l}
            {t.id==="automations"&&critCount>0&&<span style={{ position:"absolute", top:2, right:2, width:5, height:5, borderRadius:"50%", background:"#f87171" }}/>}
            {t.id==="invoicing"&&overdueInvs.length>0&&<span style={{ position:"absolute", top:2, right:2, width:5, height:5, borderRadius:"50%", background:"#f87171" }}/>}
          </button>))}
        </nav>
        <div style={{ display:"flex", alignItems:"center", gap:10, position:"relative" }}>

         {/* Theme toggle */}
          

          {/* LIVE badge */}
          <span style={{ fontSize:9, color:"#4ade80", fontFamily:M, display:"flex", alignItems:"center", gap:4 }}>
            <span style={{ width:4, height:4, borderRadius:"50%", background:"#4ade80" }}/>LIVE
          </span>

          {/* Agent Activity Pulse */}
          <div style={{ position:"relative" }}>
            <button
              onClick={() => { setShowPulsePopover(p => !p); setShowNotifs(false); }}
              title="Agent activity"
              style={{ width:28, height:28, borderRadius:"50%", border:`1px solid ${isAnyAgentRunning ? "rgba(56,189,248,0.3)" : "rgba(255,255,255,0.08)"}`, background: isAnyAgentRunning ? "rgba(56,189,248,0.1)" : "rgba(255,255,255,0.04)", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", position:"relative" }}
            >
              <span style={{ width:8, height:8, borderRadius:"50%", background: isAnyAgentRunning ? "#38bdf8" : "#4b5563", display:"block" }}/>
              {isAnyAgentRunning && <span style={{ position:"absolute", width:14, height:14, borderRadius:"50%", background:"rgba(56,189,248,0.3)", animation:"pr 1.2s ease-out infinite" }}/>}
            </button>
            {showPulsePopover && (
              <div style={{ position:"absolute", top:36, right:0, width:220, background:"#0a2240", border:"1px solid rgba(42,182,215,0.15)", borderRadius:10, padding:"12px 14px", zIndex:200, boxShadow:"0 8px 32px rgba(0,0,0,0.5)", animation:"fu 0.15s ease both" }}>
                <div style={{ fontSize:10, fontWeight:700, color:"#7aaacb", textTransform:"uppercase", letterSpacing:"0.08em", fontFamily:M, marginBottom:8 }}>Agent Pulse</div>
                {isAnyAgentRunning ? (
                  runningAgents.map(name => (
                    <div key={name} style={{ display:"flex", alignItems:"center", gap:7, marginBottom:6 }}>
                      <span style={{ width:7, height:7, borderRadius:"50%", background:"#38bdf8", flexShrink:0, animation:"pr 1.2s ease-out infinite" }}/>
                      <span style={{ fontSize:11, color:"#7dd3fc" }}>{name}</span>
                    </div>
                  ))
                ) : (
                  <div style={{ fontSize:11, color:"#4a6a8a", display:"flex", alignItems:"center", gap:6 }}>
                    <span style={{ width:7, height:7, borderRadius:"50%", background:"#374151", flexShrink:0 }}/>
                    All agents idle
                  </div>
                )}
                <button onClick={() => { setTab("agents"); setShowPulsePopover(false); }} style={{ marginTop:10, fontSize:10, color:"#818cf8", background:"rgba(99,102,241,0.08)", border:"1px solid rgba(99,102,241,0.12)", borderRadius:6, padding:"4px 10px", cursor:"pointer", width:"100%" }}>
                  Open Agents Tab →
                </button>
              </div>
            )}
          </div>

          {/* Smart Notifications Bell */}
          <div style={{ position:"relative" }}>
            <button
              onClick={() => { setShowNotifs(p => !p); setShowPulsePopover(false); }}
              title="Notifications"
              style={{ width:28, height:28, borderRadius:"50%", border:`1px solid ${unreadCount > 0 ? "rgba(251,191,36,0.25)" : "rgba(255,255,255,0.08)"}`, background: unreadCount > 0 ? "rgba(251,191,36,0.06)" : "rgba(255,255,255,0.04)", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, position:"relative" }}
            >
              🔔
              {unreadCount > 0 && (
                <span style={{ position:"absolute", top:-3, right:-3, minWidth:14, height:14, borderRadius:7, background:"#f87171", border:"2px solid #0a0a0f", fontSize:8, fontWeight:800, color:"#f0f8ff", fontFamily:M, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 2px" }}>
                  {unreadCount}
                </span>
              )}
            </button>
            {showNotifs && (
              <div style={{ position:"absolute", top:36, right:0, width:300, background:"#0a2240", border:"1px solid rgba(42,182,215,0.15)", borderRadius:10, zIndex:200, boxShadow:"0 8px 32px rgba(0,0,0,0.5)", animation:"fu 0.15s ease both", overflow:"hidden" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 14px 8px", borderBottom:"1px solid rgba(42,182,215,0.15)" }}>
                  <span style={{ fontSize:11, fontWeight:700, color:"#f0f8ff" }}>Notifications</span>
                  {allNotifs.length > 0 && (
                    <button onClick={() => setDismissedNotifs(prev => [...prev, ...allNotifs.map(n => n.id)])} style={{ fontSize:9, color:"#7aaacb", background:"transparent", border:"none", cursor:"pointer" }}>Clear all</button>
                  )}
                </div>
                <div style={{ maxHeight:320, overflowY:"auto" }}>
                  {allNotifs.length === 0 ? (
                    <div style={{ padding:"20px 14px", fontSize:11, color:"#4a6a8a", textAlign:"center" }}>No new notifications</div>
                  ) : (
                    allNotifs.map(n => (
                      <div key={n.id} style={{ display:"flex", alignItems:"flex-start", gap:9, padding:"10px 14px", borderBottom:"1px solid rgba(42,182,215,0.08)", cursor:"pointer" }}
                        onClick={() => { setTab(n.tab); setShowNotifs(false); }}
                        onMouseEnter={e => e.currentTarget.style.background = "rgba(42,182,215,0.04)"}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                      >
                        <span style={{ fontSize:14, flexShrink:0, marginTop:1 }}>{n.icon}</span>
                        <span style={{ fontSize:11, color:"#a8c8e8", flex:1, lineHeight:1.4 }}>{n.text}</span>
                        <button
                          onClick={e => { e.stopPropagation(); setDismissedNotifs(prev => [...prev, n.id]); }}
                          style={{ fontSize:12, color:"#4a6a8a", background:"transparent", border:"none", cursor:"pointer", flexShrink:0, padding:"0 2px" }}
                        >×</button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Sign Out */}
         <span style={{ fontSize:9, fontWeight:700, textTransform:"uppercase", color: isPrincipal?"#a5b4fc":isConsultant?"#4ade80":"#9ca3af", background: isPrincipal?"rgba(99,102,241,0.1)":isConsultant?"rgba(74,222,128,0.1)":"rgba(255,255,255,0.04)", border:`1px solid ${isPrincipal?"rgba(99,102,241,0.2)":isConsultant?"rgba(74,222,128,0.2)":"rgba(255,255,255,0.08)"}`, borderRadius:5, padding:"3px 8px", fontFamily:M }}>{userRole}</span>
          <button onClick={async () => { await supabase.auth.signOut(); window.location.reload(); }} style={{ fontSize:10, color:"#a8c8e8", background:"#0d2b4e", border:"1px solid rgba(42,182,215,0.15)", borderRadius:6, padding:"4px 10px", cursor:"pointer" }}>Sign Out</button>

        </div>
      </header>

      {/* Main */}
      <main style={{ padding:"18px 24px 108px", position:"relative", zIndex:1 }}>
        {tab==="overview"&&(
          icbos.isBootstrapping ? (
            <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:200,gap:12}}>
              <span style={{width:8,height:8,borderRadius:"50%",background:"#6366f1",animation:"pr 1.2s ease-out infinite"}}/>
              <span style={{fontSize:12,color:"#7aaacb",fontFamily:M}}>Loading IC-BOS...</span>
            </div>
          ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            {/* ROI Banner */}
            <div style={{ background:"linear-gradient(135deg,rgba(74,222,128,0.05),rgba(56,189,248,0.03))", border:"1px solid rgba(74,222,128,0.08)", borderRadius:12, padding:"14px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", animation:"fu 0.5s ease both" }}>
              <div><div style={{ fontSize:9, fontWeight:600, color:"#7aaacb", textTransform:"uppercase", letterSpacing:"0.1em", fontFamily:M }}>Total Client Value Recovered</div>
              <div style={{ fontSize:30, fontWeight:800, color:"#4ade80", fontFamily:M, lineHeight:1, marginTop:3 }}><AnimNum value={Math.round(totalROI)} prefix="$" dur={1800}/></div></div>
              <button onClick={()=>setTab("roi")} style={{ fontSize:10, color:"#4ade80", background:"rgba(74,222,128,0.08)", border:"1px solid rgba(74,222,128,0.12)", borderRadius:6, padding:"5px 12px", cursor:"pointer" }}>View →</button>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:10 }}>
              <KPI label="MRR" value={FINANCIALS.mrr} prefix="$" change={12.2} spark={FINANCIALS.revenueHistory.map(r=>r.revenue)} sparkColor="#818cf8"/>
              <KPI label="Pipeline" value={pipeVal} prefix="$" suffix="/mo" spark={[28e3,32e3,35e3,38e3,42e3,45e3]} sparkColor="#fbbf24" delay={50}/>
              <KPI label="Clients" value={CLIENTS.filter(c=>c.status==="active").length} spark={[1,1,2,2,3,3]} sparkColor="#4ade80" delay={100}/>
              <KPI label="Capacity" value={Math.round((CAPACITY.currentUtilization/CAPACITY.weeklyHoursAvailable)*100)} suffix="%" spark={[55,60,65,70,74,76]} sparkColor="#4ade80" delay={150}/>
              <KPI label="Automations" value={AUTOMATIONS.length} spark={[4,5,5,6,7,7]} sparkColor={critCount?"#f87171":"#4ade80"} delay={200}/>
            </div>
            {(critCount>0||overdueInvs.length>0)&&<div style={{ display:"flex", gap:10 }}>
              {critCount>0&&<div onClick={()=>setTab("automations")} style={{ flex:1, background:"rgba(248,113,113,0.05)", border:"1px solid rgba(248,113,113,0.1)", borderRadius:10, padding:"10px 14px", cursor:"pointer", animation:"fu 0.4s ease both" }}>
                <div style={{ fontSize:11, fontWeight:600, color:"#f87171" }}>⚠️ {critCount} critical automation</div>
                <div style={{ fontSize:10, color:"#a8c8e8", marginTop:2 }}>{AUTOMATIONS.filter(a=>a.status==="critical").map(a=>`${a.client}: ${a.name}`).join(" · ")}</div>
              </div>}
              {overdueInvs.length>0&&<div onClick={()=>setTab("invoicing")} style={{ flex:1, background:"rgba(248,113,113,0.05)", border:"1px solid rgba(248,113,113,0.1)", borderRadius:10, padding:"10px 14px", cursor:"pointer", animation:"fu 0.4s ease 100ms both" }}>
                <div style={{ fontSize:11, fontWeight:600, color:"#f87171" }}>💰 {overdueInvs.length} overdue invoice</div>
                <div style={{ fontSize:10, color:"#a8c8e8", marginTop:2 }}>{overdueInvs.map(i=>`${i.client}: $${i.total.toLocaleString()}`).join(" · ")}</div>
              </div>}
            </div>}
            <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr", gap:12 }}>
              <Panel title="Revenue vs Expenses" subtitle="Last 6 months"><RevChart data={FINANCIALS.revenueHistory}/></Panel>
              <Panel title="Priority Actions" action={<span style={{ fontSize:9, fontWeight:600, color:"#f87171", background:"rgba(248,113,113,0.1)", padding:"2px 7px", borderRadius:4, fontFamily:M }}>{highTasks} urgent</span>}>
                <div style={{ display:"flex", flexDirection:"column", gap:5 }}>{TASKS.filter(t=>t.priority==="high").map((t,i)=><TaskItem key={t.id} task={t} delay={i*40}/>)}</div>
              </Panel>
            </div>
            <Panel title="Sales Pipeline" action={<button onClick={()=>setTab("pipeline")} style={{ fontSize:10, color:"#818cf8", background:"none", border:"none", cursor:"pointer" }}>View all →</button>}><PipelineBoard onRefresh={()=>icbos.pipeline.refetch()}/></Panel>
          </div>
          )
        )}
       {tab==="agents"&&<AgentsTab onTabNav={(tabId)=>setTab(tabId)}/>}
       {tab==="pipeline"&&<><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}><h2 style={{fontSize:17,fontWeight:700,color:"#f0f8ff"}}>Sales Pipeline</h2>{canEdit&&<button onClick={()=>setShowForm("deal")} style={{fontSize:11,fontWeight:600,color:"#a5b4fc",background:"rgba(99,102,241,0.1)",border:"1px solid rgba(99,102,241,0.2)",borderRadius:6,padding:"5px 12px",cursor:"pointer"}}>+ Add Deal</button>}</div><p style={{fontSize:11,color:"#7aaacb",marginBottom:14}}>{PIPELINE.length} deals · ${pipeVal.toLocaleString()}/mo</p><PipelineBoard canEdit={canEdit} onRefresh={()=>icbos.pipeline.refetch()}/></>}
      {tab==="clients"&&<ClientsTab onShowForm={canEdit?()=>setShowForm("client"):null} onDeleted={()=>icbos.clients.refetch()}/>}
        {tab==="roi"&&<ROITab/>}
        {tab==="financials"&&(
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <h2 style={{fontSize:17,fontWeight:700,color:"#f0f8ff"}}>Financial Overview</h2>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12}}>
              <KPI label="MRR" value={FINANCIALS.mrr} prefix="$" change={12.2} spark={FINANCIALS.revenueHistory.map(r=>r.revenue)} sparkColor="#818cf8"/>
              <KPI label="ARR" value={FINANCIALS.arr} prefix="$" spark={FINANCIALS.revenueHistory.map(r=>r.revenue*12)} sparkColor="#4ade80" delay={60}/>
              <KPI label="Cash" value={FINANCIALS.cashOnHand} prefix="$" spark={[32e3,35e3,38e3,41e3,45e3,48200]} sparkColor="#38bdf8" delay={120}/>
              <KPI label="Net Margin" value={FINANCIALS.monthlyExpenses>0?Math.round(((FINANCIALS.mrr-FINANCIALS.monthlyExpenses)/FINANCIALS.mrr)*100):0} suffix="%" spark={[58,60,63,65,67,69]} sparkColor="#4ade80" delay={180}/>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <Panel title="Revenue Trend"><RevChart data={FINANCIALS.revenueHistory}/></Panel>
              <Panel title="Monthly P&L">{[{l:"Revenue",v:`$${FINANCIALS.mrr.toLocaleString()}`,c:"#818cf8"},{l:"Expenses",v:`-$${FINANCIALS.monthlyExpenses.toLocaleString()}`,c:"#f87171"},{l:"Net",v:`$${(FINANCIALS.mrr-FINANCIALS.monthlyExpenses).toLocaleString()}`,c:"#4ade80"},{l:"A/R",v:`$${FINANCIALS.accountsReceivable.toLocaleString()}`,c:"#fbbf24"}].map((m,i)=>(<div key={i} style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:"1px solid rgba(42,182,215,0.08)"}}><span style={{fontSize:12,color:"#a8c8e8"}}>{m.l}</span><span style={{fontSize:12,fontWeight:600,color:m.c,fontFamily:M}}>{m.v}</span></div>))}</Panel>
            </div>
          </div>
        )}
        {tab==="invoicing"&&<InvoicingTab canInvoice={canInvoice} canEdit={canEdit}/>}
        {tab==="automations"&&<AutoTab/>}
        {tab==="onboarding"&&<OnboardingTab/>}
        {tab==="capacity"&&<CapTab/>}
        {tab==="team"&&<TeamTab webhookSecret={import.meta.env.VITE_VAPI_WEBHOOK_SECRET}/>}
        {tab==="profitability"&&<ProfitabilityTab/>}
        {tab==="renewals"&&<RenewalsTab/>}
        {tab==="proposal"&&<ProposalTab/>}
        {tab==="salesprep"&&<SalesPrepTab/>}
        {tab==="tasks"&&<TasksView onShowForm={()=>setShowForm("task")} canEdit={canEdit}/>}
        {tab==="report"&&<WeeklyReportTab/>}
      </main>
{showForm==="client"&&<AddClientPanel onClose={()=>setShowForm(null)} supabase={supabase} onSaved={()=>{ setShowForm(null); icbos.clients.refetch(); }}/>}
      {showForm==="deal"&&<AddDealPanel onClose={()=>setShowForm(null)} supabase={supabase} onSaved={()=>{ setShowForm(null); icbos.pipeline.refetch(); }}/>}
      {showForm==="task"&&<AddTaskPanel onClose={()=>setShowForm(null)} supabase={supabase} onSaved={()=>{ setShowForm(null); icbos.tasks.refetch(); }}/>}
      {showForm==="invoice"&&<AddInvoicePanel onClose={()=>setShowForm(null)} supabase={supabase} clients={CLIENTS} onSaved={()=>{ setShowForm(null); icbos.invoices.refetch(); icbos.financials.refetch(); }}/>}
      {showForm==="comm"&&<AddCommPanel onClose={()=>setShowForm(null)} supabase={supabase} clients={CLIENTS} onSaved={()=>{ setShowForm(null); icbos.comms.refetch(); }}/>}
    {/* Voice Layer — Vapi SDK */}
      <VapiAssistant onTabChange={(tabId) => setTab(tabId)} onOpenForm={(formId) => setShowForm(formId)} />
  </div>
  </ICBOSCtx.Provider>
  );
}
