---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
---

Behaviour change: files uploaded from an update form are now attached to the record. `computeEditViewModel` takes the edited record's id (`entityId`, update mode only) and puts it on the hints of `file`, `image`, `files` and `images` fields. `RenderEdit` passes the id it was mounted with, the file input sends it as the `entityId` part of `POST /api/files`, and the new `buildFileUploadFormData` builds that body. Before, such uploads carried only `entityType` and `fieldName`, so `ctx.derivatives.variant(...)` on a qr-overlay variant threw because the FileRef had no `entityId`. Uploads from a create form are bound to the new record by the create itself: after a successful create, every file id in the record's `file`, `image`, `files` and `images` fields that is still pending (same entity and field, no `entityId`, uploaded by the same user) gets the record id through a regular `fileRef.updated` event in the create's transaction.

Attached files are readable by everyone who may read their record: the default file access guard runs the entity's `<entity>:detail` query as the requesting user (handler access, row ownership and parent visibility apply) when the user is neither the uploader nor in `privilegedRoles`. Delete stays with the uploader and `privilegedRoles`. Entities without a detail query keep the uploader/privileged rule.

`images` and `files` fields have an edit widget. `FileListField` shows one tile per stored file with move up, move down and remove buttons plus one empty tile to add a file, and hides the add tile at `maxCount` or when the field is read-only. It is composed from the existing `Input kind="file" | "image"`, `Button` and layout primitives, so web and native primitive sets get it without a new primitive kind. `required: true` on `images`/`files` is now allowed and means "at least one file". `NO_WIDGET_FIELD_TYPES` shrinks to `jsonb` and `embedded`. The edit view model carries `maxCount` for these fields.

Embedded lists are accessible: every cell control has an accessible name ("Qty, row 2"), also in the mobile card layout, and the row-actions column header uses the translated `kumiko.field.embedded-list.actions` instead of a hard-coded "Actions". `EmbeddedListInput` has a new required `actionsLabel` prop; custom primitive sets must pass it through. `MoneyInput`, `DateField`, `TimestampInput` and `ComboboxInput` accept an optional `ariaLabel`.

<!-- kumiko-changes
feature: framework
type: breaking
title: Uploads from an update form are attached to the record
detail: computeEditViewModel accepts entityId (the record being edited, update mode only) and sets it on the hints of file, image, files and images fields; RenderEdit passes the id it was mounted with and the file input sends it as the entityId multipart part of POST /api/files. Create forms send no entityId; after a successful create the write pipeline binds the caller's own pending uploads named in the record's file fields (same entityType and fieldName, entityId null, insertedById = caller) to the new record via a fileRef.updated event in the same transaction, for single and plural file fields alike, when the files feature (fileRef entity) is mounted. Behaviour change: such files are now attached to the record. The default file access guard allows read on an attached file to the uploader, privilegedRoles (default Admin/SystemAdmin) and everyone whose run of the entity's <entity>:detail query returns the record; delete stays uploader and privilegedRoles only. A qr-overlay variant of an image field no longer throws for a file uploaded from an update or create form. Write-form sections send no entityId. EmbeddedListInput has a new required actionsLabel prop.
migration: Files attached through forms now follow the record's read access instead of being tenant-wide: anyone who cannot read the record no longer reads the file, anyone who can read it does. Check image, images, file and files fields whose files must be visible beyond the record's readers (for example an avatar shown in lists to users without detail access) and add those roles to privilegedRoles or set accessGuard in the files feature options. An entity without a detail query falls back to uploader plus privilegedRoles. Files uploaded before the update keep their old attachment. Custom primitive sets that implement EmbeddedListInput accept the new actionsLabel prop and render it as the actions column header; custom file/image Input primitives forward entityId into the upload and offer a remove control that calls onChange(null).
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: images and files fields get an edit widget; required is allowed
detail: NO_WIDGET_FIELD_TYPES now holds only jsonb and embedded. required true on an images or files field passes boot validation and the client-side check treats an empty array as missing. The edit view model carries maxCount for files and images fields.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: FileListField edits images and files fields
detail: RenderField renders type images and files as FileListField instead of the unsupported banner. One tile per stored FileRef id with move up, move down and remove buttons, one trailing empty tile to add a file (hidden at maxCount or when read-only). It is built from Input kind file or image, Button and the layout primitives, passes accept, maxSize, entityType, entityId, fieldName, imageVariant and capture to every tile, and reads only string ids from the stored value. The read-only text display of these fields lists the ids. New i18n keys kumiko.field.file-list.add, move-up, move-down and empty; kumiko.field.file-upload.upload, change, remove, attached and failed; kumiko.field.embedded-list.actions and cell-label. The file and image Input kinds accept entityId. EmbeddedListInput has a new required actionsLabel prop.
-->

<!-- kumiko-changes
feature: renderer-web
type: improvement
title: File inputs post entityId; embedded list cells have accessible names
detail: FileUploadInput accepts entityId, translates its labels (kumiko.field.file-upload.*) and builds its multipart body with the exported buildFileUploadFormData. Every embedded list cell control (text, number, boolean, date, timestamp, money, select, reference) carries aria-label "<column>, row <n>" in the table and the mobile card layout, and the actions column header uses the actionsLabel prop instead of the fixed "Actions". MoneyInput, DateField, TimestampInput and ComboboxInput accept an optional ariaLabel.
-->

<!-- kumiko-changes
feature: headless
type: improvement
title: Edit view model carries entityId and maxCount for file fields
detail: ComputeEditViewModelInput has an optional entityId (the record being edited, omitted on create). EditFieldViewModel gains entityId for file, image, files and images fields and maxCount for files and images. The file-field hints now also cover type files, which was missing.
-->

<!-- kumiko-changes
feature: locale-de
type: improvement
title: German strings for the file list widget and embedded list accessibility
detail: Adds kumiko.field.file-list.add, empty, move-down and move-up, kumiko.field.file-upload.attached, change, failed, remove and upload, plus kumiko.field.embedded-list.actions and cell-label.
-->

<!-- kumiko-changes
feature: locale-es
type: improvement
title: Spanish strings for the file list widget and embedded list accessibility
detail: Adds kumiko.field.file-list.add, empty, move-down and move-up, kumiko.field.file-upload.attached, change, failed, remove and upload, plus kumiko.field.embedded-list.actions and cell-label.
-->
