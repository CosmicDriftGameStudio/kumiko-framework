---
"@cosmicdrift/kumiko-renderer": minor
---

useQuery gains a refetchIntervalMs option for polling

With `refetchIntervalMs` set, an enabled query re-runs on a timer. Background ticks keep `loading` false, are skipped while a fetch is still in flight, and stop on unmount or when enabled, the interval, type or payload change. Only timers are used, so it works on web and React Native.

<!-- kumiko-changes
feature: renderer
type: improvement
title: useQuery gains a refetchIntervalMs option for polling
-->
