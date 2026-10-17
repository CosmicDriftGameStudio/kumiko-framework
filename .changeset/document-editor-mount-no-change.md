---
"@cosmicdrift/kumiko-bundled-features": patch
---

The document editor no longer reports a change when it mounts

<!-- kumiko-changes
feature: template-resolver
type: fix
title: Opening a document or mail editor with an empty body no longer marks the form as changed
detail: Switching the editor's editable state on mount emitted an update, so DocumentTiptapEditor called onChange("<p></p>") before the user typed anything and the surrounding form counted as dirty.
-->
