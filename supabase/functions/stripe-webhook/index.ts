/**
 * stripe-webhook — keeps invoices in step with Stripe: payments, failed bank
 * payments, refunds and disputes (HANDLED_EVENTS).
 *
 * CLAUDE.md rule 8: verifies the Stripe signature on the raw body before
 * reading it, and is idempotent. Payments key on the Checkout Session id; refunds and
 * disputes are set from Stripe's own totals, never added to; a dispute event
 * older than the last one applied is ignored. A retried or replayed event
 * changes nothing.
 *
 * Deployed with JWT verification off, because Stripe does not send a Supabase
 * token; the signature is the authentication.
 */

import { readEnv } from "../_shared/env.ts";
import { asService } from "../_shared/db.ts";
import { fail, HttpError, json, toResponse } from "../_shared/http.ts";
import { verifyStripeSignature } from "../_shared/stripe.ts";

/** Every event this endpoint should be subscribed to in the Stripe dashboard. */
export const HANDLED_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "charge.dispute.funds_withdrawn",
  "charge.dispute.funds_reinstated",
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Session = {
  id: string;
  payment_status: string;
  amount_total: number | null;
  payment_intent: string | null;
  client_reference_id: string | null;
  metadata: Record<string, string> | null;
  payment_method_types?: string[];
};

type Charge = { id: string; payment_intent: string | { id: string } | null; amount_refunded: number };
type Dispute = { id: string; payment_intent: string | { id: string } | null; amount: number; status: string };

function idOf(v: string | { id: string } | null | undefined): string | null {
  if (!v) return null;
  return typeof v === "string" ? v : v.id ?? null;
}

function invoiceOf(s: Session): string | null {
  const id = s.metadata?.invoice_id ?? s.client_reference_id ?? "";
  return UUID.test(id) ? id : null;
}

/**
 * The Stripe account is shared with Collective Ai's other business, so this
 * endpoint also hears about payments that are not ours. The database answers
 * "not found" (404) for a payment intent or invoice it has never seen; that is
 * acknowledged and skipped, because a non-2xx would make Stripe retry for days.
 */
function notOurs(err: unknown): boolean {
  return err instanceof HttpError && err.status === 404;
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return fail("use POST", 405);
    const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
    if (secret.trim() === "") {
      console.error("STRIPE_WEBHOOK_SECRET is not set");
      return fail("webhook not configured", 500);
    }
    const raw = await req.text();
    if (!(await verifyStripeSignature(raw, req.headers.get("stripe-signature"), secret))) {
      return fail("bad signature", 400);
    }

    const event = JSON.parse(raw) as { id: string; type: string; created: number; data: { object: unknown } };
    const env = readEnv();
    const service = asService(env);

    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const s = event.data.object as Session;
        if (s.payment_status !== "paid") return json({ received: true, pending: true });
        const invoiceId = invoiceOf(s);
        if (!invoiceId || !s.amount_total || s.amount_total <= 0) {
          console.error(`checkout ${s.id} has no invoice or amount`);
          return json({ received: true, ignored: "no invoice" });
        }
        const paymentId = await service<string>("record_stripe_payment", {
          p_invoice: invoiceId,
          p_amount: s.amount_total,
          p_session: s.id,
          p_payment_intent: typeof s.payment_intent === "string" ? s.payment_intent : null,
          p_method: (s.payment_method_types ?? []).includes("us_bank_account") ? "ach" : "card",
        });
        return json({ received: true, payment_id: paymentId });
      }

      // A bank payment that did not clear. Nothing was recorded as paid; the
      // owners are told so the client can be asked to pay another way.
      case "checkout.session.async_payment_failed": {
        const s = event.data.object as Session;
        const invoiceId = invoiceOf(s);
        if (!invoiceId) return json({ received: true, ignored: "no invoice" });
        await service("record_stripe_payment_failed", { p_invoice: invoiceId, p_session: s.id });
        return json({ received: true, failed: true });
      }

      // amount_refunded is Stripe's running total, so replays change nothing.
      case "charge.refunded": {
        const c = event.data.object as Charge;
        const pi = idOf(c.payment_intent);
        if (!pi) return json({ received: true, ignored: "no payment intent" });
        const paymentId = await service<string>("record_stripe_refund", { p_payment_intent: pi, p_refunded: c.amount_refunded });
        return json({ received: true, payment_id: paymentId });
      }

      case "charge.dispute.created":
      case "charge.dispute.updated":
      case "charge.dispute.closed":
      case "charge.dispute.funds_withdrawn":
      case "charge.dispute.funds_reinstated": {
        const d = event.data.object as Dispute;
        const pi = idOf(d.payment_intent);
        if (!pi) return json({ received: true, ignored: "no payment intent" });
        const paymentId = await service<string>("record_stripe_dispute", {
          p_payment_intent: pi,
          p_dispute: d.id,
          p_amount: d.amount,
          p_status: d.status,
          p_event_at: new Date(event.created * 1000).toISOString(),
        });
        return json({ received: true, payment_id: paymentId });
      }

      default:
        return json({ received: true, ignored: event.type });
    }
  } catch (err) {
    if (notOurs(err)) {
      console.warn(`stripe-webhook: skipped, not an invoice payment (${(err as Error).message})`);
      return json({ received: true, ignored: "not ours" });
    }
    // A 5xx makes Stripe retry, which is what we want for a database hiccup.
    return toResponse(err);
  }
});
