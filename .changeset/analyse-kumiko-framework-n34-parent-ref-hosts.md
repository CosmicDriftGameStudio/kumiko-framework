---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"create-kumiko-app": patch
---

A parentRef names its host entities: `allowedTypes` is required and non-empty, and tags, folders and notes-history take a required `parents` list.

<!-- kumiko-changes
feature: parent-ref
type: breaking
title: parentRef and the join features name their hosts
detail: Without an allowlist the parentRef read gate built one SQL branch per registered entity, and the handler executors of tags, folders and notes-history ignored `parents` even when it was set. `ParentRefDef.allowedTypes` is now required, and the boot rule `parent-ref/allowed-types-empty` rejects an empty list. `createTagsFeature`, `createFoldersFeature` and `createNotesHistoryFeature` require `parents`, have no default singleton any more, and build their handler executors with it. `setFolderHandler` and `clearFolderHandler` are removed, and the set, clear and delete folder handlers and `createDeleteTagHandler` take the assignment executor. `folderAssignmentEntity`, `tagAssignmentEntity` and `noteEntryEntity` are the table shape without parentRef. The same holds for signature and document-draft: `createSignatureRequestEntity` and `createDocumentDraftEntity` require the hosts or subject types, `requestExecutor` and `documentDraftExecutor` are replaced by `createSignatureRequestExecutor(hosts)` and `createDocumentDraftExecutor(subjectTypes)`, and the request and draft handler factories take that executor. create-kumiko-app no longer offers tags in the picker.
migration: Pass `parents: [<host entities>]` to every createTagsFeature, createFoldersFeature and createNotesHistoryFeature call and `allowedTypes` to every hand-written parentRef; replace setFolderHandler and clearFolderHandler with the feature mount.
affects: createTagsFeature, createFoldersFeature, createNotesHistoryFeature, parentRef, setFolderHandler, clearFolderHandler, createDeleteTagHandler, folderAssignmentEntity, tagAssignmentEntity, noteEntryEntity, createSignatureRequestEntity, createDocumentDraftEntity, requestExecutor, documentDraftExecutor
-->
