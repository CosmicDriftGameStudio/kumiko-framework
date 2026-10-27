---
"@cosmicdrift/kumiko-framework": minor
---

`createFilesFeature({ pendingUploadGraceHours })` lets the hourly upload sweep soft-delete uploads for a form field that never got their record within that many hours (abandoned forms); the soft-delete cleanup then removes their bytes. Off by default.

<!-- kumiko-changes
feature: framework
type: improvement
title: Abandoned form uploads can expire
detail: An upload sent with entityType and fieldName but without a record stays pending until a save binds it. When the form was abandoned, the fileRef row and its bytes stayed forever without an owner that deletes them. With `pendingUploadGraceHours` the `files:job:sweep-orphaned-uploads` job soft-deletes such rows through the fileRef executor once they are older than the grace period. Uploads without a target field (inbox, dropzone) and files the system user created are kept. It is opt-in because an app that stores fileRef ids without binding them would lose those files.
-->
