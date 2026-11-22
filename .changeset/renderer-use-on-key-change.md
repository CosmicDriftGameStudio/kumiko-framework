---
"@cosmicdrift/kumiko-renderer": patch
---

New `useOnKeyChange` hook: runs a callback once per key change (a mutation or refetch) without a raw useEffect.

<!-- kumiko-changes
feature: renderer
type: improvement
title: useOnKeyChange runs a callback once per key change without a raw useEffect
detail: `useOnKeyChange(key, run, { initial })` calls `run(key)` when the key changes; `null` means not ready and keeps the last seen key, `initial: "skip"` only remembers the first key. Use it to fire a mutation or refetch once per key from app code that the no-raw-hooks guard keeps free of useEffect.
migration: Effects that run once per key change (a mutation or refetch triggered by an id or status) should switch to `useOnKeyChange`; app repos need this to pass the no-raw-hooks guard.
-->
