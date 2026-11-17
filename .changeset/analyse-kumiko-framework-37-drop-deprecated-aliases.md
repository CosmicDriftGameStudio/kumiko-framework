---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-dev-server": minor
"@cosmicdrift/kumiko-renderer": minor
---

Removes four deprecated aliases: `MoneyRead.amountMinor`, the `{ subjectField }` event PII form, `injectSchema` on host dispatch results and `billing.stripe.webhookPath`.

<!-- kumiko-changes
feature: core
type: breaking
title: Deprecated money, PII, schema and webhook aliases removed
detail: Rehydrated money values no longer carry `amountMinor`; `amountScaled` holds the same value. `r.defineEvent` `piiFields` no longer accepts `{ subjectField: "<field>" }`. `HostDispatchResult` and `DevHostDispatchResult` no longer have `injectSchema`. `runProdApp` billing no longer reads `stripe.webhookPath` as a fallback for the webhook route.
migration: Read `amountScaled` instead of `amountMinor`. Write `piiFields: { x: { personal: { of: "<field>" } } }` instead of `{ subjectField: "<field>" }`. Drop `injectSchema` from host dispatch results. Move `billing.stripe.webhookPath` to `billing.webhookPath`.
-->
