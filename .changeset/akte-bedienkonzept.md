---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Three "Akte" bedienkonzept ergonomics improvements for record screens:

- `projectionDetail`'s header now renders the status badge directly next to the record title instead of on its own line with the subtitle, so the record's state is visible at a glance without a second line.
- `entityList`, `projectionList` and `relatedList` rows now get a default "Edit" row action for free whenever the row's entity has an accessible `entityEdit` screen somewhere in the app — no more hand-declaring the same navigate rowAction on every list. A screen that already declares its own `id: "edit"` rowAction keeps it unchanged (the declared one always wins, never doubled up).
- Multi-line text inputs (`Input kind="textarea"`) accept a new `onSubmitShortcut` prop: Ctrl+Enter / Cmd+Enter now submits instead of inserting a newline, wired up in the notes-history `NotesSection` so adding a note no longer requires reaching for the mouse.
