---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-framework": patch
---

`useNow(intervalMs)` gives screens a ticking clock without a raw effect.

<!-- kumiko-changes
feature: renderer
type: improvement
title: useNow hook for a ticking clock
detail: `useNow(intervalMs)` from `@cosmicdrift/kumiko-renderer` returns the current time in epoch ms and re-renders every `intervalMs`. It reads the server-aligned clock, so countdowns and "x ago" texts agree with server timestamps. `null`, zero or a negative interval stops the ticking and keeps the last value; switching back on refreshes the value at once. `PresenceNotice` uses it for its minute clock. The no-raw-hooks lint message now names `useNow(intervalMs)` for clock ticks and `useQuery` with `refetchIntervalMs` for polling.
-->
