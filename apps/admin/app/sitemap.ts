import type { MetadataRoute } from 'next';
import { createClient } from '@supabase/supabase-js';
import { supabaseAnonKey, supabaseUrl } from '@/lib/env';
import { PUBLIC_PAGES, SITE_URL } from '@/lib/site';

export const revalidate = 3600;

/** The public pages, plus each organization's inquiry form. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const pages: MetadataRoute.Sitemap = PUBLIC_PAGES.map((p) => ({ url: `${SITE_URL}${p === '/' ? '' : p}`, lastModified: now, changeFrequency: 'monthly', priority: p === '/' ? 1 : 0.5 }));
  try {
    const anon = createClient(supabaseUrl(), supabaseAnonKey(), { auth: { persistSession: false } });
    const { data } = await anon.rpc('signup_orgs', { p_role: 'client' });
    for (const o of (data ?? []) as Array<{ slug: string }>) {
      pages.push({ url: `${SITE_URL}/inquire/${o.slug}`, lastModified: now, changeFrequency: 'weekly', priority: 0.9 });
    }
  } catch {
    // The static pages are still listed.
  }
  return pages;
}
