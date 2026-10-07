---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
"@cosmicdrift/kumiko-types": patch
---

Stricter boot checks and role projection for screens and handlers

Inline handler registration without `options.access` now throws immediately, a section with `fields: []` and `groups: []` fails boot, and unknown tones in `header.statusTones` or select `optionTones` fail boot instead of dropping the badge colour. The renderer falls back to the value heuristic for an unknown tone, and `statusToneForOptionTone` now returns `undefined` for it. `secretMint` confirm-step actions are stripped for roles that cannot see the target screen.

Entity convention `create` handlers keep tenant-filtered lookups even when the handler declares `escapeHatch`/`crossTenant`. Duplicate `waitForEvent` steps on the same `awaits` event are rejected when the workflow pipeline is built. An empty `PROMETHEUS_METRICS_TOKEN` counts as unset instead of failing boot.

<!-- kumiko-changes
feature: screens
type: fix
title: Unknown status tones fail boot and secretMint confirm actions respect role gating
-->
