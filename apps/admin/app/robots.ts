import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

/**
 * Public pages may be indexed. Everything behind a sign-in, and the private
 * proposal links, may not (they are also marked noindex on the page).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/login/', '/signup/', '/inquire/', '/privacy'],
        disallow: ['/board', '/events', '/staffing', '/contractors', '/footage', '/payouts', '/leads', '/proposals', '/invoices', '/clients', '/packages', '/announcements', '/settings', '/app', '/portal', '/p/', '/pending', '/account', '/auth/', '/download/', '/sign-in'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
