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
  const state = {
    subscriptions: new Map(),
    invoices: new Map(),
    charges: new Map(),
    invoicePayments: [],
    customers: new Map(),
    checkoutSessions: new Map(),
    portalSessions: [],
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

      // --- Customers ---
      if (path === "/v1/customers" && req.method === "POST") {
        const id = `cus_fake_${state.customers.size + 1}`;
        const customer = {id, object: "customer", email: payload.email || null};
        state.customers.set(id, customer);
        return send(200, customer);
      }

      // --- Checkout sessions ---
      if (path === "/v1/checkout/sessions" && req.method === "POST") {
        const id = `cs_fake_${state.checkoutSessions.size + 1}`;
        const session = {
          id,
          object: "checkout.session",
          url: `https://checkout.stripe.test/${id}`,
          metadata: {
            intentId: payload["metadata[intentId]"],
            planKey: payload["metadata[planKey]"],
          },
          subscription_data_anchor: payload["subscription_data[billing_cycle_anchor]"],
          proration_behavior: payload["subscription_data[proration_behavior]"],
          expires_at: payload.expires_at,
          customer: payload.customer || null,
        };
        state.checkoutSessions.set(id, session);
        state.updates.push({path, payload});
        return send(200, session);
      }

      // --- Billing portal ---
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
      const subscription = {
        id,
        object: "subscription",
        status: "active",
        cancel_at: null,
        items: {
          object: "list",
          data: [{id: `si_${id}`, current_period_end: 1788220800}],
        },
        ...overrides,
      };
      state.subscriptions.set(id, subscription);
      return subscription;
    },
    /** Links a charge to a subscription the way Stripe's objects do. */
    linkChargeToSubscription({chargeId, paymentIntentId, invoiceId, subscriptionId, amount = 6000, amountRefunded = 0, customerId = null}) {
      state.charges.set(chargeId, {
        id: chargeId,
        object: "charge",
        amount,
        amount_refunded: amountRefunded,
        payment_intent: paymentIntentId,
        customer: customerId,
      });
      state.invoices.set(invoiceId, {
        id: invoiceId,
        object: "invoice",
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
