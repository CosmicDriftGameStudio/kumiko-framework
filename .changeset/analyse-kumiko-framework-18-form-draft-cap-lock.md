---
"@cosmicdrift/kumiko-bundled-features": patch
---

Parallel draft saves can no longer push a user past the per-owner draft limit.

<!-- kumiko-changes
feature: form-draft
type: fix
title: form-draft save serialises the per-owner draft cap
detail: `form-draft:write:save` counted the owner's drafts and then created the new one without a lock, so several parallel saves with different draft keys could all pass the count and exceed the per-owner limit. The create path now takes an advisory lock on the owner before counting; updates of an existing draft are unaffected.
-->
