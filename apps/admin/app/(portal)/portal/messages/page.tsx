import type { Metadata } from 'next';
import { ActionForm } from '@/components/ActionForm';
import { Card, Field, H1, Muted, inputStyle, textareaStyle } from '@/components/ui';
import { requireClient } from '@/lib/context';
import { dateTime } from '@/lib/format';
import { myClientIds } from '@/lib/portal/load';
import { color, radius } from '@/lib/ui';
import { sendMessage } from '../actions';

export const metadata: Metadata = { title: 'Messages' };
export const dynamic = 'force-dynamic';

export default async function PortalMessages() {
  const viewer = await requireClient();
  const clients = await myClientIds(viewer);
  const ids = clients.map((c) => c.id);
  const { data } = ids.length
    ? await viewer.supabase.from('client_messages').select('id, body, from_client, created_at, author_id').in('client_id', ids).order('created_at').limit(300)
    : { data: [] };
  const first = clients[0];

  return (
    <>
      <H1>Messages</H1>
      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 560, overflowY: 'auto' }}>
          {(data ?? []).length === 0 ? <Muted>No messages yet. Ask us anything about your booking.</Muted> : null}
          {(data ?? []).map((m) => (
            <div key={String(m.id)} style={{ alignSelf: m.from_client ? 'flex-end' : 'flex-start', maxWidth: '85%', background: m.from_client ? color.positiveBg : color.surfaceAlt, borderRadius: radius.lg, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 15, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{String(m.body)}</span>
              <span style={{ fontSize: 11, color: color.textMuted }}>{m.author_id === viewer.userId ? 'You' : m.from_client ? 'Your team' : viewer.org.name} · {dateTime(String(m.created_at), 'America/New_York')}</span>
            </div>
          ))}
        </div>
        {first ? (
          <ActionForm action={sendMessage} submit="Send" variant="primary" reset>
            {clients.length > 1 ? (
              <Field label="About">
                <select name="client_id" style={inputStyle}>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
            ) : (
              <input type="hidden" name="client_id" value={first.id} />
            )}
            <Field label="Message"><textarea name="body" required style={textareaStyle} /></Field>
          </ActionForm>
        ) : null}
      </Card>
    </>
  );
}
