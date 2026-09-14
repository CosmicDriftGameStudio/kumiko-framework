# Security baseline

Mount `securityBaselineFeatures()` instead of hand-picking the four features
every prod app needs for basic account/security hygiene: `sessions`
(revocable JWTs), `crypto-shredding` (operator-triggered subject-key erase),
`rate-limiting` (ops-side bucket-status query, dispatcher wiring is
automatic), and `audit` (tenant-scoped audit trail). Forgetting one of them
used to be silent; now the boot validator warns at `NODE_ENV=production`.

## What it shows

- **`securityBaselineFeatures()`** (`@cosmicdrift/kumiko-bundled-features/presets`) —
  returns the four features in one call, fresh instances per call.
- **`warnOnMissingSecurityBaseline`** — wired into `validateBoot` (fw#2857).
  At `NODE_ENV=production`, boot compares mounted feature names against
  `SECURITY_BASELINE_FEATURE_NAMES` and logs a `console.warn` naming whatever
  is missing. It never throws — the baseline is a strong recommendation, not
  a hard requirement — and it is silent outside production.
- **`includeSessions: false`** — an optional opt-out for dropping `sessions`
  from the preset explicitly. Not required for combining with
  `dsgvoSelfServiceFeatures()` any more: both mount `createSessionsFeature()`
  with no-arg options, and the framework's `dedupeFeatures()` collapses the
  two identical instances at boot instead of throwing.

## Feature composition

```
config            → tenant's r.requires("config") dependency
user              → cross-tenant identity (sessions' r.requires target)
tenant            → memberships (audit's r.requires target)
auth-foundation   → tokenVerifier extension point (sessions' r.requires target)
sessions          → revocable JWTs
crypto-shredding  → operator-triggered subject-key erase
rate-limiting     → ops-side rate-limit status query
audit             → tenant-scoped audit trail
```

## When to reach for it

Any app that also mounts `dsgvoSelfServiceFeatures()` — that preset already
mounts `sessions` as part of its own require-chain. Combine both directly;
`dedupeFeatures()` collapses the two identical `sessions` instances at boot:

```ts
import { dsgvoSelfServiceFeatures, securityBaselineFeatures } from "@cosmicdrift/kumiko-bundled-features/presets";

export const APP_FEATURES = [
  // ...config, user, tenant, auth-foundation...
  ...dsgvoSelfServiceFeatures(),
  ...securityBaselineFeatures(),
];
```

For an app that does not mount `dsgvoSelfServiceFeatures()`, use
`securityBaselineFeatures()` with its default options, as this recipe does.

A `createSessionsFeature({ ... })` mounted with different options than the
preset's own no-arg instance still produces a clear boot error — dedupe only
collapses provably interchangeable instances, never silently picks one:

```ts
export const APP_FEATURES = [
  // ...
  createSessionsFeature({ expiresInMs: 1000 }),
  ...securityBaselineFeatures(),
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
