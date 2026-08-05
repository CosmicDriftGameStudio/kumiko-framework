# API/Worker-Split

Run Kumiko as two separate processes — an HTTP API that only enqueues jobs,
and a worker that executes them and applies the read models the API skips.
This is the deploy topology behind `runSingleInstance: false` +
`createWorkerEntrypoint`.

## What it shows

- **Two entrypoints, one feature** — `bin/api.ts` starts the API process
  (`runProdApp({ runSingleInstance: false })`), `bin/worker.ts` the worker
  (`runWorkerApp`). Both build the same `orders` feature; they differ only
  in what they run.
- **API = enqueuer-only** — the API writes events and pushes `runIn:
  "worker"` jobs onto the BullMQ queue. It consumes nothing and applies no
  multiStreamProjections.
- **Worker = the read side** — the worker's event-dispatcher applies the
  `order-activity` projection and its BullMQ runner executes
  `process-order`.
- **The sharp edge, live** — with `runSingleInstance: false` the API
  process applies no multiStreamProjections. No worker running means the
  `order-activity` read side stays empty, silently (the 2026-06-11 incident
  class). The integration test asserts exactly this.
- **Result written back through the worker dispatcher** — `JobContext` has
  no `write`/`query` (fw#1717). `bin/worker.ts` wires a write-bridge from
  `dispatchSystemWrite` and the job uses it to create a `fulfillment` row
  (same pattern as `inbound-mail-foundation/watch-supervisor.ts`).

## Run

Requires Postgres + Redis (env: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`).

```bash
bun install
bun run schema:apply        # creates infra + entity tables (kumiko/migrations)
bun run api                 # terminal 1 — HTTP + enqueue
bun run worker              # terminal 2 — consumes jobs, applies projections
```

Prove the topology:

```bash
curl -X POST http://localhost:3000/api/write \
  -H 'Content-Type: application/json' \
  -d '{"type":"orders:write:order:create","payload":{"customerName":"Acme GmbH","amount":499}}'
```

With only the API running, `read_orders` gains the row but
`read_order_activity` stays empty. Start the worker and both the activity
row and the `read_fulfillments` row appear.

## Test

```bash
bun test src/__tests__/feature.integration.test.ts
```

Runs both entrypoints in-process against real Postgres + Redis and asserts
the API-only read side stays empty before the worker picks up the job and
writes the fulfillment back.
