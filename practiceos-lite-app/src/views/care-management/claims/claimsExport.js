// Phase 4 Claims UI - CSV + Print PDF helpers.
// No external dependencies. Print uses a popup window with window.print()
// so output is a clean printable layout without polluting the host page.

import { formatDateLong, formatCurrency } from './utils';

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

const CSV_HEADERS = [
  'Type',
  'TCN',
  'Patient',
  'CNDS',
  'Payer',
  'Service date',
  'Action',
  'Reconcile status',
  'Charge',
  'Allowed',
  'Paid',
  'Superseded',
  'Notes',
];

function rowToCsvCells(r) {
  return [
    r.claim_type,
    r.tcn,
    r.patient_full_name || '',
    r.subscriber_cnds || '',
    r.payer_short_name || '',
    r.service_date_effective || '',
    r.claim_action_label || '',
    r.reconciliation_status || '',
    r.total_charge_amount != null ? r.total_charge_amount : '',
    r.claim_allowed_amount != null ? r.claim_allowed_amount : '',
    r.claim_payment_amount != null ? r.claim_payment_amount : '',
    r.superseded_by_id ? 'yes' : 'no',
    r.reconciliation_notes || '',
  ];
}

export function exportClaimsCSV(rows, filename) {
  const lines = [CSV_HEADERS.map(csvEscape).join(',')];
  for (const r of rows) {
    lines.push(rowToCsvCells(r).map(csvEscape).join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || ('claims-' + new Date().toISOString().slice(0, 10) + '.csv');
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

const PRINT_STYLES = [
  'body { font-family: Inter, system-ui, sans-serif; padding: 24px; color: #0A2218; }',
  'h1 { font-size: 18px; font-weight: 500; margin: 0 0 4px; }',
  '.sub { color: #5F5E5A; font-size: 12px; margin-bottom: 16px; }',
  '.summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 12px 0 18px; }',
  '.metric { background: #F1EFE8; border-radius: 6px; padding: 8px 10px; }',
  '.metric .label { font-size: 11px; color: #5F5E5A; }',
  '.metric .value { font-size: 14px; font-weight: 500; }',
  'table { width: 100%; border-collapse: collapse; font-size: 11px; }',
  'th { text-align: left; padding: 6px 8px; border-bottom: 1px solid #888780; font-weight: 500; color: #5F5E5A; }',
  'td { padding: 6px 8px; border-bottom: 0.5px solid #D3D1C7; vertical-align: top; }',
  'td.num { text-align: right; font-variant-numeric: tabular-nums; }',
  '.dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }',
  '.dot.pro      { background: #7F77DD; }',
  '.dot.dental   { background: #D4537E; }',
  '.dot.inst     { background: #378ADD; }',
  '.dot.pharmacy { background: #BA7517; }',
  '.muted { color: #5F5E5A; }',
  '.unm { color: #854F0B; }',
  '@page { margin: 14mm 10mm; }',
].join(' ');

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function rowToPrintHtml(r) {
  const charge  = r.total_charge_amount   != null ? formatCurrency(r.total_charge_amount)   : '';
  const allowed = r.claim_allowed_amount  != null ? formatCurrency(r.claim_allowed_amount)  : '';
  const paid    = r.claim_payment_amount  != null ? formatCurrency(r.claim_payment_amount)  : '';
  const dateStr = r.service_date_effective ? formatDateLong(r.service_date_effective) : '';
  const isUnm   = r.reconciliation_status === 'Unmatched';
  const patient = isUnm
    ? '<span class="unm">Unmatched</span> <span class="muted">CNDS ' + escapeHtml(r.subscriber_cnds || '?') + '</span>'
    : escapeHtml(r.patient_full_name || ('CNDS ' + (r.subscriber_cnds || '?')));
  return [
    '<tr>',
      '<td><span class="dot ', escapeHtml(r.claim_type), '"></span>', escapeHtml(r.claim_type), '</td>',
      '<td>', escapeHtml(r.tcn), '</td>',
      '<td>', patient, '</td>',
      '<td>', escapeHtml(r.payer_short_name || ''), '</td>',
      '<td>', escapeHtml(dateStr), '</td>',
      '<td>', escapeHtml(r.claim_action_label || ''), '</td>',
      '<td class="num">', escapeHtml(charge),  '</td>',
      '<td class="num">', escapeHtml(allowed), '</td>',
      '<td class="num">', escapeHtml(paid),    '</td>',
    '</tr>',
  ].join('');
}

function summaryHtml(opts) {
  const items = [
    { label: 'Rows',         value: String(opts.rowCount || 0) },
    { label: 'Current',      value: String(opts.dashboard ? opts.dashboard.current     : '') },
    { label: 'Superseded',   value: String(opts.dashboard ? opts.dashboard.superseded  : '') },
    { label: 'Unmatched',    value: String(opts.dashboard ? opts.dashboard.unmatched   : '') },
  ];
  return [
    '<div class="summary">',
    items.map(function (i) {
      return '<div class="metric"><div class="label">' + escapeHtml(i.label) + '</div><div class="value">' + escapeHtml(i.value) + '</div></div>';
    }).join(''),
    '</div>',
  ].join('');
}

export function printClaims(rows, opts) {
  opts = opts || {};
  const win = window.open('', '_blank', 'width=980,height=720');
  if (!win) {
    alert('Could not open print window. Please disable popup blockers.');
    return;
  }
  const title       = opts.title       || 'Claims report';
  const subtitle    = opts.subtitle    || '';
  const generatedAt = new Date().toLocaleString();
  const summary     = opts.dashboard ? summaryHtml({ rowCount: rows.length, dashboard: opts.dashboard }) : '';
  const headerCols  = ['Type', 'TCN', 'Patient', 'Payer', 'Service date', 'Action', 'Charge', 'Allowed', 'Paid'];
  const bodyHtml    = rows.map(rowToPrintHtml).join('');
  const html = [
    '<!doctype html><html><head><meta charset="utf-8"><title>', escapeHtml(title), '</title>',
    '<style>', PRINT_STYLES, '</style></head><body>',
    '<h1>', escapeHtml(title), '</h1>',
    '<div class="sub">', escapeHtml(subtitle), subtitle ? ' &middot; ' : '', 'Generated ', escapeHtml(generatedAt), '</div>',
    summary,
    '<table>',
      '<thead><tr>', headerCols.map(function (h) { return '<th>' + escapeHtml(h) + '</th>'; }).join(''), '</tr></thead>',
      '<tbody>', bodyHtml, '</tbody>',
    '</table>',
    '</body></html>',
  ].join('');
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  // Give the new window a tick to layout before invoking print
  setTimeout(function () {
    try { win.print(); } catch (e) { console.error('print failed', e); }
  }, 350);
}
