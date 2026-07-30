---
"@cosmicdrift/kumiko-bundled-features": patch
---

`user` entity gains a `timezone` field (IANA zone, validated, no default — mirrors `locale`). Set via `user:create`/`user:update`; login now threads it into the session so `ctx.tz.user` resolves to the user's actual timezone instead of always falling back to the tenant default (kumiko-framework#1636). Only the password-login flow (`login.write.ts`) populates it today — MFA-preauth, invite-accept, invite-signup, and signup-confirm sessions still leave it unset (falls back to `ctx.tz.tenant`, same as before this change; not a regression).
