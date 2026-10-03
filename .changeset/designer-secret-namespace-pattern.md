---
"@cosmicdrift/kumiko-framework": patch
---

The Designer source model now parses `r.secretNamespace(...)` as its own pattern kind `secretNamespace` instead of falling back to `unknown`, renders it back and can add it through the pattern library. A Zod `nameSchema` or an options identifier is kept verbatim. The `r.secret` form gains a `writeRoles` list and no longer offers the `system` scope, which the secret type never allowed.

<!-- kumiko-changes
feature: framework
type: improvement
title: Designer reads and creates r.secretNamespace, edits writeRoles on secrets
-->
