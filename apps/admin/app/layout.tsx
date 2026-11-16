import type { Metadata } from 'next';
import { Cinzel, Lato, Montserrat } from 'next/font/google';
import type { ReactNode } from 'react';
import { color, fonts } from '@/lib/ui';

// UI-SPEC "Fonts": Cinzel 600, Montserrat 500/600, Lato 400/700.
const heading = Cinzel({ subsets: ['latin'], weight: ['600'], variable: '--font-heading', display: 'swap' });
const label = Montserrat({ subsets: ['latin'], weight: ['500', '600'], variable: '--font-label', display: 'swap' });
const body = Lato({ subsets: ['latin'], weight: ['400', '700'], variable: '--font-body', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Moments to Media', template: '%s · Moments to Media' },
  description: 'Operations console for Moments to Media crews.',
  robots: { index: false, follow: false },
};

// The few rules that cannot be inline styles (hover, focus, resets). Built
// from the tokens so there is still no raw colour anywhere in this app.
const base = `
*{box-sizing:border-box}
html,body{margin:0}
body{background:${color.bg};color:${color.text};font-family:${fonts.body};font-size:15px;-webkit-font-smoothing:antialiased}
a{color:${color.label}}
a:hover{color:${color.labelHover}}
:focus-visible{outline:2px solid ${color.label};outline-offset:2px}
button,input,select{font:inherit}
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${heading.variable} ${label.variable} ${body.variable}`}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: base }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
