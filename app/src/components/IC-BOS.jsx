import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import VapiAssistant from "./VapiAssistant";
import { AddClientPanel, AddDealPanel, AddTaskPanel, AddInvoicePanel, AddCommPanel } from "./ICBOSForms";
import AgentsTab from "./AgentsTab";
import { supabase } from "../lib/supabaseClient";

// ═══════════════════════════════════════════════════════════════════════
// IC-BOS — Immaculate Consulting Business Operating System
// Complete Business Operations System with Voice Layer
// 16 Tabs: Overview, Pipeline, Clients, ROI, Financials, Automations,
//   Capacity, Renewals, Proposals, Tasks, Comms, Invoicing,
//   Onboarding, Profitability, Sales Prep, Weekly Report
// ═══════════════════════════════════════════════════════════════════════

// ─── Data Store ──────────────────────────────────────────────────────
const PIPELINE = [
  { id: 1, practice: "Sunrise Family Medicine", specialty: "Family Medicine", ehr: "athenahealth", stage: "discovery", value: 6500, contact: "Dr. Patel", nextAction: "Send proposal by Friday", daysInStage: 3, tier: 2, providers: 6, payer: "NC Medicaid + BCBS", noShowBaseline: 19, ehrDifficulty: "2/5", ehrTimeline: "1-2 weeks", ehrNotes: "Cloud-native, excellent API, native insurance verification. Easiest integration." },
  { id: 2, practice: "Blue Ridge Ortho", specialty: "Orthopedics", ehr: "NextGen", stage: "proposal", value: 10000, contact: "Sarah Chen", nextAction: "Follow up on pricing questions", daysInStage: 7, tier: 3, providers: 14, payer: "Medicare + Commercial", noShowBaseline: 12, ehrDifficulty: "3/5", ehrTimeline: "4-6 weeks", ehrNotes: "FHIR support, moderate integration complexity. Good for specialty practices." },
  { id: 3, practice: "Triangle Pediatrics", specialty: "Pediatrics", ehr: "eClinicalWorks", stage: "negotiation", value: 5000, contact: "Dr. Williams", nextAction: "Schedule final demo", daysInStage: 2, tier: 1, providers: 3, payer: "NC Medicaid", noShowBaseline: 24, ehrDifficulty: "3/5", ehrTimeline: "4-6 weeks", ehrNotes: "FHIR R4, popular with NC community health centers." },
  { id: 4, practice: "Coastal Dermatology", specialty: "Dermatology", ehr: "athenahealth", stage: "closed-won", value: 7000, contact: "Maria Santos", nextAction: "Kickoff scheduled Mar 12", daysInStage: 0, tier: 2, providers: 8, payer: "Commercial + Self-pay", noShowBaseline: 10, ehrDifficulty: "2/5", ehrTimeline: "1-2 weeks", ehrNotes: "Same as Greenville — reuse integration patterns." },
  { id: 5, practice: "Raleigh Women's Health", specialty: "OB/GYN", ehr: "Epic", stage: "discovery", value: 12000, contact: "Dr. Johnson", nextAction: "Discovery call tomorrow 2pm", daysInStage: 1, tier: 3, providers: 11, payer: "All payers", noShowBaseline: 16, ehrDifficulty: "4/5", ehrTimeline: "6-8 weeks", ehrNotes: "Requires Showroom approval (2-4 wk process). SMART on FHIR backend services auth. Most features but longest timeline." },
  { id: 6, practice: "Durham Community Health", specialty: "Community Health", ehr: "eClinicalWorks", stage: "cold", value: 4500, contact: "James Taylor", nextAction: "Send intro email", daysInStage: 14, tier: 1, providers: 2, payer: "NC Medicaid", noShowBaseline: 28, ehrDifficulty: "3/5", ehrTimeline: "4-6 weeks", ehrNotes: "FHIR R4. Reuse Chapel Hill integration patterns." },
];

const CLIENTS = [
  { id: 1, name: "Greenville Primary Care", tier: 2, status: "active", healthScore: 92, goLive: "2026-01-15", monthlyFee: 6500, noShowBefore: 18, noShowCurrent: 7.2, weeklyHoursSaved: 12, weeklyHoursSpent: 6, automations: ["Appointment Reminders", "Insurance Verification", "No-Show Follow-up"], nextMilestone: "Quarterly review Mar 20", ehr: "athenahealth", renewalDate: "2026-07-15", providers: 7, apptsPerWeek: 180, avgVisitValue: 65, staffHourlyRate: 18, platformCost: 48, contactLog: [
    { date: "Mar 06", type: "email", note: "Sent monthly metrics report" },
    { date: "Mar 01", type: "call", note: "QBR prep discussion — very positive" },
    { date: "Feb 22", type: "email", note: "Automation optimization suggestions" },
    { date: "Feb 15", type: "meeting", note: "Reviewed no-show improvements" },
  ]},
  { id: 2, name: "Chapel Hill Family Med", tier: 1, status: "active", healthScore: 78, goLive: "2026-02-01", monthlyFee: 4500, noShowBefore: 22, noShowCurrent: 11.5, weeklyHoursSaved: 8, weeklyHoursSpent: 8, automations: ["Appointment Reminders", "Basic Portal"], nextMilestone: "Add insurance verification", ehr: "eClinicalWorks", renewalDate: "2026-08-01", providers: 3, apptsPerWeek: 90, avgVisitValue: 65, staffHourlyRate: 18, platformCost: 32, contactLog: [
    { date: "Mar 05", type: "email", note: "Feature request — insurance verification" },
    { date: "Feb 28", type: "call", note: "Discussed upsell to Tier 2" },
    { date: "Feb 14", type: "email", note: "Sent optimization recommendations" },
  ]},
  { id: 3, name: "Asheville Cardiology", tier: 3, status: "onboarding", healthScore: 65, goLive: "2026-03-25", monthlyFee: 10000, noShowBefore: 15, noShowCurrent: 15, weeklyHoursSaved: 0, weeklyHoursSpent: 15, automations: ["Setup in progress"], nextMilestone: "UAT testing Mar 15", ehr: "NextGen", renewalDate: "2027-03-25", providers: 12, apptsPerWeek: 240, avgVisitValue: 85, staffHourlyRate: 20, platformCost: 0, contactLog: [
    { date: "Mar 07", type: "call", note: "UAT timeline review — on track" },
    { date: "Mar 03", type: "meeting", note: "Technical deep dive with IT team" },
    { date: "Feb 25", type: "email", note: "Sent integration specs document" },
  ]},
  { id: 4, name: "Fayetteville Urgent Care", tier: 2, status: "active", healthScore: 88, goLive: "2025-11-01", monthlyFee: 6500, noShowBefore: 25, noShowCurrent: 9.1, weeklyHoursSaved: 14, weeklyHoursSpent: 5, automations: ["Appointment Reminders", "Insurance Verification", "Lab Results Routing"], nextMilestone: "Renewal discussion Apr 1", ehr: "athenahealth", renewalDate: "2026-05-01", providers: 8, apptsPerWeek: 210, avgVisitValue: 72, staffHourlyRate: 18, platformCost: 55, contactLog: [
    { date: "Mar 04", type: "email", note: "Renewal pricing proposal sent" },
    { date: "Feb 27", type: "call", note: "Discussed adding claims denial monitoring" },
    { date: "Feb 20", type: "meeting", note: "Quarterly business review — great ROI" },
    { date: "Feb 10", type: "email", note: "Automation success report delivered" },
  ]},
];

const FINANCIALS = {
  mrr: 27500, arr: 330000, cashOnHand: 48200, accountsReceivable: 13000,
  monthlyExpenses: 8400, pipelineValue: 45000,
  revenueHistory: [
    { month: "Sep", revenue: 11000, expenses: 6200 },
    { month: "Oct", revenue: 15500, expenses: 7100 },
    { month: "Nov", revenue: 18000, expenses: 7400 },
    { month: "Dec", revenue: 22000, expenses: 7800 },
    { month: "Jan", revenue: 24500, expenses: 8100 },
    { month: "Feb", revenue: 27500, expenses: 8400 },
  ],
};

const AUTOMATIONS = [
  { id: 1, client: "Greenville Primary Care", name: "Appointment Reminders", status: "healthy", successRate: 99.2, execsToday: 178, lastRun: "5 min ago", costToday: 1.42, errors24h: 1 },
  { id: 2, client: "Greenville Primary Care", name: "Insurance Verification", status: "healthy", successRate: 97.8, execsToday: 34, lastRun: "12 min ago", costToday: 6.80, errors24h: 0 },
  { id: 3, client: "Greenville Primary Care", name: "No-Show Follow-up", status: "healthy", successRate: 100, execsToday: 8, lastRun: "Last night 8pm", costToday: 0.24, errors24h: 0 },
  { id: 4, client: "Chapel Hill Family Med", name: "Appointment Reminders", status: "warning", successRate: 94.1, execsToday: 86, lastRun: "8 min ago", costToday: 0.69, errors24h: 5 },
  { id: 5, client: "Fayetteville Urgent Care", name: "Appointment Reminders", status: "healthy", successRate: 99.5, execsToday: 205, lastRun: "3 min ago", costToday: 1.64, errors24h: 0 },
  { id: 6, client: "Fayetteville Urgent Care", name: "Insurance Verification", status: "healthy", successRate: 98.1, execsToday: 42, lastRun: "18 min ago", costToday: 8.40, errors24h: 1 },
  { id: 7, client: "Fayetteville Urgent Care", name: "Lab Results Routing", status: "critical", successRate: 87.5, execsToday: 16, lastRun: "45 min ago", costToday: 0.32, errors24h: 2 },
];

const TASKS = [
  { id: 1, text: "Send Sunrise Family Medicine proposal", due: "Today", priority: "high", category: "sales" },
  { id: 2, text: "Asheville Cardiology UAT prep", due: "Mar 15", priority: "high", category: "delivery" },
  { id: 3, text: "Follow up Blue Ridge Ortho pricing", due: "Tomorrow", priority: "medium", category: "sales" },
  { id: 4, text: "Chapel Hill quarterly metrics report", due: "Mar 20", priority: "medium", category: "delivery" },
  { id: 5, text: "Invoice Fayetteville Urgent Care", due: "Mar 10", priority: "low", category: "finance" },
  { id: 6, text: "Discovery call — Raleigh Women's Health", due: "Tomorrow 2pm", priority: "high", category: "sales" },
  { id: 7, text: "Greenville Primary Care quarterly review", due: "Mar 20", priority: "medium", category: "delivery" },
  { id: 8, text: "Fix Fayetteville lab results routing", due: "Today", priority: "high", category: "delivery" },
  { id: 9, text: "Fayetteville renewal pricing", due: "Apr 1", priority: "medium", category: "sales" },
];

const INVOICES = [
  { id: "INV-2026-018", client: "Greenville Primary Care", type: "Managed — Tier 2", amount: 6500, usageCost: 48, total: 6548, issued: "Mar 01", due: "Mar 15", status: "paid", paidDate: "Mar 08" },
  { id: "INV-2026-019", client: "Chapel Hill Family Med", type: "Managed — Tier 1", amount: 4500, usageCost: 32, total: 4532, issued: "Mar 01", due: "Mar 15", status: "pending", paidDate: null },
  { id: "INV-2026-020", client: "Asheville Cardiology", type: "Managed — Tier 3", amount: 10000, usageCost: 0, total: 10000, issued: "Mar 01", due: "Mar 15", status: "pending", paidDate: null },
  { id: "INV-2026-021", client: "Fayetteville Urgent Care", type: "Managed — Tier 2", amount: 6500, usageCost: 55, total: 6555, issued: "Mar 01", due: "Mar 15", status: "overdue", paidDate: null },
  { id: "INV-2026-015", client: "Greenville Primary Care", type: "Managed — Tier 2", amount: 6500, usageCost: 45, total: 6545, issued: "Feb 01", due: "Feb 15", status: "paid", paidDate: "Feb 12" },
  { id: "INV-2026-016", client: "Chapel Hill Family Med", type: "Managed — Tier 1", amount: 4500, usageCost: 28, total: 4528, issued: "Feb 01", due: "Feb 15", status: "paid", paidDate: "Feb 14" },
  { id: "INV-2026-017", client: "Fayetteville Urgent Care", type: "Managed — Tier 2", amount: 6500, usageCost: 52, total: 6552, issued: "Feb 01", due: "Feb 15", status: "paid", paidDate: "Feb 13" },
];

const ONBOARDING = [
  { id: 1, client: "Asheville Cardiology", tier: 3, ehr: "NextGen", kickoff: "2026-02-10", targetGoLive: "2026-03-25", daysToGoLive: 17, phases: [
    { name: "Discovery & Planning", status: "complete", start: "Feb 10", end: "Feb 21", notes: "Requirements gathered, workflows mapped" },
    { name: "Development", status: "complete", start: "Feb 24", end: "Mar 07", notes: "Automation build complete, EHR integration done" },
    { name: "Testing & Training", status: "in-progress", start: "Mar 10", end: "Mar 21", notes: "UAT prep underway, training scheduled Mar 18-19" },
    { name: "Deployment", status: "upcoming", start: "Mar 24", end: "Mar 25", notes: "Go-live support planned" },
    { name: "Optimization", status: "upcoming", start: "Mar 26", end: "Apr 11", notes: "30-day intensive monitoring" },
  ], risks: ["NextGen API rate limits during peak hours", "12 providers to train in 2 days — tight schedule"], blockers: [] },
  { id: 2, client: "Coastal Dermatology", tier: 2, ehr: "athenahealth", kickoff: "2026-03-12", targetGoLive: "2026-04-09", daysToGoLive: 32, phases: [
    { name: "Discovery & Planning", status: "upcoming", start: "Mar 12", end: "Mar 20", notes: "Kickoff scheduled" },
    { name: "Development", status: "upcoming", start: "Mar 23", end: "Apr 03", notes: "" },
    { name: "Testing & Training", status: "upcoming", start: "Apr 04", end: "Apr 07", notes: "" },
    { name: "Deployment", status: "upcoming", start: "Apr 08", end: "Apr 09", notes: "" },
    { name: "Optimization", status: "upcoming", start: "Apr 10", end: "May 01", notes: "" },
  ], risks: ["Low no-show baseline (10%) — ROI story needs to focus on staff efficiency"], blockers: [] },
];

const CAPACITY = { weeklyHoursAvailable: 50, currentUtilization: 38, deliveryHours: 22, salesHours: 10, adminHours: 6 };

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
function processVoice(text) {
  const l = text.toLowerCase();
  if (l.match(/brief|morning|standup|daily|status|what.*miss/)) {
    const crit = AUTOMATIONS.filter(a=>a.status==="critical");
    const high = TASKS.filter(t=>t.priority==="high");
    const totalROI = CLIENTS.reduce((s,c)=>s+calcClientROI(c).totalToDate,0);
    const overdue = INVOICES.filter(i=>i.status==="overdue");
   let r = `Good morning, Leonard. IC-BOS daily briefing for ${new Date().toLocaleDateString('en-US', { month:'long', day:'numeric' })}.\n\n`;
    if (crit.length) r += `⚠️ CRITICAL: ${crit.map(a=>`${a.client} ${a.name} at ${a.successRate}%`).join("; ")}.\n\n`;
    r += `📋 ${high.length} high-priority tasks: ${high.map(t=>t.text).join("; ")}.\n\n`;
    r += `💰 Client value recovered: $${Math.round(totalROI).toLocaleString()}. MRR $${FINANCIALS.mrr.toLocaleString()}, cash $${FINANCIALS.cashOnHand.toLocaleString()}.`;
    if (overdue.length) r += `\n\n⚠️ ${overdue.length} overdue invoice: ${overdue.map(i=>`${i.client} $${i.total.toLocaleString()}`).join(", ")}.`;
    r += `\n\n📊 Pipeline: ${PIPELINE.length} deals, $${PIPELINE.reduce((s,d)=>s+d.value,0).toLocaleString()}/mo. Capacity ${Math.round((CAPACITY.currentUtilization/CAPACITY.weeklyHoursAvailable)*100)}%.`;
    return { response: r, tab: "overview" };
  }
  if (l.match(/invoice|billing|payment|overdue|who.*paid|collect/)) {
    const overdue = INVOICES.filter(i=>i.status==="overdue");
    const pending = INVOICES.filter(i=>i.status==="pending");
    const marchTotal = INVOICES.filter(i=>i.issued.startsWith("Mar")).reduce((s,i)=>s+i.total,0);
    return { response: `March invoices total $${marchTotal.toLocaleString()}. ${overdue.length} overdue: ${overdue.map(i=>`${i.client} — $${i.total.toLocaleString()} due ${i.due}`).join("; ")}. ${pending.length} pending payment.`, tab: "invoicing" };
  }
  if (l.match(/onboard|implementation|go.?live|uat|deploy/)) {
    return { response: ONBOARDING.map(o=>`${o.client}: ${o.daysToGoLive} days to go-live. Current phase: ${o.phases.find(p=>p.status==="in-progress")?.name || o.phases.find(p=>p.status==="upcoming")?.name}. Risks: ${o.risks.join("; ") || "None"}.`).join("\n\n"), tab: "onboarding" };
  }
  if (l.match(/profit|effective.*rate|margin.*client|cost.*client|which.*client.*best/)) {
    const active = CLIENTS.filter(c=>c.status==="active").map(c=>({...c, p: calcProfitability(c)})).sort((a,b)=>b.p.effectiveRate-a.p.effectiveRate);
    return { response: `Client profitability: ${active.map(c=>`${c.name}: $${Math.round(c.p.effectiveRate)}/hr effective rate, ${Math.round(c.p.margin)}% margin`).join(". ")}. Best: ${active[0].name}. Most room for improvement: ${active[active.length-1].name}.`, tab: "profitability" };
  }
  if (l.match(/prep.*call|prep.*meeting|prep.*discovery|prep.*raleigh|ready.*for/)) {
    const prospect = PIPELINE.find(p=>l.includes(p.practice.toLowerCase().split(" ")[0])) || PIPELINE.find(p=>p.stage==="discovery");
    if (prospect) {
      const tier = { 1: "$3,500", 2: "$6,500", 3: "$10,000+" }[prospect.tier];
      const weeklyAppts = prospect.providers * 25;
      const recovered = ((prospect.noShowBaseline - 8) / 100) * weeklyAppts;
      const annualRev = recovered * 65 * 52;
      return { response: `📋 PREP: ${prospect.practice}\n\n👥 ${prospect.providers} providers, ${prospect.specialty}\n🏥 EHR: ${prospect.ehr} — Difficulty ${prospect.ehrDifficulty}, timeline ${prospect.ehrTimeline}\n⚠️ ${prospect.ehrNotes}\n💰 Suggested: Tier ${prospect.tier} (${tier}/mo)\n📊 No-show baseline: ${prospect.noShowBaseline}% → target 8%\n💵 Projected annual revenue recovery: $${Math.round(annualRev).toLocaleString()}\n🎯 Payer mix: ${prospect.payer}`, tab: "salesprep" };
    }
    return { response: "Which prospect? I have Sunrise Family Medicine, Raleigh Women's Health, and Durham Community Health in discovery.", tab: null };
  }
  if (l.match(/weekly.*report|week.*summary|this.*week/)) { return { response: "Opening weekly report...", tab: "report" }; }
  if (l.match(/roi|return|value.*recover|impact/)) {
    const t = CLIENTS.reduce((s,c)=>s+calcClientROI(c).totalToDate,0);
    return { response: `Total recovered: $${Math.round(t).toLocaleString()}. ${CLIENTS.filter(c=>c.status==="active").map(c=>{const r=calcClientROI(c);return `${c.name}: $${Math.round(r.totalToDate).toLocaleString()} (${Math.round(r.roiPct)}% ROI)`;}).join(". ")}.`, tab: "roi" };
  }
  if (l.match(/pipeline|deals|prospect|sales|lead/)) {
    const stale = PIPELINE.filter(p=>p.daysInStage>5);
    return { response: `${PIPELINE.length} deals, $${PIPELINE.reduce((s,d)=>s+d.value,0).toLocaleString()}/mo.${stale.length?` Stale: ${stale.map(p=>`${p.practice} (${p.daysInStage}d in ${STAGE_LABELS[p.stage]})`).join(", ")}.`:""}`, tab: "pipeline" };
  }
  if (l.match(/client|health/)) { return { response: CLIENTS.map(c=>`${c.name}: ${c.status}, health ${c.healthScore}`).join(". "), tab: "clients" }; }
  if (l.match(/financ|revenue|mrr|cash|money/)) { return { response: `MRR $${FINANCIALS.mrr.toLocaleString()}, ARR $${FINANCIALS.arr.toLocaleString()}, Cash $${FINANCIALS.cashOnHand.toLocaleString()}, Net margin ${Math.round(((FINANCIALS.mrr-FINANCIALS.monthlyExpenses)/FINANCIALS.mrr)*100)}%.`, tab: "financials" }; }
  if (l.match(/task|todo|priority/)) { const h=TASKS.filter(t=>t.priority==="high"); return { response: `${TASKS.length} tasks, ${h.length} urgent: ${h.map(t=>`${t.text} (${t.due})`).join("; ")}.`, tab: "tasks" }; }
  if (l.match(/automat|make\.com|scenario|error/)) { const c=AUTOMATIONS.filter(a=>a.status==="critical"); return { response: `${AUTOMATIONS.length} automations. ${c.length?`CRITICAL: ${c.map(a=>`${a.client} ${a.name}`).join("; ")}.`:"All healthy."}`, tab: "automations" }; }
  if (l.match(/capacity|bandwidth|workload/)) { return { response: `${Math.round((CAPACITY.currentUtilization/CAPACITY.weeklyHoursAvailable)*100)}% — ${CAPACITY.weeklyHoursAvailable-CAPACITY.currentUtilization}h free.`, tab: "capacity" }; }
  if (l.match(/renewal|churn|retain/)) { return { response: CLIENTS.map(c=>{const d=Math.round((new Date(c.renewalDate)-Date.now())/864e5);return `${c.name}: ${d}d, health ${c.healthScore}${c.healthScore<70&&d<60?" ⚠️ AT RISK":""}`;}).join(". "), tab: "renewals" }; }
  if (l.match(/proposal|propose|quote/)) { return { response: "Opening proposal builder...", tab: "proposal" }; }
  if (l.match(/communi|contact|last.*talk/)) { return { response: "Opening communications log...", tab: "comms" }; }
  return { response: `Try: briefing, pipeline, clients, ROI, financials, tasks, automations, capacity, renewals, invoices, onboarding, profitability, "prep me for [prospect]", or "weekly report".`, tab: null };
}

// ═══════════════════════════════════════════════════════════════════════
// SHARED UI
// ═══════════════════════════════════════════════════════════════════════
const M = "var(--mono)";

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
    <div style={{ background:"rgba(255,255,255,0.025)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:12, padding:"16px 18px", display:"flex", flexDirection:"column", gap:5, animation:`fu 0.5s ease ${delay}ms both`, position:"relative", overflow:"hidden" }}>
      <div style={{ position:"absolute", bottom:4, right:12, opacity:0.5 }}><Spark data={spark} color={sparkColor} h={28} w={60}/></div>
      <span style={{ fontSize:10, fontWeight:600, color:"#6b7280", textTransform:"uppercase", letterSpacing:"0.08em", fontFamily:M }}>{label}</span>
      <span style={{ fontSize:24, fontWeight:700, color:"#f0f0f0", fontFamily:M, lineHeight:1 }}><AnimNum value={value} prefix={prefix} suffix={suffix}/></span>
      {change!==undefined&&<span style={{ fontSize:10, color:change>0?"#4ade80":"#f87171", fontFamily:M }}>{change>0?"▲":"▼"} {Math.abs(change)}%</span>}
    </div>
  );
}

function Panel({ title, subtitle, action, children, style:s }) {
  return (
    <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.05)", borderRadius:12, padding:"18px 20px", ...s }}>
      {(title||action)&&<div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:subtitle?4:14 }}><span style={{ fontSize:13, fontWeight:600, color:"#e5e7eb" }}>{title}</span>{action}</div>}
      {subtitle&&<div style={{ fontSize:10.5, color:"#6b7280", marginBottom:14, fontFamily:M }}>{subtitle}</div>}
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
      <span style={{ fontSize:10, color:"#6b7280", fontFamily:M, flexShrink:0 }}>{task.due}</span>
    </div>
  );
}

function RevChart({ data }) {
  const mx=Math.max(...data.map(d=>d.revenue));
  return (
    <div style={{ display:"flex", alignItems:"flex-end", gap:8, height:120, padding:"0 4px" }}>
      {data.map((d,i)=>(<div key={d.month} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4, animation:`fu 0.5s ease ${i*50}ms both` }}>
        <div style={{ display:"flex", alignItems:"flex-end", gap:2, height:100 }}>
          <div style={{ width:12, height:(d.revenue/mx)*90, borderRadius:"3px 3px 0 0", background:"linear-gradient(to top,#4f46e5,#818cf8)" }}/>
          <div style={{ width:8, height:(d.expenses/mx)*90, borderRadius:"3px 3px 0 0", background:"rgba(255,255,255,0.06)" }}/>
        </div>
        <span style={{ fontSize:9, color:"#6b7280", fontFamily:M }}>{d.month}</span>
      </div>))}
    </div>
  );
}

function PipelineBoard() {
  return (
    <div style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:8 }}>
      {STAGES.map(stg=>{
        const deals=PIPELINE.filter(d=>d.stage===stg); const c=STAGE_COLORS[stg];
        return (<div key={stg} style={{ minWidth:185, flex:"1 0 185px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:6, padding:"0 2px" }}>
            <span style={{ width:6, height:6, borderRadius:"50%", background:c.dot }}/><span style={{ fontSize:10, fontWeight:600, color:c.text, textTransform:"uppercase", letterSpacing:"0.05em", fontFamily:M }}>{STAGE_LABELS[stg]}</span>
            <span style={{ fontSize:9, color:"#6b7280", marginLeft:"auto", fontFamily:M }}>${deals.reduce((s,d)=>s+d.value,0).toLocaleString()}</span>
          </div>
          {deals.map(d=>(<div key={d.id} style={{ background:c.bg, border:`1px solid ${c.border}15`, borderRadius:9, padding:"10px 12px", marginBottom:6 }}>
            <div style={{ fontSize:12, fontWeight:600, color:"#e5e7eb" }}>{d.practice}</div>
            <div style={{ fontSize:10, color:"#9ca3af", marginTop:1 }}>{d.specialty} · {d.ehr}</div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:6 }}>
              <span style={{ fontSize:12, fontWeight:700, color:c.text, fontFamily:M }}>${d.value.toLocaleString()}/mo</span>
              <span style={{ fontSize:8, fontWeight:600, color:"#111", background:c.dot, borderRadius:4, padding:"1px 6px" }}>T{d.tier}</span>
            </div>
            <div style={{ fontSize:10, color:"#6b7280", marginTop:5 }}>→ {d.nextAction}</div>
            {d.daysInStage>5&&<div style={{ fontSize:9, color:"#f87171", marginTop:3, fontFamily:M }}>⚠ {d.daysInStage}d in stage</div>}
          </div>))}
        </div>);
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// FEATURE TABS
// ═══════════════════════════════════════════════════════════════════════

// INVOICING (Feature 8)
function InvoicingTab() {
  const marchInvs = INVOICES.filter(i=>i.issued.startsWith("Mar"));
  const totalBilled = marchInvs.reduce((s,i)=>s+i.total,0);
  const collected = marchInvs.filter(i=>i.status==="paid").reduce((s,i)=>s+i.total,0);
  const overdue = INVOICES.filter(i=>i.status==="overdue");
  const pending = INVOICES.filter(i=>i.status==="pending");
  const stColors = { paid:"#4ade80", pending:"#fbbf24", overdue:"#f87171" };
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
     <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><h2 style={{fontSize:17,fontWeight:700,color:"#f0f0f0"}}>Invoicing & Billing</h2><button onClick={()=>document.dispatchEvent(new CustomEvent("ic-show-form",{detail:"invoice"}))} style={{fontSize:11,fontWeight:600,color:"#a5b4fc",background:"rgba(99,102,241,0.1)",border:"1px solid rgba(99,102,241,0.2)",borderRadius:6,padding:"5px 12px",cursor:"pointer"}}>+ Add Invoice</button></div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12 }}>
        <KPI label="Mar Billed" value={totalBilled} prefix="$" spark={[17500,20000,22000,24000,27500,27635]} sparkColor="#818cf8"/>
        <KPI label="Collected" value={collected} prefix="$" spark={[11000,15000,18000,22000,24500,6548]} sparkColor="#4ade80" delay={60}/>
        <KPI label="Pending" value={pending.reduce((s,i)=>s+i.total,0)} prefix="$" spark={[8000,6000,4000,3000,5000,14532]} sparkColor="#fbbf24" delay={120}/>
        <KPI label="Overdue" value={overdue.reduce((s,i)=>s+i.total,0)} prefix="$" spark={[0,0,2000,0,0,6555]} sparkColor="#f87171" delay={180}/>
      </div>
      {overdue.length>0&&<div style={{ background:"rgba(248,113,113,0.06)", border:"1px solid rgba(248,113,113,0.12)", borderRadius:10, padding:"12px 16px" }}>
        <div style={{ fontSize:11, fontWeight:700, color:"#f87171", marginBottom:6, fontFamily:M }}>OVERDUE INVOICES</div>
        {overdue.map(i=><div key={i.id} style={{ fontSize:12, color:"#e5e7eb" }}><strong>{i.client}</strong> — {i.id} · ${i.total.toLocaleString()} · Due {i.due}</div>)}
      </div>}
      <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.05)", borderRadius:12, overflow:"hidden" }}>
        <div style={{ display:"grid", gridTemplateColumns:"1.2fr 1.8fr 1.2fr 0.8fr 0.8fr 0.8fr 0.8fr", gap:6, padding:"10px 16px", borderBottom:"1px solid rgba(255,255,255,0.06)", fontSize:9.5, fontWeight:600, color:"#6b7280", textTransform:"uppercase", fontFamily:M }}>
          <span>Invoice</span><span>Client</span><span>Type</span><span>Amount</span><span>Usage</span><span>Total</span><span>Status</span>
        </div>
        {INVOICES.map((inv,i)=>(
          <div key={inv.id} style={{ display:"grid", gridTemplateColumns:"1.2fr 1.8fr 1.2fr 0.8fr 0.8fr 0.8fr 0.8fr", gap:6, alignItems:"center", padding:"10px 16px", borderBottom:"1px solid rgba(255,255,255,0.03)", fontSize:12, animation:`fu 0.3s ease ${i*30}ms both` }}>
            <span style={{ fontFamily:M, color:"#9ca3af", fontSize:11 }}>{inv.id}</span>
            <span style={{ fontWeight:600, color:"#e5e7eb" }}>{inv.client}</span>
            <span style={{ fontSize:11, color:"#9ca3af" }}>{inv.type}</span>
            <span style={{ fontFamily:M, color:"#f0f0f0" }}>${inv.amount.toLocaleString()}</span>
            <span style={{ fontFamily:M, color:"#6b7280" }}>${inv.usageCost}</span>
            <span style={{ fontFamily:M, color:"#f0f0f0", fontWeight:600 }}>${inv.total.toLocaleString()}</span>
            <span style={{ fontSize:10, fontWeight:600, color:stColors[inv.status], textTransform:"uppercase" }}>{inv.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ONBOARDING TRACKER (Feature 9)
function OnboardingTab() {
  const phaseColors = { complete:"#4ade80", "in-progress":"#fbbf24", upcoming:"#4b5563" };
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      <h2 style={{ fontSize:17, fontWeight:700, color:"#f0f0f0" }}>Onboarding Tracker</h2>
      {ONBOARDING.map((proj,pi)=>(
        <Panel key={proj.id} title={proj.client} subtitle={`Tier ${proj.tier} · ${proj.ehr} · Go-live: ${proj.targetGoLive} (${proj.daysToGoLive}d)`}>
          <div style={{ display:"flex", gap:4, marginBottom:16 }}>
            {proj.phases.map((ph,i)=>(
              <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", gap:4 }}>
                <div style={{ height:6, borderRadius:3, background:ph.status==="complete"?"#4ade80":ph.status==="in-progress"?"linear-gradient(90deg,#fbbf24 60%,rgba(255,255,255,0.06) 60%)":"rgba(255,255,255,0.04)" }}/>
                <span style={{ fontSize:9, fontWeight:600, color:phaseColors[ph.status], fontFamily:M, textTransform:"uppercase" }}>{ph.name}</span>
                <span style={{ fontSize:9, color:"#6b7280" }}>{ph.start} – {ph.end}</span>
                {ph.notes&&<span style={{ fontSize:10, color:"#9ca3af", lineHeight:1.3 }}>{ph.notes}</span>}
              </div>
            ))}
          </div>
          {proj.risks.length>0&&<div style={{ padding:"10px 14px", background:"rgba(251,191,36,0.06)", border:"1px solid rgba(251,191,36,0.1)", borderRadius:8, marginBottom:8 }}>
            <div style={{ fontSize:10, fontWeight:600, color:"#fbbf24", fontFamily:M, marginBottom:4 }}>RISKS</div>
            {proj.risks.map((r,i)=><div key={i} style={{ fontSize:11, color:"#e5e7eb", marginBottom:2 }}>• {r}</div>)}
          </div>}
        </Panel>
      ))}
    </div>
  );
}

// PROFITABILITY (Feature 10)
function ProfitabilityTab() {
  const active = CLIENTS.filter(c=>c.status==="active").map(c=>({...c, p:calcProfitability(c)})).sort((a,b)=>b.p.effectiveRate-a.p.effectiveRate);
  const bestRate = Math.max(...active.map(c=>c.p.effectiveRate));
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      <h2 style={{ fontSize:17, fontWeight:700, color:"#f0f0f0" }}>Client Profitability</h2>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12 }}>
        <KPI label="Avg Effective Rate" value={Math.round(active.reduce((s,c)=>s+c.p.effectiveRate,0)/active.length)} prefix="$" suffix="/hr" spark={[120,140,155,165,175,180]} sparkColor="#4ade80"/>
        <KPI label="Avg Margin" value={Math.round(active.reduce((s,c)=>s+c.p.margin,0)/active.length)} suffix="%" spark={[60,65,68,70,72,74]} sparkColor="#818cf8" delay={80}/>
        <KPI label="Total Monthly Profit" value={Math.round(active.reduce((s,c)=>s+c.p.monthlyProfit,0))} prefix="$" spark={[8000,11000,14000,16000,18000,19000]} sparkColor="#fbbf24" delay={160}/>
      </div>
      {active.map((c,i)=>{
        const barW = c.p.effectiveRate > 0 ? (c.p.effectiveRate / bestRate) * 100 : 0;
        const rateColor = c.p.effectiveRate >= 200 ? "#4ade80" : c.p.effectiveRate >= 100 ? "#fbbf24" : "#f87171";
        return (
          <div key={c.id} style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.05)", borderRadius:10, padding:"16px 18px", animation:`fu 0.4s ease ${i*60}ms both` }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
              <div><span style={{ fontSize:13, fontWeight:600, color:"#e5e7eb" }}>{c.name}</span><span style={{ fontSize:11, color:"#6b7280", marginLeft:8 }}>Tier {c.tier} · {c.ehr}</span></div>
              <span style={{ fontSize:20, fontWeight:800, color:rateColor, fontFamily:M }}>${Math.round(c.p.effectiveRate)}<span style={{ fontSize:11, fontWeight:400 }}>/hr</span></span>
            </div>
            <div style={{ height:8, borderRadius:4, background:"rgba(255,255,255,0.04)", marginBottom:10 }}>
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
                <div key={j}><div style={{ fontSize:9, color:"#6b7280", fontFamily:M, textTransform:"uppercase" }}>{m.l}</div><div style={{ fontSize:13, fontWeight:600, color:m.cl, fontFamily:M, marginTop:2 }}>{m.v}</div></div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// SALES PREP (Feature 11)
function SalesPrepTab() {
  const [selected, setSelected] = useState(PIPELINE.find(p=>p.stage==="discovery") || PIPELINE[0]);
  const prospects = PIPELINE.filter(p=>p.stage!=="closed-won");
  const weeklyAppts = selected.providers * 25;
  const recovered = ((selected.noShowBaseline - 8) / 100) * weeklyAppts;
  const annualRev = recovered * 65 * 52;
  const annualStaff = 10 * 18 * 52 * 0.8;
  const tierPrice = { 1:3500, 2:6500, 3:10000 }[selected.tier];
  const roi = ((annualRev + annualStaff - tierPrice*12) / (tierPrice*12)) * 100;
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16, maxWidth:800 }}>
      <h2 style={{ fontSize:17, fontWeight:700, color:"#f0f0f0" }}>Sales Discovery Prep</h2>
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
            ].map((r,i)=>(<div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"4px 0", borderBottom:"1px solid rgba(255,255,255,0.03)" }}>
              <span style={{ fontSize:11.5, color:"#6b7280" }}>{r.l}</span>
              <span style={{ fontSize:11.5, fontWeight:600, color:"#e5e7eb" }}>{r.v}</span>
            </div>))}
          </div>
        </Panel>
        <Panel title="EHR Integration Intel">
          <div style={{ padding:"12px 14px", background:"rgba(0,0,0,0.2)", borderRadius:8, marginBottom:10 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
              <span style={{ fontSize:16, fontWeight:700, color:"#f0f0f0" }}>{selected.ehr}</span>
              <span style={{ fontSize:11, fontWeight:600, color:selected.ehrDifficulty.startsWith("2")?"#4ade80":selected.ehrDifficulty.startsWith("3")?"#fbbf24":"#fb923c", fontFamily:M }}>Difficulty {selected.ehrDifficulty}</span>
            </div>
            <div style={{ fontSize:11, color:"#9ca3af", lineHeight:1.5 }}>{selected.ehrNotes}</div>
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
          ].map((m,i)=>(<div key={i} style={{ padding:"10px 12px", background:"rgba(0,0,0,0.2)", borderRadius:8 }}>
            <div style={{ fontSize:9, color:"#6b7280", fontFamily:M, textTransform:"uppercase" }}>{m.l}</div>
            <div style={{ fontSize:18, fontWeight:700, color:m.c, fontFamily:M, margin:"3px 0 1px" }}>{m.v}</div>
            <div style={{ fontSize:10, color:"#6b7280" }}>{m.sub}</div>
          </div>))}
        </div>
      </Panel>
    </div>
  );
}

// WEEKLY REPORT (Feature 12)
function WeeklyReportTab() {
  const totalROI = CLIENTS.reduce((s,c)=>s+calcClientROI(c).totalToDate,0);
  const pipeVal = PIPELINE.reduce((s,d)=>s+d.value,0);
  const avgHealth = Math.round(CLIENTS.reduce((s,c)=>s+c.healthScore,0)/CLIENTS.length);
  const critAuto = AUTOMATIONS.filter(a=>a.status==="critical").length;
  const totalExecs = AUTOMATIONS.reduce((s,a)=>s+a.execsToday,0);
  const overdue = INVOICES.filter(i=>i.status==="overdue");
  const capPct = Math.round((CAPACITY.currentUtilization/CAPACITY.weeklyHoursAvailable)*100);

  const sections = [
    { title: "Revenue & Financial Health", items: [
      { l:"MRR", v:`$${FINANCIALS.mrr.toLocaleString()}`, c:"#818cf8" },
      { l:"Cash on Hand", v:`$${FINANCIALS.cashOnHand.toLocaleString()}`, c:"#4ade80" },
      { l:"A/R Outstanding", v:`$${FINANCIALS.accountsReceivable.toLocaleString()}`, c:"#fbbf24" },
      { l:"Net Margin", v:`${Math.round(((FINANCIALS.mrr-FINANCIALS.monthlyExpenses)/FINANCIALS.mrr)*100)}%`, c:"#4ade80" },
      { l:"Overdue Invoices", v:overdue.length > 0 ? `${overdue.length} ($${overdue.reduce((s,i)=>s+i.total,0).toLocaleString()})` : "None", c:overdue.length?"#f87171":"#4ade80" },
    ]},
    { title: "Pipeline & Sales", items: [
      { l:"Pipeline Deals", v:PIPELINE.length.toString(), c:"#818cf8" },
      { l:"Pipeline Value", v:`$${pipeVal.toLocaleString()}/mo`, c:"#fbbf24" },
      { l:"Stale Deals (>5d)", v:PIPELINE.filter(p=>p.daysInStage>5).length.toString(), c:PIPELINE.filter(p=>p.daysInStage>5).length?"#f87171":"#4ade80" },
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
        <div><h2 style={{ fontSize:17, fontWeight:700, color:"#f0f0f0" }}>Weekly Business Report</h2>
        <p style={{ fontSize:11, color:"#6b7280", marginTop:2, fontFamily:M }}>Week of March 2–8, 2026 · IC-BOS Weekly Digest</p></div>
      </div>
      {sections.map((sec,si)=>(
        <Panel key={si} title={sec.title}>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {sec.items.map((item,i)=>(
              <div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:"1px solid rgba(255,255,255,0.03)" }}>
                <span style={{ fontSize:12, color:"#9ca3af" }}>{item.l}</span>
                <span style={{ fontSize:12, fontWeight:600, color:item.c, fontFamily:M }}>{item.v}</span>
              </div>
            ))}
          </div>
        </Panel>
      ))}
      <Panel title="Key Actions for Next Week">
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {[
            "Follow up Fayetteville overdue invoice ($6,555)",
            "Asheville Cardiology UAT testing (Mar 15)",
            "Discovery call — Raleigh Women's Health (Epic integration scoping)",
            "Send Sunrise Family Medicine Tier 2 proposal",
            "Fix Fayetteville lab results routing (critical)",
            "Chapel Hill quarterly metrics + upsell discussion",
            "Coastal Dermatology kickoff prep (Mar 12)",
          ].map((a,i)=>(<div key={i} style={{ fontSize:12, color:"#e5e7eb", padding:"6px 0", borderBottom:"1px solid rgba(255,255,255,0.03)", display:"flex", gap:8 }}>
            <span style={{ color:"#818cf8", fontFamily:M, fontSize:10, flexShrink:0 }}>{String(i+1).padStart(2,"0")}</span>{a}
          </div>))}
        </div>
      </Panel>
    </div>
  );
}

// ROI Tab (Feature 1)
function ROITab() {
  const crs = CLIENTS.filter(c=>c.status==="active").map(c=>({...c,r:calcClientROI(c)}));
  const totalRec = crs.reduce((s,c)=>s+c.r.totalToDate,0);
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      <div style={{ textAlign:"center", padding:"20px 0 8px", animation:"fu 0.5s ease both" }}>
        <div style={{ fontSize:10, fontWeight:600, color:"#6b7280", textTransform:"uppercase", letterSpacing:"0.1em", fontFamily:M, marginBottom:6 }}>Total Client Value Recovered</div>
        <div style={{ fontSize:44, fontWeight:800, color:"#4ade80", fontFamily:M, lineHeight:1 }}><AnimNum value={Math.round(totalRec)} prefix="$" dur={1800}/></div>
      </div>
      {crs.map((c,i)=>(
        <Panel key={c.id} title={c.name} subtitle={`Tier ${c.tier} · ${c.r.moActive} months · ${c.ehr}`}>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, fontSize:12 }}>
            {[{ l:"No-Show", v:`${c.noShowBefore}%→${c.noShowCurrent}%`, c:"#4ade80" },{ l:"Recovered", v:`$${Math.round(c.r.totalToDate).toLocaleString()}`, c:"#fbbf24" },{ l:"Hours/wk Saved", v:`${c.weeklyHoursSaved}h`, c:"#38bdf8" },{ l:"ROI", v:`${Math.round(c.r.roiPct)}%`, c:c.r.roiPct>0?"#4ade80":"#f87171" }].map((m,j)=>(
              <div key={j} style={{ padding:"8px 10px", background:"rgba(0,0,0,0.2)", borderRadius:7 }}>
                <div style={{ fontSize:9, color:"#6b7280", fontFamily:M, textTransform:"uppercase" }}>{m.l}</div>
                <div style={{ fontSize:15, fontWeight:700, color:m.c, fontFamily:M, marginTop:2 }}>{m.v}</div>
              </div>
            ))}
          </div>
        </Panel>
      ))}
    </div>
  );
}

// Renewals Tab (Feature 2)
function RenewalsTab() {
  const sorted = [...CLIENTS].sort((a,b)=>new Date(a.renewalDate)-new Date(b.renewalDate));
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
      <h2 style={{ fontSize:17, fontWeight:700, color:"#f0f0f0" }}>Renewal Radar</h2>
      {sorted.map((c,i)=>{
        const d=Math.round((new Date(c.renewalDate)-Date.now())/864e5); const risk=c.healthScore<70&&d<60; const soon=d<=90;
        const bc=risk?"#f87171":soon?"#fbbf24":"#4ade80"; const bw=Math.max(5,Math.min(100,(1-d/365)*100));
        return (<div key={c.id} style={{ background:risk?"rgba(248,113,113,0.05)":"rgba(255,255,255,0.02)", border:`1px solid ${risk?"rgba(248,113,113,0.12)":"rgba(255,255,255,0.05)"}`, borderRadius:10, padding:"14px 18px", animation:`fu 0.4s ease ${i*60}ms both` }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
            <div><span style={{ fontSize:13, fontWeight:600, color:"#e5e7eb" }}>{c.name}</span><span style={{ fontSize:10.5, color:"#6b7280", marginLeft:8 }}>Tier {c.tier} · ${c.monthlyFee.toLocaleString()}/mo</span></div>
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>{risk&&<span style={{ fontSize:9, fontWeight:700, color:"#f87171", background:"rgba(248,113,113,0.12)", padding:"2px 8px", borderRadius:5, fontFamily:M }}>AT RISK</span>}<span style={{ fontSize:11, fontWeight:600, color:bc, fontFamily:M }}>{d}d</span></div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:6 }}>
            <div style={{ flex:1, height:5, borderRadius:3, background:"rgba(255,255,255,0.04)" }}><div style={{ height:"100%", borderRadius:3, background:bc, width:`${bw}%` }}/></div>
            <span style={{ fontSize:10, color:"#9ca3af", fontFamily:M }}>{c.renewalDate}</span>
          </div>
          <div style={{ display:"flex", gap:14, fontSize:10.5, color:"#9ca3af" }}>
            <span>Health: <span style={{ color:c.healthScore>=80?"#4ade80":c.healthScore>=70?"#fbbf24":"#f87171", fontWeight:600 }}>{c.healthScore}</span></span>
            <span>No-Show: <span style={{ fontWeight:600, color:"#f0f0f0" }}>{c.noShowCurrent}%</span></span>
            <span>ARR: <span style={{ fontWeight:600, color:"#f0f0f0" }}>${(c.monthlyFee*12).toLocaleString()}</span></span>
          </div>
        </div>);
      })}
    </div>
  );
}

// Proposal Builder (Feature 3) — Full service catalog
function ProposalTab() {
  const [mode, setMode] = useState("managed"); // managed | individual | mixed
  const [pid, setPid] = useState(PIPELINE[0].id);
  const [tier, setTier] = useState(2);
  const [selectedServices, setSelectedServices] = useState([]);
  const [selectedAddOns, setSelectedAddOns] = useState([]);

  const prospect = PIPELINE.find(p=>p.id===pid) || PIPELINE[0];

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

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
      <h2 style={{ fontSize:17, fontWeight:700, color:"#f0f0f0" }}>Proposal Builder</h2>

      {/* Prospect selector */}
      <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
        {PIPELINE.filter(p=>p.stage!=="closed-won").map(p=><Chip key={p.id} active={pid===p.id} onClick={()=>setPid(p.id)}>{p.practice}</Chip>)}
      </div>

      {/* Engagement type */}
      <div style={{ display:"flex", gap:6 }}>
        {[{id:"managed",l:"Managed Package",d:"Monthly retainer"},{id:"individual",l:"Individual Services",d:"One-time / project"},{id:"mixed",l:"Package + Services",d:"Best of both"}].map(m=>(
          <button key={m.id} onClick={()=>setMode(m.id)} style={{ flex:1, padding:"10px 14px", borderRadius:8, border:`1px solid ${mode===m.id?"#6366f1":"rgba(255,255,255,0.06)"}`, background:mode===m.id?"rgba(99,102,241,0.08)":"rgba(255,255,255,0.02)", cursor:"pointer", textAlign:"left" }}>
            <div style={{ fontSize:12, fontWeight:600, color:mode===m.id?"#a5b4fc":"#9ca3af" }}>{m.l}</div>
            <div style={{ fontSize:10, color:"#6b7280", marginTop:2 }}>{m.d}</div>
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
                <div style={{ fontSize:9.5, color:"#6b7280", marginTop:2 }}>{managedTiers[n].desc}</div>
              </button>
            ))}
          </div>
          <div style={{ fontSize:11, color:"#9ca3af", lineHeight:1.5, padding:"10px 12px", background:"rgba(0,0,0,0.15)", borderRadius:7 }}>
            <span style={{ fontWeight:600, color:"#e5e7eb" }}>Includes: </span>{managedTiers[tier].includes}
          </div>
          {/* Web App Add-Ons */}
          <div style={{ marginTop:12 }}>
            <div style={{ fontSize:11, fontWeight:600, color:"#e5e7eb", marginBottom:8 }}>Web App Add-Ons {tier===3&&<span style={{ color:"#4ade80", fontWeight:400 }}>— included in Tier 3</span>}</div>
            {tier < 3 && <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:6 }}>
              {webAppAddOns.map(ao=>{
                const active = selectedAddOns.includes(ao.id);
                return (<button key={ao.id} onClick={()=>toggleAddOn(ao.id)} style={{ padding:"8px 10px", borderRadius:7, border:`1px solid ${active?"#6366f1":"rgba(255,255,255,0.05)"}`, background:active?"rgba(99,102,241,0.08)":"rgba(255,255,255,0.015)", cursor:"pointer", textAlign:"left", transition:"all 0.15s" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <span style={{ fontSize:11, fontWeight:active?600:400, color:active?"#a5b4fc":"#9ca3af" }}>{ao.name}</span>
                    <span style={{ width:14, height:14, borderRadius:4, border:`2px solid ${active?"#6366f1":"rgba(255,255,255,0.12)"}`, background:active?"#6366f1":"transparent", display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, color:"white" }}>{active&&"✓"}</span>
                  </div>
                  <div style={{ fontSize:10, color:"#6b7280", fontFamily:M, marginTop:3 }}>{ao.priceRange} + ${ao.monthly}/mo</div>
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
                <div style={{ fontSize:12, fontWeight:600, color:"#e5e7eb", marginBottom:5 }}>
                  {svc.name}
                  <span style={{ fontSize:10, color:"#6b7280", fontWeight:400, marginLeft:6 }}>{svc.type==="one-time"?"One-time":svc.type==="project"?"Project (30/40/30)":"Recurring"}</span>
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
            <div style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
              <span style={{ fontSize:12, color:"#9ca3af" }}>Managed — Tier {tier}: {managedTiers[tier].n}</span>
              <span style={{ fontSize:12, fontWeight:600, color:"#818cf8", fontFamily:M }}>${managedTiers[tier].p.toLocaleString()}/mo</span>
            </div>
          )}
          {selectedAddOns.map(id=>{const ao=webAppAddOns.find(a=>a.id===id);return ao&&(
            <div key={id} style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
              <span style={{ fontSize:12, color:"#9ca3af" }}>Add-On: {ao.name}</span>
              <span style={{ fontSize:12, color:"#f0f0f0", fontFamily:M }}>${ao.price.toLocaleString()} + ${ao.monthly}/mo</span>
            </div>
          );})}
          {selectedServices.map(sel=>{const svc=individualServices.find(x=>x.id===sel.svcId);const opt=svc?.options[sel.optIdx];return opt&&(
            <div key={sel.key} style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
              <span style={{ fontSize:12, color:"#9ca3af" }}>{svc.name}: {opt.n}</span>
              <span style={{ fontSize:12, color:"#f0f0f0", fontFamily:M }}>${opt.p.toLocaleString()}</span>
            </div>
          );})}
          {bundleDiscount > 0 && (
            <div style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
              <span style={{ fontSize:12, color:"#4ade80" }}>Bundle Discount (10% — 2+ individual services)</span>
              <span style={{ fontSize:12, fontWeight:600, color:"#4ade80", fontFamily:M }}>-${bundleDiscount.toLocaleString()}</span>
            </div>
          )}
          {onboardingCredit > 0 && (
            <div style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
              <span style={{ fontSize:12, color:"#4ade80" }}>Onboarding Credit (individual → managed)</span>
              <span style={{ fontSize:12, fontWeight:600, color:"#4ade80", fontFamily:M }}>-$500</span>
            </div>
          )}
        </div>
        {/* Totals */}
        <div style={{ display:"grid", gridTemplateColumns:totalMonthly>0?"repeat(3,1fr)":"repeat(2,1fr)", gap:10, marginTop:14, padding:"14px", background:"rgba(0,0,0,0.25)", borderRadius:8 }}>
          {totalOneTime > 0 && <div><div style={{ fontSize:9, color:"#6b7280", fontFamily:M, textTransform:"uppercase" }}>One-Time / Project</div><div style={{ fontSize:22, fontWeight:800, color:"#f0f0f0", fontFamily:M, marginTop:2 }}>${totalOneTime.toLocaleString()}</div></div>}
          {totalMonthly > 0 && <div><div style={{ fontSize:9, color:"#6b7280", fontFamily:M, textTransform:"uppercase" }}>Monthly Recurring</div><div style={{ fontSize:22, fontWeight:800, color:"#818cf8", fontFamily:M, marginTop:2 }}>${totalMonthly.toLocaleString()}<span style={{fontSize:11}}>/mo</span></div></div>}
          <div><div style={{ fontSize:9, color:"#6b7280", fontFamily:M, textTransform:"uppercase" }}>Year 1 Total</div><div style={{ fontSize:22, fontWeight:800, color:"#fbbf24", fontFamily:M, marginTop:2 }}>${totalYear1.toLocaleString()}</div></div>
        </div>
      </Panel>

      {/* ROI (for managed/mixed) */}
      {mode !== "individual" && (
        <div style={{ display:"flex", gap:10, padding:"12px 14px", background:roi>0?"rgba(74,222,128,0.04)":"rgba(248,113,113,0.04)", borderRadius:8, border:`1px solid ${roi>0?"rgba(74,222,128,0.08)":"rgba(248,113,113,0.08)"}` }}>
          <div style={{ flex:1 }}><div style={{ fontSize:9, color:"#6b7280", fontFamily:M }}>PROJ. REVENUE RECOVERED/YR</div><div style={{ fontSize:18, fontWeight:700, color:"#4ade80", fontFamily:M, marginTop:2 }}>${Math.round(aRev).toLocaleString()}</div><div style={{ fontSize:9, color:"#6b7280" }}>{Math.round(rec)} appts/wk × $65</div></div>
          <div style={{ flex:1 }}><div style={{ fontSize:9, color:"#6b7280", fontFamily:M }}>STAFF SAVINGS/YR</div><div style={{ fontSize:18, fontWeight:700, color:"#38bdf8", fontFamily:M, marginTop:2 }}>${Math.round(aStaff).toLocaleString()}</div><div style={{ fontSize:9, color:"#6b7280" }}>~10h/wk × $18/hr</div></div>
          <div style={{ flex:1 }}><div style={{ fontSize:9, color:"#6b7280", fontFamily:M }}>YEAR 1 ROI</div><div style={{ fontSize:18, fontWeight:700, color:roi>0?"#4ade80":"#f87171", fontFamily:M, marginTop:2 }}>{Math.round(roi)}%</div></div>
          <div style={{ flex:1 }}><div style={{ fontSize:9, color:"#6b7280", fontFamily:M }}>3-YEAR NET BENEFIT</div><div style={{ fontSize:18, fontWeight:700, color:"#fbbf24", fontFamily:M, marginTop:2 }}>${Math.round((aBen*3)-(totalYear1+(totalMonthly*24))).toLocaleString()}</div></div>
        </div>
      )}

      {/* Payment terms note */}
      <div style={{ fontSize:10.5, color:"#6b7280", lineHeight:1.5, padding:"10px 14px", background:"rgba(255,255,255,0.015)", borderRadius:7 }}>
        <span style={{ fontWeight:600, color:"#9ca3af" }}>Payment Terms: </span>
        {mode === "managed" && "Monthly subscription, billed on the 1st. No long-term contract — cancel anytime with 30 days notice."}
        {mode === "individual" && "One-time/project services: 30% at start / 40% at midpoint / 30% upon completion. Flat-fee services paid upfront."}
        {mode === "mixed" && "Package: monthly billing. Individual services: 30/40/30 or flat fee. $500 onboarding credit applied when enrolling in managed tier."}
        {uniqueSvcTypes.length >= 2 && " 10% bundle discount applied for engaging 2+ individual services in the same quarter."}
      </div>
    </div>
  );
}

// Automations Tab (Feature 4)
function AutoTab() {
  const stc={healthy:"#4ade80",warning:"#fbbf24",critical:"#f87171"};
  const crit=AUTOMATIONS.filter(a=>a.status==="critical");
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
      <h2 style={{ fontSize:17, fontWeight:700, color:"#f0f0f0" }}>Automation Health</h2>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12 }}>
        <KPI label="Automations" value={AUTOMATIONS.length} spark={[4,5,5,6,7,7]} sparkColor="#818cf8"/>
        <KPI label="Execs Today" value={AUTOMATIONS.reduce((s,a)=>s+a.execsToday,0)} spark={[320,410,480,530,560,569]} sparkColor="#4ade80" delay={60}/>
        <KPI label="Cost Today" value={Math.round(AUTOMATIONS.reduce((s,a)=>s+a.costToday,0)*100)/100} prefix="$" spark={[12,14,16,17,18,19]} sparkColor="#fbbf24" delay={120}/>
        <KPI label="Errors 24h" value={AUTOMATIONS.reduce((s,a)=>s+a.errors24h,0)} spark={[2,1,3,0,1,9]} sparkColor={crit.length?"#f87171":"#4ade80"} delay={180}/>
      </div>
      {crit.length>0&&<div style={{ background:"rgba(248,113,113,0.06)", border:"1px solid rgba(248,113,113,0.12)", borderRadius:10, padding:"12px 16px" }}>
        <div style={{ fontSize:10, fontWeight:700, color:"#f87171", fontFamily:M, marginBottom:6 }}>⚠ CRITICAL</div>
        {crit.map(a=><div key={a.id} style={{ fontSize:12, color:"#e5e7eb" }}><strong>{a.client}</strong> → {a.name}: {a.successRate}% success</div>)}
      </div>}
      {AUTOMATIONS.map((a,i)=>(<div key={a.id} style={{ display:"grid", gridTemplateColumns:"2fr 1fr 0.7fr 0.7fr 0.7fr 0.5fr", alignItems:"center", gap:6, padding:"10px 16px", background:"rgba(255,255,255,0.02)", border:`1px solid ${a.status==="critical"?"rgba(248,113,113,0.1)":"rgba(255,255,255,0.04)"}`, borderRadius:8, animation:`fu 0.3s ease ${i*40}ms both`, fontSize:12 }}>
        <div><div style={{ fontWeight:600, color:"#e5e7eb" }}>{a.client}</div><div style={{ fontSize:10, color:"#6b7280" }}>{a.name}</div></div>
        <div style={{ display:"flex", alignItems:"center", gap:5 }}><span style={{ width:6, height:6, borderRadius:"50%", background:stc[a.status] }}/><span style={{ color:stc[a.status], fontSize:10, fontWeight:600, textTransform:"uppercase" }}>{a.status}</span></div>
        <span style={{ fontFamily:M, color:"#f0f0f0" }}>{a.successRate}%</span>
        <span style={{ fontFamily:M, color:"#f0f0f0" }}>{a.execsToday}</span>
        <span style={{ fontFamily:M, color:"#f0f0f0" }}>${a.costToday.toFixed(2)}</span>
        <span style={{ fontSize:10, color:"#6b7280" }}>{a.lastRun}</span>
      </div>))}
    </div>
  );
}

// Capacity Tab (Feature 5) — Team-aware with hiring forecaster
function CapTab() {
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
        <text x="75" y="72" textAnchor="middle" fill="#f0f0f0" fontSize="24" fontWeight="800" fontFamily="var(--mono)">{p}%</text>
        {label && <text x="75" y="90" textAnchor="middle" fill="#6b7280" fontSize="9" fontFamily="var(--mono)">{label}</text>}
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
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Name" style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.3)", color: "#e5e7eb", fontSize: 12, fontFamily: "inherit", outline: "none" }} />
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 3 }}>Role</div>
              <select value={newRole} onChange={e => setNewRole(e.target.value)} style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.3)", color: "#e5e7eb", fontSize: 12, fontFamily: "inherit", outline: "none" }}>
                <option value="Consultant">Consultant</option>
                <option value="Jr. Consultant">Jr. Consultant</option>
                <option value="Contractor">Contractor</option>
                <option value="Specialist">Specialist</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 3 }}>Hours/wk</div>
              <input type="number" value={newHours} onChange={e => setNewHours(Number(e.target.value))} style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.3)", color: "#e5e7eb", fontSize: 12, fontFamily: "var(--mono)", outline: "none" }} />
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 3 }}>$/month</div>
              <input type="number" value={newCost} onChange={e => setNewCost(Number(e.target.value))} style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.3)", color: "#e5e7eb", fontSize: 12, fontFamily: "var(--mono)", outline: "none" }} />
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
              <div key={t.id} style={{ padding: "12px 0", borderBottom: ti < team.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none", animation: `fu 0.3s ease ${ti * 60}ms both` }}>
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
              return (<div key={i} style={{ padding: "8px 10px", background: "rgba(0,0,0,0.2)", borderRadius: 6, marginBottom: 5, border: `1px solid ${!fits ? "rgba(248,113,113,0.1)" : "rgba(255,255,255,0.03)"}` }}>
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

// Comms Tab (Feature 7)
function CommsTab() {
  const all=CLIENTS.flatMap(c=>c.contactLog.map(l=>({...l,client:c.name}))).sort((a,b)=>new Date(b.date)-new Date(a.date));
  const tc={email:"#38bdf8",call:"#4ade80",meeting:"#c084fc",sms:"#fbbf24"};
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:14, maxWidth:680 }}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><h2 style={{fontSize:17,fontWeight:700,color:"#f0f0f0"}}>Communication Log</h2><button onClick={()=>document.dispatchEvent(new CustomEvent("ic-show-form",{detail:"comm"}))} style={{fontSize:11,fontWeight:600,color:"#a5b4fc",background:"rgba(99,102,241,0.1)",border:"1px solid rgba(99,102,241,0.2)",borderRadius:6,padding:"5px 12px",cursor:"pointer"}}>+ Log Comms</button></div>
      <div style={{ position:"relative", paddingLeft:20 }}>
        <div style={{ position:"absolute", left:6, top:0, bottom:0, width:2, background:"rgba(255,255,255,0.04)" }}/>
        {all.map((c,i)=>(<div key={i} style={{ position:"relative", marginBottom:10, animation:`fu 0.3s ease ${i*30}ms both` }}>
          <div style={{ position:"absolute", left:-17, top:3, width:12, height:12, borderRadius:"50%", background:tc[c.type], border:"2px solid #0a0a0f" }}/>
          <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.04)", borderRadius:8, padding:"8px 14px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}><span style={{ fontSize:12, fontWeight:600, color:"#e5e7eb" }}>{c.client}</span><span style={{ fontSize:10, color:"#6b7280", fontFamily:M }}>{c.date}</span></div>
            <div style={{ display:"flex", alignItems:"center", gap:5 }}><span style={{ fontSize:9, color:tc[c.type], fontWeight:600, textTransform:"uppercase", fontFamily:M }}>{c.type}</span><span style={{ fontSize:11, color:"#9ca3af" }}>{c.note}</span></div>
          </div>
        </div>))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════
export default function ICBOS() {
  const [tab, setTab] = useState("overview");
  const [showForm, setShowForm] = useState(null); // 'client'|'deal'|'task'|'invoice'|'comm'
  const [showPulsePopover, setShowPulsePopover] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const [dismissedNotifs, setDismissedNotifs] = useState([]);
  useEffect(()=>{const h=(e)=>setShowForm(e.detail);document.addEventListener("ic-show-form",h);return()=>document.removeEventListener("ic-show-form",h);},[]);
  const tabs = [
   { id:"overview", l:"Overview" }, { id:"agents", l:"Agents" }, { id:"pipeline", l:"Pipeline" },
    { id:"roi", l:"ROI" }, { id:"financials", l:"Financials" }, { id:"invoicing", l:"Invoicing" },
    { id:"automations", l:"Automations" }, { id:"onboarding", l:"Onboarding" },
    { id:"capacity", l:"Capacity" }, { id:"profitability", l:"Profitability" },
    { id:"renewals", l:"Renewals" }, { id:"proposal", l:"Proposals" },
    { id:"salesprep", l:"Sales Prep" }, { id:"tasks", l:"Tasks" },
    { id:"comms", l:"Comms" }, { id:"report", l:"Report" },
  ];

  const totalROI = useMemo(()=>CLIENTS.reduce((s,c)=>s+calcClientROI(c).totalToDate,0),[]);
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

  return (
    <div style={{ minHeight:"100vh", background:"#0a0a0f", color:"#e5e7eb", fontFamily:"'Inter',-apple-system,sans-serif", "--mono":"'JetBrains Mono',monospace" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
        @keyframes fu{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pr{0%{transform:scale(1);opacity:.5}100%{transform:scale(1.3);opacity:0}}
        *{box-sizing:border-box;margin:0;padding:0;scrollbar-width:thin;scrollbar-color:#1f2937 transparent}
        ::-webkit-scrollbar{width:5px;height:5px}::-webkit-scrollbar-thumb{background:#1f2937;border-radius:3px}
        button{font-family:inherit}
      `}</style>

      <div style={{ position:"fixed", inset:0, zIndex:0, pointerEvents:"none", background:"radial-gradient(ellipse at 15% 0%,rgba(99,102,241,0.04) 0%,transparent 55%),radial-gradient(ellipse at 85% 100%,rgba(139,92,246,0.03) 0%,transparent 45%)" }}/>

      {/* Header */}
      <header style={{ position:"sticky", top:0, zIndex:50, display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 24px", background:"rgba(10,10,15,0.9)", backdropFilter:"blur(20px)", borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, position:"relative" }}>

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
              <div style={{ position:"absolute", top:36, right:0, width:220, background:"#111118", border:"1px solid rgba(255,255,255,0.08)", borderRadius:10, padding:"12px 14px", zIndex:200, boxShadow:"0 8px 32px rgba(0,0,0,0.5)", animation:"fu 0.15s ease both" }}>
                <div style={{ fontSize:10, fontWeight:700, color:"#6b7280", textTransform:"uppercase", letterSpacing:"0.08em", fontFamily:M, marginBottom:8 }}>Agent Pulse</div>
                {isAnyAgentRunning ? (
                  runningAgents.map(name => (
                    <div key={name} style={{ display:"flex", alignItems:"center", gap:7, marginBottom:6 }}>
                      <span style={{ width:7, height:7, borderRadius:"50%", background:"#38bdf8", flexShrink:0, animation:"pr 1.2s ease-out infinite" }}/>
                      <span style={{ fontSize:11, color:"#7dd3fc" }}>{name}</span>
                    </div>
                  ))
                ) : (
                  <div style={{ fontSize:11, color:"#4b5563", display:"flex", alignItems:"center", gap:6 }}>
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
                <span style={{ position:"absolute", top:-3, right:-3, minWidth:14, height:14, borderRadius:7, background:"#f87171", border:"2px solid #0a0a0f", fontSize:8, fontWeight:800, color:"white", fontFamily:M, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 2px" }}>
                  {unreadCount}
                </span>
              )}
            </button>
            {showNotifs && (
              <div style={{ position:"absolute", top:36, right:0, width:300, background:"#111118", border:"1px solid rgba(255,255,255,0.08)", borderRadius:10, zIndex:200, boxShadow:"0 8px 32px rgba(0,0,0,0.5)", animation:"fu 0.15s ease both", overflow:"hidden" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 14px 8px", borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
                  <span style={{ fontSize:11, fontWeight:700, color:"#e5e7eb" }}>Notifications</span>
                  {allNotifs.length > 0 && (
                    <button onClick={() => setDismissedNotifs(prev => [...prev, ...allNotifs.map(n => n.id)])} style={{ fontSize:9, color:"#6b7280", background:"transparent", border:"none", cursor:"pointer" }}>Clear all</button>
                  )}
                </div>
                <div style={{ maxHeight:320, overflowY:"auto" }}>
                  {allNotifs.length === 0 ? (
                    <div style={{ padding:"20px 14px", fontSize:11, color:"#4b5563", textAlign:"center" }}>No new notifications</div>
                  ) : (
                    allNotifs.map(n => (
                      <div key={n.id} style={{ display:"flex", alignItems:"flex-start", gap:9, padding:"10px 14px", borderBottom:"1px solid rgba(255,255,255,0.03)", cursor:"pointer" }}
                        onClick={() => { setTab(n.tab); setShowNotifs(false); }}
                        onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.03)"}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                      >
                        <span style={{ fontSize:14, flexShrink:0, marginTop:1 }}>{n.icon}</span>
                        <span style={{ fontSize:11, color:"#9ca3af", flex:1, lineHeight:1.4 }}>{n.text}</span>
                        <button
                          onClick={e => { e.stopPropagation(); setDismissedNotifs(prev => [...prev, n.id]); }}
                          style={{ fontSize:12, color:"#4b5563", background:"transparent", border:"none", cursor:"pointer", flexShrink:0, padding:"0 2px" }}
                        >×</button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Sign Out */}
          <button onClick={async () => { await supabase.auth.signOut(); window.location.reload(); }} style={{ fontSize:10, color:"#9ca3af", background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:6, padding:"4px 10px", cursor:"pointer" }}>Sign Out</button>

        </div>
        <nav style={{ display:"flex", gap:1, flexWrap:"wrap", justifyContent:"center", maxWidth:820 }}>
          {tabs.map(t=>(<button key={t.id} onClick={()=>setTab(t.id)} style={{ padding:"5px 9px", borderRadius:6, border:"none", cursor:"pointer", fontSize:10.5, fontWeight:500, background:tab===t.id?"rgba(99,102,241,0.15)":"transparent", color:tab===t.id?"#a5b4fc":"#6b7280", transition:"all 0.15s", position:"relative" }}>
            {t.l}
            {t.id==="automations"&&critCount>0&&<span style={{ position:"absolute", top:2, right:2, width:5, height:5, borderRadius:"50%", background:"#f87171" }}/>}
            {t.id==="invoicing"&&overdueInvs.length>0&&<span style={{ position:"absolute", top:2, right:2, width:5, height:5, borderRadius:"50%", background:"#f87171" }}/>}
          </button>))}
        </nav>
       <div style={{ display:"flex", alignItems:"center", gap:10, position:"relative" }}>
          <span style={{ fontSize:9, color:"#4ade80", fontFamily:M, display:"flex", alignItems:"center", gap:4 }}><span style={{ width:4, height:4, borderRadius:"50%", background:"#4ade80" }}/>LIVE</span>
          <div style={{ position:"relative" }}>
            <button onClick={()=>{ setShowPulsePopover(p=>!p); setShowNotifs(false); }} style={{ width:28, height:28, borderRadius:"50%", border:`1px solid ${isAnyAgentRunning?"rgba(56,189,248,0.3)":"rgba(255,255,255,0.08)"}`, background:isAnyAgentRunning?"rgba(56,189,248,0.1)":"rgba(255,255,255,0.04)", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", position:"relative" }}>
              <span style={{ width:8, height:8, borderRadius:"50%", background:isAnyAgentRunning?"#38bdf8":"#4b5563", display:"block" }}/>
              {isAnyAgentRunning&&<span style={{ position:"absolute", width:14, height:14, borderRadius:"50%", background:"rgba(56,189,248,0.3)", animation:"pr 1.2s ease-out infinite" }}/>}
            </button>
            {showPulsePopover&&(
              <div style={{ position:"absolute", top:36, right:0, width:220, background:"#111118", border:"1px solid rgba(255,255,255,0.08)", borderRadius:10, padding:"12px 14px", zIndex:200, boxShadow:"0 8px 32px rgba(0,0,0,0.5)", animation:"fu 0.15s ease both" }}>
                <div style={{ fontSize:10, fontWeight:700, color:"#6b7280", textTransform:"uppercase", letterSpacing:"0.08em", fontFamily:M, marginBottom:8 }}>Agent Pulse</div>
                {isAnyAgentRunning ? runningAgents.map(name=>(<div key={name} style={{ display:"flex", alignItems:"center", gap:7, marginBottom:6 }}><span style={{ width:7, height:7, borderRadius:"50%", background:"#38bdf8", flexShrink:0, animation:"pr 1.2s ease-out infinite" }}/><span style={{ fontSize:11, color:"#7dd3fc" }}>{name}</span></div>)) : <div style={{ fontSize:11, color:"#4b5563", display:"flex", alignItems:"center", gap:6 }}><span style={{ width:7, height:7, borderRadius:"50%", background:"#374151", flexShrink:0 }}/>All agents idle</div>}
                <button onClick={()=>{ setTab("agents"); setShowPulsePopover(false); }} style={{ marginTop:10, fontSize:10, color:"#818cf8", background:"rgba(99,102,241,0.08)", border:"1px solid rgba(99,102,241,0.12)", borderRadius:6, padding:"4px 10px", cursor:"pointer", width:"100%" }}>Open Agents Tab →</button>
              </div>
            )}
          </div>
          <div style={{ position:"relative" }}>
            <button onClick={()=>{ setShowNotifs(p=>!p); setShowPulsePopover(false); }} style={{ width:28, height:28, borderRadius:"50%", border:`1px solid ${unreadCount>0?"rgba(251,191,36,0.25)":"rgba(255,255,255,0.08)"}`, background:unreadCount>0?"rgba(251,191,36,0.06)":"rgba(255,255,255,0.04)", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, position:"relative" }}>
              🔔
              {unreadCount>0&&<span style={{ position:"absolute", top:-3, right:-3, minWidth:14, height:14, borderRadius:7, background:"#f87171", border:"2px solid #0a0a0f", fontSize:8, fontWeight:800, color:"white", fontFamily:M, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 2px" }}>{unreadCount}</span>}
            </button>
            {showNotifs&&(
              <div style={{ position:"absolute", top:36, right:-60, width:300, background:"#111118", border:"1px solid rgba(255,255,255,0.08)", borderRadius:10, zIndex:200, boxShadow:"0 8px 32px rgba(0,0,0,0.5)", animation:"fu 0.15s ease both", overflow:"hidden" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 14px 8px", borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
                  <span style={{ fontSize:11, fontWeight:700, color:"#e5e7eb" }}>Notifications</span>
                  {allNotifs.length>0&&<button onClick={()=>setDismissedNotifs(prev=>[...prev,...allNotifs.map(n=>n.id)])} style={{ fontSize:9, color:"#6b7280", background:"transparent", border:"none", cursor:"pointer" }}>Clear all</button>}
                </div>
                <div style={{ maxHeight:320, overflowY:"auto" }}>
                  {allNotifs.length===0 ? <div style={{ padding:"20px 14px", fontSize:11, color:"#4b5563", textAlign:"center" }}>No new notifications</div> : allNotifs.map(n=>(
                    <div key={n.id} style={{ display:"flex", alignItems:"flex-start", gap:9, padding:"10px 14px", borderBottom:"1px solid rgba(255,255,255,0.03)", cursor:"pointer" }}
                      onClick={()=>{ setTab(n.tab); setShowNotifs(false); }}
                      onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.03)"}
                      onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                    >
                      <span style={{ fontSize:14, flexShrink:0, marginTop:1 }}>{n.icon}</span>
                      <span style={{ fontSize:11, color:"#9ca3af", flex:1, lineHeight:1.4 }}>{n.text}</span>
                      <button onClick={e=>{ e.stopPropagation(); setDismissedNotifs(prev=>[...prev,n.id]); }} style={{ fontSize:12, color:"#4b5563", background:"transparent", border:"none", cursor:"pointer", flexShrink:0, padding:"0 2px" }}>×</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <button onClick={async()=>{ await supabase.auth.signOut(); window.location.reload(); }} style={{ fontSize:10, color:"#9ca3af", background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:6, padding:"4px 10px", cursor:"pointer" }}>Sign Out</button>
        </div>
      </header>

      {/* Main */}
      <main style={{ padding:"18px 24px 108px", position:"relative", zIndex:1 }}>
        {tab==="overview"&&(
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            {/* ROI Banner */}
            <div style={{ background:"linear-gradient(135deg,rgba(74,222,128,0.05),rgba(56,189,248,0.03))", border:"1px solid rgba(74,222,128,0.08)", borderRadius:12, padding:"14px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", animation:"fu 0.5s ease both" }}>
              <div><div style={{ fontSize:9, fontWeight:600, color:"#6b7280", textTransform:"uppercase", letterSpacing:"0.1em", fontFamily:M }}>Total Client Value Recovered</div>
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
                <div style={{ fontSize:10, color:"#9ca3af", marginTop:2 }}>{AUTOMATIONS.filter(a=>a.status==="critical").map(a=>`${a.client}: ${a.name}`).join(" · ")}</div>
              </div>}
              {overdueInvs.length>0&&<div onClick={()=>setTab("invoicing")} style={{ flex:1, background:"rgba(248,113,113,0.05)", border:"1px solid rgba(248,113,113,0.1)", borderRadius:10, padding:"10px 14px", cursor:"pointer", animation:"fu 0.4s ease 100ms both" }}>
                <div style={{ fontSize:11, fontWeight:600, color:"#f87171" }}>💰 {overdueInvs.length} overdue invoice</div>
                <div style={{ fontSize:10, color:"#9ca3af", marginTop:2 }}>{overdueInvs.map(i=>`${i.client}: $${i.total.toLocaleString()}`).join(" · ")}</div>
              </div>}
            </div>}
            <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr", gap:12 }}>
              <Panel title="Revenue vs Expenses" subtitle="Last 6 months"><RevChart data={FINANCIALS.revenueHistory}/></Panel>
              <Panel title="Priority Actions" action={<span style={{ fontSize:9, fontWeight:600, color:"#f87171", background:"rgba(248,113,113,0.1)", padding:"2px 7px", borderRadius:4, fontFamily:M }}>{highTasks} urgent</span>}>
                <div style={{ display:"flex", flexDirection:"column", gap:5 }}>{TASKS.filter(t=>t.priority==="high").map((t,i)=><TaskItem key={t.id} task={t} delay={i*40}/>)}</div>
              </Panel>
            </div>
            <Panel title="Sales Pipeline" action={<button onClick={()=>setTab("pipeline")} style={{ fontSize:10, color:"#818cf8", background:"none", border:"none", cursor:"pointer" }}>View all →</button>}><PipelineBoard/></Panel>
          </div>
        )}
       {tab==="agents"&&<AgentsTab onTabNav={(tabId)=>setTab(tabId)}/>}
        {tab==="pipeline"&&<><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}><h2 style={{fontSize:17,fontWeight:700,color:"#f0f0f0"}}>Sales Pipeline</h2><button onClick={()=>setShowForm("deal")} style={{fontSize:11,fontWeight:600,color:"#a5b4fc",background:"rgba(99,102,241,0.1)",border:"1px solid rgba(99,102,241,0.2)",borderRadius:6,padding:"5px 12px",cursor:"pointer"}}>+ Add Deal</button></div><p style={{fontSize:11,color:"#6b7280",marginBottom:14}}>{PIPELINE.length} deals · ${pipeVal.toLocaleString()}/mo</p><PipelineBoard/></>}
        {tab==="clients"&&<><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}><h2 style={{fontSize:17,fontWeight:700,color:"#f0f0f0"}}>Client Health</h2><button onClick={()=>setShowForm("client")} style={{fontSize:11,fontWeight:600,color:"#a5b4fc",background:"rgba(99,102,241,0.1)",border:"1px solid rgba(99,102,241,0.2)",borderRadius:6,padding:"5px 12px",cursor:"pointer"}}>+ Add Client</button></div><p style={{fontSize:11,color:"#6b7280",marginBottom:14}}>{CLIENTS.length} clients</p>
          <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.05)",borderRadius:12,overflow:"hidden"}}>
            <div style={{display:"grid",gridTemplateColumns:"2fr .7fr .8fr .8fr .8fr 1.3fr",gap:6,padding:"8px 16px",borderBottom:"1px solid rgba(255,255,255,0.06)",fontSize:9,fontWeight:600,color:"#6b7280",textTransform:"uppercase",fontFamily:M}}><span>Client</span><span>Status</span><span>Health</span><span>No-Show</span><span>MRR</span><span>Next</span></div>
            {CLIENTS.map((c,i)=>{const sc=c.healthScore>=90?"#4ade80":c.healthScore>=70?"#fbbf24":"#fb923c";const stc={active:"#4ade80",onboarding:"#38bdf8"};return(
              <div key={c.id} style={{display:"grid",gridTemplateColumns:"2fr .7fr .8fr .8fr .8fr 1.3fr",gap:6,alignItems:"center",padding:"10px 16px",borderBottom:"1px solid rgba(255,255,255,0.03)",fontSize:12,animation:`fu 0.4s ease ${i*50}ms both`}}>
                <div><div style={{fontWeight:600,color:"#e5e7eb"}}>{c.name}</div><div style={{fontSize:10,color:"#6b7280"}}>T{c.tier} · {c.ehr}</div></div>
                <div style={{display:"flex",alignItems:"center",gap:4}}><span style={{width:5,height:5,borderRadius:"50%",background:stc[c.status]}}/><span style={{color:stc[c.status],fontSize:10,textTransform:"capitalize"}}>{c.status}</span></div>
                <span style={{fontWeight:700,color:sc,fontFamily:M}}>{c.healthScore}</span>
                <div style={{fontFamily:M}}><span style={{color:"#f0f0f0"}}>{c.noShowCurrent}%</span>{c.noShowBefore-c.noShowCurrent>0&&<span style={{color:"#4ade80",fontSize:9,marginLeft:3}}>↓{(c.noShowBefore-c.noShowCurrent).toFixed(1)}</span>}</div>
                <span style={{fontFamily:M,color:"#f0f0f0"}}>${c.monthlyFee.toLocaleString()}</span>
                <span style={{fontSize:10.5,color:"#9ca3af"}}>{c.nextMilestone}</span>
              </div>
            );})}
          </div>
        </>}
        {tab==="roi"&&<ROITab/>}
        {tab==="financials"&&(
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <h2 style={{fontSize:17,fontWeight:700,color:"#f0f0f0"}}>Financial Overview</h2>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12}}>
              <KPI label="MRR" value={FINANCIALS.mrr} prefix="$" change={12.2} spark={FINANCIALS.revenueHistory.map(r=>r.revenue)} sparkColor="#818cf8"/>
              <KPI label="ARR" value={FINANCIALS.arr} prefix="$" spark={FINANCIALS.revenueHistory.map(r=>r.revenue*12)} sparkColor="#4ade80" delay={60}/>
              <KPI label="Cash" value={FINANCIALS.cashOnHand} prefix="$" spark={[32e3,35e3,38e3,41e3,45e3,48200]} sparkColor="#38bdf8" delay={120}/>
              <KPI label="Net Margin" value={69} suffix="%" spark={[58,60,63,65,67,69]} sparkColor="#4ade80" delay={180}/>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <Panel title="Revenue Trend"><RevChart data={FINANCIALS.revenueHistory}/></Panel>
              <Panel title="Monthly P&L">{[{l:"Revenue",v:"$27,500",c:"#818cf8"},{l:"Expenses",v:"-$8,400",c:"#f87171"},{l:"Net",v:"$19,100",c:"#4ade80"},{l:"A/R",v:"$13,000",c:"#fbbf24"}].map((m,i)=>(<div key={i} style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:"1px solid rgba(255,255,255,0.03)"}}><span style={{fontSize:12,color:"#9ca3af"}}>{m.l}</span><span style={{fontSize:12,fontWeight:600,color:m.c,fontFamily:M}}>{m.v}</span></div>))}</Panel>
            </div>
          </div>
        )}
        {tab==="invoicing"&&<InvoicingTab/>}
        {tab==="automations"&&<AutoTab/>}
        {tab==="onboarding"&&<OnboardingTab/>}
        {tab==="capacity"&&<CapTab/>}
        {tab==="profitability"&&<ProfitabilityTab/>}
        {tab==="renewals"&&<RenewalsTab/>}
        {tab==="proposal"&&<ProposalTab/>}
        {tab==="salesprep"&&<SalesPrepTab/>}
        {tab==="tasks"&&<><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}><h2 style={{fontSize:17,fontWeight:700,color:"#f0f0f0"}}>Action Items</h2><button onClick={()=>setShowForm("task")} style={{fontSize:11,fontWeight:600,color:"#a5b4fc",background:"rgba(99,102,241,0.1)",border:"1px solid rgba(99,102,241,0.2)",borderRadius:6,padding:"5px 12px",cursor:"pointer"}}>+ Add Task</button></div><div style={{display:"flex",flexDirection:"column",gap:5,maxWidth:680}}>{[...TASKS].sort((a,b)=>({high:0,medium:1,low:2})[a.priority]-({high:0,medium:1,low:2})[b.priority]).map((t,i)=><TaskItem key={t.id} task={t} delay={i*30}/>)}</div></>}
        {tab==="comms"&&<CommsTab/>}
        {tab==="report"&&<WeeklyReportTab/>}
      </main>
{showForm==="client"&&<AddClientPanel onClose={()=>setShowForm(null)} supabase={supabase} onSaved={()=>setShowForm(null)}/>}
      {showForm==="deal"&&<AddDealPanel onClose={()=>setShowForm(null)} supabase={supabase} onSaved={()=>setShowForm(null)}/>}
      {showForm==="task"&&<AddTaskPanel onClose={()=>setShowForm(null)} supabase={supabase} onSaved={()=>setShowForm(null)}/>}
      {showForm==="invoice"&&<AddInvoicePanel onClose={()=>setShowForm(null)} supabase={supabase} clients={CLIENTS} onSaved={()=>setShowForm(null)}/>}
      {showForm==="comm"&&<AddCommPanel onClose={()=>setShowForm(null)} supabase={supabase} clients={CLIENTS} onSaved={()=>setShowForm(null)}/>}
    {/* Voice Layer — Vapi SDK */}
      <VapiAssistant onTabChange={(tabId) => setTab(tabId)} onOpenForm={(formId) => setShowForm(formId)} />
  </div>
  );
}
