import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import monogram from '../../../../assets/brand/m2m-monogram.png';
import { initials } from '@/lib/format';
import { color, fonts, radius } from '@/lib/ui';

export function Monogram({ size = 52 }: { size?: number }) {
  return <Image src={monogram} alt="Moments to Media" width={size} height={size} style={{ width: size, height: size, objectFit: 'contain' }} priority />;
}

export function Avatar({ name, href }: { name: string; href: string }) {
  return (
    <Link
      href={href}
      aria-label="Profile"
      style={{
        width: 44,
        height: 44,
        borderRadius: 22,
        background: color.surfaceAlt,
        border: `1px solid ${color.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: fonts.label,
        fontWeight: 600,
        fontSize: 14,
        color: color.text,
        textDecoration: 'none',
      }}
    >
      {initials(name)}
    </Link>
  );
}

/** UI-SPEC `FactTile`. */
export function FactTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div style={{ background: color.surface, border: `1px solid ${color.border}`, borderRadius: radius.lg, padding: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontFamily: fonts.label, fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: color.textMuted }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 700 }}>{value}</span>
    </div>
  );
}

/** UI-SPEC `LockNotice`. */
export function LockNotice({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: color.surfaceAlt, borderRadius: radius.lg, padding: 14, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color.textSecondary} strokeWidth="1.8" aria-hidden="true" style={{ flex: '0 0 auto', marginTop: 2 }}>
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
      <span style={{ fontSize: 14, lineHeight: 1.5, color: color.textSecondary }}>{children}</span>
    </div>
  );
}

/**
 * UI-SPEC `BottomActionBar`: on a phone, pinned above the tab bar; on a
 * desktop, a card in the side column. Styles live in the contractor layout.
 */
export function BottomBar({ children }: { children: ReactNode }) {
  return <div className="c-bar">{children}</div>;
}

export function ProgressBar({ value, total, height = 6, paused = false, label = 'Progress' }: { value: number; total: number; height?: number; paused?: boolean; label?: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <div role="progressbar" aria-label={label} aria-valuetext={`${value} of ${total}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} style={{ height, borderRadius: height / 2, background: color.divider, overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: paused ? color.checkboxBorder : color.done }} />
    </div>
  );
}

export function mapsUrl(query: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
