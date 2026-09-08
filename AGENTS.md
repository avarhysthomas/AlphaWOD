# Production source of truth

Read `PRODUCTION_BASELINE.md` before changing application or deployment code.
The 8 September 2026 baseline was recovered from the live Vercel deployment,
Firebase source archives, active rules and indexes. Its manifest is
`ops/production-baseline/2026-09-08/manifest.json`.

Root `functions/` represents only the common version used by 42 functions.
Two PAYG functions and three legacy admin functions run the other captured
source versions in the manifest. Do not infer that a newer branch, root
`functions/`, or a broad deploy reproduces production. Check the affected
function's mapping before proposing a change or deployment.

Previous uncommitted work is preserved separately; do not merge it into the
baseline without reviewing it against the observed production behaviour.
Raw production evidence under `.production-reconciliation/` is private and
must not be added to Git. Never commit populated environment files.
