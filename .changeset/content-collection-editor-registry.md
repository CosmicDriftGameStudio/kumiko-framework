---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

`r.contentCollection()` accepts a new `contentFormat: "plain" | "rich"` field. `ClientFeatureDefinition` gets a sixth registry, `contentEditors` — a `contentFormat → EditorComponent` map merged with the same last-wins semantics as `columnRenderers`. `createKumikoApp` mounts a `ContentEditorsProvider`; `useContentEditor(contentFormat)` resolves the registered component or falls back to a plain textarea, so a missing editor is never an empty panel. `template-resolver`'s content-collection editor now renders through this registry instead of a hardcoded textarea.
