# Webhook Step

Workflow / pipeline step that calls an HTTP webhook.

## What it shows

- Webhook step registration in a workflow
- Retry / failure surface for outbound HTTP
- Authenticated webhooks via a tenant-owned secret (`incident:open-authenticated`)

## Auth secret

`r.step.webhook.send`'s `auth.secret` is a name inside the tenant-owned
`step-dispatcher:webhook-auth.<name>` namespace of the `secrets` feature —
never a process-wide env var. The `secrets` feature must be mounted
(`createSecretsFeature()` + a `MasterKeyProvider`) alongside
`step-dispatcher`. Set the secret per tenant before dispatching:

```ts
await stack.http.writeOk(
  "secrets:write:set",
  { key: "step-dispatcher:webhook-auth.incident-hook", value: "<token>" },
  tenantAdmin,
);
```

Each tenant's secret is isolated — a tenant with no matching secret (or one
stored without the `step-dispatcher:webhook-auth.` prefix) gets a generic
`webhook auth secret is not available` `step.dispatch-failed` event, never
another tenant's credential.

Never combine `auth.secret` with a caller-controlled `url`: the caller would
receive the secret as the `Authorization` header. `incident:open-authenticated`
therefore posts to a fixed URL.

## Idempotency-Key

Every webhook request carries `Idempotency-Key: <dispatch stream id>`. The
value is the same when the same dispatch request is delivered again, so a
receiver can deduplicate redelivered calls. An `Idempotency-Key` set explicitly in
`headers` (any casing) wins.

## Source

Feature entry point: `src/feature.ts`.

## Tests

Needs a running Postgres and `TEST_DATABASE_URL` set (e.g. `postgres://postgres:postgres@127.0.0.1:5432/postgres`, see `demo/.env.example`).

```bash
cd samples/recipes/webhook-step
bun test
```
