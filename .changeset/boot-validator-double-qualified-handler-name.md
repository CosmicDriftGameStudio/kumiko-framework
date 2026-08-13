---
"@cosmicdrift/kumiko-framework": patch
---

Fixes a silent 404: passing an already-qualified string (e.g. `"ai-orchestration:query:duplicate-candidates"`) as a handler/job/notification/event/config-key short name produced a doubly-qualified QN (`ai-orchestration:query:ai-orchestration:query:duplicate-candidates`) instead of failing at boot. Every call to the target never matched the real route and 404'd silently. `qn()` now rejects a short name that starts with `"<feature-name>:<qn-type>:"` (e.g. `"ai-orchestration:query:..."` on the `ai-orchestration` feature) — that specific prefix only ever arises from passing the full QN as the short name, never from legitimate sub-structure — and suggests the corrected short name.
