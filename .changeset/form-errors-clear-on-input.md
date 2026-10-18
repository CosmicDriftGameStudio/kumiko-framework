---
"@cosmicdrift/kumiko-renderer": patch
---

Form errors clear once the user edits the affected field

<!-- kumiko-changes
feature: renderer
type: fix
title: Form errors clear once the user edits the affected field
detail: In RenderEdit, typing into a field removes that field's server issues and the form-level issues, and dismisses the submit error banner. A version_conflict banner and a delete rejection stay until reloaded or retried. Programmatic value changes (initial, draft restore, action patches) leave errors untouched.
-->
