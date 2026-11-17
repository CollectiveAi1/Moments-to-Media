import type { ReactNode } from 'react';
import { color, fonts } from '@/lib/ui';

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string | undefined;
  actions?: ReactNode;
}) {
  return (
    <header
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h1 style={{ margin: 0, fontFamily: fonts.heading, fontSize: 28, fontWeight: 600, lineHeight: 1.15 }}>
          {title}
        </h1>
        {subtitle ? <span style={{ fontSize: 14, color: color.textMuted }}>{subtitle}</span> : null}
      </div>
      {actions ? <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{actions}</div> : null}
    </header>
  );
}
