/* eslint-disable max-len, require-jsdoc, @typescript-eslint/no-var-requires */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  OneShotResendError,
  assertApprovedRenderedEmail,
  quarantineOneShotFailure,
  retrieveExactResendEmail,
  sendExactEmailViaResend,
  waitForExactDelivery,
  withProtectedResendKey,
} = require("../scripts/deliverStripeTestOutboxOnce");

const RECIPIENT = "hello@thisisaevi.com";
const FROM = "Zero Alpha Fitness <hello@zeroalphafitness.co.uk>";
const REPLY_TO = "support@zeroalphafitness.co.uk";
const MESSAGE_ID = "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794";

function renderedEmail(overrides = {}) {
  return {
    from: FROM,
    to: [RECIPIENT],
    reply_to: REPLY_TO,
    subject: "Synthetic Stripe test confirmation",
    text: "Synthetic test content",
    html: "<p>Synthetic test content</p>",
    ...overrides,
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function readbackBody(lastEvent = "delivered", overrides = {}) {
  return {
    id: MESSAGE_ID,
    last_event: lastEvent,
    from: FROM,
    to: [RECIPIENT],
    reply_to: [REPLY_TO],
    cc: [],
    bcc: [],
    subject: renderedEmail().subject,
    ...overrides,
  };
}

test("rendered email permits only the approved sender, recipient and reply-to", () => {
  assert.equal(assertApprovedRenderedEmail(renderedEmail()), true);
  assert.throws(() => assertApprovedRenderedEmail(renderedEmail({
    to: ["somebody@example.test"],
  })), {code: "rendered_recipient_not_approved"});
  assert.throws(() => assertApprovedRenderedEmail(renderedEmail({
    cc: [RECIPIENT],
  })), {code: "rendered_extra_field"});
  assert.throws(() => assertApprovedRenderedEmail(renderedEmail({
    from: "Other Sender <hello@zeroalphafitness.co.uk>",
  })), {code: "rendered_sender_not_approved"});
});

test("one-shot send uses the exact Resend endpoint and idempotency key", async () => {
  const calls = [];
  const fetchImpl = async (...args) => {
    calls.push(args);
    return jsonResponse(200, {id: MESSAGE_ID});
  };
  const providerMessageId = await sendExactEmailViaResend(
    `re_${"x".repeat(40)}`,
    renderedEmail(),
    "membership-confirmation/sub_exact/v1",
    fetchImpl
  );
  assert.equal(providerMessageId, MESSAGE_ID);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "https://api.resend.com/emails");
  assert.equal(calls[0][1].method, "POST");
  assert.equal(
    calls[0][1].headers["Idempotency-Key"],
    "membership-confirmation/sub_exact/v1"
  );
  assert.deepEqual(JSON.parse(calls[0][1].body), renderedEmail());
});

test("provider errors are replaced with bounded non-customer diagnostics", async () => {
  const fetchImpl = async () => jsonResponse(422, {
    name: "invalid_from_address",
    message: "sensitive provider response somebody@example.test",
  });
  await assert.rejects(() => sendExactEmailViaResend(
    `re_${"x".repeat(40)}`,
    renderedEmail(),
    "membership-confirmation/sub_exact/v1",
    fetchImpl
  ), (error) => {
    assert.equal(error.code, "resend_send_rejected");
    assert.equal(error.httpStatus, 422);
    assert.equal(error.providerErrorName, "invalid_from_address");
    assert.equal(error.ambiguous, false);
    assert.doesNotMatch(error.message, /somebody|example\.test/);
    return true;
  });
});

test("ambiguous Resend responses retain classification without exposing content", async () => {
  await assert.rejects(() => sendExactEmailViaResend(
    `re_${"x".repeat(40)}`,
    renderedEmail(),
    "membership-confirmation/sub_exact/v1",
    async () => {
      throw new Error("network failure containing somebody@example.test");
    }
  ), (error) => {
    assert.equal(error.code, "resend_send_unconfirmed");
    assert.equal(error.httpStatus, null);
    assert.equal(error.ambiguous, true);
    assert.doesNotMatch(error.message, /somebody|example\.test/);
    return true;
  });

  await assert.rejects(() => sendExactEmailViaResend(
    `re_${"x".repeat(40)}`,
    renderedEmail(),
    "membership-confirmation/sub_exact/v1",
    async () => jsonResponse(409, {name: "concurrent_idempotent_requests"})
  ), (error) => {
    assert.equal(error.httpStatus, 409);
    assert.equal(error.providerErrorName, "concurrent_idempotent_requests");
    assert.equal(error.ambiguous, true);
    return true;
  });
});

test("exact Resend readback returns only message id and last event", async () => {
  const fetchImpl = async (url, options) => {
    assert.equal(url, `https://api.resend.com/emails/${MESSAGE_ID}`);
    assert.equal(options.method, "GET");
    return jsonResponse(200, readbackBody());
  };
  assert.deepEqual(
    await retrieveExactResendEmail(
      `re_${"x".repeat(40)}`,
      MESSAGE_ID,
      renderedEmail(),
      fetchImpl
    ),
    {providerMessageId: MESSAGE_ID, lastEvent: "delivered"}
  );
});

test("exact Resend readback rejects provider-side routing drift", async () => {
  await assert.rejects(() => retrieveExactResendEmail(
    `re_${"x".repeat(40)}`,
    MESSAGE_ID,
    renderedEmail(),
    async () => jsonResponse(200, readbackBody("delivered", {
      to: ["somebody@example.test"],
    }))
  ), {code: "resend_readback_routing_mismatch"});
});

test("delivery polling is bounded and stops on delivered or terminal failure", async () => {
  const events = ["sent", "delivery_delayed", "delivered"];
  let nowMillis = 0;
  const delivered = await waitForExactDelivery(
    `re_${"x".repeat(40)}`,
    MESSAGE_ID,
    renderedEmail(),
    {
      fetchImpl: async () => jsonResponse(200, readbackBody(events.shift())),
      now: () => nowMillis,
      wait: async (milliseconds) => {
        nowMillis += milliseconds;
      },
      timeoutMs: 20_000,
      pollMs: 1_000,
    }
  );
  assert.equal(delivered.lastEvent, "delivered");

  await assert.rejects(() => waitForExactDelivery(
    `re_${"x".repeat(40)}`,
    MESSAGE_ID,
    renderedEmail(),
    {
      fetchImpl: async () => jsonResponse(200, readbackBody("bounced")),
      now: () => 0,
      wait: async () => true,
    }
  ), {code: "resend_delivery_failed"});
});

test("opened and clicked prove delivery while canceled and suppressed fail terminally", async () => {
  for (const event of ["opened", "clicked"]) {
    const result = await waitForExactDelivery(
      `re_${"x".repeat(40)}`,
      MESSAGE_ID,
      renderedEmail(),
      {fetchImpl: async () => jsonResponse(200, readbackBody(event))}
    );
    assert.equal(result.lastEvent, event);
  }
  for (const event of ["canceled", "suppressed"]) {
    await assert.rejects(() => waitForExactDelivery(
      `re_${"x".repeat(40)}`,
      MESSAGE_ID,
      renderedEmail(),
      {fetchImpl: async () => jsonResponse(200, readbackBody(event))}
    ), {code: "resend_delivery_failed"});
  }
});

test("one-shot failures are quarantined without a due retry", async () => {
  const data = new Map([
    ["membershipEmailOutbox/sub_exact", {
      status: "pending",
      attemptCount: 1,
      kind: "membership_confirmation",
    }],
    ["memberships/sub_exact", {confirmationEmailStatus: "pending"}],
  ]);
  const writes = [];
  const db = {
    collection: (collection) => ({
      doc: (id) => ({key: `${collection}/${id}`}),
    }),
    runTransaction: async (operation) => operation({
      get: async (ref) => ({
        exists: data.has(ref.key),
        get: (field) => data.get(ref.key)?.[field],
      }),
      set: (ref, value) => writes.push({key: ref.key, value}),
    }),
  };
  const failure = new OneShotResendError(
    "resend_send_unconfirmed",
    "safe",
    {httpStatus: null, ambiguous: true}
  );
  await quarantineOneShotFailure(db, {
    purchaseType: "membership",
    kind: "membership_confirmation",
    outboxId: "sub_exact",
    ownerId: "sub_exact",
  }, failure);
  const outboxWrite = writes.find(({key}) => key ===
    "membershipEmailOutbox/sub_exact").value;
  const ownerWrite = writes.find(({key}) => key === "memberships/sub_exact").value;
  assert.equal(outboxWrite.status, "manual_review");
  assert.equal(outboxWrite.oneShotFailureAmbiguous, true);
  assert.equal(outboxWrite.oneShotProviderAcceptanceState, "unknown");
  assert.equal(Object.hasOwn(outboxWrite, "nextAttemptAt"), true);
  assert.equal(ownerWrite.confirmationEmailStatus, "manual_review");
  assert.doesNotMatch(JSON.stringify(writes), /somebody|example\.test/);
});

test("protected key use requires mode 0600 and does not return the key", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "alphawod-resend-send-"));
  const keyFile = path.join(directory, "resend.key");
  const key = `re_${"x".repeat(40)}`;
  try {
    fs.writeFileSync(keyFile, `${key}\n`, {mode: 0o600});
    fs.chmodSync(keyFile, 0o600);
    const result = await withProtectedResendKey(keyFile, async (value) => {
      assert.equal(value, key);
      return {used: true};
    });
    assert.deepEqual(result, {used: true});
    assert.doesNotMatch(JSON.stringify(result), /re_[A-Za-z0-9_-]+/);
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
});

test("one-shot source has no list, latest, batch, recipient override or production project", () => {
  const source = fs.readFileSync(path.resolve(
    __dirname,
    "../scripts/deliverStripeTestOutboxOnce.js"
  ), "utf8");
  assert.doesNotMatch(source, /\.where\s*\(|checkout\.sessions\.list/);
  assert.doesNotMatch(source, /--(?:recipient|latest|limit)=/i);
  assert.doesNotMatch(source, /alphawod-d1f2f/);
  assert.match(source, /demo-alphawod-stripe/);
  assert.match(source, /args\.deliveryMode === "send"/);
  assert.match(source, /resendPostCalled: args\.deliveryMode === "send"/);
});
