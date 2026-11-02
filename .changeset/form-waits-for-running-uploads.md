---
"@cosmicdrift/kumiko-renderer": patch
---

An edit form no longer submits while a file upload in one of its fields is still running. Before, the dropzone showed the file at once but the file id reached the form value only after the upload, so an early Save sent the form without the attachment and dropped it silently. The submit button is now disabled during the upload and Enter, wizard save-and-close and draft save are held back too; a failed upload releases the lock.

<!-- kumiko-changes
feature: renderer
type: fix
title: Edit forms wait for running file uploads before submitting
detail: The submit button of an edit form stays disabled while a file upload (dropzone, single file or image, embedded list cell) is running, and `handleSubmit` returns early in that window, so Enter, save-and-close and draft save cannot send the form without the attachment either. Custom upload widgets can join the lock with `useTrackFormUpload()` from the renderer; outside a form it just runs the upload.
-->
