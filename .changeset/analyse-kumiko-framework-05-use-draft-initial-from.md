---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-framework": patch
---

Edit screens can fill their form from loaded data without a hand-written effect.

<!-- kumiko-changes
feature: renderer
type: improvement
title: useDraft fills the draft from query data once per key
detail: `useDraft(defaults, { initialFrom: { key, values } })` copies `values` into the draft the first time they arrive for a `key`, keeps the user's edits when the same key refetches, loads again for a new key and resets to `defaults` when `key` is `null`. It returns `loadedKey` for the record the draft belongs to. The no-raw-hooks lint message now points to this option instead of a `useEffect` with a loaded-ref gate.
-->
