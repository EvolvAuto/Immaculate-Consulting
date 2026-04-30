// Phase 4 Claims UI - shared style constants for Pro / Dental / Inst / Pharmacy.
// Type-driven color ramps. Each type has a dot color, light bg for badges,
// and dark text color for badge labels (always WCAG-compliant on bg).

export const CLAIM_TYPE_COLORS = {
  pro: {
    name: 'Pro',
    dot: '#7F77DD',
    bg: '#EEEDFE',
    text: '#3C3489',
    border: '#CECBF6',
  },
  dental: {
    name: 'Dental',
    dot: '#D4537E',
    bg: '#FBEAF0',
    text: '#72243E',
    border: '#F4C0D1',
  },
  inst: {
    name: 'Inst',
    dot: '#378ADD',
    bg: '#E6F1FB',
    text: '#0C447C',
    border: '#B5D4F4',
  },
  pharmacy: {
    name: 'Pharm',
    dot: '#BA7517',
    bg: '#FAEEDA',
    text: '#633806',
    border: '#FAC775',
  },
};

// Map a claim_action_label to a tone. The tone determines how the badge looks.
// All four "non-original" actions share warning treatment to call attention to
// any change vs the original. Reversal/Void share danger treatment (money
// going away). Original/Bill share neutral (the type color).
export const ACTION_TONE = {
  Original:   'type',     // use the claim type color
  Bill:       'type',     // pharmacy original
  Adjustment: 'warning',  // amounts changed
  Rebill:     'warning',  // amounts changed
  Void:       'danger',   // claim cancelled
  Reversal:   'danger',   // claim reversed
};

export const TONE_COLORS = {
  warning: { bg: '#FAEEDA', text: '#633806', border: '#FAC775' },
  danger:  { bg: '#FCEBEB', text: '#791F1F', border: '#F7C1C1' },
  neutral: { bg: '#F1EFE8', text: '#444441', border: '#D3D1C7' },
};

// Helpers
export function getActionBadgeColors(claimType, actionLabel) {
  const tone = ACTION_TONE[actionLabel] || 'type';
  if (tone === 'type') {
    const t = CLAIM_TYPE_COLORS[claimType] || CLAIM_TYPE_COLORS.pro;
    return { bg: t.bg, text: t.text, border: t.border };
  }
  return TONE_COLORS[tone];
}

// Inline style fragments reused across components.
export const SHARED = {
  card: {
    background: '#FFFFFF',
    border: '0.5px solid rgba(10, 34, 24, 0.15)',
    borderRadius: 8,
  },
  cardHeader: {
    padding: '12px 14px',
  },
  cardBody: {
    padding: '12px 14px',
  },
  badgePill: {
    display: 'inline-block',
    fontSize: 11,
    padding: '2px 8px',
    borderRadius: 999,
    fontWeight: 500,
    lineHeight: 1.4,
  },
  iconBtn: {
    fontSize: 12,
    padding: '5px 10px',
    background: 'transparent',
    border: '0.5px solid rgba(10, 34, 24, 0.3)',
    borderRadius: 8,
    cursor: 'pointer',
  },
  filledBtn: {
    fontSize: 12,
    padding: '6px 12px',
    background: '#0F6E56',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    fontWeight: 500,
  },
  mono: {
    fontFamily: '"SF Mono", Menlo, Consolas, monospace',
  },
  num: {
    fontVariantNumeric: 'tabular-nums',
  },
};
