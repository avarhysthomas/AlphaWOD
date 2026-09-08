# Production baseline — captured 8 September 2026

This branch is grounded in the code and configuration actually deployed, not the newest branch. No cloud deployment or production setting was changed to establish it.

## Frontend

Current Vercel deployment: [`dpl_66vDH7dguRaBW1JrJkCuKiRETY1x`](https://vercel.com/avarhysthomas-projects/alpha-wod/66vDH7dguRaBW1JrJkCuKiRETY1x).

- Production domain: `alpha-wod.vercel.app`.
- CLI deployment created 2 September 2026; Vercel has no source-commit metadata for it.
- Recovered all 357 uploaded files and verified each against Vercel's content hash.
- All 356 non-environment uploaded files match commit `f4718c19140ed7f963480259383d12006b6a2d41`, except `package.json`.
- The production `build:production` command additionally requires `--expect-purchase-open --expect-conditioning-open`. That exact command is preserved here.
- The uploaded `.env` is configuration, preserved privately and excluded from the new baseline commit. Do not add environment values to Git.
- Vercel remains linked to GitHub with `main` as the production branch. Nothing has been pushed; `main` has not been advanced.

## Backend: production is three source revisions, not one

| Captured source | Active functions | Use |
|---|---:|---|
| Common, 2 September | 42 | Root `functions/` source matches this version, including the class-cancellation implementation |
| PAYG hotfix, 7 September | 2 | `getPublicPaygSchedule`, `createPaygCheckoutSession` |
| Legacy admin, 20 August | 3 | `inviteMemberByEmail`, `updateMemberStrengthBlock`, `updateStrengthBlockSettings` |

Exact source and compiled JavaScript for all three versions are retained under `ops/production-baseline/2026-09-08/function-revisions/`. Nine provider archives were downloaded and verified against their metadata. Their files form four trees; two differ only in the populated environment file, giving three code revisions. Raw archives and environment files are private, outside Git.

Every active function is mapped to its source archive, code directory, service revision, update time, runtime flags and public-invocation setting in [the manifest](ops/production-baseline/2026-09-08/manifest.json). All 47 functions report `ACTIVE` on Node.js 24. All nine observed Scheduler jobs are `ENABLED`; this is configuration evidence, not proof every job has completed successfully.

The original `createMembershipCheckoutSession` remains closed: no public invoker binding, with its purchase flag false. V2 and PAYG intake have their active production flags recorded separately. Keep these distinctions.

**Do not deploy all of root `functions/` as a production reproduction.** Doing so would replace the two PAYG hotfixes and update the three older admin functions. Consolidating them into one tested backend source tree is a separate change. Future selective releases must check this map and preserve the other services and their flags.

## Security rules and indexes

The active Firestore and Storage rules match the Vercel source exactly. Their ruleset IDs and hashes are recorded in the manifest.

The source index file omitted live configuration. `firestore.indexes.json` now reflects the observed nine composite indexes and six field overrides, including:

- `movementLibrary`: `isActive`, `sortOrder`;
- `workoutSessions`: `userId`, `createdAt`;
- `trainingLogs.createdAt`: the existing collection indexes and collection-group descending index.

All source-defined indexes were present live; these are additional live definitions, not removals. This local reconstruction did not deploy or modify indexes.

## Verification and use

Run the offline identity check with Node 24:

```sh
node scripts/verifyProductionBaseline.js
```

It checks the recovered working source, captured backend versions, rules and function mapping. Intentional future changes should produce drift; do not rewrite the frozen manifest to hide it. This check does not contact production or certify the application has no defects.

Normal unit tests, lint and local builds can be run separately. Never use a real payment journey merely to verify this baseline. The production environment and Secret Manager values remain outside source control. Capturing configuration does not authorise publishing it or changing it.

## Existing local work

The pre-reconciliation workspace was saved as binary staged/unstaged patches, a complete untracked-file archive and SHA-256 file inventory. A local preservation branch is created before switching the main workspace to this baseline. That work has not been discarded or automatically reapplied over production.

Private evidence is under `.production-reconciliation/capture-20260908`, excluded through the repository's local Git exclude file and protected by a private directory. Do not publish that directory: it contains deployment configuration, populated environment files and original diagnostic archives. The checked-in manifest contains no secret values.

## Audit correction

The earlier audit examined `main` and a September 7 branch that is not the common production source. Treat its code findings as provisional until checked against this baseline. In particular, production's common source includes `classCancellation.ts`, and the current waiver contract is aligned. The local waiver mismatch was a stale-workspace issue, not a demonstrated production outage.

## Validation results

On Node 24.13.1: 324 frontend tests and 291 common-backend tests passed; frontend/backend lint and a local frontend build passed. All 13 recompiled common-backend JavaScript files match their deployed copies byte-for-byte. The offline baseline check passes 597 file checks.

Infrastructure tests: 55 passed, one failed. `scripts/deploymentConfig.test.js:22` expects the earlier build command without explicit purchase flags, while production includes those flags. The deployed command is preserved. This known tooling mismatch must be deliberately addressed before a future CI/release change; the baseline does not claim every check is green. Capturing production preserves its defects as well as its working behaviour.
