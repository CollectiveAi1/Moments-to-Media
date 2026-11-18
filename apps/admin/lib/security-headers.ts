/**
 * Response headers for every page (next.config.ts). No imports, so the config
 * and the unit test can both load it.
 *
 * Enforced now: no framing by other sites (clickjacking), no MIME sniffing,
 * no referrer path to other sites, and only the device features the app uses
 * (location, for check-in).
 *
 * The full content security policy starts in report-only mode: browsers log
 * what it would block without blocking it. Once a few days of real use show
 * no reports, it moves to Content-Security-Policy.
 */
const SUPABASE = 'https://*.supabase.co';
const R2 = 'https://*.r2.cloudflarestorage.com';

export const CONTENT_SECURITY_POLICY_REPORT_ONLY = [
  "default-src 'self'",
  // Next.js inlines its bootstrap scripts and the app inlines its styles.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  // Uploads go from the browser to the upload functions and straight to R2.
  `connect-src 'self' ${SUPABASE} ${R2}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  // Card payments leave through Stripe Checkout.
  "form-action 'self' https://checkout.stripe.com",
].join('; ');

export const SECURITY_HEADERS: { key: string; value: string }[] = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
  { key: 'Content-Security-Policy-Report-Only', value: CONTENT_SECURITY_POLICY_REPORT_ONLY },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), payment=(), usb=(), geolocation=(self)' },
];
