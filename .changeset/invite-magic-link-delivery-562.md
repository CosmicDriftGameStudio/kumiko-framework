---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-dev-server": minor
---

auth-email-password: migrate the tenant-invite flow off its app callback onto the `delivery` system, completing the #562 migration (all four magic-link flows now mail via `ctx.notify`).

`invite-create` now dispatches the invite mail itself via `ctx.notify` (delivery), like reset/verify/signup — and no longer returns the token in its result, so a tenant admin can't see or accept with the invitee's token. `delivery` is now a hard boot requirement when invite is mounted.

Breaking:
- `InviteConfig` (framework auth-routes) drops `sendInviteEmail` / `appAcceptUrl` — only the three accept handlers remain.
- `InviteOptions` / dev-server `InviteSetup` carry `appUrl` (+ optional `appName` / `locale`) instead of the callback.
- `InviteCreateData` no longer includes `token`.
- `renderInviteEmail` returns structured `AuthMailContent` (was `RenderedEmail`); `RenderInviteEmailArgs` switches `inviteUrl` → `url`.
- `createAuthMailerConfig` / `AuthMailerConfig` / `CreateAuthMailerConfigArgs` are removed (invite was the last callback consumer); `RenderedEmail` is removed. `AuthPaths` / `DEFAULT_AUTH_PATHS` / `makeAuthPaths` keep their public names (moved to a dedicated module).

Mount `delivery()` + a mail channel + a transport instead of wiring `sendInviteEmail`.
