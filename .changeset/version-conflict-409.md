---
"@cosmicdrift/kumiko-framework": patch
---

A custom write whose `ctx.appendEvent`/`stream.append` loses an optimistic-concurrency race now answers 409 `version_conflict` instead of 500 `internal_error`, matching the CRUD executor.

<!-- kumiko-changes
feature: framework
type: fix
title: Version conflicts from custom writes return 409 instead of 500
-->
