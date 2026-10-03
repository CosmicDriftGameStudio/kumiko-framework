---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

The public § 312k cancellation pages work again: the confirm POST no longer fails with `400 tenant_required` on any host. New `consumerProtection.terminationScope: "platform"` serves the declaration on a host that resolves no tenant (the platform apex), for example publicstatus. Write handlers can declare `tenantlessAnonymous: true` for this. A public declaration's provider cancel now runs in a job instead of in the request.

<!-- kumiko-changes
feature: billing-foundation
type: fix
title: The § 312k confirm POST forwards the visitor's host to /api/write
detail: |
  The `/legal/kuendigen` and `/legal/cancel` pages re-enter `/api/write` through the app. The re-entry now carries `Host`, `X-Forwarded-Host`, `X-Forwarded-Proto`, `X-Tenant` and the `kumiko_tenant` cookie as the visitor sent them, so a host-based `tenantResolver` resolves the same tenant as for a direct call; before, it saw no host and every confirm failed with `400 tenant_required`. The session cookie, `Authorization` and `X-Forwarded-For` are not forwarded.
migration: |
  keine
-->

<!-- kumiko-changes
feature: billing-foundation
type: improvement
title: consumerProtection.terminationScope "platform" for hosts without a tenant
detail: |
  `consumerProtection.terminationScope` is `"tenant-host"` (default, unchanged) or `"platform"`. With `"platform"`, `request-contract-termination` is flagged `tenantlessAnonymous` and also runs on a host whose resolver returns no tenant: it finds the contract by the declarant's email as before, records on the matched tenant's subscription stream, and answers every outcome identically. An unknown option value fails at `createBillingFoundationFeature`.
migration: |
  Apps that serve the pages on a platform apex (publicstatus) set `consumerProtection.terminationScope: "platform"`. Other apps change nothing.
-->

<!-- kumiko-changes
feature: billing-foundation
type: improvement
title: Public termination declarations cancel at the provider in a job
detail: |
  For the public channel, `request-contract-termination` no longer calls the provider in the request. A matched request appends the PII-free `contract-termination-declared` event (`requestId`, `declarationType`, `terminationKind`, `receivedAtIso`, `locale`) via the system-only `declare-contract-termination`; the job `cancel-on-public-termination-declared` then runs `record-contract-termination`, which asks the provider for `cancel_at_period_end` and appends `contract-termination-requested` with the outcome. Matched and unmatched requests do the same work in the request, so the response time does not reveal whether the email is a customer. The job is idempotent per `requestId`. A provider without `cancelSubscription`, a provider error or a missing subscription now sends a separate operator notice with request id and tenant id but no name or email. A public withdrawal still makes no provider call. The account path (`terminate-contract`) stays synchronous.
migration: |
  Code that expected `contract-termination-requested` right after the public request must wait for the job (in tests: `drainJobs`).
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: Write handlers can declare tenantlessAnonymous
detail: |
  `r.writeHandler({ ..., tenantlessAnonymous: true })` lets an anonymous `POST /api/write` for exactly that handler run under `SYSTEM_TENANT_ID` where the anonymous middleware would otherwise answer `400 tenant_required` (resolver silent, no client tenant). It never applies to `/api/batch`, to a client-supplied `X-Tenant` or `kumiko_tenant`, to `tenant_mismatch` or when a tenant resolved; `tenantExists` and the lifecycle gate are skipped for the system tenant. Boot rejects the flag unless `access.roles` is exactly `["anonymous"]` and a real `rateLimit` (not `{ disabled: true }`) is declared. `authMiddleware` gets the option `isTenantlessAnonymousWrite`, which `buildServer` builds from the registry.
migration: |
  keine
-->
