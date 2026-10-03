---
"@cosmicdrift/kumiko-bundled-features": minor
---

With `consumerProtection` set, `billing-foundation` gets the § 312k cancellation path. The new `createContractTerminationRoutes()` returns the public pages `/legal/kuendigen` (de) and `/legal/cancel` (en): a form for termination or withdrawal, a review page and a confirm step that works without JavaScript. The confirm step calls the anonymous `request-contract-termination` handler (5 requests per IP and 10 minutes), which finds the contract through the entered email (TenantAdmin of exactly one tenant with a non-terminal subscription). A single match cancels at the provider at period end; a public withdrawal is only recorded, never cancelled at the provider. No match or several matches are recorded as `contract-termination-unmatched` on a system-tenant stream. The answer and the receipt mail to the entered address are the same for every outcome, and the operator mail (`operatorEmail`) goes out for unmatched, ambiguous, withdrawal, extraordinary and provider-failure cases. Signed-in TenantAdmins use `terminate-contract` (termination at period end, withdrawal immediately). Events carry no name, email or reason; those only travel in the mails.

<!-- kumiko-changes
feature: billing-foundation
type: improvement
title: § 312k cancellation pages and handlers with consumerProtection
detail: |
  `contract-termination-requested` (on the tenant's subscription stream: `requestId`, `declarationType` termination|withdrawal, `terminationKind` ordinary|extraordinary, `channel` public|account, `receivedAtIso`, `effectiveAtIso`, `providerCancel` period-end|immediately|none) and `contract-termination-unmatched` (system-tenant stream, `matchResult` none|ambiguous) are appended by the system-only `record-contract-termination` and `record-unmatched-contract-termination` handlers. `billing-foundation:write:request-contract-termination` is anonymous and answers `{ requestId, receivedAtIso }` for every outcome; `billing-foundation:write:terminate-contract` (purchase roles) answers `{ requestId, receivedAtIso, effectiveAtIso, providerCancel }`. Provider errors or a provider without `cancelSubscription` still record the declaration (`providerCancel: none`) and notify the operator. `consumerProtection` now also requires the `tenant` feature.
migration: |
  Add `createContractTerminationRoutes()` from billing-foundation to the app's `extraRoutes`, make sure `anonymousAccess` is configured, and link `/legal/kuendigen` (or `/legal/cancel`) in the page footer.
-->
