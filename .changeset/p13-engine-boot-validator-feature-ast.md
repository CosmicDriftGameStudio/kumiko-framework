---
"@cosmicdrift/kumiko-framework": patch
---

The boot validator now rejects a `redirect` on `entityList`, `projectionList` and `relatedList` row actions, where it was silently ignored. The feature-ast parser reports an `httpRoute` whose `anonymous` is a non-literal expression as a parse error instead of rewriting it to `false` on round-trip, and a local non-literal `const` no longer resolves to a same-named import. `r.nav()` strips explicitly-`undefined` properties for every registration path.

<!-- kumiko-changes
feature: framework
type: fix
title: boot validator rejects redirect on list row actions, httpRoute with non-literal anonymous is a parse error, local const shadows same-named import in feature-ast, r.nav strips undefined properties
-->
