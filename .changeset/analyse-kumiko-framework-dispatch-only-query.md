---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-testing": patch
"@cosmicdrift/kumiko-feature-ast": patch
---

Query handlers accept `dispatchOnly: true`: server code still dispatches them, the HTTP entry answers 404.

<!-- kumiko-changes
feature: framework
type: improvement
title: dispatchOnly query handlers
detail: `r.queryHandler`, `defineQueryHandler` and `definePagedQueryHandler` take `dispatchOnly?: boolean`, with the same meaning as on write handlers. POST /api/query and the xlsx screen export answer a dispatch-only query with the 404 of an unknown handler; `ctx.dispatch.query` and `queryAs`, jobs and server routes still run it with the calling user. Such a query is never an agent tool (also not as a registry-derived list/get tool), grants no `/api/sse` live signals, and boot rejects it together with `agent.expose: true`. Boot also rejects a screen, dashboard panel or config-key `optionsQuery` that references a dispatch-only query (rule `query/dispatch-only-on-screen`), since the browser could never load it. The API docs for personal access tokens leave out dispatch-only queries and writes, since a token can never call them. `expectRoleRestrictedHandlersDenyForeignRole` expects 404 `not_found` for a dispatch-only query.
migration: A query that only a server flow may run (for example one that returns decrypted personal data after the flow checked a token) declares `dispatchOnly: true`. Clients that call it over /api/query get 404 afterwards.
affects: QueryHandlerDefinition, QueryHandlerDef, defineQueryHandler, definePagedQueryHandler, expectRoleRestrictedHandlersDenyForeignRole
-->
