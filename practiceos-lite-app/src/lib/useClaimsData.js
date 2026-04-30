// useClaimsData - data layer for the Phase 4 Claims UI surfaces.
// Used by both the CM-level ClaimsTab and the patient-chart ClaimsTab.
//
// All queries hit the unified view cm_amh_claim_headers_unified (SECURITY
// INVOKER) so per-practice RLS auto-applies. Lines are fetched per claim_type
// from the appropriate table on-demand, cached so re-expand is free.

import { useState, useCallback, useRef } from 'react';
import { supabase } from './supabase';

const VIEW = 'cm_amh_claim_headers_unified';

const LINE_TABLE_BY_TYPE = {
  pro:      'cm_amh_claim_lines_pro',
  dental:   'cm_amh_claim_lines_dental',
  inst:     'cm_amh_claim_lines_inst',
  pharmacy: 'cm_amh_claim_lines_pharmacy',
};

const HEADER_TABLE_BY_TYPE = {
  pro:      'cm_amh_claim_headers_pro',
  dental:   'cm_amh_claim_headers_dental',
  inst:     'cm_amh_claim_headers_inst',
  pharmacy: 'cm_amh_claim_headers_pharmacy',
};

const PARSER_FN_BY_TYPE = {
  pro:      'parse-amh-claim-professional',
  dental:   'parse-amh-claim-dental',
  inst:     'parse-amh-claim-institutional',
  pharmacy: 'parse-amh-claim-pharmacy',
};

export default function useClaimsData() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const linesCacheRef = useRef(new Map());
  const chainCacheRef = useRef(new Map());

  const fetchClaims = useCallback(async (filters = {}) => {
    setLoading(true);
    setError(null);
    let q = supabase.from(VIEW).select('*');

    if (filters.patientId)        q = q.eq('matched_patient_id', filters.patientId);
    if (filters.claimType)        q = q.eq('claim_type', filters.claimType);
    if (filters.actionLabel)      q = q.eq('claim_action_label', filters.actionLabel);
    if (filters.reconStatus)      q = q.eq('reconciliation_status', filters.reconStatus);
    if (filters.payerShortName)   q = q.eq('payer_short_name', filters.payerShortName);
    if (filters.serviceFrom)      q = q.gte('service_date_effective', filters.serviceFrom);
    if (filters.serviceTo)        q = q.lte('service_date_effective', filters.serviceTo);
    if (filters.paidMin != null)  q = q.gte('claim_payment_amount', filters.paidMin);
    if (filters.paidMax != null)  q = q.lte('claim_payment_amount', filters.paidMax);
    if (filters.currentOnly)      q = q.is('superseded_by_id', null);
    if (filters.supersededOnly)   q = q.not('superseded_by_id', 'is', null);

    const s = (filters.search || '').trim();
    if (s) {
      const safe = s.replace(/[%,]/g, ' ');
      q = q.or(`tcn.ilike.%${safe}%,patient_full_name.ilike.%${safe}%,subscriber_cnds.ilike.%${safe}%`);
    }

    q = q.order('service_date_effective', { ascending: false, nullsFirst: false })
         .order('first_seen_at', { ascending: false });

    if (filters.limit) q = q.limit(filters.limit);

    const { data, error: e } = await q;
    setLoading(false);
    if (e) {
      setError(e.message);
      throw e;
    }
    return data || [];
  }, []);

  const fetchDashboard = useCallback(async (extraFilter = {}) => {
    const ref = () => {
      let q = supabase.from(VIEW);
      if (extraFilter.patientId)
        q = q.eq('matched_patient_id', extraFilter.patientId);
      return q;
    };
    const head = (q) => q.select('id', { count: 'exact', head: true });

    const ytdStart = `${new Date().getUTCFullYear()}-01-01`;

    const [total, current, superseded, unmatched, ytdRows] = await Promise.all([
      head(ref()),
      head(ref().is('superseded_by_id', null)),
      head(ref().not('superseded_by_id', 'is', null)),
      head(ref().eq('reconciliation_status', 'Unmatched')),
      ref().select('claim_payment_amount').gte('date_of_payment', ytdStart).limit(50000),
    ]);

    const paidYtd = (ytdRows.data || []).reduce(
      (acc, r) => acc + Number(r.claim_payment_amount || 0),
      0
    );

    return {
      total: total.count || 0,
      current: current.count || 0,
      superseded: superseded.count || 0,
      unmatched: unmatched.count || 0,
      paidYtd,
    };
  }, []);

  const fetchUnmatchedCount = useCallback(async () => {
    const { count, error: e } = await supabase
      .from(VIEW)
      .select('id', { count: 'exact', head: true })
      .eq('reconciliation_status', 'Unmatched');
    if (e) {
      setError(e.message);
      return 0;
    }
    return count || 0;
  }, []);

  const fetchLines = useCallback(async ({ claimType, practiceId, tcn }) => {
    const key = `${claimType}:${practiceId}:${tcn}`;
    const cached = linesCacheRef.current.get(key);
    if (cached) return cached;
    const table = LINE_TABLE_BY_TYPE[claimType];
    if (!table) return [];
    const { data, error: e } = await supabase
      .from(table)
      .select('*')
      .eq('practice_id', practiceId)
      .eq('tcn', tcn)
      .order('line_number', { ascending: true });
    if (e) {
      setError(e.message);
      return [];
    }
    const rows = data || [];
    linesCacheRef.current.set(key, rows);
    return rows;
  }, []);

  const fetchSupersedeChain = useCallback(async ({ claimType, currentId }) => {
    const key = `${claimType}:${currentId}`;
    const cached = chainCacheRef.current.get(key);
    if (cached) return cached;
    const { data, error: e } = await supabase
      .from(VIEW)
      .select('id, tcn, claim_action_label, claim_action_code, total_charge_amount, claim_payment_amount, claim_allowed_amount, service_date_effective, first_seen_at, last_seen_at, superseded_at')
      .eq('claim_type', claimType)
      .eq('superseded_by_id', currentId)
      .order('first_seen_at', { ascending: false });
    if (e) {
      setError(e.message);
      return [];
    }
    const rows = data || [];
    chainCacheRef.current.set(key, rows);
    return rows;
  }, []);

  const updateNote = useCallback(async ({ claimType, id, notes }) => {
    const table = HEADER_TABLE_BY_TYPE[claimType];
    if (!table) throw new Error(`Unknown claim type: ${claimType}`);
    const { error: e } = await supabase
      .from(table)
      .update({
        reconciliation_notes: notes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    if (e) {
      setError(e.message);
      throw e;
    }
  }, []);

  const matchToPatient = useCallback(async ({ claimType, id, patientId }) => {
    const table = HEADER_TABLE_BY_TYPE[claimType];
    if (!table) throw new Error(`Unknown claim type: ${claimType}`);
    const { error: e } = await supabase
      .from(table)
      .update({
        matched_patient_id: patientId,
        reconciliation_status: 'Matched',
        reconciled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    if (e) {
      setError(e.message);
      throw e;
    }
  }, []);

  const runReconcile = useCallback(async ({ practiceId }) => {
    const calls = Object.values(PARSER_FN_BY_TYPE).map((fnName) =>
      supabase.functions.invoke(fnName, {
        body: { practice_id: practiceId, mode: 'reconcile_only' },
      })
    );
    const results = await Promise.allSettled(calls);
    const summary = { matched: 0, unmatched: 0, errors: [] };
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value && !r.value.error) {
        const recon = r.value.data && r.value.data.reconciliation;
        if (recon) {
          summary.matched   += recon.matched   || 0;
          summary.unmatched += recon.unmatched || 0;
        }
      } else if (r.status === 'rejected') {
        summary.errors.push(r.reason ? r.reason.message : 'unknown');
      } else if (r.value && r.value.error) {
        summary.errors.push(r.value.error.message);
      }
    }
    chainCacheRef.current.clear();
    return summary;
  }, []);

  const fetchSourceFile = useCallback(async (fileId) => {
    const { data, error: e } = await supabase
      .from('cm_inbound_files')
      .select('id, remote_filename, file_type, status, parsed_at, parsed_record_count, parse_error, content_bytes, received_at')
      .eq('id', fileId)
      .single();
    if (e) {
      setError(e.message);
      throw e;
    }
    return data;
  }, []);

  const fetchPatientCandidates = useCallback(async ({ search, limit = 20 }) => {
    let q = supabase
      .from('patients')
      .select('id, first_name, last_name, date_of_birth, medicaid_id')
      .order('last_name', { ascending: true })
      .limit(limit);
    const s = (search || '').trim();
    if (s) {
      const safe = s.replace(/[%,]/g, ' ');
      q = q.or(`last_name.ilike.%${safe}%,first_name.ilike.%${safe}%,medicaid_id.ilike.%${safe}%`);
    }
    const { data, error: e } = await q;
    if (e) {
      setError(e.message);
      return [];
    }
    return data || [];
  }, []);

  const clearCaches = useCallback(() => {
    linesCacheRef.current.clear();
    chainCacheRef.current.clear();
  }, []);

  return {
    loading,
    error,
    fetchClaims,
    fetchDashboard,
    fetchUnmatchedCount,
    fetchLines,
    fetchSupersedeChain,
    updateNote,
    matchToPatient,
    runReconcile,
    fetchSourceFile,
    fetchPatientCandidates,
    clearCaches,
  };
}
