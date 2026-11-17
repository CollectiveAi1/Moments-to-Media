'use client';

import Link from 'next/link';
import { useActionState, useState, type ReactNode } from 'react';
import type { AuthState } from '@/app/auth-actions';
import { color, fonts, radius } from '@/lib/ui';

const initial: AuthState = { status: 'idle', message: '', email: '' };

const labelStyle = { fontFamily: fonts.label, fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: color.textMuted };
const input = { minHeight: 48, borderRadius: radius.sm, border: `1px solid ${color.inputBorder}`, background: color.surface, padding: '0 12px', fontSize: 15, color: color.text, width: '100%' };

export function TextField({ label, name, type = 'text', autoComplete, defaultValue, required = true, hint }: { label: string; name: string; type?: string; autoComplete?: string; defaultValue?: string; required?: boolean; hint?: string }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={labelStyle}>{label}</span>
      <input name={name} type={type} autoComplete={autoComplete} defaultValue={defaultValue} required={required} style={input} />
      {hint ? <span style={{ fontSize: 12, color: color.textMuted }}>{hint}</span> : null}
    </label>
  );
}

export function PasswordField({ label = 'Password', name = 'password', autoComplete = 'current-password', hint, extra }: { label?: string; name?: string; autoComplete?: string; hint?: string; extra?: ReactNode }) {
  const [show, setShow] = useState(false);
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={labelStyle}>{label}</span>
        {extra}
      </span>
      <span style={{ position: 'relative', display: 'block' }}>
        <input name={name} type={show ? 'text' : 'password'} autoComplete={autoComplete} required style={{ ...input, paddingRight: 64 }} />
        <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} style={{ position: 'absolute', right: 4, top: 4, minHeight: 40, minWidth: 44, padding: '0 10px', border: 0, background: 'transparent', color: color.label, fontFamily: fonts.label, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
          {show ? 'Hide' : 'Show'}
        </button>
      </span>
      {hint ? <span style={{ fontSize: 12, color: color.textMuted }}>{hint}</span> : null}
    </label>
  );
}

/** A form bound to one auth action, with its message shown in place. */
export function AuthForm({ action, submit, children, hidden, sentContent }: {
  action: (p: AuthState, f: FormData) => Promise<AuthState>;
  submit: string;
  children: ReactNode;
  hidden?: Record<string, string>;
  sentContent?: ReactNode;
}) {
  const [state, run, pending] = useActionState(action, initial);
  if (state.status === 'sent') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p role="status" style={{ margin: 0, fontSize: 15, lineHeight: 1.5, padding: '12px 14px', borderRadius: radius.sm, background: color.positiveBg, color: color.positiveStrong }}>{state.message}</p>
        {sentContent}
      </div>
    );
  }
  return (
    <form action={run} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {Object.entries(hidden ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {children}
      <button type="submit" disabled={pending} style={{ minHeight: 48, borderRadius: radius.sm, border: 0, background: pending ? color.divider : color.primary, color: pending ? color.textMuted : color.onPrimary, fontFamily: fonts.label, fontSize: 15, fontWeight: 600, cursor: pending ? 'default' : 'pointer' }}>
        {pending ? 'One moment…' : submit}
      </button>
      {state.status === 'error' ? (
        <p role="alert" style={{ margin: 0, fontSize: 14, lineHeight: 1.45, padding: '8px 10px', borderRadius: radius.sm, background: color.warnBg, color: color.warnText }}>{state.message}</p>
      ) : null}
    </form>
  );
}

export function SmallLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} style={{ fontSize: 14, color: color.label, minHeight: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '2px 0' }}>{children}</Link>;
}
