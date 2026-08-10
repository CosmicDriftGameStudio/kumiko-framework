---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer": patch
---

Wizard-mode `entityEdit`/`actionForm` screens with `layout.draft: true` now persist and resume in-progress state through the bundled `form-draft` feature: `RenderEdit` saves the current values + step on every Next/Back, restores them on mount (unless the user already started typing), and discards the draft after a successful submit. actionForm screens pick this up automatically since they render through the same wizard shim as entityEdit. The boot-validator now fails loud when a screen sets `draft: true` without `mode: "wizard"`, or when `form-draft` isn't mounted.
