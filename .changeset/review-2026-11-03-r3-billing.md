---
"@cosmicdrift/kumiko-bundled-features": patch
---

Bound the provider call of contract termination and revocation, share the billing-live check, and tighten billing consent tests.

<!-- kumiko-changes
feature: billing-foundation
type: fix
title: Provider cancel and resume in contract termination time out
detail: The provider cancel (record) and resume (revoke) calls run while the tenant's advisory lock is held and are now bounded to 20 seconds. A hanging provider is reported like any provider error (operator notice provider_error or revocation_resume_failed) instead of pinning the transaction, its pool connection and the public withdrawal requests. subscription-paddle and subscription-stripe now share one isBillingLive check with assertBillingLive.
-->
