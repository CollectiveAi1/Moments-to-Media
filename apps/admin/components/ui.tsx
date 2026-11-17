import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import type { Tone } from '@/lib/format';
import { card, color, fonts, radius } from '@/lib/ui';

// ------------------------------------------------------------------ buttons

export type ButtonVariant = 'admin' | 'primary' | 'secondary' | 'tonal' | 'danger' | 'disabled';

/** UI-SPEC section 3: admin primary is label-filled; contractor primary is near-black. */
export function buttonStyle(variant: ButtonVariant = 'admin', height = 40): CSSProperties {
  const base: CSSProperties = {
    minHeight: Math.max(height, 44),
    height: Math.max(height, 44),
    padding: '0 16px',
    borderRadius: height >= 48 ? radius.lg : radius.sm,
    fontFamily: fonts.label,
    fontSize: height >= 48 ? 15 : 14,
    fontWeight: 600,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    textDecoration: 'none',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    border: 0,
  };
  switch (variant) {
    case 'admin':
      return { ...base, background: color.label, color: color.surface };
    case 'primary':
      return { ...base, background: color.primary, color: color.onPrimary };
    case 'secondary':
      return { ...base, background: 'transparent', color: color.text, border: `1px solid ${color.border}` };
    case 'tonal':
      return { ...base, background: color.surfaceAlt, color: color.text };
    case 'danger':
      return { ...base, background: 'transparent', color: color.dangerText, border: `1px solid ${color.attentionBorder}` };
    case 'disabled':
      return { ...base, background: color.divider, color: color.textMuted, cursor: 'default' };
  }
}

export function LinkButton({
  href,
  variant = 'admin',
  height = 40,
  children,
  style,
}: {
  href: string;
  variant?: ButtonVariant;
  height?: number;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <Link href={href} style={{ ...buttonStyle(variant, height), ...style }}>
      {children}
    </Link>
  );
}

// ------------------------------------------------------------------- blocks

export function Card({
  children,
  style,
  highlight = false,
  r = radius.lg,
}: {
  children: ReactNode;
  style?: CSSProperties;
  highlight?: boolean;
  r?: number;
}) {
  return (
    <section
      style={{
        ...card(r),
        borderColor: highlight ? color.label : color.border,
        borderWidth: highlight ? 2 : 1,
        padding: 18,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        ...style,
      }}
    >
      {children}
    </section>
  );
}

export function H1({ children, size = 28 }: { children: ReactNode; size?: number }) {
  return (
    <h1 style={{ margin: 0, fontFamily: fonts.heading, fontSize: size, fontWeight: 600, lineHeight: 1.15 }}>
      {children}
    </h1>
  );
}

export function H2({ children, size = 22 }: { children: ReactNode; size?: number }) {
  return (
    <h2 style={{ margin: 0, fontFamily: fonts.heading, fontSize: size, fontWeight: 600, lineHeight: 1.2 }}>
      {children}
    </h2>
  );
}

const toneText: Record<Tone, string> = {
  muted: color.textMuted,
  label: color.label,
  warn: color.attention,
  positive: color.positive,
  danger: color.dangerText,
};

export function Eyebrow({ children, tone = 'muted' }: { children: ReactNode; tone?: Tone }) {
  return (
    <span
      style={{
        fontFamily: fonts.label,
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: toneText[tone],
      }}
    >
      {children}
    </span>
  );
}

/** Status is always text plus colour, never colour alone (UI-SPEC "Rules"). */
export function Tag({ tone = 'muted', children }: { tone?: Tone; children: ReactNode }) {
  const palette: Record<Tone, CSSProperties> = {
    muted: { background: color.surfaceAlt, color: color.textSecondary },
    label: { background: color.surfaceAlt, color: color.label },
    warn: { background: color.warnBg, color: color.warnText },
    positive: { background: color.positiveBg, color: color.positive },
    danger: { background: color.dangerBg, color: color.dangerText },
  };
  return (
    <span
      style={{
        ...palette[tone],
        fontSize: 12,
        fontWeight: 700,
        padding: '3px 8px',
        borderRadius: radius.xs,
        whiteSpace: 'nowrap',
        display: 'inline-block',
      }}
    >
      {children}
    </span>
  );
}

export function StatusText({ tone = 'muted', children }: { tone?: Tone; children: ReactNode }) {
  return <span style={{ fontSize: 12, fontWeight: 700, color: toneText[tone] }}>{children}</span>;
}

export function Notice({ tone = 'positive', children }: { tone?: 'positive' | 'warn'; children: ReactNode }) {
  const positive = tone === 'positive';
  return (
    <div
      role={positive ? 'status' : 'alert'}
      style={{
        padding: '12px 14px',
        borderRadius: radius.md,
        fontSize: 14,
        lineHeight: 1.5,
        border: `1px solid ${positive ? color.positiveBorder : color.warnBorder}`,
        background: positive ? color.positiveBg : color.warnBg,
        color: positive ? color.positiveStrong : color.warnText,
      }}
    >
      {children}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div style={{ ...card(radius.lg), padding: 22, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <strong style={{ fontSize: 15 }}>{title}</strong>
      {children ? <span style={{ fontSize: 14, color: color.textMuted, lineHeight: 1.5 }}>{children}</span> : null}
    </div>
  );
}

export function Muted({ children, size = 14 }: { children: ReactNode; size?: number }) {
  return <span style={{ fontSize: size, color: color.textMuted, lineHeight: 1.5 }}>{children}</span>;
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      style={{
        minHeight: 44,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontFamily: fonts.label,
        fontSize: 14,
        fontWeight: 500,
        color: color.textSecondary,
        textDecoration: 'none',
        alignSelf: 'flex-start',
      }}
    >
      <span aria-hidden="true">‹</span> {children}
    </Link>
  );
}

// ------------------------------------------------------------------- forms

export const inputStyle: CSSProperties = {
  minHeight: 44,
  borderRadius: radius.sm,
  border: `1px solid ${color.border}`,
  background: color.surface,
  padding: '0 12px',
  fontSize: 15,
  color: color.text,
  width: '100%',
};

export const textareaStyle: CSSProperties = {
  ...inputStyle,
  minHeight: 88,
  padding: '10px 12px',
  lineHeight: 1.5,
  resize: 'vertical',
};

export function Field({
  label,
  children,
  hint,
  grow = 1,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  grow?: number;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: `${grow} 1 180px`, minWidth: 0 }}>
      <span style={{ fontFamily: fonts.label, fontSize: 12, fontWeight: 600, color: color.textMuted }}>{label}</span>
      {children}
      {hint ? <span style={{ fontSize: 12, color: color.textMuted }}>{hint}</span> : null}
    </label>
  );
}

export function Row({ children, gap = 12, align = 'flex-end' }: { children: ReactNode; gap?: number; align?: CSSProperties['alignItems'] }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap, alignItems: align }}>{children}</div>;
}

// ------------------------------------------------------------------- tables

export const th: CSSProperties = {
  textAlign: 'left',
  fontFamily: fonts.label,
  fontSize: 12,
  fontWeight: 600,
  color: color.textMuted,
  padding: '10px 12px',
  borderBottom: `1px solid ${color.border}`,
  whiteSpace: 'nowrap',
};

export const td: CSSProperties = {
  padding: '12px',
  borderBottom: `1px solid ${color.adminRowDivider}`,
  fontSize: 14,
  verticalAlign: 'middle',
};

/** A table in its own horizontally scrolling box (UI-SPEC section 5). */
export function Table({ head, children, minWidth = 720 }: { head: string[]; children: ReactNode; minWidth?: number }) {
  return (
    <div style={{ ...card(radius.lg), overflowX: 'auto' }}>
      <table style={{ width: '100%', minWidth, borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} style={th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function ListRow({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 12,
        padding: '11px 0',
        borderBottom: `1px solid ${color.divider}`,
        fontSize: 15,
      }}
    >
      <span>{label}</span>
      <span style={{ textAlign: 'right' }}>{value}</span>
    </div>
  );
}
