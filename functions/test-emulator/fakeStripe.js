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

function formEncodedToObject(body) {
  const params = new URLSearchParams(body);
  const out = {};
  for (const [key, value] of params.entries()) out[key] = value;
  return out;
}

function createFakeStripe() {
  const prices = new Map([
    ["price_unlimited", {amount: 6000, name: "Adult Unlimited Membership"}],
    ["price_ladies", {amount: 5000, name: "Adult Ladies Only Membership"}],
    ["price_gym", {amount: 4500, name: "Adult Gym Only"}],
    ["price_youngstars", {amount: 3500, name: "HYROX Youngstars"}],
    ["price_teenstars", {amount: 3500, name: "HYROX Teenstars"}],
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
    prices,
    portalConfigurations: new Map([["bpc_fake", {
      id: "bpc_fake",
      object: "billing_portal.configuration",
      active: true,
      livemode: false,
      features: {
        subscription_cancel: {enabled: false},
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

      // --- Checkout sessions ---
      if (path === "/v1/checkout/sessions" && req.method === "POST") {
        if (Number(payload.expires_at) * 1000 <= Date.now()) {
          return send(400, {
            error: {
              type: "invalid_request_error",
              code: "parameter_invalid_integer",
              param: "expires_at",
              message: "expires_at must be in the future",
            },
          });
        }
        const id = `cs_fake_${state.checkoutSessions.size + 1}`;
        const session = {
          id,
          object: "checkout.session",
          livemode: false,
          url: `https://checkout.stripe.test/${id}`,
          metadata: {
            intentId: payload["metadata[intentId]"],
            planKey: payload["metadata[planKey]"],
          },
          subscription_data_anchor: payload["subscription_data[billing_cycle_anchor]"],
          proration_behavior: payload["subscription_data[proration_behavior]"],
          expires_at: payload.expires_at,
          customer: payload.customer || null,
          status: "open",
          payment_status: "unpaid",
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
      state.subscriptions.set(id, subscription);
      return subscription;
    },
    setEvent(event) {
      state.events.set(event.id, event);
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

module.exports = {createFakeStripe};
