/* eslint-disable @typescript-eslint/no-var-requires, require-jsdoc, max-len */

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  WEBHOOK_EVENT_MANIFEST,
  assertLiveWebhookEndpoint,
} = require("../scripts/stripeWebhookConfig");

function validEndpoint() {
  return {
    id: WEBHOOK_EVENT_MANIFEST.endpointId,
    url: WEBHOOK_EVENT_MANIFEST.endpointUrl,
    livemode: true,
    status: "enabled",
    enabled_events: [...WEBHOOK_EVENT_MANIFEST.requiredEvents],
  };
}

test("accepts the exact enabled LIVE webhook event allowlist", () => {
  assert.doesNotThrow(() => assertLiveWebhookEndpoint(validEndpoint()));
});

test("rejects missing PAYG refund/dispute events and wildcard subscriptions", () => {
  for (const enabledEvents of [
    WEBHOOK_EVENT_MANIFEST.requiredEvents.filter(
      (event) => event !== "refund.failed"
    ),
    [...WEBHOOK_EVENT_MANIFEST.requiredEvents, "payment_intent.succeeded"],
    ["*"],
  ]) {
    assert.throws(() => assertLiveWebhookEndpoint({
      ...validEndpoint(),
      enabled_events: enabledEvents,
    }), /exact reviewed event allowlist/i);
  }
});

test("rejects disabled, test-mode or wrong-URL endpoints", () => {
  for (const mutation of [
    {status: "disabled"},
    {livemode: false},
    {url: "https://example.invalid/stripeWebhook"},
    {id: "we_unreviewed"},
  ]) {
    assert.throws(() => assertLiveWebhookEndpoint({
      ...validEndpoint(),
      ...mutation,
    }), /identity or status has drifted/i);
  }
});
