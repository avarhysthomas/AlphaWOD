/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const manifestPath = path.join(
  root,
  "ops/stripe/billing-webhook-events.json"
);

const PAYG_REQUIRED_EVENTS = Object.freeze([
  "charge.dispute.closed",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.refunded",
  "checkout.session.async_payment_failed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.completed",
  "checkout.session.expired",
  "refund.created",
  "refund.failed",
  "refund.updated",
]);

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function assertSameValues(actual, expected, label) {
  if (JSON.stringify(uniqueSorted(actual)) !== JSON.stringify(uniqueSorted(expected))) {
    throw new Error(`${label} is stale.`);
  }
}

function handledStripeEvents(source) {
  return uniqueSorted(
    [...source.matchAll(/case\s+"([a-z0-9_.]+)"\s*:/g)]
      .map((match) => match[1])
      .filter((event) => event.includes("."))
  );
}

function verifyBillingWebhookEvents() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1 ||
    manifest.deploymentMode !== "template-only" ||
    manifest.enabledEventsMode !== "exact") {
    throw new Error("Stripe webhook manifest must remain an exact versioned template.");
  }
  if (manifest.productionProjectId !== "alphawod-d1f2f" ||
    !/^we_[A-Za-z0-9]+$/.test(manifest.endpointId) ||
    manifest.endpointUrl !==
      "https://europe-west1-alphawod-d1f2f.cloudfunctions.net/stripeWebhook") {
    throw new Error("Stripe webhook endpoint identity is not the reviewed production endpoint.");
  }

  const required = manifest.requiredEvents ?? [];
  if (required.length !== new Set(required).size ||
    JSON.stringify(required) !== JSON.stringify([...required].sort())) {
    throw new Error("Stripe webhook events must be unique and sorted.");
  }

  const membershipSource = fs.readFileSync(
    path.join(root, "functions/src/membership.ts"),
    "utf8"
  );
  const paygSource = fs.readFileSync(
    path.join(root, "functions/src/payg.ts"),
    "utf8"
  );
  const membershipEvents = handledStripeEvents(membershipSource);
  const paygEvents = handledStripeEvents(paygSource);
  const handled = uniqueSorted([...membershipEvents, ...paygEvents]);
  const missingHandlers = required.filter((event) => !handled.includes(event));
  if (missingHandlers.length) {
    throw new Error(
      `Required Stripe events have no handler: ${missingHandlers.join(", ")}`
    );
  }
  assertSameValues(
    paygEvents.filter((event) => PAYG_REQUIRED_EVENTS.includes(event)),
    PAYG_REQUIRED_EVENTS,
    "PAYG refund/dispute/Checkout event coverage"
  );
  for (const event of [
    "refund.created",
    "refund.updated",
    "refund.failed",
    "charge.dispute.created",
    "charge.dispute.updated",
    "charge.dispute.closed",
  ]) {
    if (!required.includes(event)) {
      throw new Error(`Stripe webhook manifest must subscribe to ${event}.`);
    }
  }

  const localJourney = fs.readFileSync(
    path.join(root, "functions/scripts/runLocalStripeTestJourney.js"),
    "utf8"
  );
  if (!localJourney.includes("billing-webhook-events.json")) {
    throw new Error("The local Stripe listener must consume the webhook manifest.");
  }
  const rollout = fs.readFileSync(
    path.join(root, "docs/billing/conditioning-payg-rollout.md"),
    "utf8"
  );
  if (!rollout.includes("ops/stripe/billing-webhook-events.json")) {
    throw new Error("The Conditioning/PAYG runbook must cite the webhook manifest.");
  }

  console.log(
    `Stripe webhook template verified: ${required.length} exact events; ` +
    `${PAYG_REQUIRED_EVENTS.length} PAYG Checkout/refund/dispute events have handlers.`
  );
}

if (require.main === module) {
  try {
    verifyBillingWebhookEvents();
  } catch (error) {
    console.error(`Stripe webhook verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  PAYG_REQUIRED_EVENTS,
  handledStripeEvents,
  verifyBillingWebhookEvents,
};
