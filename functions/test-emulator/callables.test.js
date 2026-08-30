/* eslint-disable @typescript-eslint/no-var-requires, max-len, require-jsdoc */

const test = require("node:test");
const assert = require("node:assert/strict");
const admin = require("firebase-admin");
const {createHash} = require("node:crypto");
const functionsTest = require("firebase-functions-test")();
const functions = require("../lib/index");
const {
  reconcileMembershipFutureBookings,
} = require("../lib/membership");
const {
  CURRENT_WAIVER_ACKNOWLEDGEMENTS,
  CURRENT_WAIVER_VERSION,
} = require("../lib/authz");
const {
  createCommercialPlanSnapshot,
} = require("../lib/membershipPlans");

const projectId = process.env.GCLOUD_PROJECT || "alpha-wod-functions-test";
const db = admin.firestore();
const bootstrapUserProfile = functionsTest.wrap(functions.bootstrapUserProfile);
const acceptCurrentWaiver = functionsTest.wrap(functions.acceptCurrentWaiver);
const listStaffUsers = functionsTest.wrap(functions.listStaffUsers);
const setMemberEntitlement = functionsTest.wrap(functions.setMemberEntitlement);
const updateMemberRole = functionsTest.wrap(functions.updateMemberRole);
const getMonthlyLeaderboard = functionsTest.wrap(functions.getMonthlyLeaderboard);
const bookClass = functionsTest.wrap(functions.bookClass);
const cancelBooking = functionsTest.wrap(functions.cancelBooking);
const adminAddBooking = functionsTest.wrap(functions.adminAddBooking);
const checkInBooking = functionsTest.wrap(functions.checkInBooking);
const markBookingStatus = functionsTest.wrap(functions.markBookingStatus);
const getClassRoster = functionsTest.wrap(functions.getClassRoster);

function request(data, uid) {
  return {
    data,
    ...(uid ? {auth: {uid, token: {auth_time: 1, firebase: {
      sign_in_provider: "password",
    }}}} : {}),
    rawRequest: {get: () => "phase-0-emulator-test"},
    acceptsStreaming: false,
  };
}

async function clearEmulators() {
  const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  assert.ok(firestoreHost, "FIRESTORE_EMULATOR_HOST is required");
  assert.ok(authHost, "FIREBASE_AUTH_EMULATOR_HOST is required");
  await fetch(
    `http://${firestoreHost}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    {method: "DELETE"}
  );
  await fetch(`http://${authHost}/emulator/v1/projects/${projectId}/accounts`, {
    method: "DELETE",
  });
}

async function createAuthUser(uid, email = `${uid}@example.test`) {
  return admin.auth().createUser({uid, email, emailVerified: true});
}

function activeProfile(role, source) {
  return {
    role,
    approvalStatus: "approved",
    entitlementStatus: "active",
    entitlementSource: source,
    appAccessTier: "full",
    entitlementClassSlots: [],
    ...(source === "stripe" ? {entitlementPlanKey: "adult_unlimited"} : {}),
    alphaWodAccess: true,
  };
}

async function seedStripeBookingAuthority(uid, overrides = {}) {
  const subscriptionId = overrides.subscriptionId ?? `sub_${uid}`;
  const planKey = overrides.planKey ?? "adult_unlimited";
  const commercialTerms = overrides.commercialTerms ??
    createCommercialPlanSnapshot(planKey);
  const ownerId = createHash("sha256").update(uid).digest("hex");
  await db.collection("membershipEntitlementOwners").doc(ownerId).set({
    schemaVersion: 1,
    subscriptionId,
    userIdHash: ownerId,
    state: overrides.ownerState ?? "active",
  });
  await db.collection("memberships").doc(subscriptionId).set({
    schemaVersion: commercialTerms.catalogueSchemaVersion,
    subscriptionId,
    planKey,
    commercialTerms,
    entitlementTargetUid: overrides.entitlementTargetUid ?? uid,
    state: overrides.state ?? "active",
    grantsAlphaWodAccess: overrides.grantsAlphaWodAccess ?? true,
    providerContractStatus: overrides.providerContractStatus ?? "verified",
    cancelAt: overrides.cancelAt === undefined ? null : overrides.cancelAt,
    pastDueGraceEndsAt: overrides.pastDueGraceEndsAt ?? null,
  });
  return subscriptionId;
}

test.beforeEach(clearEmulators);
test.after(() => functionsTest.cleanup());

test("bootstrap rejects unauthenticated callers and creates fail-closed defaults", async () => {
  await assert.rejects(
    bootstrapUserProfile(request({displayName: "Attacker"})),
    (error) => error.code === "unauthenticated"
  );

  await createAuthUser("member");
  const result = await bootstrapUserProfile(request({displayName: "Member A"}, "member"));
  assert.equal(result.profile.role, "user");
  assert.equal(result.profile.approvalStatus, "pending");
  assert.equal(result.profile.entitlementStatus, "none");
  assert.equal(result.profile.entitlementSource, "none");
  assert.equal(result.profile.alphaWodAccess, false);

  const profile = (await db.collection("users").doc("member").get()).data();
  assert.equal(profile.name, "Member A");
  assert.equal(profile.role, "user");
  assert.equal(profile.approvalStatus, "pending");
  assert.equal(profile.alphaWodAccess, false);
});

test("admin boundaries use authoritative profiles and staff directory is projected", async () => {
  await Promise.all([createAuthUser("admin"), createAuthUser("member")]);
  await db.collection("users").doc("admin").set({
    ...activeProfile("admin", "staff"),
    name: "Admin",
    email: "admin@example.test",
    privateBillingId: "must-not-leak",
  });
  await db.collection("users").doc("member").set({
    ...activeProfile("user", "stripe"),
    name: "Member",
    email: "member@example.test",
    privateBillingId: "must-not-leak",
  });

  await assert.rejects(
    setMemberEntitlement(request({
      userId: "member",
      entitlementStatus: "restricted",
      entitlementSource: "manual",
    }, "member")),
    (error) => error.code === "permission-denied"
  );

  const directory = await listStaffUsers(request({}, "admin"));
  assert.equal(directory.users.length, 2);
  assert.equal(directory.users.some((user) => "privateBillingId" in user), false);
});

test("limited members and admins can book only the member's two conditioning slots", async () => {
  await Promise.all([
    createAuthUser("admin"),
    createAuthUser("limited"),
  ]);
  await db.collection("users").doc("admin").set({
    ...activeProfile("admin", "staff"),
    name: "Admin",
  });
  await db.collection("users").doc("limited").set({
    role: "user",
    approvalStatus: "approved",
    entitlementStatus: "active",
    entitlementSource: "stripe",
    entitlementPlanKey: "adult_conditioning",
    appAccessTier: "limited",
    entitlementClassSlots: ["monday_0600", "tuesday_1800"],
    alphaWodAccess: true,
    name: "Limited Member",
  });
  const legacyCommercialTerms = {
    ...createCommercialPlanSnapshot("adult_conditioning"),
    catalogueSchemaVersion: 6,
    selectedConditioningSlots: ["monday_0600", "tuesday_1800"],
  };
  delete legacyCommercialTerms.conditioningBookingPolicy;
  await seedStripeBookingAuthority("limited", {
    planKey: "adult_conditioning",
    commercialTerms: legacyCommercialTerms,
  });

  const seedClass = async (
    id,
    startIso,
    conditioningSlotKey,
    timezone = "Europe/London"
  ) => {
    const start = new Date(startIso);
    await db.collection("classes").doc(id).set({
      templateId: `template_${id}`,
      title: "Conditioning",
      timezone,
      startTime: admin.firestore.Timestamp.fromDate(start),
      endTime: admin.firestore.Timestamp.fromMillis(start.getTime() + 3600000),
      coachId: "coach",
      coachName: "Coach",
      capacity: 10,
      bookedCount: 0,
      location: "Gym",
      status: "scheduled",
      ...(conditioningSlotKey !== undefined ? {conditioningSlotKey} : {}),
      createdAt: admin.firestore.Timestamp.now(),
    });
  };
  // Missing explicit metadata exercises the conservative exact-time resolver.
  await seedClass("monday", "2099-01-05T06:00:00.000Z");
  await seedClass("tuesday", "2099-01-06T18:00:00.000Z", "tuesday_1800");
  await seedClass("thursday", "2099-01-08T18:00:00.000Z", "thursday_1800");
  await seedClass("mismatched", "2099-01-08T18:00:00.000Z", "monday_0600");
  await seedClass("explicit-null", "2099-01-05T06:00:00.000Z", null);
  await seedClass(
    "non-london",
    "2099-01-05T06:00:00.000Z",
    undefined,
    "America/New_York"
  );

  assert.deepEqual(await bookClass(request({classId: "monday"}, "limited")), {
    success: true,
  });
  assert.deepEqual(await adminAddBooking(request({
    classId: "tuesday",
    userId: "limited",
  }, "admin")), {success: true});

  await assert.rejects(
    () => bookClass(request({classId: "thursday"}, "limited")),
    (error) => error.code === "permission-denied" &&
      error.details?.reason === "conditioning_slot_not_selected" &&
      error.details?.classConditioningSlotKey === "thursday_1800"
  );
  await assert.rejects(
    () => adminAddBooking(request({
      classId: "mismatched",
      userId: "limited",
    }, "admin")),
    (error) => error.code === "permission-denied" &&
      error.details?.reason === "class_not_conditioning_membership_slot"
  );
  for (const classId of ["explicit-null", "non-london"]) {
    await assert.rejects(
      () => bookClass(request({classId}, "limited")),
      (error) => error.code === "permission-denied" &&
        error.details?.reason === "class_not_conditioning_membership_slot"
    );
  }
});

test("flexible Conditioning quota serializes weekly bookings and every cancellation path releases it", async () => {
  await Promise.all([createAuthUser("admin"), createAuthUser("flexible")]);
  await db.collection("users").doc("admin").set({
    ...activeProfile("admin", "staff"),
    name: "Admin",
  });
  await db.collection("users").doc("flexible").set({
    role: "user",
    approvalStatus: "approved",
    entitlementStatus: "active",
    entitlementSource: "stripe",
    entitlementPlanKey: "adult_conditioning",
    appAccessTier: "limited",
    entitlementClassSlots: [
      "monday_0600",
      "tuesday_1800",
      "thursday_1800",
      "friday_0530",
    ],
    entitlementWeeklyBookingLimit: 2,
    alphaWodAccess: true,
    name: "Flexible Member",
  });
  await seedStripeBookingAuthority("flexible", {
    planKey: "adult_conditioning",
  });

  const classes = [
    ["flex-monday", "2099-01-05T06:00:00.000Z", "monday_0600"],
    ["flex-tuesday", "2099-01-06T18:00:00.000Z", "tuesday_1800"],
    ["flex-thursday", "2099-01-08T18:00:00.000Z", "thursday_1800"],
    ["flex-friday", "2099-01-09T05:30:00.000Z", "friday_0530"],
    ["flex-next-monday", "2099-01-12T06:00:00.000Z", "monday_0600"],
  ];
  await Promise.all(classes.map(async ([id, startIso, conditioningSlotKey]) => {
    const start = new Date(startIso);
    await db.collection("classes").doc(id).set({
      templateId: `template_${id}`,
      title: "Conditioning",
      timezone: "Europe/London",
      startTime: admin.firestore.Timestamp.fromDate(start),
      endTime: admin.firestore.Timestamp.fromMillis(start.getTime() + 3600000),
      coachId: "coach",
      coachName: "Coach",
      capacity: 10,
      bookedCount: 0,
      location: "Gym",
      status: "scheduled",
      conditioningSlotKey,
      createdAt: admin.firestore.Timestamp.now(),
    });
  }));

  const initial = await Promise.all([
    bookClass(request({classId: "flex-monday"}, "flexible")),
    adminAddBooking(request({
      classId: "flex-tuesday",
      userId: "flexible",
    }, "admin")),
  ]);
  assert.deepEqual(initial, [{success: true}, {success: true}]);
  let usageSnap = await db.collection("conditioningWeeklyBookingUsage").get();
  assert.equal(usageSnap.size, 1);
  assert.equal(usageSnap.docs[0].get("bookedCount"), 2);

  await markBookingStatus(request({
    classId: "flex-tuesday",
    userId: "flexible",
    status: "dip",
  }, "admin"));
  usageSnap = await db.collection("conditioningWeeklyBookingUsage").get();
  assert.equal(usageSnap.docs[0].get("bookedCount"), 2);

  await assert.rejects(
    () => bookClass(request({classId: "flex-thursday"}, "flexible")),
    (error) => error.details?.reason ===
      "conditioning_weekly_booking_limit_reached" &&
      error.details?.weeklyBookingLimit === 2 &&
      error.details?.timezone === "Europe/London"
  );

  await cancelBooking(request({classId: "flex-monday"}, "flexible"));
  usageSnap = await db.collection("conditioningWeeklyBookingUsage").get();
  assert.equal(usageSnap.docs[0].get("bookedCount"), 1);

  const raced = await Promise.allSettled([
    bookClass(request({classId: "flex-thursday"}, "flexible")),
    bookClass(request({classId: "flex-friday"}, "flexible")),
  ]);
  assert.equal(raced.filter(({status}) => status === "fulfilled").length, 1);
  const rejection = raced.find(({status}) => status === "rejected");
  assert.equal(
    rejection.reason.details?.reason,
    "conditioning_weekly_booking_limit_reached"
  );
  const successfulClassId = raced[0].status === "fulfilled" ?
    "flex-thursday" : "flex-friday";
  const rejectedClassId = successfulClassId === "flex-thursday" ?
    "flex-friday" : "flex-thursday";

  await markBookingStatus(request({
    classId: successfulClassId,
    userId: "flexible",
    status: "authorised_absence",
  }, "admin"));
  usageSnap = await db.collection("conditioningWeeklyBookingUsage").get();
  assert.equal(usageSnap.docs[0].get("bookedCount"), 1);

  assert.deepEqual(
    await bookClass(request({classId: rejectedClassId}, "flexible")),
    {success: true}
  );
  usageSnap = await db.collection("conditioningWeeklyBookingUsage").get();
  assert.equal(usageSnap.docs[0].get("bookedCount"), 2);
  assert.deepEqual(usageSnap.docs[0].get("activeBookingIds").sort(), [
    "flex-tuesday_flexible",
    `${rejectedClassId}_flexible`,
  ].sort());

  assert.deepEqual(
    await bookClass(request({classId: "flex-next-monday"}, "flexible")),
    {success: true}
  );
  usageSnap = await db.collection("conditioningWeeklyBookingUsage").get();
  assert.equal(usageSnap.size, 2);
  const nextWeekUsage = usageSnap.docs.find(
    (doc) => doc.get("weekKey") === "2099-01-12"
  );
  assert.ok(nextWeekUsage);
  assert.equal(nextWeekUsage.get("bookedCount"), 1);
});

test("membership cleanup releases a flexible Conditioning weekly quota atomically", async () => {
  await createAuthUser("cleanup-flexible");
  await db.collection("users").doc("cleanup-flexible").set({
    role: "user",
    approvalStatus: "approved",
    entitlementStatus: "active",
    entitlementSource: "stripe",
    entitlementPlanKey: "adult_conditioning",
    appAccessTier: "limited",
    entitlementClassSlots: [
      "monday_0600",
      "tuesday_1800",
      "thursday_1800",
      "friday_0530",
    ],
    entitlementWeeklyBookingLimit: 2,
    alphaWodAccess: true,
    name: "Cleanup Flexible",
  });
  const subscriptionId = await seedStripeBookingAuthority(
    "cleanup-flexible",
    {planKey: "adult_conditioning"}
  );
  const start = new Date("2099-01-05T06:00:00.000Z");
  await db.collection("classes").doc("cleanup-flex-class").set({
    templateId: "template_cleanup_flex",
    title: "Conditioning",
    timezone: "Europe/London",
    startTime: admin.firestore.Timestamp.fromDate(start),
    endTime: admin.firestore.Timestamp.fromMillis(start.getTime() + 3600000),
    coachId: "coach",
    coachName: "Coach",
    capacity: 10,
    bookedCount: 0,
    location: "Gym",
    status: "scheduled",
    conditioningSlotKey: "monday_0600",
    createdAt: admin.firestore.Timestamp.now(),
  });
  await bookClass(request({classId: "cleanup-flex-class"}, "cleanup-flexible"));
  const membershipRef = db.collection("memberships").doc(subscriptionId);
  await membershipRef.set({state: "cancelled"}, {merge: true});

  await reconcileMembershipFutureBookings(membershipRef, Date.now());

  const booking = await db.collection("bookings")
    .doc("cleanup-flex-class_cleanup-flexible").get();
  assert.equal(booking.get("status"), "cancelled");
  assert.equal(booking.get("cancelledReason"), "membership_ineligible");
  const usage = await db.collection("conditioningWeeklyBookingUsage").get();
  assert.equal(usage.size, 1);
  assert.equal(usage.docs[0].get("bookedCount"), 0);
  assert.deepEqual(usage.docs[0].get("activeBookingIds"), []);
});

test("Stripe membership booking uses the cancellation and grace horizons", async () => {
  await Promise.all([
    createAuthUser("admin"),
    createAuthUser("horizon-member"),
  ]);
  await db.collection("users").doc("admin").set({
    ...activeProfile("admin", "staff"),
    name: "Admin",
  });
  await db.collection("users").doc("horizon-member").set({
    ...activeProfile("user", "stripe"),
    name: "Horizon Member",
  });
  const subscriptionId = await seedStripeBookingAuthority("horizon-member");
  const membershipRef = db.collection("memberships").doc(subscriptionId);
  const cutoffMillis = Date.parse("2099-06-01T12:00:00.000Z");
  await membershipRef.set({
    cancelAt: cutoffMillis / 1000,
    // A current-period end is not itself a booking cap.
    currentPeriodEnd: Math.floor(cutoffMillis / 1000) - 3600,
  }, {merge: true});

  const seedClass = async (id, startMillis) => {
    await db.collection("classes").doc(id).set({
      templateId: `template_${id}`,
      title: "Open Gym",
      timezone: "Europe/London",
      startTime: admin.firestore.Timestamp.fromMillis(startMillis),
      endTime: admin.firestore.Timestamp.fromMillis(startMillis + 3600000),
      coachId: "coach",
      coachName: "Coach",
      capacity: 10,
      bookedCount: 0,
      location: "Gym",
      status: "scheduled",
      createdAt: admin.firestore.Timestamp.now(),
    });
  };
  await seedClass("cutoff-before-member", cutoffMillis - 1);
  await seedClass("cutoff-before-admin", cutoffMillis - 1);
  await seedClass("cutoff-at", cutoffMillis);
  await seedClass("cutoff-after", cutoffMillis + 1);

  assert.deepEqual(await bookClass(request({
    classId: "cutoff-before-member",
  }, "horizon-member")), {success: true});
  assert.deepEqual(await adminAddBooking(request({
    classId: "cutoff-before-admin",
    userId: "horizon-member",
  }, "admin")), {success: true});
  await assert.rejects(
    bookClass(request({classId: "cutoff-at"}, "horizon-member")),
    (error) => error.code === "permission-denied" &&
      error.details?.reason === "stripe_membership_booking_ineligible"
  );
  await assert.rejects(
    adminAddBooking(request({
      classId: "cutoff-after",
      userId: "horizon-member",
    }, "admin")),
    (error) => error.code === "permission-denied" &&
      error.details?.reason === "stripe_membership_booking_ineligible"
  );

  await membershipRef.set({cancelAt: null}, {merge: true});
  assert.deepEqual(await bookClass(request({
    classId: "cutoff-after",
  }, "horizon-member")), {success: true});

  const graceEndsAtMillis = Date.parse("2099-07-01T23:59:59.999Z");
  await membershipRef.set({
    state: "past_due_grace",
    pastDueGraceEndsAt: admin.firestore.Timestamp.fromMillis(graceEndsAtMillis),
  }, {merge: true});
  await seedClass("grace-at", graceEndsAtMillis);
  await seedClass("grace-after", graceEndsAtMillis + 1);
  assert.deepEqual(await bookClass(request({
    classId: "grace-at",
  }, "horizon-member")), {success: true});
  await assert.rejects(
    adminAddBooking(request({
      classId: "grace-after",
      userId: "horizon-member",
    }, "admin")),
    (error) => error.code === "permission-denied" &&
      error.details?.reason === "stripe_membership_booking_ineligible"
  );

  await membershipRef.set({
    state: "active",
    cancelAt: null,
    pastDueGraceEndsAt: null,
    cancellationRequest: {
      id: "cancel_horizon_member",
      kind: "contractual",
      status: "pending",
      receivedAt: admin.firestore.Timestamp.now(),
      outcome: {cancelAtUnixSeconds: cutoffMillis / 1000},
    },
  }, {merge: true});
  await seedClass("accepted-cancellation-before", cutoffMillis - 1);
  await seedClass("accepted-cancellation-at", cutoffMillis);
  assert.deepEqual(await bookClass(request({
    classId: "accepted-cancellation-before",
  }, "horizon-member")), {success: true});
  await assert.rejects(
    bookClass(request({classId: "accepted-cancellation-at"}, "horizon-member")),
    (error) => error.code === "permission-denied" &&
      error.details?.reason === "stripe_membership_booking_ineligible"
  );

  const coolingOffAccessEndMillis = cutoffMillis + 500;
  await membershipRef.set({
    cancellationRequest: {
      id: "cooling_off_horizon_member",
      kind: "cooling_off",
      status: "pending",
      receivedAt: admin.firestore.Timestamp.now(),
      accessEndsAtMillis: coolingOffAccessEndMillis,
      outcome: {cancelAtUnixSeconds: Math.floor(coolingOffAccessEndMillis / 1000) + 3600},
    },
  }, {merge: true});
  await seedClass("cooling-off-before", coolingOffAccessEndMillis - 1);
  await seedClass("cooling-off-at", coolingOffAccessEndMillis);
  assert.deepEqual(await bookClass(request({
    classId: "cooling-off-before",
  }, "horizon-member")), {success: true});
  await assert.rejects(
    bookClass(request({classId: "cooling-off-at"}, "horizon-member")),
    (error) => error.code === "permission-denied" &&
      error.details?.reason === "stripe_membership_booking_ineligible"
  );

  await membershipRef.set({
    cancellationRequest: {
      id: "cancel_horizon_member_malformed",
      kind: "contractual",
      status: "manual_review",
      receivedAt: admin.firestore.Timestamp.now(),
      outcome: {},
    },
  }, {merge: true});
  await assert.rejects(
    bookClass(request({classId: "accepted-cancellation-before"}, "horizon-member")),
    (error) => error.code === "permission-denied" &&
      error.details?.reason === "stripe_membership_booking_ineligible"
  );

  const replacementSubscriptionId = "sub_replacement_generation";
  const ownerId = createHash("sha256").update("horizon-member").digest("hex");
  await db.collection("memberships").doc(replacementSubscriptionId).set({
    subscriptionId: replacementSubscriptionId,
    entitlementTargetUid: "different-user",
    state: "active",
    grantsAlphaWodAccess: true,
    providerContractStatus: "verified",
    cancelAt: null,
    pastDueGraceEndsAt: null,
  });
  await db.collection("membershipEntitlementOwners").doc(ownerId).set({
    subscriptionId: replacementSubscriptionId,
    state: "active",
  }, {merge: true});
  await seedClass("owner-replacement-race", graceEndsAtMillis - 1);
  await assert.rejects(
    bookClass(request({classId: "owner-replacement-race"}, "horizon-member")),
    (error) => error.code === "permission-denied" &&
      error.details?.reason === "stripe_membership_booking_ineligible"
  );
});

test("membership reconciliation cancels uncovered future bookings exactly once", async () => {
  await createAuthUser("cleanup-member");
  await db.collection("users").doc("cleanup-member").set({
    ...activeProfile("user", "stripe"),
    name: "Cleanup Member",
  });
  const subscriptionId = await seedStripeBookingAuthority("cleanup-member");
  const membershipRef = db.collection("memberships").doc(subscriptionId);
  const nowMillis = Date.parse("2099-08-01T00:00:00.000Z");
  const cutoffMillis = Date.parse("2099-08-08T12:00:00.000Z");
  await membershipRef.set({
    cancellationRequest: {
      id: "cancel_cleanup_member",
      kind: "contractual",
      status: "manual_review",
      receivedAt: admin.firestore.Timestamp.fromMillis(nowMillis),
      outcome: {cancelAtUnixSeconds: cutoffMillis / 1000},
    },
  }, {merge: true});

  const seedBooking = async ({
    suffix,
    startMillis,
    binding = subscriptionId,
    bookingKind = "member",
  }) => {
    const classId = `cleanup-class-${suffix}`;
    const bookingId = `cleanup-booking-${suffix}`;
    await db.collection("classes").doc(classId).set({
      startTime: admin.firestore.Timestamp.fromMillis(startMillis),
      endTime: admin.firestore.Timestamp.fromMillis(startMillis + 3600000),
      capacity: 10,
      bookedCount: 1,
      status: "scheduled",
    });
    await db.collection("bookings").doc(bookingId).set({
      classId,
      userId: "cleanup-member",
      userName: "Cleanup Member",
      status: "booked",
      bookingKind,
      ...(binding === null ? {} : {entitlementSubscriptionId: binding}),
      createdAt: admin.firestore.Timestamp.fromMillis(nowMillis),
    });
    return {classId, bookingId};
  };

  const covered = await seedBooking({
    suffix: "covered",
    startMillis: cutoffMillis - 1,
  });
  const bound = await seedBooking({
    suffix: "bound",
    startMillis: cutoffMillis,
  });
  const legacy = await seedBooking({
    suffix: "legacy",
    startMillis: cutoffMillis + 1,
    binding: null,
  });
  const replacement = await seedBooking({
    suffix: "replacement",
    startMillis: cutoffMillis + 1,
    binding: "sub_replacement",
  });
  const guest = await seedBooking({
    suffix: "guest",
    startMillis: cutoffMillis + 1,
    bookingKind: "payg_guest",
  });

  await reconcileMembershipFutureBookings(membershipRef, nowMillis);
  await reconcileMembershipFutureBookings(membershipRef, nowMillis);

  for (const target of [bound, legacy]) {
    const booking = await db.collection("bookings").doc(target.bookingId).get();
    assert.equal(booking.get("status"), "cancelled");
    assert.equal(booking.get("cancelledReason"), "membership_ineligible");
    assert.equal(
      (await db.collection("classes").doc(target.classId).get()).get("bookedCount"),
      0
    );
  }
  for (const target of [covered, replacement, guest]) {
    assert.equal(
      (await db.collection("bookings").doc(target.bookingId).get()).get("status"),
      "booked"
    );
    assert.equal(
      (await db.collection("classes").doc(target.classId).get()).get("bookedCount"),
      1
    );
  }
  const cleanupJob = await db.collection("membershipBookingCleanupJobs")
    .doc(subscriptionId).get();
  assert.equal(cleanupJob.get("status"), "complete");
  assert.equal(cleanupJob.get("processedCount"), 5);
  assert.equal(cleanupJob.get("cancelledCount"), 2);
});

test("roster and attendance fail closed for an out-of-horizon member booking", async () => {
  await Promise.all([
    createAuthUser("admin"),
    createAuthUser("stale-booking-member"),
  ]);
  await db.collection("users").doc("admin").set({
    ...activeProfile("admin", "staff"),
    name: "Admin",
  });
  await db.collection("users").doc("stale-booking-member").set({
    ...activeProfile("user", "stripe"),
    name: "Stale Booking Member",
  });
  const cutoffMillis = Date.parse("2099-08-01T12:00:00.000Z");
  const subscriptionId = await seedStripeBookingAuthority("stale-booking-member", {
    cancelAt: cutoffMillis / 1000,
  });
  const classId = "stale-membership-class";
  const bookingId = `${classId}_stale-booking-member`;
  await db.collection("classes").doc(classId).set({
    templateId: "template_stale_membership_class",
    title: "Open Gym",
    timezone: "Europe/London",
    startTime: admin.firestore.Timestamp.fromMillis(cutoffMillis),
    endTime: admin.firestore.Timestamp.fromMillis(cutoffMillis + 3600000),
    coachId: "coach",
    coachName: "Coach",
    capacity: 10,
    bookedCount: 1,
    location: "Gym",
    status: "scheduled",
    createdAt: admin.firestore.Timestamp.now(),
  });
  await db.collection("bookings").doc(bookingId).set({
    classId,
    userId: "stale-booking-member",
    userName: "Stale Booking Member",
    status: "booked",
    bookingKind: "member",
    entitlementSubscriptionId: subscriptionId,
    createdAt: admin.firestore.Timestamp.now(),
    attendanceStatus: "none",
    attended: false,
  });

  const roster = await getClassRoster(request({classId}, "admin"));
  assert.equal(roster.total, 0);
  assert.deepEqual(roster.attendees, []);
  for (const action of [
    () => checkInBooking(request({bookingId, attended: true}, "admin")),
    () => markBookingStatus(request({bookingId, status: "checked_in"}, "admin")),
  ]) {
    await assert.rejects(
      action,
      (error) => error.code === "permission-denied" &&
        error.details?.reason === "stripe_membership_booking_ineligible"
    );
  }
  assert.equal(
    (await db.collection("bookings").doc(bookingId).get()).get("status"),
    "booked"
  );
  assert.equal(
    (await db.collection("classes").doc(classId).get()).get("bookedCount"),
    1
  );
});

test("PAYG guest roster and attendance never create member stats or leaderboard rows", async () => {
  await createAuthUser("admin");
  await db.collection("users").doc("admin").set({
    ...activeProfile("admin", "staff"),
    name: "Admin",
  });
  const classId = "payg-class";
  const orderId = `payg_${"a".repeat(64)}`;
  const duplicateLockId = "c".repeat(64);
  const bookingId = `payg_guest_${"a".repeat(64)}`;
  const syntheticUserId = `payg_guest_${"b".repeat(40)}`;
  const start = new Date("2099-01-05T18:00:00.000Z");
  const end = new Date("2099-01-05T19:00:00.000Z");
  await db.collection("classes").doc(classId).set({
    templateId: "payg-template",
    title: "Conditioning",
    timezone: "Europe/London",
    startTime: admin.firestore.Timestamp.fromDate(start),
    endTime: admin.firestore.Timestamp.fromDate(end),
    coachId: "coach",
    coachName: "Coach",
    capacity: 10,
    bookedCount: 1,
    location: "Gym",
    status: "scheduled",
    createdAt: admin.firestore.Timestamp.now(),
  });
  await db.collection("bookings").doc(bookingId).set({
    classId,
    userId: syntheticUserId,
    userName: "Guest Person",
    status: "booked",
    bookingKind: "payg_guest",
    isGuestBooking: true,
    paygOrderId: orderId,
    attendanceStatus: "none",
    attended: false,
    checkedInAt: null,
    checkedInBy: null,
    createdAt: admin.firestore.Timestamp.now(),
  });
  await db.collection("paygOrders").doc(orderId).set({
    schemaVersion: 1,
    orderId,
    offeringKey: "adult_payg_class",
    purchaseKind: "payg_class",
    status: "confirmed",
    capacityState: "held",
    bookingId,
    duplicateLockId,
    class: {classId, title: "Conditioning"},
    classStartMillis: start.getTime(),
    classEndMillis: end.getTime(),
    attendee: {fullName: "Guest Person", dateOfBirth: "1990-01-01"},
    contact: {email: "guest@example.test", phone: "+447700900123"},
  });
  await db.collection("paygCheckoutLocks").doc(duplicateLockId).set({
    duplicateLockId,
    orderId,
    state: "confirmed",
  });

  const roster = await getClassRoster(request({classId}, "admin"));
  assert.equal(roster.total, 1);
  assert.deepEqual(roster.attendees.map((attendee) => ({
    bookingId: attendee.bookingId,
    bookingKind: attendee.bookingKind,
    isGuestBooking: attendee.isGuestBooking,
    paygOrderId: attendee.paygOrderId,
    userName: attendee.userName,
    email: attendee.email,
  })), [{
    bookingId,
    bookingKind: "payg_guest",
    isGuestBooking: true,
    paygOrderId: orderId,
    userName: "Guest Person",
    email: "",
  }]);

  const realDateNow = Date.now;
  try {
    Date.now = () => start.getTime() - 30 * 60 * 1000 - 1;
    await assert.rejects(
      checkInBooking(request({bookingId, attended: true}, "admin")),
      (error) => error.code === "failed-precondition" &&
        error.details?.reason === "payg_check_in_outside_window"
    );
    Date.now = () => end.getTime() - 1;
    await assert.rejects(
      markBookingStatus(request({bookingId, status: "dip"}, "admin")),
      (error) => error.code === "failed-precondition" &&
        error.details?.reason === "payg_no_show_too_early"
    );
    assert.equal(
      (await db.collection("paygOrders").doc(orderId).get()).get("status"),
      "confirmed"
    );
    assert.equal(
      (await db.collection("paygCheckoutLocks").doc(duplicateLockId).get()).exists,
      true
    );

    // Both trusted boundaries are inclusive.
    Date.now = () => start.getTime() - 30 * 60 * 1000;
    await checkInBooking(request({bookingId, attended: true}, "admin"));
    assert.equal((await db.collection("bookings").doc(bookingId).get()).get("attended"), true);
    assert.equal((await db.collection("paygOrders").doc(orderId).get()).get("status"), "attended");
    assert.equal(
      (await db.collection("paygCheckoutLocks").doc(duplicateLockId).get()).exists,
      true
    );
    assert.equal((await db.collection("users").doc(syntheticUserId).get()).exists, false);
    assert.equal((await db.collection("leaderboards").get()).empty, true);

    Date.now = () => end.getTime();
    await markBookingStatus(request({bookingId, status: "dip"}, "admin"));
    const noShowOrder = await db.collection("paygOrders").doc(orderId).get();
    assert.equal(noShowOrder.get("status"), "no_show");
    assert.equal(noShowOrder.get("capacityState"), "consumed");
    assert.equal(noShowOrder.get("noShowReviewAt"), undefined);
    assert.equal(
      (await db.collection("paygCheckoutLocks").doc(duplicateLockId).get()).exists,
      false
    );

    await assert.rejects(
      markBookingStatus(request({bookingId, status: "booked"}, "admin")),
      (error) => error.code === "failed-precondition" &&
        /can no longer have its attendance changed/i.test(error.message)
    );
    // A staff correction at the inclusive class-end boundary can recover an
    // attendee from no-show without changing refund eligibility or recreating
    // a duplicate lock after checkout has closed.
    await checkInBooking(request({bookingId, attended: true}, "admin"));
    const correctedOrder = await db.collection("paygOrders").doc(orderId).get();
    assert.equal(correctedOrder.get("status"), "attended");
    assert.equal(correctedOrder.get("attendanceCorrectedFrom"), "no_show");
    assert.equal(correctedOrder.get("attendanceCorrectedBy"), "admin");
    assert.equal(
      (await db.collection("paygCheckoutLocks").doc(duplicateLockId).get()).exists,
      false
    );
    await assert.rejects(
      markBookingStatus(request({bookingId, status: "authorised_absence"}, "admin")),
      (error) => error.code === "failed-precondition" && /PAYG cancellation flow/i.test(
        error.message
      )
    );
  } finally {
    Date.now = realDateNow;
  }
});

test("admin entitlement changes cannot forge Stripe or legacy provenance", async () => {
  await Promise.all([createAuthUser("admin"), createAuthUser("member")]);
  await db.collection("users").doc("admin").set({
    ...activeProfile("admin", "staff"),
    name: "Admin",
    email: "admin@example.test",
  });
  const memberRef = db.collection("users").doc("member");
  await memberRef.set({
    role: "user",
    approvalStatus: "approved",
    entitlementStatus: "none",
    entitlementSource: "none",
    alphaWodAccess: false,
  });

  for (const forgedSource of ["stripe", "legacy"]) {
    await assert.rejects(
      setMemberEntitlement(request({
        userId: "member",
        entitlementStatus: "active",
        entitlementSource: forgedSource,
      }, "admin")),
      (error) => error.code === "invalid-argument" && /source manual/i.test(error.message)
    );
  }
  assert.equal((await memberRef.get()).get("entitlementSource"), "none");
  assert.equal((await memberRef.get()).get("entitlementUpdatedAt"), undefined);

  const applied = await setMemberEntitlement(request({
    userId: "member",
    entitlementStatus: "active",
    entitlementSource: "manual",
  }, "admin"));
  assert.equal(applied.entitlementSource, "manual");
  assert.equal((await memberRef.get()).get("entitlementSource"), "manual");

  const removed = await setMemberEntitlement(request({
    userId: "member",
    entitlementStatus: "none",
    entitlementSource: "none",
  }, "admin"));
  assert.equal(removed.entitlementSource, "none");
  assert.equal((await memberRef.get()).get("entitlementSource"), "none");
});

test("manual entitlement changes cannot bypass an active Stripe owner generation", async () => {
  await Promise.all([createAuthUser("admin"), createAuthUser("member")]);
  await db.collection("users").doc("admin").set({
    ...activeProfile("admin", "staff"),
    name: "Admin",
    email: "admin@example.test",
  });
  const memberRef = db.collection("users").doc("member");
  await memberRef.set({
    ...activeProfile("user", "stripe"),
    name: "Member",
    email: "member@example.test",
  });
  const ownerRef = db.collection("membershipEntitlementOwners")
    .doc(require("node:crypto").createHash("sha256").update("member").digest("hex"));
  await ownerRef.set({
    schemaVersion: 1,
    subscriptionId: "sub_active_membership",
    state: "active",
  });

  await assert.rejects(
    setMemberEntitlement(request({
      userId: "member",
      entitlementStatus: "restricted",
      entitlementSource: "manual",
      reason: "Temporary support restriction",
    }, "admin")),
    (error) => error.code === "failed-precondition" && /active Stripe/i.test(error.message)
  );
  assert.equal((await memberRef.get()).get("entitlementSource"), "stripe");

  await ownerRef.set({state: "released"}, {merge: true});
  const applied = await setMemberEntitlement(request({
    userId: "member",
    entitlementStatus: "restricted",
    entitlementSource: "manual",
    reason: "Temporary support restriction",
  }, "admin"));
  assert.equal(applied.entitlementStatus, "restricted");
  assert.equal((await memberRef.get()).get("entitlementSource"), "manual");
});

test("role changes cannot bypass an active Conditioning entitlement owner", async () => {
  await Promise.all([createAuthUser("admin"), createAuthUser("member")]);
  await db.collection("users").doc("admin").set({
    ...activeProfile("admin", "staff"),
    name: "Admin",
  });
  const memberRef = db.collection("users").doc("member");
  await memberRef.set({
    role: "user",
    approvalStatus: "approved",
    entitlementStatus: "active",
    entitlementSource: "stripe",
    entitlementPlanKey: "adult_conditioning",
    appAccessTier: "limited",
    entitlementClassSlots: ["monday_0600", "friday_0530"],
    alphaWodAccess: true,
    name: "Conditioning Member",
  });
  const ownerRef = db.collection("membershipEntitlementOwners")
    .doc(require("node:crypto").createHash("sha256").update("member").digest("hex"));
  await ownerRef.set({
    schemaVersion: 6,
    subscriptionId: "sub_conditioning",
    state: "active",
  });

  for (const role of ["banned", "sgpt"]) {
    await assert.rejects(
      updateMemberRole(request({userId: "member", role}, "admin")),
      (error) => error.code === "failed-precondition" &&
        /active Stripe entitlement/i.test(error.message)
    );
    assert.equal((await memberRef.get()).get("role"), "user");
  }

  await memberRef.set({
    role: "banned",
    approvalStatus: "approved",
    entitlementStatus: "restricted",
    entitlementSource: "manual",
    appAccessTier: "none",
    entitlementClassSlots: [],
    alphaWodAccess: false,
  }, {merge: true});
  await assert.rejects(
    updateMemberRole(request({userId: "member", role: "user"}, "admin")),
    (error) => error.code === "failed-precondition" &&
      /active Stripe entitlement/i.test(error.message)
  );

  await memberRef.set({
    role: "sgpt",
    entitlementStatus: "active",
    entitlementSource: "staff",
    appAccessTier: "full",
    entitlementClassSlots: [],
    alphaWodAccess: true,
  }, {merge: true});
  await assert.rejects(
    updateMemberRole(request({userId: "member", role: "user"}, "admin")),
    (error) => error.code === "failed-precondition" &&
      /active Stripe entitlement/i.test(error.message)
  );

  await ownerRef.set({state: "released"}, {merge: true});
  await updateMemberRole(request({userId: "member", role: "user"}, "admin"));
  const releasedProfile = await memberRef.get();
  assert.equal(releasedProfile.get("role"), "user");
  assert.equal(releasedProfile.get("entitlementStatus"), "none");
  assert.equal(releasedProfile.get("alphaWodAccess"), false);
});

test("canonical waiver evidence is immutable across a retry", async () => {
  await createAuthUser("member");
  await bootstrapUserProfile(request({displayName: "Member A"}, "member"));
  const first = await acceptCurrentWaiver(request({
    signedName: "Member A",
    version: CURRENT_WAIVER_VERSION,
    acknowledgements: [...CURRENT_WAIVER_ACKNOWLEDGEMENTS],
    mediaConsent: false,
  }, "member"));
  assert.equal(first.alreadyAccepted, false);

  const acceptanceRef = db.collection("waiverAcceptances")
    .doc(`member__${CURRENT_WAIVER_VERSION}`);
  const original = (await acceptanceRef.get()).data();
  const retry = await acceptCurrentWaiver(request({
    signedName: "Changed Name",
    version: CURRENT_WAIVER_VERSION,
    acknowledgements: [...CURRENT_WAIVER_ACKNOWLEDGEMENTS],
    mediaConsent: true,
  }, "member"));
  const afterRetry = (await acceptanceRef.get()).data();
  assert.equal(retry.alreadyAccepted, true);
  assert.equal(afterRetry.acceptedName, original.acceptedName);
  assert.equal(afterRetry.mediaConsent, original.mediaConsent);
});

test("invalid canonical-ID waiver evidence fails closed", async () => {
  await createAuthUser("member");
  await bootstrapUserProfile(request({displayName: "Member A"}, "member"));
  await db.collection("waiverAcceptances")
    .doc(`member__${CURRENT_WAIVER_VERSION}`)
    .set({
      acceptanceSchemaVersion: 1,
      userId: "member",
      version: CURRENT_WAIVER_VERSION,
      acceptedAt: admin.firestore.Timestamp.now(),
      source: "legacy_user_doc_migration",
    });

  await assert.rejects(
    acceptCurrentWaiver(request({
      signedName: "Member A",
      version: CURRENT_WAIVER_VERSION,
      acknowledgements: [...CURRENT_WAIVER_ACKNOWLEDGEMENTS],
      mediaConsent: false,
    }, "member")),
    (error) => error.code === "failed-precondition"
  );
  const profile = (await db.collection("users").doc("member").get()).data();
  assert.equal(profile.waiverAcceptedVersion, undefined);
  assert.equal(profile.waiverAcceptedAt, undefined);
});

test("leaderboard callable rejects abusive month keys before scanning", async () => {
  await createAuthUser("member");
  await db.collection("users").doc("member").set(activeProfile("user", "stripe"));
  await assert.rejects(
    getMonthlyLeaderboard(request({monthKey: "attacker-random-month"}, "member")),
    (error) => error.code === "invalid-argument"
  );
});

test("limited members cannot access leaderboard callables", async () => {
  await createAuthUser("limited");
  await db.collection("users").doc("limited").set({
    role: "user",
    approvalStatus: "approved",
    entitlementStatus: "active",
    entitlementSource: "stripe",
    entitlementPlanKey: "adult_conditioning",
    appAccessTier: "limited",
    entitlementClassSlots: ["monday_0600", "tuesday_1800"],
    alphaWodAccess: true,
  });
  await assert.rejects(
    getMonthlyLeaderboard(request({monthKey: "2026-08"}, "limited")),
    (error) => error.code === "permission-denied" &&
      error.details?.reason === "full_app_access_required"
  );
});

test("an out-of-order user event converges claims from the current restriction", async () => {
  await createAuthUser("member");
  const memberRef = db.collection("users").doc("member");
  await memberRef.set({
    role: "user",
    approvalStatus: "approved",
    entitlementStatus: "restricted",
    entitlementSource: "manual",
    // Simulate a stale derived marker left by an older active event.
    alphaWodAccess: true,
    accessSchemaVersion: 1,
  });
  await admin.auth().setCustomUserClaims("member", {
    role: "admin",
    approvalStatus: "approved",
    entitlementStatus: "active",
    entitlementSource: "staff",
    alphaWodAccess: true,
    externalTenant: "preserved",
  });

  await functions.onUserDocWritten.run({
    params: {userId: "member"},
    // The handler deliberately ignores this stale event image.
    data: {after: {exists: true, data: () => activeProfile("admin", "staff")}},
  });

  const profile = (await memberRef.get()).data();
  const authUser = await admin.auth().getUser("member");
  assert.equal(profile.alphaWodAccess, false);
  assert.equal(authUser.customClaims.role, "user");
  assert.equal(authUser.customClaims.entitlementStatus, "restricted");
  assert.equal(authUser.customClaims.alphaWodAccess, false);
  assert.equal(authUser.customClaims.restricted, true);
  assert.equal(authUser.customClaims.externalTenant, "preserved");
});
