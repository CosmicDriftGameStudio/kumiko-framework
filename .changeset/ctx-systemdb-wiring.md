---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
---

`HandlerContext` gains `systemDb?: UncheckedSystemDb` (fw#2067's fail-closed wrapper), populated for `r.systemScope()` handlers alongside the existing `ctx.db`. Non-system handlers don't receive it — `ctx.db` behavior is unchanged for everyone.
