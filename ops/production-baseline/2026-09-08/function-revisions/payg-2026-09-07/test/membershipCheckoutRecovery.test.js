/* eslint-disable @typescript-eslint/no-var-requires, max-len, require-jsdoc */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CHECKOUT_RECOVERY_RECIPIENT_SOURCES,
  MEMBERSHIP_CHECKOUT_RECOVERY_EMAIL_SCHEMA_VERSION,
  buildCheckoutRecoveryPayload,
  canonicalizeCheckoutRecoveryEmail,
  checkoutRecoveryIdempotencyKey,
  checkoutRecoveryOutboxId,
  maskCheckoutRecoveryEmail,
} = require("../lib/membershipCheckoutRecovery");

const INTENT_A = `attempt_${"a".repeat(64)}`;
const INTENT_B = `attempt_${"b".repeat(64)}`;

function validInput(overrides = {}) {
  return {
    recipientEmail: "  Olivia.Jones+Gym@Example.COM  ",
    fromEmail: "HELLO@ZEROALPHAFITNESS.CO.UK",
    publicOrigin: "https://alpha-wod.vercel.app/",
    planName: "HYROX Youngstars",
    participantFullNames: ["Olivia Jones"],
    ...overrides,
  };
}

test("checkout recovery email canonicalisation and masking avoid raw audit PII", () => {
  assert.equal(
    canonicalizeCheckoutRecoveryEmail("  Olivia.Jones+Gym@Example.COM  "),
    "olivia.jones+gym@example.com"
  );
  assert.equal(
    maskCheckoutRecoveryEmail("  Olivia.Jones+Gym@Example.COM  "),
    "o***@example.com"
  );
  assert.equal(maskCheckoutRecoveryEmail("x@example.com"), "*@example.com");

  for (const invalid of [
    null,
    "",
    "missing-at.example.com",
    "two@@example.com",
    "member@example..com",
    "member@.example.com",
    "member@example.com\nBcc: attacker@example.test",
  ]) {
    assert.equal(canonicalizeCheckoutRecoveryEmail(invalid), null);
    assert.equal(maskCheckoutRecoveryEmail(invalid), null);
  }
});

test("recipient evidence vocabulary preserves each reviewed source boundary", () => {
  assert.deepEqual([...CHECKOUT_RECOVERY_RECIPIENT_SOURCES], [
    "stripe_session_customer_details",
    "stripe_session_customer_email",
    "authenticated_intent",
    "stripe_customer",
  ]);
});

test("checkout recovery outbox and provider IDs are stable, scoped, and opaque", () => {
  assert.equal(MEMBERSHIP_CHECKOUT_RECOVERY_EMAIL_SCHEMA_VERSION, 1);
  assert.equal(
    checkoutRecoveryOutboxId(INTENT_A),
    "checkout-recovery-email_6fa378d3a60a6fd618dc44d34bb15edc4b821a5edcfb7aeae598877cbe3682fe"
  );
  assert.equal(
    checkoutRecoveryIdempotencyKey(INTENT_A),
    "membership-checkout-recovery/6fa378d3a60a6fd618dc44d34bb15edc4b821a5edcfb7aeae598877cbe3682fe/v1"
  );
  assert.equal(checkoutRecoveryOutboxId(INTENT_A), checkoutRecoveryOutboxId(INTENT_A));
  assert.notEqual(checkoutRecoveryOutboxId(INTENT_A), checkoutRecoveryOutboxId(INTENT_B));
  assert.doesNotMatch(checkoutRecoveryOutboxId(INTENT_A), /attempt_/);
  assert.doesNotMatch(checkoutRecoveryIdempotencyKey(INTENT_A), /attempt_/);
  assert.throws(
    () => checkoutRecoveryOutboxId("attempt_not-canonical"),
    /canonical membership checkout intent ID/
  );
});

test("branded recovery payload has one catalogue CTA and canonical delivery fields", () => {
  const payload = buildCheckoutRecoveryPayload(validInput({
    participantFullNames: ["Olivia Jones", "Noah Jones"],
  }));

  assert.equal(payload.from, "Zero Alpha Fitness <hello@zeroalphafitness.co.uk>");
  assert.deepEqual(payload.to, ["olivia.jones+gym@example.com"]);
  assert.equal(payload.reply_to, "support@zeroalphafitness.co.uk");
  assert.equal(payload.subject, "Your Zero Alpha Fitness signup is ready to restart");
  assert.match(payload.html, />ZERO ALPHA</);
  assert.match(payload.html, /HYROX Youngstars/);
  assert.match(payload.html, /Olivia Jones and Noah Jones/);
  assert.match(payload.html, /didn&#39;t complete/);
  assert.match(payload.html, /No payment was taken and no membership was created/);
  assert.match(payload.html, /Your place is available again/);
  assert.match(payload.html, /Restart my signup/);
  assert.match(payload.html, /If you&#39;ve already restarted, no action is needed/);
  assert.equal((payload.html.match(/\shref=/g) || []).length, 1);
  assert.equal((payload.html.match(/\/memberships/g) || []).length, 1);
  assert.match(
    payload.html,
    /href="https:\/\/alpha-wod\.vercel\.app\/memberships"/
  );
  assert.match(payload.text, /Your HYROX Youngstars sign-up for Olivia Jones and Noah Jones didn't complete/);
  assert.match(payload.text, /No payment was taken and no membership was created/);
  assert.match(payload.text, /Restart my signup: https:\/\/alpha-wod\.vercel\.app\/memberships/);
  assert.match(payload.text, /If you've already restarted, no action is needed/);
  assert.equal(Object.isFrozen(payload), true);
  assert.equal(Object.isFrozen(payload.to), true);
});

test("recovery payload escapes customer and catalogue text before HTML rendering", () => {
  const payload = buildCheckoutRecoveryPayload(validInput({
    planName: "Youngstars <Gold> & \"Fast\"",
    participantFullNames: ["Olivia <script>alert('x')</script> & Jones"],
  }));

  assert.match(payload.html, /Youngstars &lt;Gold&gt; &amp; &quot;Fast&quot;/);
  assert.match(
    payload.html,
    /Olivia &lt;script&gt;alert\(&#39;x&#39;\)&lt;\/script&gt; &amp; Jones/
  );
  assert.doesNotMatch(payload.html, /<script/i);
  assert.doesNotMatch(payload.html, /Youngstars <Gold>/);
});

test("recovery payload rejects unsafe routing and incomplete display data", () => {
  assert.throws(
    () => buildCheckoutRecoveryPayload(validInput({recipientEmail: "not-an-email"})),
    /recipientEmail/
  );
  assert.throws(
    () => buildCheckoutRecoveryPayload(validInput({fromEmail: "hello@example.com\nBcc:x@y.test"})),
    /fromEmail/
  );
  assert.throws(
    () => buildCheckoutRecoveryPayload(validInput({publicOrigin: "javascript:alert(1)"})),
    /publicOrigin/
  );
  assert.throws(
    () => buildCheckoutRecoveryPayload(validInput({publicOrigin: "https://example.com/not-an-origin"})),
    /publicOrigin/
  );
  assert.throws(
    () => buildCheckoutRecoveryPayload(validInput({planName: "\n"})),
    /planName/
  );
  assert.throws(
    () => buildCheckoutRecoveryPayload(validInput({participantFullNames: []})),
    /participantFullNames/
  );
  assert.throws(
    () => buildCheckoutRecoveryPayload(validInput({participantFullNames: Array(11).fill("Athlete")})),
    /participantFullNames/
  );
});
