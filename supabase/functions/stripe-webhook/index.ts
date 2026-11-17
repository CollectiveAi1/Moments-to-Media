/**
 * stripe-webhook — records a client's card payment when Stripe confirms it.
 *
 * CLAUDE.md rule 8: verifies the Stripe signature on the raw body before
 * reading it, and is idempotent. record_stripe_payment keys on the Checkout
 * Session id, so a retried or replayed event records nothing twice.
 *
 * Deployed with JWT verification off, because Stripe does not send a Supabase
 * token; the signature is the authentication.
 */

import { readEnv } from "../_shared/env.ts";
import { asService } from "../_shared/db.ts";
import { fail, json, toResponse } from "../_shared/http.ts";
import { verifyStripeSignature } from "../_shared/stripe.ts";

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

    const event = JSON.parse(raw) as { id: string; type: string; data: { object: Session } };
    if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") {
      return json({ received: true, ignored: event.type });
    }
    const s = event.data.object;
    if (s.payment_status !== "paid") return json({ received: true, pending: true });

    const invoiceId = s.metadata?.invoice_id ?? s.client_reference_id ?? "";
    if (!UUID.test(invoiceId) || !s.amount_total || s.amount_total <= 0) {
      console.error(`checkout ${s.id} has no invoice or amount`);
      return json({ received: true, ignored: "no invoice" });
    }

    const env = readEnv();
    const paymentId = await asService(env)<string>("record_stripe_payment", {
      p_invoice: invoiceId,
      p_amount: s.amount_total,
      p_session: s.id,
      p_payment_intent: typeof s.payment_intent === "string" ? s.payment_intent : null,
      p_method: (s.payment_method_types ?? []).includes("us_bank_account") ? "ach" : "card",
    });
    return json({ received: true, payment_id: paymentId });
  } catch (err) {
    // A 5xx makes Stripe retry, which is what we want for a database hiccup.
    return toResponse(err);
  }
});
