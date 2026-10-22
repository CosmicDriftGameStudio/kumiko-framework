---
"@cosmicdrift/kumiko-framework": patch
---

An upload that names a record re-checks the record lock in the transaction that inserts the file row. Before, the lock was only checked before the bytes were read and stored, so a record locked in between still received the file; the upload now answers 409 `record_locked` and removes the bytes.

<!-- kumiko-changes
feature: framework
type: fix
title: file upload rechecks the record lock when inserting the row
detail: POST /files with an entityId reads the stored row again through the inserting transaction and refuses with 409 record_locked when lockedWhen holds. The window between that read and the commit stays open, like for any other write that checks the lock before its own commit.
-->
