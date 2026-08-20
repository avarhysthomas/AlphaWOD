/* eslint-disable @typescript-eslint/no-var-requires */

const assert = require("node:assert/strict");
const {createHash} = require("node:crypto");
const test = require("node:test");

const {
  __testing: membershipTesting,
  buildClaimMembership,
  buildCreateMembershipCheckoutSession,
  buildLinkMembershipParticipant,
} = require("../lib/membership");
const {
  CHECKOUT_DOCUMENT_CONTENT_BUDGET_BYTES,
  CHECKOUT_DOCUMENTS,
  COMPANY,
  POLICY_TEXT,
} = require("../lib/membershipPlans");

const ENVIRONMENT_KEYS = [
  "FIREBASE_AUTH_EMULATOR_HOST",
  "FIREBASE_CONFIG",
  "FIRESTORE_EMULATOR_HOST",
  "FUNCTIONS_EMULATOR",
  "GCLOUD_PROJECT",
  "GOOGLE_CLOUD_PROJECT",
  "MEMBERSHIP_CHECKOUT_APP_ID",
  "MEMBERSHIP_FIREBASE_PROJECT_ID",
  "STRIPE_EXPECTED_MODE",
  "STRIPE_SECRET_KEY",
];

/**
 * Captures only the environment variables these boundary tests mutate.
 * @return {Object<string, (string|undefined)>} Captured environment values.
 */
function preserveEnvironment() {
  return Object.fromEntries(
    ENVIRONMENT_KEYS.map((key) => [key, process.env[key]])
  );
}

/**
 * Restores the environment variables captured before a boundary test.
 * @param {Object<string, (string|undefined)>} original Captured values.
 * @return {void}
 */
function restoreEnvironment(original) {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

/**
 * Temporarily replaces the checked-in legal-review placeholders with a fully
 * valid publication fixture, then restores the shared catalogue objects.
 * @param {Function} run Assertions to run against the fixture.
 * @return {void}
 */
function withPublicationReadyCheckoutModel(run) {
  const company = {...COMPANY};
  const policy = {...POLICY_TEXT};
  const documents = Object.fromEntries(
    Object.entries(CHECKOUT_DOCUMENTS).map(([key, document]) => [
      key,
      {...document},
    ])
  );
  try {
    COMPANY.registeredOffice = "Unit 3, Felinfoel Business Hub, Llanelli";
    COMPANY.registrationJurisdiction = "England and Wales";
    for (const [key, document] of Object.entries(CHECKOUT_DOCUMENTS)) {
      const version = `ZAF-${key.toUpperCase()}-2026-09-01-01`;
      const content = `Approved immutable legal copy for ${key}.\n`;
      Object.assign(document, {
        version,
        effectiveDate: "2026-09-01",
        publicUrl: `/legal/memberships/${version}.txt`,
        content,
        sha256: createHash("sha256").update(content).digest("hex"),
      });
    }
    run();
  } finally {
    Object.assign(COMPANY, company);
    Object.assign(POLICY_TEXT, policy);
    for (const [key, document] of Object.entries(documents)) {
      Object.assign(CHECKOUT_DOCUMENTS[key], document);
    }
  }
}

test("publication-ready legal evidence fails closed on incomplete data", () => {
  withPublicationReadyCheckoutModel(() => {
    assert.doesNotThrow(() =>
      membershipTesting.assertCheckoutDocumentModel(true)
    );

    for (const field of Object.keys(COMPANY)) {
      const original = COMPANY[field];
      COMPANY[field] = "";
      assert.throws(
        () => membershipTesting.assertCheckoutDocumentModel(true),
        /company disclosures are not ready/i,
        field
      );
      COMPANY[field] = original;
    }

    const document = CHECKOUT_DOCUMENTS.membershipTerms;
    for (const [field, invalidValues] of [
      ["version", ["", "invalid version"]],
      ["effectiveDate", ["", "2026-02-30"]],
    ]) {
      const original = document[field];
      for (const invalid of invalidValues) {
        document[field] = invalid;
        assert.throws(
          () => membershipTesting.assertCheckoutDocumentModel(true),
          /not ready for publication/i,
          `${field}: ${invalid}`
        );
      }
      document[field] = original;
    }

    const originalContent = document.content;
    document.content = "";
    document.sha256 = createHash("sha256").update("").digest("hex");
    assert.throws(
      () => membershipTesting.assertCheckoutDocumentModel(true),
      /not ready for publication/i
    );
    document.content = originalContent;
    document.sha256 = createHash("sha256")
      .update(originalContent)
      .digest("hex");

    const originalConsent = POLICY_TEXT.coolingOffConsent;
    POLICY_TEXT.coolingOffConsent = "";
    assert.throws(
      () => membershipTesting.assertCheckoutDocumentModel(true),
      /statement is incomplete/i
    );
    POLICY_TEXT.coolingOffConsent = originalConsent;

    const oversized = "x".repeat(
      CHECKOUT_DOCUMENT_CONTENT_BUDGET_BYTES + 1
    );
    document.content = oversized;
    document.sha256 = createHash("sha256").update(oversized).digest("hex");
    assert.throws(
      () => membershipTesting.assertCheckoutDocumentModel(true),
      /byte budget/i
    );
  });
});

test("live Stripe mode is rejected by every Functions emulator process", () => {
  const original = preserveEnvironment();
  try {
    process.env.GCLOUD_PROJECT = "alpha-wod-functions-test";
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.FIREBASE_CONFIG;
    process.env.MEMBERSHIP_FIREBASE_PROJECT_ID = "alpha-wod-functions-test";
    process.env.STRIPE_EXPECTED_MODE = "live";
    process.env.STRIPE_SECRET_KEY = "rk_live_restricted_fake";
    delete process.env.FUNCTIONS_EMULATOR;
    delete process.env.FIRESTORE_EMULATOR_HOST;
    delete process.env.FIREBASE_AUTH_EMULATOR_HOST;

    assert.equal(
      membershipTesting.assertBillingEnvironment().stripeMode,
      "live"
    );

    process.env.FUNCTIONS_EMULATOR = "true";
    assert.throws(
      () => membershipTesting.assertBillingEnvironment(),
      /live mode is forbidden in every Firebase emulator process/i
    );
  } finally {
    restoreEnvironment(original);
  }
});

test("secrets are omitted only for the exact isolated demo emulator", () => {
  const original = preserveEnvironment();
  const marker = {name: "sentinel-secret"};
  try {
    process.env.FUNCTIONS_EMULATOR = "true";
    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
    process.env.FIREBASE_AUTH_EMULATOR_HOST = "localhost:9099";
    process.env.GCLOUD_PROJECT = "demo-alphawod-stripe";
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.FIREBASE_CONFIG;

    assert.deepEqual(membershipTesting.secretsForRuntime([marker]), []);

    process.env.GCLOUD_PROJECT = "alphawod-d1f2f";
    assert.deepEqual(membershipTesting.secretsForRuntime([marker]), [marker]);

    process.env.GCLOUD_PROJECT = "demo-alphawod-stripe";
    delete process.env.FUNCTIONS_EMULATOR;
    assert.deepEqual(membershipTesting.secretsForRuntime([marker]), [marker]);

    process.env.FUNCTIONS_EMULATOR = "true";
    process.env.FIREBASE_AUTH_EMULATOR_HOST = "auth.example.test:9099";
    assert.deepEqual(membershipTesting.secretsForRuntime([marker]), [marker]);
  } finally {
    restoreEnvironment(original);
  }
});

test(
  "eligibility-aware callables reserve timeout headroom after contention",
  () => {
    const converge = async () => undefined;
    const callables = [
      buildCreateMembershipCheckoutSession(converge),
      buildClaimMembership(converge),
      buildLinkMembershipParticipant(async () => undefined, converge),
    ];

    for (const callable of callables) {
      assert.equal(callable.__endpoint.timeoutSeconds, 540);
    }
  }
);

test(
  "checkout App Check accepts only a fresh token from the configured web app",
  () => {
    const expectedAppId = "1:123456789:web:abcdef123456";
    assert.doesNotThrow(() => membershipTesting.assertCheckoutAppCheck({
      app: {appId: expectedAppId, alreadyConsumed: false},
    }, true, expectedAppId));

    const originalWarn = console.warn;
    console.warn = () => undefined;
    try {
      for (const request of [
        {},
        {app: {appId: "1:987654321:web:anotherapp", alreadyConsumed: false}},
        {app: {appId: expectedAppId, alreadyConsumed: true}},
      ]) {
        assert.throws(
          () => membershipTesting.assertCheckoutAppCheck(
            request,
            true,
            expectedAppId
          ),
          (error) => error.code === "permission-denied"
        );
      }
    } finally {
      console.warn = originalWarn;
    }
  }
);

test(
  "checkout rejects consumed App Check before consulting the purchase gate",
  async () => {
    const original = preserveEnvironment();
    const originalWarn = console.warn;
    let purchaseGateCalled = false;
    try {
      process.env.MEMBERSHIP_CHECKOUT_APP_ID = "1:123456789:web:abcdef123456";
      console.warn = () => undefined;
      const handler = membershipTesting.buildCreateMembershipCheckoutHandler(
        () => {
          purchaseGateCalled = true;
        },
        true
      );
      await assert.rejects(
        () => handler({
          app: {
            appId: process.env.MEMBERSHIP_CHECKOUT_APP_ID,
            alreadyConsumed: true,
          },
        }),
        (error) => error.code === "permission-denied"
      );
      assert.equal(purchaseGateCalled, false);
    } finally {
      console.warn = originalWarn;
      restoreEnvironment(original);
    }
  }
);
