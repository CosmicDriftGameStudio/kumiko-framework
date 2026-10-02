---
"@cosmicdrift/kumiko-bundled-features": patch
---

The inbound-mail OAuth callback now checks for a configured secrets context before exchanging the authorization code and creating the mail account. Without secrets the callback answers 500 `secrets_context_missing` and no orphan account is left behind. `form-draft:get` now logs a warning when a stored draft blob fails its schema instead of dropping it silently.

<!-- kumiko-changes
feature: inbound-mail-foundation
type: fix
title: OAuth callback fails before creating an account when no secrets context is wired
-->
