// ClaimRow - one row in the Claims list. Click to expand into a detail panel.
// Used by both ClaimsTab (CM-level) and PatientClaimsTab (chart-level).
//
// Props:
//   row           - unified view row (from cm_amh_claim_headers_unified)
//   expanded      - boolean
//   onToggle      - () => void
//   showPatient   - boolean (default true; false in patient chart context)
//   priorCount    - number of prior versions in supersede chain (optional cache)
//   children      - rendered inside the expanded panel; usually ClaimDetailPanel

import React from 'react';
import { CLAIM_TYPE_COLORS, getActionBadgeColors, SHARED } from './styles';
import {
  formatDateShort,
  formatCurrency,
  formatPatientLine,
  isUnmatched,
} from './utils';

function buildSecondaryLine(row) {
  const parts = [];
  parts.push(row.tcn);
  if (row.payer_short_name) parts.push(row.payer_short_name);
  return parts.join(' \u00B7 '); // middle-dot
}

function buildTertiaryLine(row, priorCount) {
  const bits = [];
  if (row.claim_type === 'pharmacy' && row.service_provider_id) {
    bits.push(`NPI ${row.service_provider_id}`);
  }
  if (row.claim_type === 'pro' && row.rendering_provider_npi) {
    bits.push(`NPI ${row.rendering_provider_npi}`);
  }
  if (priorCount && priorCount > 0) {
    bits.push(`${priorCount} prior version${priorCount === 1 ? '' : 's'}`);
  }
  return bits.length ? bits.join(' \u00B7 ') : '';
}

export default function ClaimRow(props) {
  const {
    row,
    expanded = false,
    onToggle,
    showPatient = true,
    priorCount = 0,
    children,
  } = props;

  const typeColors = CLAIM_TYPE_COLORS[row.claim_type] || CLAIM_TYPE_COLORS.pro;
  const actionColors = getActionBadgeColors(row.claim_type, row.claim_action_label);
  const unmatched = isUnmatched(row);

  // Layout columns: [dot] [body] [date] [action] [paid] [chevron]
  const cols = '24px 1fr 90px 110px 90px 24px';

  const containerStyle = {
    background: expanded
      ? '#F7F6F2'
      : (unmatched ? '#FAEEDA' : '#FFFFFF'),
    borderLeft: unmatched ? '3px solid #BA7517' : 'none',
    borderBottom: '0.5px solid rgba(10, 34, 24, 0.15)',
    cursor: 'pointer',
    transition: 'background 120ms ease',
  };

  const tertiary = buildTertiaryLine(row, priorCount);
  const paidDisplay = row.claim_payment_amount != null
    ? formatCurrency(row.claim_payment_amount)
    : (row.total_charge_amount != null ? formatCurrency(row.total_charge_amount) : '');

  return (
    <div style={containerStyle}>
      <div
        onClick={onToggle}
        style={{
          display: 'grid',
          gridTemplateColumns: cols,
          gap: 8,
          alignItems: 'center',
          padding: unmatched ? '12px 14px 12px 11px' : '12px 14px',
        }}
      >
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: typeColors.dot,
        }} />

        <div>
          {showPatient && (
            <div style={{
              fontSize: 13,
              fontWeight: 500,
              color: unmatched ? '#854F0B' : '#0A2218',
            }}>
              {unmatched ? `Unmatched \u00B7 CNDS ${row.subscriber_cnds || '?'}` : formatPatientLine(row)}
            </div>
          )}
          <div style={{
            fontSize: 11,
            color: '#5F5E5A',
            ...SHARED.mono,
            marginTop: showPatient ? 2 : 0,
            fontWeight: showPatient ? 400 : 500,
          }}>
            {buildSecondaryLine(row)}
          </div>
          {tertiary && (
            <div style={{ fontSize: 11, color: '#888780', marginTop: 2 }}>
              {tertiary}
            </div>
          )}
        </div>

        <div style={{ fontSize: 12, color: '#5F5E5A' }}>
          {formatDateShort(row.service_date_effective)}
        </div>

        <div>
          {unmatched ? (
            <span style={{
              ...SHARED.badgePill,
              background: '#FAEEDA',
              color: '#854F0B',
              border: '0.5px solid #FAC775',
            }}>
              Needs match
            </span>
          ) : row.claim_action_label ? (
            <span style={{
              ...SHARED.badgePill,
              background: actionColors.bg,
              color: actionColors.text,
            }}>
              {row.claim_action_label}
            </span>
          ) : null}
        </div>

        <div style={{
          textAlign: 'right',
          fontSize: 13,
          fontWeight: 500,
          ...SHARED.num,
        }}>
          {paidDisplay}
        </div>

        <div style={{ fontSize: 12, color: '#888780', textAlign: 'center' }}>
          {expanded ? '\u25BE' : '\u25B8'}
        </div>
      </div>

      {expanded && (
        <div style={{ padding: '0 14px 14px 46px' }}>
          {children}
        </div>
      )}
    </div>
  );
}
