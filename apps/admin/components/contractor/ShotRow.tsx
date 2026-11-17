'use client';

import { useActionState, useState } from 'react';
import type { Action, ActionResult } from '@/lib/action-types';
import { color, fonts, radius } from '@/lib/ui';

/**
 * UI-SPEC `ShotCheckbox` row. The whole row toggles captured. "Can’t get it"
 * records not-possible with a reason, which also satisfies a must-have for
 * check-out (the spec asks for this action; the prototype does not draw it).
 */
export function ShotRow({
  action,
  orgId,
  assignmentId,
  shot,
  outcome,
  reason,
  mustHave,
  editable,
}: {
  action: Action;
  orgId: string;
  assignmentId: string;
  shot: { id: string; title: string; description: string | null };
  outcome: 'captured' | 'not_possible' | null;
  reason: string | null;
  mustHave: boolean;
  editable: boolean;
}) {
  const [state, run, pending] = useActionState<ActionResult, FormData>(action, null);
  const [asking, setAsking] = useState(false);
  const done = outcome !== null;

  const base = (o: string) => (
    <>
      <input type="hidden" name="org_id" value={orgId} />
      <input type="hidden" name="assignment_id" value={assignmentId} />
      <input type="hidden" name="shot_id" value={shot.id} />
      <input type="hidden" name="outcome" value={o} />
    </>
  );

  return (
    <div
      style={{
        background: mustHave ? color.surface : 'transparent',
        border: `1px solid ${mustHave ? color.border : color.divider}`,
        borderRadius: radius.lg,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        opacity: pending ? 0.6 : 1,
      }}
    >
      <form action={run} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        {base(outcome === 'captured' ? 'clear' : 'captured')}
        <button
          type="submit"
          disabled={!editable || pending || outcome === 'not_possible'}
          aria-pressed={outcome === 'captured'}
          aria-label={`${shot.title}: ${outcome === 'captured' ? 'captured, tap to uncheck' : 'tap to mark captured'}`}
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'flex-start',
            background: 'transparent',
            border: 0,
            padding: 0,
            textAlign: 'left',
            cursor: editable ? 'pointer' : 'default',
            minHeight: 44,
            flex: 1,
            color: color.text,
            font: 'inherit',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 24,
              height: 24,
              flex: '0 0 auto',
              borderRadius: 6,
              border: `2px solid ${done ? color.done : color.checkboxBorder}`,
              background: done ? color.done : color.surface,
              color: color.surface,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
              marginTop: 2,
            }}
          >
            {outcome === 'captured' ? '✓' : outcome === 'not_possible' ? '–' : ''}
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 15, fontWeight: 700, textDecoration: done ? 'line-through' : 'none', color: done ? color.textMuted : color.text }}>{shot.title}</span>
            {shot.description ? <span style={{ fontSize: 12, color: color.textMuted }}>{shot.description}</span> : null}
            {outcome === 'not_possible' ? <span style={{ fontSize: 12, color: color.attention }}>Not possible: {reason}</span> : null}
          </span>
        </button>
      </form>

      {editable && outcome === null && !asking ? (
        <button type="button" onClick={() => setAsking(true)} style={{ alignSelf: 'flex-start', background: 'transparent', border: 0, color: color.label, fontFamily: fonts.label, fontSize: 13, fontWeight: 600, minHeight: 32, cursor: 'pointer', padding: 0 }}>
          Can’t get it?
        </button>
      ) : null}
      {editable && outcome === 'not_possible' ? (
        <form action={run}>
          {base('clear')}
          <button type="submit" style={{ background: 'transparent', border: 0, color: color.label, fontFamily: fonts.label, fontSize: 13, fontWeight: 600, minHeight: 32, cursor: 'pointer', padding: 0 }}>
            Undo
          </button>
        </form>
      ) : null}
      {asking ? (
        <form action={(fd) => { setAsking(false); run(fd); }} style={{ display: 'flex', gap: 8 }}>
          {base('not_possible')}
          <input name="reason" required autoFocus placeholder="Why not?" style={{ flex: 1, minHeight: 44, borderRadius: 8, border: `1px solid ${color.border}`, padding: '0 10px', fontSize: 14 }} />
          <button type="submit" style={{ minHeight: 44, padding: '0 12px', borderRadius: 8, border: 0, background: color.primary, color: color.onPrimary, fontFamily: fonts.label, fontWeight: 600, cursor: 'pointer' }}>
            Save
          </button>
        </form>
      ) : null}
      {state && !state.ok ? <span role="alert" style={{ fontSize: 13, color: color.warnText }}>{state.message}</span> : null}
    </div>
  );
}
