// ClaimDetailPanel - expanded view of a claim row.
//
// For Unmatched rows: renders a focused match-to-patient form.
// For all other rows: renders subscriber/provider/dx/dates,
//                     three amount cards, lines mini-table,
//                     supersede chain (if any), and an action bar
//                     (note input + Save + View source).

import React, { useEffect, useState } from 'react';
import { CLAIM_TYPE_COLORS, getActionBadgeColors, SHARED } from './styles';
import {
  formatDateShort,
  formatDateLong,
  formatCurrency,
  formatGender,
  isUnmatched,
} from './utils';

function Field({ label, children }) {
  return (
    <div>
      <div style={{ color: '#888780', fontSize: 11, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12 }}>{children}</div>
    </div>
  );
}

function AmountCard({ label, value }) {
  return (
    <div style={{
      background: '#F1EFE8',
      borderRadius: 8,
      padding: '8px 10px',
    }}>
      <div style={{ fontSize: 11, color: '#5F5E5A' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 500, ...SHARED.num }}>
        {value != null ? formatCurrency(value) : '\u2014'}
      </div>
    </div>
  );
}

function ProLine({ line }) {
  return (
    <>
      <div>
        <div>
          {line.cpt_code || line.procedure_code || ''}
          {line.modifier_1 ? ` ${line.modifier_1}` : ''}
        </div>
        <div style={{ fontSize: 11, color: '#888780' }}>
          {line.service_date ? formatDateShort(line.service_date) : ''}
          {line.service_units ? ` \u00B7 ${line.service_units} unit${line.service_units === 1 ? '' : 's'}` : ''}
        </div>
      </div>
      <div style={{ fontSize: 11, color: '#5F5E5A' }}>{line.place_of_service || ''}</div>
      <div style={{ textAlign: 'right', ...SHARED.num }}>
        {line.total_line_charge_amount != null ? formatCurrency(line.total_line_charge_amount) : ''}
      </div>
      <div style={{ textAlign: 'right', color: '#888780', ...SHARED.num }}>{'\u2014'}</div>
    </>
  );
}

function PharmLine({ line }) {
  return (
    <>
      <div>
        <div>NDC {line.ndc_code || ''}</div>
        <div style={{ fontSize: 11, color: '#888780' }}>
          rx {line.prescription_number || ''}
          {line.fill_number ? ` \u00B7 fill ${line.fill_number}` : ''}
          {line.prescribing_provider_npi ? ` \u00B7 NPI ${line.prescribing_provider_npi}` : ''}
        </div>
      </div>
      <div style={{ fontSize: 11, color: '#5F5E5A' }}>
        {line.quantity_dispensed ? `qty ${line.quantity_dispensed}` : ''}
        {line.days_supply ? ` \u00B7 ${line.days_supply}d` : ''}
      </div>
      <div style={{ textAlign: 'right', ...SHARED.num }}>
        {line.total_line_charge_amount != null ? formatCurrency(line.total_line_charge_amount) : ''}
      </div>
      <div style={{ textAlign: 'right', ...SHARED.num }}>
        {line.line_payment_amount != null ? formatCurrency(line.line_payment_amount) : ''}
      </div>
    </>
  );
}

function GenericLine({ line }) {
  return (
    <>
      <div>
        <div>{line.procedure_code || line.service_code || ''}</div>
        <div style={{ fontSize: 11, color: '#888780' }}>
          {line.service_date ? formatDateShort(line.service_date) : ''}
        </div>
      </div>
      <div style={{ fontSize: 11, color: '#5F5E5A' }}>
        {line.tooth_number ? `tooth ${line.tooth_number}` : ''}
        {line.revenue_code ? `rev ${line.revenue_code}` : ''}
      </div>
      <div style={{ textAlign: 'right', ...SHARED.num }}>
        {line.total_line_charge_amount != null ? formatCurrency(line.total_line_charge_amount) : ''}
      </div>
      <div style={{ textAlign: 'right', ...SHARED.num }}>
        {line.line_payment_amount != null ? formatCurrency(line.line_payment_amount) : ''}
      </div>
    </>
  );
}

function LineRow({ claimType, line }) {
  let body = null;
  if (claimType === 'pharmacy')      body = <PharmLine line={line} />;
  else if (claimType === 'pro')      body = <ProLine line={line} />;
  else                                body = <GenericLine line={line} />;
  return (
    <div style={{
      fontSize: 12,
      padding: '6px 0',
      borderTop: '0.5px solid rgba(10, 34, 24, 0.1)',
      display: 'grid',
      gridTemplateColumns: '24px 1fr 80px 70px 70px',
      gap: 8,
      alignItems: 'center',
    }}>
      <div style={{ color: '#888780', ...SHARED.num }}>{line.line_number}</div>
      {body}
    </div>
  );
}

function SupersedePriorRow({ claimType, prior }) {
  const colors = getActionBadgeColors(claimType, prior.claim_action_label);
  return (
    <div style={{
      background: '#F1EFE8',
      borderRadius: 8,
      padding: '8px 10px',
      display: 'grid',
      gridTemplateColumns: '12px 1fr 80px 90px 70px',
      gap: 10,
      alignItems: 'center',
      fontSize: 12,
      marginBottom: 4,
    }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#B4B2A9' }} />
      <div style={{
        ...SHARED.mono,
        fontSize: 11,
        textDecoration: 'line-through',
        color: '#5F5E5A',
      }}>
        {prior.tcn}
      </div>
      <div style={{ fontSize: 11, color: '#5F5E5A' }}>
        {formatDateShort(prior.first_seen_at)}
      </div>
      <div>
        <span style={{
          ...SHARED.badgePill,
          background: 'transparent',
          color: '#5F5E5A',
          border: '0.5px solid rgba(10, 34, 24, 0.15)',
        }}>
          {prior.claim_action_label || ''}
        </span>
      </div>
      <div style={{ textAlign: 'right', color: '#5F5E5A', ...SHARED.num }}>
        {prior.claim_payment_amount != null
          ? formatCurrency(prior.claim_payment_amount)
          : (prior.total_charge_amount != null ? formatCurrency(prior.total_charge_amount) : '')}
      </div>
    </div>
  );
}

function MatchPanel({ row, candidates, candidateSearch, onSearchChange, onMatch, onViewSource, busy }) {
  const [selectedId, setSelectedId] = useState('');
  return (
    <div style={{
      background: '#FFFFFF',
      borderRadius: 8,
      border: '0.5px solid #FAC775',
      padding: '12px 14px',
    }}>
      <div style={{ fontSize: 12, color: '#5F5E5A', marginBottom: 10 }}>
        No patient matched on CNDS <span style={SHARED.mono}>{row.subscriber_cnds || '?'}</span>.
        Verify the CNDS in your billing system, then match below.
      </div>
      <input
        type="search"
        placeholder="Search patient by name or CNDS..."
        value={candidateSearch}
        onChange={(e) => onSearchChange(e.target.value)}
        style={{ width: '100%', height: 30, fontSize: 12, padding: '0 10px', boxSizing: 'border-box', marginBottom: 8 }}
      />
      {candidates && candidates.length > 0 && (
        <div style={{
          maxHeight: 160,
          overflowY: 'auto',
          border: '0.5px solid rgba(10, 34, 24, 0.15)',
          borderRadius: 8,
          marginBottom: 8,
        }}>
          {candidates.map((p) => (
            <label
              key={p.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 10px',
                fontSize: 12,
                cursor: 'pointer',
                background: selectedId === p.id ? '#E6F1FB' : 'transparent',
              }}
            >
              <input
                type="radio"
                name={`match-${row.id}`}
                value={p.id}
                checked={selectedId === p.id}
                onChange={() => setSelectedId(p.id)}
              />
              <span>{p.last_name}, {p.first_name}</span>
              <span style={{ color: '#888780' }}>
                {p.medicaid_id ? `\u00B7 CNDS ${p.medicaid_id}` : ''}
                {p.date_of_birth ? ` \u00B7 DOB ${formatDateShort(p.date_of_birth)}` : ''}
              </span>
            </label>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button
          onClick={() => selectedId && onMatch(selectedId)}
          disabled={!selectedId || busy}
          style={{
            ...SHARED.filledBtn,
            opacity: !selectedId || busy ? 0.5 : 1,
          }}
        >
          {busy ? 'Matching...' : 'Match to patient'}
        </button>
        <button onClick={onViewSource} style={SHARED.iconBtn}>
          View source &#8599;
        </button>
      </div>
    </div>
  );
}

export default function ClaimDetailPanel(props) {
  const {
    row,
    api,                  // useClaimsData() instance
    onAfterMatch,         // () => void; ClaimsTab refreshes its list
  } = props;

  const [lines, setLines] = useState(null);
  const [chain, setChain] = useState([]);
  const [note, setNote] = useState(row.reconciliation_notes || '');
  const [savingNote, setSavingNote] = useState(false);
  const [matchSearch, setMatchSearch] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [matchBusy, setMatchBusy] = useState(false);

  const unmatched = isUnmatched(row);

  // Lazy fetch: lines + chain on mount (matched only); patient candidates if unmatched.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (unmatched) {
        const cands = await api.fetchPatientCandidates({ search: '' });
        if (!cancelled) setCandidates(cands);
      } else {
        const [ls, ch] = await Promise.all([
          api.fetchLines({ claimType: row.claim_type, practiceId: row.practice_id, tcn: row.tcn }),
          api.fetchSupersedeChain({ claimType: row.claim_type, currentId: row.id }),
        ]);
        if (!cancelled) {
          setLines(ls);
          setChain(ch);
        }
      }
    }
    load();
    return () => { cancelled = true; };
  }, [unmatched, row.id, row.claim_type, row.practice_id, row.tcn, api]);

  // Re-search patient candidates when match search changes (unmatched only)
  useEffect(() => {
    if (!unmatched) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const cands = await api.fetchPatientCandidates({ search: matchSearch });
      if (!cancelled) setCandidates(cands);
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [matchSearch, unmatched, api]);

  async function handleSaveNote() {
    setSavingNote(true);
    try {
      await api.updateNote({ claimType: row.claim_type, id: row.id, notes: note });
    } finally {
      setSavingNote(false);
    }
  }

  async function handleViewSource() {
    if (!row.first_seen_file_id) return;
    const f = await api.fetchSourceFile(row.first_seen_file_id);
    // v1: simple alert; ClaimsTab can wire a side panel later.
    if (f) {
      alert([
        `File: ${f.remote_filename}`,
        `Type: ${f.file_type}`,
        `Status: ${f.status}`,
        `Records parsed: ${f.parsed_record_count || 0}`,
        f.parsed_at ? `Parsed at: ${f.parsed_at}` : '',
        f.parse_error ? `Parse error: ${f.parse_error}` : '',
      ].filter(Boolean).join('\n'));
    }
  }

  async function handleMatch(patientId) {
    setMatchBusy(true);
    try {
      await api.matchToPatient({ claimType: row.claim_type, id: row.id, patientId });
      if (onAfterMatch) onAfterMatch();
    } finally {
      setMatchBusy(false);
    }
  }

  if (unmatched) {
    return (
      <MatchPanel
        row={row}
        candidates={candidates}
        candidateSearch={matchSearch}
        onSearchChange={setMatchSearch}
        onMatch={handleMatch}
        onViewSource={handleViewSource}
        busy={matchBusy}
      />
    );
  }

  return (
    <div style={{
      background: '#FFFFFF',
      borderRadius: 8,
      border: '0.5px solid rgba(10, 34, 24, 0.15)',
      padding: '12px 14px',
    }}>

      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '10px 18px',
        marginBottom: 12,
      }}>
        <Field label="Subscriber">
          {row.patient_full_name || `${row.subscriber_first_name || ''} ${row.subscriber_last_name || ''}`.trim() || '\u2014'}
          {row.subscriber_cnds ? ` \u00B7 CNDS ${row.subscriber_cnds}` : ''}
          {row.subscriber_gender_code ? ` \u00B7 ${formatGender(row.subscriber_gender_code)}` : ''}
          {row.subscriber_dob ? ` \u00B7 DOB ${formatDateLong(row.subscriber_dob)}` : ''}
        </Field>

        <Field label={row.claim_type === 'pharmacy' ? 'Service provider' : 'Billing / Rendering'}>
          {row.claim_type === 'pharmacy'
            ? (row.service_provider_id ? `NPI ${row.service_provider_id}` : '\u2014')
            : (
              <>
                {row.billing_provider_npi ? `Bill ${row.billing_provider_npi}` : ''}
                {row.billing_provider_npi && row.rendering_provider_npi ? ' \u00B7 ' : ''}
                {row.rendering_provider_npi ? `Rend ${row.rendering_provider_npi}` : ''}
                {!row.billing_provider_npi && !row.rendering_provider_npi ? '\u2014' : ''}
              </>
            )}
        </Field>

        <Field label="Diagnosis (principal)">
          {row.principal_dx_code || '\u2014'}
        </Field>

        <Field label="Dates">
          {[
            row.service_date_effective ? `service ${formatDateShort(row.service_date_effective)}` : '',
            row.date_of_receipt        ? `received ${formatDateShort(row.date_of_receipt)}` : '',
            row.date_of_adjudication   ? `adj ${formatDateShort(row.date_of_adjudication)}` : '',
            row.date_of_payment        ? `paid ${formatDateShort(row.date_of_payment)}` : '',
          ].filter(Boolean).join(' \u00B7 ') || '\u2014'}
        </Field>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 8,
        marginBottom: 12,
      }}>
        <AmountCard label="Charge"  value={row.total_charge_amount} />
        <AmountCard label="Allowed" value={row.claim_allowed_amount} />
        <AmountCard label="Paid"    value={row.claim_payment_amount} />
      </div>

      <div style={{
        fontSize: 11,
        color: '#888780',
        textTransform: 'lowercase',
        letterSpacing: '0.02em',
        marginBottom: 6,
      }}>
        lines ({lines == null ? '...' : lines.length})
      </div>
      <div>
        {lines && lines.length === 0 && (
          <div style={{ fontSize: 12, color: '#888780', padding: '6px 0' }}>
            No line detail recorded.
          </div>
        )}
        {lines && lines.map((l) => (
          <LineRow key={`${l.tcn}-${l.line_number}`} claimType={row.claim_type} line={l} />
        ))}
      </div>

      {chain && chain.length > 0 && (
        <>
          <div style={{
            fontSize: 11,
            color: '#888780',
            textTransform: 'lowercase',
            letterSpacing: '0.02em',
            margin: '14px 0 6px',
          }}>
            supersede chain ({chain.length} prior)
          </div>
          {chain.map((p) => (
            <SupersedePriorRow key={p.id} claimType={row.claim_type} prior={p} />
          ))}
        </>
      )}

      <div style={{
        display: 'flex',
        gap: 6,
        marginTop: 14,
        paddingTop: 12,
        borderTop: '0.5px solid rgba(10, 34, 24, 0.1)',
        alignItems: 'center',
      }}>
        <input
          type="text"
          placeholder="Add note (e.g. called WellCare 4/29)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={{ flex: 1, height: 28, fontSize: 12, padding: '0 10px', boxSizing: 'border-box' }}
        />
        <button
          onClick={handleSaveNote}
          disabled={savingNote || note === (row.reconciliation_notes || '')}
          style={{
            ...SHARED.iconBtn,
            opacity: (savingNote || note === (row.reconciliation_notes || '')) ? 0.5 : 1,
          }}
        >
          {savingNote ? 'Saving...' : 'Save note'}
        </button>
        <button onClick={handleViewSource} style={SHARED.iconBtn}>
          View source &#8599;
        </button>
      </div>
    </div>
  );
}
