'use client';

import { useState } from 'react';
import { Uploader } from '@/components/contractor/Uploader';
import { color, fonts, radius } from '@/lib/ui';

/** Choose what the files are, then upload them to this event. */
export function DeliverUploader({ eventId }: { eventId: string }) {
  const [kind, setKind] = useState<'deliverables' | 'selects'>('deliverables');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <legend style={{ fontFamily: fonts.label, fontSize: 12, fontWeight: 600, color: color.textMuted, marginBottom: 6 }}>These files are</legend>
        {(['deliverables', 'selects'] as const).map((k) => (
          <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, padding: '0 14px', borderRadius: radius.sm, border: `1px solid ${kind === k ? color.text : color.inputBorder}`, cursor: 'pointer', fontSize: 14 }}>
            <input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} />
            {k === 'deliverables' ? 'Final edits' : 'Selects'}
          </label>
        ))}
      </fieldset>
      <Uploader key={kind} slotId={eventId} kind={kind} />
    </div>
  );
}
