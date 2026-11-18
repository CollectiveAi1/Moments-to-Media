'use client';

import { Analytics } from '@vercel/analytics/next';
import { redactUrl } from '@/lib/analytics-redact';

/** Cookieless page-view counts (Vercel Web Analytics), with secrets taken out of addresses first. */
export function SiteAnalytics() {
  return <Analytics beforeSend={(event) => ({ ...event, url: redactUrl(event.url) })} />;
}
