import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/context';

/** Owners and producers start on the board; contractors on their home screen; clients in their portal. */
export default async function Home() {
  const viewer = await getViewer();
  if (viewer.isAdmin) redirect('/board');
  if (viewer.isContractor) redirect('/app');
  if (viewer.orgs.some((o) => o.roles.includes('client'))) redirect('/portal');
  redirect('/no-access');
}
