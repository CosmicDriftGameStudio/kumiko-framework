---
"@cosmicdrift/kumiko-framework": patch
---

Server-side eagerload (`_refs`) for reference fields now behaves correctly for two edge cases it previously mishandled:

- A referenced entity that declares row-level ownership on `access.read` (beyond a plain `"all"` role) has its PII/encrypted fields stripped from `_refs` instead of decrypted — eagerload has no `SessionUser` to evaluate the ownership rule against, so decrypting unconditionally could leak another user's PII to anyone holding a reference to their row.
- A single referenced row with a malformed/legacy encrypted field no longer 500s the whole list/detail response. That row is dropped from `_refs` (renderer falls back to the raw UUID) and logged; every other row and the main list still resolve.
