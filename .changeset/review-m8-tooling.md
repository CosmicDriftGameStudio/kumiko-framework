---
"@cosmicdrift/kumiko-testing": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-guards": patch
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-framework": patch
---

Event-store test helpers reject ambiguous filters, the guard slot directory self-heals, the unsafe-array guard stops flagging spreads, the agent API docs include `typeof` constants, and the dev server boots with `KUMIKO_REDIS_PREFIX` set.

<!-- kumiko-changes
feature: testing
type: fix
title: event-store write helpers fail on ambiguous row filters
detail: `updateRowViaEventStore` and `deleteRowViaEventStore` now throw when the filter matches more than one row instead of writing to whichever row came first. `updateInvitationViaEventStore` also filters on the inviting tenant, so the same email invited in two tenants no longer hits the wrong row.
-->

<!-- kumiko-changes
feature: guards
type: fix
title: guard slot directory from older versions is tightened, spreads no longer flagged
detail: A slots directory created with mode 0755 by an earlier version made the slot check fail open on every run. A directory owned by the current user is now chmod-ed to 0700 and used; foreign owners and symlinks are still rejected. `guard-unsafe-array-param` no longer warns on spreads in the parameter list, since they bind as scalars. The generated API reference now lists unexported constants that exported types reach through `typeof`.
-->

<!-- kumiko-changes
feature: dev-server
type: fix
title: dev server boots when KUMIKO_REDIS_PREFIX is set
detail: The SSE channel prefix defaulted to a per-boot value that differs from `KUMIKO_REDIS_PREFIX`, which `redisNamespaceFromEnv` rejects. The prefix now falls back to `KUMIKO_REDIS_PREFIX` before the per-boot default.
-->
