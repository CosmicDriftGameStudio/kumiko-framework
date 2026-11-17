---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-testing": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Executor writes run the app's custom projections on every TenantDb built over an app connection, including multi-stream projection applies, raw transactions and forget hooks.

<!-- kumiko-changes
feature: framework
type: breaking
title: App connections carry their projection registry
detail: The prod boot, the worker boot and `setupTestStack` bind both database pools to the app registry with the new `bindAppProjectionRegistry(connection, registry)` from `@cosmicdrift/kumiko-framework/db`. Every transaction, savepoint and reserved connection derived from them inherits it, so `createTenantDb({ db: tx, ... })` inside a multi-stream projection apply or a raw `transaction()` runs the custom projections of an executor write, as the dispatcher's own TenantDb already did. User-data delete and export hooks get a TenantDb with the registry, so `executor.forget(id, user, ctx.db)` in a forget hook also clears child projections for the `<entity>.forgotten` event. Binding a connection to a second, different registry throws. Connections that are never bound (CLI tools, a bare `createTestDb`) keep skipping custom projections.
migration: Remove manual `runProjectionsForEvent(...)` calls that follow an executor write (create, update, delete, forget) on a TenantDb built over an app connection, together with the `unsafeRaw()` grant and escape hatch they needed; the executor has already projected that event object, so the manual call is a no-op. Raw `append(...)` plus `runProjectionsForEvent` stays as it is.
-->
