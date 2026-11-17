/**
 * client-checkout — start a Stripe Checkout for a client invoice.
 *
 *   POST { invoice_id, amount: "due" | "balance", return_url }  ->  { url }
 *
 * The invoice is read with the caller's own token, so row-level security is
 * the permission check: a client reaches only their own sent invoices. The
 * amount is worked out here from the invoice and its schedule, never taken
 * from the browser. Card payments are off until the organization's owner
 * switches them on and STRIPE_SECRET_KEY is set (docs/client-portal.md).
 * The payment is recorded by stripe-webhook, not here.
 */

import { readEnv } from "../_shared/env.ts";
import { HttpError, json, readJson, requireAuthorization, requirePost, requireString, toResponse } from "../_shared/http.ts";
import { dueNow, stripePost, type Installment } from "../_shared/stripe.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_ORIGINS = ["https://moments-to-media-admin.vercel.app", "http://localhost:3000"];

function allowedReturn(raw: unknown, invoiceId: string): string {
  const origins = (Deno.env.get("APP_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const allow = origins.length ? origins : DEFAULT_ORIGINS;
  try {
    const url = new URL(String(raw ?? ""));
    if (allow.includes(url.origin) && url.pathname === `/portal/invoices/${invoiceId}`) return `${url.origin}${url.pathname}`;
  } catch {
    // fall through
  }
  return `${allow[0]}/portal/invoices/${invoiceId}`;
}

function today(zone = "America/New_York"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

Deno.serve(async (req) => {
  try {
    requirePost(req);
    const authorization = requireAuthorization(req);
    const body = await readJson<Record<string, unknown>>(req);
    const invoiceId = requireString(body, "invoice_id");
    if (!UUID.test(invoiceId)) throw new HttpError("invoice_id must be a uuid", 400);
    const which = body.amount === "balance" ? "balance" : "due";

    const env = readEnv();
    const headers = { apikey: env.SUPABASE_ANON_KEY, Authorization: authorization, accept: "application/json" };
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/invoices?id=eq.${invoiceId}&select=id,org_id,number,title,status,total_cents,paid_cents,invoice_installments!invoice_installments_invoice_id_fkey(label,amount_cents,due_on)`,
      { headers },
    );
    if (!res.ok) throw new HttpError(`could not read the invoice (${res.status})`, 502);
    const rows = (await res.json()) as Array<{
      id: string; org_id: string; number: number; title: string; status: string; total_cents: number; paid_cents: number;
      invoice_installments: Installment[];
    }>;
    const inv = rows[0];
    if (!inv) throw new HttpError("invoice not found", 404);
    if (inv.status !== "open" && inv.status !== "partially_paid") {
      throw new HttpError(inv.status === "paid" ? "This invoice is already paid. Thank you!" : "This invoice is not open for payment.", 409);
    }

    const flag = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/client_payments_enabled`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ p_org: inv.org_id }),
    });
    const enabled = flag.ok ? ((await flag.json()) as boolean) : false;
    const secret = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
    if (!enabled || secret.trim() === "") {
      throw new HttpError("Card payments are not switched on yet. Contact us to pay by check or transfer.", 409, "payments_off");
    }

    const balance = inv.total_cents - inv.paid_cents;
    const due = which === "balance" ? { cents: balance, label: "Balance" } : dueNow(inv.invoice_installments, inv.paid_cents, today()) ?? { cents: balance, label: "Balance" };
    const amount = Math.min(due.cents, balance);
    if (amount < 50) throw new HttpError("There is nothing to pay on this invoice right now.", 409);

    const back = allowedReturn(body.return_url, invoiceId);
    const session = await stripePost<{ id: string; url: string }>(
      secret,
      "checkout/sessions",
      {
        mode: "payment",
        client_reference_id: inv.id,
        success_url: `${back}?paid=1`,
        cancel_url: `${back}?cancelled=1`,
        line_items: [{
          quantity: 1,
          price_data: { currency: "usd", unit_amount: amount, product_data: { name: `Invoice ${inv.number} · ${inv.title} · ${due.label}` } },
        }],
        metadata: { invoice_id: inv.id, org_id: inv.org_id, amount_cents: amount },
        payment_intent_data: { metadata: { invoice_id: inv.id, org_id: inv.org_id } },
      },
      // One open checkout per invoice, amount and minute: a double click does not make two.
      `checkout:${inv.id}:${amount}:${inv.paid_cents}:${Math.floor(Date.now() / 60_000)}`,
    );
    return json({ url: session.url });
  } catch (err) {
    return toResponse(err);
  }
});
