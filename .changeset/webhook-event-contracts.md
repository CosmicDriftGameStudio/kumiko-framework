---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-testing": minor
"@cosmicdrift/kumiko-samples": patch
---

Webhook events get public contracts. `r.defineWebhookEvent` declares one, entity events get a derived contract without personal fields, `PatScopeDef.events` releases them per token scope, and `kumiko api-docs` writes `events.md` and an OpenAPI `webhooks` section.

<!-- kumiko-changes
feature: framework
type: improvement
title: r.defineWebhookEvent declares a public webhook event contract
detail: `r.defineWebhookEvent({ name, description, payload, version })` registers a contract under `<feature>:<name>`, separate from `r.defineEvent`, so an internal event is never released by accident. `registry.getWebhookEventContract(qn)` also returns the contract derived for an entity event (`ticket.created`, `ticket.updated`, `ticket.deleted`): every payload carries the entity `id`, created adds the releasable fields, updated adds `changes` and `previous`, deleted adds `previous`; `toEntityWebhookPayload(contract, event)` maps a stored entity event (aggregate id plus payload) to that shape and drops everything the contract does not release; personal fields, the CRUD `excludedFields`, money and located timestamp fields and encrypted, write-only or sensitive text fields are left out. `registry.getWebhookEventContracts()` lists the declared ones sorted by name. `parseWebhookPayload(contract, payload)` validates a payload and strips unknown keys. New exports: `WebhookEventContract`, `WebhookEventHandle`, `parseWebhookPayload`, `toEntityWebhookPayload`.
-->

<!-- kumiko-changes
feature: personal-access-tokens
type: improvement
title: token scopes list the webhook events they release
detail: `PatScopeDef.events` takes exact event names (no globs). Holding the scope at read or write level is enough to subscribe, `expandScopeEvents(config, granted)` returns the union. Boot fails when a scope lists an event without a public contract, for example an internal `r.defineEvent`. Revoking a token now has a title and a field label in every bundle locale.
-->

<!-- kumiko-changes
feature: agent-tools
type: improvement
title: kumiko api-docs documents webhook events
detail: When a scope lists events, the output gains `<locale>/events.md` (delivery text from `apiDocs.webhookDelivery`, versioning rules, one section per event with fields and a recorded example), an OpenAPI 3.1 `webhooks` section keyed by event name and an `events` page in `index.json`. New problems `webhookDeliveryTextMissing` and `webhookEventWithoutDescriptionTranslation`. Field descriptions come from `.describe()` on declared payloads and from the entity field translations on derived ones. `ApiDocsInput.webhookExamples` is optional; `kumiko api-docs` reads `<examplesDir>/webhooks/*.json`.
-->

<!-- kumiko-changes
feature: testing
type: improvement
title: recordWebhookExample records validated webhook payloads for the generated docs
detail: `recordWebhookExample({ name, dir, contract, payload })` from `@cosmicdrift/kumiko-testing/api-examples` validates the payload with `parseWebhookPayload` and throws with the issues when it breaks the contract. With `KUMIKO_RECORD_API_EXAMPLES=1` it writes `<dir>/webhooks/<name>.json` with ids, timestamps and secrets normalized. It always returns the parsed payload. `WebhookExampleFileSchema` is exported from `@cosmicdrift/kumiko-types/api-example`.
-->
