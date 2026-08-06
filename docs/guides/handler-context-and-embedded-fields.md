---
status: reference
verified: 2026-08-06
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

## Model repeated structure as an embedded list

Use `createEmbeddedListField` when rows have no identity, history, or
independent lifecycle. `derived` cells describe values such as
`amount = quantity × unitPrice`; the server recomputes them before validation
and overwrites any client-supplied value. Missing source values leave an
incomplete multiplication unset rather than inventing zero. The client widget
uses the same arithmetic helper for live display, but the server is the
authority on every write.

The runnable [`embedded` sample](https://github.com/CosmicDriftGameStudio/kumiko-framework/tree/main/samples/recipes/embedded)
shows invoice lines with reference, select, money, totals, and derived metadata.
Use an aggregate instead when a row needs its own status, history, or handler.

## Treat unsupported structural fields as read-only

An `embedded` field without an embedded-list widget, a `jsonb` field, and a
`multiSelect` field carry objects or arrays. If no dedicated editor exists,
the renderer shows an informational, read-only Banner. It does not fall back
to an editable text input: coercing an object or array to text can turn a value
into `"[object Object]"` or `"a,b"` and overwrite the real data on save.

Use `embeddedList` metadata for list editing. Until a dedicated editor exists,
keep the field read-only and expose the value through a purpose-built surface
rather than adding a text fallback.

## See also

- [Commands and queries](/en/concepts/commands/) — handler transactions and cross-feature calls.
- [Aggregates vs. embedded fields](/en/concepts/aggregates-and-embeds/) — choosing an embedded field, list, or aggregate.
- [`embedded` sample](https://github.com/CosmicDriftGameStudio/kumiko-framework/tree/main/samples/recipes/embedded) — runnable schema and UI source.
