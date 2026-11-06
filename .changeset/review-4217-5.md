---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-server-runtime": patch
---

The legacy checkout backfill verifies the old tenant binding when a key is set.

<!-- kumiko-changes
feature: subscription-paddle
type: fix
title: backfill-checkout-ledger verifies the legacy tenant binding when a key is set
detail: The job ledgered every transaction with a `tenantBinding` string for the tenant in the unsigned `custom_data.tenantId`, and Paddle.js can send any `customData`. The new option `legacyTenantBindingKey` (bridged from `PADDLE_TENANT_BINDING_KEY` by the `billing.paddle` boot option) makes the job ledger only transactions whose binding verifies; an invalid one is skipped with a warning that names only the transaction id. Without the key all legacy checkouts are ledgered as before, with a warning per run.
-->
