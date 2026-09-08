# Production baseline release candidate — 8 September 2026

## Scope

Release branch: `codex/production-baseline-20260908`.
Recovered baseline: `71b47f2`; preservation documentation: `fdf365b`.
Remote main was verified as `2b19fd6bdfa2ff5e2212d8b07cbd1cf751d33fd9` during preparation.

This is a frontend-only release to bring Git main into line with observed production. Application source and the deployed production build command are unchanged from the recovered baseline. Preparation changes only the CI purchase flags and deployment configuration assertions. The fixture uses invalid Firebase/App Check credentials; its output must never be uploaded or promoted.

The frozen baseline manifest remains unchanged. Its offline checker deliberately reports exactly two changed captured files: `.github/workflows/ci.yml` and `scripts/deploymentConfig.test.js`. Any additional captured-file drift needs review.

## Backend boundary

No Firebase deployment, rule/index release, migration, scheduler change, secret change or Stripe configuration change belongs in this release. GitHub CI only tests Firebase; it contains no deployment step. Root `functions/` still represents 42 of 47 active functions.

For any later backend release, resolve each target against `ops/production-baseline/2026-09-08/manifest.json`:

- `getPublicPaygSchedule`, `createPaygCheckoutSession`: `payg-2026-09-07` source snapshot.
- `inviteMemberByEmail`, `updateMemberStrengthBlock`, `updateStrengthBlockSettings`: `legacy-admin-2026-08-20` snapshot.
- Other 42 captured functions: common source in root `functions/`.

Snapshots are evidence, not ready-to-deploy runtime configurations. Selective releases must preserve each function's runtime flags, secrets and invocation boundary; do not blanket-deploy the root or snapshot directories. The original membership checkout remains closed.

## Controlled release sequence

1. Push the candidate branch and open a PR after release authorisation. Confirm remote main has not moved; review any new commits before proceeding.
2. Require all four CI jobs to pass, including emulator and security-rule jobs. GitHub CLI authentication was unavailable locally, so branch protection has not been verified. Do not assume Vercel waits for CI before deploying main.
3. Check Vercel production-scoped configuration still supplies all required Firebase web values, App Check configuration, both purchase flags true, and disabled emulator/test-journey flags. Do not copy the CI fixture to Vercel. Historical environment values and identical compiled bundle bytes have not been proven by the source recovery.
4. Review the PR diff against main and confirm it is baseline recovery plus the documented tooling repair. Exclude `.production-reconciliation/` and populated environment files from all uploads. A preview must use separate non-production Firebase configuration; the preflight intentionally rejects production Firebase on previews.
5. Merge the reviewed candidate into main. Vercel is linked to main for production; confirm the new deployment uses the merged Git SHA and passes its actual production build preflight. Do not run Firebase deploy.
6. Check the production domain, sign-in, schedule, memberships, existing authenticated bookings and browser errors using read-only journeys. Do not create a live charge as a smoke test. Check Vercel and Firebase error reporting against the pre-release state.

## Rollback

The previous current frontend deployment is `dpl_66vDH7dguRaBW1JrJkCuKiRETY1x`:
https://vercel.com/avarhysthomas-projects/alpha-wod/66vDH7dguRaBW1JrJkCuKiRETY1x

If the frontend regresses, restore that deployment to the production domain using Vercel rollback, then reconcile main before another release. A frontend rollback does not roll back Firebase. Retain the recovered baseline tag and private original-workspace backup.

## Validation

Preparation results are recorded below. Earlier baseline validation already passed 324 frontend tests, 291 common-backend tests, both linters, and byte-for-byte recompilation of the common backend. These remain applicable because application source is unchanged.

- Infrastructure tests: 56/56 pass after the CI repair.
- Exact `npm run build:production` with the updated inert CI environment: passes on Node 24.13.1.
- Monitoring, webhook-event and deployment-template validators: pass. These validate checked-in templates, not live operational health.
- Backend emulator integration tests: 242/242 pass.
- Firestore/Storage security-rule tests: 24/24 pass; compatibility tests: 6/6 pass.
- Application/runtime paths have no diff against recovered baseline `71b47f2`.
- Nothing pushed or deployed during preparation.
