/* eslint-disable max-len, require-jsdoc, @typescript-eslint/no-var-requires */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  APPROVED_FROM,
  APPROVED_RECIPIENT,
  APPROVED_REPLY_TO,
  assertApprovedRenderedEmail,
  assertExactSentOutbox,
  assertLocalEnvironment,
  assertPristinePendingOutbox,
  expectedPaygOutboxId,
  inspectResendKeyFile,
  parseArguments,
  renderExactOutboxEmail,
  validateMembershipCorrelation,
  validatePaygCorrelation,
  validatePaygLifecycleProvider,
} = require("../scripts/preflightStripeTestOutboxDelivery");

const NOW = Date.parse("2026-09-02T12:00:00.000Z");
const timestamp = (millis = NOW) => ({toMillis: () => millis});
const INTENT_ID = `attempt_${"a".repeat(64)}`;
const SUBSCRIPTION_ID = "sub_conditioning_exact_test";
const SESSION_ID = "cs_test_conditioning_exact_test";
const PRICE_ID = "price_conditioning_exact_test";
const PAYG_ORDER_ID = `payg_${"b".repeat(64)}`;

function pristineOutbox(overrides = {}) {
  return {
    status: "pending",
    attemptCount: 0,
    nextAttemptAt: timestamp(),
    ...overrides,
  };
}

function membershipFixture() {
  return {
    nowMillis: NOW,
    session: {
      id: SESSION_ID,
      livemode: false,
      mode: "subscription",
      status: "complete",
      payment_status: "paid",
      subscription: SUBSCRIPTION_ID,
      customer_details: {email: APPROVED_RECIPIENT},
      customer_email: null,
      success_url: "http://localhost:3002/memberships/success?session_id={CHECKOUT_SESSION_ID}&plan=adult_conditioning",
      metadata: {intentId: INTENT_ID, planKey: "adult_conditioning"},
    },
    subscription: {
      id: SUBSCRIPTION_ID,
      livemode: false,
      items: {data: [{price: {id: PRICE_ID}}]},
    },
    intentId: INTENT_ID,
    intent: {
      checkoutSessionId: SESSION_ID,
      status: "fulfilled",
      planKey: "adult_conditioning",
      stripePriceId: PRICE_ID,
    },
    membershipId: SUBSCRIPTION_ID,
    membership: {
      checkoutSessionId: SESSION_ID,
      planKey: "adult_conditioning",
      payerEmail: APPROVED_RECIPIENT,
      stripePriceId: PRICE_ID,
      confirmationEmailStatus: "pending",
    },
    outboxId: SUBSCRIPTION_ID,
    outbox: pristineOutbox({
      kind: "membership_confirmation",
      subscriptionId: SUBSCRIPTION_ID,
      idempotencyKey: `membership-confirmation/${SUBSCRIPTION_ID}/v1`,
      payload: {
        from: APPROVED_FROM,
        to: [APPROVED_RECIPIENT],
        reply_to: APPROVED_REPLY_TO,
        subject: "Synthetic membership confirmation",
        html: "<p>Synthetic membership confirmation</p>",
      },
    }),
  };
}

function paygFixture(kind = "payg_guest_confirmation") {
  const paymentIntentId = "pi_payg_exact_test";
  const chargeId = "ch_payg_exact_test";
  const refundId = "re_payg_exact_test";
  const disputeId = "du_payg_exact_test";
  const outboxId = expectedPaygOutboxId(kind, PAYG_ORDER_ID);
  const order = {
    orderId: PAYG_ORDER_ID,
    checkoutSessionId: "cs_test_payg_exact_test",
    paymentIntentId,
    chargeId,
    purchaseKind: "payg_class",
    offeringKey: "adult_payg_class",
    stripeMode: "test",
    amountPence: 700,
    currency: "gbp",
    status: "confirmed",
    contact: {email: APPROVED_RECIPIENT},
    confirmationEmailStatus: "pending",
    refundEmailStatus: "pending",
    disputeEmailStatus: "pending",
    refundId,
    refundStatus: "succeeded",
    refundedAmountPence: 700,
    disputeId,
    disputeChargeId: chargeId,
    disputeAmountPence: 700,
    disputeCurrency: "gbp",
    refundAutomationStatus: "suspended_dispute",
  };
  const outbox = pristineOutbox({
    kind,
    orderId: PAYG_ORDER_ID,
    idempotencyKey: kind === "payg_guest_confirmation" ?
      `payg-confirmation/${PAYG_ORDER_ID}/v1` :
      kind === "payg_guest_refund_confirmation" ?
        `payg-refund-confirmed/${PAYG_ORDER_ID}/v1` :
        `payg-dispute-detected/${PAYG_ORDER_ID}/v1`,
    to: [APPROVED_RECIPIENT],
    ...(kind === "payg_guest_confirmation" ? {} : {
      templateData: {
        paymentIntentId,
        chargeId,
        amountPence: 700,
        currency: "gbp",
        ...(kind === "payg_guest_refund_confirmation" ? {refundId} : {disputeId}),
      },
    }),
  });
  return {
    nowMillis: NOW,
    session: {
      id: "cs_test_payg_exact_test",
      livemode: false,
      mode: "payment",
      status: "complete",
      payment_status: "paid",
      payment_intent: paymentIntentId,
      amount_total: 700,
      currency: "gbp",
      customer_details: {email: APPROVED_RECIPIENT},
      customer_email: null,
      client_reference_id: PAYG_ORDER_ID,
      success_url: "http://localhost:3002/pay-as-you-go/success?session_id={CHECKOUT_SESSION_ID}",
      metadata: {
        purchaseKind: "payg_class",
        offeringKey: "adult_payg_class",
        paygIntentId: PAYG_ORDER_ID,
      },
    },
    paymentIntent: {
      id: paymentIntentId,
      livemode: false,
      status: "succeeded",
      amount: 700,
      amount_received: 700,
      currency: "gbp",
    },
    orderId: PAYG_ORDER_ID,
    order,
    outboxId,
    outbox,
  };
}

test("arguments require one exact Session, outbox and protected key file", () => {
  const parsed = parseArguments([
    `--session=${SESSION_ID}`,
    `--outbox-id=${SUBSCRIPTION_ID}`,
    "--resend-key-file=/private/tmp/resend-test-key",
  ]);
  assert.equal(parsed.sessionId, SESSION_ID);
  assert.equal(parsed.outboxId, SUBSCRIPTION_ID);
  assert.equal(parsed.deliveryMode, "send");
  assert.equal(parseArguments([
    `--session=${SESSION_ID}`,
    `--outbox-id=${SUBSCRIPTION_ID}`,
    "--resend-key-file=/private/tmp/resend-test-key",
    "--mode=readback",
  ]).deliveryMode, "readback");
  assert.throws(() => parseArguments([
    `--session=${SESSION_ID}`,
    `--outbox-id=${SUBSCRIPTION_ID}`,
    "--resend-key-file=/private/tmp/resend-test-key",
    "--mode=latest",
  ]), {code: "invalid_delivery_mode"});
  assert.throws(() => parseArguments([
    `--session=${SESSION_ID}`,
    `--outbox-id=${SUBSCRIPTION_ID}`,
    "--recipient=somebody@example.test",
  ]), {code: "unknown_argument"});
  assert.throws(() => parseArguments([
    "--session=cs_live_not_allowed",
    `--outbox-id=${SUBSCRIPTION_ID}`,
    "--resend-key-file=/private/tmp/key",
  ]), {code: "invalid_session_id"});
});

test("environment is pinned to the demo project and fixed loopback emulators", () => {
  const valid = {
    GCLOUD_PROJECT: "demo-alphawod-stripe",
    GOOGLE_CLOUD_PROJECT: "demo-alphawod-stripe",
    FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
    FIREBASE_AUTH_EMULATOR_HOST: "localhost:9099",
    STRIPE_EXPECTED_MODE: "test",
  };
  assert.equal(assertLocalEnvironment(valid), true);
  assert.throws(() => assertLocalEnvironment({
    ...valid,
    GCLOUD_PROJECT: "alphawod-d1f2f",
  }), {code: "non_demo_project"});
  assert.throws(() => assertLocalEnvironment({
    ...valid,
    FIRESTORE_EMULATOR_HOST: "firestore.googleapis.com:443",
  }), {code: "non_loopback_firestore"});
  assert.throws(() => assertLocalEnvironment({
    ...valid,
    RESEND_API_KEY: "re_must_not_be_in_environment",
  }), {code: "resend_secret_in_environment"});
});

test("Resend key inspection requires an outside-repository owned 0600 regular file and returns no key", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "alphawod-resend-preflight-"));
  const keyFile = path.join(directory, "resend.key");
  const linkFile = path.join(directory, "resend-link.key");
  try {
    fs.writeFileSync(keyFile, `re_${"x".repeat(40)}\n`, {mode: 0o600});
    fs.chmodSync(keyFile, 0o600);
    const evidence = inspectResendKeyFile(keyFile);
    assert.deepEqual(evidence, {
      mode: "0600",
      outsideRepository: true,
      shapeValid: true,
    });
    assert.doesNotMatch(JSON.stringify(evidence), /re_[A-Za-z0-9_-]+/);
    fs.chmodSync(keyFile, 0o644);
    assert.throws(() => inspectResendKeyFile(keyFile), {code: "secret_file_permissions"});
    fs.chmodSync(keyFile, 0o600);
    fs.symlinkSync(keyFile, linkFile);
    assert.throws(() => inspectResendKeyFile(linkFile), {code: "secret_file_symlink"});
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
});

test("only a pristine, due, never-attempted pending outbox passes", () => {
  assert.doesNotThrow(() => assertPristinePendingOutbox(pristineOutbox(), NOW));
  assert.throws(() => assertPristinePendingOutbox(pristineOutbox({status: "sent"}), NOW),
    {code: "outbox_not_pending"});
  assert.throws(() => assertPristinePendingOutbox(pristineOutbox({attemptCount: 1}), NOW),
    {code: "outbox_not_pristine"});
  assert.throws(() => assertPristinePendingOutbox(
    pristineOutbox({nextAttemptAt: timestamp(NOW + 60_000)}), NOW
  ), {code: "outbox_not_due"});
});

test("readback accepts only one exact persisted one-shot acceptance", () => {
  const providerMessageId = "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794";
  assert.equal(assertExactSentOutbox({
    status: "sent",
    attemptCount: 1,
    sentAt: timestamp(),
    providerMessageId,
  }), providerMessageId);
  assert.throws(() => assertExactSentOutbox({
    status: "sent",
    attemptCount: 2,
    sentAt: timestamp(),
    providerMessageId,
  }), {code: "outbox_not_exact_sent"});
});

test("full rendered payload validation runs before delivery and rejects hidden routing", () => {
  const fixture = membershipFixture();
  assert.equal(assertApprovedRenderedEmail(fixture.outbox.payload), true);
  assert.equal(renderExactOutboxEmail({
    purchaseType: "membership",
    outbox: fixture.outbox,
  }), fixture.outbox.payload);
  fixture.outbox.payload.bcc = [APPROVED_RECIPIENT];
  assert.throws(() => renderExactOutboxEmail({
    purchaseType: "membership",
    outbox: fixture.outbox,
  }), {code: "rendered_extra_field"});

  const rendered = {
    from: APPROVED_FROM,
    to: [APPROVED_RECIPIENT],
    reply_to: APPROVED_REPLY_TO,
    subject: "Synthetic PAYG confirmation",
    text: "Synthetic PAYG confirmation",
    html: "<p>Synthetic PAYG confirmation</p>",
  };
  assert.equal(renderExactOutboxEmail({
    purchaseType: "payg",
    kind: "payg_guest_confirmation",
    outbox: paygFixture().outbox,
  }, {
    buildPaygConfirmationEmail: () => rendered,
  }), rendered);
});

test("membership correlation binds test Checkout, subscription, intent, membership and exact email", () => {
  assert.deepEqual(validateMembershipCorrelation(membershipFixture()), {
    kind: "membership_confirmation",
    purchaseType: "membership",
    ownerId: SUBSCRIPTION_ID,
    providerMessageId: null,
  });
  const wrongRecipient = membershipFixture();
  wrongRecipient.outbox.payload.to = ["somebody@example.test"];
  assert.throws(() => validateMembershipCorrelation(wrongRecipient),
    {code: "membership_outbox_recipient_mismatch"});
  const live = membershipFixture();
  live.subscription.livemode = true;
  assert.throws(() => validateMembershipCorrelation(live),
    {code: "stripe_readback_mismatch"});
});

test("membership readback remains bound to the exact sent projection", () => {
  const fixture = membershipFixture();
  const providerMessageId = "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794";
  fixture.deliveryMode = "readback";
  fixture.outbox = {
    ...fixture.outbox,
    status: "sent",
    attemptCount: 1,
    nextAttemptAt: null,
    sentAt: timestamp(),
    providerMessageId,
  };
  fixture.membership.confirmationEmailStatus = "sent";
  fixture.membership.confirmationEmailProviderId = providerMessageId;
  fixture.membership.confirmationEmailSentAt = timestamp();
  assert.equal(
    validateMembershipCorrelation(fixture).providerMessageId,
    providerMessageId
  );
  fixture.membership.confirmationEmailProviderId = "different-message-id";
  assert.throws(() => validateMembershipCorrelation(fixture),
    {code: "membership_email_state_mismatch"});
});

test("PAYG correlation supports only confirmation, refund and dispute for the exact £7 payment", () => {
  for (const kind of [
    "payg_guest_confirmation",
    "payg_guest_refund_confirmation",
    "payg_guest_dispute_notice",
  ]) {
    const result = validatePaygCorrelation(paygFixture(kind));
    assert.equal(result.kind, kind);
    assert.equal(result.purchaseType, "payg");
    assert.equal(result.providerMessageId, null);
  }
  const correction = paygFixture();
  correction.outbox.kind = "payg_guest_confirmation_correction";
  assert.throws(() => validatePaygCorrelation(correction),
    {code: "unsupported_outbox_kind"});
  const wrongAmount = paygFixture();
  wrongAmount.paymentIntent.amount = 600;
  assert.throws(() => validatePaygCorrelation(wrongAmount),
    {code: "payg_payment_invalid"});
});

test("PAYG readback remains bound to its exact lifecycle projection", () => {
  const fixture = paygFixture("payg_guest_refund_confirmation");
  const providerMessageId = "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794";
  fixture.deliveryMode = "readback";
  fixture.outbox = {
    ...fixture.outbox,
    status: "sent",
    attemptCount: 1,
    nextAttemptAt: null,
    sentAt: timestamp(),
    providerMessageId,
  };
  fixture.order.refundEmailStatus = "sent";
  fixture.order.refundEmailProviderId = providerMessageId;
  fixture.order.refundEmailSentAt = timestamp();
  assert.equal(validatePaygCorrelation(fixture).providerMessageId, providerMessageId);
  fixture.order.refundEmailProviderId = "different-message-id";
  assert.throws(() => validatePaygCorrelation(fixture),
    {code: "payg_order_email_state_mismatch"});
});

test("refund and dispute email claims require exact non-live provider readback", () => {
  const refundFixture = paygFixture("payg_guest_refund_confirmation");
  const paymentIntent = refundFixture.paymentIntent;
  const charge = {
    id: "ch_payg_exact_test",
    livemode: false,
    payment_intent: paymentIntent.id,
    amount: 700,
    currency: "gbp",
  };
  const refund = {
    id: "re_payg_exact_test",
    livemode: false,
    status: "succeeded",
    amount: 700,
    currency: "gbp",
    payment_intent: paymentIntent.id,
    charge: charge.id,
  };
  assert.equal(validatePaygLifecycleProvider({
    kind: refundFixture.outbox.kind,
    outbox: refundFixture.outbox,
    paymentIntent,
    charge,
    refund,
    dispute: null,
  }), true);
  assert.throws(() => validatePaygLifecycleProvider({
    kind: refundFixture.outbox.kind,
    outbox: refundFixture.outbox,
    paymentIntent,
    charge,
    refund: {...refund, livemode: true},
    dispute: null,
  }), {code: "stripe_readback_mismatch"});

  const disputeFixture = paygFixture("payg_guest_dispute_notice");
  assert.equal(validatePaygLifecycleProvider({
    kind: disputeFixture.outbox.kind,
    outbox: disputeFixture.outbox,
    paymentIntent,
    charge,
    refund: null,
    dispute: {
      id: "du_payg_exact_test",
      livemode: false,
      amount: 700,
      currency: "gbp",
      payment_intent: paymentIntent.id,
      charge: charge.id,
    },
  }), true);
});

test("preflight source contains no Resend call, email processor or outbox mutation path", () => {
  const source = fs.readFileSync(path.resolve(
    __dirname,
    "../scripts/preflightStripeTestOutboxDelivery.js"
  ), "utf8");
  assert.doesNotMatch(source, /api\.resend\.com|fetch\s*\(/);
  assert.doesNotMatch(source, /processMembershipConfirmationOutbox|processPaygConfirmationOutbox/);
  assert.doesNotMatch(source, /retryDueMembership|retryDuePayg/);
  assert.doesNotMatch(source, /\.where\s*\(|checkout\.sessions\.list/);
  assert.doesNotMatch(source, /RESEND_API_KEY\s*=/);

  const runner = fs.readFileSync(path.resolve(
    __dirname,
    "../scripts/runLocalStripeTestJourney.js"
  ), "utf8");
  assert.match(runner, /const LOCAL_DISABLED_RESEND_API_KEY = " ";/);
  assert.match(runner, /RESEND_API_KEY: LOCAL_DISABLED_RESEND_API_KEY/);
});
