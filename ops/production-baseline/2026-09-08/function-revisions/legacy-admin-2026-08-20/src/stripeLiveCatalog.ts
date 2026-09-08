/* eslint-disable require-jsdoc, max-len */

import type {PlanKey} from "./membershipPlans";

export type ApprovedLiveStripeCatalogueEntry = Readonly<{
  priceEnvKey: string;
  productId: string;
  productName: string;
  priceId: string;
  amountPence: number;
  currency: "gbp";
  interval: "month";
  intervalCount: 1;
  usageType: "licensed";
  billingScheme: "per_unit";
  taxBehavior: "unspecified";
  transformQuantity: null;
  trialPeriodDays: null;
  productTaxCode: "txcd_50021001";
}>;

type LiveStripePriceShape = Readonly<{
  id: string;
  billing_scheme: string;
  tax_behavior: string | null;
  transform_quantity: unknown;
  recurring: Readonly<{
    usage_type: string;
    trial_period_days: number | null;
  }> | null;
}>;

type LiveStripeProductShape = Readonly<{
  id: string;
  name: string;
  tax_code?: unknown;
}>;

/**
 * Checks exact live-only fields that can change the approved billing contract.
 *
 * @param {LiveStripePriceShape} price Stripe Price returned by the live API.
 * @param {LiveStripeProductShape|null} product Expanded Product returned with the Price.
 * @param {ApprovedLiveStripeCatalogueEntry} approved Frozen catalogue entry.
 * @return {boolean} Whether every frozen live-only field matches.
 */
export function matchesApprovedLiveStripeCatalogueEntry(
  price: LiveStripePriceShape,
  product: LiveStripeProductShape | null,
  approved: ApprovedLiveStripeCatalogueEntry
): boolean {
  return price.id === approved.priceId &&
    price.billing_scheme === approved.billingScheme &&
    price.recurring?.usage_type === approved.usageType &&
    price.tax_behavior === approved.taxBehavior &&
    price.transform_quantity === approved.transformQuantity &&
    price.recurring?.trial_period_days === approved.trialPeriodDays &&
    product?.id === approved.productId &&
    product.name === approved.productName &&
    product.tax_code === approved.productTaxCode;
}

/**
 * Exact LIVE Stripe catalogue supplied in the 17 August 2026 Dashboard exports
 * and independently re-read from Stripe's live API on 19 August 2026.
 *
 * Source export SHA-256:
 * - products.csv: 4a6e974595c45a4fba5cd4f175eb9de61f335200a1f03b8653401e62a498570c
 * - prices.csv:   bfcd9b8ca37aa1a94981f82552d37a31d8d7cc2cd584ab60f67f66e9a2ef4bb9
 *
 * These identifiers are public provider references, not credentials. Freezing
 * them makes a swapped live Price/Product fail closed until the reviewed
 * catalogue and code are deliberately updated together.
 */
export const APPROVED_LIVE_STRIPE_CATALOGUE = {
  adult_unlimited: {
    priceEnvKey: "STRIPE_PRICE_ADULT_UNLIMITED",
    productId: "prod_V5VhTEmyekcpY4",
    productName: "Adult Unlimited Membership",
    priceId: "price_1U5KgYFzNDZoGGA0jGftxyZH",
    amountPence: 6000,
    currency: "gbp",
    interval: "month",
    intervalCount: 1,
    usageType: "licensed",
    billingScheme: "per_unit",
    taxBehavior: "unspecified",
    transformQuantity: null,
    trialPeriodDays: null,
    productTaxCode: "txcd_50021001",
  },
  adult_ladies: {
    priceEnvKey: "STRIPE_PRICE_ADULT_LADIES",
    productId: "prod_V5VkRs10lzG989",
    productName: "Adult Ladies Only Membership",
    priceId: "price_1U5KjOFzNDZoGGA0j3qcds5p",
    amountPence: 5000,
    currency: "gbp",
    interval: "month",
    intervalCount: 1,
    usageType: "licensed",
    billingScheme: "per_unit",
    taxBehavior: "unspecified",
    transformQuantity: null,
    trialPeriodDays: null,
    productTaxCode: "txcd_50021001",
  },
  adult_gym: {
    priceEnvKey: "STRIPE_PRICE_ADULT_GYM",
    productId: "prod_V5VlQAfdAYSb0G",
    productName: "Adult Gym Only",
    priceId: "price_1U5Kk9FzNDZoGGA0dQ61G49d",
    amountPence: 4500,
    currency: "gbp",
    interval: "month",
    intervalCount: 1,
    usageType: "licensed",
    billingScheme: "per_unit",
    taxBehavior: "unspecified",
    transformQuantity: null,
    trialPeriodDays: null,
    productTaxCode: "txcd_50021001",
  },
  youth_youngstars: {
    priceEnvKey: "STRIPE_PRICE_YOUTH_YOUNGSTARS",
    productId: "prod_V5Vq0l9VAaPox9",
    productName: "HYROX Youngstars U11",
    priceId: "price_1U5KoQFzNDZoGGA0s4t806bH",
    amountPence: 3500,
    currency: "gbp",
    interval: "month",
    intervalCount: 1,
    usageType: "licensed",
    billingScheme: "per_unit",
    taxBehavior: "unspecified",
    transformQuantity: null,
    trialPeriodDays: null,
    productTaxCode: "txcd_50021001",
  },
  youth_teenstars: {
    priceEnvKey: "STRIPE_PRICE_YOUTH_TEENSTARS",
    productId: "prod_V5VumrjZl1bWV1",
    productName: "HYROX Teenstars 12+",
    priceId: "price_1U5Kt8FzNDZoGGA0ogq41DEw",
    amountPence: 3500,
    currency: "gbp",
    interval: "month",
    intervalCount: 1,
    usageType: "licensed",
    billingScheme: "per_unit",
    taxBehavior: "unspecified",
    transformQuantity: null,
    trialPeriodDays: null,
    productTaxCode: "txcd_50021001",
  },
} as const satisfies Record<PlanKey, ApprovedLiveStripeCatalogueEntry>;
