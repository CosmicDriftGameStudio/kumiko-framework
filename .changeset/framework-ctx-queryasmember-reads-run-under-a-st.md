---
"@cosmicdrift/kumiko-framework": minor
---

ctx.queryAsMember reads run under a statement timeout (DispatcherOptions.memberReadTimeoutMs, default 10000) and fail with member_read_timeout

<!-- kumiko-changes
feature: framework
type: improvement
title: ctx.queryAsMember reads run under a statement timeout (DispatcherOptions.memberReadTimeoutMs, default 10000) and fail with member_read_timeout
-->
