'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { color, fonts } from '@/lib/ui';

const TABS = [
  { href: '/app', label: 'Home', match: /^\/app(\/events.*)?$/, icon: 'M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z' },
  { href: '/app/jobs', label: 'Jobs', match: /^\/app\/jobs/, icon: 'M4 7h16v13H4zM9 7V4h6v3M4 12h16' },
  { href: '/app/uploads', label: 'Uploads', match: /^\/app\/uploads/, icon: 'M12 16V4M7 9l5-5 5 5M4 20h16' },
  { href: '/app/profile', label: 'Profile', match: /^\/app\/profile/, icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6' },
];

/** UI-SPEC `TabBar`: 84px, four tabs, icon over label, line icons at 1.8 stroke. */
export function TabBar() {
  const path = usePathname();
  return (
    <nav
      aria-label="Main"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: 84,
        paddingBottom: 'env(safe-area-inset-bottom)',
        background: color.surface,
        borderTop: `1px solid ${color.border}`,
        display: 'flex',
        justifyContent: 'center',
        zIndex: 10,
      }}
    >
      <div style={{ display: 'flex', width: '100%', maxWidth: 480 }}>
        {TABS.map((t) => {
          const active = t.match.test(path);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? 'page' : undefined}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                textDecoration: 'none',
                color: active ? color.text : color.textMuted,
                fontFamily: fonts.label,
                fontSize: 11,
                fontWeight: active ? 600 : 500,
              }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={t.icon} />
              </svg>
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
