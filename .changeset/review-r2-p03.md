---
"@cosmicdrift/kumiko-bundled-features": patch
---

Review fixes: a consume on a released cap reservation keeps its tombstone alive, calendar cap periods are validated on every enforcement, stock caps serialize on the counted set instead of the error code, forget-subject writes its audit event even when the record owner lookup fails, and the email channel docs describe what happens without an app transport.

<!-- kumiko-changes
feature: cap-counter
type: fix
title: Consume on a released reservation extends its tombstone
detail: Every consume against a released reservation tombstone now pushes its expiry out, so a long-running job that consumes across the sweep can no longer lose the tombstone and have its earlier units counted twice at settle.
-->

<!-- kumiko-changes
feature: cap-counter
type: fix
title: Misconfigured cap period fails on every enforcement
detail: A periodEndIso that is unparsable or not after periodStartIso now throws on each enforceCap or reservation call instead of only once the hard cap is reached, so a bad period no longer turns into a 500 at the limit instead of cap_exceeded.
-->

<!-- kumiko-changes
feature: cap-counter
type: fix
title: Stock cap lock covers the counted rows, not the error code
detail: withStockCap serializes on the table and where filter that are counted, so two handlers capping the same rows under different codes can no longer both pass the check in parallel and exceed the cap together.
-->

<!-- kumiko-changes
feature: crypto-shredding
type: fix
title: forget-subject audit event survives a failing record owner lookup
detail: The lookup of the record row's owning tenant now runs inside the file purge step, so a database error there is reported as cleanupError on the subject-forgotten event instead of aborting the handler after the key was erased.
-->

<!-- kumiko-changes
feature: channel-email
type: fix
title: Corrected description of an email channel without app transport
detail: Without an app transport only notifications declared with tenantTransport true are delivered; all others fail with missing_credentials, so such apps must mark every outgoing notification or keep an app transport.
-->

<!-- kumiko-changes
feature: config
type: fix
title: Remove unreachable branch in configRowHoldsValue
detail: The undefined key definition is now handled together with the plaintext comparison, dropping a dead return without changing behavior.
-->
