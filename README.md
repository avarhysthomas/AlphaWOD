# AlphaWOD

React and Firebase application for Zero Alpha Fitness, including the public
membership catalogue, Stripe Billing checkout, account management and staff
tools. Use Node 24.

## Local development

```sh
npm install
npm start
```

For the isolated real Stripe test-mode membership journey, follow
[`docs/billing/local-stripe-test-journey.md`](docs/billing/local-stripe-test-journey.md)
and run `npm run stripe:test`.

## Verification

```sh
npm run lint
npm run test:ci
npm run test:infrastructure
npm run verify:monitoring
npm run build
npm run lint --prefix functions
npm test --prefix functions
```

`npm run build` is a local build only. Production builds must use
`npm run build:production` with the reviewed Vercel Production environment.

## Release safety

Start with [`docs/billing/production-operations.md`](docs/billing/production-operations.md)
and [`docs/billing/phase-1-rollout.md`](docs/billing/phase-1-rollout.md). Billing
uses independent legal-publication, frontend-visibility and backend-runtime
purchase gates. A Git commit, push or merge
does not deploy Firebase Functions, rules, indexes or secrets; those require the
explicit selective operator steps in the runbook. A merge to the Vercel
production branch may deploy the frontend according to the connected Vercel
project, so keep its Production environment reviewed and its billing gates
closed until launch approval.
