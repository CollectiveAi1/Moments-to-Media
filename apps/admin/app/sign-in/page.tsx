import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Wordmark } from '@/components/Wordmark';
import { createClient } from '@/lib/supabase/server';
import { card, color, fonts, radius } from '@/lib/ui';
import { HashSession } from './HashSession';
import { SignInForm } from './SignInForm';

export const metadata: Metadata = { title: 'Sign in' };

// What the callback route can send back here. Fixed strings: nothing from the
// URL is ever echoed onto the page.
const NOTICES: Record<string, string> = {
  link: 'That sign-in link has expired or was already used. Ask for a new one.',
  device: 'That link was made for another browser. Ask for a new one here; new links work on any device.',
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect('/');

  const { error } = await searchParams;
  const notice = error ? (NOTICES[error] ?? NOTICES.link ?? null) : null;

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        background: color.bg,
      }}
    >
      <div
        style={{
          ...card(radius.xxl),
          width: '100%',
          maxWidth: 400,
          padding: 28,
          display: 'flex',
          flexDirection: 'column',
          gap: 22,
        }}
      >
        <Wordmark />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h1 style={{ margin: 0, fontFamily: fonts.heading, fontSize: 26, fontWeight: 600, lineHeight: 1.15 }}>
            Admin console
          </h1>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: color.textMuted }}>
            Sign in with the email you were invited with. There is no password: we send you a link.
          </p>
        </div>
        <HashSession />
        <SignInForm notice={notice} />
      </div>
    </main>
  );
}
