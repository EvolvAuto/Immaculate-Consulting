/**
 * useSupabaseData.js
 * ─────────────────────────────────────────────────────────────────────────────
 * IC-BOS | Immaculate Consulting Business Operating System
 *
 * Master data hook — replaces ALL hardcoded mock data with live Supabase queries.
 *
 * ARCHITECTURE:
 *  Each IC-BOS tab gets its own focused hook so components only re-render when
 *  their specific data changes. A top-level `useICBosData()` hook composes all
 *  of them for the main app shell.
 *
 * PATTERN:
 *  Every hook returns: { data, loading, error, refetch }
 *  - data    → query result (typed per section)
 *  - loading → boolean (true during initial fetch)
 *  - error   → Error object or null
 *  - refetch → function to manually re-trigger the query
 *
 * REALTIME:
 *  Tabs that benefit from live updates (Automations, Tasks) use Supabase
 *  Realtime subscriptions that auto-update state without polling.
 *
 * TABLES REFERENCED:
 *  clients, pipeline_deals, invoices, tasks, client_automations,
 *  onboarding_projects, communications, capacity_team, financial_snapshots,
 *  weekly_reports, users
 *
 * VIEWS REFERENCED (pre-calculated in DB for performance):
 *  v_client_roi, v_pipeline_summary, v_automation_health
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, logQueryError } from '../lib/supabaseClient';


// =============================================================================
// SHARED UTILITIES
// =============================================================================

/**
 * Generic query hook factory.
 * Eliminates boilerplate for loading/error/refetch across all hooks.
 *
 * @param {Function} queryFn  - Async function that returns { data, error }
 * @param {Array}    deps     - useEffect dependency array
 * @param {*}        initial  - Initial data value ([] for arrays, {} for objects)
 */
const useQuery = (queryFn, deps = [], initial = null) => {
  const [data, setData]       = useState(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  // Stable refetch — doesn't cause render loops when passed as a dep.
  const queryFnRef = useRef(queryFn);
  queryFnRef.current = queryFn;

  const execute = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await queryFnRef.current();
      if (result.error) throw result.error;
      setData(result.data ?? initial);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    execute();
  }, [execute]);

  return { data, loading, error, refetch: execute };
};


// =============================================================================
// SECTION 1: OVERVIEW TAB
// KPIs banner, alert flags, revenue trend preview
// =============================================================================

/**
 * useOverview
 * Pulls the latest financial snapshot + client counts + open task count.
 * Drives the Overview tab KPI cards and top-level alerts.
 */
export const useOverview = () => {
  return useQuery(async () => {
    // Run three queries in parallel for speed.
    const [snapshotRes, clientsRes, tasksRes, dealsRes] = await Promise.all([
      // Latest financial snapshot (most recent row)
      supabase
        .from('financial_snapshots')
        .select('mrr, arr, cash_on_hand, accounts_receivable, monthly_expenses, pipeline_value, date')
        .order('date', { ascending: false })
        .limit(1)
        .single(),

      // Client health summary — aggregate counts
      supabase
        .from('clients')
        .select('id, status, health_score, monthly_fee, renewal_date'),

      // Open (incomplete) critical/high priority tasks
      supabase
        .from('tasks')
       .select('id, text, priority, due_date, category')
        .eq('completed', false)
        .in('priority', ['Critical', 'High'])
        .order('priority')
        .order('due_date')
        .limit(5),

      // Active pipeline deal count + value
      supabase
        .from('pipeline_deals')
        .select('id, estimated_value, stage')
        .not('stage', 'in', '("Closed Won","Closed Lost")'),
    ]);

    // Propagate the first error encountered
    const firstError = snapshotRes.error || clientsRes.error || tasksRes.error || dealsRes.error;
    if (firstError) return { error: firstError };

    const clients    = clientsRes.data ?? [];
    const snapshot   = snapshotRes.data ?? {};
    const tasks      = tasksRes.data ?? [];
    const deals      = dealsRes.data ?? [];

    // Compute aggregate KPIs client-side (no extra DB round-trip needed)
    const activeClients      = clients.filter(c => c.status === 'Active').length;
    const avgHealthScore     = clients.length
      ? Math.round(clients.reduce((sum, c) => sum + c.health_score, 0) / clients.length)
      : 0;
    const atRiskClients      = clients.filter(c => c.health_score < 70).length;
    const mrr                = clients.filter(c => c.status === 'Active')
      .reduce((sum, c) => sum + Number(c.monthly_fee), 0);
    const pipelineValue      = deals.reduce((sum, d) => sum + Number(d.estimated_value), 0);

    // Renewal alerts: clients renewing in < 60 days
    const now        = new Date();
    const renewalAlerts = clients
      .filter(c => {
        if (!c.renewal_date) return false;
        const daysOut = Math.ceil((new Date(c.renewal_date) - now) / 86400000);
        return daysOut > 0 && daysOut <= 60;
      })
      .map(c => ({
        id:          c.id,
        renewal_date: c.renewal_date,
        days_out:    Math.ceil((new Date(c.renewal_date) - now) / 86400000),
      }));

    return {
      data: {
        snapshot,
        mrr,
        activeClients,
        avgHealthScore,
        atRiskClients,
        pipelineValue,
        openDeals: deals.length,
        priorityTasks: tasks,
        renewalAlerts,
      },
      error: null,
    };
  }, []);
};


// =============================================================================
// SECTION 2: PIPELINE TAB
// Kanban board: Cold → Discovery → Proposal → Negotiation → Closed Won
// =============================================================================

/**
 * usePipeline
 * Fetches all active pipeline deals grouped by stage.
 * Includes EHR complexity metadata for the Sales Prep tab overlay.
 */
export const usePipeline = () => {
  return useQuery(
    async () =>
      supabase
        .from('pipeline_deals')
        .select(`
         id, practice_name, specialty, ehr, stage, tier,
          estimated_value, close_probability, contact_name, contact_email, contact_phone,
          next_action, next_action_date, days_in_stage,
          providers, payer_mix, no_show_baseline,
          ehr_difficulty, ehr_timeline, ehr_notes,
          notes, assigned_to, created_at, updated_at
        `)
        .not('stage', 'in', '("Closed Won","Closed Lost")')
        .order('days_in_stage', { ascending: false }),
    [],
    []
  );
};

/**
 * useUpdateDealStage
 * Returns a mutation function to drag-and-drop a deal to a new stage.
 *
 * Usage: const { updateStage, loading } = useUpdateDealStage();
 *        await updateStage(dealId, 'Proposal');
 */
export const useUpdateDealStage = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  const updateStage = useCallback(async (dealId, newStage) => {
    setLoading(true);
    setError(null);
    const { error: err } = await supabase
      .from('pipeline_deals')
      .update({ stage: newStage, updated_at: new Date().toISOString() })
      .eq('id', dealId);

    if (err) {
      logQueryError('updateDealStage', err);
      setError(err);
    }
    setLoading(false);
    return !err;
  }, []);

  return { updateStage, loading, error };
};


// =============================================================================
// SECTION 3: CLIENTS TAB
// Health table with scores, no-show rates, MRR, milestones
// =============================================================================

/**
 * useClients
 * Full client roster with health metrics for the Clients tab table.
 */
export const useClients = () => {
  return useQuery(
    async () =>
      supabase
        .from('clients')
        .select(`
          id, name, tier, status, health_score, ehr,
          monthly_fee, platform_cost, providers,
          appts_per_week, avg_visit_value, staff_hourly_rate,
          no_show_before, no_show_current,
          weekly_hours_saved, weekly_hours_spent,
          go_live_date, renewal_date,
          primary_contact, contact_email, contact_phone,
          notes, assigned_to, created_at, updated_at
        `)
        .order('health_score', { ascending: true }), // lowest health at top (needs attention)
    [],
    []
  );
};

/**
 * useUpdateClientHealth
 * Mutation to manually update a client's health score (e.g., after a QBR).
 */
export const useUpdateClientHealth = () => {
  const [loading, setLoading] = useState(false);

  const updateHealth = useCallback(async (clientId, healthScore, notes) => {
    setLoading(true);
    const { error } = await supabase
      .from('clients')
      .update({ health_score: healthScore, notes, updated_at: new Date().toISOString() })
      .eq('id', clientId);

    if (error) logQueryError('updateClientHealth', error);
    setLoading(false);
    return !error;
  }, []);

  return { updateHealth, loading };
};


// =============================================================================
// SECTION 4: ROI TAB
// Live ticker: (no-show reduction × appts × $65 × 52) + (hours saved × $18 × 52)
// =============================================================================

/**
 * useROI
 * Uses the pre-calculated v_client_roi database view for performance.
 * The view runs the exact formula from the IC-BOS ROI tab.
 */
export const useROI = () => {
  return useQuery(
    async () => {
      const { data, error } = await supabase
        .from('v_client_roi')
        .select(`
          id, name, tier, status, health_score, ehr,
          monthly_fee, providers, appts_per_week,
          avg_visit_value, staff_hourly_rate,
          no_show_before, no_show_current,
          weekly_hours_saved, annual_value_recovered,
          monthly_value_recovered, monthly_profit,
          margin_pct, renewal_date, days_to_renewal, assigned_to
        `)
        .in('status', ['Active', 'Onboarding']);

      if (error) return { error };

      // Compute portfolio-level totals for the live ticker banner
      const clients = data ?? [];
      const totalAnnualROI    = clients.reduce((s, c) => s + Number(c.annual_value_recovered),  0);
      const totalMonthlyROI   = clients.reduce((s, c) => s + Number(c.monthly_value_recovered), 0);
      const totalMRR          = clients.reduce((s, c) => s + Number(c.monthly_fee), 0);
      const totalMonthlyProfit = clients.reduce((s, c) => s + Number(c.monthly_profit), 0);

      return {
        data: {
          clients,
          totals: { totalAnnualROI, totalMonthlyROI, totalMRR, totalMonthlyProfit },
        },
        error: null,
      };
    },
    [],
    { clients: [], totals: {} }
  );
};


// =============================================================================
// SECTION 5: FINANCIALS TAB
// MRR, ARR, cash on hand, net margin, revenue trend, P&L
// =============================================================================

/**
 * useFinancials
 * Pulls the last 12 financial snapshots for the trend chart + current KPIs.
 */
export const useFinancials = () => {
  return useQuery(
    async () => {
      const [snapshotsRes, invoicesRes] = await Promise.all([
        // Last 12 monthly snapshots for the revenue trend chart
        supabase
          .from('financial_snapshots')
          .select('date, mrr, arr, cash_on_hand, accounts_receivable, monthly_expenses, pipeline_value')
          .order('date', { ascending: false })
          .limit(12),

        // Outstanding invoice totals
        supabase
          .from('invoices')
          .select('total, status, due_date')
          .in('status', ['Pending', 'Overdue']),
      ]);

      if (snapshotsRes.error) return { error: snapshotsRes.error };
      if (invoicesRes.error)  return { error: invoicesRes.error };

      const snapshots  = (snapshotsRes.data ?? []).reverse(); // chronological order
      const invoices   = invoicesRes.data ?? [];

      const current    = snapshots[snapshots.length - 1] ?? {};
      const outstanding = invoices.reduce((s, i) => s + Number(i.total), 0);
      const overdue    = invoices
        .filter(i => i.status === 'Overdue')
        .reduce((s, i) => s + Number(i.total), 0);

      const netMargin  = current.mrr && current.monthly_expenses
        ? Math.round(((current.mrr - current.monthly_expenses) / current.mrr) * 100)
        : 0;

      return {
        data: {
          snapshots,   // array for chart — [{date, mrr, arr, ...}]
          current,     // latest snapshot for KPI cards
          outstanding, // total open AR
          overdue,     // overdue AR (red alert)
          netMargin,   // % net margin
        },
        error: null,
      };
    },
    [],
    { snapshots: [], current: {}, outstanding: 0, overdue: 0, netMargin: 0 }
  );
};


// =============================================================================
// SECTION 6: INVOICING TAB
// Invoice tracking: paid/pending/overdue, usage pass-throughs, overdue alerts
// =============================================================================

/**
 * useInvoices
 * Full invoice list with client name joined in.
 */
export const useInvoices = () => {
  return useQuery(
    async () =>
      supabase
        .from('invoices')
        .select(`
          id, invoice_number, type, base_amount, usage_cost,
          total, issued_date, due_date, status, paid_date, notes,
          clients ( id, name, tier )
        `)
        .order('issued_date', { ascending: false }),
    [],
    []
  );
};

/**
 * useMarkInvoicePaid
 * Mutation: mark an invoice as paid and record the paid_date.
 */
export const useMarkInvoicePaid = () => {
  const [loading, setLoading] = useState(false);

  const markPaid = useCallback(async (invoiceId, paidDate = new Date().toISOString().split('T')[0]) => {
    setLoading(true);
    const { error } = await supabase
      .from('invoices')
      .update({ status: 'Paid', paid_date: paidDate })
      .eq('id', invoiceId);

    if (error) logQueryError('markInvoicePaid', error);
    setLoading(false);
    return !error;
  }, []);

  return { markPaid, loading };
};

/**
 * useCreateInvoice
 * Mutation: create a new invoice record.
 *
 * @param {Object} invoiceData - { client_id, type, base_amount, usage_cost, due_date, ... }
 */
export const useCreateInvoice = () => {
  const [loading, setLoading] = useState(false);

  const createInvoice = useCallback(async (invoiceData) => {
    setLoading(true);
    const { data, error } = await supabase
      .from('invoices')
      .insert([{
        ...invoiceData,
        total: Number(invoiceData.base_amount) + Number(invoiceData.usage_cost ?? 0),
        status: invoiceData.status ?? 'Pending',
        issued_date: invoiceData.issued_date ?? new Date().toISOString().split('T')[0],
      }])
      .select()
      .single();

    if (error) logQueryError('createInvoice', error);
    setLoading(false);
    return { data, error };
  }, []);

  return { createInvoice, loading };
};


// =============================================================================
// SECTION 7: AUTOMATIONS TAB
// Make.com scenario health monitor with real-time updates
// =============================================================================

/**
 * useAutomations
 * Uses the v_automation_health view + real-time subscription.
 * Automations data can change frequently (every run), so we subscribe.
 */
export const useAutomations = () => {
  const [data, setData]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  // Fetch helper — shared by initial load and realtime updates.
  const fetchAutomations = useCallback(async () => {
    const { data: rows, error: err } = await supabase
      .from('v_automation_health')
      .select(`
        client_name, automation_name, status, success_rate,
        execs_today, errors_24h, cost_today, last_run_at,
        trigger_type, health_flag
      `)
      .order('health_flag'); // Critical → Warning → Healthy

    if (err) {
      logQueryError('fetchAutomations', err);
      setError(err);
    } else {
      setData(rows ?? []);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAutomations();

    // Subscribe to INSERT/UPDATE on client_automations for live status changes.
    const subscription = supabase
      .channel('automation-health-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'client_automations' },
        () => fetchAutomations() // re-fetch on any change
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, [fetchAutomations]);

  // Portfolio summary stats (for the summary cards at the top of the Automations tab)
  const summary = {
    total:        data.length,
    active:       data.filter(a => a.status === 'Active').length,
    warning:      data.filter(a => a.health_flag === 'Warning').length,
    critical:     data.filter(a => a.health_flag === 'Critical').length,
    avgSuccess:   data.length
      ? Math.round(data.reduce((s, a) => s + Number(a.success_rate), 0) / data.length)
      : 0,
    totalCost:    data.reduce((s, a) => s + Number(a.cost_today), 0),
    totalExecs:   data.reduce((s, a) => s + Number(a.execs_today), 0),
    totalErrors:  data.reduce((s, a) => s + Number(a.errors_24h), 0),
  };

  return { data, summary, loading, error, refetch: fetchAutomations };
};


// =============================================================================
// SECTION 8: ONBOARDING TAB
// 5-phase project tracker per client
// =============================================================================

/**
 * useOnboarding
 * Fetches all onboarding projects with their phase progress and risk flags.
 * The `phases` and `risks` columns are JSONB in Postgres.
 */
export const useOnboarding = () => {
  return useQuery(
    async () =>
      supabase
        .from('onboarding_projects')
        .select(`
          id, kickoff_date, target_go_live, actual_go_live,
          phases, risks, blockers, notes,
          clients ( id, name, tier, ehr, assigned_to )
        `)
        .order('target_go_live'),
    [],
    []
  );
};

/**
 * useUpdateOnboardingPhase
 * Mutation: advance or update a single onboarding phase.
 *
 * @param {string} projectId   - onboarding_projects.id
 * @param {Object} updatedPhases - full updated phases JSONB object
 */
export const useUpdateOnboardingPhase = () => {
  const [loading, setLoading] = useState(false);

  const updatePhase = useCallback(async (projectId, updatedPhases) => {
    setLoading(true);
    const { error } = await supabase
      .from('onboarding_projects')
      .update({ phases: updatedPhases })
      .eq('id', projectId);

    if (error) logQueryError('updateOnboardingPhase', error);
    setLoading(false);
    return !error;
  }, []);

  return { updatePhase, loading };
};


// =============================================================================
// SECTION 9: CAPACITY TAB
// Per-consultant hours breakdown + hiring forecaster
// =============================================================================

/**
 * useCapacity
 * Loads the capacity_team table (one row per consultant) + client hours spent.
 * Supports the multi-consultant hiring forecaster.
 */
export const useCapacity = () => {
  return useQuery(
    async () => {
      const [teamRes, clientsRes] = await Promise.all([
        supabase
          .from('capacity_team')
          .select(`
            id, hours_available, delivery_hours, sales_hours,
            admin_hours, monthly_cost,
            users ( id, full_name, title, role )
          `),

        // Sum of hours spent per consultant from clients table
        supabase
          .from('clients')
          .select('assigned_to, weekly_hours_spent')
          .in('status', ['Active', 'Onboarding']),
      ]);

      if (teamRes.error)    return { error: teamRes.error };
      if (clientsRes.error) return { error: clientsRes.error };

      const team    = teamRes.data ?? [];
      const clients = clientsRes.data ?? [];

      // Map actual delivery hours per consultant from live client data
      const hoursMap = {};
      clients.forEach(c => {
        if (!c.assigned_to) return;
        hoursMap[c.assigned_to] = (hoursMap[c.assigned_to] ?? 0) + Number(c.weekly_hours_spent) * 4.33;
      });

      const teamWithActuals = team.map(member => ({
        ...member,
        actual_delivery_hours: Math.round(hoursMap[member.users?.id] ?? member.delivery_hours),
        utilization: Math.round((member.delivery_hours / member.hours_available) * 100),
      }));

      // Portfolio-level capacity summary
      const totalAvailable = team.reduce((s, m) => s + m.hours_available, 0);
      const totalBooked    = team.reduce((s, m) => s + m.delivery_hours,  0);
      const utilization    = totalAvailable ? Math.round((totalBooked / totalAvailable) * 100) : 0;

      return {
        data: {
          team: teamWithActuals,
          summary: { totalAvailable, totalBooked, utilization },
        },
        error: null,
      };
    },
    [],
    { team: [], summary: {} }
  );
};


// =============================================================================
// SECTION 10: PROFITABILITY TAB
// Per-client effective hourly rate, margin, monthly profit
// =============================================================================

/**
 * useProfitability
 * Reuses v_client_roi view — already computes monthly_profit and margin_pct.
 */
export const useProfitability = () => {
  return useQuery(
    async () => {
      const { data, error } = await supabase
        .from('v_client_roi')
        .select(`
          id, name, tier, ehr, status, monthly_fee, platform_cost,
          weekly_hours_spent, monthly_profit, margin_pct,
          annual_value_recovered, monthly_value_recovered
        `)
        .in('status', ['Active', 'Onboarding'])
        .order('margin_pct', { ascending: true }); // lowest margin first (needs attention)

      if (error) return { error };

      const clients         = data ?? [];
      const totalRevenue    = clients.reduce((s, c) => s + Number(c.monthly_fee), 0);
      const totalProfit     = clients.reduce((s, c) => s + Number(c.monthly_profit), 0);
      const avgMargin       = clients.length
        ? Math.round(clients.reduce((s, c) => s + Number(c.margin_pct), 0) / clients.length)
        : 0;

      return {
        data: { clients, totals: { totalRevenue, totalProfit, avgMargin } },
        error: null,
      };
    },
    [],
    { clients: [], totals: {} }
  );
};


// =============================================================================
// SECTION 11: RENEWALS TAB
// Churn risk radar with countdown + health-score-based flagging
// =============================================================================

/**
 * useRenewals
 * Clients sorted by renewal urgency. Red = < 30 days, Yellow = 30-60 days.
 */
export const useRenewals = () => {
  return useQuery(
    async () => {
      const { data, error } = await supabase
        .from('v_client_roi')
        .select(`
          id, name, tier, status, health_score, ehr,
          monthly_fee, annual_value_recovered,
          renewal_date, days_to_renewal, assigned_to
        `)
        .in('status', ['Active', 'Onboarding'])
        .not('renewal_date', 'is', null)
        .order('days_to_renewal');

      if (error) return { error };

      const clients = data ?? [];

      // Risk classification
      const classified = clients.map(c => ({
        ...c,
        risk: (() => {
          if (c.health_score < 60 || c.days_to_renewal <= 30)  return 'Critical';
          if (c.health_score < 75 || c.days_to_renewal <= 60)  return 'High';
          if (c.health_score < 85 || c.days_to_renewal <= 90)  return 'Medium';
          return 'Low';
        })(),
      }));

      return {
        data: {
          clients: classified,
          critical: classified.filter(c => c.risk === 'Critical').length,
          high:     classified.filter(c => c.risk === 'High').length,
          atRisk:   classified.filter(c => ['Critical', 'High'].includes(c.risk)).length,
        },
        error: null,
      };
    },
    [],
    { clients: [], critical: 0, high: 0, atRisk: 0 }
  );
};


// =============================================================================
// SECTION 12: PROPOSALS TAB
// Proposal builder uses static service catalog — no DB query needed.
// Just needs the client list to associate a proposal with a prospect/client.
// =============================================================================

/**
 * useProposalTargets
 * Returns pipeline deals + clients for the Proposal Builder "Select Recipient" dropdown.
 */
export const useProposalTargets = () => {
  return useQuery(
    async () => {
      const [dealsRes, clientsRes] = await Promise.all([
        supabase
          .from('pipeline_deals')
          .select('id, practice_name, specialty, ehr, tier, providers, contact_name, contact_email')
          .not('stage', 'in', '("Closed Won","Closed Lost")')
          .order('practice_name'),

        supabase
          .from('clients')
          .select('id, name, tier, ehr, providers, contact_email')
          .in('status', ['Active', 'Onboarding'])
          .order('name'),
      ]);

      if (dealsRes.error)   return { error: dealsRes.error };
      if (clientsRes.error) return { error: clientsRes.error };

      return {
        data: {
          prospects: dealsRes.data ?? [],
          clients:   clientsRes.data ?? [],
        },
        error: null,
      };
    },
    [],
    { prospects: [], clients: [] }
  );
};


// =============================================================================
// SECTION 13: SALES PREP TAB
// Discovery call briefing with EHR intel + pre-calculated ROI
// =============================================================================

/**
 * useSalesPrep
 * Returns pipeline deals enriched with EHR difficulty + timeline for the
 * Sales Prep discovery briefing generator.
 */
export const useSalesPrep = () => {
  return useQuery(
    async () =>
      supabase
        .from('pipeline_deals')
        .select(`
          id, practice_name, specialty, ehr, stage, tier,
          estimated_value, close_probability, contact_name, contact_title,
          contact_email, next_action, next_action_date, providers,
          payer_mix, no_show_baseline, ehr_difficulty, ehr_timeline,
          ehr_notes, notes
        `)
        .not('stage', 'in', '("Closed Won","Closed Lost")')
        .order('next_action_date'),
    [],
    []
  );
};


// =============================================================================
// SECTION 14: TASKS TAB
// Priority-sorted action items with real-time checkbox updates
// =============================================================================

/**
 * useTasks
 * Live task list with realtime subscription so checkboxes update across tabs.
 */
export const useTasks = () => {
  const [data, setData]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const fetchTasks = useCallback(async () => {
    const { data: rows, error: err } = await supabase
      .from('tasks')
      .select('id, text, due_date, priority, category, completed, client_id, notes, created_at')
      .eq('completed', false) // Default view: open tasks only
      .order('priority') // Critical → High → Medium → Low
      .order('due_date');

    if (err) {
      logQueryError('fetchTasks', err);
      setError(err);
    } else {
      setData(rows ?? []);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTasks();

    // Realtime: update the task list when any task is modified
    const subscription = supabase
      .channel('tasks-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, fetchTasks)
      .subscribe();

    return () => supabase.removeChannel(subscription);
  }, [fetchTasks]);

  /**
   * Toggle a task's completed state.
   * Uses optimistic update — updates UI immediately, rolls back on error.
   */
  const toggleTask = useCallback(async (taskId, currentCompleted) => {
    const newValue = !currentCompleted;

    // Optimistic update
    setData(prev => prev.map(t => t.id === taskId ? { ...t, completed: newValue } : t));

    const { error: err } = await supabase
      .from('tasks')
      .update({ completed: newValue })
      .eq('id', taskId);

    if (err) {
      logQueryError('toggleTask', err);
      // Rollback on error
      setData(prev => prev.map(t => t.id === taskId ? { ...t, completed: currentCompleted } : t));
    }
  }, []);

  /**
   * Add a new task.
   * @param {{ text: string, due: string, priority: string, category: string }} taskData
   */
  const addTask = useCallback(async (taskData) => {
    const { data: newTask, error: err } = await supabase
      .from('tasks')
      .insert([{ ...taskData, completed: false }])
      .select()
      .single();

    if (err) logQueryError('addTask', err);
    return { data: newTask, error: err };
  }, []);

  return { data, loading, error, refetch: fetchTasks, toggleTask, addTask };
};


// =============================================================================
// SECTION 15: COMMUNICATIONS TAB
// Timeline of all client touchpoints
// =============================================================================

/**
 * useCommunications
 * Fetches the full communication log with client names joined in.
 *
 * @param {string|null} clientId - Optional: filter to one client's history
 */
export const useCommunications = (clientId = null) => {
  return useQuery(
    async () => {
      let query = supabase
        .from('communications')
.select(`
          id, comm_date, type, subject, note, created_at,
          clients ( id, name ),
          users   ( id, full_name )
        `)
        .order('comm_date', { ascending: false })
        .limit(100);

      if (clientId) query = query.eq('client_id', clientId);

      return query;
    },
    [clientId],
    []
  );
};

/**
 * useLogCommunication
 * Mutation: add a new touchpoint to the comms log.
 *
 * @param {{ client_id, date, type, note }} commData
 */
export const useLogCommunication = () => {
  const [loading, setLoading] = useState(false);

  const logComm = useCallback(async (commData) => {
    setLoading(true);

    // Get the current user to associate the log entry
    const { data: { user } } = await supabase.auth.getUser();

    const { data, error } = await supabase
      .from('communications')
      .insert([{ ...commData, user_id: user?.id }])
      .select()
      .single();

    if (error) logQueryError('logCommunication', error);
    setLoading(false);
    return { data, error };
  }, []);

  return { logComm, loading };
};


// =============================================================================
// SECTION 16: WEEKLY REPORT TAB
// 4-section digest: Revenue, Pipeline, Clients, Operations + action list
// =============================================================================

/**
 * useWeeklyReport
 * Fetches the latest weekly report record.
 * The report is typically generated server-side (Make.com scenario or cron job)
 * and stored as JSONB sections in the weekly_reports table.
 */
export const useWeeklyReport = () => {
  return useQuery(
    async () =>
      supabase
        .from('weekly_reports')
        .select(`
          id, week_starting, mrr_at_report, active_clients, open_deals,
          revenue_section, pipeline_section, client_section,
          operations_section, action_items, generated_by, created_at
        `)
        .order('week_starting', { ascending: false })
        .limit(1)
        .single(),
    [],
    null
  );
};

/**
 * useWeeklyReportHistory
 * Fetches last 12 weeks of reports for historical trending in the report tab.
 */
export const useWeeklyReportHistory = () => {
  return useQuery(
    async () =>
      supabase
        .from('weekly_reports')
        .select('id, week_starting, mrr_at_report, active_clients, open_deals')
        .order('week_starting', { ascending: false })
        .limit(12),
    [],
    []
  );
};


// =============================================================================
// MASTER HOOK: useICBosData
// Composes all section hooks for the main App shell.
// The App passes this down as props or via Context.
// =============================================================================

/**
 * useICBosData
 * Top-level data aggregator for IC-BOS.
 *
 * USAGE (in App.jsx or IC-BOS main component):
 *
 *   const icbos = useICBosData();
 *
 *   // Then pass to each tab:
 *   <OverviewTab    data={icbos.overview}    />
 *   <PipelineTab    data={icbos.pipeline}    />
 *   <ClientsTab     data={icbos.clients}     />
 *   <ROITab         data={icbos.roi}         />
 *   <FinancialsTab  data={icbos.financials}  />
 *   <InvoicingTab   data={icbos.invoices}    />
 *   <AutomationsTab data={icbos.automations} />
 *   <OnboardingTab  data={icbos.onboarding}  />
 *   <CapacityTab    data={icbos.capacity}    />
 *   <ProfitabilityTab data={icbos.profitability} />
 *   <RenewalsTab    data={icbos.renewals}    />
 *   <TasksTab       data={icbos.tasks}       />
 *   <CommsTab       data={icbos.comms}       />
 *   <WeeklyReportTab data={icbos.weeklyReport} />
 *
 * Each section is independently loading/error-able — no tab blocks another.
 */
export const useICBosData = () => {
  const overview       = useOverview();
  const pipeline       = usePipeline();
  const clients        = useClients();
  const roi            = useROI();
  const financials     = useFinancials();
  const invoices       = useInvoices();
  const automations    = useAutomations();
  const onboarding     = useOnboarding();
  const capacity       = useCapacity();
  const profitability  = useProfitability();
  const renewals       = useRenewals();
  const tasks          = useTasks();
  const comms          = useCommunications();
  const weeklyReport   = useWeeklyReport();
  const proposalTargets = useProposalTargets();
  const salesPrep      = useSalesPrep();

  // Global loading state — true only if ALL primary tabs are still loading.
  // Individual tabs use their own loading state for granular spinners.
  const isBootstrapping = overview.loading && clients.loading && pipeline.loading;

  return {
    overview,
    pipeline,
    clients,
    roi,
    financials,
    invoices,
    automations,
    onboarding,
    capacity,
    profitability,
    renewals,
    tasks,
    comms,
    weeklyReport,
    proposalTargets,
    salesPrep,
    isBootstrapping,
  };
};
