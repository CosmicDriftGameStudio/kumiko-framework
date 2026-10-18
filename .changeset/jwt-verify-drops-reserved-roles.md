---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-testing": minor
---

JWT verification drops the `system` and `all` roles

A token signed with the right key could carry `roles: ["system"]` and be treated as the in-process System identity. `verify()` now removes `system` and `all` from the roles claim; minting never grants them. `anonymous`, `SystemAdmin` and all other roles are kept. The test request helper (`stack.http.*`) now throws when handed a user with the `system` role; use `stack.dispatcher.write/query` for system calls.

<!-- kumiko-changes
feature: framework
type: breaking
title: Tokens carrying system or all lose those roles on verify
detail: jwt.verify strips the system and all roles that session minting never grants, so a self-signed or leaked-key token cannot act as System.
migration: Apps that mint their own tokens with the `system` role must stop doing so and use `createSystemUser` or system dispatch in-process instead. Tokens issued by the framework are unaffected. Tests that send a system user over `stack.http.*` must switch to `stack.dispatcher.write/query`.
-->
