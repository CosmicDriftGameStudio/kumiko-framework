---
"@cosmicdrift/kumiko-bundled-features": minor
---

`isPrincipalBlocked` is no longer exported from `@cosmicdrift/kumiko-bundled-features/sessions`. It only compared the status and treated a deleted user with status `active` as active; use `isPrincipalRowBlocked(row)` from the `user` export for the login block, or `isPrincipalBlocked` from `user` where a plain status comparison is meant.

<!-- kumiko-changes
feature: sessions
type: breaking
title: isPrincipalBlocked is no longer exported from sessions
detail: The sessions export dropped its re-export of isPrincipalBlocked, which ignored isDeleted. isPrincipalRowBlocked from the user export covers status and isDeleted and is what the session callbacks use.
migration: import isPrincipalRowBlocked (for a user row) or isPrincipalBlocked (for a bare status) from "@cosmicdrift/kumiko-bundled-features/user" instead of the sessions export
-->
