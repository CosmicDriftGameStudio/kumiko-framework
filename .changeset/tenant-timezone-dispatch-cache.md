---
"@cosmicdrift/kumiko-framework": patch
---

Cache the resolved `tenant:config:timezone` value per tenant on the dispatcher instead of re-reading it via `config()` on every dispatch (fw#2462). `config:write:set`/`config:write:reset` for that key invalidate the affected tenant's entry (or the whole cache on a system-scope write); a 5-minute TTL bounds staleness from writes that bypass those handlers (migrations, seeds, direct DB edits).
