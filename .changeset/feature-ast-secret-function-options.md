---
"@cosmicdrift/kumiko-framework": patch
---

feature-ast reads function values in r.secret options

<!-- kumiko-changes
feature: framework
type: fix
title: r.secret options with function values (redact) no longer fail to parse
detail: |
  r.secret(...) options that contain arrow or function expressions (for example redact: () => "••••••••") were reported as "options could not be read as a plain object", which turned the whole feature into a legacy corpus entry. The functions are now kept verbatim as raw references, option keys stay visible and a parse to render round-trip keeps them (multi-line function bodies may be re-indented). Function values in other patterns (entity, nav, metric, job) are still rejected on purpose.
migration: |
  Consumers that ship a checked-in few-shot corpus (Enterprise) should regenerate it on the next framework bump; its drift test enforces that.
-->
