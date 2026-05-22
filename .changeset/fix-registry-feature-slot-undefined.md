---
"@cosmicdrift/kumiko-framework": patch
---

`createRegistry` guards all `Object.entries(feature.X)` against undefined slots — bun-bundled features can have optional slots dropped by minification. Pauschal-fix für alle 22 sites in registry.ts (entities, relations, writeHandlers, queryHandlers, configKeys, jobs, notifications, events, translations, searchPayloadExtensions, registrarExtensions, metrics, projections, multiStreamProjections, rawTables, screens, navs, workspaces, handlerEntityMappings, ...).
