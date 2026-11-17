import type { Metadata } from 'next';
import { ActionForm } from '@/components/ActionForm';
import { PageHeader } from '@/components/PageHeader';
import { BackLink, Card } from '@/components/ui';
import { requireAdmin } from '@/lib/context';
import { isProducerish, orgPeople } from '@/lib/org';
import { EventFields } from '../EventFields';
import { createEvent } from './actions';

export const metadata: Metadata = { title: 'New event' };

export default async function NewEventPage() {
  const viewer = await requireAdmin();
  const [people, { data: clients }] = await Promise.all([
    orgPeople(viewer, viewer.org.id),
    viewer.supabase.from('clients').select('id, name').eq('org_id', viewer.org.id).order('name'),
  ]);

  return (
    <>
      <BackLink href="/events">Events</BackLink>
      <PageHeader
        title="New event"
        subtitle="Start with the basics. Slots, the brief, the shot list and deliverables come next, on the event's own page."
      />
      <Card>
        <ActionForm action={createEvent} submit="Create draft event">
          <EventFields
            producers={people.filter(isProducerish)}
            clients={(clients ?? []).map((c) => ({ id: String(c.id), name: String(c.name) }))}
            canChooseProducer={viewer.isOwner}
            viewerId={viewer.userId}
          />
        </ActionForm>
      </Card>
    </>
  );
}
