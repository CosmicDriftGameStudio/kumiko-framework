---
"@cosmicdrift/kumiko-bundled-features": minor
---

`auth-mfa` gains a `status` query (`AuthMfaQueries.status`, wire QN `auth-mfa:query:user-mfa:status`) returning `{ enabled: boolean }` for the calling user — the one thing a settings/security screen needs to decide whether to show the enrollment flow or the disable/regenerate actions. No client-side signal carried this before.
