---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

`SessionUser` gains an optional `locale` field, carried in the JWT `locale` claim alongside the existing `timezone` claim. It's set at login from the user's stored `locale` column (the same column `user:update` already lets users change explicitly) and threaded through every session-minting handler (login, invite-accept, MFA enable/verify).

`ctx.locale`'s fallback chain now checks the persisted `SessionUser.locale` (validated as a well-formed BCP-47 tag) between the live per-request signal (`X-Locale`/`Accept-Language`) and the app's boot-configured `defaultLocale` — so a user's chosen language now survives across devices and background/job contexts that carry no request-scoped locale signal.

Silent server-side adoption of the live `ctx.locale` back onto `SessionUser` at login was considered and rejected: `ctx.locale` is already cascaded through the boot default by the time a handler sees it, so a login without an `X-Locale`/`Accept-Language` signal (curl, non-browser clients) would silently overwrite an explicitly-chosen locale. The existing `user:update` write path stays the sanctioned way to change a stored locale.
