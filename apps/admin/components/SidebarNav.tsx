'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { color, radius } from '@/lib/ui';

const NAV: ReadonlyArray<{ label: string; href: string; match: RegExp }> = [
  { label: 'Board', href: '/board', match: /^\/board/ },
  { label: 'Events', href: '/events', match: /^\/events(?!\/[^/]+\/(staffing|review))/ },
  { label: 'Staffing', href: '/staffing', match: /^\/(staffing|events\/[^/]+\/staffing)/ },
  { label: 'Contractors', href: '/contractors', match: /^\/contractors/ },
  { label: 'Footage and review', href: '/footage', match: /^\/(footage|events\/[^/]+\/review)/ },
  { label: 'Payouts', href: '/payouts', match: /^\/payouts/ },
  { label: 'Announcements', href: '/announcements', match: /^\/announcements/ },
  { label: 'Settings', href: '/settings', match: /^\/settings/ },
];

export function SidebarNav() {
  const path = usePathname();
  return (
    <>
      {NAV.map(({ label, href, match }) => {
        const active = match.test(path);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            style={{
              padding: '10px 12px',
              minHeight: 44,
              display: 'flex',
              alignItems: 'center',
              borderRadius: radius.sm,
              fontSize: 14,
              textDecoration: 'none',
              background: active ? color.surfaceAlt : 'transparent',
              color: active ? color.text : color.textMuted,
              fontWeight: active ? 600 : 500,
            }}
          >
            {label}
          </Link>
        );
      })}
    </>
  );
}
