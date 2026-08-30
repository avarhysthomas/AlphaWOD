/* eslint-disable @typescript-eslint/no-var-requires, max-len, require-jsdoc, valid-jsdoc */

/**
 * A minimal stand-in for the Stripe REST API, covering only the endpoints the
 * membership module calls. It lets the billing flows run end to end against the
 * Firestore and Auth emulators without a Stripe account or network access.
 *
 * State is held in plain maps so a test can seed a subscription, then assert on
 * what the server received — which is how the cancellation tests check that the
 * correct `cancel_at` reached Stripe.
 */

const http = require("node:http");

const MEMBERSHIP_APP_ACCESS_TIER_BY_PLAN = Object.freeze({
  adult_unlimited: "full",
  adult_conditioning: "limited",
  adult_ladies: "none",
  adult_gym: "none",
  youth_youngstars: "none",
  youth_teenstars: "none",
});

/**
 * Upgrades an otherwise-current commercial fixture to the metadata written by
 * the schema-v6 checkout flow. An explicit value (including null/undefined) is
 * preserved so contract-negative tests can still exercise fail-closed paths.
 * Conditioning slots are deliberately not invented; non-conditioning plans
 * must continue to omit that Stripe metadata key entirely.
 */
function membershipCommercialMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return metadata;
  }
  const expectedTier = MEMBERSHIP_APP_ACCESS_TIER_BY_PLAN[metadata.planKey];
  if (!expectedTier ||
    Object.prototype.hasOwnProperty.call(metadata, "appAccessTier")) {
    return metadata;
  }
  return {...metadata, appAccessTier: expectedTier};
}

function formEncodedToObject(body) {
  const params = new URLSearchParams(body);
  const out = {};
  for (const [key, value] of params.entries()) out[key] = value;
  return out;
}

function createFakeStripe() {
  const prices = new Map([
    ["price_unlimited", {amount: 6000, name: "Adult Unlimited Membership"}],
    ["price_conditioning", {amount: 3000, name: "Adult Conditioning Only Membership"}],
    ["price_ladies", {amount: 5000, name: "Adult Ladies Only Membership"}],
    ["price_gym", {amount: 4500, name: "Adult Gym Only"}],
    ["price_youngstars", {amount: 3000, name: "MINI ALPHAS - 10 & Under"}],
    ["price_teenstars", {amount: 3500, name: "TEEN ALPHAS - 11 & UP"}],
  ].map(([id, value]) => [id, {
    id,
    object: "price",
    active: true,
    livemode: false,
    currency: "gbp",
    unit_amount: value.amount,
    type: "recurring",
    recurring: {interval: "month", interval_count: 1},
    product: {
      id: `prod_${id}`,
      object: "product",
      active: true,
      livemode: false,
      name: value.name,
    },
  }]));
  const state = {
    subscriptions: new Map(),
    invoices: new Map(),
    charges: new Map(),
    invoicePayments: [],
    customers: new Map(),
    checkoutSessions: new Map(),
    disputes: new Map(),
    portalSessions: [],
    events: new Map(),
    delayedSubscriptionRetrieves: new Map(),
    failedSubscriptionRetrieves: new Map(),
    subscriptionRetrieveCounts: new Map(),
    prices,
    coupons: new Map([["coupon_existing_member_5x3", {
      id: "coupon_existing_member_5x3",
      object: "coupon",
      livemode: false,
      amount_off: 500,
      currency: "gbp",
      percent_off: null,
      duration: "repeating",
      duration_in_months: 3,
      max_redemptions: null,
      redeem_by: null,
      applies_to: {products: ["prod_price_unlimited"]},
      deleted: false,
      valid: true,
    }], ["coupon_youth_family_10pct", {
      id: "coupon_youth_family_10pct",
      object: "coupon",
      livemode: false,
      amount_off: null,
      currency: null,
      percent_off: 10,
      duration: "forever",
      duration_in_months: null,
      max_redemptions: null,
      redeem_by: null,
      applies_to: {
        products: ["prod_price_youngstars", "prod_price_teenstars"],
      },
      deleted: false,
      valid: true,
    }], ["coupon_youth_family_15pct", {
      id: "coupon_youth_family_15pct",
      object: "coupon",
      livemode: false,
      amount_off: null,
      currency: null,
      percent_off: 15,
      duration: "forever",
      duration_in_months: null,
      max_redemptions: null,
      redeem_by: null,
      applies_to: {
        products: ["prod_price_youngstars", "prod_price_teenstars"],
      },
      deleted: false,
      valid: true,
    }]]),
    promotionCodes: new Map([["promo_existing_member_shared", {
      id: "promo_existing_member_shared",
      object: "promotion_code",
      livemode: false,
      active: true,
      code: "EXISTING-FAKE",
      max_redemptions: null,
      expires_at: null,
      times_redeemed: 0,
      promotion: {type: "coupon", coupon: "coupon_existing_member_5x3"},
      restrictions: {
        first_time_transaction: false,
        minimum_amount: null,
        minimum_amount_currency: null,
        currency_options: {},
      },
    }]]),
    portalConfigurations: new Map([["bpc_fake", {
      id: "bpc_fake",
      object: "billing_portal.configuration",
      active: true,
      livemode: false,
      login_page: {enabled: false, url: null},
      features: {
        customer_update: {enabled: false, allowed_updates: []},
        invoice_history: {enabled: true},
        payment_method_update: {
          enabled: true,
          payment_method_configuration: null,
        },
        subscription_cancel: {enabled: false},
        subscription_pause: {enabled: false},
        subscription_update: {enabled: false},
      },
    }]]),
    /** Every write the code made, for assertions. */
    updates: [],
  };

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const url = new URL(req.url, "http://localhost");
      const path = url.pathname;
      const payload = req.method === "POST" ? formEncodedToObject(body) : {};

      const send = (status, value) => {
        res.writeHead(status, {"Content-Type": "application/json"});
        res.end(JSON.stringify(value));
      };

      const notFound = (message) =>
        send(404, {error: {type: "invalid_request_error", message}});

      // --- Prices ---
      const priceMatch = path.match(/^\/v1\/prices\/([^/]+)$/);
      if (priceMatch && req.method === "GET") {
        const price = state.prices.get(priceMatch[1]);
        if (!price) return notFound(`No such price: ${priceMatch[1]}`);
        return send(200, price);
      }

      // --- Coupons and promotion codes ---
      const couponMatch = path.match(/^\/v1\/coupons\/([^/]+)$/);
      if (couponMatch && req.method === "GET") {
        const storedCoupon = state.coupons.get(couponMatch[1]);
        if (!storedCoupon) return notFound(`No such coupon: ${couponMatch[1]}`);
        const coupon = {
          ...storedCoupon,
          valid: storedCoupon.valid === true &&
            (storedCoupon.redeem_by === null ||
              Math.floor(Date.now() / 1000) < storedCoupon.redeem_by),
        };
        // Match Stripe's include-dependent response: Product restrictions are
        // omitted unless the caller explicitly expands `applies_to`.
        if (url.searchParams.get("expand[0]") !== "applies_to") {
          const defaultCoupon = {...coupon};
          delete defaultCoupon.applies_to;
          return send(200, defaultCoupon);
        }
        return send(200, coupon);
      }
      if (path === "/v1/promotion_codes" && req.method === "GET") {
        const requestedCode = url.searchParams.get("code");
        const activeOnly = url.searchParams.get("active") === "true";
        const now = Math.floor(Date.now() / 1000);
        const data = [...state.promotionCodes.values()].filter((promotionCode) => {
          const currentlyActive = promotionCode.active === true &&
            (promotionCode.expires_at === null || promotionCode.expires_at > now) &&
            (promotionCode.max_redemptions === null ||
              promotionCode.times_redeemed < promotionCode.max_redemptions);
          return (!requestedCode ||
              promotionCode.code.toUpperCase() === requestedCode.toUpperCase()) &&
            (!activeOnly || currentlyActive);
        });
        return send(200, {
          object: "list",
          data,
          has_more: false,
          url: "/v1/promotion_codes",
        });
      }
      const promotionCodeMatch = path.match(/^\/v1\/promotion_codes\/([^/]+)$/);
      if (promotionCodeMatch && req.method === "GET") {
        const promotionCode = state.promotionCodes.get(promotionCodeMatch[1]);
        if (!promotionCode) {
          return notFound(`No such promotion code: ${promotionCodeMatch[1]}`);
        }
        return send(200, promotionCode);
      }

      // --- Customers ---
      if (path === "/v1/customers" && req.method === "POST") {
        const id = `cus_fake_${state.customers.size + 1}`;
        const customer = {
          id,
          object: "customer",
          email: payload.email || null,
          livemode: false,
        };
        state.customers.set(id, customer);
        return send(200, customer);
      }
      const customerMatch = path.match(/^\/v1\/customers\/([^/]+)$/);
      if (customerMatch && req.method === "GET") {
        const customer = state.customers.get(customerMatch[1]);
        if (!customer) return notFound(`No such customer: ${customerMatch[1]}`);
        return send(200, customer);
      }

      // --- Checkout sessions ---
      if (path === "/v1/checkout/sessions" && req.method === "POST") {
        const checkoutExpiresAt = Number(payload.expires_at);
        const nowUnixSeconds = Math.floor(Date.now() / 1000);
        if (checkoutExpiresAt <= nowUnixSeconds ||
          checkoutExpiresAt < nowUnixSeconds + 30 * 60) {
          return send(400, {
            error: {
              type: "invalid_request_error",
              code: "parameter_invalid_integer",
              param: "expires_at",
              message: "expires_at must be at least 30 minutes in the future",
            },
          });
        }
        const id = `cs_fake_${state.checkoutSessions.size + 1}`;
        const promotionCodeId = payload["discounts[0][promotion_code]"] || null;
        const directCouponId = payload["discounts[0][coupon]"] || null;
        const promotionCode = promotionCodeId ?
          state.promotionCodes.get(promotionCodeId) : null;
        const couponId = directCouponId ?? promotionCode?.promotion?.coupon ?? null;
        const coupon = couponId ? state.coupons.get(couponId) : null;
        const billingAnchor = Number(
          payload["subscription_data[billing_cycle_anchor]"]
        );
        // Mirror Stripe's deferred-subscription validation. A Coupon can be
        // valid at request time yet still be unusable when its provider expiry
        // precedes the first full invoice anchor.
        if (coupon?.redeem_by !== null &&
          Number.isFinite(coupon?.redeem_by) &&
          coupon.redeem_by <= billingAnchor) {
          return send(400, {
            error: {
              type: "invalid_request_error",
              code: "coupon_expired",
              message: `Coupon ${coupon.id} is expired and cannot be applied.`,
            },
          });
        }
        const session = {
          id,
          object: "checkout.session",
          livemode: false,
          url: `https://checkout.stripe.test/${id}`,
          metadata: {
            intentId: payload["metadata[intentId]"],
            planKey: payload["metadata[planKey]"],
            participantCount: payload["metadata[participantCount]"],
            appAccessTier: payload["metadata[appAccessTier]"],
            ...(payload["metadata[conditioningSlots]"] ? {
              conditioningSlots: payload["metadata[conditioningSlots]"],
            } : {}),
            ...(payload["metadata[conditioningPolicyVersion]"] ? {
              conditioningPolicyVersion:
                payload["metadata[conditioningPolicyVersion]"],
              conditioningWeeklyLimit:
                payload["metadata[conditioningWeeklyLimit]"],
              conditioningEligibleSlots:
                payload["metadata[conditioningEligibleSlots]"],
            } : {}),
            ...(payload["metadata[firebaseUid]"] ? {
              firebaseUid: payload["metadata[firebaseUid]"],
            } : {}),
          },
          client_reference_id: payload.client_reference_id || null,
          subscription_data_anchor: payload["subscription_data[billing_cycle_anchor]"],
          proration_behavior: payload["subscription_data[proration_behavior]"],
          expires_at: Number(payload.expires_at),
          customer: payload.customer || null,
          status: "open",
          payment_status: "unpaid",
          payment_method_collection: payload.payment_method_collection || null,
          allow_promotion_codes: payload.allow_promotion_codes === "true",
          discounts: couponId ? [{
            coupon: couponId,
            promotion_code: promotionCodeId,
          }] : [],
          line_items: [{
            price: payload["line_items[0][price]"],
            quantity: Number(payload["line_items[0][quantity]"]),
          }],
          mode: payload.mode,
        };
        state.checkoutSessions.set(id, session);
        state.updates.push({path, payload});
        return send(200, session);
      }
      const checkoutMatch = path.match(/^\/v1\/checkout\/sessions\/([^/]+)$/);
      if (checkoutMatch && req.method === "GET") {
        const session = state.checkoutSessions.get(checkoutMatch[1]);
        if (!session) return notFound(`No such checkout session: ${checkoutMatch[1]}`);
        return send(200, session);
      }
      const checkoutExpireMatch = path.match(
        /^\/v1\/checkout\/sessions\/([^/]+)\/expire$/
      );
      if (checkoutExpireMatch && req.method === "POST") {
        const session = state.checkoutSessions.get(checkoutExpireMatch[1]);
        if (!session) {
          return notFound(`No such checkout session: ${checkoutExpireMatch[1]}`);
        }
        session.status = "expired";
        state.checkoutSessions.set(session.id, session);
        return send(200, session);
      }

      // --- Billing portal ---
      const portalConfigurationMatch = path.match(
        /^\/v1\/billing_portal\/configurations\/([^/]+)$/
      );
      if (portalConfigurationMatch && req.method === "GET") {
        const configuration = state.portalConfigurations.get(
          portalConfigurationMatch[1]
        );
        if (!configuration) {
          return notFound(
            `No such portal configuration: ${portalConfigurationMatch[1]}`
          );
        }
        return send(200, configuration);
      }
      if (path === "/v1/billing_portal/sessions" && req.method === "POST") {
        state.portalSessions.push(payload);
        return send(200, {
          id: "bps_fake",
          object: "billing_portal.session",
          url: "https://portal.stripe.test/session",
        });
      }

      // --- Subscriptions ---
      const subMatch = path.match(/^\/v1\/subscriptions\/([^/]+)$/);
      if (subMatch) {
        const id = subMatch[1];
        const subscription = state.subscriptions.get(id);
        if (!subscription) return notFound(`No such subscription: ${id}`);

        if (req.method === "GET") {
          state.subscriptionRetrieveCounts.set(
            id,
            (state.subscriptionRetrieveCounts.get(id) || 0) + 1
          );
          const retrieveFailure = state.failedSubscriptionRetrieves.get(id);
          if (retrieveFailure) {
            state.failedSubscriptionRetrieves.delete(id);
            const fail = () => send(retrieveFailure.status, {
              error: {
                type: "invalid_request_error",
                message: retrieveFailure.message,
              },
            });
            return retrieveFailure.delayMs > 0 ?
              setTimeout(fail, retrieveFailure.delayMs) : fail();
          }

          const retrieveDelayMs = state.delayedSubscriptionRetrieves.get(id);
          if (retrieveDelayMs > 0) {
            state.delayedSubscriptionRetrieves.delete(id);
            return setTimeout(() => send(200, subscription), retrieveDelayMs);
          }
        }

        if (req.method === "POST") {
          state.updates.push({path, payload});
          if (payload.cancel_at) subscription.cancel_at = Number(payload.cancel_at);
          state.subscriptions.set(id, subscription);
        } else if (req.method === "DELETE") {
          state.updates.push({path, payload, method: "DELETE"});
          subscription.status = "canceled";
          subscription.ended_at = Math.floor(Date.now() / 1000);
          subscription.cancel_at = null;
          state.subscriptions.set(id, subscription);
        }
        return send(200, subscription);
      }

      // --- Invoices ---
      const invoiceMatch = path.match(/^\/v1\/invoices\/([^/]+)$/);
      if (invoiceMatch) {
        const invoice = state.invoices.get(invoiceMatch[1]);
        if (!invoice) return notFound(`No such invoice: ${invoiceMatch[1]}`);
        return send(200, invoice);
      }

      // --- Invoice payments (charge -> invoice -> subscription) ---
      if (path === "/v1/invoice_payments") {
        const paymentIntent = url.searchParams.get("payment[payment_intent]");
        const data = state.invoicePayments.filter(
          (entry) => entry.payment_intent === paymentIntent
        );
        return send(200, {object: "list", data, has_more: false});
      }

      // --- Charges ---
      const chargeMatch = path.match(/^\/v1\/charges\/([^/]+)$/);
      if (chargeMatch) {
        const charge = state.charges.get(chargeMatch[1]);
        if (!charge) return notFound(`No such charge: ${chargeMatch[1]}`);
        return send(200, charge);
      }

      // --- Disputes ---
      const disputeMatch = path.match(/^\/v1\/disputes\/([^/]+)$/);
      if (disputeMatch) {
        const dispute = state.disputes.get(disputeMatch[1]);
        if (!dispute) return notFound(`No such dispute: ${disputeMatch[1]}`);
        return send(200, dispute);
      }

      // --- Events (scheduled webhook recovery) ---
      const eventMatch = path.match(/^\/v1\/events\/([^/]+)$/);
      if (eventMatch) {
        const event = state.events.get(eventMatch[1]);
        if (!event) return notFound(`No such event: ${eventMatch[1]}`);
        return send(200, event);
      }

      return notFound(`Unhandled fake Stripe route: ${req.method} ${path}`);
    });
  });

  return {
    state,
    listen(port) {
      return new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
    /** Seeds a subscription the code can retrieve and converge from. */
    setSubscription(id, overrides = {}) {
      const existing = state.subscriptions.get(id) || {};
      const subscription = {
        id,
        object: "subscription",
        livemode: false,
        status: "active",
        cancel_at: null,
        collection_method: "charge_automatically",
        pause_collection: null,
        trial_start: null,
        trial_end: null,
        customer: `cus_${id}`,
        billing_cycle_anchor: 1788220800,
        metadata: {planKey: "adult_unlimited"},
        discounts: [],
        items: {
          object: "list",
          data: [{
            id: `si_${id}`,
            current_period_end: 1788220800,
            price: "price_unlimited",
            quantity: 1,
          }],
        },
        ...existing,
        ...overrides,
      };
      subscription.metadata = membershipCommercialMetadata(subscription.metadata);
      state.subscriptions.set(id, subscription);
      return subscription;
    },
    /** Delays one authoritative GET so concurrency tests hold the lease. */
    delayNextSubscriptionRetrieve(id, delayMs) {
      state.delayedSubscriptionRetrieves.set(id, delayMs);
    },
    /** Fails one authoritative GET, optionally after holding the lease. */
    failNextSubscriptionRetrieve(id, {
      delayMs = 0,
      status = 400,
      message = "Injected subscription retrieval failure",
    } = {}) {
      state.failedSubscriptionRetrieves.set(id, {delayMs, status, message});
    },
    setEvent(event) {
      state.events.set(event.id, event);
      const object = event.data?.object;
      if ((event.type === "checkout.session.completed" ||
          event.type === "checkout.session.async_payment_succeeded") && object?.id) {
        const existing = state.checkoutSessions.get(object.id) || {};
        state.checkoutSessions.set(object.id, {
          ...existing,
          ...object,
          metadata: membershipCommercialMetadata({
            ...(existing.metadata || {}),
            ...(object.metadata || {}),
          }),
        });
      }
      if (event.type === "invoice.paid" && object?.id) {
        state.invoices.set(object.id, object);
      }
      return event;
    },
    setDispute(id, overrides = {}) {
      const dispute = {
        id,
        object: "dispute",
        livemode: false,
        status: "needs_response",
        charge: null,
        ...overrides,
      };
      state.disputes.set(id, dispute);
      return dispute;
    },
    /** Links a charge to a subscription the way Stripe's objects do. */
    linkChargeToSubscription({chargeId, paymentIntentId, invoiceId, subscriptionId, amount = 6000, amountRefunded = 0, customerId = null}) {
      state.charges.set(chargeId, {
        id: chargeId,
        object: "charge",
        livemode: false,
        amount,
        amount_refunded: amountRefunded,
        payment_intent: paymentIntentId,
        customer: customerId,
      });
      state.invoices.set(invoiceId, {
        id: invoiceId,
        object: "invoice",
        livemode: false,
        parent: {
          type: "subscription_details",
          subscription_details: {subscription: subscriptionId},
        },
        lines: {object: "list", data: []},
      });
      state.invoicePayments.push({
        id: `inpay_${chargeId}`,
        object: "invoice_payment",
        invoice: invoiceId,
        payment_intent: paymentIntentId,
      });
    },
    /** The most recent write to a given path, for assertions. */
    lastUpdateTo(pathFragment) {
      return [...state.updates].reverse()
        .find((entry) => entry.path.includes(pathFragment)) || null;
    },
  };
}

module.exports = {createFakeStripe, membershipCommercialMetadata};
