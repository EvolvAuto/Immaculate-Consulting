// PatientClaimsTab - the patient-chart Claims tab. Reuses ClaimRow and
// ClaimDetailPanel. Filters are scoped to a single patient_id. No
// reconciliation, no match-to-patient (chart context implies a matched
// patient).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import useClaimsData from '../../../lib/useClaimsData';
import ClaimRow from './ClaimRow';
import ClaimDetailPanel from './ClaimDetailPanel';
import { CLAIM_TYPE_COLORS, SHARED } from './styles';
import { formatCurrency } from './utils';
import { exportClaimsCSV, printClaims } from './claimsExport';

const TYPE_FILTERS = [
  { key: 'all',      label: 'All',     value: null },
  { key: 'pro',      label: 'Pro',     value: 'pro' },
  { key: 'dental',   label: 'Dental',  value: 'dental' },
  { key: 'inst',     label: 'Inst',    value: 'inst' },
  { key: 'pharmacy', label: 'Pharm',   value: 'pharmacy' },
];

const ACTION_OPTIONS = [
  { value: '',           label: 'All actions' },
  { value: 'Original',   label: 'Original'    },
  { value: 'Adjustment', label: 'Adjustment'  },
  { value: 'Void',       label: 'Void'        },
  { value: 'Bill',       label: 'Bill'        },
  { value: 'Reversal',   label: 'Reversal'    },
  { value: 'Rebill',     label: 'Rebill'      },
];

const DATE_OPTIONS = [
  { value: 'last12mo', label: 'Date \u00B7 last 12 months' },
  { value: 'thisYear', label: 'This year' },
  { value: 'all',      label: 'All time' },
];

function dateFromPreset(key) {
  const today = new Date();
  if (key === 'last12mo') {
    const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - 1);
    return { from: d.toISOString().slice(0, 10), to: null };
  }
  if (key === 'thisYear') return { from: today.getUTCFullYear() + '-01-01', to: null };
  return { from: null, to: null };
}

export default function PatientClaimsTab({ patientId, patientName }) {
  const api = useClaimsData();
  const [claims, setClaims]         = useState([]);
  const [paidYtd, setPaidYtd]       = useState(0);
  const [expandedId, setExpandedId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const [typeFilter, setTypeFilter]     = useState(null);
  const [actionFilter, setActionFilter] = useState('');
  const [datePreset, setDatePreset]     = useState('last12mo');
  const [search, setSearch]             = useState('');

  const buildFilters = useCallback(() => {
    const dateR = dateFromPreset(datePreset);
    return {
      patientId,
      claimType:   typeFilter,
      actionLabel: actionFilter || null,
      serviceFrom: dateR.from,
      serviceTo:   dateR.to,
      search,
      currentOnly: true,
    };
  }, [patientId, typeFilter, actionFilter, datePreset, search]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const list = await api.fetchClaims(buildFilters());
      setClaims(list);
      // Compute YTD sum from current rows in current year
      const yearStart = new Date().getUTCFullYear() + '-01-01';
      const ytd = list
        .filter((r) => r.date_of_payment && r.date_of_payment >= yearStart)
        .reduce((acc, r) => acc + Number(r.claim_payment_amount || 0), 0);
      setPaidYtd(ytd);
    } finally {
      setRefreshing(false);
    }
  }, [api, buildFilters]);

  useEffect(() => { refresh(); }, [refresh]);

  const subtitle = useMemo(() => {
    const parts = [];
    if (patientName) parts.push(patientName);
    if (typeFilter)  parts.push(CLAIM_TYPE_COLORS[typeFilter].name);
    if (actionFilter) parts.push(actionFilter.toLowerCase());
    return parts.join(' \u00B7 ');
  }, [patientName, typeFilter, actionFilter]);

  return (
    <div>
      <div style={{ ...SHARED.card, padding: '12px 14px', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 12, color: '#888780' }}>
            {patientName ? 'Claims for ' + patientName : 'Claims for this patient'}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={refresh} disabled={refreshing} style={SHARED.iconBtn}>
              {refreshing ? '...' : '\u21BB'}
            </button>
            <button
              onClick={() => printClaims(claims, { title: 'Claims for ' + (patientName || 'patient'), subtitle })}
              style={SHARED.iconBtn}
            >
              {'\u2399 PDF'}
            </button>
            <button
              onClick={() => exportClaimsCSV(claims, 'claims-' + (patientName || 'patient').replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.csv')}
              style={SHARED.iconBtn}
            >
              {'\u2193 CSV'}
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {TYPE_FILTERS.map((tf) => {
            const active = (typeFilter || null) === tf.value;
            const colors = tf.value ? CLAIM_TYPE_COLORS[tf.value] : null;
            return (
              <button
                key={tf.key}
                onClick={() => setTypeFilter(tf.value)}
                style={{
                  fontSize: 12,
                  padding: '3px 10px',
                  borderRadius: 999,
                  background: active ? '#E6F1FB' : 'transparent',
                  color: active ? '#185FA5' : '#0A2218',
                  border: active ? 'none' : '0.5px solid rgba(10, 34, 24, 0.15)',
                  cursor: 'pointer',
                }}
              >
                {colors && (
                  <span style={{
                    display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                    background: colors.dot, marginRight: 6, verticalAlign: 'middle',
                  }} />
                )}
                {tf.label}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={datePreset}
            onChange={(e) => setDatePreset(e.target.value)}
            style={{ fontSize: 12, height: 28, padding: '0 8px', minWidth: 160 }}
          >
            {DATE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            style={{ fontSize: 12, height: 28, padding: '0 8px' }}
          >
            {ACTION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <input
            type="search"
            placeholder="TCN or rx#"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 140, fontSize: 12, height: 28, padding: '0 10px', boxSizing: 'border-box' }}
          />
          <span style={{ fontSize: 11, color: '#888780' }}>paid YTD</span>
          <span style={{ fontSize: 13, fontWeight: 500, ...SHARED.num }}>
            {formatCurrency(paidYtd)}
          </span>
        </div>
      </div>

      <div style={{ ...SHARED.card, overflow: 'hidden' }}>
        {claims.length === 0 && !refreshing && (
          <div style={{ padding: 24, textAlign: 'center', color: '#888780', fontSize: 13 }}>
            No claims found for this patient.
          </div>
        )}
        {claims.map((row) => {
          const expanded = expandedId === row.id;
          return (
            <ClaimRow
              key={row.id}
              row={row}
              expanded={expanded}
              onToggle={() => setExpandedId(expanded ? null : row.id)}
              showPatient={false}
            >
              {expanded && (
                <ClaimDetailPanel
                  row={row}
                  api={api}
                  onAfterMatch={() => { setExpandedId(null); refresh(); }}
                />
              )}
            </ClaimRow>
          );
        })}
      </div>
    </div>
  );
}
