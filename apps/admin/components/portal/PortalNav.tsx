'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { color, fonts, radius } from '@/lib/ui';

const NAV = [
  { href: '/portal', label: 'Overview', match: /^\/portal\/?$/ },
  { href: '/portal/invoices', label: 'Invoices', match: /^\/portal\/invoices/ },
  { href: '/portal/messages', label: 'Messages', match: /^\/portal\/messages/ },
];

export function PortalNav() {
  const path = usePathname();
  return (
    <nav aria-label="Portal" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {NAV.map((n) => {
        const active = n.match.test(path);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? 'page' : undefined}
            style={{ minHeight: 40, padding: '0 12px', display: 'flex', alignItems: 'center', borderRadius: radius.sm, textDecoration: 'none', fontFamily: fonts.label, fontSize: 14, fontWeight: active ? 600 : 500, background: active ? color.surfaceAlt : 'transparent', color: active ? color.text : color.textMuted }}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
