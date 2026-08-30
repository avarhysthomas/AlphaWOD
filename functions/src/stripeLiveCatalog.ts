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

export type ApprovedLiveOneTimeStripeCatalogueEntry = Readonly<{
  priceEnvKey: string;
  productId: string;
  productName: string;
  priceId: string;
  amountPence: number;
  currency: "gbp";
  type: "one_time";
  billingScheme: "per_unit";
  taxBehavior: "unspecified";
  customUnitAmount: null;
  transformQuantity: null;
  recurring: null;
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

type LiveOneTimeStripePriceShape = Readonly<{
  id: string;
  type: string;
  billing_scheme: string;
  tax_behavior: string | null;
  custom_unit_amount: unknown;
  transform_quantity: unknown;
  recurring: unknown;
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
 * Checks exact mutable fields for the approved one-time PAYG catalogue.
 *
 * @param {LiveOneTimeStripePriceShape} price Stripe Price from the live API.
 * @param {LiveStripeProductShape|null} product Expanded Stripe Product.
 * @param {ApprovedLiveOneTimeStripeCatalogueEntry} approved Frozen entry.
 * @return {boolean} Whether every frozen one-time field matches.
 */
export function matchesApprovedLivePaygCatalogueEntry(
  price: LiveOneTimeStripePriceShape,
  product: LiveStripeProductShape | null,
  approved: ApprovedLiveOneTimeStripeCatalogueEntry
): boolean {
  return price.id === approved.priceId &&
    price.type === approved.type &&
    price.billing_scheme === approved.billingScheme &&
    price.tax_behavior === approved.taxBehavior &&
    price.custom_unit_amount === approved.customUnitAmount &&
    price.transform_quantity === approved.transformQuantity &&
    price.recurring === approved.recurring &&
    product?.id === approved.productId &&
    product.name === approved.productName &&
    product.tax_code === approved.productTaxCode;
}

/**
 * Exact LIVE Stripe catalogue. Its identifiers and commercial fields were
 * supplied in the 17 August 2026 Dashboard exports and independently re-read
 * from Stripe's live API on 19 August 2026. The two existing youth Products
 * were deliberately renamed in the live Dashboard and read back from Stripe's
 * live API on 25 August 2026. The Conditioning-only Product and Price were
 * inspected in the live Stripe Dashboard on 30 August 2026. Their exact
 * current identifiers and commercial shape are frozen below; the release's
 * full read-only live API preflight is still required.
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
  adult_conditioning: {
    priceEnvKey: "STRIPE_PRICE_ADULT_CONDITIONING",
    productId: "prod_VAOFQB36XfKixX",
    productName: "Adult Conditioning Only Membership",
    priceId: "price_1UA3T0FzNDZoGGA0RJg5qEHe",
    amountPence: 3000,
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
    productName: "MINI ALPHAS - 10 & Under",
    priceId: "price_1U5KoQFzNDZoGGA0s4t806bH",
    amountPence: 3000,
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
    productName: "TEEN ALPHAS - 11 & UP",
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

/**
 * Exact one-time LIVE PAYG object inspected in Stripe Dashboard on 30 August
 * 2026. It stays separate from the recurring PlanKey catalogue by design.
 */
export const APPROVED_LIVE_PAYG_CATALOGUE = {
  priceEnvKey: "STRIPE_PRICE_ADULT_PAYG_CLASS",
  productId: "prod_VAOGG2ZsBQ65Qt",
  productName: "Adult Pay as You Go Class",
  priceId: "price_1UA3TdFzNDZoGGA0dCgYfU2h",
  amountPence: 750,
  currency: "gbp",
  type: "one_time",
  billingScheme: "per_unit",
  taxBehavior: "unspecified",
  customUnitAmount: null,
  transformQuantity: null,
  recurring: null,
  productTaxCode: "txcd_50021001",
} as const satisfies ApprovedLiveOneTimeStripeCatalogueEntry;

/** Exact Stripe sandbox counterpart created and inspected on 30 August 2026. */
export const APPROVED_TEST_PAYG_CATALOGUE = {
  ...APPROVED_LIVE_PAYG_CATALOGUE,
  productId: "prod_VAOxXxpax1MuRt",
  priceId: "price_1UA49JFzNDZoGGA0ciTM2OOQ",
} as const satisfies ApprovedLiveOneTimeStripeCatalogueEntry;
