import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Wordmark } from '@/components/Wordmark';
import { color, fonts } from '@/lib/ui';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description: 'What Moments to Media collects, why, who processes it, how long it is kept, and your choices.',
  alternates: { canonical: '/privacy' },
};

const UPDATED = 'November 17, 2026';

function S({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h2 style={{ margin: '12px 0 0', fontFamily: fonts.heading, fontSize: 22, fontWeight: 600 }}>{title}</h2>
      {children}
    </section>
  );
}

const p = { margin: 0, fontSize: 16, lineHeight: 1.65, color: color.textBody } as const;

/**
 * Describes what this app actually does with personal data. Reviewed against
 * the code on the date above; it is not legal advice, and Moments to Media
 * should have it checked before relying on it.
 */
export default function PrivacyPage() {
  return (
    <div style={{ minHeight: '100vh', background: color.bg, display: 'flex', justifyContent: 'center' }}>
      <main id="main" tabIndex={-1} style={{ width: '100%', maxWidth: 760, padding: '32px 20px 64px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Link href="/" aria-label="Moments to Media home"><Wordmark /></Link>
        <h1 style={{ margin: '12px 0 0', fontFamily: fonts.heading, fontSize: 32, fontWeight: 600 }}>Privacy policy</h1>
        <p style={{ ...p, color: color.textMuted }}>Last updated {UPDATED}</p>
        <p style={p}>
          Moments to Media uses this site to book event photo and video coverage, run its freelance crews, and deliver finished media to clients. This
          page explains what we collect, why, who helps us process it, how long we keep it, and what you can ask us to do.
        </p>

        <S title="What we collect">
          <ul style={{ ...p, paddingLeft: 22 }}>
            <li><strong>Account details:</strong> your name, email address, phone number and a password (stored only as a one-way hash by our sign-in provider).</li>
            <li><strong>If you inquire or book:</strong> your event date, location and notes; the packages you choose; your signature on a proposal, with the time it was signed; invoices and the payments recorded against them.</li>
            <li><strong>If you work as crew:</strong> your skills, home base and travel radius, gear, availability, compliance documents you submit, the jobs you take, check-in time and location, footage you upload, and what you are paid.</li>
            <li><strong>Media:</strong> the photos and video uploaded for your event.</li>
            <li><strong>Messages</strong> you send through your portal.</li>
            <li><strong>Usage:</strong> anonymous page-view statistics (see Analytics).</li>
          </ul>
        </S>

        <S title="Why we use it">
          <p style={p}>
            To provide the service you asked for: answer inquiries, prepare and keep proposals and contracts, staff and run events, deliver your media,
            send and record invoices and payments, pay crew, keep the site secure (for example, limiting repeated wrong passwords), and meet tax and
            accounting obligations.
          </p>
        </S>

        <S title="Who processes it for us">
          <ul style={{ ...p, paddingLeft: 22 }}>
            <li><strong>Supabase:</strong> database and sign-in.</li>
            <li><strong>Vercel:</strong> hosting the site, and privacy-friendly analytics.</li>
            <li><strong>Cloudflare R2:</strong> storage of photos and video.</li>
            <li><strong>Stripe:</strong> card payments and contractor payouts, when switched on. Card numbers go to Stripe directly; we never see or store them.</li>
            <li><strong>Resend:</strong> sending sign-in and account emails.</li>
          </ul>
          <p style={p}>We do not sell personal information or share it for advertising.</p>
        </S>

        <S title="Cookies">
          <p style={p}>
            We use only the cookies needed to keep you signed in. They are marked secure and cannot be read by scripts on the page. We do not use
            advertising or tracking cookies.
          </p>
        </S>

        <S title="Analytics">
          <p style={p}>
            We count page views with Vercel Web Analytics, which does not use cookies and does not identify individual visitors. It tells us which
            pages are used so we can improve them.
          </p>
        </S>

        <S title="How long we keep it">
          <p style={p}>
            Raw footage is kept for a limited time after an event (90 days unless agreed otherwise). Delivered media stays available in your portal
            while your account is open. Contracts, invoices and payment records are kept as long as tax and accounting law requires. Other account
            data is kept while your account is active.
          </p>
        </S>

        <S title="Your choices">
          <p style={p}>
            You can see and update most of your details in your account. You can ask us for a copy of your data, to correct it, or to delete it, subject
            to records we must keep by law. You can sign out of every device from Account and security at any time.
          </p>
        </S>

        <S title="Security">
          <p style={p}>
            Data is encrypted in transit. Access is limited by role in the database itself: crew never see client contract or payment details, and clients see only their own bookings. Download links for media are private and expire after 15 minutes.
          </p>
        </S>

        <S title="Contact">
          <p style={p}>
            Questions or requests: message us from your client portal, or use our <Link href="/" style={{ color: color.label }}>inquiry form</Link>. We will respond within 30 days.
          </p>
        </S>
      </main>
    </div>
  );
}
