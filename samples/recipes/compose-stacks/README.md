# Compose stacks

Mount the auth, security, GDPR and SaaS features through the `compose*Stack`
helpers from `@cosmicdrift/kumiko-dev-server/compose-stacks` instead of
listing each feature and its require order by hand. A stack that depends on a
`runProdApp` option marks that on its features (`bootRequires`), and
`runProdApp` refuses to boot when the option is missing, naming the stack and
the option.

## What it shows

- **`composeAuthStack({ mfa, sessions })`**: `auth-foundation`, `sessions`,
  and with `mfa` also `auth-mfa` plus `account-security`. The password login
  itself still comes from the `auth` option or `composeFeatures`.
- **`composeSecurityStack({ includeSessions })`**: `sessions`,
  `crypto-shredding`, `rate-limiting` and `audit`. Needs a KMS decision
  (`kmsMode`) and fails with `rateLimit: false`. Replaces
  `securityBaselineFeatures()`.
- **`composeGdprStack({ tenantLifecycle, selfService })`**: `data-retention`
  and `compliance-profiles`, optionally `tenant-lifecycle`. `selfService` adds
  `sessions`, `user-data-rights` and `user-profile` (needs `mail`) and
  replaces `dsgvoSelfServiceFeatures()`.
- **`composeSaasStack({ billing, tiers, caps, waitlist })`**:
  `billing-foundation` and `tier-engine`, plus `cap-counter`/`cap-overview`
  and `waitlist` when configured. `billing: "stripe"` leaves
  `subscription-stripe` to the `billing` boot option, which also mounts the
  tier-sync webhook route; `billing: "mollie"` mounts `subscription-mollie`
  itself.

## Boot requirements

| Stack | Boot option | Also satisfied by |
| --- | --- | --- |
| `composeMailStack` | `mail` | a mounted `channel-email` |
| `composeFileStack` without providers | `fileStorage` | a mounted file provider |
| `composeGdprStack` | `kmsMode` | `kms` or `allowPlaintextPii` |
| `composeGdprStack({ selfService })`, `composeUserDataRightsStack` | `mail` | a mounted `channel-email` |
| `composeSecurityStack` | `kmsMode`, `rateLimit` not `false` | `kms` or `allowPlaintextPii` |
| `composeSaasStack({ billing: "stripe" })` | `billing` | a mounted subscription provider |

A missing option fails the boot with:

```
[runProdApp] stacks in `features` need boot options that are not set:
  - composeSaasStack needs the boot option `billing`: set billing: { stripe: { priceToTier }, defaultTier }
```

## Flow

1. `src/app.ts` lists the stacks and the boot options they need.
2. The test boots with `KUMIKO_DRY_RUN_ENV=boot`, which runs the whole
   validation and stops before any DB or Redis connection: with the options
   the boot passes, without `billing` or `kmsMode` it fails and names the
   stacks.

## Tests

```bash
bun test samples/recipes/compose-stacks
```
