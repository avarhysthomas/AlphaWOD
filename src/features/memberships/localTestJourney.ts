type PublicRuntimeEnvironment = {
  NODE_ENV?: string;
  REACT_APP_USE_EMULATORS?: string;
  REACT_APP_MEMBERSHIP_TEST_JOURNEY_ENABLED?: string;
  REACT_APP_FIREBASE_PROJECT_ID?: string;
};

export const LOCAL_STRIPE_TEST_PROJECT_ID = "demo-alphawod-stripe";

/**
 * The draft checkout is visible only in `npm start` against the dedicated
 * Firebase demo namespace and only after an explicit local opt-in. A
 * production build can never enable this presentation bypass.
 */
export function isLocalMembershipTestJourneyEnabled(
  environment: PublicRuntimeEnvironment
): boolean {
  return environment.NODE_ENV === "development" &&
    environment.REACT_APP_USE_EMULATORS === "true" &&
    environment.REACT_APP_MEMBERSHIP_TEST_JOURNEY_ENABLED === "true" &&
    environment.REACT_APP_FIREBASE_PROJECT_ID === LOCAL_STRIPE_TEST_PROJECT_ID;
}

export const LOCAL_MEMBERSHIP_TEST_JOURNEY_ENABLED =
  isLocalMembershipTestJourneyEnabled(process.env);
