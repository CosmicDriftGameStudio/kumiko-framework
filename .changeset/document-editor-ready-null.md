---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-document-designer": patch
---

Document editors report null to onEditorReady when they are destroyed

<!-- kumiko-changes
feature: template-resolver
type: breaking
title: onEditorReady receives null when the editor is destroyed
detail: DocumentTiptapEditor and PlaceholderLineEditor call onEditorReady(null) on destroy, so a held handle no longer points at a destroyed editor. The callback type is (handle: DocumentEditorHandle | null) => void. The document designer drops the handle of an unmounted field, so placeholder insertion no longer targets a destroyed editor.
migration: A custom onEditorReady callback must accept null and drop its stored handle when it receives it.
-->
