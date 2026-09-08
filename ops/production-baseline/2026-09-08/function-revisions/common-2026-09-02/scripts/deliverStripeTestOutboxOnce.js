/* eslint-disable max-len, require-jsdoc, no-console, @typescript-eslint/no-var-requires */

/**
 * Sends exactly one explicitly selected, preflighted Stripe TEST outbox through
 * Resend, persists the result through the production outbox state machine, and
 * reads back that one Resend message until it is delivered. There is no list,
 * latest, batch, recipient override or production-Firebase path.
 */

const fs = require("node:fs");
const admin = require("firebase-admin");
const Stripe = require("stripe");

const {stripeCliTestKey} = require("./stripeCliTestKey");
const {
  APPROVED_RECIPIENT,
  APPROVED_REPLY_TO,
  GuardrailError,
  assertApprovedRenderedEmail,
  assertLocalEnvironment,
  assertWorkerBuildIsFresh,
  buildCorrelationContext,
  configureReadOnlyEnvironment,
  exactOutbox,
  inspectResendKeyFile,
  parseArguments,
  renderExactOutboxEmail,
} = require("./preflightStripeTestOutboxDelivery");

const PROJECT_ID = "demo-alphawod-stripe";
const RESEND_EMAILS_ENDPOINT = "https://api.resend.com/emails";
const DELIVERY_TIMEOUT_MS = 120_000;
const DELIVERY_POLL_MS = 4_000;
const NO_FOLLOW = fs.constants.O_NOFOLLOW || 0;
const TERMINAL_FAILURE_EVENTS = new Set([
  "bounced",
  "canceled",
  "cancelled",
  "complained",
  "failed",
  "suppressed",
]);
const DELIVERED_EVENTS = new Set(["delivered", "opened", "clicked"]);

function guard(condition, code, message) {
  if (!condition) throw new GuardrailError(code, message);
}

class OneShotResendError extends GuardrailError {
  constructor(code, message, {httpStatus = null, providerErrorName = null, ambiguous = false} = {}) {
    super(code, message);
    this.name = "OneShotResendError";
    this.httpStatus = httpStatus;
    this.providerErrorName = providerErrorName;
    this.ambiguous = ambiguous;
  }
}

function safeProviderErrorName(value) {
  return typeof value === "string" && /^[a-z0-9_]{2,128}$/.test(value) ?
    value : null;
}

function resendFailureIsAmbiguous(status, providerErrorName) {
  return status === null || status === 408 || status === 429 || status >= 500 ||
    providerErrorName === "concurrent_idempotent_requests";
}

async function withProtectedResendKey(filePath, operation) {
  inspectResendKeyFile(filePath);
  const linkStat = fs.lstatSync(filePath);
  let descriptor;
  let bytes;
  let apiKey = null;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | NO_FOLLOW);
    const stat = fs.fstatSync(descriptor);
    guard(stat.isFile() && stat.dev === linkStat.dev && stat.ino === linkStat.ino,
      "secret_file_changed",
      "The protected Resend key file changed after preflight.");
    guard((stat.mode & 0o777) === 0o600,
      "secret_file_permissions",
      "The protected Resend key file no longer has mode 0600.");
    if (typeof process.getuid === "function") {
      guard(stat.uid === process.getuid(),
        "secret_file_owner",
        "The protected Resend key file is not owned by the current user.");
    }
    bytes = fs.readFileSync(descriptor);
    apiKey = bytes.toString("utf8").trim();
    guard(/^re_[A-Za-z0-9_-]{20,509}$/.test(apiKey),
      "invalid_resend_key",
      "The protected file does not contain one Resend API key.");
    return await operation(apiKey);
  } finally {
    apiKey = null;
    if (bytes) bytes.fill(0);
    if (typeof descriptor === "number") fs.closeSync(descriptor);
  }
}

async function responseJsonWithoutExposure(response, failureCode, failureMessage) {
  let body;
  try {
    body = await response.json();
  } catch {
    throw new GuardrailError(failureCode, failureMessage);
  }
  guard(response.ok && body && typeof body === "object" && !Array.isArray(body),
    failureCode,
    failureMessage);
  return body;
}

async function sendExactEmailViaResend(
  apiKey,
  email,
  idempotencyKey,
  fetchImpl = globalThis.fetch
) {
  assertApprovedRenderedEmail(email);
  guard(typeof idempotencyKey === "string" && idempotencyKey.length >= 16 &&
    idempotencyKey.length <= 256 && !/[\r\n]/.test(idempotencyKey),
  "invalid_idempotency_key",
  "The selected outbox has no safe idempotency key.");
  guard(typeof fetchImpl === "function",
    "resend_transport_unavailable",
    "The Resend transport is unavailable.");
  let response;
  try {
    response = await fetchImpl(RESEND_EMAILS_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
        "User-Agent": "AlphaWOD-release-one-shot/1.0",
      },
      body: JSON.stringify(email),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new OneShotResendError(
      "resend_send_unconfirmed",
      "The one-shot Resend request did not return a confirmed response; it was quarantined from retry.",
      {ambiguous: true}
    );
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new OneShotResendError(
      response.ok ? "resend_send_unconfirmed" : "resend_send_rejected",
      response.ok ?
        "Resend may have accepted the one-shot message without a readable response; it was quarantined from retry." :
        `Resend rejected the one-shot message (HTTP ${response.status}).`,
      {
        httpStatus: response.status,
        ambiguous: response.ok || resendFailureIsAmbiguous(response.status, null),
      }
    );
  }
  const providerErrorName = safeProviderErrorName(body?.name);
  if (!response.ok) {
    throw new OneShotResendError(
      "resend_send_rejected",
      `Resend rejected the one-shot message (HTTP ${response.status}).`,
      {
        httpStatus: response.status,
        providerErrorName,
        ambiguous: resendFailureIsAmbiguous(response.status, providerErrorName),
      }
    );
  }
  if (!body || typeof body !== "object" || Array.isArray(body) ||
    typeof body.id !== "string" || !/^[A-Za-z0-9_-]{8,256}$/.test(body.id)) {
    throw new OneShotResendError(
      "resend_send_unconfirmed",
      "Resend may have accepted the one-shot message without one safe message identifier; it was quarantined from retry.",
      {httpStatus: response.status, ambiguous: true}
    );
  }
  return body.id;
}

function canonicalEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function assertExactProviderRouting(body, expectedEmail) {
  assertApprovedRenderedEmail(expectedEmail);
  const replyTo = Array.isArray(body.reply_to) ? body.reply_to : [body.reply_to];
  guard(body.from === expectedEmail.from &&
    Array.isArray(body.to) && body.to.length === 1 &&
    canonicalEmail(body.to[0]) === APPROVED_RECIPIENT &&
    replyTo.length === 1 && canonicalEmail(replyTo[0]) === APPROVED_REPLY_TO &&
    (body.cc == null || (Array.isArray(body.cc) && body.cc.length === 0)) &&
    (body.bcc == null || (Array.isArray(body.bcc) && body.bcc.length === 0)) &&
    body.subject === expectedEmail.subject,
  "resend_readback_routing_mismatch",
  "The exact Resend readback did not preserve the approved email routing.");
  return true;
}

async function retrieveExactResendEmail(
  apiKey,
  providerMessageId,
  expectedEmail,
  fetchImpl = globalThis.fetch
) {
  guard(/^[A-Za-z0-9_-]{8,256}$/.test(providerMessageId),
    "invalid_resend_message_id",
    "The exact Resend message identifier is invalid.");
  let response;
  try {
    response = await fetchImpl(
      `${RESEND_EMAILS_ENDPOINT}/${encodeURIComponent(providerMessageId)}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "User-Agent": "AlphaWOD-release-one-shot/1.0",
        },
        signal: AbortSignal.timeout(20_000),
      }
    );
  } catch {
    throw new GuardrailError(
      "resend_readback_failed",
      "The exact Resend message could not be read back."
    );
  }
  const body = await responseJsonWithoutExposure(
    response,
    "resend_readback_failed",
    `The exact Resend message could not be read back (HTTP ${response.status}).`
  );
  guard(body.id === providerMessageId &&
    typeof body.last_event === "string" && /^[a-z_]{2,64}$/.test(body.last_event),
  "resend_readback_mismatch",
  "The Resend readback did not match the exact accepted message.");
  assertExactProviderRouting(body, expectedEmail);
  return Object.freeze({
    providerMessageId,
    lastEvent: body.last_event,
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForExactDelivery(
  apiKey,
  providerMessageId,
  expectedEmail,
  {
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    wait = delay,
    timeoutMs = DELIVERY_TIMEOUT_MS,
    pollMs = DELIVERY_POLL_MS,
  } = {}
) {
  const deadline = now() + timeoutMs;
  let readback;
  do {
    readback = await retrieveExactResendEmail(
      apiKey,
      providerMessageId,
      expectedEmail,
      fetchImpl
    );
    if (DELIVERED_EVENTS.has(readback.lastEvent)) return readback;
    guard(!TERMINAL_FAILURE_EVENTS.has(readback.lastEvent),
      "resend_delivery_failed",
      `The exact Resend message reached terminal state ${readback.lastEvent}.`);
    if (now() >= deadline) break;
    await wait(pollMs);
  } while (now() <= deadline);
  throw new GuardrailError(
    "resend_delivery_timeout",
    "The exact Resend message was accepted but delivery was not confirmed before timeout."
  );
}

function paygProjection(kind) {
  if (kind === "payg_guest_confirmation") {
    return {
      status: "confirmationEmailStatus",
      error: "confirmationEmailError",
      sentAt: "confirmationEmailSentAt",
      provider: "confirmationEmailProviderId",
    };
  }
  if (kind === "payg_guest_refund_confirmation") {
    return {
      status: "refundEmailStatus",
      error: "refundEmailError",
      sentAt: "refundEmailSentAt",
      provider: "refundEmailProviderId",
    };
  }
  if (kind === "payg_guest_dispute_notice") {
    return {
      status: "disputeEmailStatus",
      error: "disputeEmailError",
      sentAt: "disputeEmailSentAt",
      provider: "disputeEmailProviderId",
    };
  }
  throw new GuardrailError("unsupported_outbox_kind", "The selected PAYG email kind is unsupported.");
}

async function assertPersistedDelivery(db, context, providerMessageId) {
  const outboxCollection = context.purchaseType === "membership" ?
    "membershipEmailOutbox" : "paygEmailOutbox";
  const ownerCollection = context.purchaseType === "membership" ?
    "memberships" : "paygOrders";
  const [outbox, owner] = await Promise.all([
    db.collection(outboxCollection).doc(context.outboxId).get(),
    db.collection(ownerCollection).doc(context.ownerId).get(),
  ]);
  guard(outbox.exists && owner.exists,
    "delivery_projection_missing",
    "The exact outbox or its owner disappeared after provider acceptance.");
  guard(outbox.get("status") === "sent" &&
    outbox.get("providerMessageId") === providerMessageId &&
    outbox.get("attemptCount") === 1 && outbox.get("sentAt") != null,
  "outbox_delivery_not_persisted",
  "The exact outbox did not persist its one-shot provider acceptance.");
  if (context.purchaseType === "membership") {
    guard(owner.get("confirmationEmailStatus") === "sent" &&
      owner.get("confirmationEmailProviderId") === providerMessageId &&
      owner.get("confirmationEmailSentAt") != null,
    "owner_delivery_not_persisted",
    "The membership did not persist its confirmation delivery projection.");
  } else {
    const projection = paygProjection(context.kind);
    guard(owner.get(projection.status) === "sent" &&
      owner.get(projection.provider) === providerMessageId &&
      owner.get(projection.sentAt) != null,
    "owner_delivery_not_persisted",
    "The PAYG order did not persist its exact lifecycle delivery projection.");
  }
  return true;
}

function renderedEmailsMatch(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function quarantineOneShotFailure(
  db,
  context,
  failure,
  acceptedProviderMessageId = null
) {
  const outboxCollection = context.purchaseType === "membership" ?
    "membershipEmailOutbox" : "paygEmailOutbox";
  const ownerCollection = context.purchaseType === "membership" ?
    "memberships" : "paygOrders";
  const outboxRef = db.collection(outboxCollection).doc(context.outboxId);
  const ownerRef = db.collection(ownerCollection).doc(context.ownerId);
  const FieldValue = admin.firestore.FieldValue;
  const safeReason = failure.ambiguous ?
    "One-shot provider acceptance is uncertain; automatic retry is disabled." :
    "The one-shot provider request was rejected; automatic retry is disabled.";
  await db.runTransaction(async (tx) => {
    const [outbox, owner] = await Promise.all([
      tx.get(outboxRef),
      tx.get(ownerRef),
    ]);
    guard(outbox.exists && owner.exists,
      "one_shot_quarantine_target_missing",
      "The exact one-shot outbox or owner disappeared during failure quarantine.");
    const terminal = outbox.get("status") === "manual_review" ||
      outbox.get("status") === "dead_letter";
    if (terminal && outbox.get("nextAttemptAt") == null) return;
    guard(["pending", "sending", "reconciling", "tombstoned"].includes(
      outbox.get("status")
    ) &&
      outbox.get("attemptCount") === 1 &&
      outbox.get("kind") === context.kind &&
      (outbox.get("providerMessageId") == null ||
        outbox.get("providerMessageId") === acceptedProviderMessageId),
    "one_shot_quarantine_state_changed",
    "The exact outbox changed before its one-shot failure could be quarantined.");
    tx.set(outboxRef, {
      status: "manual_review",
      oneShotDelivery: true,
      oneShotFailureAmbiguous: failure.ambiguous === true,
      oneShotProviderAcceptanceState: acceptedProviderMessageId ?
        "accepted_unpersisted" : failure.ambiguous ? "unknown" : "rejected",
      ...(acceptedProviderMessageId ? {
        providerMessageId: acceptedProviderMessageId,
      } : {}),
      lastError: safeReason,
      lastHttpStatus: failure.httpStatus ?? FieldValue.delete(),
      lastProviderErrorName: failure.providerErrorName ?? FieldValue.delete(),
      deadLetterReason: safeReason,
      deadLetteredAt: FieldValue.serverTimestamp(),
      leaseToken: FieldValue.delete(),
      leaseExpiresAt: FieldValue.delete(),
      nextAttemptAt: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    if (context.purchaseType === "membership") {
      tx.set(ownerRef, {
        confirmationEmailStatus: "manual_review",
        confirmationEmailError: safeReason,
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
    } else {
      const projection = paygProjection(context.kind);
      tx.set(ownerRef, {
        [projection.status]: "manual_review",
        [projection.error]: safeReason,
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
    }
  });
  return true;
}

async function processExactOutbox(context, apiKey, expectedEmail, db) {
  let capturedFailure = null;
  let acceptedProviderMessageId = null;
  const exactSender = async (email, idempotencyKey) => {
    try {
      assertApprovedRenderedEmail(email);
      if (!renderedEmailsMatch(email, expectedEmail)) {
        throw new OneShotResendError(
          "rendered_email_changed",
          "The worker-rendered email changed after its read-only validation.",
          {ambiguous: false}
        );
      }
      acceptedProviderMessageId = await sendExactEmailViaResend(
        apiKey,
        email,
        idempotencyKey
      );
      return acceptedProviderMessageId;
    } catch (error) {
      capturedFailure = error instanceof OneShotResendError ? error :
        new OneShotResendError(
          "rendered_email_changed",
          "The worker-rendered email failed its approved pre-send validation.",
          {ambiguous: false}
        );
      throw capturedFailure;
    }
  };
  let state;
  let workerFailure = null;
  try {
    if (context.purchaseType === "membership") {
      const membership = require("../lib/membership");
      state = await membership.__testing.processMembershipConfirmationOutbox(
        context.outboxId,
        Date.now(),
        async (email, idempotencyKey) => ({
          providerMessageId: await exactSender(email, idempotencyKey),
        })
      );
    } else {
      const payg = require("../lib/payg");
      state = await payg.__testing.processPaygConfirmationOutbox(
        context.outboxId,
        Date.now(),
        exactSender
      );
    }
  } catch (error) {
    workerFailure = error;
  }
  if (capturedFailure || (acceptedProviderMessageId && state !== "sent")) {
    const failure = capturedFailure || new OneShotResendError(
      "provider_acceptance_persistence_failed",
      "Provider acceptance was not safely persisted; the outbox was quarantined from retry.",
      {ambiguous: true}
    );
    await quarantineOneShotFailure(
      db,
      context,
      failure,
      acceptedProviderMessageId
    );
    throw failure;
  }
  if (workerFailure) throw workerFailure;
  return state;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  assertLocalEnvironment();
  configureReadOnlyEnvironment();
  inspectResendKeyFile(args.resendKeyFile);
  guard(admin.apps.length === 0,
    "firebase_app_already_initialized",
    "The one-shot process must start without another Firebase app.");
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
      throw new GuardrailError(
        "stripe_test_key_unavailable",
        "A valid Stripe CLI test key is required."
      );
    }
    const context = await buildCorrelationContext(
      db,
      stripe,
      args.sessionId,
      outboxMatch,
      args.deliveryMode
    );
    assertWorkerBuildIsFresh(context.purchaseType);
    const expectedEmail = renderExactOutboxEmail(context);
    const result = await withProtectedResendKey(
      args.resendKeyFile,
      async (apiKey) => {
        let providerMessageId = context.providerMessageId;
        if (args.deliveryMode === "send") {
          const state = await processExactOutbox(
            context,
            apiKey,
            expectedEmail,
            db
          );
          guard(state === "sent",
            "outbox_send_not_completed",
            `The exact outbox finished in state ${state}; it was not retried.`);
          const postSend = await db.collection(
            context.purchaseType === "membership" ?
              "membershipEmailOutbox" : "paygEmailOutbox"
          ).doc(context.outboxId).get();
          providerMessageId = postSend.get("providerMessageId");
          guard(typeof providerMessageId === "string" &&
            /^[A-Za-z0-9_-]{8,256}$/.test(providerMessageId),
          "provider_acceptance_not_persisted",
          "The exact outbox has no persisted provider message identifier.");
        }
        guard(typeof providerMessageId === "string",
          "provider_acceptance_not_persisted",
          "The exact outbox has no persisted provider message identifier.");
        await assertPersistedDelivery(db, context, providerMessageId);
        const delivery = await waitForExactDelivery(
          apiKey,
          providerMessageId,
          expectedEmail
        );
        return {providerMessageId, delivery};
      }
    );
    process.stdout.write("STRIPE_TEST_EMAIL_DELIVERY " + JSON.stringify({
      status: "delivered",
      deliveryMode: args.deliveryMode,
      stripeMode: "test",
      checkoutSessionId: context.sessionId,
      outboxId: context.outboxId,
      outboxKind: context.kind,
      providerMessageId: result.providerMessageId,
      providerStatus: result.delivery.lastEvent,
      recipientVerified: true,
      senderVerified: true,
      outboxStatus: "sent",
      attemptCount: 1,
      resendNetworkCalled: true,
      resendPostCalled: args.deliveryMode === "send",
      outboxMutated: args.deliveryMode === "send",
      productionFirebaseWritePerformed: false,
    }) + "\n");
    return result;
  } finally {
    await app.delete();
  }
}

module.exports = {
  OneShotResendError,
  assertApprovedRenderedEmail,
  assertExactProviderRouting,
  assertPersistedDelivery,
  processExactOutbox,
  quarantineOneShotFailure,
  retrieveExactResendEmail,
  sendExactEmailViaResend,
  waitForExactDelivery,
  withProtectedResendKey,
};

if (require.main === module) {
  main().catch((error) => {
    const code = error instanceof GuardrailError ? error.code : "unexpected_failure";
    const message = error instanceof GuardrailError ? error.message :
      "The exact one-shot email delivery failed without exposing provider or customer data.";
    process.stderr.write("STRIPE_TEST_EMAIL_DELIVERY_FAILED " + JSON.stringify({
      status: "failed",
      code,
      message,
    }) + "\n");
    process.exitCode = 1;
  });
}
