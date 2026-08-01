---
"@cosmicdrift/kumiko-framework": patch
---

Boot-time warning when an `access.roles` entry on a handler is used by exactly one handler in the whole boot scan — a common typo signature that previously caused a silent lockout for that role.
