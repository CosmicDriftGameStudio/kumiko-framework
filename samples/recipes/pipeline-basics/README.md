# Pipeline Basics — Inventory-Management

End-to-end showcase of the **M.1 step-vocabulary**: every Tier-1 step
exercised in a single inventory-management feature, with a real
Postgres + Redis integration test that proves the pipeline form
behaves end-to-end against the worktree's framework source.

## What's inside

| Step | Where it shows up |
|---|---|
| `r.step.aggregate.create` | `product:create` |
| `r.step.aggregate.update` | `product:rename`, `product:adjust-stock`, `product:bulk-adjust` |
| `r.step.aggregate.appendEvent` | `product:adjust-stock`, `product:archive`, `report:archive-low-stock-products` |
| `r.step.read.findOne` | `product:rename`, `product:adjust-stock`, `product:bulk-adjust` |
| `r.step.read.findMany` | `report:archive-low-stock-products` |
| `r.step.compute` | `product:adjust-stock`, `product:bulk-adjust` |
| `r.step.branch` | `product:rename`, `product:adjust-stock` |
| `r.step.forEach` | `product:bulk-adjust`, `report:archive-low-stock-products` |
| `r.step.return` | every handler |
| `r.step.unsafeProjectionUpsert` | `product:adjust-stock` |
| `r.step.unsafeProjectionDelete` | `product:adjust-stock`, `product:archive`, `report:archive-low-stock-products` |

## Domain

A product has an SKU, a name, and a current-stock counter. Operators
adjust stock individually (`product:adjust-stock`) or in bulk
(`product:bulk-adjust`). Whenever stock crosses below a threshold
(`LOW_STOCK_THRESHOLD = 10`), an alert row is upserted into a custom
projection (`read_inventory_low_stock_alerts`); when it returns above,
the alert is deleted — both inline in the same TX as the aggregate
write.

## Reading order

Open `src/feature.ts` and read top-to-bottom. Each handler is
preceded by a short comment block that names the steps it exercises
and why the combination is the production-realistic shape (not just
an API tour).

If you've only ever seen the free-form handler signature
(`r.writeHandler(name, schema, async fn, opts)`), compare:

- `samples/recipes/custom-handlers/src/feature.ts` — a similar
  domain, written in the free-form style.
- this file — the same kind of operations expressed as
  `defineWriteHandler({ perform: stepsPipeline(...) })`.

Two patterns the pipeline form catches that the free-form does not:

1. **Skip-if-noop**: `product:rename` runs `read.findOne` followed
   by `branch` — the `aggregate.update` step only fires when the
   name actually changed. In free-form code this kind of check
   tends to be inlined inconsistently per handler; the pipeline
   form makes it a visible step.
2. **Read-then-loop**: `report:archive-low-stock-products` calls
   `read.findMany` and pipes the result into `forEach` whose body
   appends an event + deletes the projection-row per item. The
   sub-pipeline boundary is explicit, the boot-validator walks
   into it, and the Designer (M.5) can render the loop body as a
   nested step group.

## Running

```bash
# From THIS sample directory
cd samples/recipes/pipeline-basics
bun test
```

The test relies on Postgres + Redis from `docker compose up`
(framework dev stack — not the published image).

### Worktree / alias note

This sample may need tsconfig `paths` so `@cosmicdrift/kumiko-framework`
resolves to `packages/framework/src` when testing unreleased engine APIs.
The repo-wide integration test config excludes this sample until the
engine APIs land in a published release.

## Caveats / things to know

- **Pure-ES vs CRUD-update**: `product:adjust-stock` is written
  in the pure event-sourcing shape — it appends a domain event
  (`product-stock-adjusted`) and lets the inline
  `product-stock-counter` projection update `currentStock`. The
  alternative (calling `aggregate.update` *and* `appendEvent` in
  one handler) inflates the stream-version mid-handler and trips
  optimistic-locking on the next call. The other handlers
  (`rename`, `bulk-adjust`) use `aggregate.update` directly
  because they don't combine it with `appendEvent`.
- **`unsafeProjection.*` allowlist**: every projection-table
  written via `unsafeProjectionUpsert`/`Delete` must be declared
  via `r.requires.projection("table_name")` in the same feature.
  The boot-validator enforces this and rejects writes against
  aggregate-tables (registered via `r.entity`) — those have to
  go through `r.step.aggregate.*`.
- **`PipelineCtx` import**: one resolver in `product:adjust-stock`
  annotates its argument as `PipelineCtx` because `payload:
  StepResolver<unknown>` can't infer the destructure. This is a
  known M.1 DX gap (Followup #4 — TData-inference); the rest of
  this sample's `as`-cast lastiness will get cleaner once that
  followup is closed.
- **Worktree-local test setup**: tsconfig `paths` may alias
  `@cosmicdrift/kumiko-framework` to the worktree source when testing
  unreleased engine APIs. Once published, the alias can go away.
