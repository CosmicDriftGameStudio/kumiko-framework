---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

`pruneEvents` takes an optional `registry` and then skips consumer rows of projections and catch-up jobs the app no longer declares, so a removed or renamed projection no longer blocks event retention.

<!-- kumiko-changes
feature: framework
type: fix
title: Event retention no longer stalls on consumers the app no longer declares
detail: A renamed or removed multi-stream projection, or a job that lost `catchUp`, leaves its row in `kumiko_event_consumers` with a cursor that never advances. `pruneEvents` counted it like a live consumer and threw `ConsumerLagError` once the cutoff passed the cursor; the bundled retention jobs only logged a warning, so retention stopped for good. With the new `registry` option, rows named like a projection (`<feature>:projection:<name>`) or a catch-up job (`job:<job>`) that the registry does not declare and whose row has not moved for seven days are skipped and their names are logged. A row that moved more recently still counts, because a differently composed worker or an old pod during a rollout may still drive it; a retention job blocked by a removed projection therefore resumes at the latest seven days after the deploy. Registered consumers that lag still throw, disabled consumers are ignored as before, and system consumers or names of any other shape always count. The data-retention, delivery attempt-log and audit escape-hatch retention jobs pass the registry. Rows of a per-instance consumer left behind by an old instance id are not covered; delete them before scaling down.
-->
