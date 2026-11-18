/**
 * The two pieces of Stripe this app needs, with no SDK: creating a Checkout
 * Session (a form-encoded POST) and verifying a webhook signature (HMAC-SHA256
 * over "timestamp.body", compared in constant time).
 *
 * Keys come from Edge Function secrets only (CLAUDE.md rule 4):
 *   STRIPE_SECRET_KEY      Moments to Media's own Stripe account
 *   STRIPE_WEBHOOK_SECRET  the signing secret of the webhook endpoint
 */

/** Flattens nested objects the way Stripe's form API expects: a[b][0][c]=v. */
export function formEncode(value: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === "object") {
          out.push(...formEncode(item as Record<string, unknown>, `${key}[${i}]`));
        } else {
          out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else if (typeof v === "object") {
      out.push(...formEncode(v as Record<string, unknown>, key));
    } else {
      out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return out;
}

/**
 * Every request names its API version, so a Stripe upgrade to the account's
 * default never changes what we send or get back. The webhook endpoint in the
 * Stripe dashboard is pinned to the same version (docs/client-portal.md).
 */
export const STRIPE_API_VERSION = "2026-10-28.endive";

export async function stripePost<T>(secretKey: string, path: string, body: Record<string, unknown>, idempotencyKey?: string): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secretKey}`,
    "content-type": "application/x-www-form-urlencoded",
    "Stripe-Version": STRIPE_API_VERSION,
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const res = await fetch(`https://api.stripe.com/v1/${path}`, { method: "POST", headers, body: formEncode(body).join("&") });
  const parsed = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`stripe ${path} failed (${res.status}): ${parsed.error?.message ?? "no message"}`);
  return parsed;
}

const encoder = new TextEncoder();

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * True when the Stripe-Signature header was made with this secret over this
 * exact body, within the tolerance (default five minutes, Stripe's own).
 */
export async function verifyStripeSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300,
): Promise<boolean> {
  if (!header) return false;
  const parts = header.split(",").map((p) => p.trim().split("=", 2) as [string, string]);
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const v1 = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!Number.isFinite(t) || v1.length === 0) return false;
  if (Math.abs(nowSeconds - t) > toleranceSeconds) return false;
  const expected = await hmacHex(secret, `${t}.${rawBody}`);
  return v1.some((sig) => constantTimeEqual(sig, expected));
}

/** Test helper: the header Stripe would send for this body. */
export async function signForTest(rawBody: string, secret: string, t: number): Promise<string> {
  return `t=${t},v1=${await hmacHex(secret, `${t}.${rawBody}`)}`;
}

// ------------------------------------------------------------ schedule

export interface Installment {
  label: string;
  amount_cents: number;
  due_on: string;
}

/**
 * The amount due now on an invoice: every installment due today or earlier
 * that payments have not covered, else the next one. Matches
 * apps/admin/lib/billing/schedule.ts, which the portal shows.
 */
export function dueNow(installments: Installment[], paidCents: number, today: string): { cents: number; label: string } | null {
  let left = Math.max(0, paidCents);
  const owing = [...installments]
    .sort((a, b) => a.due_on.localeCompare(b.due_on) || a.label.localeCompare(b.label))
    .map((i) => {
      const paid = Math.min(i.amount_cents, left);
      left -= paid;
      return { ...i, remaining: i.amount_cents - paid };
    })
    .filter((i) => i.remaining > 0);
  if (owing.length === 0) return null;
  const due = owing.filter((i) => i.due_on <= today);
  if (due.length) {
    return { cents: due.reduce((n, i) => n + i.remaining, 0), label: due.length === 1 ? due[0].label : "Amount due now" };
  }
  return { cents: owing[0].remaining, label: owing[0].label };
}
