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
- **`includeSessions: false`** — drop `sessions` from the preset when it is
  already mounted elsewhere, e.g. via `dsgvoSelfServiceFeatures()` (mounting
  the same feature name twice throws at boot).

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
mounts `sessions` as part of its own require-chain. Combine both with
`includeSessions: false` to avoid a duplicate-feature-name boot failure:

```ts illustration
import { dsgvoSelfServiceFeatures, securityBaselineFeatures } from "@cosmicdrift/kumiko-bundled-features/presets";

export const APP_FEATURES = [
  // ...config, user, tenant, auth-foundation...
  ...dsgvoSelfServiceFeatures(),
  ...securityBaselineFeatures({ includeSessions: false }),
];
```

For an app that does not mount `dsgvoSelfServiceFeatures()`, use
`securityBaselineFeatures()` with its default options, as this recipe does.

## Tests

```bash
bun test samples/recipes/security-baseline/src/__tests__/feature.test.ts
```

Three cases: `APP_FEATURES` boots clean; at `NODE_ENV=production` it produces
no security-baseline warning; dropping `crypto-shredding`/`rate-limiting`/
`audit` (`sessions` stays mounted — `auth-foundation`'s own bootCheck requires
a sessionStore) at `NODE_ENV=production` produces exactly one warning and
still does not throw.
