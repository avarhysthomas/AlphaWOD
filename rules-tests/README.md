# Firebase security-rules tests

The normal suite validates the final entitlement-aware Firestore and Storage
rules:

```sh
npm test --prefix rules-tests
```

The compatibility suite validates the **temporary Phase 0 maintenance lockdown**:

```sh
npm run test:compat --prefix rules-tests
```

After that test passes, the narrowly scoped compatibility-lockdown command is
shown below. Run it only after callable ingress has been IAM-blocked and
verified as described in the safe order that follows:

```sh
firebase deploy --config firebase.phase0-compat.json --only firestore:rules,storage --project alphawod-d1f2f
```

That compatibility config contains only Firestore and Storage policy; it cannot
deploy Functions or Hosting as a side effect.

Before any live rollout, rerun this suite with the rollout-pinned Firebase CLI
15.5.1 and the local Firestore and Storage emulators. Expected
compatibility-suite summary:

```text
tests 6
pass 6
fail 0
```

The compatibility files are a deliberate maintenance lockdown. Because the old
policy allowed self-authored roles, they trust no historical staff/member role.
The safe rollout order is:

1. Begin maintenance, IAM-block every deployed callable's public Cloud Run
   invocation, and verify each callable URL is denied.
2. Deploy compatibility Firestore and Storage rules.
3. Run a read-only report; independently audit/remediate every access candidate.
4. Selectively update only the 18 pre-existing Functions while their callable
   IAM block remains in force; do not create the four new callables yet.
5. Run a fresh report, approve its exact access manifest, and apply the backfill.
6. Create and immediately re-block the four new hardened callables.
7. Deploy final Firestore/Storage rules and the entitlement-aware frontend.
8. Restore callable ingress only after post-cutover verification.

Callable ingress is unavailable from step 1, and protected client data is
unavailable from step 2 through the remainder of maintenance.
Functions must still precede the applying backfill because the legacy
`onUserDocWritten` trigger can otherwise race the backfill and replace the new
complete custom claims with its older partial claim shape. After migration, do
not continue using either Phase 0 compatibility rule file.
