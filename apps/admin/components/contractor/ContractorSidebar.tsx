'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { color, fonts, radius } from '@/lib/ui';
import { Monogram } from './bits';

const NAV = [
  { href: '/app', label: 'Home', match: /^\/app(\/events.*)?$/, icon: 'M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z' },
  { href: '/app/jobs', label: 'Jobs', match: /^\/app\/jobs/, icon: 'M4 7h16v13H4zM9 7V4h6v3M4 12h16' },
  { href: '/app/uploads', label: 'Uploads', match: /^\/app\/uploads/, icon: 'M12 16V4M7 9l5-5 5 5M4 20h16' },
  { href: '/app/profile', label: 'Profile', match: /^\/app\/profile\/?$/, icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6' },
  { href: '/app/profile/earnings', label: 'Earnings', match: /^\/app\/profile\/earnings/, icon: 'M12 3v18M17 7H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H6' },
];

/** The desktop navigation; hidden below 960px, where the tab bar takes over. */
export function ContractorSidebar({ name, email, orgName, isAdmin }: { name: string; email: string; orgName: string; isAdmin: boolean }) {
  const path = usePathname();
  return (
    <nav
      aria-label="Main"
      className="c-side"
      style={{
        position: 'sticky',
        top: 0,
        height: '100vh',
        width: 248,
        flex: '0 0 248px',
        background: color.surface,
        borderRight: `1px solid ${color.border}`,
        padding: '28px 16px 20px',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <Link href="/app" style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 8px 24px', textDecoration: 'none', color: color.text }}>
        <Monogram size={44} />
        <span style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontFamily: fonts.heading, fontSize: 15, fontWeight: 600 }}>Moments to Media</span>
          <span style={{ fontSize: 12, color: color.textMuted }}>{orgName}</span>
        </span>
      </Link>

      {NAV.map((n) => {
        const active = n.match.test(path);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? 'page' : undefined}
            style={{
              minHeight: 44,
              padding: '10px 12px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              borderRadius: radius.sm,
              textDecoration: 'none',
              fontFamily: fonts.label,
              fontSize: 14,
              fontWeight: active ? 600 : 500,
              background: active ? color.surfaceAlt : 'transparent',
              color: active ? color.text : color.textMuted,
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={n.icon} />
            </svg>
            {n.label}
          </Link>
        );
      })}

      <div style={{ marginTop: 'auto', padding: '24px 12px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {isAdmin ? (
          <Link href="/board" style={{ minHeight: 44, display: 'flex', alignItems: 'center', fontFamily: fonts.label, fontSize: 13, fontWeight: 600, color: color.label }}>
            Admin console →
          </Link>
        ) : null}
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <strong style={{ fontSize: 14 }}>{name}</strong>
          <span style={{ fontSize: 12, color: color.textMuted, overflowWrap: 'anywhere' }}>{email}</span>
        </span>
        <Link href="/account" style={{ minHeight: 32, display: 'flex', alignItems: 'center', fontSize: 13, color: color.label }}>Account and security</Link>
        <form action="/auth/sign-out" method="post">
          <button
            type="submit"
            style={{ minHeight: 44, padding: '0 12px', borderRadius: radius.sm, border: `1px solid ${color.border}`, background: 'transparent', color: color.text, fontFamily: fonts.label, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            Sign out
          </button>
        </form>
      </div>
    </nav>
  );
}
