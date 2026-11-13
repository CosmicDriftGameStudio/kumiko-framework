---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-dev-server": minor
---

`runProdApp` and `runDevApp` take `previewLogin: { loginKey }`: `GET /__kumiko/preview-login?exp=<epoch-seconds>&sig=<hex>` signs the bootstrap owner in (302 to `/`, the normal auth cookies) when `sig` is the hex HMAC-SHA256 of `kumiko-preview-login:<exp>` under `loginKey` and `exp` lies at most about 90 seconds ahead; anything else answers 403, and the route is absent without the option. `seeds.bootstrapAdminFromEnv` takes `ensureRoles: true`, which adds roles that `roles` gained after the first boot to the owner's existing membership on every boot (additive, through the event-store executor, no event when nothing is missing). A membership whose roles a person changed since is left alone. The preview login issues an owner session without the MFA gate: set `loginKey` only on preview deployments, never on a live deploy.

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: Studio preview login and owner role top-up
detail: `previewLogin: { loginKey }` on runProdApp and runDevApp mounts a signed, short-lived link that signs the bootstrap owner in without a password. `bootstrapAdminFromEnv: { ensureRoles: true }` adds newly declared `roles` to the owner's existing membership on every boot.
-->
