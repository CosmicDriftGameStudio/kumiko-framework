---
"@cosmicdrift/kumiko-bundled-features": patch
---

A test now proves that a waitlist purge whose key shred fails midway rolls back cleanly and that a retry completes it, so the KMS tombstones already written and the retry's audit event leave no half-erased state behind.

<!-- kumiko-changes
feature: waitlist
type: improvement
title: waitlist purge retry after a failed shred is covered
detail: An integration test fails the second key shred of a purge, checks that the entries stay and no audit event is written, and that the retried purge erases every entry and records its audit event. No runtime change.
-->
