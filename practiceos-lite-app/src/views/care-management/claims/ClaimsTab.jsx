// ClaimsTab - the CM-level Claims surface, rendered as a tab inside
// CareManagementView. Self-contained: includes toolbar, dashboard cards,
// filter rows, list, and per-row expand panel.
//
// Props:
//   practiceId          - required
//   onUnmatchedChange   - optional (count) => void; called every refresh
//                         so the parent can update the tab badge

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import useClaimsData from '../../../lib/useClaimsData';
import ClaimRow from './ClaimRow';
import ClaimDetailPanel from './ClaimDetailPanel';
import { CLAIM_TYPE_COLORS, SHARED } from './styles';
import { formatCurrency } from './utils';
import { exportClaimsCSV, printClaims } from './claimsExport';

const TYPE_FILTERS = [
  { key: 'all',      label: 'All',           value: null       },
  { key: 'pro',      label: 'Professional',  value: 'pro'      },
  { key: 'dental',   label: 'Dental',        value: 'dental'   },
  { key: 'inst',     label: 'Institutional', value: 'inst'     },
  { key: 'pharmacy', label: 'Pharmacy',      value: 'pharmacy' },
];

const ACTION_CHIPS = [
  { key: 'all',         label: 'All',         apply: { actionLabel: null, reconStatus: null } },
  { key: 'Original',    label: 'Original',    apply: { actionLabel: 'Original'   } },
  { key: 'Adjustment',  label: 'Adjustment',  apply: { actionLabel: 'Adjustment' } },
  { key: 'Void',        label: 'Void',        apply: { actionLabel: 'Void'       } },
  { key: 'Bill',        label: 'Bill',        apply: { actionLabel: 'Bill'       } },
  { key: 'Reversal',    label: 'Reversal',    apply: { actionLabel: 'Reversal'   } },
  { key: 'Rebill',      label: 'Rebill',      apply: { actionLabel: 'Rebill'     } },
  { key: 'Unmatched',   label: 'Unmatched',   apply: { actionLabel: null, reconStatus: 'Unmatched' }, tone: 'warning' },
];

const DATE_PRESETS = [
  { key: 'last30',     label: 'Service date \u00B7 last 30 days' },
  { key: 'thisMonth',  label: 'This month'                       },
  { key: 'thisYear',   label: 'This year'                        },
  { key: 'lastYear',   label: 'Last year'                        },
  { key: 'all',        label: 'All time'                         },
];

const PAID_PRESETS = [
  { key: 'any',    label: 'Paid \u00B7 any',          range: { min: null, max: null } },
  { key: 'zero',   label: '$0 (denied / void)',       range: { min: 0,    max: 0    } },
  { key: 'micro',  label: '$1 \u2013 $100',           range: { min: 0.01, max: 100  } },
  { key: 'small',  label: '$100 \u2013 $1,000',       range: { min: 100,  max: 1000 } },
  { key: 'large',  label: 'Over $1,000',              range: { min: 1000, max: null } },
];

function dateRangeFromPreset(key) {
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  if (key === 'last30') {
    const d = new Date(); d.setUTCDate(d.getUTCDate() - 30);
    return { from: iso(d), to: null };
  }
  if (key === 'thisMonth') {
    return { from: iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))), to: null };
  }
  if (key === 'thisYear') {
    return { from: today.getUTCFullYear() + '-01-01', to: null };
  }
  if (key === 'lastYear') {
    const y = today.getUTCFullYear() - 1;
    return { from: y + '-01-01', to: y + '-12-31' };
  }
  return { from: null, to: null };
}

// ----- internal sub-components -----

function Toolbar({ lastSyncedAt, onRefresh, onReconcile, onCSV, onPrint, refreshing, reconcileBusy }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 500 }}>Claims</div>
        <div style={{ fontSize: 12, color: '#5F5E5A', marginTop: 2 }}>
          {lastSyncedAt ? 'Last sync ' + lastSyncedAt : 'Sync pending'}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button onClick={onRefresh} disabled={refreshing} style={SHARED.iconBtn}>
          {refreshing ? '...' : '\u21BB Refresh'}
        </button>
        <button onClick={onReconcile} disabled={reconcileBusy} style={SHARED.iconBtn}>
          {reconcileBusy ? 'Reconciling...' : 'Run reconcile'}
        </button>
        <button onClick={onCSV} style={SHARED.iconBtn}>
          {'\u2193 CSV'}
        </button>
        <button onClick={onPrint} style={SHARED.iconBtn}>
          {'\u2399 PDF'}
        </button>
      </div>
    </div>
  );
}

function DashboardCard({ label, value, active, warning, onClick, valueFmt }) {
  const isWarning = !!warning;
  const bg = active
    ? (isWarning ? '#FAEEDA' : '#E6F1FB')
    : (isWarning ? '#FFFFFF' : '#F1EFE8');
  const fg = isWarning ? '#854F0B' : '#185FA5';
  const border = active
    ? (isWarning ? '0.5px solid #FAC775' : '0.5px solid #B5D4F4')
    : (isWarning ? '0.5px solid #FAC775' : 'none');
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
      style={{
        background: bg,
        border,
        borderRadius: 8,
        padding: '8px 10px',
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      <div style={{
        fontSize: 11,
        color: active ? fg : '#5F5E5A',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span>{label}</span>
        {active && <span style={{ fontSize: 10 }}>filtered &bull;</span>}
      </div>
      <div style={{
        fontSize: 18,
        fontWeight: 500,
        color: active ? fg : (isWarning ? '#854F0B' : '#0A2218'),
        ...SHARED.num,
      }}>
        {valueFmt ? valueFmt(value) : value}
      </div>
    </div>
  );
}

function TypeFilterRow({ value, onChange, counts }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#888780', margin: '14px 0 4px', textTransform: 'lowercase', letterSpacing: '0.02em' }}>
        type
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {TYPE_FILTERS.map((tf) => {
          const active = (value || null) === tf.value;
          const colors = tf.value ? CLAIM_TYPE_COLORS[tf.value] : null;
          const count = counts && tf.value ? counts[tf.value] : (tf.value === null ? counts && counts.all : undefined);
          return (
            <button
              key={tf.key}
              onClick={() => onChange(tf.value)}
              style={{
                fontSize: 12,
                padding: '4px 10px',
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
              {count !== undefined && count !== null ? ' ' + count : ''}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ActionFilterRow({ activeKey, onChange }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#888780', margin: '12px 0 4px', textTransform: 'lowercase', letterSpacing: '0.02em' }}>
        action / status
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {ACTION_CHIPS.map((c) => {
          const active = activeKey === c.key;
          const isWarn = c.tone === 'warning';
          let style;
          if (active && isWarn) {
            style = { background: '#FAEEDA', color: '#854F0B', border: '0.5px solid #FAC775' };
          } else if (active) {
            style = { background: '#E6F1FB', color: '#185FA5', border: 'none' };
          } else if (isWarn) {
            style = { background: 'transparent', color: '#854F0B', border: '0.5px solid #FAC775' };
          } else {
            style = { background: 'transparent', color: '#0A2218', border: '0.5px solid rgba(10, 34, 24, 0.15)' };
          }
          return (
            <button
              key={c.key}
              onClick={() => onChange(c)}
              style={{
                fontSize: 12,
                padding: '4px 10px',
                borderRadius: 999,
                cursor: 'pointer',
                ...style,
              }}
            >
              {c.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ----- main component -----

export default function ClaimsTab({ practiceId, onUnmatchedChange }) {
  const api = useClaimsData();

  const [claims, setClaims]           = useState([]);
  const [dash, setDash]               = useState({ total: 0, current: 0, superseded: 0, unmatched: 0, paidYtd: 0 });
  const [typeCounts, setTypeCounts]   = useState({ all: 0, pro: 0, dental: 0, inst: 0, pharmacy: 0 });
  const [expandedId, setExpandedId]   = useState(null);
  const [refreshing, setRefreshing]   = useState(false);
  const [reconcileBusy, setReconcileBusy] = useState(false);
  const [lastSyncedAt, setLastSyncedAt]   = useState(null);
  const [toast, setToast]             = useState(null);

  const [view, setView]               = useState('current');     // 'current' | 'superseded' | 'unmatched'
  const [typeFilter, setTypeFilter]   = useState(null);          // null | 'pro' | 'dental' | 'inst' | 'pharmacy'
  const [actionChipKey, setActionChipKey] = useState('all');
  const [datePreset, setDatePreset]   = useState('last30');
  const [paidPreset, setPaidPreset]   = useState('any');
  const [search, setSearch]           = useState('');

  // Build the filter object for fetchClaims based on current state
  const buildFilters = useCallback(() => {
    const dateR = dateRangeFromPreset(datePreset);
    const paidR = (PAID_PRESETS.find((p) => p.key === paidPreset) || PAID_PRESETS[0]).range;
    const chip = ACTION_CHIPS.find((c) => c.key === actionChipKey) || ACTION_CHIPS[0];

    const filters = {
      claimType:    typeFilter,
      actionLabel:  chip.apply.actionLabel,
      reconStatus:  chip.apply.reconStatus || null,
      serviceFrom:  dateR.from,
      serviceTo:    dateR.to,
      paidMin:      paidR.min,
      paidMax:      paidR.max,
      search,
      currentOnly:    view === 'current',
      supersededOnly: view === 'superseded',
    };
    if (view === 'unmatched') {
      filters.reconStatus = 'Unmatched';
      filters.currentOnly = true;
    }
    return filters;
  }, [view, typeFilter, actionChipKey, datePreset, paidPreset, search]);

  // Type counts for the type filter row labels
  const refreshTypeCounts = useCallback(async () => {
    // For lightweight badge counts, skip filters except practice scope
    try {
      const [all, pro, dental, inst, pharm] = await Promise.all([
        api.fetchClaims({ currentOnly: true, limit: 1 }).then((r) => r.length).catch(() => 0),
        api.fetchClaims({ currentOnly: true, claimType: 'pro',      limit: 1000 }).then((r) => r.length).catch(() => 0),
        api.fetchClaims({ currentOnly: true, claimType: 'dental',   limit: 1000 }).then((r) => r.length).catch(() => 0),
        api.fetchClaims({ currentOnly: true, claimType: 'inst',     limit: 1000 }).then((r) => r.length).catch(() => 0),
        api.fetchClaims({ currentOnly: true, claimType: 'pharmacy', limit: 1000 }).then((r) => r.length).catch(() => 0),
      ]);
      setTypeCounts({ all: pro + dental + inst + pharm, pro, dental, inst, pharmacy: pharm });
    } catch (e) {
      // ignore
    }
  }, [api]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [list, dashboard] = await Promise.all([
        api.fetchClaims(buildFilters()),
        api.fetchDashboard(),
      ]);
      setClaims(list);
      setDash(dashboard);
      setLastSyncedAt(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
      if (onUnmatchedChange) onUnmatchedChange(dashboard.unmatched);
    } catch (e) {
      setToast({ kind: 'error', text: 'Failed to load claims: ' + (e.message || 'unknown') });
    } finally {
      setRefreshing(false);
    }
  }, [api, buildFilters, onUnmatchedChange]);

  // Initial load + reload on filter change
  useEffect(() => { refresh(); }, [refresh]);
  // Initial type counts (rare refresh)
  useEffect(() => { refreshTypeCounts(); }, [refreshTypeCounts]);

  const handleCardClick = (cardKey) => {
    if (cardKey === 'paidYtd') return; // YTD is informational only
    setView((cur) => (cur === cardKey ? 'current' : cardKey));
    if (cardKey === 'unmatched') {
      setActionChipKey('all'); // status now driven by view
    }
  };

  const handleActionChip = (chip) => {
    setActionChipKey(chip.key);
  };

  const handleRunReconcile = async () => {
    setReconcileBusy(true);
    try {
      const res = await api.runReconcile({ practiceId });
      setToast({
        kind: res.errors.length ? 'warn' : 'ok',
        text: 'Reconcile complete: ' + res.matched + ' matched, ' + res.unmatched + ' unmatched'
            + (res.errors.length ? ' (' + res.errors.length + ' errors)' : ''),
      });
      api.clearCaches();
      await refresh();
    } catch (e) {
      setToast({ kind: 'error', text: 'Reconcile failed: ' + (e.message || 'unknown') });
    } finally {
      setReconcileBusy(false);
    }
  };

  const handleAfterMatch = useCallback(async () => {
    setExpandedId(null);
    api.clearCaches();
    await refresh();
  }, [api, refresh]);

  const subtitle = useMemo(() => {
    const parts = ['Smith Family Medicine']; // TODO: pull practice name from a parent prop or context
    if (typeFilter)             parts.push(CLAIM_TYPE_COLORS[typeFilter].name);
    if (view !== 'current')     parts.push(view);
    if (actionChipKey !== 'all') parts.push(actionChipKey.toLowerCase());
    return parts.join(' \u00B7 ');
  }, [typeFilter, view, actionChipKey]);

  return (
    <div>

      {toast && (
        <div style={{
          padding: '8px 12px',
          marginBottom: 10,
          borderRadius: 8,
          background: toast.kind === 'error' ? '#FCEBEB' : (toast.kind === 'warn' ? '#FAEEDA' : '#E1F5EE'),
          color:      toast.kind === 'error' ? '#791F1F' : (toast.kind === 'warn' ? '#854F0B' : '#085041'),
          fontSize: 12,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span>{toast.text}</span>
          <button onClick={() => setToast(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 14 }}>&times;</button>
        </div>
      )}

      <div style={{ ...SHARED.card, padding: '12px 14px', marginBottom: 12 }}>
        <Toolbar
          lastSyncedAt={lastSyncedAt}
          refreshing={refreshing}
          reconcileBusy={reconcileBusy}
          onRefresh={refresh}
          onReconcile={handleRunReconcile}
          onCSV={() => exportClaimsCSV(claims)}
          onPrint={() => printClaims(claims, { title: 'Claims report', subtitle, dashboard: dash })}
        />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          <DashboardCard
            label="Current"
            value={dash.current}
            active={view === 'current'}
            onClick={() => handleCardClick('current')}
          />
          <DashboardCard
            label="Superseded"
            value={dash.superseded}
            active={view === 'superseded'}
            onClick={() => handleCardClick('superseded')}
          />
          <DashboardCard
            label="Paid YTD"
            value={dash.paidYtd}
            valueFmt={(v) => formatCurrency(v, { compact: true })}
            active={false}
            onClick={() => handleCardClick('paidYtd')}
          />
          <DashboardCard
            label="Unmatched"
            value={dash.unmatched}
            active={view === 'unmatched'}
            warning
            onClick={() => handleCardClick('unmatched')}
          />
        </div>

        <TypeFilterRow value={typeFilter} onChange={setTypeFilter} counts={typeCounts} />
        <ActionFilterRow activeKey={actionChipKey} onChange={handleActionChip} />

        <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={datePreset}
            onChange={(e) => setDatePreset(e.target.value)}
            style={{ fontSize: 12, height: 30, padding: '0 8px', minWidth: 180 }}
          >
            {DATE_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          <select
            value={paidPreset}
            onChange={(e) => setPaidPreset(e.target.value)}
            style={{ fontSize: 12, height: 30, padding: '0 8px', minWidth: 150 }}
          >
            {PAID_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          <input
            type="search"
            placeholder="Patient, TCN, or rx#"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 160, fontSize: 12, height: 30, padding: '0 10px', boxSizing: 'border-box' }}
          />
        </div>
      </div>

      <div style={{ ...SHARED.card, overflow: 'hidden' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '24px 1fr 90px 110px 90px 24px',
          gap: 8,
          alignItems: 'center',
          padding: '8px 14px',
          fontSize: 11,
          color: '#888780',
          borderBottom: '0.5px solid rgba(10, 34, 24, 0.15)',
          textTransform: 'lowercase',
          letterSpacing: '0.02em',
        }}>
          <div></div>
          <div>patient \u00B7 tcn \u00B7 payer</div>
          <div>service date</div>
          <div>action / status</div>
          <div style={{ textAlign: 'right' }}>paid</div>
          <div></div>
        </div>

        {claims.length === 0 && !refreshing && (
          <div style={{ padding: 24, textAlign: 'center', color: '#888780', fontSize: 13 }}>
            No claims match the current filters.
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
              showPatient={true}
            >
              {expanded && (
                <ClaimDetailPanel
                  row={row}
                  api={api}
                  onAfterMatch={handleAfterMatch}
                />
              )}
            </ClaimRow>
          );
        })}
      </div>
    </div>
  );
}
