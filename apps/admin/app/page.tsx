import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/context';

/** Owners and producers start on the board; contractors on their home screen. */
export default async function Home() {
  const viewer = await getViewer();
  if (viewer.isAdmin) redirect('/board');
  if (viewer.isContractor) redirect('/app');
  redirect('/no-access');
}
