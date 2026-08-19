/* eslint-disable no-console, max-len, require-jsdoc */

/**
 * Read-only post-payment verifier. It checks a real Stripe test Session and
 * Subscription, then bounded-polls the isolated Firestore emulator for exact
 * webhook fulfilment, membership and confirmation-outbox correlation.
 */

const admin = require("firebase-admin");
const Stripe = require("stripe");
const {redactProviderSecrets, stripeCliTestKey} = require("./stripeCliTestKey");

const TEST_PROJECT_ID = "demo-alphawod-stripe";
const LOCAL_SUCCESS_URL =
  "http://localhost:3002/memberships/success?session_id={CHECKOUT_SESSION_ID}";
const POLL_TIMEOUT_MILLISECONDS = 30000;
const POLL_INTERVAL_MILLISECONDS = 750;

function argument(name) {
  const prefix = `--${name}=`;
  const match = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : "";
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function assertEnvironment() {
  if (process.env.MEMBERSHIP_FIREBASE_PROJECT_ID !== TEST_PROJECT_ID ||
    process.env.STRIPE_EXPECTED_MODE !== "test" ||
    process.env.MEMBERSHIP_TEST_JOURNEY_ENABLED !== "true") {
    throw new Error("The verifier requires the demo Firebase project and Stripe test journey.");
  }
  const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
  if (firestoreHost !== "127.0.0.1:8080" && firestoreHost !== "localhost:8080") {
    throw new Error("FIRESTORE_EMULATOR_HOST must be the local port 8080 emulator.");
  }
  process.env.FIRESTORE_EMULATOR_HOST = firestoreHost;
}

function assertLocalSession(session) {
  if (session.livemode !== false || session.mode !== "subscription" ||
    session.status !== "complete" || session.payment_status !== "paid") {
    throw new Error("The Stripe test Checkout Session is not a completed paid subscription.");
  }
  if (session.success_url !== LOCAL_SUCCESS_URL || !session.metadata?.intentId) {
    throw new Error("The Checkout Session does not belong to this local test journey.");
  }
}

function subscriptionIdFor(session) {
  const subscriptionId = typeof session.subscription === "string" ?
    session.subscription : session.subscription?.id;
  if (!subscriptionId) throw new Error("The Checkout Session has no subscription.");
  return subscriptionId;
}

async function inspectFulfilment(db, session) {
  const intents = await db.collection("membershipIntents")
    .where("checkoutSessionId", "==", session.id)
    .limit(2)
    .get();
  if (intents.size > 1) {
    throw new Error(`Session ${session.id} maps to more than one checkout intent.`);
  }
  if (intents.empty) return {ready: false, state: "no correlated intent yet"};

  const intent = intents.docs[0];
  if (intent.id !== session.metadata.intentId) {
    throw new Error(`Session ${session.id} is bound to a different checkout intent.`);
  }
  if (intent.get("status") !== "fulfilled") {
    return {ready: false, state: `intent status ${intent.get("status")}`};
  }

  const subscriptionId = subscriptionIdFor(session);
  const [membership, outbox] = await Promise.all([
    db.collection("memberships").doc(subscriptionId).get(),
    db.collection("membershipEmailOutbox").doc(subscriptionId).get(),
  ]);
  if (!membership.exists) return {ready: false, state: "membership not written yet"};
  if (!outbox.exists) return {ready: false, state: "confirmation outbox not written yet"};
  if (membership.get("checkoutSessionId") !== session.id ||
    membership.get("stripePriceId") !== intent.get("stripePriceId") ||
    membership.get("providerContractStatus") !== "verified") {
    throw new Error("The fulfilled membership failed its provider binding.");
  }
  return {ready: true, intent, membership, outbox};
}

async function listLocalSessions(stripe) {
  const page = await stripe.checkout.sessions.list({
    created: {gte: Math.floor(Date.now() / 1000) - 24 * 60 * 60},
    limit: 25,
  });
  return page.data.filter((session) =>
    session.livemode === false &&
    session.mode === "subscription" &&
    session.status === "complete" &&
    session.payment_status === "paid" &&
    session.success_url === LOCAL_SUCCESS_URL &&
    Boolean(session.metadata?.intentId)
  );
}

async function waitForExplicitFulfilment(db, session) {
  const deadline = Date.now() + POLL_TIMEOUT_MILLISECONDS;
  let state = "not checked";
  while (Date.now() < deadline) {
    const result = await inspectFulfilment(db, session);
    if (result.ready) return result;
    state = result.state;
    await delay(POLL_INTERVAL_MILLISECONDS);
  }
  throw new Error(
    `Timed out after ${POLL_TIMEOUT_MILLISECONDS / 1000}s waiting for webhook fulfilment ` +
    `of ${session.id} (${state}).`
  );
}

async function waitForLatestFulfilment(stripe, db) {
  const deadline = Date.now() + POLL_TIMEOUT_MILLISECONDS;
  let state = "no matching local Checkout Session found";
  while (Date.now() < deadline) {
    const sessions = await listLocalSessions(stripe);
    let correlated = false;
    for (const session of sessions) {
      const result = await inspectFulfilment(db, session);
      if (result.state !== "no correlated intent yet") {
        correlated = true;
        state = `${session.id}: ${result.state || "correlated"}`;
        if (result.ready) return {session, fulfilment: result};
        // Stripe returns newest first. Once a Session correlates to this
        // emulator, wait for that newest exact match rather than selecting an
        // older completed run while its webhook is still converging.
        break;
      }
    }
    if (!correlated && sessions.length) {
      state = `${sessions.length} local Session(s), none correlated to this emulator`;
    }
    await delay(POLL_INTERVAL_MILLISECONDS);
  }
  throw new Error(
    `Timed out after ${POLL_TIMEOUT_MILLISECONDS / 1000}s finding the newest unambiguous ` +
    `fulfilled local Session (${state}).`
  );
}

async function main() {
  assertEnvironment();
  const stripe = new Stripe(stripeCliTestKey(), {maxNetworkRetries: 2, timeout: 20000});
  const requestedSession = argument("session");
  if (requestedSession && requestedSession !== "latest" &&
    !requestedSession.startsWith("cs_test_")) {
    throw new Error("Pass --session=cs_test_..., --session=latest, or omit it.");
  }

  admin.initializeApp({projectId: TEST_PROJECT_ID});
  const db = admin.firestore();
  let session;
  let fulfilment;
  if (requestedSession && requestedSession !== "latest") {
    session = await stripe.checkout.sessions.retrieve(requestedSession);
    assertLocalSession(session);
    fulfilment = await waitForExplicitFulfilment(db, session);
  } else {
    const latest = await waitForLatestFulfilment(stripe, db);
    session = latest.session;
    fulfilment = latest.fulfilment;
  }

  assertLocalSession(session);
  const subscription = await stripe.subscriptions.retrieve(subscriptionIdFor(session));
  if (subscription.livemode !== false) {
    throw new Error("The subscription is not a Stripe test-mode object.");
  }

  console.log("Real Stripe test journey verified:");
  console.log(`- Checkout Session: ${session.id} (${session.payment_status})`);
  console.log(`- Subscription: ${subscription.id} (${subscription.status})`);
  console.log(`- Membership: ${fulfilment.membership.id} (${fulfilment.membership.get("state")})`);
  console.log(`- Confirmation outbox: ${fulfilment.outbox.get("status")}`);
}

main()
  .catch((error) => {
    console.error(
      `Stripe test journey verification failed: ${redactProviderSecrets(error.message)}`
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all(admin.apps.map((app) => app.delete()));
  });
