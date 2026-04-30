// Phase 4 Claims UI - formatters.

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function formatDateShort(isoDate) {
  if (!isoDate) return '';
  const m = String(isoDate).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(isoDate);
  const year = m[1];
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  if (month < 1 || month > 12) return String(isoDate);
  const now = new Date();
  const sameYear = parseInt(year, 10) === now.getUTCFullYear();
  if (sameYear) return `${MONTHS_SHORT[month - 1]} ${day}`;
  return `${MONTHS_SHORT[month - 1]} ${day}, ${year}`;
}

export function formatDateLong(isoDate) {
  if (!isoDate) return '';
  const m = String(isoDate).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(isoDate);
  return `${MONTHS_SHORT[parseInt(m[2], 10) - 1]} ${parseInt(m[3], 10)}, ${m[1]}`;
}

export function formatCurrency(amount, opts = {}) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return opts.fallback || '';
  const compact = opts.compact && Math.abs(n) >= 1000;
  if (compact) {
    if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    return `$${Math.round(n / 1000)}k`;
  }
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatCurrencyShort(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '';
  if (Math.abs(n) >= 1000) {
    return n.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  }
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatPatientLine(row, fallback = 'Unknown patient') {
  if (row.patient_full_name) return row.patient_full_name;
  if (row.subscriber_first_name || row.subscriber_last_name) {
    return `${row.subscriber_first_name || ''} ${row.subscriber_last_name || ''}`.trim();
  }
  if (row.subscriber_cnds) return `CNDS ${row.subscriber_cnds}`;
  return fallback;
}

export function formatGender(code) {
  if (!code) return '';
  const c = String(code).toUpperCase();
  if (c === 'M') return 'M';
  if (c === 'F') return 'F';
  return c;
}

export function isUnmatched(row) {
  return row.reconciliation_status === 'Unmatched';
}

export function safeArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [v];
}
