# Security baseline

Mount `composeSecurityStack()` instead of hand-picking the four features
every prod app needs for basic account/security hygiene: `sessions`
(revocable JWTs), `crypto-shredding` (operator-triggered subject-key erase),
`rate-limiting` (ops-side bucket-status query, dispatcher wiring is
automatic), and `audit` (tenant-scoped audit trail). Forgetting one of them
used to be silent; now the boot validator warns at `NODE_ENV=production`.

## What it shows

- **`composeSecurityStack()`** (`@cosmicdrift/kumiko-dev-server/compose-stacks`) —
  returns the four features in one call, fresh instances per call. It replaces
  the deprecated `securityBaselineFeatures()` preset. `runProdApp` refuses to
  boot it without a KMS decision (`kmsMode`) or with `rateLimit: false`; see
  [`compose-stacks`](../compose-stacks/).
- **`warnOnMissingSecurityBaseline`** — wired into `validateBoot` (fw#2857).
  At `NODE_ENV=production`, boot compares mounted feature names against
  `SECURITY_BASELINE_FEATURE_NAMES` and logs a `console.warn` naming whatever
  is missing. It never throws — the baseline is a strong recommendation, not
  a hard requirement — and it is silent outside production.
- **`includeSessions: false`** — an optional opt-out for dropping `sessions`
  from the stack explicitly. Not required for combining with
  `composeGdprStack({ selfService })`: both mount `createSessionsFeature()`
  with no-arg options, and the framework's `dedupeFeatures()` collapses the
  two identical instances at boot instead of throwing.

## Feature composition

```
config            → tenant's r.requires({ features: ["config"] }) dependency
user              → cross-tenant identity (sessions' r.requires target)
tenant            → memberships (audit's r.requires target)
auth-foundation   → tokenVerifier extension point (sessions' r.requires target)
sessions          → revocable JWTs
crypto-shredding  → operator-triggered subject-key erase
rate-limiting     → ops-side rate-limit status query
audit             → tenant-scoped audit trail
```

## When to reach for it

Any app that also mounts `composeGdprStack({ selfService })`, which already
mounts `sessions` as part of its own require-chain. Combine both directly;
`dedupeFeatures()` collapses the two identical `sessions` instances at boot:

```ts illustration
import {
  composeGdprStack,
  composeSecurityStack,
} from "@cosmicdrift/kumiko-dev-server/compose-stacks";

export const APP_FEATURES = [
  // ...config, user, tenant, auth-foundation...
  ...composeGdprStack({ selfService: {} }),
  ...composeSecurityStack(),
];
```

For an app without the self-service stack, use `composeSecurityStack()` with
its default options, as this recipe does.

Dedupe keeps the first mounted instance. Late-bound state such as
`bindAutoRevokeOnPasswordChange` must be bound on the instance returned by
`composeFeatures`/`createApp`, not on a locally held handle to the dropped one:
the dropped instance's hooks never run and password changes silently stop
revoking sessions.

A `createSessionsFeature({ ... })` mounted with different options than the
stack's own no-arg instance still produces a clear boot error — dedupe only
collapses provably interchangeable instances, never silently picks one:

```ts illustration
export const APP_FEATURES = [
  // ...
  createSessionsFeature({ expiresInMs: 1000 }),
  ...composeSecurityStack(),
  // throws: Duplicate feature: "sessions" mounted twice with different
  // options — mount it once or pass identical options
];
```

## Tests

```bash
bun test samples/recipes/security-baseline/src/__tests__/feature.test.ts
```

Three cases: `APP_FEATURES` boots clean; at `NODE_ENV=production` it produces
no security-baseline warning; dropping `crypto-shredding`/`rate-limiting`/
`audit` (`sessions` stays mounted — `auth-foundation`'s own bootCheck requires
a sessionStore) at `NODE_ENV=production` produces exactly one warning and
still does not throw.
