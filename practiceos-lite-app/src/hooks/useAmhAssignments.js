// src/hooks/useAmhAssignments.js
//
// Data hook for the AMH Plan Assignments tab.
// Reads from cm_amh_member_assignments (Phase 3 schema).
//
// Returns:
//   rows       - all assignment segments for this practice, newest segment first
//   loading    - true while initial fetch is in flight
//   error      - error message string or null
//   kpis       - computed counts for the dashboard strip
//   lastSync   - latest received_at from any source file
//   refetch()  - reload after a re-poll/re-parse
//
// Adjust the supabase import path to match your project layout.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

const SELECT_COLUMNS = [
  "id",
  "practice_id",
  "cnds_id",
  "payer_short_name",
  "is_full_file",
  "member_first_name",
  "member_middle_name",
  "member_last_name",
  "member_dob",
  "member_gender_code",
  "member_phone",
  "res_address_line1",
  "res_city",
  "res_state",
  "res_zip",
  "res_county_code",
  "plan_coverage_description",
  "tailored_plan_eligibility",
  "managed_care_status_code",
  "eligibility_status_code",
  "enrollment_start_date",
  "enrollment_end_date",
  "php_organization_name",
  "php_eligibility_begin_date",
  "php_eligibility_end_date",
  "amh_first_name",
  "amh_last_name",
  "amh_identification_code",
  "amh_begin_date",
  "amh_end_date",
  "pcp_first_name",
  "pcp_last_name",
  "pcp_identification_code",
  "pcp_begin_date",
  "pcp_end_date",
  "maintenance_type_code",
  "new_eligibility_indicator",
  "php_amh_pcp_type_and_tier",
  "tribal_option_indicator",
  "indian_health_service_indicator",
  "matched_patient_id",
  "reconciliation_status",
  "reconciled_at",
  "reconciliation_notes",
  "first_seen_file_id",
  "first_seen_at",
  "last_seen_file_id",
  "last_seen_at",
  "times_seen",
  "source_record_index",
].join(", ");

export function useAmhAssignments(practiceId) {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const fetchAll = useCallback(async () => {
    if (!practiceId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    const { data, error: err } = await supabase
      .from("cm_amh_member_assignments")
      .select(SELECT_COLUMNS)
      .eq("practice_id", practiceId)
      .order("php_eligibility_begin_date", { ascending: false, nullsFirst: false })
      .order("last_seen_at", { ascending: false });

    if (err) {
      setError(err.message || "Failed to load plan assignments");
      setRows([]);
    } else {
      setRows(data || []);
    }
    setLoading(false);
  }, [practiceId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // KPI strip: total, new this week, terminated, unmatched
  const kpis = useMemo(() => {
    const total = rows.length;

    // "new this week" = maintenance_type_code = 021 (new recipient)
    // AND last_seen_at within last 8 days. Most files arrive Sunday or Tuesday.
    const sevenDaysAgo = Date.now() - (8 * 24 * 60 * 60 * 1000);
    const newThisWeek = rows.filter(r =>
      r.maintenance_type_code === "021"
      && r.last_seen_at
      && new Date(r.last_seen_at).getTime() >= sevenDaysAgo
    ).length;

    const terminated = rows.filter(r => r.maintenance_type_code === "024").length;

    const unmatched = rows.filter(r =>
      r.reconciliation_status === "Unmatched" || r.reconciliation_status === "Pending"
    ).length;

    const planCount = new Set(rows.map(r => r.payer_short_name)).size;

    return { total, newThisWeek, terminated, unmatched, planCount };
  }, [rows]);

  // Latest received_at across all source files (for header sync hint)
  const lastSync = useMemo(() => {
    let latest = null;
    for (const r of rows) {
      const t = r.last_seen_at ? new Date(r.last_seen_at).getTime() : 0;
      if (!latest || t > latest) latest = t;
    }
    return latest ? new Date(latest) : null;
  }, [rows]);

  return { rows, loading, error, kpis, lastSync, refetch: fetchAll };
}
