import {CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION} from "../../lib/membershipPlans";
import {LOCAL_MEMBERSHIP_TEST_JOURNEY_ENABLED} from "./localTestJourney";

type PublicRuntimeEnvironment = {
  NODE_ENV?: string;
  REACT_APP_MEMBERSHIP_PURCHASE_ENABLED?: string;
  REACT_APP_ADULT_CONDITIONING_PURCHASE_ENABLED?: string;
};

type MembershipPurchaseAvailabilityInput = {
  documentsApproved: boolean;
  frontendPurchaseEnabled: boolean;
  localTestJourneyEnabled: boolean;
  frontendConditioningPurchaseEnabled: boolean;
};

export type MembershipPurchaseAvailability =
  MembershipPurchaseAvailabilityInput & {
    publicPurchaseEnabled: boolean;
    checkoutEnabled: boolean;
    conditioningCheckoutEnabled: boolean;
  };

/**
 * The public browser gate is deliberately build-time configuration. It opens
 * only in a production build with the exact explicit value `true`; missing,
 * misspelled and development values all fail closed.
 */
export function isFrontendMembershipPurchaseEnabled(
  environment: PublicRuntimeEnvironment
): boolean {
  return environment.NODE_ENV === "production" &&
    environment.REACT_APP_MEMBERSHIP_PURCHASE_ENABLED === "true";
}

export function isFrontendConditioningPurchaseEnabled(
  environment: PublicRuntimeEnvironment
): boolean {
  return environment.REACT_APP_ADULT_CONDITIONING_PURCHASE_ENABLED === "true";
}

export function resolveMembershipPurchaseAvailability({
  documentsApproved,
  frontendPurchaseEnabled,
  localTestJourneyEnabled,
  frontendConditioningPurchaseEnabled,
}: MembershipPurchaseAvailabilityInput): MembershipPurchaseAvailability {
  const publicPurchaseEnabled =
    documentsApproved && frontendPurchaseEnabled;
  const checkoutEnabled = publicPurchaseEnabled || localTestJourneyEnabled;

  return {
    documentsApproved,
    frontendPurchaseEnabled,
    localTestJourneyEnabled,
    frontendConditioningPurchaseEnabled,
    publicPurchaseEnabled,
    checkoutEnabled,
    conditioningCheckoutEnabled:
      checkoutEnabled && frontendConditioningPurchaseEnabled,
  };
}

export const MEMBERSHIP_PURCHASE_AVAILABILITY =
  resolveMembershipPurchaseAvailability({
    documentsApproved: CHECKOUT_DOCUMENTS_APPROVED_FOR_PUBLICATION,
    frontendPurchaseEnabled:
      isFrontendMembershipPurchaseEnabled(process.env),
    localTestJourneyEnabled: LOCAL_MEMBERSHIP_TEST_JOURNEY_ENABLED,
    frontendConditioningPurchaseEnabled:
      isFrontendConditioningPurchaseEnabled(process.env),
  });
