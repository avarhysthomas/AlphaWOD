/* eslint-disable require-jsdoc, max-len */

const WEBHOOK_EVENT_MANIFEST = require(
  "../../ops/stripe/billing-webhook-events.json"
);

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function assertLiveWebhookEndpoint(endpoint, manifest = WEBHOOK_EVENT_MANIFEST) {
  if (!endpoint || endpoint.id !== manifest.endpointId ||
    endpoint.url !== manifest.endpointUrl || endpoint.livemode !== true ||
    endpoint.status !== "enabled") {
    throw new Error("The LIVE Stripe webhook endpoint identity or status has drifted.");
  }
  const actual = uniqueSorted(endpoint.enabled_events ?? []);
  const expected = uniqueSorted(manifest.requiredEvents ?? []);
  if (actual.includes("*") || JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      "The LIVE Stripe webhook endpoint does not have the exact reviewed event allowlist."
    );
  }
  return endpoint;
}

async function retrieveAndAssertLiveWebhookEndpoint(stripe) {
  const endpoint = await stripe.webhookEndpoints.retrieve(
    WEBHOOK_EVENT_MANIFEST.endpointId
  );
  return assertLiveWebhookEndpoint(endpoint);
}

module.exports = {
  WEBHOOK_EVENT_MANIFEST,
  assertLiveWebhookEndpoint,
  retrieveAndAssertLiveWebhookEndpoint,
};
