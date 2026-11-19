---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-framework": patch
---

`useDebouncedValue` is exported from `@cosmicdrift/kumiko-renderer/web`, the raw-hooks lint names it, and the app lint warns about a plain vertical flex with gap.

<!-- kumiko-changes
feature: renderer
type: improvement
title: useDebouncedValue in /web and a Stack hint in the app lint
detail: `useDebouncedValue(value, delayMs)` is now also exported from `@cosmicdrift/kumiko-renderer/web` and listed in the widget reference. The no-raw-hooks message names it for a debounced search instead of a hand-written effect. The raw-ui-in-app lint warns on `className="flex flex-col gap-2|4|6"` and points to `Stack` with `gap="sm"|"md"|"lg"`.
-->
