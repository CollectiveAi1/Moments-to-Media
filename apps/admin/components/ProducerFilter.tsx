'use client';

import { useRouter } from 'next/navigation';
import { color, fonts, radius } from '@/lib/ui';

/** The one interactive control on the board; everything else renders on the server. */
export function ProducerFilter({
  producers,
  selected,
}: {
  producers: Array<{ id: string; name: string }>;
  selected: string | null;
}) {
  const router = useRouter();
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: color.textMuted }}>
      Producer
      <select
        value={selected ?? ''}
        onChange={(e) => {
          const id = e.target.value;
          router.push(id ? `/board?producer=${encodeURIComponent(id)}` : '/board');
        }}
        style={{
          height: 44,
          borderRadius: radius.sm,
          border: `1px solid ${color.inputBorder}`,
          background: color.surface,
          padding: '0 10px',
          fontFamily: fonts.label,
          fontSize: 14,
          color: color.text,
        }}
      >
        <option value="">Everyone</option>
        {producers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}
