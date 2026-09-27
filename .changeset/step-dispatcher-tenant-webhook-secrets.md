---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

`r.step.webhook.send`'s `auth.secretRef` resolved through a module-global `secretResolver`, defaulting to `process.env["WEBHOOK_SECRET_" + ref]` — a platform-wide, process-scoped credential store with no tenant boundary. Any tenant able to configure a webhook auth ref could, in principle, reach a secret meant for another tenant or for the operator's own infrastructure, and the only way to change what a ref resolved to was redeploying the process with new env vars.

`auth.secretRef` is now `auth.secret`, resolved per-tenant at dispatch time through the `secrets` bundled-feature under the tenant-owned namespace `step-dispatcher:webhook-auth.<secret>`. The `step-dispatcher` feature now `r.requires("secrets")`. A missing or unconfigured secret — or a request from a tenant that never set one — fails with the same generic `webhook auth secret is not available` message, without ever echoing the secret's name back onto the tenant-visible `step.dispatch-failed` event.

<!-- kumiko-changes
feature: step-dispatcher
type: breaking
title: Webhook auth secrets are now tenant-owned via the secrets feature, not a global env var
detail: |
  `r.step.webhook.send`'s `auth` config renamed `secretRef` → `secret`. The
  value is now a name inside the tenant-owned secrets namespace
  `step-dispatcher:webhook-auth.<secret>` (secrets feature), resolved via
  `SecretsContext.get()` at dispatch time with an audit read stamped with
  the triggering event's userId (or the system actor for cron/resume
  dispatches). `setWebhookSecretResolver` / the `WEBHOOK_SECRET_*` env
  convention are gone. `performWebhookDispatch(spec)` now takes a required
  second `deps: { tenantId, userId, secrets }` argument.
migration: |
  Mount `createSecretsFeature()` (with a `MasterKeyProvider`) alongside
  `createStepDispatcherFeature()` — boot-validation now fails without it.
  For each tenant that uses `r.step.webhook.send` with `auth`, set the
  credential via `secrets:write:set` under
  `step-dispatcher:webhook-auth.<secret>` (the same name passed as
  `auth.secret`). Rename `auth.secretRef` → `auth.secret` at every
  `r.step.webhook.send({ auth: {...} })` call site. Remove any
  `WEBHOOK_SECRET_*` env vars — they're no longer read.

  A `step.dispatch-requested` event already enqueued before this upgrade
  (still carrying the old `secretRef` shape) fails validation on drain and
  is recorded as `step.dispatch-failed` with `error: "invalid dispatch
  payload"` instead of silently resolving a stale ref — drain the queue (or
  accept the one-time failed event) before deploying.

  Tests calling `performWebhookDispatch` directly or using
  `setWebhookSecretResolver` must pass a `SecretsContext` (or `undefined`)
  via the new `deps` argument instead.
-->

<!-- kumiko-changes
feature: framework
type: breaking
title: webhook.send step auth secretRef renamed to secret; MultiStreamApplyContext gained an optional secrets field
detail: |
  `r.step.webhook.send`'s `auth` union renamed `secretRef` → `secret` (see
  the step-dispatcher entry for the full rationale). `MultiStreamApplyContext`
  (and `createMultiStreamApplyContext`'s deps) gained an optional
  `secrets?: SecretsContext` field, mirroring `files`/`derivatives` — present
  when the app booted with the secrets feature, letting a saga/process-
  manager MSP apply read a tenant secret with its own audit context. The
  server's MSP consumer wiring now threads the boot-time `AppContext.secrets`
  through automatically; `rebuildMultiStreamProjection`'s rebuild context
  deliberately does not carry `secrets` (rebuild must stay side-effect-free).
migration: |
  Rename `auth.secretRef` → `auth.secret` at every `r.step.webhook.send`
  call site. No action needed for `MultiStreamApplyContext` consumers that
  don't read `ctx.secrets` — the field is optional and additive.
-->
