# Phase 0 access-control rollout

Status: implemented locally on 17 August 2026. Frontend and Functions
unit/build/lint checks pass. The latest emulator-backed callable and rules
suites must be rerun in an environment that can bind the Firebase emulator
ports before any live cutover. Nothing in this runbook has been deployed or run
against the live project.

## Security invariants

- Clients cannot create `users/{uid}` documents or write roles, approval,
  entitlement, waiver, billing, stats, or strength-block fields.
- New profiles are created by `bootstrapUserProfile` as
  `user / pending / none / no AlphaWOD access`.
- Ordinary users receive AlphaWOD access only with exact `approved`, `active`,
  an allowed source (`legacy`, `manual`, or `stripe`), and the server-derived
  `alphaWodAccess: true` marker.
- Admin and SGPT access requires exact `approved / active / staff` state.
- Firestore documents, not possibly stale ID-token claims, are authoritative
  for rules and callable Functions.
- A protected client session is not opened from Firestore's offline cache. The
  app requires a server-confirmed profile and closes its route gate whenever a
  live profile snapshot falls back to cache-only state.
- Complete custom claims are computed centrally and merged with unrelated
  claims rather than replacing them.
- Detailed waiver records are immutable and server-only. User profiles expose
  only the derived acceptance version and timestamp. Those markers survive the
  migration only when the exact current-version canonical callable record backs
  them.
- Historical client-writable waiver data is quarantined as explicitly
  non-authoritative; marker-only forgeries are included, and no legacy value is
  promoted into a canonical acceptance.
- Raw member documents are owner/admin-only. SGPT performance views use the
  `listStaffUsers` safe projection instead of direct collection access.

## Local verification

Run from the repository root:

```sh
CI=true npm test -- --watchAll=false
npm run build
npm test --prefix functions
npm run test:emulator --prefix functions
npm run lint --prefix functions
npm test --prefix rules-tests
npm run test:compat --prefix rules-tests
```

Current verification state:

- Frontend: 13 suites, 85 tests passed.
- Functions: build, lint, and 29 pure tests passed.
- Callable boundary, final Firestore/Storage, and temporary-lockdown emulator
  suites are implemented but require a fresh run after the final hardening
  changes. Expected rule-suite counts are 16 final and 6 temporary-lockdown
  tests; treat those counts as expectations, not fresh evidence.

## Required live preflight

Do not continue without explicit approval for live changes.

1. Schedule a maintenance window and notify staff. Callable transport and then
   protected Firestore/Storage data are deliberately closed while historical
   access is audited; do not present this as a no-downtime rollout.
2. Take recoverable Firestore and Firebase Auth exports. Store Auth exports as
   secrets because they contain personal data and password material.
3. Confirm the active CLI project and credentials are for `alphawod-d1f2f`.
4. Pin and verify Firebase CLI `15.5.1` for this rollout. The selective
   deployment below relies on that reviewed version's callable-update behavior;
   do not substitute a newer CLI without re-auditing its deployment plan/source.
5. Re-run every local verification command above from the exact release
   commit/worktree.
6. Choose a new, access-controlled path for the dry-run JSON report. The
   migration refuses to overwrite an existing report file.
7. With a Cloud Run Admin, inventory every deployed callable's underlying
   Cloud Run service, URL, and current public-invoker mechanism. Save the
   read-only service/IAM output as the restoration manifest. Cloud Run
   functions v2 use the Cloud Run Invoker role; a Firebase ID token alone does
   not satisfy a Cloud IAM-protected endpoint.
8. Read-only inspect whether organization policy
   `constraints/run.managed.requireInvokerIam` is enforced for the project. It
   is the preferred deployment-surviving extra control; if an operator proposes
   changing it, obtain separate Organization Policy approval. This runbook does
   not authorize that live change.
9. Activate the administrative change freeze when maintenance starts, before
   safe-deployment step 1, and keep it through migration completion. Do not edit
   `users/{uid}` profiles/access in the Firebase Console or through another
   Admin SDK; do not change Firebase Auth
   email, disabled state, or custom claims; and pause every external identity or
   custom-claim writer. The compatibility rules and callable IAM block constrain
   app clients, but they do not constrain Console users, service accounts, or
   another privileged backend. The migration aborts on a concurrent profile
   write, but the operational freeze is still required for a coherent audit.

## Safe deployment order

The order is deliberate. Callable transport is frozen first so an account with
a forged profile or stale privileged token cannot keep reaching a legacy
Admin-SDK handler during maintenance. Compatibility rules are then deployed
before any Function update so the legacy self-promotion route is closed.
Backfilling before the new Functions could let the legacy `onUserDocWritten`
trigger overwrite the new complete claims.

### 1. Start maintenance and block public invocation of every callable service

Firestore rules do not constrain the Admin SDK inside the currently deployed
Functions. Before changing client rules or auditing data, use the captured
service inventory to make each callable's underlying Cloud Run service require
IAM authentication and remove any `allUsers` or `allAuthenticatedUsers` Cloud
Run Invoker binding. For each exact callable service:

```sh
gcloud run services update CALLABLE_SERVICE \
  --invoker-iam-check \
  --region europe-west1 \
  --project alphawod-d1f2f

gcloud run services remove-iam-policy-binding CALLABLE_SERVICE \
  --member allUsers \
  --role roles/run.invoker \
  --region europe-west1 \
  --project alphawod-d1f2f
```

Repeat the removal command with `--member allAuthenticatedUsers` where that
special-principal binding exists. Run removal only for bindings present in the
captured IAM policy. Do not change Eventarc/scheduler service-account bindings.
Verify every callable URL returns an IAM 403 both without credentials and with
an ordinary Google identity that has no captured service binding before
continuing to step 2. Do not rely on UI maintenance or the next rules deployment
as an API lockdown. Keep callable ingress blocked through the complete backfill.
Official references: [Cloud Run access control](https://docs.cloud.google.com/run/docs/securing/managing-access)
and [Cloud Run functions authentication](https://docs.cloud.google.com/functions/docs/securing/authenticating).

### 2. Close the legacy Firestore/Storage exploits

```sh
firebase deploy \
  --config firebase.phase0-compat.json \
  --only firestore:rules,storage \
  --project alphawod-d1f2f
```

This temporary lockdown denies every client profile write, staff/list
privileges, and all protected app data. It also replaces the old public-read,
any-authenticated-write profile-picture policy with owner-only constrained
images. No historical `admin`, `sgpt`, or `approved` value is trusted yet. Do
not begin the audit until both this deployment and the step 1 callable freeze
have been independently verified.

### 3. Run the first read-only audit before deploying Functions

From `functions/`, using approved Application Default Credentials or a securely
stored service-account credential:

```sh
npm run backfill:claims -- \
  --project alphawod-d1f2f \
  --report /secure/new/path/phase-0-initial-audit.json
```

Independently verify every `accessGrantCandidates` entry against the real staff
and membership records. The vulnerable legacy system allowed a client to write
explicit `admin`, `sgpt`, `approved`, and even future-looking entitlement
fields, so none of those values is proof of legitimacy. If any candidate is
unexpected, keep maintenance active, remediate its Firestore profile and Auth
claims through an approved administrative process, then run and review a fresh
initial audit. Do not deploy the new Functions while a candidate is unresolved.

### 4. Update only the 18 existing Functions while their ingress remains blocked

```sh
firebase --version # must print 15.5.1

firebase deploy \
  --only functions:generateClassOccurrencesDaily,functions:generateClassOccurrences,functions:bookClass,functions:cancelBooking,functions:adminAddBooking,functions:checkInBooking,functions:onUserDocWritten,functions:markBookingStatus,functions:getClassRoster \
  --project alphawod-d1f2f

firebase deploy \
  --only functions:onLeaderboardEntryWritten,functions:getMonthlyLeaderboard,functions:reconcileMonthlyLeaderboard,functions:getMonthlyDipLeaderboard,functions:approveUserAccess,functions:updateMemberRole,functions:updateMemberStrengthBlock,functions:updateStrengthBlockSettings,functions:inviteMemberByEmail \
  --project alphawod-d1f2f
```

Do **not** use `--only functions` here: that would create four new callable
services and make them public before the backfill. CLI 15.5.1's reviewed
`updateV2Function` path does not rewrite the callable invoker policy, and Cloud
Run functions document that a subsequent deployment preserves the invocation
status. Selective deployment is also the supported Firebase CLI mechanism; the
two groups stay below the documented recommendation of ten functions per
deployment. References: [Cloud Run functions IAM](https://docs.cloud.google.com/functions/docs/securing/managing-access-iam),
[deploy specific Firebase functions](https://firebase.google.com/docs/functions/manage-functions#deploy_functions),
and [Cloud Run invoker organization policy](https://docs.cloud.google.com/run/docs/securing/managing-access#configure_org_policy).

After **each** group, re-run the read-only IAM inventory and prove every existing
callable URL is still IAM-blocked before continuing. If any existing callable's
invocation status changed, stop: do not rely on a post-deploy re-lock after an
unsafe revision may have been exposed. Accounts without backfilled entitlement
fields now fail closed in the updated Functions.

### 5. Generate the exact post-Functions migration report

From `functions/`, using approved Application Default Credentials or a securely
stored service-account credential:

```sh
npm run backfill:claims -- \
  --project alphawod-d1f2f \
  --report /secure/new/path/phase-0-approved-dry-run.json
```

Dry-run is the default. Review all of these report sections before applying:

- `implicitApproved`: historical accounts whose missing status previously
  meant approved. Confirm every entry is a legitimate member.
- `accessGrantCandidates`: every account that the migration would grant
  AlphaWOD access, including explicit historical admins, SGPT staff, and
  approved members. The legacy vulnerability could have created any of these
  values, so independently confirm every UID and role against the real staff
  and membership records. Repair any suspicious record and run a fresh dry
  run; never approve it merely because it already says `approved` or `admin`.
- `privilegedClaimCandidates`: existing Auth claims that the vulnerable legacy
  Functions/rules may have treated as privileged. Confirm them independently;
  the migration replaces the complete managed claim set.
- `authUsersWithoutProfiles`: Auth accounts with no Firestore profile. Apply
  preserves unrelated claims but installs an explicit disabled/pending access
  claim set, so an orphaned stale admin claim cannot survive the cutover.
- `identityCorrections`: profiles whose client-era email or verification flag
  differs from Firebase Auth. Apply replaces those values from the canonical
  Auth account without writing email addresses into the report.
- `disabledAuthUsers`: Firebase Auth accounts that are already disabled. Apply
  forces their profile entitlement to a restricted state and writes disabled,
  restricted managed claims; they are never included in the approved access
  grant manifest. Re-enabling Auth alone must not restore AlphaWOD access.
- `invalid`: malformed user/access records. Repair them first.
- `missingAuthUsers`: Firestore profiles without a matching Auth account.
- `legacyWaivers.detected`: every client-era marker/detail field, whether the
  exact canonical current-version server record exists, and the cleanup action.
  Apply quarantines the supplied legacy state, removes all detail fields, and
  clears the user-facing version/timestamp unless that exact canonical record
  passes the current callable-evidence shape check.
- `legacyWaivers.incomplete`: incomplete client-era detail evidence. Resolve
  these before applying. Even under the emergency `--allow-unresolved`
  override, apply quarantines the supplied state as non-authoritative and clears
  it from the user profile rather than treating it as acceptance.
- `leaderboardPii`: legacy email fields that will be removed.

Do not use `--allow-unresolved` as a routine shortcut. It is an emergency,
explicit override and can leave records requiring manual remediation.

### 6. Apply only the audited migration

If `implicitApproved` is empty:

```sh
npm run backfill:claims -- \
  --project alphawod-d1f2f \
  --apply \
  --confirm-project alphawod-d1f2f \
  --approved-access-report /secure/new/path/phase-0-approved-dry-run.json
```

If the dry-run contains only reviewed, legitimate historical implicit grants,
add the explicit acknowledgement:

```sh
npm run backfill:claims -- \
  --project alphawod-d1f2f \
  --apply \
  --confirm-project alphawod-d1f2f \
  --approved-access-report /secure/new/path/phase-0-approved-dry-run.json \
  --allow-implicit-approved
```

The apply command compares every current access grant with the reviewed dry-run
report and stops if an account, role, approval state, or entitlement changed.
This check is mandatory whenever the migration would grant access. It prevents
historical self-written `admin` or `approved` values from being silently
legitimised by the backfill.

The migration is designed to be rerunnable. If it stops part-way, leave the
compatibility rules in place, fix the reported problem, dry-run again, and then
rerun apply. Do not advance to final rules with unresolved users.

Keep the Console/Admin SDK/Auth/custom-claim change freeze in force until apply
has finished. Each profile and leaderboard-PII scrub write is guarded by the
exact Firestore update time seen during the apply scan, and current Auth
identity/claims are re-read before writing. A precondition or identity failure
means data changed concurrently: stop, investigate, generate a new dry-run
report, and re-audit before retrying.

The access patch intentionally changes a profile's update time before waiver
cleanup. The waiver transaction therefore re-reads the profile and compares all
seven legacy waiver marker/detail fields with their exact apply-scan snapshot;
it ignores the migration's unrelated access fields but aborts before archiving
or clearing if any waiver field was added, removed, or changed. Firestore then
retries/aborts the transaction if the profile changes again before commit. An
already-present quarantine document must also exactly match the audited payload.
The only rerun exception is a minimally validated, server-only legacy quarantine
when the live profile has no legacy detail fields and its two markers exactly
match a fully validated canonical current-version acceptance. Full or incomplete
live legacy evidence still requires exact quarantine equality, so the migration
never clears those profiles behind conflicting archived evidence.

### 7. Create the four new hardened callables, then re-block them

Only after the audited migration succeeds, create the four new callable
services. They have no legacy revision and their handlers are already
document-authoritative and fail closed:

```sh
firebase deploy \
  --only functions:listStaffUsers,functions:bootstrapUserProfile,functions:acceptCurrentWaiver,functions:setMemberEntitlement \
  --project alphawod-d1f2f
```

CLI 15.5.1 makes newly created callables public. Immediately inventory these
four exact services, enable the Invoker IAM check, and remove `allUsers` or
`allAuthenticatedUsers` as in step 1. Keep them blocked until step 9. If the
deployment reports an IAM error because of an organization/domain policy, stop
and review the result; do not weaken the policy merely to make this command
report success.

### 8. Deploy final rules and the entitlement-aware frontend

```sh
firebase deploy \
  --only firestore:rules,storage \
  --project alphawod-d1f2f
```

Deploy the frontend through the existing Vercel production workflow only after
the final rules are live. The checked-in `vercel.json` selects the guarded
production build and SPA rewrite, but the operator must still confirm the
connected production project, branch and environment in Vercel before that
deployment.

Do not redeploy the maintenance-lockdown rules as a general rollback after final
cutover; they intentionally make protected app data unavailable.

### 9. Restore callable transport and end maintenance

Only after the backfill, final rules, and frontend are in place, restore the
exact public-invoker configuration captured in the preflight manifest for the
client-callable services among the 18 pre-existing Functions only. Give the
four new callables the same reviewed service-level client-callable mechanism;
do not create a project-level grant. For services using Cloud Run's recommended
disabled IAM check, the explicit command is:

```sh
gcloud run services update CALLABLE_SERVICE \
  --no-invoker-iam-check \
  --region europe-west1 \
  --project alphawod-d1f2f
```

Do not grant `allUsers` or `allAuthenticatedUsers` at project level or to
Eventarc-only services. Verify a normal Firebase callable request reaches the
hardened handler, an unauthenticated request is rejected by the handler, and the
post-deployment checks below pass before ending maintenance.

## Post-deployment checks

Verify with separate test accounts and an incognito session:

- Existing legacy member can load AlphaWOD and book/cancel a class.
- Admin and SGPT retain their intended independent access.
- SGPT performance pages load through `listStaffUsers` without raw user reads.
- Pending, banned, restricted, missing, and malformed profiles cannot access
  member data or call member Functions.
- Cached/offline profile state cannot reopen protected routes without a fresh
  server confirmation.
- New email/password signup creates a pending, non-entitled profile.
- A client cannot self-create a user document, self-approve, change role or
  entitlement, forge a booking, or change class counts.
- Profile name/photo updates still work, with unsafe uploads rejected.
- Waiver acceptance creates a canonical server-only record and only the
  minimal marker appears on the user profile.
- A marker-only or forged-current legacy waiver is cleared by migration and the
  member is gated until the canonical acceptance callable succeeds.
- Leaderboard documents and responses contain no member email addresses.
- Stored leaderboard rows are not client-readable; callable responses recheck
  current access and omit revoked/deleted members.

Keep maintenance active until these checks pass and Function/rules logs show no
unexpected permission failures.

## Still blocked after Phase 0

The in-app waiver identifier remains the existing malformed legacy value
`2026-30-05`. It was intentionally not reinterpreted or renamed because the
legal owner has not approved a canonical publication version. The public
purchase flow must use the final approved documents, immutable versions/hashes,
and guardian addendum before launch.

Stripe, public membership routes, payment/webhook fulfilment, billing-cycle
proration, cancellation automation, Customer Portal, and paid Adult Unlimited
claiming are Phase 1+ work and are not implemented or configured by Phase 0.
