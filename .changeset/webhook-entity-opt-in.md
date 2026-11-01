---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-samples": patch
---

Derived entity webhook contracts need an opt-in. An entity releases `<entity>.created/.updated/.deleted` only with `webhookEvents: true`.

<!-- kumiko-changes
feature: framework
type: improvement
title: entity webhook events need `webhookEvents: true` on the entity
detail: `<entity>.created`, `.updated` and `.deleted` get a derived webhook contract only for entities that set `webhookEvents: true`, so bundle system entities such as `config-value` or `tenant-secret` can never be released through a token scope. Without the flag the entity has no contract and a scope that lists its events fails at boot, with a message naming the entity and the option. Add `webhookEvents: true` to every entity whose events a scope lists; the field exclusions still apply.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: r.defineWebhookEvent takes an optional wireName
detail: `wireName` is the event name receivers see in the delivered webhook, for example `incident.created` for the contract `publicstatus:incident-created`. It defaults to the unqualified `name`, must not be empty, and is `entity.verb` for derived entity contracts. `WebhookEventContract` and `WebhookEventDef` carry it.
-->

<!-- kumiko-changes
feature: agent-tools
type: improvement
title: api-docs names events by wireName and skips system-only handlers
detail: `events.md` headings and anchors, the OpenAPI `webhooks` keys and their `summary` use the wire name; the contract QN stays as `x-kumiko-qn` in OpenAPI and as the anchor `qn` in `index.json`. Write and query handlers whose `access.roles` are only `["system"]` are no longer documented, even when a scope pattern such as `app:write:monitor:*` matches them, and the `uiWriteOutsideScopes` check ignores them.
-->
