# compliance-profiles-demo

Same app code, three tenants, three regulatory profiles — no `if (region)`
branches in your domain handlers.

## What it shows

How a multi-tenant platform uses `compliance-profiles` to deliver different
regulatory behaviour per tenant:

| Tenant | Profile | Supervisory authority | Languages | Tenant-destroy grace |
|---|---|---|---|---|
| **A** (DACH) | `eu-dsgvo` | BlnBDI Berlin | de / en | 30 days |
| **B** (Switzerland) | `swiss-dsg` | EDÖB Bern | de / fr / it / en | 30 days |
| **C** (DACH-HR) | `de-hr-dsgvo-hgb` | State DPA | de | 60 days (HR override) |

Plus tenant B with an override (`gracePeriod: { days: 90 }`) extending
user-rights grace without losing other profile fields — deep-merge on the
base profile; atomic paths replace, the rest inherits from `swiss-dsg` (which
itself extends `eu-dsgvo`).

## Feature composition

The sample imports one feature:

```ts illustration
import { createComplianceProfilesFeature } from "@cosmicdrift/kumiko-bundled-features/compliance-profiles";

export const features = [createComplianceProfilesFeature()];
```

The feature exposes `compliance.forTenant` — other features (`user-data-rights`,
`data-retention`, tenant lifecycle) resolve the effective profile via this API
instead of hard-coding region rules.

## Flow

1. Operator assigns a profile to each tenant (`eu-dsgvo`, `swiss-dsg`, …).
2. Tenant B adds a partial override (longer grace) — merged atomically.
3. `compliance.forTenant(tenantId)` returns resolved fields (languages,
   supervisory authority, grace periods, retention presets).
4. Downstream features read the resolver — forget grace, retention policy, and
   audit obligations follow the profile without app-level branching.

## Tests

```bash
# From kumiko-framework repo root:
bun test samples/recipes/compliance-profiles-demo/src/__tests__/feature.integration.test.ts
```

Five full-stack tests via `setupTestStack` + real HTTP — profile assignment,
override merge, and cross-tenant isolation.

## Local dev

This recipe has no standalone server bootstrap — tests are self-contained. To
try interactively, mount `complianceProfilesDemoFeatures` in your own
`runDevApp` config.

## Related samples

- [user-data-rights](/en/samples/recipes-user-data-rights/) — forget grace from
  `compliance.forTenant` drives deletion timing.
- [apps-user-data-rights-demo](/en/samples/apps-user-data-rights-demo/) — full
  GDPR app with `eu-dsgvo` profile wired.
