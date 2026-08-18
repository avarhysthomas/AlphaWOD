/* eslint-disable
  require-jsdoc,
  valid-jsdoc,
  max-len,
  @typescript-eslint/no-explicit-any
*/

/**
 * Phase 1: public membership purchase, Stripe Billing, and the membership
 * state that drives AlphaWOD entitlement.
 *
 * Design rules carried over from Phase 0 and the approved policy documents:
 *
 * - Firestore documents, never client input and never ID-token claims, are
 *   authoritative for access. Every entitlement change here goes through the
 *   same `resolveUserAuthorisation` derivation the rest of the app uses.
 * - Stripe is the authority for subscription state. Webhook payloads are
 *   treated only as a signal to re-read the subscription, so an out-of-order
 *   delivery can never install stale access.
 * - The browser never computes a chargeable amount or a billing date. Stripe
 *   calculates the proration; the server calculates every cancellation date.
 * - Participant and guardian details are written by the server only and are
 *   never exposed to client rules.
 */

import {onCall, onRequest, HttpsError} from "firebase-functions/v2/https";
import {defineSecret, defineString} from "firebase-functions/params";
import * as admin from "firebase-admin";
import {createHash} from "crypto";
import Stripe from "stripe";
import {
  BILLING_POLICY,
  CHECKOUT_DOCUMENTS,
  COMPANY,
  formatBillingDate,
  formatPence,
  formatUnixBillingDate,
  CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION,
  MEMBERSHIP_SCHEMA_VERSION,
  MembershipState,
  PLAN_KEYS,
  PlanKey,
  POLICY_TEXT,
  getPlan,
  isAgeEligibleForPlan,
  isMembershipStateBlockingDuplicate,
  isPlanKey,
  resolveAgeFromDateOfBirth,
  resolveBillingCycleAnchor,
  resolveCancellationOutcome,
  resolveCheckoutSessionExpiry,
  resolveCoolingOffEnd,
  resolveEntitlementForMembership,
  resolveMembershipState,
} from "./membershipPlans";
import {
  ACCESS_SCHEMA_VERSION,
  EntitlementSource,
  EntitlementStatus,
  isApprovalStatus,
  isEntitlementCompatibleWithRole,
  isUserRole,
  resolveUserAuthorisation,
} from "./authz";

const REGION = "europe-west1";

/**
 * Region is set explicitly on every definition rather than relying on the
 * global option in index.ts, because module import order decides whether that
 * global has been applied when these definitions are evaluated.
 */
const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");
const resendApiKey = defineSecret("RESEND_API_KEY");
const membershipFromEmail = defineString("MEMBERSHIP_FROM_EMAIL", {
  default: COMPANY.confirmationSender,
});

const appPublicOrigin = defineString("APP_PUBLIC_ORIGIN", {
  default: "https://alpha-wod.vercel.app",
});
const stripePortalConfigurationId = defineString("STRIPE_PORTAL_CONFIGURATION_ID", {
  default: "",
});
const membershipPurchaseEnabled = defineString("MEMBERSHIP_PURCHASE_ENABLED", {
  default: "false",
});

const priceParams: Record<PlanKey, ReturnType<typeof defineString>> = {
  adult_unlimited: defineString("STRIPE_PRICE_ADULT_UNLIMITED", {default: ""}),
  adult_ladies: defineString("STRIPE_PRICE_ADULT_LADIES", {default: ""}),
  adult_gym: defineString("STRIPE_PRICE_ADULT_GYM", {default: ""}),
  youth_youngstars: defineString("STRIPE_PRICE_YOUTH_YOUNGSTARS", {default: ""}),
  youth_teenstars: defineString("STRIPE_PRICE_YOUTH_TEENSTARS", {default: ""}),
};

export const MEMBERSHIP_SECRETS = [stripeSecretKey];
export const MEMBERSHIP_WEBHOOK_SECRETS = [
  stripeSecretKey,
  stripeWebhookSecret,
  resendApiKey,
];

/**
 * Firestore and Stripe clients are resolved lazily. `admin.initializeApp()`
 * runs in the body of index.ts, which executes after this module is imported.
 */
function db(): admin.firestore.Firestore {
  return admin.firestore();
}

let stripeClient: Stripe | null = null;

/**
 * Optional API host override.
 *
 * Stripe documents host/port/protocol so an integration suite can run against
 * a local mock instead of the live API. It is read from the environment and is
 * never set in a deployed environment, so production always talks to Stripe.
 */
function stripeHostOptions(): Partial<Stripe.StripeConfig> {
  const host = process.env.STRIPE_API_HOST;
  if (!host) return {};

  return {
    host,
    port: Number(process.env.STRIPE_API_PORT || 12111),
    protocol: (process.env.STRIPE_API_PROTOCOL as "http" | "https") || "http",
  };
}

function stripe(): Stripe {
  const key = stripeSecretKey.value();
  if (!key) {
    throw new HttpsError("failed-precondition", "Billing is not configured.");
  }
  if (!stripeClient) {
    stripeClient = new Stripe(key, {
      maxNetworkRetries: 2,
      timeout: 20000,
      ...stripeHostOptions(),
    });
  }
  return stripeClient;
}

const serverTimestamp = () => admin.firestore.FieldValue.serverTimestamp();

/** ---------------------------------------------------------------
 * Stored document shapes (all server-owned)
 * -------------------------------------------------------------- */

type ParticipantRecord = {
  fullName: string;
  dateOfBirth: string;
  age: number;
  isPayer: boolean;
  /** Stable, non-reversible identity used for the duplicate-membership guard. */
  participantKey: string;
};

type GuardianRecord = {
  fullName: string;
  relationship: string;
  confirmedAuthority: true;
};

type AcceptanceRecord = {
  signedName: string;
  documents: typeof CHECKOUT_DOCUMENTS;
  immediatePerformanceRequested: boolean;
  coolingOffEndsAt: string;
  acceptedAt: admin.firestore.FieldValue | admin.firestore.Timestamp;
  userAgent: string;
};

type MembershipIntentDoc = {
  schemaVersion: number;
  /** Null until the buyer claims the purchase with an account. */
  payerUid: string | null;
  payerEmail: string | null;
  planKey: PlanKey;
  participant: ParticipantRecord;
  guardian: GuardianRecord | null;
  acceptances: AcceptanceRecord;
  checkoutSessionId: string;
  status: "created" | "fulfilled" | "expired";
  billingCycleAnchor: number;
  createdAt: admin.firestore.FieldValue | admin.firestore.Timestamp;
};

type MembershipDoc = {
  schemaVersion: number;
  subscriptionId: string;
  stripeCustomerId: string;
  checkoutSessionId: string;
  /**
   * The account that owns this membership, or null while it is unclaimed.
   * A membership is bought before an account exists, so this is populated by
   * `claimMembership` rather than at fulfilment.
   */
  payerUid: string | null;
  /** Billing email Stripe collected. The identity a claim is matched against. */
  payerEmail: string | null;
  fulfilledAt: admin.firestore.FieldValue | admin.firestore.Timestamp | null;
  claimedAt: admin.firestore.FieldValue | admin.firestore.Timestamp | null;
  planKey: PlanKey;
  planName: string;
  grantsAlphaWodAccess: boolean;
  participant: ParticipantRecord;
  guardian: GuardianRecord | null;
  acceptances: AcceptanceRecord;
  state: MembershipState;
  stripeStatus: string;
  entitlementTargetUid: string | null;
  /**
   * Entitlement the target held before this membership first granted access.
   * Restored on revocation so a grandfathered legacy member is never demoted
   * to no access by cancelling a later paid membership.
   */
  preMembershipEntitlement: {
    entitlementStatus: EntitlementStatus;
    entitlementSource: EntitlementSource;
  } | null;
  currentPeriodEnd: number | null;
  billingCycleAnchor: number;
  pastDueSince: number | null;
  disputeOpen: boolean;
  accessRevoked: boolean;
  cancelAt: number | null;
  cancellationRequestedAt: admin.firestore.Timestamp | admin.firestore.FieldValue | null;
  cancellationOutcome: ReturnType<typeof resolveCancellationOutcome> | null;
  createdAt: admin.firestore.FieldValue | admin.firestore.Timestamp;
  updatedAt: admin.firestore.FieldValue | admin.firestore.Timestamp;
};

/** ---------------------------------------------------------------
 * Input validation
 * -------------------------------------------------------------- */

function requireAuthUid(request: any): string {
  if (!request.auth) throw new HttpsError("unauthenticated", "Login required.");
  return request.auth.uid as string;
}

/** Uid when the caller happens to be signed in, null for a public visitor. */
function optionalAuthUid(request: any): string | null {
  return request.auth ? (request.auth.uid as string) : null;
}

function requireBoundedString(value: unknown, field: string, min: number, max: number): string {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (text.length < min || text.length > max) {
    throw new HttpsError(
      "invalid-argument",
      `${field} must be between ${min} and ${max} characters.`
    );
  }
  return text;
}

function optionalBoundedText(
  value: unknown,
  min: number,
  max: number
): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length >= min && text.length <= max ? text : null;
}

function requirePlanKey(value: unknown): PlanKey {
  if (!isPlanKey(value)) {
    throw new HttpsError("invalid-argument", "Unknown membership plan.");
  }
  return value;
}

function participantKeyFor(fullName: string, dateOfBirth: string): string {
  return createHash("sha256")
    .update(`${fullName.trim().toLowerCase()}|${dateOfBirth}`)
    .digest("hex");
}

/**
 * Only the approved public origin is accepted for Stripe return URLs. An
 * attacker-supplied origin would otherwise turn checkout completion into an
 * open redirect carrying a session id.
 */
function resolveReturnOrigin(): string {
  const configured = appPublicOrigin.value().trim();
  try {
    return new URL(configured).origin;
  } catch {
    throw new HttpsError("failed-precondition", "The public app origin is misconfigured.");
  }
}

/**
 * Price IDs from the 17 August 2026 catalogue export, which is a Stripe
 * **test mode** export. Products, prices, portal configurations and webhook
 * secrets are all mode-specific, so these can never be correct in live mode.
 */
const KNOWN_TEST_PRICE_IDS = new Set([
  "price_1U5KgYFzNDZoGGA0jGftxyZH",
  "price_1U5KjOFzNDZoGGA0j3qcds5p",
  "price_1U5Kk9FzNDZoGGA0dQ61G49d",
  "price_1U5KoQFzNDZoGGA0s4t806bH",
  "price_1U5Kt8FzNDZoGGA0ogq41DEw",
]);

function resolvePriceId(planKey: PlanKey): string {
  const priceId = priceParams[planKey].value().trim();
  if (!priceId) {
    throw new HttpsError(
      "failed-precondition",
      `No Stripe price is configured for ${planKey}.`
    );
  }

  // Stripe would reject this anyway, but only once a real customer was part
  // way through checkout. Failing here makes the misconfiguration obvious
  // before anyone is asked to pay.
  if (stripeSecretKey.value().startsWith("sk_live_") &&
    KNOWN_TEST_PRICE_IDS.has(priceId)) {
    throw new HttpsError(
      "failed-precondition",
      `${planKey} is still pointing at a Stripe test-mode price. Create the live ` +
      "catalogue and set the live price IDs before taking payments."
    );
  }

  return priceId;
}

/**
 * The purchase flow stays closed until the checkout documents are approved for
 * publication *and* the deployment explicitly enables purchasing. Both gates
 * are required: Phase 0 recorded that no legal document version has been
 * signed off, and an unapproved version must never reach a paying customer.
 */
function requirePurchaseFlowOpen(): void {
  if (!CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION) {
    throw new HttpsError(
      "failed-precondition",
      "Membership purchase is not open yet: the checkout documents are still in legal review."
    );
  }
  if (membershipPurchaseEnabled.value().trim().toLowerCase() !== "true") {
    throw new HttpsError(
      "failed-precondition",
      "Membership purchase is not enabled for this environment."
    );
  }
}

/** ---------------------------------------------------------------
 * Customer and membership lookup
 * -------------------------------------------------------------- */

async function resolveStripeCustomerId(userId: string): Promise<string> {
  const userRef = db().collection("users").doc(userId);
  const snap = await userRef.get();
  if (!snap.exists) {
    throw new HttpsError("failed-precondition", "Create your profile before purchasing.");
  }

  const existing = snap.get("stripeCustomerId");
  if (typeof existing === "string" && existing) return existing;

  const authUser = await admin.auth().getUser(userId);
  const customer = await stripe().customers.create(
    {
      email: authUser.email?.trim().toLowerCase() || undefined,
      name: (snap.get("name") as string | undefined) || authUser.displayName || undefined,
      metadata: {firebaseUid: userId},
    },
    // Retrying a create with the same key returns the original customer rather
    // than duplicating one if this call is replayed.
    {idempotencyKey: `customer:${userId}`}
  );

  await userRef.set(
    {stripeCustomerId: customer.id, updatedAt: serverTimestamp()},
    {merge: true}
  );
  return customer.id;
}

/**
 * A purchase can be made before an account exists, so the participant identity
 * is the guard that always applies. The payer-level check only runs for a
 * signed-in buyer; for an anonymous one it is repeated at claim time, when the
 * account is finally known.
 */
async function findBlockingMemberships(
  payerUid: string | null,
  planKey: PlanKey,
  participantKey: string
): Promise<{sameParticipant: boolean; sameAlphaWodPayer: boolean}> {
  const [byParticipant, byPayer] = await Promise.all([
    db().collection("memberships").where("participant.participantKey", "==", participantKey).get(),
    payerUid ?
      db().collection("memberships").where("payerUid", "==", payerUid).get() :
      Promise.resolve({docs: []} as unknown as admin.firestore.QuerySnapshot),
  ]);

  const blocking = (snap: admin.firestore.QuerySnapshot) =>
    snap.docs.filter((doc) =>
      isMembershipStateBlockingDuplicate(doc.get("state") as MembershipState)
    );

  const sameParticipant = blocking(byParticipant).length > 0;
  const sameAlphaWodPayer = getPlan(planKey).grantsAlphaWodAccess &&
    blocking(byPayer).some((doc) => doc.get("grantsAlphaWodAccess") === true);

  return {sameParticipant, sameAlphaWodPayer};
}

/** ---------------------------------------------------------------
 * Entitlement application
 * -------------------------------------------------------------- */

async function writeAudit(entry: Record<string, unknown>): Promise<void> {
  await db().collection("membershipAudit").add({
    ...entry,
    createdAt: serverTimestamp(),
  });
}

/**
 * Applies a membership's entitlement decision to the target profile, then
 * converges derived markers and Auth claims through the caller-supplied
 * Phase 0 routine.
 *
 * Staff roles are deliberately untouched: admin and SGPT access is granted by
 * role with a `staff` source and must remain independent of any consumer
 * membership. A banned role is never granted anything.
 */
async function applyMembershipEntitlement(
  membershipRef: admin.firestore.DocumentReference,
  converge: (userId: string) => Promise<void>
): Promise<void> {
  const targetUid = await db().runTransaction(async (tx) => {
    const membershipSnap = await tx.get(membershipRef);
    if (!membershipSnap.exists) return null;

    const membership = membershipSnap.data() as MembershipDoc;
    const uid = membership.entitlementTargetUid;
    if (!uid) return null;

    const decision = resolveEntitlementForMembership(membership.planKey, membership.state);
    if (!decision) return null;

    const userRef = db().collection("users").doc(uid);
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) return null;

    const user = userSnap.data() as Record<string, unknown>;
    if (!isUserRole(user.role) || !isApprovalStatus(user.approvalStatus)) return null;
    if (user.role !== "user") return null;

    const current = resolveUserAuthorisation(user as any);
    let nextStatus: EntitlementStatus = decision.entitlementStatus;
    let nextSource: EntitlementSource = decision.entitlementSource;

    // Remember what the member held before a paid membership first moved them,
    // so cancelling a purchase restores a grandfathered grant instead of
    // removing access the purchase never created.
    const preMembership = membership.preMembershipEntitlement ?? {
      entitlementStatus: current.entitlementStatus,
      entitlementSource: current.entitlementSource,
    };

    if (nextStatus === "none" &&
      preMembership.entitlementStatus === "active" &&
      (preMembership.entitlementSource === "legacy" ||
        preMembership.entitlementSource === "manual")) {
      nextStatus = preMembership.entitlementStatus;
      nextSource = preMembership.entitlementSource;
    }

    if (!isEntitlementCompatibleWithRole(user.role, nextStatus, nextSource)) return null;

    // A purchase that grants app access also completes approval for that
    // account. This is the only non-admin approval path and it exists solely
    // on the server-side fulfilment route.
    const approvalStatus = nextStatus === "active" ? "approved" : user.approvalStatus;
    const next = {
      role: user.role,
      approvalStatus,
      entitlementStatus: nextStatus,
      entitlementSource: nextSource,
    };
    const access = resolveUserAuthorisation(next);

    tx.set(userRef, {
      ...next,
      alphaWodAccess: access.alphaWodAccess,
      accessSchemaVersion: ACCESS_SCHEMA_VERSION,
      entitlementPlanKey: membership.planKey,
      entitlementReason: decision.reason,
      entitlementUpdatedAt: serverTimestamp(),
      entitlementUpdatedBy: "stripe_membership",
      ...(approvalStatus === "approved" && user.approvalStatus !== "approved" ?
        {approvedAt: serverTimestamp(), approvedBy: "stripe_membership"} :
        {}),
      updatedAt: serverTimestamp(),
    }, {merge: true});

    tx.set(membershipRef, {
      preMembershipEntitlement: preMembership,
      updatedAt: serverTimestamp(),
    }, {merge: true});

    return uid;
  });

  if (targetUid) await converge(targetUid);
}

/** ---------------------------------------------------------------
 * Subscription convergence
 * -------------------------------------------------------------- */

function resolveCurrentPeriodEnd(subscription: Stripe.Subscription): number | null {
  // Recent Stripe API versions expose the period on the subscription item.
  const item = subscription.items?.data?.[0] as {current_period_end?: number} | undefined;
  if (typeof item?.current_period_end === "number") return item.current_period_end;

  const legacy = (subscription as unknown as {current_period_end?: unknown}).current_period_end;
  return typeof legacy === "number" ? legacy : null;
}

/**
 * Re-reads the subscription from Stripe and converges the stored membership.
 *
 * Webhook payloads are never trusted as the state authority: Stripe does not
 * guarantee delivery order, so a delayed `updated` event carrying an older
 * snapshot could otherwise restore access that has since been withdrawn.
 */
async function convergeMembershipFromStripe(
  subscriptionId: string,
  converge: (userId: string) => Promise<void>,
  overrides: Partial<Pick<MembershipDoc, "disputeOpen" | "accessRevoked" | "pastDueSince">> = {}
): Promise<void> {
  const membershipRef = db().collection("memberships").doc(subscriptionId);
  const snap = await membershipRef.get();
  if (!snap.exists) return;

  const subscription = await stripe().subscriptions.retrieve(subscriptionId);
  const stored = snap.data() as MembershipDoc;

  const disputeOpen = overrides.disputeOpen ?? stored.disputeOpen ?? false;
  const accessRevoked = overrides.accessRevoked ?? stored.accessRevoked ?? false;
  const pastDueSince = overrides.pastDueSince !== undefined ?
    overrides.pastDueSince :
    (subscription.status === "past_due" ? stored.pastDueSince : null);

  const state = resolveMembershipState({
    stripeStatus: subscription.status,
    pastDueSinceUnixSeconds: pastDueSince,
    disputeOpen,
    accessRevoked,
    cancelAtUnixSeconds: subscription.cancel_at,
  }, Date.now());

  await membershipRef.set({
    state,
    stripeStatus: subscription.status,
    currentPeriodEnd: resolveCurrentPeriodEnd(subscription),
    cancelAt: subscription.cancel_at ?? null,
    disputeOpen,
    accessRevoked,
    pastDueSince: pastDueSince ?? null,
    updatedAt: serverTimestamp(),
  }, {merge: true});

  await applyMembershipEntitlement(membershipRef, converge);
  await writeAudit({
    type: "membership_converged",
    subscriptionId,
    state,
    stripeStatus: subscription.status,
    disputeOpen,
    accessRevoked,
  });
}

/** ---------------------------------------------------------------
 * Callables
 * -------------------------------------------------------------- */

export const createMembershipCheckoutSession = onCall(
  {region: REGION, secrets: MEMBERSHIP_SECRETS},
  async (request) => {
    // Membership is bought before signing in. A visitor with no account can
    // complete checkout; the purchase is attached to an account afterwards by
    // `claimMembership`. A signed-in buyer is linked immediately instead.
    const payerUid = optionalAuthUid(request);
    requirePurchaseFlowOpen();

    const planKey = requirePlanKey(request.data?.planKey);
    const plan = getPlan(planKey);
    const participantName = requireBoundedString(
      request.data?.participantFullName, "participantFullName", 2, 160
    );
    const dateOfBirth = requireBoundedString(request.data?.participantDateOfBirth, "participantDateOfBirth", 10, 10);
    const signedName = requireBoundedString(request.data?.signedName, "signedName", 2, 160);
    const participantIsPayer = request.data?.participantIsPayer === true;
    const immediatePerformanceRequested = request.data?.immediatePerformanceRequested === true;

    const now = Date.now();
    const age = resolveAgeFromDateOfBirth(dateOfBirth, now);
    if (age === null) {
      throw new HttpsError("invalid-argument", "Enter a valid participant date of birth.");
    }
    if (!isAgeEligibleForPlan(plan, age)) {
      throw new HttpsError(
        "failed-precondition",
        `The participant's age (${age}) is not eligible for ${plan.name}.`
      );
    }

    // Guardian rules: for a youth plan the payer must be the guardian and can
    // never be the participant.
    let guardian: GuardianRecord | null = null;
    if (plan.audience === "youth") {
      if (participantIsPayer) {
        throw new HttpsError("failed-precondition", POLICY_TEXT.guardianRequirement);
      }
      guardian = {
        fullName: requireBoundedString(request.data?.guardianFullName, "guardianFullName", 2, 160),
        relationship: requireBoundedString(request.data?.guardianRelationship, "guardianRelationship", 2, 80),
        confirmedAuthority: true,
      };
      if (request.data?.guardianConfirmsAuthority !== true) {
        throw new HttpsError("failed-precondition", POLICY_TEXT.guardianRequirement);
      }
    }

    if (request.data?.acceptedDocuments !== true) {
      throw new HttpsError(
        "failed-precondition",
        "The membership terms, cancellation policy and privacy notice must be accepted."
      );
    }

    const participantKey = participantKeyFor(participantName, dateOfBirth);
    const blocking = await findBlockingMemberships(payerUid, planKey, participantKey);
    if (blocking.sameParticipant || blocking.sameAlphaWodPayer) {
      throw new HttpsError("already-exists", POLICY_TEXT.duplicateBlocked);
    }

    // Only a signed-in buyer gets a pre-resolved Stripe customer. For a public
    // visitor, Checkout creates the customer and collects the billing email,
    // which becomes the identity the later claim is matched against.
    const customerId = payerUid ? await resolveStripeCustomerId(payerUid) : null;
    const payerEmail = payerUid ?
      (await admin.auth().getUser(payerUid)).email?.trim().toLowerCase() || null :
      null;
    const {anchorUnixSeconds, firstFullChargeDate} = resolveBillingCycleAnchor(now);
    const origin = resolveReturnOrigin();
    const intentRef = db().collection("membershipIntents").doc();

    const participant: ParticipantRecord = {
      fullName: participantName,
      dateOfBirth,
      age,
      isPayer: participantIsPayer,
      participantKey,
    };

    const session = await stripe().checkout.sessions.create({
      mode: "subscription",
      ...(customerId ? {customer: customerId} : {}),
      ...(payerUid ? {client_reference_id: payerUid} : {}),
      line_items: [{price: resolvePriceId(planKey), quantity: 1}],
      // Dynamic payment methods are managed from the Stripe Dashboard, so
      // `payment_method_types` is deliberately omitted.
      billing_address_collection: BILLING_POLICY.collectBillingAddress ? "required" : "auto",
      phone_number_collection: {enabled: BILLING_POLICY.collectPhoneNumber},
      automatic_tax: {enabled: BILLING_POLICY.automaticTaxEnabled},
      submit_type: "subscribe",
      locale: "en-GB",
      expires_at: resolveCheckoutSessionExpiry(now),
      success_url: `${origin}/memberships/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/memberships?checkout=cancelled`,
      subscription_data: {
        description: plan.name,
        // Stripe calculates and displays the initial proration for the period
        // up to the anchor, and bills the full price on the first of each
        // month thereafter. No proration is computed in this codebase.
        billing_cycle_anchor: anchorUnixSeconds,
        proration_behavior: "create_prorations",
        metadata: {
          ...(payerUid ? {firebaseUid: payerUid} : {}),
          planKey,
          intentId: intentRef.id,
        },
      },
      metadata: {
        ...(payerUid ? {firebaseUid: payerUid} : {}),
        planKey,
        intentId: intentRef.id,
      },
    }, {idempotencyKey: `checkout:${intentRef.id}`});

    const intent: MembershipIntentDoc = {
      schemaVersion: MEMBERSHIP_SCHEMA_VERSION,
      payerUid,
      payerEmail,
      planKey,
      participant,
      guardian,
      acceptances: {
        signedName,
        documents: CHECKOUT_DOCUMENTS,
        immediatePerformanceRequested,
        coolingOffEndsAt: resolveCoolingOffEnd(now),
        acceptedAt: serverTimestamp(),
        userAgent: String(request.rawRequest.get("user-agent") || "").slice(0, 500),
      },
      checkoutSessionId: session.id,
      status: "created",
      billingCycleAnchor: anchorUnixSeconds,
      createdAt: serverTimestamp(),
    };
    await intentRef.set(intent);

    await writeAudit({
      type: "checkout_session_created",
      payerUid,
      planKey,
      intentId: intentRef.id,
      checkoutSessionId: session.id,
    });

    return {
      ok: true,
      sessionUrl: session.url,
      sessionId: session.id,
      firstFullChargeDate,
    };
  }
);

export const createCustomerPortalSession = onCall(
  {region: REGION, secrets: MEMBERSHIP_SECRETS},
  async (request) => {
    const userId = requireAuthUid(request);
    const userSnap = await db().collection("users").doc(userId).get();
    const customerId = userSnap.get("stripeCustomerId");
    if (typeof customerId !== "string" || !customerId) {
      throw new HttpsError("failed-precondition", "This account has no billing profile yet.");
    }

    const configuration = stripePortalConfigurationId.value().trim();
    if (!configuration) {
      // Without an explicit configuration Stripe falls back to the account
      // default, which has cancellation enabled. That would let a member
      // cancel without the 14-day notice rule being applied or the receipt
      // time being recorded, so an unconfigured portal is refused outright.
      throw new HttpsError("failed-precondition", "The billing portal is not configured.");
    }

    const session = await stripe().billingPortal.sessions.create({
      customer: customerId,
      configuration,
      return_url: `${resolveReturnOrigin()}/account/membership`,
    });

    return {ok: true, portalUrl: session.url};
  }
);

export const getMyMemberships = onCall({region: REGION}, async (request) => {
  const userId = requireAuthUid(request);
  const snap = await db().collection("memberships").where("payerUid", "==", userId).get();
  const preview = resolveCancellationOutcome(Date.now());

  const memberships = snap.docs.map((doc) => {
    const membership = doc.data() as MembershipDoc;
    return {
      subscriptionId: membership.subscriptionId,
      planKey: membership.planKey,
      planName: membership.planName,
      state: membership.state,
      grantsAlphaWodAccess: membership.grantsAlphaWodAccess,
      participantFullName: membership.participant?.fullName ?? "",
      participantIsPayer: membership.participant?.isPayer ?? false,
      currentPeriodEnd: membership.currentPeriodEnd ?? null,
      cancelAt: membership.cancelAt ?? null,
      cancellationOutcome: membership.cancellationOutcome ?? null,
    };
  });

  return {ok: true, memberships, cancellationPreview: preview};
});

export const requestMembershipCancellation = onCall(
  {region: REGION, secrets: MEMBERSHIP_SECRETS},
  async (request) => {
    const userId = requireAuthUid(request);
    const subscriptionId = requireBoundedString(request.data?.subscriptionId, "subscriptionId", 3, 255);

    const membershipRef = db().collection("memberships").doc(subscriptionId);
    const snap = await membershipRef.get();
    if (!snap.exists) throw new HttpsError("not-found", "Membership not found.");

    const membership = snap.data() as MembershipDoc;
    if (membership.payerUid !== userId) {
      throw new HttpsError("permission-denied", "Only the payer can cancel this membership.");
    }
    if (membership.cancelAt) {
      throw new HttpsError("failed-precondition", "This membership is already scheduled to end.");
    }
    if (!isMembershipStateBlockingDuplicate(membership.state)) {
      throw new HttpsError("failed-precondition", "This membership is not active.");
    }

    // The receipt time recorded here is when the request reached the system,
    // which is the time the policy makes decisive.
    const outcome = resolveCancellationOutcome(Date.now());

    await stripe().subscriptions.update(subscriptionId, {
      cancel_at: outcome.cancelAtUnixSeconds,
      proration_behavior: "none",
      metadata: {
        cancellationRequestedBy: userId,
        cancellationNoticeMet: String(outcome.noticeDeadlineMet),
      },
    }, {idempotencyKey: `cancel:${subscriptionId}:${outcome.cancelAtUnixSeconds}`});

    await membershipRef.set({
      cancelAt: outcome.cancelAtUnixSeconds,
      cancellationRequestedAt: serverTimestamp(),
      cancellationOutcome: outcome,
      updatedAt: serverTimestamp(),
    }, {merge: true});

    await writeAudit({
      type: "cancellation_requested",
      subscriptionId,
      payerUid: userId,
      outcome,
    });

    return {ok: true, outcome};
  }
);

/**
 * Window in which the checkout session id alone is accepted as proof of
 * purchase, for the buyer who creates their account straight after paying.
 */
const SESSION_CLAIM_WINDOW_MS = 24 * 60 * 60 * 1000;

function toMillis(
  value: admin.firestore.FieldValue | admin.firestore.Timestamp | null | undefined
): number | null {
  if (value instanceof admin.firestore.Timestamp) return value.toMillis();
  return null;
}

/**
 * Attaches a membership bought before sign-up to the account that now owns it.
 *
 * Two routes, deliberately different in what they demand:
 *
 * - By checkout session id: possession of the id is the evidence. It is only
 *   ever shown to the buyer, on the success page immediately after payment, so
 *   it is accepted without a verified email but only inside a 24 hour window
 *   and only once. This is the path a brand new account uses, because a fresh
 *   sign-up has not verified its email yet.
 * - By email: no window, but the account's email must be verified and must
 *   match the address Stripe billed. Without the verification requirement,
 *   anyone could register a victim's address and take their membership.
 *
 * The attach itself is transactional and asserts the membership is still
 * unclaimed, so two accounts racing on the same purchase cannot both win.
 */
export function buildClaimMembership(converge: (userId: string) => Promise<void>) {
  return onCall({region: REGION}, async (request) => {
    const userId = requireAuthUid(request);
    const sessionId = optionalBoundedText(request.data?.sessionId, 3, 255);

    const authUser = await admin.auth().getUser(userId);
    const email = authUser.email?.trim().toLowerCase() || null;

    const userRef = db().collection("users").doc(userId);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      throw new HttpsError(
        "failed-precondition",
        "Set up your member profile before claiming a purchase."
      );
    }

    const candidates = sessionId ?
      await db().collection("memberships")
        .where("checkoutSessionId", "==", sessionId).get() :
      await (email ?
        db().collection("memberships").where("payerEmail", "==", email).get() :
        Promise.resolve({docs: []} as unknown as admin.firestore.QuerySnapshot));

    const unclaimed = candidates.docs.filter((doc) => !doc.get("payerUid"));
    if (unclaimed.length === 0) {
      throw new HttpsError(
        "not-found",
        "No unclaimed membership was found for this account."
      );
    }

    const claimed: string[] = [];

    for (const candidate of unclaimed) {
      const membershipRef = candidate.ref;
      const payerEmail = candidate.get("payerEmail") as string | null;

      if (sessionId) {
        const fulfilledAt = toMillis(candidate.get("fulfilledAt"));
        if (fulfilledAt !== null && Date.now() - fulfilledAt > SESSION_CLAIM_WINDOW_MS) {
          throw new HttpsError(
            "deadline-exceeded",
            "This purchase link has expired. Sign in with the email you paid with to claim it."
          );
        }
      } else if (!authUser.emailVerified || !email || email !== payerEmail) {
        throw new HttpsError(
          "permission-denied",
          "Verify the email address you paid with before claiming this membership."
        );
      }

      const plan = getPlan(candidate.get("planKey") as PlanKey);

      // A claim must not hand one account a second app-access membership.
      if (plan.grantsAlphaWodAccess) {
        const existing = await db().collection("memberships")
          .where("payerUid", "==", userId).get();
        const duplicate = existing.docs.some((doc) =>
          doc.get("grantsAlphaWodAccess") === true &&
          isMembershipStateBlockingDuplicate(doc.get("state") as MembershipState)
        );
        if (duplicate) throw new HttpsError("already-exists", POLICY_TEXT.duplicateBlocked);
      }

      const attached = await db().runTransaction(async (tx) => {
        const fresh = await tx.get(membershipRef);
        if (!fresh.exists || fresh.get("payerUid")) return false;

        const participantIsPayer = fresh.get("participant.isPayer") === true;
        tx.set(membershipRef, {
          payerUid: userId,
          payerEmail: payerEmail ?? email,
          claimedAt: serverTimestamp(),
          claimedVia: sessionId ? "checkout_session" : "verified_email",
          ...(plan.grantsAlphaWodAccess && participantIsPayer ?
            {entitlementTargetUid: userId} :
            {}),
          updatedAt: serverTimestamp(),
        }, {merge: true});

        const customerId = fresh.get("stripeCustomerId");
        if (typeof customerId === "string" && customerId && !userSnap.get("stripeCustomerId")) {
          tx.set(userRef, {
            stripeCustomerId: customerId,
            updatedAt: serverTimestamp(),
          }, {merge: true});
        }
        return true;
      });

      if (!attached) continue;

      await applyMembershipEntitlement(membershipRef, converge);
      claimed.push(membershipRef.id);
      await writeAudit({
        type: "membership_claimed",
        subscriptionId: membershipRef.id,
        payerUid: userId,
        claimedVia: sessionId ? "checkout_session" : "verified_email",
      });
    }

    if (claimed.length === 0) {
      throw new HttpsError(
        "already-exists",
        "That membership has already been claimed by another account."
      );
    }

    return {ok: true, claimed};
  });
}

/** ---------------------------------------------------------------
 * Webhook
 * -------------------------------------------------------------- */

async function fulfilCheckoutSession(
  session: Stripe.Checkout.Session,
  converge: (userId: string) => Promise<void>
): Promise<void> {
  const intentId = session.metadata?.intentId;
  const subscriptionId = typeof session.subscription === "string" ?
    session.subscription :
    session.subscription?.id;

  if (!intentId || !subscriptionId) return;
  if (session.payment_status === "unpaid") return;

  const intentRef = db().collection("membershipIntents").doc(intentId);
  const intentSnap = await intentRef.get();
  if (!intentSnap.exists) return;

  const intent = intentSnap.data() as MembershipIntentDoc;
  const plan = getPlan(intent.planKey);
  const subscription = await stripe().subscriptions.retrieve(subscriptionId);
  const membershipRef = db().collection("memberships").doc(subscriptionId);

  const state = resolveMembershipState({
    stripeStatus: subscription.status,
    cancelAtUnixSeconds: subscription.cancel_at,
  }, Date.now());

  // Stripe collected the billing email during checkout. It is the identity a
  // later claim is matched against, so it takes precedence over anything the
  // intent captured before payment.
  const stripeEmail = session.customer_details?.email?.trim().toLowerCase() ||
    intent.payerEmail ||
    null;

  const membership: MembershipDoc = {
    schemaVersion: MEMBERSHIP_SCHEMA_VERSION,
    subscriptionId,
    stripeCustomerId: typeof session.customer === "string" ?
      session.customer :
      session.customer?.id ?? "",
    checkoutSessionId: session.id,
    payerUid: intent.payerUid,
    payerEmail: stripeEmail,
    fulfilledAt: serverTimestamp(),
    claimedAt: intent.payerUid ? serverTimestamp() : null,
    planKey: intent.planKey,
    planName: plan.name,
    grantsAlphaWodAccess: plan.grantsAlphaWodAccess,
    participant: intent.participant,
    guardian: intent.guardian,
    acceptances: intent.acceptances,
    state,
    stripeStatus: subscription.status,
    // Access is granted only to an account that bought this for itself. An
    // unclaimed purchase has no account yet, so the target stays null until
    // `claimMembership` attaches one. A purchase made for another person is
    // linked by an administrator instead.
    entitlementTargetUid: plan.grantsAlphaWodAccess && intent.participant.isPayer ?
      intent.payerUid :
      null,
    preMembershipEntitlement: null,
    currentPeriodEnd: resolveCurrentPeriodEnd(subscription),
    billingCycleAnchor: intent.billingCycleAnchor,
    pastDueSince: null,
    disputeOpen: false,
    accessRevoked: false,
    cancelAt: subscription.cancel_at ?? null,
    cancellationRequestedAt: null,
    cancellationOutcome: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  // `create` keeps a replayed webhook from overwriting a membership that has
  // since moved on; convergence below then reconciles it either way.
  try {
    await membershipRef.create(membership);
  } catch (error: any) {
    if (error?.code !== 6 && error?.code !== "already-exists") throw error;
  }

  await intentRef.set({status: "fulfilled", subscriptionId}, {merge: true});
  await applyMembershipEntitlement(membershipRef, converge);
  // Stripe's own total is authoritative for what was actually charged, so the
  // confirmation reports it rather than any figure computed here.
  await sendMembershipConfirmation(membershipRef, session.amount_total ?? null);
  await writeAudit({
    type: "checkout_fulfilled",
    subscriptionId,
    payerUid: intent.payerUid,
    planKey: intent.planKey,
    state,
  });
}

/**
 * Resolves the membership a charge belongs to.
 *
 * `Charge` no longer carries an `invoice` field, so the link runs through the
 * charge's PaymentIntent and the invoice payment recorded against it. If that
 * lookup yields nothing, the customer's own stored membership is used, which
 * is unambiguous because a duplicate active subscription is blocked at
 * purchase time.
 */
async function findMembershipIdForCharge(charge: Stripe.Charge): Promise<string | null> {
  const paymentIntentId = idOf(charge.payment_intent);

  if (paymentIntentId) {
    const payments = await stripe().invoicePayments.list({
      payment: {type: "payment_intent", payment_intent: paymentIntentId},
      limit: 10,
    });

    for (const payment of payments.data) {
      const invoiceId = idOf(payment.invoice);
      if (!invoiceId) continue;
      const invoice = await stripe().invoices.retrieve(invoiceId);
      const subscriptionId = resolveInvoiceSubscriptionId(invoice);
      if (subscriptionId) return subscriptionId;
    }
  }

  const customerId = idOf(charge.customer);
  if (!customerId) return null;

  const byCustomer = await db()
    .collection("memberships")
    .where("stripeCustomerId", "==", customerId)
    .get();
  const live = byCustomer.docs.filter((doc) =>
    isMembershipStateBlockingDuplicate(doc.get("state") as MembershipState)
  );

  return live.length === 1 ? live[0].id : null;
}

function idOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in (value as any)) {
    return String((value as any).id);
  }
  return null;
}

/**
 * Resolves the subscription an invoice belongs to.
 *
 * The current API exposes this on `invoice.parent.subscription_details`. The
 * line-item and legacy top-level paths are kept as fallbacks so an account
 * pinned to an older API version still resolves.
 */
function resolveInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const fromParent = idOf(invoice.parent?.subscription_details?.subscription);
  if (fromParent) return fromParent;

  for (const line of invoice.lines?.data ?? []) {
    const parent = (line as unknown as {
      parent?: {subscription_item_details?: {subscription?: unknown}};
    }).parent;
    const fromLine = idOf(parent?.subscription_item_details?.subscription);
    if (fromLine) return fromLine;
  }

  return idOf((invoice as unknown as {subscription?: unknown}).subscription);
}

/**
 * Stripe webhook endpoint.
 *
 * The signature is verified against the raw body before anything is read, and
 * every event is recorded in an idempotency ledger so a redelivery cannot
 * apply an access change twice.
 */
export function buildStripeWebhook(converge: (userId: string) => Promise<void>) {
  return onRequest(
    {region: REGION, secrets: MEMBERSHIP_WEBHOOK_SECRETS, cors: false},
    async (req, res) => {
      if (req.method !== "POST") {
        res.status(405).send("Method Not Allowed");
        return;
      }

      const signature = req.get("stripe-signature");
      const webhookSecret = stripeWebhookSecret.value();
      if (!signature || !webhookSecret) {
        res.status(400).send("Missing signature.");
        return;
      }

      let event: Stripe.Event;
      try {
        event = stripe().webhooks.constructEvent(req.rawBody, signature, webhookSecret);
      } catch (error) {
        console.error("Rejected Stripe webhook signature", error);
        res.status(400).send("Invalid signature.");
        return;
      }

      const ledgerRef = db().collection("stripeEvents").doc(event.id);
      try {
        await ledgerRef.create({
          type: event.type,
          receivedAt: serverTimestamp(),
          stripeCreated: event.created,
        });
      } catch (error: any) {
        if (error?.code === 6 || error?.code === "already-exists") {
          res.status(200).send("Already processed.");
          return;
        }
        throw error;
      }

      try {
        await handleStripeEvent(event, converge);
        await ledgerRef.set({status: "processed", processedAt: serverTimestamp()}, {merge: true});
        res.status(200).send("ok");
      } catch (error) {
        console.error("Stripe webhook handling failed", event.id, event.type, error);
        // The ledger entry is removed so Stripe's retry can reprocess the
        // event rather than being turned away by the idempotency guard.
        await ledgerRef.delete().catch(() => undefined);
        res.status(500).send("Handler error.");
      }
    }
  );
}

async function handleStripeEvent(
  event: Stripe.Event,
  converge: (userId: string) => Promise<void>
): Promise<void> {
  switch (event.type) {
  case "checkout.session.completed":
  case "checkout.session.async_payment_succeeded": {
    await fulfilCheckoutSession(event.data.object as Stripe.Checkout.Session, converge);
    return;
  }

  case "customer.subscription.created":
  case "customer.subscription.updated":
  case "customer.subscription.deleted":
  case "customer.subscription.paused":
  case "customer.subscription.resumed": {
    const subscription = event.data.object as Stripe.Subscription;
    await convergeMembershipFromStripe(subscription.id, converge);
    return;
  }

  case "invoice.paid": {
    const invoice = event.data.object as Stripe.Invoice;
    const subscriptionId = resolveInvoiceSubscriptionId(invoice);
    if (subscriptionId) {
      await convergeMembershipFromStripe(subscriptionId, converge, {pastDueSince: null});
    }
    return;
  }

  case "invoice.payment_failed": {
    const invoice = event.data.object as Stripe.Invoice;
    const subscriptionId = resolveInvoiceSubscriptionId(invoice);
    if (subscriptionId) {
      // The grace period runs from the due date of the invoice that failed.
      const pastDueSince = invoice.due_date ?? invoice.created ?? event.created;
      await convergeMembershipFromStripe(subscriptionId, converge, {pastDueSince});
    }
    return;
  }

  case "charge.dispute.created": {
    const dispute = event.data.object as Stripe.Dispute;
    const subscriptionId = await findMembershipIdForDispute(dispute);
    if (subscriptionId) {
      await convergeMembershipFromStripe(subscriptionId, converge, {disputeOpen: true});
    }
    return;
  }

  case "charge.dispute.closed": {
    const dispute = event.data.object as Stripe.Dispute;
    const subscriptionId = await findMembershipIdForDispute(dispute);
    if (!subscriptionId) return;

    // Won restores eligible access; lost revokes it permanently.
    const lost = dispute.status === "lost";
    await convergeMembershipFromStripe(subscriptionId, converge, {
      disputeOpen: false,
      ...(lost ? {accessRevoked: true} : {}),
    });
    return;
  }

  case "charge.refunded": {
    const charge = event.data.object as Stripe.Charge;
    const fullyRefunded = charge.amount_refunded >= charge.amount;
    if (!fullyRefunded) return;

    const subscriptionId = await findMembershipIdForCharge(charge);
    if (subscriptionId) {
      await convergeMembershipFromStripe(subscriptionId, converge, {accessRevoked: true});
    }
    return;
  }

  default:
    return;
  }
}

async function findMembershipIdForDispute(dispute: Stripe.Dispute): Promise<string | null> {
  const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id;
  if (!chargeId) return null;

  const charge = await stripe().charges.retrieve(chargeId);
  return findMembershipIdForCharge(charge);
}

/** ---------------------------------------------------------------
 * Admin
 * -------------------------------------------------------------- */

export function buildListMemberships(requireAdmin: (request: any) => Promise<void>) {
  return onCall({region: REGION}, async (request) => {
    requireAuthUid(request);
    await requireAdmin(request);

    const snap = await db().collection("memberships").orderBy("createdAt", "desc").limit(500).get();
    const memberships = snap.docs.map((doc) => {
      const membership = doc.data() as MembershipDoc;
      return {
        subscriptionId: membership.subscriptionId,
        payerUid: membership.payerUid,
        payerEmail: membership.payerEmail,
        planKey: membership.planKey,
        planName: membership.planName,
        state: membership.state,
        stripeStatus: membership.stripeStatus,
        grantsAlphaWodAccess: membership.grantsAlphaWodAccess,
        entitlementTargetUid: membership.entitlementTargetUid,
        participantFullName: membership.participant?.fullName ?? "",
        participantAge: membership.participant?.age ?? null,
        participantIsPayer: membership.participant?.isPayer ?? false,
        guardianFullName: membership.guardian?.fullName ?? null,
        currentPeriodEnd: membership.currentPeriodEnd ?? null,
        cancelAt: membership.cancelAt ?? null,
        disputeOpen: membership.disputeOpen ?? false,
        accessRevoked: membership.accessRevoked ?? false,
        pastDueSince: membership.pastDueSince ?? null,
      };
    });

    return {ok: true, memberships, planKeys: PLAN_KEYS};
  });
}

/**
 * Links a membership bought for another person to that person's account, so a
 * purchase where the payer is not the participant can still grant access.
 */
export function buildLinkMembershipParticipant(requireAdmin: (request: any) => Promise<void>) {
  return onCall({region: REGION}, async (request) => {
    const callerUid = requireAuthUid(request);
    await requireAdmin(request);

    const subscriptionId = requireBoundedString(request.data?.subscriptionId, "subscriptionId", 3, 255);
    const targetUid = requireBoundedString(request.data?.participantUid, "participantUid", 3, 128);

    const membershipRef = db().collection("memberships").doc(subscriptionId);
    const [membershipSnap, userSnap] = await Promise.all([
      membershipRef.get(),
      db().collection("users").doc(targetUid).get(),
    ]);
    if (!membershipSnap.exists) throw new HttpsError("not-found", "Membership not found.");
    if (!userSnap.exists) throw new HttpsError("not-found", "Participant account not found.");

    const membership = membershipSnap.data() as MembershipDoc;
    if (!membership.grantsAlphaWodAccess) {
      throw new HttpsError(
        "failed-precondition",
        "This plan does not include AlphaWOD access."
      );
    }

    await membershipRef.set({
      entitlementTargetUid: targetUid,
      entitlementTargetLinkedBy: callerUid,
      entitlementTargetLinkedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, {merge: true});

    await writeAudit({
      type: "membership_participant_linked",
      subscriptionId,
      targetUid,
      linkedBy: callerUid,
    });

    return {ok: true, subscriptionId, participantUid: targetUid};
  });
}

export const __testing = {
  participantKeyFor,
  resolveCurrentPeriodEnd,
  resolveInvoiceSubscriptionId,
};

/** ---------------------------------------------------------------
 * Durable confirmation email (Membership Terms 4)
 *
 * The Terms require an emailed durable copy carrying the agreed plan, the
 * amounts, the next payment date, the accepted document versions, cancellation
 * information, and the signed acceptance evidence, and state explicitly that a
 * changeable website link is not a durable copy. Everything below is therefore
 * written into the email body itself rather than linked.
 * -------------------------------------------------------------- */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type ConfirmationDetails = {
  membership: MembershipDoc;
  initialChargePence: number | null;
  claimUrl: string | null;
};

function buildConfirmationHtml(details: ConfirmationDetails): string {
  const {membership, initialChargePence, claimUrl} = details;
  const plan = getPlan(membership.planKey);
  const firstFullCharge = formatUnixBillingDate(membership.billingCycleAnchor);
  const documents = Object.entries(membership.acceptances.documents)
    .map(([name, version]) =>
      `<li>${escapeHtml(name)}: <code>${escapeHtml(String(version))}</code></li>`)
    .join("");

  const rows: Array<[string, string]> = [
    ["Plan", plan.name],
    ["Participant", membership.participant.fullName],
    ["Monthly price", `${formatPence(plan.amountPence)} per month`],
    [
      "Paid today",
      initialChargePence === null ?
        "See your Stripe receipt" :
        `${formatPence(initialChargePence)} (pro rata to ${firstFullCharge})`,
    ],
    ["First full monthly payment", firstFullCharge],
    ["Then", "The first of each month"],
  ];

  if (membership.guardian) {
    rows.splice(2, 0, [
      "Parent or guardian",
      `${membership.guardian.fullName} (${membership.guardian.relationship})`,
    ]);
  }

  const tableRows = rows
    .map(([label, value]) =>
      `<tr><td style="padding:6px 16px 6px 0;color:#666;">${escapeHtml(label)}</td>` +
      `<td style="padding:6px 0;"><strong>${escapeHtml(value)}</strong></td></tr>`)
    .join("");

  const claimBlock = claimUrl ?
    `<div style="margin:24px 0;padding:16px;background:#fff8e6;border:1px solid #e6c67a;">
      <p style="margin:0 0 10px;"><strong>One step left: claim your membership</strong></p>
      <p style="margin:0 0 12px;">Create your account with this email address to link this
      membership to it.</p>
      <p style="margin:0;"><a href="${escapeHtml(claimUrl)}">${escapeHtml(claimUrl)}</a></p>
    </div>` :
    "";

  return `<!doctype html>
<html><body style="font-family:Arial,Helvetica,sans-serif;color:#111;line-height:1.6;">
  <h1 style="font-size:20px;margin:0 0 6px;">Your ${escapeHtml(plan.name)} is confirmed</h1>
  <p style="margin:0 0 20px;color:#555;">Keep this email. It is your durable copy of this
  agreement.</p>

  ${claimBlock}

  <table style="border-collapse:collapse;margin:0 0 24px;">${tableRows}</table>

  <h2 style="font-size:15px;margin:24px 0 8px;">Cancelling</h2>
  <p style="margin:0 0 8px;">${escapeHtml(POLICY_TEXT.cancellationRule)}</p>
  <p style="margin:0 0 8px;">Request cancellation from your membership page when signed in,
  or email ${escapeHtml(COMPANY.supportEmail)} from this address. We record when your
  request reaches us.</p>
  <p style="margin:0 0 8px;">${escapeHtml(POLICY_TEXT.refund)}</p>
  <p style="margin:0 0 8px;">${escapeHtml(POLICY_TEXT.noPause)}</p>

  <h2 style="font-size:15px;margin:24px 0 8px;">Cooling-off</h2>
  <p style="margin:0 0 8px;">You may cancel within
  ${BILLING_POLICY.coolingOffDays} days of the day this contract was made. Your period ends
  ${escapeHtml(formatBillingDate(membership.acceptances.coolingOffEndsAt.slice(0, 10)))}.
  ${membership.acceptances.immediatePerformanceRequested ?
    "You expressly requested that the membership begin immediately, so if you cancel within " +
    "that period we may charge only the proportionate amount permitted by law for services " +
    "already supplied." :
    "You did not request immediate performance."}</p>

  <h2 style="font-size:15px;margin:24px 0 8px;">Documents you accepted</h2>
  <ul style="margin:0 0 8px;padding-left:20px;">${documents}</ul>

  <h2 style="font-size:15px;margin:24px 0 8px;">Your signature</h2>
  <p style="margin:0 0 8px;">Signed by typing the name
  <strong>${escapeHtml(membership.acceptances.signedName)}</strong> at checkout.</p>

  <hr style="border:none;border-top:1px solid #ddd;margin:28px 0 12px;">
  <p style="margin:0;font-size:12px;color:#666;">
    ${escapeHtml(COMPANY.legalName)} · Company number ${escapeHtml(COMPANY.companyNumber)}<br>
    ${escapeHtml(COMPANY.address)}<br>
    Questions: ${escapeHtml(COMPANY.supportEmail)}<br>
    We are not VAT registered; the price shown is the total price.
  </p>
</body></html>`;
}

/**
 * Sends the durable confirmation once per membership.
 *
 * The send is guarded by a transactional marker rather than the webhook event
 * ledger, because two different Stripe events can both reach fulfilment for
 * one purchase. A send failure clears the marker so a Stripe retry can try
 * again, and never fails the webhook: the membership is already valid and paid,
 * so losing the email must not roll back fulfilment.
 */
async function sendMembershipConfirmation(
  membershipRef: admin.firestore.DocumentReference,
  initialChargePence: number | null
): Promise<void> {
  const claimed = await db().runTransaction(async (tx) => {
    const snap = await tx.get(membershipRef);
    if (!snap.exists) return null;
    if (snap.get("confirmationEmailSentAt")) return null;
    if (!snap.get("payerEmail")) return null;

    tx.set(membershipRef, {confirmationEmailSentAt: serverTimestamp()}, {merge: true});
    return snap.data() as MembershipDoc;
  });

  if (!claimed) return;

  const apiKey = resendApiKey.value().trim();
  const fromEmail = membershipFromEmail.value().trim() || COMPANY.confirmationSender;

  try {
    if (!apiKey) throw new Error("RESEND_API_KEY is not configured.");

    const claimUrl = claimed.payerUid ?
      null :
      `${resolveReturnOrigin()}/memberships/success?session_id=` +
        `${encodeURIComponent(claimed.checkoutSessionId)}`;

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${COMPANY.tradingName} <${fromEmail}>`,
        to: [claimed.payerEmail],
        subject: `Your ${getPlan(claimed.planKey).name} is confirmed`,
        html: buildConfirmationHtml({
          membership: claimed,
          initialChargePence,
          claimUrl,
        }),
      }),
    });

    if (!response.ok) {
      throw new Error(await response.text() || response.statusText);
    }

    await writeAudit({
      type: "confirmation_email_sent",
      subscriptionId: membershipRef.id,
      unclaimed: !claimed.payerUid,
    });
  } catch (error) {
    console.error("Confirmation email failed", membershipRef.id, error);
    await membershipRef.set({
      confirmationEmailSentAt: admin.firestore.FieldValue.delete(),
      confirmationEmailError: String(error).slice(0, 500),
      updatedAt: serverTimestamp(),
    }, {merge: true});
  }
}
