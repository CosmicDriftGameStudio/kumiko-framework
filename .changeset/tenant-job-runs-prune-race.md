---
"@cosmicdrift/kumiko-bundled-features": patch
---

The tenant-runs integration test waits until older finished rows of a subject are pruned before it counts the stored rows. No runtime change.

<!-- kumiko-changes
feature: jobs
type: fix
title: Flaky tenant-runs integration test waits for the finished-row prune
detail: recordTenantRunOutcome writes the new outcome and prunes older finished rows of the same subject in two statements. jobs:query:tenant-runs dedupes finished rows per subject, so readers never see the in-between state, but the test counted the stored rows right after the query check and could land between the two statements. The count now sits inside the same waitFor. No runtime change.
-->
