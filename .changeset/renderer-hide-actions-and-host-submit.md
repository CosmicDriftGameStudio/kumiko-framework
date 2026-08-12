---
"@cosmicdrift/kumiko-renderer": minor
---

`RenderEdit` gained an optional `hideActions?: boolean` prop that renders the fields without its own action bar (save, cancel, delete, copy-link), for hosts that put those controls into their own chrome — a drawer footer, a wizard shell.

`RenderEditControls` (handed to `onControlsReady`) gained a `submit: () => Promise<void>` method that runs the same pipeline the built-in save button runs — validation, `customSubmit`/`writeCommand`, extension-section persistence, draft discard, state rebase — but without the button's unchanged-form guard, so a host can drive the write on a pre-filled, untouched form.
