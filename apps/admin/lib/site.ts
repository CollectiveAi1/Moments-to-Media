/** The public address of the site, for canonical links, the sitemap and share images. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://moments-to-media-admin.vercel.app').replace(/\/$/, '');

/** Paths that are public and worth listing for search engines. */
export const PUBLIC_PAGES = ['/', '/login/client', '/login/contractor', '/login/admin', '/signup/client', '/signup/contractor', '/privacy'];
