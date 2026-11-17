'use client';

import { useActionState, useMemo, useState, type ReactNode } from 'react';
import type { ActionResult } from '@/lib/action-types';
import { proposalTotals } from '@/lib/billing/schedule';
import { color, fonts, radius } from '@/lib/ui';
import { buttonStyle, inputStyle } from '@/components/ui';
import { acceptProposal } from '../../public-actions';

export interface SignItem {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  quantity: number;
  optional: boolean;
  selected: boolean;
}

const usd = (c: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(c / 100);

/**
 * Add-ons, a live total and the signature, in one form. Without JavaScript the
 * checkboxes still submit and the server computes the same total.
 */
export function SignForm({
  token, items, discountCents, taxRateBp, depositPercent, contract,
}: {
  token: string; items: SignItem[]; discountCents: number; taxRateBp: number; depositPercent: number; contract: string;
}) {
  const [state, run, pending] = useActionState<ActionResult, FormData>(acceptProposal, null);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(items.filter((i) => i.optional && i.selected).map((i) => i.id)));
  const totals = useMemo(
    () => proposalTotals(items.map((i) => ({ ...i, selected: !i.optional || chosen.has(i.id) })), discountCents, taxRateBp, depositPercent),
    [items, chosen, discountCents, taxRateBp, depositPercent],
  );
  const required = items.filter((i) => !i.optional);
  const addons = items.filter((i) => i.optional);

  return (
    <form action={run} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <input type="hidden" name="token" value={token} />

      <section style={{ background: color.surface, border: `1px solid ${color.border}`, borderRadius: radius.xl, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ margin: 0, fontFamily: fonts.heading, fontSize: 20 }}>Your package</h2>
        {required.map((i) => (
          <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <strong>{i.name}{i.quantity > 1 ? ` × ${i.quantity}` : ''}</strong>
              {i.description ? <span style={{ fontSize: 13, color: color.textMuted, whiteSpace: 'pre-wrap' }}>{i.description}</span> : null}
            </span>
            <strong>{usd(i.priceCents * i.quantity)}</strong>
          </div>
        ))}
        {addons.length ? (
          <>
            <h3 style={{ margin: '8px 0 0', fontFamily: fonts.label, fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: color.textMuted }}>Add-ons: choose any</h3>
            {addons.map((i) => (
              <label key={i.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', minHeight: 44, cursor: 'pointer', padding: 10, borderRadius: radius.lg, border: `1px solid ${chosen.has(i.id) ? color.label : color.border}` }}>
                <input
                  type="checkbox"
                  name="addon"
                  value={i.id}
                  checked={chosen.has(i.id)}
                  onChange={(e) => {
                    const next = new Set(chosen);
                    if (e.target.checked) next.add(i.id);
                    else next.delete(i.id);
                    setChosen(next);
                  }}
                  style={{ width: 20, height: 20, marginTop: 2 }}
                />
                <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <strong>{i.name}{i.quantity > 1 ? ` × ${i.quantity}` : ''}</strong>
                  {i.description ? <span style={{ fontSize: 13, color: color.textMuted }}>{i.description}</span> : null}
                </span>
                <strong>+{usd(i.priceCents * i.quantity)}</strong>
              </label>
            ))}
          </>
        ) : null}
        <div style={{ borderTop: `1px solid ${color.divider}`, paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 15 }}>
          {totals.discount ? <Line label="Discount" value={`−${usd(totals.discount)}`} /> : null}
          {totals.tax ? <Line label={`Tax (${taxRateBp / 100}%)`} value={usd(totals.tax)} /> : null}
          <Line label={<strong>Total</strong>} value={<strong style={{ fontSize: 18 }}>{usd(totals.total)}</strong>} />
          {depositPercent > 0 && depositPercent < 100 ? (
            <Line label={`Deposit to book (${depositPercent}%)`} value={usd(totals.deposit)} />
          ) : null}
        </div>
      </section>

      <section style={{ background: color.surface, border: `1px solid ${color.border}`, borderRadius: radius.xl, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ margin: 0, fontFamily: fonts.heading, fontSize: 20 }}>Contract</h2>
        <div tabIndex={0} role="region" aria-label="Contract text" style={{ maxHeight: 360, overflowY: 'auto', background: color.bg, borderRadius: radius.lg, padding: 14, fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{contract}</div>
        <label style={{ display: 'flex', gap: 10, alignItems: 'center', minHeight: 44, fontSize: 15 }}>
          <input type="checkbox" name="agree" required style={{ width: 20, height: 20 }} /> I have read and agree to this contract.
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
          Your full name
          <input name="signer" required autoComplete="name" style={inputStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
          Signature: type your full name again
          <input name="signature" required style={{ ...inputStyle, fontFamily: 'cursive, serif', fontSize: 20, height: 52 }} />
        </label>
        <span style={{ fontSize: 12, color: color.textMuted }}>Typing your name is your electronic signature. You’ll get a copy in your client portal.</span>
        <button type="submit" disabled={pending} style={{ ...buttonStyle(pending ? 'disabled' : 'primary', 52), width: '100%' }}>
          {pending ? 'Signing…' : `Sign and book · ${usd(depositPercent > 0 && depositPercent < 100 ? totals.deposit : totals.total)} due now`}
        </button>
        {state && !state.ok ? <span role="alert" style={{ fontSize: 14, color: color.warnText, background: color.warnBg, padding: '8px 10px', borderRadius: radius.sm }}>{state.message}</span> : null}
      </section>
    </form>
  );
}

function Line({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
