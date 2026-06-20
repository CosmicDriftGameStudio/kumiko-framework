---
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-dev-server": minor
---

The config-generated edit form now renders `file` / `image` fields as a real
upload widget — image fields show a round avatar preview + Upload/Change/Remove
buttons, file fields show an attach control. The file storage backend (POST/GET
`/api/files`, `FileStorageProvider`, `fileRef` entity) already existed; this
wires it through to the auto-UI, discovered by rebuilding the shadcn Profile
design purely from a schema.

- **Renderer**: `InputProps` gains a `file | image` kind; `RenderField` maps
  `createImageField()`/`createFileField()` to it and threads `accept`, `maxSize`,
  `entityType`, `fieldName`.
- **Headless**: `EditFieldViewModel` carries those file-field metadata and
  `computeEditViewModel` copies them from the field def.
- **renderer-web**: a `FileUploadInput` widget POSTs the picked file (multipart,
  with the `X-CSRF-Token` double-submit header) to `/api/files`, stores the
  returned FileRef id as the field value, and previews images via
  `GET /api/files/:id`.
- **dev-server**: `runDevApp` / `createKumikoServer` gain a `files` option
  (`{ storageProvider }`) threaded to `setupTestStack` (which mounts the upload
  routes + `ctx.files`); an explicitly-wired provider now satisfies the
  `FILE_STORAGE_PROVIDER` boot gate so demos don't need the env bridge.

The `styleguide` "Examples" feature adds a Profile screen with
`avatar: createImageField()`; an e2e test proves the upload round-trip
(pick → POST → preview).
