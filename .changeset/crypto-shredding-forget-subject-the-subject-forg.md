---
"@cosmicdrift/kumiko-bundled-features": patch
---

forget-subject: the SUBJECT_FORGOTTEN audit now commits before the handler tx does and records cleanupError when a derived-data sweep fails

The SUBJECT_FORGOTTEN audit event is appended through the outside-transaction db, so it commits before the handler transaction does and survives a later rollback. If the blind-index sweep or search purge fails, the event carries cleanupError (error code or name, never the message) and the handler then fails; retry to finish the cleanup. The user-lifecycle step runs in a savepoint and no longer aborts the handler transaction.

<!-- kumiko-changes
feature: crypto-shredding
type: fix
title: forget-subject: the SUBJECT_FORGOTTEN audit now commits before the handler tx does and records cleanupError when a derived-data sweep fails
-->
