/* eslint-disable @typescript-eslint/no-var-requires, max-len, require-jsdoc */

const assert = require("node:assert/strict");
const test = require("node:test");
const Stripe = require("stripe");
const {createFakeStripe} = require("../test-emulator/fakeStripe");

test("fake Stripe supports the one-time PAYG payment and refund seams", async () => {
  const fake = createFakeStripe();
  const port = await fake.listen(0);
  const stripe = new Stripe("sk_test_fake", {
    host: "127.0.0.1",
    port,
    protocol: "http",
  });
  try {
    const priceId = "price_1UAmVVFzNDZoGGA04z8hX10N";
    const price = await stripe.prices.retrieve(priceId, {expand: ["product"]});
    assert.equal(price.unit_amount, 700);
    assert.equal(price.type, "one_time");
    assert.equal(price.product.id, "prod_VAOxXxpax1MuRt");

    const intentId = `payg_${"a".repeat(64)}`;
    const metadata = {
      purchaseKind: "payg_class",
      offeringKey: "adult_payg_class",
      paygIntentId: intentId,
      classId: "class_payg_1",
      schemaVersion: "1",
    };
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{price: priceId, quantity: 1}],
      client_reference_id: intentId,
      customer_email: "guest@example.test",
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      success_url: "https://example.test/success",
      cancel_url: "https://example.test/cancel",
      metadata,
      payment_intent_data: {metadata},
    });
    assert.deepEqual(session.metadata, metadata);
    const completed = fake.completePaygCheckout(session.id);
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
      expand: ["data.price.product"],
    });
    assert.equal(lineItems.data.length, 1);
    assert.equal(lineItems.data[0].amount_total, 700);
    assert.equal(lineItems.data[0].price.product.id, "prod_VAOxXxpax1MuRt");

    const paymentIntent = await stripe.paymentIntents.retrieve(
      completed.paymentIntent.id
    );
    assert.equal(paymentIntent.status, "succeeded");
    assert.deepEqual(paymentIntent.metadata, metadata);
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntent.id,
      metadata: {paygOrderId: intentId},
    });
    assert.equal(refund.status, "succeeded");
    assert.equal(refund.amount, 700);
    assert.equal(refund.metadata.paygOrderId, intentId);
  } finally {
    await fake.close();
  }
});
