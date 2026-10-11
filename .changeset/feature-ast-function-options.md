---
"@cosmicdrift/kumiko-framework": patch
---

feature-ast reads function values in useExtension options and extension names imported from installed packages

<!-- kumiko-changes
feature: framework
type: fix
title: useExtension options with function values and package-imported extension names no longer fail to parse
detail: |
  r.useExtension(...) options that contain arrow or function expressions (for example isPublic: ({ entityId }) => ...) were reported as "options could not be read as a plain object", which turned the whole feature into a legacy corpus entry. The functions are now kept verbatim as raw references, option keys stay visible and parse to render round-trips unchanged. An extension name imported from a package whose types resolve to dist/*.d.ts (an installed @cosmicdrift/* package in a consumer repo) is now read from its `export declare const NAME: "value"` type instead of failing. Function values elsewhere (entity, nav, metric, job) are still rejected on purpose.
migration: |
  Consumers that ship a checked-in few-shot corpus (Enterprise) should regenerate it on the next framework bump; its drift test enforces that. The new ratchet test in dev-server pins the framework's own canonical count and parse-error ceiling.
-->
