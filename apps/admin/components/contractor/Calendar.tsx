'use client';

import { startTransition, useActionState } from 'react';
import type { Action, ActionResult } from '@/lib/action-types';
import { color, fonts, radius } from '@/lib/ui';

export type DayState = 'available' | 'unavailable' | 'booked' | 'none';

/**
 * UI-SPEC `CalendarDay` grid, Sunday first. Tapping a day cycles it:
 * not said → unavailable → available → not said. Booked days are fixed.
 */
export function Calendar({ action, days, leading }: { action: Action; days: Array<{ date: string; state: DayState }>; leading: number }) {
  const [state, run, pending] = useActionState<ActionResult, FormData>(action, null);
  const tap = (date: string) => {
    const form = new FormData();
    form.set('date', date);
    startTransition(() => run(form));
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, opacity: pending ? 0.6 : 1 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <span key={i} style={{ textAlign: 'center', fontSize: 11, fontFamily: fonts.label, color: color.textMuted }}>{d}</span>
        ))}
        {Array.from({ length: leading }, (_, i) => <span key={`b${i}`} />)}
        {days.map(({ date, state: s }) => {
          const day = Number(date.slice(8));
          const style =
            s === 'booked'
              ? { background: color.done, color: color.onPrimary, border: `1px solid ${color.done}` }
              : s === 'unavailable'
                ? { background: `repeating-linear-gradient(45deg, ${color.border} 0 4px, ${color.bg} 4px 8px)`, color: color.textMuted, border: `1px solid ${color.border}` }
                : s === 'available'
                  ? { background: color.surface, color: color.positive, border: `1px solid ${color.positive}` }
                  : { background: color.surface, color: color.text, border: `1px solid ${color.border}` };
          return (
            <button
              key={date}
              type="button"
              disabled={s === 'booked' || pending}
              onClick={() => tap(date)}
              aria-label={`${date}: ${s === 'none' ? 'not set' : s}`}
              style={{ height: 44, borderRadius: radius.md, fontFamily: fonts.label, fontSize: 14, fontWeight: 600, cursor: s === 'booked' ? 'default' : 'pointer', ...style }}
            >
              {day}
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 14, fontSize: 12, color: color.textMuted, flexWrap: 'wrap' }}>
        <Legend swatch={color.done} label="Booked" />
        <Legend swatch={color.surface} border={color.positive} label="Available" />
        <Legend swatch={`repeating-linear-gradient(45deg, ${color.border} 0 3px, ${color.bg} 3px 6px)`} label="Unavailable" />
      </div>
      {state && !state.ok ? <span role="alert" style={{ fontSize: 13, color: color.warnText }}>{state.message}</span> : null}
    </div>
  );
}

function Legend({ swatch, border, label }: { swatch: string; border?: string; label: string }) {
  return (
    <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <span style={{ width: 14, height: 14, borderRadius: 4, background: swatch, border: `1px solid ${border ?? color.border}` }} />
      {label}
    </span>
  );
}
