import {
  LOCAL_STRIPE_TEST_PROJECT_ID,
  isLocalMembershipTestJourneyEnabled,
} from "./localTestJourney";

const enabledEnvironment = {
  NODE_ENV: "development",
  REACT_APP_USE_EMULATORS: "true",
  REACT_APP_MEMBERSHIP_TEST_JOURNEY_ENABLED: "true",
  REACT_APP_FIREBASE_PROJECT_ID: LOCAL_STRIPE_TEST_PROJECT_ID,
};

describe("local Stripe test journey guard", () => {
  it("opens presentation only for the explicit local demo project", () => {
    expect(isLocalMembershipTestJourneyEnabled(enabledEnvironment)).toBe(true);
  });

  it.each([
    ["production build", {NODE_ENV: "production"}],
    ["real Firebase transport", {REACT_APP_USE_EMULATORS: "false"}],
    ["missing opt-in", {REACT_APP_MEMBERSHIP_TEST_JOURNEY_ENABLED: "false"}],
    ["production project", {REACT_APP_FIREBASE_PROJECT_ID: "alphawod-d1f2f"}],
  ])("stays closed for %s", (_label, override) => {
    expect(isLocalMembershipTestJourneyEnabled({
      ...enabledEnvironment,
      ...override,
    })).toBe(false);
  });
});
