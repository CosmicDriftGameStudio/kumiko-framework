---
status: reference
verified: 2026-08-13
---

# Handler context and embedded fields

A write handler has two boundaries to keep explicit: what belongs to the
handler's transaction, and what belongs to shared infrastructure. Embedded
fields add a third boundary in the UI: structured values must never be
silently coerced into text.

## Start with the owning feature

Shared code that records a metric should not bind to whichever feature happened
to call it. Declare the metric in the library-owning feature and use
`ctx.metricsFor` at the call site:

```ts illustration
const metrics = ctx.metricsFor("ai-foundation");
metrics.inc("provider_call_total", { provider: "acme" });
```

The explicit feature name gives the metric one stable
`kumiko_<feature>_<metric>` name across all consumers. Feature names may use
the same kebab-case used by `defineFeature`; the framework normalises the name
for metric registration and lookup. An unregistered target is a no-op, which
keeps an error-path counter from turning a handled error into a new exception.
Other failures — invalid names or metric-type mismatches — still surface.

## Keep the transaction choice visible

`ctx.db` is tenant-scoped and bound to the current write transaction. A failed
handler rolls back writes made through it, including nested writes made through
the dispatcher.

`ctx.dbOutsideTransaction` is also tenant-scoped, but uses the unbound pool.
Writes through it survive a rollback of the handler transaction. Use it only
to record a fact whose external side effect has already happened and must not
be forgotten when the business write fails — for example, a provider charge
acknowledgement or a delivery-attempt record. It is not a replacement for
`ctx.db` and does not make an otherwise atomic workflow atomic.

## `r.systemScope()` handlers self-check through `ctx.systemDb`

`r.systemScope()` switches a feature's `TenantDbMode` from `"tenant"` to
`"system"`: reads, updates, and deletes through `ctx.db` no longer carry the
automatic tenant filter, and inserts default to the caller's tenant but let
the handler override it. That access is necessary for genuinely cross-tenant
work (platform admin screens, cross-tenant jobs) but is easy to get wrong —
a handler that forgets its own tenant self-check silently reads or writes
another tenant's rows.

`HandlerContext.systemDb?: UncheckedSystemDb` exists to make that self-check
explicit instead of optional convention. It is populated whenever
`r.systemScope()` is set on the calling feature; check for `undefined` before
use, since a handler on a tenant-scoped feature never receives it. It offers
three methods, all returning the same `TenantDb` that `ctx.db` would give you
so the query calls after them are unchanged:

- **`assertTenantMatch(tenantId)`** — throws `AccessDeniedError` unless
  `tenantId` is exactly the caller's own tenant, then returns the checked
  `TenantDb`. Pass the tenant id the handler is about to touch: a
  client-supplied or looked-up target (rejects a cross-tenant attempt), or —
  when the handler only ever operates on the caller's own scope — the
  caller's own tenant id from the session, which routes the handler through
  the checked accessor instead of the raw `ctx.db` escape hatch.
- **`assertRowsTenant(rows, tenantField)`** — throws unless every row's
  `tenantField` is the caller's own tenant *or* the shared system-reference
  tenant. Slightly looser than `assertTenantMatch`, which accepts only the
  caller's own tenant — reference rows are legitimately shared.
- **`acknowledgeCrossTenant(reason)`** — the deliberate escape hatch for
  handlers that are cross-tenant by design (a `SystemAdmin` action, a
  platform-wide job). `reason` must be non-empty; it throws otherwise. Treat
  the reason as documentation for the next reader, not decoration.

`packages/bundled-features/src/tenant/handlers/update.write.ts` shows the
two-branch shape: a `SystemAdmin` update is cross-tenant by design, while a
tenant-scoped `Admin` must be checked against the row being edited.

```ts illustration
if (!ctx.systemDb) {
  throw new InternalError({ message: "requires ctx.systemDb — is r.systemScope() set?" });
}

if (event.user.roles.includes("SystemAdmin")) {
  const db = ctx.systemDb.acknowledgeCrossTenant("SystemAdmin is platform-wide by design");
  return crud.update(event.payload, event.user, db);
}

try {
  // The tenant entity's own id doubles as a tenant id, which is why it's
  // valid here — a foreign key on another entity would need its owning
  // tenant id instead, not the row's own id.
  const db = ctx.systemDb.assertTenantMatch(event.payload.id);
  return crud.update(event.payload, event.user, db);
} catch (err) {
  // Reported as tenant_not_found, not the underlying access_denied, so a
  // cross-tenant Admin can't use the error to enumerate tenant existence.
  if (err instanceof AccessDeniedError) return writeFailure(new NotFoundError("tenant", event.payload.id));
  throw err;
}
```

`assertRowsTenant` fits a different shape: a job that scans cross-tenant,
buckets rows by tenant, then re-verifies each bucket right before writing it
— see `packages/bundled-features/src/config/handlers/reencrypt.job.ts`
(`config`'s KEK-rotation job) for the full pattern.

This is convention today, not yet compiler-enforced: `ctx.db` stays reachable
and unfiltered on a `"system"`-mode feature alongside `ctx.systemDb`, so
nothing currently stops a new handler from bypassing the wrapper. Framework
issue #2056 tracks migrating the bundled features to `ctx.systemDb`; the
planned cutover (#2082) removes `ctx.db` from system-scoped handlers
entirely, at which point a handler without an explicit check no longer
compiles. Until then, treat `ctx.systemDb` as the required entry point for
any new or touched `r.systemScope()` handler.

## Model repeated structure as an embedded list

Use `createEmbeddedListField` when rows have no identity, history, or
independent lifecycle. `derived` cells describe values such as
`amount = quantity × unitPrice`; the server recomputes them before validation
and overwrites any client-supplied value. Missing source values leave an
incomplete multiplication unset rather than inventing zero. The client widget
uses the same arithmetic helper for live display, but the server is the
authority on every write.

The runnable [`embedded` sample](https://github.com/CosmicDriftGameStudio/kumiko-framework/tree/main/samples/recipes/embedded)
shows invoice lines with reference, select, money, totals, and `embeddedListDerived` values.
Use an aggregate instead when a row needs its own status, history, or handler.

## Treat unsupported structural fields as read-only

An `embedded` field without an embedded-list widget, a `jsonb` field, and a
`multiSelect` field carry objects or arrays. If no dedicated editor exists,
the renderer shows an informational, read-only Banner. It does not fall back
to an editable text input: coercing an object or array to text can turn a value
into `"[object Object]"` or `"a,b"` and overwrite the real data on save.

`embeddedListCells` carries per-cell metadata for the list editor, and
`embeddedListDerived` carries derived-cell definitions. For structural fields
without a dedicated editor, keep the value read-only rather than adding a text
fallback.

## See also

- [Commands and queries](/en/concepts/commands/) — handler transactions and cross-feature calls.
- [Aggregates vs. embedded fields](/en/concepts/aggregates-and-embeds/) — choosing an embedded field, list, or aggregate.
- [`embedded` sample](https://github.com/CosmicDriftGameStudio/kumiko-framework/tree/main/samples/recipes/embedded) — runnable schema and UI source.
