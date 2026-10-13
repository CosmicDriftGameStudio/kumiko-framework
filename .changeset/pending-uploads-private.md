---
"@cosmicdrift/kumiko-framework": minor
---

Pending uploads (an `entityType` but no `entityId` yet) can only be read by their uploader and `privilegedRoles`, and a save binds the caller's pending uploads on update as well as on create. Before, any user of the tenant could read another user's upload through `GET /files/:id`, `/meta`, `/download-url` and `/variant/:name` until a record claimed it. On update, only the file ids the update names in its `changes` are bound, so `createFileRefFromBytes` with `attachTo` and no `entityId`, followed by an update that stores the id, now attaches the file. Uploads without an `entityType` stay readable tenant-wide.

<!-- kumiko-changes
feature: framework
type: breaking
title: Pending uploads are private to the uploader; updates bind them too
detail: The default file access guard denies read on a file with entityType set and entityId null unless the caller is the uploader or has a role in privilegedRoles; the file routes answer 404 as for any denied file. bindPendingFileRefs now also runs for updates and binds the file ids named in the update's changes for file, image, files and images fields (same entityType and fieldName, entityId null, insertedById = caller), so createFileRefFromBytes with attachTo but no entityId plus a following update write attaches the file to the record. Uploads without entityType are unchanged and stay tenant-wide readable.
migration: Code that reads another user's pending upload (a preview shown to a second user before the record is saved, a background job reading a file the user uploaded for a record that does not exist yet) must bind the file first, run as the uploader, or use a role in privilegedRoles or a custom accessGuard in the files feature options. Apps that set accessGuard keep their own decision.
-->
