---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
---

Behaviour change: files uploaded from an update form are now attached to the record. `computeEditViewModel` takes the edited record's id (`entityId`, update mode only) and puts it on the hints of `file`, `image`, `files` and `images` fields. `RenderEdit` passes the id it was mounted with, the file input sends it as the `entityId` part of `POST /api/files`, and the new `buildFileUploadFormData` builds that body. Before, such uploads carried only `entityType` and `fieldName`, so `ctx.derivatives.variant(...)` on a qr-overlay variant threw because the FileRef had no `entityId`. The default file access guard lets only the uploader and Admin/SystemAdmin read attached files; apps that want tenant-wide read set `accessGuard`/`privilegedRoles`. Uploads from a create form are unchanged: the record does not exist yet.

`images` and `files` fields have an edit widget. `FileListField` shows one tile per stored file with move up, move down and remove buttons plus one empty tile to add a file, and hides the add tile at `maxCount` or when the field is read-only. It is composed from the existing `Input kind="file" | "image"`, `Button` and layout primitives, so web and native primitive sets get it without a new primitive kind. `required: true` on `images`/`files` is now allowed and means "at least one file". `NO_WIDGET_FIELD_TYPES` shrinks to `jsonb` and `embedded`. The edit view model carries `maxCount` for these fields.

Embedded lists are accessible: every cell control has an accessible name ("Qty, row 2"), also in the mobile card layout, and the row-actions column header uses the translated `kumiko.field.embedded-list.actions` instead of a hard-coded "Actions". `EmbeddedListInput` has a new required `actionsLabel` prop; custom primitive sets must pass it through. `MoneyInput`, `DateField`, `TimestampInput` and `ComboboxInput` accept an optional `ariaLabel`.

<!-- kumiko-changes
feature: framework
type: improvement
title: Uploads from an update form are attached to the record
detail: computeEditViewModel accepts entityId (the record being edited, update mode only) and sets it on the hints of file, image, files and images fields; RenderEdit passes the id it was mounted with and the file input sends it as the entityId multipart part of POST /api/files. Behaviour change: such files are now attached to the record, so the default file access guard lets only the uploader and Admin/SystemAdmin read them. Apps that want tenant-wide read set accessGuard or privilegedRoles. A qr-overlay variant of an image field no longer throws for a file uploaded from an update form. Write-form sections and create forms send no entityId.
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
