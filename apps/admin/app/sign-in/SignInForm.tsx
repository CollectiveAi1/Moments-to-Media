'use client';

import { useActionState } from 'react';
import { color, fonts, radius } from '@/lib/ui';
import { sendSignInLink, type SignInState } from './actions';

const initial: SignInState = { status: 'idle', message: '', email: '' };

export function SignInForm({ notice }: { notice: string | null }) {
  const [state, action, pending] = useActionState(sendSignInLink, initial);
  const message = state.status === 'idle' ? notice : state.message;
  const isError = state.status === 'error' || (state.status === 'idle' && notice !== null);

  return (
    <form action={action} style={{ display: 'flex', flexDirection: 'column', gap: 14 }} noValidate>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span
          style={{
            fontFamily: fonts.label,
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: color.textMuted,
          }}
        >
          Email
        </span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          defaultValue={state.email}
          aria-describedby={message ? 'sign-in-message' : undefined}
          aria-invalid={state.status === 'error' ? true : undefined}
          style={{
            height: 48,
            borderRadius: radius.sm,
            border: `1px solid ${color.border}`,
            background: color.surface,
            padding: '0 12px',
            fontSize: 15,
            color: color.text,
          }}
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        style={{
          height: 48,
          borderRadius: radius.sm,
          border: 0,
          background: pending ? color.divider : color.label,
          color: pending ? color.textMuted : color.surface,
          fontFamily: fonts.label,
          fontSize: 14,
          fontWeight: 600,
          cursor: pending ? 'default' : 'pointer',
        }}
      >
        {pending ? 'Sending…' : 'Email me a sign-in link'}
      </button>

      {message ? (
        <p
          id="sign-in-message"
          role={isError ? 'alert' : 'status'}
          style={{
            margin: 0,
            padding: '10px 12px',
            borderRadius: radius.sm,
            fontSize: 14,
            lineHeight: 1.5,
            border: `1px solid ${isError ? color.warnBorder : color.positiveBorder}`,
            background: isError ? color.warnBg : color.positiveBg,
            color: isError ? color.warnText : color.positiveStrong,
          }}
        >
          {message}
        </p>
      ) : null}
    </form>
  );
}
