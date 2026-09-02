/* eslint-disable max-len, require-jsdoc, no-console, @typescript-eslint/no-var-requires */

/**
 * Read-only preflight for a future one-shot Resend delivery or an exact
 * readback-only recovery. It never executes an email worker, changes an outbox
 * or calls Resend. Selection is limited to one explicit Checkout Session and
 * one explicit outbox document ID.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const admin = require("firebase-admin");
const Stripe = require("stripe");

const {stripeCliTestKey} = require("./stripeCliTestKey");

const PROJECT_ID = "demo-alphawod-stripe";
const APPROVED_RECIPIENT = "hello@thisisaevi.com";
const APPROVED_SENDER_EMAIL = "hello@zeroalphafitness.co.uk";
const APPROVED_FROM = `Zero Alpha Fitness <${APPROVED_SENDER_EMAIL}>`;
const APPROVED_REPLY_TO = "support@zeroalphafitness.co.uk";
const DELIVERY_MODES = new Set(["send", "readback"]);
const REPOSITORY_ROOT = path.resolve(__dirname, "../..");
const MEMBERSHIP_COLLECTION = "membershipEmailOutbox";
const PAYG_COLLECTION = "paygEmailOutbox";
const MEMBERSHIP_KINDS = new Set(["membership_confirmation"]);
const PAYG_KINDS = new Set([
  "payg_guest_confirmation",
  "payg_guest_refund_confirmation",
  "payg_guest_dispute_notice",
]);
const NO_FOLLOW = fs.constants.O_NOFOLLOW || 0;

class GuardrailError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GuardrailError";
    this.code = code;
  }
}

function guard(condition, code, message) {
  if (!condition) throw new GuardrailError(code, message);
}

function parseArguments(argv) {
  const required = new Set(["session", "outbox-id", "resend-key-file"]);
  const allowed = new Set([...required, "mode"]);
  const values = new Map();
  for (const raw of argv) {
    const match = raw.match(/^--([a-z-]+)=(.*)$/s);
    guard(Boolean(match), "invalid_argument", "Every argument must use --name=value.");
    const [, name, value] = match;
    guard(allowed.has(name), "unknown_argument", "An unsupported argument was supplied.");
    guard(!values.has(name), "duplicate_argument", "An argument was supplied more than once.");
    guard(value.length > 0, "empty_argument", "A required argument is empty.");
    values.set(name, value);
  }
  guard([...required].every((name) => values.has(name)),
    "missing_argument",
    "Pass one exact Session, one exact outbox ID and one explicit Resend key file.");
  const sessionId = values.get("session");
  const outboxId = values.get("outbox-id");
  const resendKeyFile = values.get("resend-key-file");
  const deliveryMode = values.get("mode") || "send";
  guard(/^cs_test_[A-Za-z0-9_]{4,252}$/.test(sessionId),
    "invalid_session_id",
    "The Checkout Session must be an exact cs_test_ identifier.");
  guard(/^(?:sub_[A-Za-z0-9_]{4,252}|payg_[a-f0-9]{64}|payg_(?:refund|dispute)_[a-f0-9]{64})$/.test(outboxId),
    "invalid_outbox_id",
    "The outbox ID is not an exact supported membership or PAYG identifier.");
  guard(path.isAbsolute(resendKeyFile),
    "secret_path_not_absolute",
    "The Resend key file path must be absolute.");
  guard(DELIVERY_MODES.has(deliveryMode),
    "invalid_delivery_mode",
    "Delivery mode must be send or readback.");
  return Object.freeze({sessionId, outboxId, resendKeyFile, deliveryMode});
}

function isFixedLoopbackHost(value, port) {
  return value === `127.0.0.1:${port}` || value === `localhost:${port}`;
}

function assertLocalEnvironment(environment = process.env) {
  guard(environment.GCLOUD_PROJECT === PROJECT_ID &&
    environment.GOOGLE_CLOUD_PROJECT === PROJECT_ID,
  "non_demo_project",
  "Both Google project variables must name the isolated demo project.");
  guard(isFixedLoopbackHost(environment.FIRESTORE_EMULATOR_HOST, 8080),
    "non_loopback_firestore",
    "Firestore must be the fixed loopback emulator on port 8080.");
  guard(isFixedLoopbackHost(environment.FIREBASE_AUTH_EMULATOR_HOST, 9099),
    "non_loopback_auth",
    "Auth must be the fixed loopback emulator on port 9099.");
  guard(!environment.RESEND_API_KEY || environment.RESEND_API_KEY.trim() === "",
    "resend_secret_in_environment",
    "RESEND_API_KEY must come only from the explicit protected file.");
  for (const name of ["MEMBERSHIP_FIREBASE_PROJECT_ID", "PAYG_FIREBASE_PROJECT_ID"]) {
    guard(!environment[name] || environment[name] === PROJECT_ID,
      "conflicting_application_project",
      "An application project variable points outside the demo project.");
  }
  guard(!environment.STRIPE_EXPECTED_MODE || environment.STRIPE_EXPECTED_MODE === "test",
    "non_test_stripe_mode",
    "Stripe expected mode must be test.");
  if (environment.FIREBASE_CONFIG) {
    let config;
    try {
      config = JSON.parse(environment.FIREBASE_CONFIG);
    } catch {
      throw new GuardrailError("invalid_firebase_config", "FIREBASE_CONFIG is not valid JSON.");
    }
    guard(!config.projectId || config.projectId === PROJECT_ID,
      "conflicting_firebase_config",
      "FIREBASE_CONFIG points outside the demo project.");
  }
  return true;
}

function configureReadOnlyEnvironment(environment = process.env) {
  Object.assign(environment, {
    FUNCTIONS_EMULATOR: "true",
    MEMBERSHIP_FIREBASE_PROJECT_ID: PROJECT_ID,
    PAYG_FIREBASE_PROJECT_ID: PROJECT_ID,
    STRIPE_EXPECTED_MODE: "test",
    MEMBERSHIP_TEST_JOURNEY_ENABLED: "true",
    MEMBERSHIP_FROM_EMAIL: APPROVED_SENDER_EMAIL,
    PAYG_FROM_EMAIL: APPROVED_FROM,
    PAYG_REPLY_TO_EMAIL: APPROVED_REPLY_TO,
  });
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function inspectResendKeyFile(filePath) {
  guard(path.isAbsolute(filePath), "secret_path_not_absolute", "The Resend key file path must be absolute.");
  let linkStat;
  try {
    linkStat = fs.lstatSync(filePath);
  } catch {
    throw new GuardrailError("secret_file_unreadable", "The Resend key file cannot be read.");
  }
  guard(!linkStat.isSymbolicLink(), "secret_file_symlink", "The Resend key file must not be a symbolic link.");
  let realPath;
  try {
    realPath = fs.realpathSync(filePath);
  } catch {
    throw new GuardrailError("secret_file_unreadable", "The Resend key file cannot be resolved.");
  }
  guard(!isInside(REPOSITORY_ROOT, realPath),
    "secret_file_inside_repository",
    "The Resend key file must be outside the repository.");
  let descriptor;
  let bytes;
  try {
    descriptor = fs.openSync(realPath, fs.constants.O_RDONLY | NO_FOLLOW);
    const stat = fs.fstatSync(descriptor);
    guard(stat.isFile(), "secret_file_not_regular", "The Resend key file must be a regular file.");
    guard(stat.dev === linkStat.dev && stat.ino === linkStat.ino,
      "secret_file_changed",
      "The Resend key file changed during validation.");
    guard((stat.mode & 0o777) === 0o600,
      "secret_file_permissions",
      "The Resend key file must have mode 0600.");
    if (typeof process.getuid === "function") {
      guard(stat.uid === process.getuid(),
        "secret_file_owner",
        "The Resend key file must be owned by the current user.");
    }
    guard(stat.size > 20 && stat.size <= 4096,
      "secret_file_size",
      "The Resend key file has an invalid size.");
    bytes = fs.readFileSync(descriptor);
  } catch (error) {
    if (error instanceof GuardrailError) throw error;
    throw new GuardrailError("secret_file_unreadable", "The Resend key file cannot be read safely.");
  } finally {
    if (typeof descriptor === "number") fs.closeSync(descriptor);
  }
  let shapeValid = false;
  try {
    shapeValid = /^re_[A-Za-z0-9_-]{20,509}$/.test(bytes.toString("utf8").trim());
  } finally {
    bytes.fill(0);
  }
  guard(shapeValid,
    "invalid_resend_key",
    "The protected file does not contain one Resend API key.");
  return Object.freeze({mode: "0600", outsideRepository: true, shapeValid: true});
}

function idOf(value) {
  if (typeof value === "string") return value;
  return value && typeof value === "object" && typeof value.id === "string" ? value.id : null;
}

function canonicalEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function checkoutRecipient(session) {
  const candidates = [
    canonicalEmail(session.customer_details?.email),
    canonicalEmail(session.customer_email),
  ].filter(Boolean);
  guard(candidates.length > 0 && new Set(candidates).size === 1,
    "checkout_recipient_missing_or_conflicting",
    "Checkout does not contain one unambiguous recipient.");
  guard(candidates[0] === APPROVED_RECIPIENT,
    "checkout_recipient_not_approved",
    "Checkout recipient is not the explicitly approved test recipient.");
  return candidates[0];
}

function assertExactRecipient(value, code) {
  guard(Array.isArray(value) && value.length === 1 &&
    canonicalEmail(value[0]) === APPROVED_RECIPIENT,
  code,
  "The email outbox does not contain the one approved Checkout recipient.");
}

const ALLOWED_RENDERED_EMAIL_KEYS = new Set([
  "attachments",
  "from",
  "html",
  "reply_to",
  "subject",
  "text",
  "to",
]);

function assertApprovedRenderedEmail(email) {
  guard(email && typeof email === "object" && !Array.isArray(email),
    "rendered_email_missing",
    "The selected outbox did not render one email.");
  guard(Object.keys(email).every((key) => ALLOWED_RENDERED_EMAIL_KEYS.has(key)),
    "rendered_extra_field",
    "The rendered email contains an unsupported field.");
  guard(email.from === APPROVED_FROM,
    "rendered_sender_not_approved",
    "The rendered sender is not the approved Zero Alpha sender.");
  guard(Array.isArray(email.to) && email.to.length === 1 &&
    canonicalEmail(email.to[0]) === APPROVED_RECIPIENT,
  "rendered_recipient_not_approved",
  "The rendered recipient is not the one explicitly approved test inbox.");
  guard(email.reply_to === APPROVED_REPLY_TO,
    "rendered_reply_to_not_approved",
    "The rendered reply-to address is not approved.");
  guard(typeof email.subject === "string" && email.subject.length > 0 &&
    email.subject.length <= 998 && !/[\r\n]/.test(email.subject),
  "rendered_subject_invalid",
  "The rendered subject is missing or unsafe.");
  guard(typeof email.html === "string" && email.html.length > 0,
    "rendered_body_missing",
    "The rendered email has no HTML body.");
  guard(email.text === undefined ||
    (typeof email.text === "string" && email.text.length > 0),
  "rendered_text_invalid",
  "The rendered email text body is invalid.");
  if (email.attachments !== undefined) {
    guard(Array.isArray(email.attachments) && email.attachments.length > 0 &&
      email.attachments.every((attachment) => attachment &&
        typeof attachment === "object" && !Array.isArray(attachment) &&
        Object.keys(attachment).length === 2 &&
        Object.prototype.hasOwnProperty.call(attachment, "filename") &&
        Object.prototype.hasOwnProperty.call(attachment, "content") &&
        typeof attachment.filename === "string" &&
        attachment.filename.length > 0 && attachment.filename.length <= 255 &&
        !/[\r\n]/.test(attachment.filename) &&
        typeof attachment.content === "string" &&
        attachment.content.length > 0),
    "rendered_attachments_invalid",
    "The rendered email attachments are invalid.");
  }
  return true;
}

function timestampMillis(value) {
  if (!value || typeof value.toMillis !== "function") return null;
  const result = value.toMillis();
  return Number.isSafeInteger(result) ? result : null;
}

function assertPristinePendingOutbox(outbox, nowMillis = Date.now()) {
  guard(outbox?.status === "pending",
    "outbox_not_pending",
    "The exact outbox is not pending.");
  guard(outbox.attemptCount === 0 && outbox.firstAttemptAt == null &&
    outbox.lastAttemptAt == null && outbox.providerMessageId == null &&
    outbox.sentAt == null && outbox.leaseToken == null &&
    outbox.leaseExpiresAt == null && outbox.retryDeadlineAt == null &&
    outbox.providerAcceptanceState !== "unknown_in_flight",
  "outbox_not_pristine",
  "The outbox has prior or ambiguous delivery state.");
  const dueAt = timestampMillis(outbox.nextAttemptAt);
  guard(dueAt !== null && dueAt <= nowMillis + 5_000,
    "outbox_not_due",
    "The pending outbox is not due for delivery.");
}

function safeProviderMessageId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,256}$/.test(value) ?
    value : null;
}

function assertExactSentOutbox(outbox) {
  const providerMessageId = safeProviderMessageId(outbox?.providerMessageId);
  guard(outbox?.status === "sent" && outbox.attemptCount === 1 &&
    providerMessageId !== null && outbox.sentAt != null &&
    outbox.leaseToken == null && outbox.leaseExpiresAt == null &&
    outbox.nextAttemptAt == null,
  "outbox_not_exact_sent",
  "The exact outbox is not a completed one-shot provider acceptance.");
  return providerMessageId;
}

function assertOutboxDeliveryState(outbox, deliveryMode, nowMillis) {
  if (deliveryMode === "readback") return assertExactSentOutbox(outbox);
  assertPristinePendingOutbox(outbox, nowMillis);
  return null;
}

function assertLocalSuccessUrl(session, expectedPath) {
  let url;
  try {
    url = new URL(session.success_url);
  } catch {
    throw new GuardrailError("non_local_checkout", "Checkout has no valid local success URL.");
  }
  guard((url.origin === "http://localhost:3002" ||
    url.origin === "http://127.0.0.1:3002") && url.pathname === expectedPath,
  "non_local_checkout",
  "Checkout was not created by the fixed local browser journey.");
}

function assertStripeTestObject(value, expectedId, label) {
  guard(value && value.id === expectedId && value.livemode === false,
    "stripe_readback_mismatch",
    `${label} did not read back as the exact Stripe test object.`);
}

function validateMembershipCorrelation(input) {
  const {session, subscription, intentId, intent, membershipId, membership, outboxId, outbox} = input;
  const deliveryMode = input.deliveryMode || "send";
  guard(DELIVERY_MODES.has(deliveryMode),
    "invalid_delivery_mode",
    "Delivery mode must be send or readback.");
  checkoutRecipient(session);
  assertLocalSuccessUrl(session, "/memberships/success");
  guard(session.livemode === false && session.mode === "subscription" &&
    session.status === "complete" &&
    (session.payment_status === "paid" || session.payment_status === "no_payment_required"),
  "membership_checkout_invalid",
  "Checkout is not a completed Stripe test subscription.");
  const subscriptionId = idOf(session.subscription);
  guard(subscriptionId && subscriptionId === membershipId && subscriptionId === outboxId,
    "membership_owner_mismatch",
    "Checkout, membership and outbox IDs do not match.");
  assertStripeTestObject(subscription, subscriptionId, "Subscription");
  guard(session.metadata?.intentId === intentId && intent.checkoutSessionId === session.id &&
    intent.status === "fulfilled",
  "membership_intent_mismatch",
  "The exact fulfilled membership intent is not bound to Checkout.");
  const prices = subscription.items?.data || [];
  guard(membership.checkoutSessionId === session.id &&
    membership.planKey === session.metadata?.planKey && intent.planKey === membership.planKey &&
    canonicalEmail(membership.payerEmail) === APPROVED_RECIPIENT &&
    typeof membership.stripePriceId === "string" &&
    membership.stripePriceId === intent.stripePriceId &&
    prices.some((item) => idOf(item.price) === membership.stripePriceId),
  "membership_document_mismatch",
  "The membership is not exactly correlated to the Stripe subscription.");
  guard(outbox.kind === "membership_confirmation" && MEMBERSHIP_KINDS.has(outbox.kind) &&
    outbox.subscriptionId === subscriptionId &&
    outbox.idempotencyKey === `membership-confirmation/${subscriptionId}/v1`,
  "membership_outbox_mismatch",
  "The exact outbox is not the membership confirmation for this subscription.");
  const providerMessageId = assertOutboxDeliveryState(
    outbox,
    deliveryMode,
    input.nowMillis
  );
  guard(deliveryMode === "send" ?
    membership.confirmationEmailStatus === "pending" :
    membership.confirmationEmailStatus === "sent" &&
      membership.confirmationEmailProviderId === providerMessageId &&
      membership.confirmationEmailSentAt != null,
  "membership_email_state_mismatch",
  "The membership email projection does not match the selected delivery mode.");
  guard(outbox.payload && outbox.payload.from === APPROVED_FROM,
    "unapproved_sender",
    "The membership outbox sender is not approved.");
  assertExactRecipient(outbox.payload?.to, "membership_outbox_recipient_mismatch");
  return Object.freeze({
    kind: outbox.kind,
    purchaseType: "membership",
    ownerId: subscriptionId,
    providerMessageId,
  });
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function expectedPaygOutboxId(kind, orderId) {
  if (kind === "payg_guest_confirmation") return orderId;
  if (kind === "payg_guest_refund_confirmation") {
    return `payg_refund_${sha256(`payg-refund-confirmed:v1:${orderId}`)}`;
  }
  if (kind === "payg_guest_dispute_notice") {
    return `payg_dispute_${sha256(`payg-dispute-detected:v1:${orderId}`)}`;
  }
  return null;
}

function expectedPaygIdempotencyKey(kind, orderId) {
  if (kind === "payg_guest_confirmation") return `payg-confirmation/${orderId}/v1`;
  if (kind === "payg_guest_refund_confirmation") return `payg-refund-confirmed/${orderId}/v1`;
  if (kind === "payg_guest_dispute_notice") return `payg-dispute-detected/${orderId}/v1`;
  return null;
}

function validatePaygCorrelation(input) {
  const {session, paymentIntent, orderId, order, outboxId, outbox} = input;
  const deliveryMode = input.deliveryMode || "send";
  guard(DELIVERY_MODES.has(deliveryMode),
    "invalid_delivery_mode",
    "Delivery mode must be send or readback.");
  checkoutRecipient(session);
  assertLocalSuccessUrl(session, "/pay-as-you-go/success");
  guard(session.livemode === false && session.mode === "payment" &&
    session.status === "complete" && session.payment_status === "paid" &&
    session.metadata?.purchaseKind === "payg_class" &&
    session.metadata?.offeringKey === "adult_payg_class" &&
    session.metadata?.paygIntentId === orderId && session.client_reference_id === orderId,
  "payg_checkout_invalid",
  "Checkout is not the exact completed PAYG Stripe test payment.");
  const paymentIntentId = idOf(session.payment_intent);
  assertStripeTestObject(paymentIntent, paymentIntentId, "PaymentIntent");
  guard(paymentIntent.status === "succeeded" && paymentIntent.amount === 700 &&
    paymentIntent.amount_received === 700 && paymentIntent.currency === "gbp" &&
    session.amount_total === 700 && session.currency === "gbp",
  "payg_payment_invalid",
  "The PAYG payment is not the exact succeeded £7 Stripe test payment.");
  guard(order.orderId === orderId && order.checkoutSessionId === session.id &&
    order.paymentIntentId === paymentIntentId && order.purchaseKind === "payg_class" &&
    order.offeringKey === "adult_payg_class" && order.stripeMode === "test" &&
    order.amountPence === 700 && order.currency === "gbp" &&
    canonicalEmail(order.contact?.email) === APPROVED_RECIPIENT,
  "payg_order_mismatch",
  "The PAYG order is not exactly correlated to Checkout.");
  guard(PAYG_KINDS.has(outbox.kind),
    "unsupported_outbox_kind",
    "Only PAYG confirmation, refund and dispute outboxes are supported.");
  guard(outboxId === expectedPaygOutboxId(outbox.kind, orderId) &&
    outbox.orderId === orderId &&
    outbox.idempotencyKey === expectedPaygIdempotencyKey(outbox.kind, orderId),
  "payg_outbox_mismatch",
  "The PAYG outbox ID or idempotency binding does not match the order.");
  const providerMessageId = assertOutboxDeliveryState(
    outbox,
    deliveryMode,
    input.nowMillis
  );
  assertExactRecipient(outbox.to, "payg_outbox_recipient_mismatch");
  const projection = outbox.kind === "payg_guest_confirmation" ? {
    status: "confirmationEmailStatus",
    provider: "confirmationEmailProviderId",
    sentAt: "confirmationEmailSentAt",
  } : outbox.kind === "payg_guest_refund_confirmation" ? {
    status: "refundEmailStatus",
    provider: "refundEmailProviderId",
    sentAt: "refundEmailSentAt",
  } : {
    status: "disputeEmailStatus",
    provider: "disputeEmailProviderId",
    sentAt: "disputeEmailSentAt",
  };
  guard(deliveryMode === "send" ? order[projection.status] === "pending" :
    order[projection.status] === "sent" &&
      order[projection.provider] === providerMessageId &&
      order[projection.sentAt] != null,
    "payg_order_email_state_mismatch",
    "The PAYG order does not record the exact selected email state.");
  if (outbox.kind === "payg_guest_confirmation") {
    guard(order.status === "confirmed" && outboxId === orderId,
      "payg_confirmation_not_deliverable",
      "The PAYG booking is not confirmed for its confirmation email.");
  } else {
    const data = outbox.templateData;
    guard(data && data.paymentIntentId === paymentIntentId &&
      data.chargeId === order.chargeId && data.amountPence === 700 && data.currency === "gbp",
    "payg_lifecycle_binding_mismatch",
    "The PAYG lifecycle email is not bound to the paid Stripe objects.");
    if (outbox.kind === "payg_guest_refund_confirmation") {
      guard(typeof data.refundId === "string" && data.refundId === order.refundId &&
        order.refundStatus === "succeeded" && order.refundedAmountPence === 700,
      "payg_refund_binding_mismatch",
      "The refund email is not bound to a complete succeeded refund.");
    } else {
      guard(typeof data.disputeId === "string" && data.disputeId === order.disputeId &&
        data.chargeId === order.disputeChargeId && order.disputeAmountPence === 700 &&
        order.disputeCurrency === "gbp" && order.refundAutomationStatus === "suspended_dispute",
      "payg_dispute_binding_mismatch",
      "The dispute email is not bound to the exact Stripe dispute.");
    }
  }
  return Object.freeze({
    kind: outbox.kind,
    purchaseType: "payg",
    ownerId: orderId,
    providerMessageId,
  });
}

function validatePaygLifecycleProvider(input) {
  const {kind, outbox, paymentIntent, charge, refund, dispute} = input;
  if (kind === "payg_guest_confirmation") return true;
  const data = outbox.templateData;
  assertStripeTestObject(charge, data.chargeId, "Charge");
  guard(idOf(charge.payment_intent) === paymentIntent.id &&
    charge.amount === 700 && charge.currency === "gbp",
  "payg_charge_mismatch",
  "The exact Stripe test Charge does not match the PAYG payment.");
  if (kind === "payg_guest_refund_confirmation") {
    assertStripeTestObject(refund, data.refundId, "Refund");
    guard(refund.status === "succeeded" && refund.amount === 700 &&
      refund.currency === "gbp" && idOf(refund.payment_intent) === paymentIntent.id &&
      idOf(refund.charge) === charge.id,
    "payg_refund_readback_mismatch",
    "The exact Stripe test Refund does not prove the full refund.");
    return true;
  }
  assertStripeTestObject(dispute, data.disputeId, "Dispute");
  guard(dispute.amount === 700 && dispute.currency === "gbp" &&
    idOf(dispute.payment_intent) === paymentIntent.id && idOf(dispute.charge) === charge.id,
  "payg_dispute_readback_mismatch",
  "The exact Stripe test Dispute does not match the paid Charge.");
  return true;
}

function assertWorkerBuildIsFresh(purchaseType) {
  const basename = purchaseType === "membership" ? "membership" : "payg";
  const source = path.join(REPOSITORY_ROOT, "functions", "src", `${basename}.ts`);
  const compiled = path.join(REPOSITORY_ROOT, "functions", "lib", `${basename}.js`);
  let sourceStat;
  let compiledStat;
  try {
    sourceStat = fs.statSync(source);
    compiledStat = fs.statSync(compiled);
  } catch {
    throw new GuardrailError("worker_build_missing", "The existing email worker must be built first.");
  }
  guard(compiledStat.mtimeMs >= sourceStat.mtimeMs,
    "worker_build_stale",
    "The compiled existing email worker is older than its source.");
  return true;
}

async function exactOutbox(db, outboxId) {
  const [membership, payg] = await Promise.all([
    db.collection(MEMBERSHIP_COLLECTION).doc(outboxId).get(),
    db.collection(PAYG_COLLECTION).doc(outboxId).get(),
  ]);
  const matches = [
    membership.exists ? {purchaseType: "membership", snapshot: membership} : null,
    payg.exists ? {purchaseType: "payg", snapshot: payg} : null,
  ].filter(Boolean);
  guard(matches.length === 1,
    "outbox_not_unique",
    "The explicit outbox ID must exist in exactly one supported collection.");
  return matches[0];
}

async function buildCorrelationContext(
  db,
  stripe,
  sessionId,
  outboxMatch,
  deliveryMode = "send"
) {
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch {
    throw new GuardrailError("stripe_session_readback_failed", "The exact Stripe test Session could not be retrieved.");
  }
  guard(session.id === sessionId && session.livemode === false,
    "stripe_session_mismatch",
    "The Checkout readback is not the exact Stripe test Session.");
  const outboxId = outboxMatch.snapshot.id;
  const outbox = outboxMatch.snapshot.data();
  if (outboxMatch.purchaseType === "membership") {
    guard(MEMBERSHIP_KINDS.has(outbox.kind),
      "unsupported_outbox_kind",
      "Only membership confirmations are supported.");
    const intentId = session.metadata?.intentId;
    const subscriptionId = idOf(session.subscription);
    guard(typeof intentId === "string" && /^attempt_[a-f0-9]{64}$/.test(intentId) &&
      typeof subscriptionId === "string" && subscriptionId.startsWith("sub_"),
    "membership_checkout_binding_missing",
    "Checkout is missing its exact membership owner IDs.");
    let subscription;
    try {
      subscription = await stripe.subscriptions.retrieve(subscriptionId);
    } catch {
      throw new GuardrailError("stripe_subscription_readback_failed", "The exact Stripe test Subscription could not be retrieved.");
    }
    const [intentSnapshot, membershipSnapshot] = await Promise.all([
      db.collection("membershipIntents").doc(intentId).get(),
      db.collection("memberships").doc(subscriptionId).get(),
    ]);
    guard(intentSnapshot.exists && membershipSnapshot.exists,
      "membership_documents_missing",
      "The exact local membership evidence is incomplete.");
    const correlation = validateMembershipCorrelation({
      session,
      subscription,
      intentId,
      intent: intentSnapshot.data(),
      membershipId: membershipSnapshot.id,
      membership: membershipSnapshot.data(),
      outboxId,
      outbox,
      deliveryMode,
    });
    return Object.freeze({...correlation, sessionId, outboxId, outbox});
  }

  guard(PAYG_KINDS.has(outbox.kind),
    "unsupported_outbox_kind",
    "Only PAYG confirmation, refund and dispute emails are supported.");
  const orderId = session.metadata?.paygIntentId;
  const paymentIntentId = idOf(session.payment_intent);
  guard(typeof orderId === "string" && /^payg_[a-f0-9]{64}$/.test(orderId) &&
    typeof paymentIntentId === "string" && paymentIntentId.startsWith("pi_"),
  "payg_checkout_binding_missing",
  "Checkout is missing its exact PAYG owner IDs.");
  let paymentIntent;
  try {
    paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ["latest_charge"],
    });
  } catch {
    throw new GuardrailError("stripe_payment_readback_failed", "The exact Stripe test PaymentIntent could not be retrieved.");
  }
  const orderSnapshot = await db.collection("paygOrders").doc(orderId).get();
  guard(orderSnapshot.exists, "payg_order_missing", "The exact local PAYG order is missing.");
  const correlation = validatePaygCorrelation({
    session,
    paymentIntent,
    orderId,
    order: orderSnapshot.data(),
    outboxId,
    outbox,
    deliveryMode,
  });
  if (outbox.kind !== "payg_guest_confirmation") {
    const data = outbox.templateData;
    let charge;
    let refund = null;
    let dispute = null;
    try {
      charge = await stripe.charges.retrieve(data.chargeId);
      if (outbox.kind === "payg_guest_refund_confirmation") {
        refund = await stripe.refunds.retrieve(data.refundId);
      } else {
        dispute = await stripe.disputes.retrieve(data.disputeId);
      }
    } catch {
      throw new GuardrailError("stripe_lifecycle_readback_failed", "The exact Stripe test lifecycle object could not be retrieved.");
    }
    validatePaygLifecycleProvider({
      kind: outbox.kind,
      outbox,
      paymentIntent,
      charge,
      refund,
      dispute,
    });
  }
  return Object.freeze({...correlation, sessionId, outboxId, outbox});
}

function renderExactOutboxEmail(context, paygBuilders = null) {
  let email;
  if (context.purchaseType === "membership") {
    email = context.outbox?.payload;
  } else {
    const builders = paygBuilders || require("../lib/payg");
    const builder = context.kind === "payg_guest_confirmation" ?
      builders.buildPaygConfirmationEmail :
      context.kind === "payg_guest_refund_confirmation" ?
        builders.buildPaygRefundEmail : builders.buildPaygDisputeEmail;
    guard(typeof builder === "function",
      "rendered_email_builder_missing",
      "The selected PAYG email renderer is unavailable.");
    try {
      email = builder(context.outbox, APPROVED_FROM, APPROVED_REPLY_TO);
    } catch {
      throw new GuardrailError(
        "rendered_email_invalid",
        "The selected PAYG outbox could not be rendered safely."
      );
    }
  }
  assertApprovedRenderedEmail(email);
  return email;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  assertLocalEnvironment();
  configureReadOnlyEnvironment();
  const secretFile = inspectResendKeyFile(args.resendKeyFile);
  guard(admin.apps.length === 0,
    "firebase_app_already_initialized",
    "The preflight process must start without another Firebase app.");
  const app = admin.initializeApp({projectId: PROJECT_ID});
  try {
    const db = app.firestore();
    const outboxMatch = await exactOutbox(db, args.outboxId);
    let stripe;
    try {
      stripe = new Stripe(stripeCliTestKey(), {
        maxNetworkRetries: 2,
        timeout: 20_000,
      });
    } catch {
      throw new GuardrailError("stripe_test_key_unavailable", "A valid Stripe CLI test key is required.");
    }
    const context = await buildCorrelationContext(
      db,
      stripe,
      args.sessionId,
      outboxMatch,
      args.deliveryMode
    );
    assertWorkerBuildIsFresh(context.purchaseType);
    renderExactOutboxEmail(context);
    process.stdout.write("STRIPE_TEST_EMAIL_PREFLIGHT " + JSON.stringify({
      status: "ready",
      action: args.deliveryMode === "readback" ? "readback_only" : "none",
      deliveryMode: args.deliveryMode,
      stripeMode: "test",
      checkoutSessionId: context.sessionId,
      outboxId: context.outboxId,
      outboxKind: context.kind,
      ...(context.providerMessageId ? {
        providerMessageId: context.providerMessageId,
      } : {}),
      recipientVerified: true,
      senderVerified: true,
      secretFileMode: secretFile.mode,
      resendNetworkCalled: false,
      outboxMutated: false,
    }) + "\n");
    return context;
  } finally {
    await app.delete();
  }
}

module.exports = {
  APPROVED_FROM,
  APPROVED_RECIPIENT,
  APPROVED_REPLY_TO,
  APPROVED_SENDER_EMAIL,
  GuardrailError,
  assertApprovedRenderedEmail,
  assertExactSentOutbox,
  assertLocalEnvironment,
  assertPristinePendingOutbox,
  assertWorkerBuildIsFresh,
  buildCorrelationContext,
  configureReadOnlyEnvironment,
  exactOutbox,
  expectedPaygOutboxId,
  inspectResendKeyFile,
  parseArguments,
  renderExactOutboxEmail,
  validateMembershipCorrelation,
  validatePaygCorrelation,
  validatePaygLifecycleProvider,
};

if (require.main === module) {
  main().catch((error) => {
    const code = error instanceof GuardrailError ? error.code : "unexpected_failure";
    const message = error instanceof GuardrailError ? error.message :
      "The read-only preflight failed without exposing provider or customer data.";
    process.stderr.write("STRIPE_TEST_EMAIL_PREFLIGHT_FAILED " + JSON.stringify({
      status: "failed",
      code,
      message,
    }) + "\n");
    process.exitCode = 1;
  });
}
