import Link from 'next/link';
import type { CSSProperties } from 'react';
import { color, fonts, radius } from '@/lib/ui';
import { Wordmark } from './Wordmark';

/**
 * The seven entries the prototype draws. Only the board exists so far; the
 * rest are shown, because the navigation is part of the approved design, but
 * they are not links and say so to anyone using a screen reader.
 */
const NAV: ReadonlyArray<{ label: string; href: string | null }> = [
  { label: 'Board', href: '/board' },
  { label: 'Staffing', href: null },
  { label: 'Contractors', href: null },
  { label: 'Footage and review', href: null },
  { label: 'Payouts', href: null },
  { label: 'Announcements', href: null },
  { label: 'Settings', href: null },
];

const item: CSSProperties = {
  padding: '10px 12px',
  borderRadius: radius.sm,
  fontSize: 14,
  textDecoration: 'none',
  display: 'block',
};

export function Sidebar({ current, email }: { current: string; email: string }) {
  return (
    <nav
      aria-label="Admin"
      style={{
        flex: '1 1 220px',
        maxWidth: '100%',
        background: color.surface,
        borderRight: `1px solid ${color.border}`,
        padding: '24px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div style={{ margin: '0 8px 24px' }}>
        <Wordmark />
      </div>

      {NAV.map(({ label, href }) => {
        if (href === null) {
          return (
            <span
              key={label}
              aria-disabled="true"
              title="Not built yet"
              style={{ ...item, color: color.textMuted, fontWeight: 500 }}
            >
              {label}
            </span>
          );
        }
        const active = current === href;
        return (
          <Link
            key={label}
            href={href}
            aria-current={active ? 'page' : undefined}
            style={{
              ...item,
              background: active ? color.surfaceAlt : 'transparent',
              color: active ? color.text : color.textMuted,
              fontWeight: active ? 600 : 500,
            }}
          >
            {label}
          </Link>
        );
      })}

      <form
        action="/auth/sign-out"
        method="post"
        style={{
          marginTop: 'auto',
          paddingTop: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: '24px 12px 0',
        }}
      >
        <span style={{ fontSize: 12, color: color.textMuted, overflowWrap: 'anywhere' }}>{email}</span>
        <button
          type="submit"
          style={{
            alignSelf: 'flex-start',
            minHeight: 44,
            padding: '0 12px',
            borderRadius: radius.sm,
            border: `1px solid ${color.border}`,
            background: 'transparent',
            color: color.text,
            fontFamily: fonts.label,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Sign out
        </button>
      </form>
    </nav>
  );
}
