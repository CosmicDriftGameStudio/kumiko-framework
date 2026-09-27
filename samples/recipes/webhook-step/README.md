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

## Source

Feature entry point: `src/feature.ts`.

## Tests

```bash
cd samples/recipes/webhook-step
bun test
```
