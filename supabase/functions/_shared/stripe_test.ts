import { assert, assertEquals } from "jsr:@std/assert@1";
import { dueNow, formEncode, signForTest, verifyStripeSignature } from "./stripe.ts";

Deno.test("form encoding nests like Stripe expects", () => {
  const out = formEncode({ mode: "payment", line_items: [{ price_data: { unit_amount: 100 }, quantity: 1 }], metadata: { invoice_id: "x" } });
  assertEquals(out, [
    "mode=payment",
    "line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=100",
    "line_items%5B0%5D%5Bquantity%5D=1",
    "metadata%5Binvoice_id%5D=x",
  ]);
});

Deno.test("a signature made with the secret verifies; a changed body does not", async () => {
  const body = '{"id":"evt_1"}';
  const header = await signForTest(body, "whsec_test", 1_800_000_000);
  assert(await verifyStripeSignature(body, header, "whsec_test", 1_800_000_010));
  assert(!(await verifyStripeSignature(body + " ", header, "whsec_test", 1_800_000_010)));
  assert(!(await verifyStripeSignature(body, header, "whsec_other", 1_800_000_010)));
});

Deno.test("an old signature is refused, so a captured webhook cannot be replayed later", async () => {
  const body = "{}";
  const header = await signForTest(body, "s", 1_800_000_000);
  assert(!(await verifyStripeSignature(body, header, "s", 1_800_000_000 + 301)));
  assert(!(await verifyStripeSignature(body, null, "s")));
});

Deno.test("due now: overdue installments together, else the next one", () => {
  const inst = [
    { label: "Deposit", amount_cents: 300, due_on: "2026-11-17" },
    { label: "Balance", amount_cents: 700, due_on: "2026-12-01" },
  ];
  assertEquals(dueNow(inst, 0, "2026-11-18"), { cents: 300, label: "Deposit" });
  assertEquals(dueNow(inst, 300, "2026-11-18"), { cents: 700, label: "Balance" });
  assertEquals(dueNow(inst, 0, "2026-12-02"), { cents: 1000, label: "Amount due now" });
  assertEquals(dueNow(inst, 1000, "2026-12-02"), null);
});
