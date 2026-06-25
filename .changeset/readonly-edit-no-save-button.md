---
"@cosmicdrift/kumiko-renderer": patch
---

entityEdit: omit the Save button when there is nothing to submit. A read-only inspector detail (every field `readOnly`, no create/delete) previously rendered a permanently-disabled Save button, which reads as a broken control. The renderer now drops the Save button entirely when no field is editable and there is no extension section (which carries its own save).
