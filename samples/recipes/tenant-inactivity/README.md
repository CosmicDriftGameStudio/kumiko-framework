# Sample: Tenant Inactivity

Opt-in deletion of abandoned free accounts. Mount `createTenantInactivityFeature` next to `sessions`, `tenant-lifecycle` and `delivery`; a daily job tracks the last activity per tenant, warns the tenant owners by mail and finally files the normal deletion request.

## What you learn here

- **One rule for everybody, or one per tier**: `{ rule }` applies to every tenant; `{ resolveTier, rulesByTier }` returns `null` for a tier to exempt it (paid plans).
- **Warning cycle**: with `warnings: [{ days: 30 }, { days: 7 }]` the owners get one mail 30 and one 7 days before the deadline. On the deadline the job calls the same core as the owner's `request-destruction` handler, so the wait period comes from the compliance profile and the owner can still cancel.
- **Activity restarts the cycle**: a new session counts, and so does the keep-account link in the mail (`keepAccountTokenSecret` signs it; without a secret the mail links to `keepAccountUrl` only). Other apps of the same account report through `activitySources`; `fetchRemoteAppLastActivity` reads the opt-in `lastActivityProbeSecret` route of a remote sessions feature.
- **No write per request**: the state is only written by the daily job; the state query (`tenant-inactivity:query:state`) shows `exempt`, `lastActivityAt`, `warningsSent`, `nextStep` and `nextStepAt`.

## Feature composition

```
sessions, tenant, tenant-lifecycle, delivery   (required)
tenant-inactivity  <- this sample
```

## Tests

`src/__tests__/feature.integration.test.ts` runs the job against a manual clock and reads the outlook through the state query. The full mail and deletion flow is covered in `bundled-features/src/tenant-inactivity/__tests__`.
