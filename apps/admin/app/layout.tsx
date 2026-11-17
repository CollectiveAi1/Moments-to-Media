import { Analytics } from '@vercel/analytics/next';
import type { Metadata } from 'next';
import { Cinzel, Lato, Montserrat } from 'next/font/google';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { DemoBanner } from '@/components/auth/DemoBanner';
import { FlashNotice } from '@/components/FlashNotice';
import { DEMO_ACCOUNTS, demoEnabled } from '@/lib/demo';
import { createClient } from '@/lib/supabase/server';
import { SITE_URL } from '@/lib/site';
import { color, fonts } from '@/lib/ui';

// UI-SPEC "Fonts": Cinzel 600, Montserrat 500/600, Lato 400/700.
const heading = Cinzel({ subsets: ['latin'], weight: ['600'], variable: '--font-heading', display: 'swap' });
const label = Montserrat({ subsets: ['latin'], weight: ['500', '600'], variable: '--font-label', display: 'swap' });
const body = Lato({ subsets: ['latin'], weight: ['400', '700'], variable: '--font-body', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: 'Moments to Media', template: '%s · Moments to Media' },
  description: 'Event photo and video by Moments to Media: book online, sign and pay, and download your media. Crew and studio sign in here too.',
  applicationName: 'Moments to Media',
  openGraph: { type: 'website', siteName: 'Moments to Media', locale: 'en_US' },
  twitter: { card: 'summary_large_image' },
  // Public pages may be indexed; every signed-in area sets noindex in its layout.
  robots: { index: true, follow: true },
};

// The few rules that cannot be inline styles (hover, focus, resets). Built
// from the tokens so there is still no raw colour anywhere in this app.
const base = `
*{box-sizing:border-box}
html,body{margin:0}
body{background:${color.bg};color:${color.text};font-family:${fonts.body};font-size:15px;-webkit-font-smoothing:antialiased}
a{color:${color.label}}
a:hover{color:${color.labelHover}}
:focus-visible{outline:3px solid ${color.text};outline-offset:2px;border-radius:2px}
button,input,select,textarea{font:inherit}
input[type=checkbox],input[type=radio]{width:20px;height:20px;accent-color:${color.text};flex:0 0 auto}
html{scroll-padding-top:16px}
@media (max-width:959px){html:has(.c-tabbar){scroll-padding-bottom:112px}html:has(.c-bar){scroll-padding-bottom:240px}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.skip-link{position:absolute;left:12px;top:-80px;z-index:100;background:${color.text};color:${color.surface};padding:12px 18px;border-radius:8px;font-weight:700;text-decoration:none}
.skip-link:focus{top:12px;color:${color.surface}}
`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  const raw = (await cookies()).get('mtm_flash')?.value;
  let flash: string | null = null;
  try {
    flash = raw ? decodeURIComponent(raw) : null;
  } catch {
    flash = null;
  }
  let demoWho: string | null = null;
  if (demoEnabled()) {
    const { data: { user } } = await (await createClient()).auth.getUser();
    demoWho = Object.values(DEMO_ACCOUNTS).find((a) => a.email === (user?.email ?? '').toLowerCase())?.who ?? null;
  }
  return (
    <html lang="en" className={`${heading.variable} ${label.variable} ${body.variable}`}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: base }} />
      </head>
      <body>
        <a href="#main" className="skip-link">Skip to main content</a>
        {demoWho ? <DemoBanner who={demoWho} /> : null}
        <FlashNotice message={flash} />
        {children}
        {/* Cookieless page-view counts (Vercel Web Analytics); see /privacy. */}
        <Analytics />
      </body>
    </html>
  );
}
