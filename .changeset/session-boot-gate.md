---
"@cosmicdrift/kumiko-server-runtime": patch
---

`runProdApp` now aborts boot when auth is mounted but the `sessions` feature is not and `auth.sessions` wasn't explicitly set to `false`. Without this, an app that forgets to mount `sessions` silently falls back to stateless JWTs (no server-side revocation, valid until the 24h expiry) with no warning — the `sessions` feature is not part of the auto-mounted auth foundation (config/user/tenant/auth-email-password), so this had no gate at all (#1262, #1275). Existing apps that intentionally run stateless need to pass `{ auth: { sessions: false } }`.
