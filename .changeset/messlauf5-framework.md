---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
"@cosmicdrift/kumiko-locale-fr": minor
"@cosmicdrift/kumiko-locale-it": minor
---

framework: `createReferenceField`, boot checks for user references and file `accept`, opt-in `requireFieldValueTranslations`, typed phase slots on entity handlers.

<!-- kumiko-changes
feature: framework
type: breaking
title: Boot rejects a user reference with personal: false and file accept entries that never match
detail: `createReferenceField({ entity, personal?, reason?, required? })` builds a foreign key; a target ending in `:user` defaults to `personal: "ref"` and throws on `personal: false`. The boot validator now rejects a reference field to the user entity that carries `personal: false`, and a file, files, image or images field (also inside embedded schemas) whose `accept` has an entry that is not a bare lower-case extension, because the upload check compares the file's extension only. The new boot option `requireFieldValueTranslations: true` (also readable from the schema CLI input) lists every missing translation of select/multiSelect options and embedded cell labels shown by entityList/entityEdit screens in one error. `defineEntityWriteHandler` and the create/update/delete/restore wrappers return a type whose `reserveBeforeTransaction`, `beforeTransaction` and `beforeTransactionWhenNested` are `undefined`, so a handler spread into `defineWriteHandler` can add its own. user-data-rights has the export-job status option labels (de, en, es, fr, it); managed-pages branding accepts `png, jpg, jpeg, webp` instead of MIME types.
migration: Replace `personal: false` on a reference to the user entity with `createReferenceField({ entity: "user:user" })` or `personal: "ref"`. Write `accept` entries as bare extensions (`"pdf"`, not `".pdf"` or `"application/pdf"`).
-->
