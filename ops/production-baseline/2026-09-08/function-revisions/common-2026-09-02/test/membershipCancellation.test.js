/* eslint-disable
  max-len,
  require-jsdoc,
  valid-jsdoc,
  @typescript-eslint/no-var-requires
*/

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CANONICAL_CANCELLATION_STATEMENT,
  CANONICAL_CANCELLATION_STATEMENT_VERSION,
  MembershipCancellationValidationError,
  assertMembershipCancellationReceipt,
  buildCancellationAcknowledgementHtml,
  buildCancellationAcknowledgementPayload,
  buildCoolingOffCancellationReceipt,
  buildImmediateCoolingOffOutcome,
  buildMembershipCancellationProjection,
  cancellationAcknowledgementIdempotencyKey,
  cancellationAcknowledgementOutboxId,
  cancellationReceiptDocumentId,
  canonicalizeCancellationEmail,
  isCancellationKind,
  isCancellationProviderStatus,
  isCancellationReceiptChannel,
  isCancellationRequestStatus,
} = require("../lib/membershipCancellation");

const CONTRACT_MADE_AT = Date.parse("2026-08-19T10:00:00.000Z");
const RECEIVED_AT = Date.parse("2026-08-20T13:07:00.000Z");
const RECORDED_AT = Date.parse("2026-08-20T13:07:02.000Z");
const SERVICE_STARTS_AT = Date.parse("2026-09-01T00:00:00.000Z");
const COOLING_OFF_ENDS_AT = Date.parse("2026-09-02T10:00:00.000Z");
const REQUEST_ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const SUBSCRIPTION_ID = "sub_cooling_off_example";
const CONTENT_SHA256 = "a".repeat(64);
const MESSAGE_SHA256 = "b".repeat(64);

function receiptInput(overrides = {}) {
  return {
    requestId: REQUEST_ID,
    subscriptionId: SUBSCRIPTION_ID,
    channel: "membership_portal",
    receivedAtMillis: RECEIVED_AT,
    recordedAtMillis: RECORDED_AT,
    actorUid: "u",
    staffActorUid: null,
    payer: {
      uid: "u",
      fullName: "Ava Rhys Thomas",
      email: "AVA@EXAMPLE.TEST",
    },
    sender: {
      uid: "u",
      fullName: "Ava Rhys Thomas",
      email: "AVA@EXAMPLE.TEST",
    },
    sourceEvidence: {
      externalMessageIdSha256: null,
      contentSha256: CONTENT_SHA256,
    },
    membership: {
      planKey: "adult_unlimited",
      planName: "Adult Unlimited Membership",
      participantFullName: "Ava Rhys Thomas",
      contractMadeAtMillis: CONTRACT_MADE_AT,
      coolingOffEndsAtMillis: COOLING_OFF_ENDS_AT,
      serviceStartsAtMillis: SERVICE_STARTS_AT,
      firstPaymentReceivedAtMillis: null,
      immediatePerformanceRequested: true,
    },
    ...overrides,
  };
}

function acknowledgementInput(receipt, overrides = {}) {
  return {
    receipt,
    company: {
      legalName: "ZERO ALPHA FITNESS LTD",
      tradingName: "Zero Alpha Fitness",
      supportEmail: "SUPPORT@ZEROALPHAFITNESS.CO.UK",
      fromEmail: "hello@zeroalphafitness.co.uk",
      postalAddress: "Unit 3, Felinfoel Business Hub, Llanelli, SA14 8BE",
    },
    membership: {
      subscriptionId: SUBSCRIPTION_ID,
      planName: "Adult Unlimited Membership",
      participantFullName: "Ava Rhys Thomas",
    },
    recipient: {
      fullName: "Ava Rhys Thomas",
      email: "AVA@EXAMPLE.TEST",
    },
    ...overrides,
  };
}

function mutableClone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("a pre-service cooling-off receipt freezes an immediate, no-future-payment outcome", () => {
  const receipt = buildCoolingOffCancellationReceipt(receiptInput());

  assert.equal(receipt.receiptId, REQUEST_ID);
  assert.equal(receipt.status, "received");
  assert.equal(receipt.kind, "cooling_off");
  assert.equal(receipt.statement, CANONICAL_CANCELLATION_STATEMENT);
  assert.equal(
    receipt.statementVersion,
    CANONICAL_CANCELLATION_STATEMENT_VERSION
  );
  assert.equal(receipt.payer.email, "ava@example.test");
  assert.deepEqual(receipt.outcome, {
    kind: "cooling_off",
    legalReceiptAtMillis: RECEIVED_AT,
    cancellationEffectiveAtMillis: RECEIVED_AT,
    accessEndsAtMillis: RECEIVED_AT,
    collectFuturePayments: false,
    futurePaymentDuePence: 0,
    providerCancellationMode: "immediate",
    providerEndedAtMillis: null,
    refundReviewRequired: false,
    refundAmountPence: null,
    refundReviewStatus: "not_required",
  });
  assert.equal(Object.isFrozen(receipt), true);
  assert.equal(Object.isFrozen(receipt.membership), true);
  assert.equal(Object.isFrozen(receipt.outcome), true);
  assert.doesNotThrow(() => assertMembershipCancellationReceipt(receipt));
});

test("refund review is flagged, but no refund amount is automated", () => {
  const afterServiceStart = buildImmediateCoolingOffOutcome({
    receivedAtMillis: Date.parse("2026-09-01T09:00:00.000Z"),
    serviceStartsAtMillis: SERVICE_STARTS_AT,
    firstPaymentReceivedAtMillis: null,
  });
  const afterPayment = buildImmediateCoolingOffOutcome({
    receivedAtMillis: RECEIVED_AT,
    serviceStartsAtMillis: SERVICE_STARTS_AT,
    firstPaymentReceivedAtMillis: Date.parse("2026-08-20T12:00:00.000Z"),
  });

  for (const outcome of [afterServiceStart, afterPayment]) {
    assert.equal(outcome.refundReviewRequired, true);
    assert.equal(outcome.refundReviewStatus, "manual_review");
    assert.equal(outcome.refundAmountPence, null);
    assert.equal(outcome.futurePaymentDuePence, 0);
  }
});

test("provider completion is projected separately from legal receipt time", () => {
  const receipt = buildCoolingOffCancellationReceipt(receiptInput());
  const pending = buildMembershipCancellationProjection(receipt);
  const providerEndedAt = RECEIVED_AT + 45_000;
  const applied = buildMembershipCancellationProjection(receipt, {
    status: "applied",
    endedAtMillis: providerEndedAt,
  });

  assert.equal(pending.status, "accepted");
  assert.equal(pending.providerStatus, "pending");
  assert.equal(pending.receivedAtMillis, RECEIVED_AT);
  assert.equal(pending.cancellationEffectiveAtMillis, RECEIVED_AT);
  assert.equal(pending.providerEndedAtMillis, null);
  assert.equal(applied.status, "applied");
  assert.equal(applied.providerStatus, "applied");
  assert.equal(applied.cancellationEffectiveAtMillis, RECEIVED_AT);
  assert.equal(applied.providerEndedAtMillis, providerEndedAt);
  assert.notEqual(
    applied.cancellationEffectiveAtMillis,
    applied.providerEndedAtMillis
  );
  assert.throws(
    () => buildMembershipCancellationProjection(receipt, {
      status: "applied",
      endedAtMillis: null,
    }),
    /requires provider\.endedAtMillis/
  );
});

test("a required refund review gets the frontend-safe refund_review status", () => {
  const receipt = buildCoolingOffCancellationReceipt(receiptInput({
    receivedAtMillis: Date.parse("2026-09-01T09:00:00.000Z"),
    recordedAtMillis: Date.parse("2026-09-01T09:00:01.000Z"),
  }));
  const projection = buildMembershipCancellationProjection(receipt);

  assert.equal(projection.status, "refund_review");
  assert.equal(projection.providerStatus, "pending");
  assert.equal(projection.refundReviewRequired, true);
  assert.equal(projection.refundAmountPence, null);
});

test("receipt, outbox, and provider idempotency identifiers are deterministic", () => {
  assert.equal(cancellationReceiptDocumentId(REQUEST_ID), REQUEST_ID);
  assert.equal(
    cancellationAcknowledgementOutboxId(REQUEST_ID),
    `cancellation-${REQUEST_ID}`
  );
  assert.equal(
    cancellationAcknowledgementIdempotencyKey(REQUEST_ID),
    `membership-cancellation/${REQUEST_ID}/ack/v1`
  );
  assert.throws(
    () => cancellationReceiptDocumentId("../../memberships"),
    MembershipCancellationValidationError
  );
});

test("the durable acknowledgement is deterministic, escaped, and makes no refund promise", () => {
  const receipt = buildCoolingOffCancellationReceipt(receiptInput({
    receivedAtMillis: Date.parse("2026-09-01T09:00:00.000Z"),
    recordedAtMillis: Date.parse("2026-09-01T09:00:01.000Z"),
  }));
  const input = acknowledgementInput(receipt);
  const first = buildCancellationAcknowledgementPayload(input);
  const second = buildCancellationAcknowledgementPayload(input);

  assert.deepEqual(first, second);
  assert.equal(
    first.from,
    "Zero Alpha Fitness <hello@zeroalphafitness.co.uk>"
  );
  assert.deepEqual(first.to, ["ava@example.test"]);
  assert.equal(first.reply_to, "support@zeroalphafitness.co.uk");
  assert.equal(
    first.subject,
    "Cancellation received — Adult Unlimited Membership"
  );
  assert.match(first.html, /No further recurring membership payment will be taken/);
  assert.match(first.html, /Manual refund review/);
  assert.match(first.html, /does not calculate or promise a refund amount/);
  assert.match(first.html, /payment provider may record completion later/i);
  assert.match(first.html, /1 September 2026 at 10:00/);
  assert.match(first.html, new RegExp(REQUEST_ID));
  assert.equal(first.html.includes("No further membership payment is due"), false);

  const escapedReceipt = buildCoolingOffCancellationReceipt(receiptInput({
    payer: {
      uid: "u",
      fullName: "Ava <Admin>",
      email: "ava@example.test",
    },
    sender: {
      uid: "u",
      fullName: "Ava <Admin>",
      email: "ava@example.test",
    },
    membership: {
      ...receiptInput().membership,
      participantFullName: "Child <script>",
    },
  }));
  const html = buildCancellationAcknowledgementHtml(acknowledgementInput(
    escapedReceipt,
    {
      membership: {
        subscriptionId: SUBSCRIPTION_ID,
        planName: "Adult Unlimited Membership",
        participantFullName: "Child <script>",
      },
      recipient: {fullName: "Ava <Admin>", email: "ava@example.test"},
    }
  ));
  assert.match(html, /Ava &lt;Admin&gt;/);
  assert.match(html, /Child &lt;script&gt;/);
  assert.equal(html.includes("Child <script>"), false);
});

test("receipt validation rejects altered legal, payment, and refund evidence", () => {
  const receipt = buildCoolingOffCancellationReceipt(receiptInput());
  const alteredStatement = mutableClone(receipt);
  alteredStatement.statement = "Please stop later";
  const alteredFuturePayment = mutableClone(receipt);
  alteredFuturePayment.outcome.futurePaymentDuePence = 6000;
  const automatedRefund = mutableClone(receipt);
  automatedRefund.outcome.refundAmountPence = 2000;

  assert.throws(
    () => assertMembershipCancellationReceipt(alteredStatement),
    /canonical statement/i
  );
  assert.throws(
    () => assertMembershipCancellationReceipt(alteredFuturePayment),
    /futurePaymentDuePence/
  );
  assert.throws(
    () => assertMembershipCancellationReceipt(automatedRefund),
    /refundAmountPence/
  );
});

test("channel and cooling-off validation fail closed while allowing short Firebase UIDs", () => {
  assert.doesNotThrow(() => buildCoolingOffCancellationReceipt(receiptInput({
    actorUid: "x",
    payer: {...receiptInput().payer, uid: "x"},
    sender: {...receiptInput().sender, uid: "x"},
  })));
  assert.throws(
    () => buildCoolingOffCancellationReceipt(receiptInput({actorUid: null})),
    /require actorUid/
  );
  assert.throws(
    () => buildCoolingOffCancellationReceipt(receiptInput({
      receivedAtMillis: COOLING_OFF_ENDS_AT + 1,
      recordedAtMillis: COOLING_OFF_ENDS_AT + 2,
    })),
    /within the stored cooling-off period/
  );
  assert.doesNotThrow(() => buildCoolingOffCancellationReceipt(receiptInput({
    receivedAtMillis: COOLING_OFF_ENDS_AT,
    recordedAtMillis: COOLING_OFF_ENDS_AT,
  })));
  assert.throws(
    () => buildCoolingOffCancellationReceipt(receiptInput({
      channel: "support_email",
      actorUid: null,
      sender: {uid: null, fullName: "Ava", email: "ava@example.test"},
      sourceEvidence: {
        externalMessageIdSha256: MESSAGE_SHA256,
        contentSha256: null,
      },
    })),
    /content hash/
  );
});

test("type guards and email canonicalisation expose integration-safe values", () => {
  assert.equal(isCancellationKind("cooling_off"), true);
  assert.equal(isCancellationKind("refund"), false);
  assert.equal(isCancellationReceiptChannel("support_email"), true);
  assert.equal(isCancellationReceiptChannel("phone"), false);
  assert.equal(isCancellationProviderStatus("pending"), true);
  assert.equal(isCancellationProviderStatus("accepted"), false);
  assert.equal(isCancellationRequestStatus("accepted"), true);
  assert.equal(isCancellationRequestStatus("refund_review"), true);
  assert.equal(canonicalizeCancellationEmail("  AVA@EXAMPLE.TEST  "), "ava@example.test");
  assert.throws(
    () => canonicalizeCancellationEmail("Ava\nBcc:attacker@example.test"),
    MembershipCancellationValidationError
  );
});

test("acknowledgement input cannot drift from the immutable membership snapshot", () => {
  const receipt = buildCoolingOffCancellationReceipt(receiptInput());
  assert.throws(
    () => buildCancellationAcknowledgementPayload(acknowledgementInput(
      receipt,
      {
        membership: {
          subscriptionId: SUBSCRIPTION_ID,
          planName: "Different plan",
          participantFullName: "Ava Rhys Thomas",
        },
      }
    )),
    /details do not match the receipt/
  );
});
