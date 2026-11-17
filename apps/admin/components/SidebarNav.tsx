'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { color, fonts, radius } from '@/lib/ui';

type Item = { label: string; href: string; match: RegExp };

const SECTIONS: ReadonlyArray<{ title: string | null; items: Item[] }> = [
  {
    title: null,
    items: [
      { label: 'Board', href: '/board', match: /^\/board/ },
      { label: 'Events', href: '/events', match: /^\/events(?!\/[^/]+\/(staffing|review))/ },
      { label: 'Staffing', href: '/staffing', match: /^\/(staffing|events\/[^/]+\/staffing)/ },
      { label: 'Contractors', href: '/contractors', match: /^\/contractors/ },
      { label: 'Footage and review', href: '/footage', match: /^\/(footage|events\/[^/]+\/review)/ },
      { label: 'Payouts', href: '/payouts', match: /^\/payouts/ },
    ],
  },
  {
    title: 'Clients',
    items: [
      { label: 'Inquiries', href: '/leads', match: /^\/leads/ },
      { label: 'Proposals', href: '/proposals', match: /^\/proposals/ },
      { label: 'Invoices', href: '/invoices', match: /^\/invoices/ },
      { label: 'Clients', href: '/clients', match: /^\/clients/ },
      { label: 'Packages', href: '/packages', match: /^\/packages/ },
    ],
  },
  {
    title: 'Organization',
    items: [
      { label: 'Announcements', href: '/announcements', match: /^\/announcements/ },
      { label: 'Settings', href: '/settings', match: /^\/settings/ },
    ],
  },
];

export function SidebarNav() {
  const path = usePathname();
  return (
    <>
      {SECTIONS.map((section) => (
        <div key={section.title ?? 'main'} style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: section.title ? 14 : 0 }}>
          {section.title ? (
            <span style={{ padding: '0 12px 2px', fontFamily: fonts.label, fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: color.textMuted }}>
              {section.title}
            </span>
          ) : null}
          {section.items.map(({ label, href, match }) => {
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
        </div>
      ))}
    </>
  );
}
