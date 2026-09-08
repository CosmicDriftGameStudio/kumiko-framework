---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Describes every bundled write/query handler and every bundled `type: "custom"` screen for the AI agent, so `kumiko agent lint` reports zero gaps against the `showcase` and `use-all-bundled` samples. Handlers that a model must never call (provider callbacks, magic-link token flows, machine-only ingest paths) carry `agent: { expose: false }` instead of a description; destructive or irreversible ones carry `agent: { risk: "high" }`.

Entity-convention handlers could not carry a description before: `defineEntityCreateHandler` and its siblings only accepted `access`. `EntityHandlerOptions` (and by extension `EntityQueryHandlerOptions`) now also accept `description` and `agent`, and `registerEntityCrud`/`r.crud` gain a per-verb `descriptions: { create, update, delete, restore, list, detail }` option that falls back to `write.description`/`read.description`. Exposure stays fail-closed — an undescribed verb is still invisible to the agent.

Fixes `defineWriteHandler` silently dropping `description` and `agent`: it rebuilds its return value from an explicit field whitelist, and the two slots added for the AI-agent manifest were never copied, so 37 authored write-handler descriptions never reached the registry. `defineQueryHandler` returns its definition verbatim and was unaffected. `createEntity`'s inline parameter type also gained the `description` that `EntityDefinition` already declared.
