---
"@cosmicdrift/kumiko-renderer": patch
---

fw#2749: `resolveActionIcon` now falls back to an action id's first kebab segment (e.g. `add-item` -> `plus`, `open-lease` -> `eye`) when neither the full id nor its last segment has an entry in `ACTION_ICON_BY_ID`. Previously verb-prefixed ids never matched even though the verb itself (`add`, `open`, ...) is registered. The last-segment default keeps priority — `send-copy` still resolves to `copy`, not `send`.
