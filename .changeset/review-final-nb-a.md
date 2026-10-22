---
"@cosmicdrift/kumiko-bundled-features": patch
---

The legacy waitlist migration now applies the live field limits (name, email, locale, company, portfolio, message). A source row above a limit is counted as `unreadable` and not imported; `importWaitlistEntry` throws for such an entry. Before, the value was stored and could never pass a later update through the same payload schema. An offlot row whose city, stock, country and notes lines add up beyond the message limit is the typical case.

<!-- kumiko-changes
feature: waitlist
type: fix
title: Waitlist import enforces the live field limits
detail: migrateLegacyWaitlist counts a source row with a value above the live field limit as unreadable instead of importing it; importWaitlistEntry throws for it.
-->
