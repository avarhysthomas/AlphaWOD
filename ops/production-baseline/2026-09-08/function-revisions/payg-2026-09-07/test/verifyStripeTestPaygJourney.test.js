/* eslint-disable @typescript-eslint/no-var-requires, max-len, require-jsdoc */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const test = require("node:test");

const {
  PAYG_CLASS_ID,
  loadApprovedPaygRelease,
} = require("../scripts/localStripePaygJourney");
const {
  closeFirebaseAdminApps,
  releaseLegalDocuments,
  sessionIdArgument,
  verifyPaygJourneyEvidence,
} = require("../scripts/verifyStripeTestPaygJourney");
const {
  APPROVED_TEST_PAYG_CATALOGUE,
} = require("../lib/stripeLiveCatalog");

const REPOSITORY_ROOT = path.resolve(__dirname, "../..");
const RELEASE = loadApprovedPaygRelease(REPOSITORY_ROOT);
const NOW = Date.parse("2026-09-01T12:00:00.000Z");
const CLASS_START = NOW + 48 * 60 * 60 * 1000;
const CLASS_END = CLASS_START + 60 * 60 * 1000;
const ACCEPTED_AT = NOW - 10_000;
const INTENT_ID = "payg_" + "a".repeat(64);
const PAYMENT_INTENT_ID = "pi_test_browser_binding";

function timestamp(millis) {
  return {toMillis: () => millis};
}

function retainedAcceptance() {
  const legal = releaseLegalDocuments(RELEASE);
  return {
    adultConfirmed: true,
    waiverAccepted: true,
    termsAccepted: true,
    cancellationPolicyAccepted: true,
    waiver: {...legal.waiver},
    terms: {...legal.terms},
    privacyNoticePresented: true,
    privacyNotice: {...legal.privacyNotice},
    acceptedAt: timestamp(ACCEPTED_AT),
    retentionPolicyVersion: RELEASE.retention.policyVersion,
  };
}

function orderAcceptances() {
  const legal = releaseLegalDocuments(RELEASE);
  return {
    adultConfirmed: true,
    waiverAccepted: true,
    termsAccepted: true,
    cancellationPolicyAccepted: true,
    waiverVersion: legal.waiver.version,
    termsVersion: legal.terms.version,
    privacyNoticeVersionPresented: legal.privacyNotice.version,
    legal: {
      waiver: {...legal.waiver},
      terms: {...legal.terms},
      privacyNotice: {...legal.privacyNotice},
    },
    acceptedAt: timestamp(ACCEPTED_AT),
  };
}

function fixture() {
  const metadata = {
    purchaseKind: "payg_class",
    offeringKey: "adult_payg_class",
    paygIntentId: INTENT_ID,
    classId: PAYG_CLASS_ID,
    schemaVersion: "1",
  };
  const classSnapshot = {
    classId: PAYG_CLASS_ID,
    title: "PAYG Browser Test · Stripe Sandbox",
    startTime: new Date(CLASS_START).toISOString(),
    endTime: new Date(CLASS_END).toISOString(),
    timezone: "Europe/London",
    location: "Zero Alpha Fitness · Local emulator",
  };
  const bookingId = "payg_guest_" + "a".repeat(64);
  const guestUserId = "payg_guest_" + crypto.createHash("sha256")
    .update(INTENT_ID)
    .digest("hex")
    .slice(0, 40);
  const attendee = {
    fullName: "Ava Browser Test",
    dateOfBirth: "1990-01-01",
    ageAtClass: 36,
  };
  const contact = {
    email: "ava.browser@example.test",
    phone: "+447700900123",
  };
  const canonicalAcceptances = orderAcceptances();
  const waiverAcceptances = {
    ...canonicalAcceptances,
    legal: {
      waiver: {...canonicalAcceptances.legal.waiver},
      terms: {...canonicalAcceptances.legal.terms},
      privacyNotice: {...canonicalAcceptances.legal.privacyNotice},
    },
  };
  const acceptanceEvidenceDigest = "d".repeat(64);
  return {
    session: {
      id: "cs_test_payg_browser_binding",
      livemode: false,
      mode: "payment",
      status: "complete",
      payment_status: "paid",
      amount_total: 700,
      currency: "gbp",
      customer: null,
      customer_email: contact.email,
      customer_details: {email: contact.email},
      client_reference_id: INTENT_ID,
      metadata: {...metadata},
      payment_intent: {
        id: PAYMENT_INTENT_ID,
        livemode: false,
        status: "succeeded",
        amount: 700,
        amount_received: 700,
        currency: "gbp",
        metadata: {...metadata},
      },
    },
    lineItems: {
      has_more: false,
      data: [{
        price: {
          id: APPROVED_TEST_PAYG_CATALOGUE.priceId,
          livemode: false,
          active: true,
          currency: "gbp",
          unit_amount: 700,
          type: "one_time",
          billing_scheme: "per_unit",
          recurring: null,
          product: {
            id: APPROVED_TEST_PAYG_CATALOGUE.productId,
            livemode: false,
            active: true,
            name: APPROVED_TEST_PAYG_CATALOGUE.productName,
          },
        },
        quantity: 1,
        amount_total: 700,
        currency: "gbp",
      }],
    },
    order: {
      id: INTENT_ID,
      data: {
        schemaVersion: 1,
        orderId: INTENT_ID,
        status: "confirmed",
        capacityState: "held",
        stripeMode: "test",
        checkoutSessionId: "cs_test_payg_browser_binding",
        paymentIntentId: PAYMENT_INTENT_ID,
        stripePriceId: APPROVED_TEST_PAYG_CATALOGUE.priceId,
        stripeProductId: APPROVED_TEST_PAYG_CATALOGUE.productId,
        amountPence: 700,
        currency: "gbp",
        purchaseKind: "payg_class",
        offeringKey: "adult_payg_class",
        confirmationEmailStatus: "pending",
        attendee: {...attendee},
        contact: {...contact},
        class: {...classSnapshot},
        classStartMillis: CLASS_START,
        classEndMillis: CLASS_END,
        acceptances: canonicalAcceptances,
        acceptanceEvidenceDigest,
        retainedAcceptanceEvidence: retainedAcceptance(),
        bookingId,
      },
    },
    booking: {
      id: bookingId,
      data: {
        paygOrderId: INTENT_ID,
        classId: PAYG_CLASS_ID,
        userId: guestUserId,
        userName: attendee.fullName,
        bookingKind: "payg_guest",
        isGuestBooking: true,
        status: "booked",
        retainedAcceptanceEvidence: retainedAcceptance(),
      },
    },
    waiver: {
      id: INTENT_ID,
      data: {
        schemaVersion: 1,
        orderId: INTENT_ID,
        attendee: {...attendee},
        acceptances: waiverAcceptances,
        acceptanceEvidenceDigest,
        retainedAcceptanceEvidence: retainedAcceptance(),
        class: {...classSnapshot},
        checkoutSessionId: "cs_test_payg_browser_binding",
        paymentIntentId: PAYMENT_INTENT_ID,
      },
    },
    outbox: {
      id: INTENT_ID,
      data: {
        schemaVersion: 1,
        kind: "payg_guest_confirmation",
        orderId: INTENT_ID,
        idempotencyKey: "payg-confirmation/" + INTENT_ID + "/v1",
        status: "pending",
        attemptCount: 0,
        to: [contact.email],
        templateData: {
          attendeeName: attendee.fullName,
          amountPence: 700,
          currency: "gbp",
          class: {...classSnapshot},
          legalAcceptance: {
            acceptedAt: new Date(ACCEPTED_AT).toISOString(),
            ...releaseLegalDocuments(RELEASE, true),
          },
        },
      },
    },
    seededClass: {
      id: PAYG_CLASS_ID,
      data: {
        title: "PAYG Browser Test · Stripe Sandbox",
        startTime: timestamp(CLASS_START),
        endTime: timestamp(CLASS_END),
        timezone: "Europe/London",
        location: "Zero Alpha Fitness · Local emulator",
        coachName: "Local test coach",
        status: "scheduled",
        paygEligible: true,
        capacity: 12,
        bookedCount: 1,
        paygUnpaidHoldCount: 0,
      },
    },
    authUserCount: 0,
    release: RELEASE,
    nowMillis: NOW,
  };
}

test("PAYG verifier accepts only the fully bound provider and Firestore graph", () => {
  const evidence = verifyPaygJourneyEvidence(fixture());
  assert.deepEqual(evidence, {
    intentId: INTENT_ID,
    paymentIntentId: PAYMENT_INTENT_ID,
    bookingId: "payg_guest_" + "a".repeat(64),
    classId: PAYG_CLASS_ID,
    acceptedAt: new Date(ACCEPTED_AT).toISOString(),
  });
});

test("PAYG verifier rejects every reviewed graph-binding drift", async (t) => {
  const cases = [
    ["seeded class id", (value) => {
      value.seededClass.id = "other_class";
    }],
    ["seeded class schema", (value) => {
      value.seededClass.data.capacity = 13;
    }],
    ["Checkout class metadata", (value) => {
      value.session.metadata.classId = "other_class";
    }],
    ["Checkout to PaymentIntent", (value) => {
      value.order.data.paymentIntentId = "pi_other";
    }],
    ["provider PAYG schema", (value) => {
      value.session.metadata.schemaVersion = "6";
      value.session.payment_intent.metadata.schemaVersion = "6";
    }],
    ["exact PAYG schema", (value) => {
      value.order.data.schemaVersion = 6;
    }],
    ["outbox PAYG schema", (value) => {
      value.outbox.data.schemaVersion = 6;
    }],
    ["waiver PAYG schema", (value) => {
      value.waiver.data.schemaVersion = 6;
    }],
    ["line-item Product", (value) => {
      value.lineItems.data[0].price.product.id = "prod_other";
    }],
    ["line-item Product shape", (value) => {
      value.lineItems.data[0].price.product.name = "Foreign Product";
    }],
    ["order Price", (value) => {
      value.order.data.stripePriceId = "price_other";
    }],
    ["order class snapshot", (value) => {
      value.order.data.class.classId = "other_class";
    }],
    ["legal SHA", (value) => {
      value.order.data.acceptances.legal.terms.sha256 = "0".repeat(64);
    }],
    ["acceptance flag", (value) => {
      value.order.data.acceptances.waiverAccepted = false;
    }],
    ["acceptance timestamp", (value) => {
      value.booking.data.retainedAcceptanceEvidence.acceptedAt =
        timestamp(ACCEPTED_AT + 1);
    }],
    ["booking to order", (value) => {
      value.booking.data.paygOrderId = "payg_" + "b".repeat(64);
    }],
    ["booking to class", (value) => {
      value.booking.data.classId = "other_class";
    }],
    ["canonical booking id", (value) => {
      value.booking.id = "payg_guest_" + "b".repeat(64);
      value.order.data.bookingId = value.booking.id;
    }],
    ["canonical guest identity", (value) => {
      value.booking.data.userId = "payg_guest_" + "b".repeat(40);
    }],
    ["booking attendee identity", (value) => {
      value.booking.data.userName = "Foreign Guest";
    }],
    ["Checkout purchaser identity", (value) => {
      value.session.customer_details.email = "foreign@example.test";
    }],
    ["class capacity counts", (value) => {
      value.seededClass.data.paygUnpaidHoldCount = 1;
    }],
    ["outbox legal receipt", (value) => {
      value.outbox.data.templateData.legalAcceptance.waiver.publicUrl =
        "http://localhost:3002/legal/products/other.txt";
    }],
    ["outbox recipient identity", (value) => {
      value.outbox.data.to = ["foreign@example.test"];
    }],
    ["outbox attendee identity", (value) => {
      value.outbox.data.templateData.attendeeName = "Foreign Guest";
    }],
    ["waiver acceptance binding", (value) => {
      value.waiver.data.paymentIntentId = "pi_foreign";
    }],
    ["waiver acceptance version", (value) => {
      value.waiver.data.acceptances.waiverVersion = "foreign-version";
    }],
    ["acceptance evidence digest", (value) => {
      value.waiver.data.acceptanceEvidenceDigest = "e".repeat(64);
    }],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const value = fixture();
      mutate(value);
      assert.throws(() => verifyPaygJourneyEvidence(value));
    });
  }
});

test("PAYG verifier requires an explicit exact test Checkout id", () => {
  assert.equal(
    sessionIdArgument(["--session=cs_test_payg_browser_binding"]),
    "cs_test_payg_browser_binding"
  );
  assert.throws(() => sessionIdArgument([]), /exact Stripe test Checkout id/);
  assert.throws(
    () => sessionIdArgument(["--session=cs_live_forbidden"]),
    /exact Stripe test Checkout id/
  );
});

test("PAYG verifier closes every Firebase Admin app", async () => {
  const closed = [];
  await closeFirebaseAdminApps([
    {delete: async () => closed.push("first")},
    {delete: async () => closed.push("second")},
  ]);
  assert.deepEqual(closed.sort(), ["first", "second"]);
});
