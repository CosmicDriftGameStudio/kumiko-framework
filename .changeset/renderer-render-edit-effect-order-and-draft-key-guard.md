---
"@cosmicdrift/kumiko-renderer": patch
---

`RenderEdit`'s `onControlsReady` effect is now declared before its `onChange` effect, so an `onChange` fired on mount always sees `controls !== undefined` — an initial value that derives dependent fields on mount (e.g. VIN-decode) previously needed a second keystroke before `controls.patch` was available.

Also: a draft-save key longer than the server's 256-char limit (`draftKeySchema.max`) is now caught client-side with a console warning and the save is skipped, instead of firing the write and losing it silently — the user would previously only notice on resume, with nothing to resume.
