/* eslint-disable no-console, max-len, require-jsdoc */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const admin = require("firebase-admin");
const Stripe = require("stripe");

const {
  APPROVED_TEST_PAYG_CATALOGUE,
} = require("../lib/stripeLiveCatalog");
const {
  PAYG_CLASS_ID,
  loadApprovedPaygRelease,
} = require("./localStripePaygJourney");
const {redactProviderSecrets, stripeCliTestKey} = require("./stripeCliTestKey");

const PROJECT_ID = "demo-alphawod-stripe";
const APP_ORIGIN = "http://localhost:3002";
const PAYG_SCHEMA_VERSION = 1;
const REPOSITORY_ROOT = path.resolve(__dirname, "../..");

function sessionIdArgument(argv) {
  const raw = argv.find((value) => value.startsWith("--session="))?.slice(10) || "";
  if (!/^cs_test_[A-Za-z0-9_]+$/.test(raw)) {
    throw new Error("Pass the exact Stripe test Checkout id as --session=cs_test_...");
  }
  return raw;
}

function assertLocalEmulatorBoundary() {
  const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
  if (firestoreHost !== "127.0.0.1:8080" || authHost !== "127.0.0.1:9099") {
    throw new Error("PAYG verification requires the fixed loopback emulators.");
  }
  Object.assign(process.env, {
    FIRESTORE_EMULATOR_HOST: firestoreHost,
    FIREBASE_AUTH_EMULATOR_HOST: authHost,
    GCLOUD_PROJECT: PROJECT_ID,
    GOOGLE_CLOUD_PROJECT: PROJECT_ID,
  });
}

function idOf(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof value.id === "string") {
    return value.id;
  }
  return null;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function timestampMillis(value, label) {
  assert.equal(
    typeof value?.toMillis,
    "function",
    label + " must be a Firestore Timestamp"
  );
  const millis = value.toMillis();
  assert.equal(
    Number.isSafeInteger(millis) && millis > 0,
    true,
    label + " must contain a valid instant"
  );
  return millis;
}

function documentRecord(snapshot, label) {
  assert.equal(snapshot.exists, true, label + " must exist");
  return Object.freeze({id: snapshot.id, data: snapshot.data()});
}

function releaseLegalDocuments(release, absolute = false) {
  const document = (key) => {
    const source = release.documents[key];
    return {
      version: source.version,
      publicUrl: absolute ?
        new URL(source.publicUrl, APP_ORIGIN).href : source.publicUrl,
      sha256: source.sha256,
    };
  };
  return Object.freeze({
    waiver: document("paygWaiver"),
    terms: document("paygTerms"),
    privacyNotice: document("paygPrivacyNotice"),
  });
}

function assertRetainedAcceptance(
  retained,
  acceptedAtMillis,
  release,
  label
) {
  assert.equal(retained?.adultConfirmed, true, label + " adult confirmation");
  assert.equal(retained?.waiverAccepted, true, label + " waiver acceptance");
  assert.equal(retained?.termsAccepted, true, label + " terms acceptance");
  assert.equal(
    retained?.cancellationPolicyAccepted,
    true,
    label + " cancellation-policy acceptance"
  );
  assert.deepEqual(
    retained?.waiver,
    releaseLegalDocuments(release).waiver,
    label + " waiver receipt"
  );
  assert.deepEqual(
    retained?.terms,
    releaseLegalDocuments(release).terms,
    label + " terms receipt"
  );
  assert.equal(
    retained?.privacyNoticePresented,
    true,
    label + " privacy-notice presentation"
  );
  assert.deepEqual(
    retained?.privacyNotice,
    releaseLegalDocuments(release).privacyNotice,
    label + " privacy-notice receipt"
  );
  assert.equal(
    timestampMillis(retained?.acceptedAt, label + ".acceptedAt"),
    acceptedAtMillis,
    label + " acceptance timestamp"
  );
  assert.equal(
    retained?.retentionPolicyVersion,
    release.retention.policyVersion,
    label + " retention policy"
  );
}

function verifyPaygJourneyEvidence(input) {
  const {
    session,
    lineItems,
    order,
    booking,
    waiver,
    outbox,
    seededClass,
    authUserCount,
    release,
    nowMillis = Date.now(),
  } = input;
  const paymentIntent = session.payment_intent;
  assert.equal(session.livemode, false, "Checkout must be in Stripe test mode");
  assert.equal(session.mode, "payment");
  assert.equal(session.status, "complete");
  assert.equal(session.payment_status, "paid");
  assert.equal(session.amount_total, 700);
  assert.equal(session.currency, "gbp");
  assert.equal(session.customer, null);
  assert.equal(session.metadata?.purchaseKind, "payg_class");
  assert.equal(session.metadata?.offeringKey, "adult_payg_class");
  assert.equal(session.metadata?.classId, PAYG_CLASS_ID);
  const intentId = session.metadata?.paygIntentId || "";
  assert.match(intentId, /^payg_[a-f0-9]{64}$/);
  assert.equal(session.client_reference_id, intentId);
  assert.equal(
    session.metadata?.schemaVersion,
    String(PAYG_SCHEMA_VERSION),
    "Checkout must use the exact PAYG schema"
  );

  assert.equal(
    paymentIntent && typeof paymentIntent === "object",
    true,
    "Checkout payment_intent must be expanded"
  );
  assert.match(paymentIntent.id, /^pi_[A-Za-z0-9_]+$/);
  assert.equal(paymentIntent.livemode, false);
  assert.equal(paymentIntent.status, "succeeded");
  assert.equal(paymentIntent.amount, 700);
  assert.equal(paymentIntent.amount_received, 700);
  assert.equal(paymentIntent.currency, "gbp");
  for (const field of [
    "purchaseKind",
    "offeringKey",
    "paygIntentId",
    "classId",
    "schemaVersion",
  ]) {
    assert.equal(
      paymentIntent.metadata?.[field],
      session.metadata?.[field],
      "PaymentIntent metadata must bind " + field + " to Checkout"
    );
  }

  assert.equal(lineItems.has_more, false);
  assert.equal(lineItems.data.length, 1);
  const lineItem = lineItems.data[0];
  assert.equal(lineItem.price?.id, APPROVED_TEST_PAYG_CATALOGUE.priceId);
  assert.equal(lineItem.price?.livemode, false);
  assert.equal(lineItem.price?.active, true);
  assert.equal(lineItem.price?.currency, "gbp");
  assert.equal(lineItem.price?.unit_amount, 700);
  assert.equal(lineItem.price?.type, "one_time");
  assert.equal(lineItem.price?.billing_scheme, "per_unit");
  assert.equal(lineItem.price?.recurring, null);
  const product = lineItem.price?.product;
  assert.equal(
    product && typeof product === "object",
    true,
    "Line-item Product must be expanded"
  );
  assert.equal(
    idOf(product),
    APPROVED_TEST_PAYG_CATALOGUE.productId
  );
  assert.equal(product.livemode, false);
  assert.equal(product.active, true);
  assert.equal(product.name, APPROVED_TEST_PAYG_CATALOGUE.productName);
  assert.equal(lineItem.quantity, 1);
  assert.equal(lineItem.amount_total, 700);
  assert.equal(lineItem.currency, "gbp");

  assert.equal(order.id, intentId, "Order id must bind to the PAYG intent");
  assert.equal(order.data.schemaVersion, PAYG_SCHEMA_VERSION);
  assert.equal(order.data.orderId, intentId);
  assert.equal(order.data.status, "confirmed");
  assert.equal(order.data.capacityState, "held");
  assert.equal(order.data.stripeMode, "test");
  assert.equal(order.data.checkoutSessionId, session.id);
  assert.equal(order.data.paymentIntentId, paymentIntent.id);
  assert.equal(
    order.data.stripePriceId,
    APPROVED_TEST_PAYG_CATALOGUE.priceId
  );
  assert.equal(
    order.data.stripeProductId,
    APPROVED_TEST_PAYG_CATALOGUE.productId
  );
  assert.equal(order.data.amountPence, 700);
  assert.equal(order.data.currency, "gbp");
  assert.equal(order.data.purchaseKind, "payg_class");
  assert.equal(order.data.offeringKey, "adult_payg_class");
  assert.equal(order.data.confirmationEmailStatus, "pending");
  const attendee = order.data.attendee;
  const contact = order.data.contact;
  assert.equal(
    typeof attendee?.fullName === "string" && attendee.fullName.length > 0,
    true,
    "Order attendee name is required"
  );
  assert.match(attendee?.dateOfBirth || "", /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(
    Number.isSafeInteger(attendee?.ageAtClass) && attendee.ageAtClass >= 18,
    true,
    "Order attendee must be an adult at the class"
  );
  assert.equal(
    typeof contact?.email === "string" && contact.email.includes("@"),
    true,
    "Order contact email is required"
  );
  const sessionEmail = session.customer_details?.email?.trim().toLowerCase() ||
    session.customer_email?.trim().toLowerCase() || null;
  assert.equal(
    sessionEmail,
    contact.email.trim().toLowerCase(),
    "Checkout purchaser email must bind to the order contact"
  );
  assert.match(
    order.data.acceptanceEvidenceDigest || "",
    /^[a-f0-9]{64}$/,
    "Order acceptance evidence digest"
  );

  assert.equal(seededClass.id, PAYG_CLASS_ID);
  assert.equal(seededClass.data.title, "PAYG Browser Test · Stripe Sandbox");
  assert.equal(seededClass.data.timezone, "Europe/London");
  assert.equal(
    seededClass.data.location,
    "Zero Alpha Fitness · Local emulator"
  );
  assert.equal(seededClass.data.coachName, "Local test coach");
  assert.equal(seededClass.data.status, "scheduled");
  assert.equal(seededClass.data.paygEligible, true);
  assert.equal(seededClass.data.capacity, 12);
  assert.equal(seededClass.data.bookedCount, 1);
  assert.equal(seededClass.data.paygUnpaidHoldCount, 0);
  const classStartMillis = timestampMillis(
    seededClass.data.startTime,
    "seeded class startTime"
  );
  const classEndMillis = timestampMillis(
    seededClass.data.endTime,
    "seeded class endTime"
  );
  assert.equal(classEndMillis - classStartMillis, 60 * 60 * 1000);
  assert.equal(classStartMillis > nowMillis, true, "Seeded class must be future-dated");
  const expectedClassSnapshot = {
    classId: PAYG_CLASS_ID,
    title: seededClass.data.title,
    startTime: new Date(classStartMillis).toISOString(),
    endTime: new Date(classEndMillis).toISOString(),
    timezone: seededClass.data.timezone,
    location: seededClass.data.location,
  };
  assert.deepEqual(
    order.data.class,
    expectedClassSnapshot,
    "Order class snapshot must bind to the seeded class"
  );
  assert.equal(order.data.classStartMillis, classStartMillis);
  assert.equal(order.data.classEndMillis, classEndMillis);

  const expectedLegal = releaseLegalDocuments(release);
  const acceptances = order.data.acceptances;
  assert.equal(acceptances?.adultConfirmed, true);
  assert.equal(acceptances?.waiverAccepted, true);
  assert.equal(acceptances?.termsAccepted, true);
  assert.equal(acceptances?.cancellationPolicyAccepted, true);
  assert.equal(acceptances?.waiverVersion, expectedLegal.waiver.version);
  assert.equal(acceptances?.termsVersion, expectedLegal.terms.version);
  assert.equal(
    acceptances?.privacyNoticeVersionPresented,
    expectedLegal.privacyNotice.version
  );
  assert.deepEqual(acceptances?.legal, expectedLegal);
  const acceptedAtMillis = timestampMillis(
    acceptances?.acceptedAt,
    "order acceptances.acceptedAt"
  );
  assert.equal(
    acceptedAtMillis <= nowMillis,
    true,
    "The legal acceptance timestamp cannot be in the future"
  );
  assertRetainedAcceptance(
    order.data.retainedAcceptanceEvidence,
    acceptedAtMillis,
    release,
    "order retained acceptance"
  );

  const canonicalBookingId = "payg_guest_" + intentId.slice("payg_".length);
  const canonicalGuestUserId = "payg_guest_" + sha256(intentId).slice(0, 40);
  assert.equal(order.data.bookingId, canonicalBookingId);
  assert.equal(booking.id, canonicalBookingId);
  assert.equal(booking.data.paygOrderId, order.id);
  assert.equal(booking.data.classId, PAYG_CLASS_ID);
  assert.equal(booking.data.userId, canonicalGuestUserId);
  assert.equal(booking.data.userName, attendee.fullName);
  assert.equal(booking.data.bookingKind, "payg_guest");
  assert.equal(booking.data.isGuestBooking, true);
  assert.equal(booking.data.status, "booked");
  assertRetainedAcceptance(
    booking.data.retainedAcceptanceEvidence,
    acceptedAtMillis,
    release,
    "booking retained acceptance"
  );

  assert.equal(waiver.id, intentId);
  assert.equal(waiver.data.schemaVersion, PAYG_SCHEMA_VERSION);
  assert.equal(waiver.data.orderId, intentId);
  assert.equal(waiver.data.checkoutSessionId, session.id);
  assert.equal(waiver.data.paymentIntentId, paymentIntent.id);
  assert.deepEqual(waiver.data.attendee, attendee);
  assert.deepEqual(waiver.data.class, expectedClassSnapshot);
  assert.deepEqual(
    waiver.data.acceptances,
    acceptances,
    "Waiver acceptance record must exactly match the order"
  );
  assert.equal(
    waiver.data.acceptanceEvidenceDigest,
    order.data.acceptanceEvidenceDigest,
    "Waiver digest must bind to the order acceptance evidence"
  );
  assert.equal(waiver.data.acceptances?.adultConfirmed, true);
  assert.equal(waiver.data.acceptances?.waiverAccepted, true);
  assert.equal(waiver.data.acceptances?.termsAccepted, true);
  assert.equal(waiver.data.acceptances?.cancellationPolicyAccepted, true);
  assert.deepEqual(waiver.data.acceptances?.legal, expectedLegal);
  assert.equal(
    timestampMillis(
      waiver.data.acceptances?.acceptedAt,
      "waiver acceptances.acceptedAt"
    ),
    acceptedAtMillis
  );
  assertRetainedAcceptance(
    waiver.data.retainedAcceptanceEvidence,
    acceptedAtMillis,
    release,
    "waiver retained acceptance"
  );

  assert.equal(outbox.id, intentId);
  assert.equal(outbox.data.schemaVersion, PAYG_SCHEMA_VERSION);
  assert.equal(outbox.data.kind, "payg_guest_confirmation");
  assert.equal(outbox.data.orderId, intentId);
  assert.equal(
    outbox.data.idempotencyKey,
    "payg-confirmation/" + intentId + "/v1"
  );
  assert.equal(outbox.data.status, "pending");
  assert.equal(outbox.data.attemptCount, 0);
  assert.deepEqual(outbox.data.to, [contact.email]);
  assert.equal(outbox.data.templateData?.attendeeName, attendee.fullName);
  assert.equal(outbox.data.templateData?.amountPence, 700);
  assert.equal(outbox.data.templateData?.currency, "gbp");
  assert.deepEqual(
    outbox.data.templateData?.class,
    expectedClassSnapshot,
    "Outbox class receipt must bind to the seeded class"
  );
  assert.deepEqual(
    outbox.data.templateData?.legalAcceptance,
    {
      acceptedAt: new Date(acceptedAtMillis).toISOString(),
      ...releaseLegalDocuments(release, true),
    },
    "Outbox must retain the exact legal receipt"
  );
  assert.equal(authUserCount, 0, "The anonymous PAYG journey must create no account");

  return Object.freeze({
    intentId,
    paymentIntentId: paymentIntent.id,
    bookingId: booking.id,
    classId: PAYG_CLASS_ID,
    acceptedAt: new Date(acceptedAtMillis).toISOString(),
  });
}

async function waitForOrder(db, intentId) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const order = await db.collection("paygOrders").doc(intentId).get();
    if (order.exists && order.get("status") === "confirmed") return order;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("The local PAYG order did not converge after its Stripe webhook.");
}

async function closeFirebaseAdminApps(apps = admin.apps) {
  await Promise.all(apps.map((app) => app.delete()));
}

async function main() {
  assertLocalEmulatorBoundary();
  const sessionId = sessionIdArgument(process.argv.slice(2));
  const release = loadApprovedPaygRelease(REPOSITORY_ROOT);
  const stripe = new Stripe(stripeCliTestKey(), {
    maxNetworkRetries: 2,
    timeout: 20_000,
  });
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["payment_intent"],
  });
  const lineItems = await stripe.checkout.sessions.listLineItems(sessionId, {
    limit: 10,
    expand: ["data.price.product"],
  });
  const intentId = session.metadata?.paygIntentId || "";
  assert.match(intentId, /^payg_[a-f0-9]{64}$/);

  const app = admin.apps.length ?
    admin.app() : admin.initializeApp({projectId: PROJECT_ID});
  const db = app.firestore();
  const orderSnapshot = await waitForOrder(db, intentId);
  const bookingId = orderSnapshot.get("bookingId");
  assert.equal(typeof bookingId, "string");
  const [bookingSnapshot, waiverSnapshot, outboxSnapshot, classSnapshot, users] =
    await Promise.all([
      db.collection("bookings").doc(bookingId).get(),
      db.collection("paygWaiverAcceptances").doc(intentId).get(),
      db.collection("paygEmailOutbox").doc(intentId).get(),
      db.collection("classes").doc(PAYG_CLASS_ID).get(),
      app.auth().listUsers(2),
    ]);
  const evidence = verifyPaygJourneyEvidence({
    session,
    lineItems,
    order: documentRecord(orderSnapshot, "PAYG order"),
    booking: documentRecord(bookingSnapshot, "PAYG booking"),
    waiver: documentRecord(waiverSnapshot, "PAYG waiver acceptance"),
    outbox: documentRecord(outboxSnapshot, "PAYG confirmation outbox"),
    seededClass: documentRecord(classSnapshot, "seeded PAYG class"),
    authUserCount: users.users.length,
    release,
  });

  console.log("PAYG_STRIPE_TEST_BROWSER_EVIDENCE", JSON.stringify({
    checkoutSessionId: sessionId,
    paymentIntentId: evidence.paymentIntentId,
    classId: evidence.classId,
    stripeMode: "test",
    amountPence: 700,
    currency: "gbp",
    exactProductId: APPROVED_TEST_PAYG_CATALOGUE.productId,
    exactPriceId: APPROVED_TEST_PAYG_CATALOGUE.priceId,
    acceptedAt: evidence.acceptedAt,
    accountCreated: false,
    localOrderStatus: orderSnapshot.get("status"),
    localBookingKind: bookingSnapshot.get("bookingKind"),
    localOutboxStatus: outboxSnapshot.get("status"),
    emailTransport: "disabled",
    productionWrites: false,
  }));
}

module.exports = {
  closeFirebaseAdminApps,
  releaseLegalDocuments,
  sessionIdArgument,
  verifyPaygJourneyEvidence,
};

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(
        "PAYG test verification failed: " +
        redactProviderSecrets(error instanceof Error ? error.message : String(error))
      );
      process.exitCode = 1;
    })
    .finally(closeFirebaseAdminApps);
}
