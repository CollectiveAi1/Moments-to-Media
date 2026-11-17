'use client';

import { useActionState, useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import type { Action, ActionResult } from '@/lib/action-types';
import { color, radius } from '@/lib/ui';
import { buttonStyle, type ButtonVariant } from './ui';

/**
 * A form bound to a server action. It shows the action is running, shows what
 * came back, and keeps the person on the page: every action returns a message
 * rather than redirecting, so a refusal from the database reads in place.
 */
export function ActionForm({
  action,
  submit,
  variant = 'admin',
  height = 40,
  children,
  confirm,
  reset = false,
  layout = 'stack',
  style,
  buttonStyle: buttonOverride,
  hideMessageOnSuccess = false,
}: {
  action: Action;
  submit: ReactNode;
  variant?: ButtonVariant;
  height?: number;
  children?: ReactNode;
  /** Asked before submitting, for things that cannot be undone. */
  confirm?: string;
  /** Clear the fields after a success. */
  reset?: boolean;
  layout?: 'stack' | 'inline';
  style?: CSSProperties;
  buttonStyle?: CSSProperties;
  hideMessageOnSuccess?: boolean;
}) {
  const [state, run, pending] = useActionState<ActionResult, FormData>(action, null);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (reset && state?.ok) form.current?.reset();
  }, [reset, state]);

  const inline = layout === 'inline';
  const showMessage = state && !(state.ok && hideMessageOnSuccess);

  return (
    <form
      ref={form}
      action={run}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      style={{
        display: 'flex',
        flexDirection: inline ? 'row' : 'column',
        flexWrap: inline ? 'wrap' : 'nowrap',
        alignItems: inline ? 'center' : 'stretch',
        gap: inline ? 8 : 12,
        ...style,
      }}
    >
      {children}
      <button
        type="submit"
        disabled={pending}
        style={{
          ...buttonStyle(pending ? 'disabled' : variant, height),
          alignSelf: inline ? 'center' : 'flex-start',
          ...buttonOverride,
        }}
      >
        {pending ? 'Working…' : submit}
      </button>
      {showMessage ? (
        <span
          role={state.ok ? 'status' : 'alert'}
          style={{
            fontSize: 13,
            lineHeight: 1.45,
            padding: inline ? 0 : '8px 10px',
            borderRadius: radius.sm,
            background: inline ? 'transparent' : state.ok ? color.positiveBg : color.warnBg,
            color: state.ok ? color.positiveStrong : color.warnText,
            flexBasis: inline ? '100%' : 'auto',
          }}
        >
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
