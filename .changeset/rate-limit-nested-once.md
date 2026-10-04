---
"@cosmicdrift/kumiko-framework": patch
---

Nested dispatches no longer charge a rate-limit bucket twice

A handler that calls `ctx.query`, `ctx.queryAs` or `ctx.write` into another handler with a limit on the same bucket (for example `per: "ip"`) used to cost two tokens per request. Each entry dispatch now charges a bucket once, and nested calls reuse that charge. Nested handlers that limit a different bucket are still limited, and every command of a batch still charges on its own. The public `/media` route had half its advertised limit because of this.

<!-- kumiko-changes
feature: rate-limit
type: fix
title: A request costs one rate-limit token per bucket even when the handler nests queryAs or ctx.query calls into handlers sharing that bucket
-->
