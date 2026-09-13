---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
---

Four "Akte" bedienkonzept ergonomics improvements for record screens:

- `projectionDetail`'s header now renders the status badge directly next to the record title instead of on its own line with the subtitle, so the record's state is visible at a glance without a second line.
- `entityList`, `projectionList` and `relatedList` rows now get a default "Edit" row action for free whenever the row's entity has an accessible `entityEdit` screen somewhere in the app — no more hand-declaring the same navigate rowAction on every list. A screen that already declares its own `id: "edit"` rowAction keeps it unchanged (the declared one always wins, never doubled up).
- Multi-line text inputs (`Input kind="textarea"`) accept a new `onSubmitShortcut` prop: Ctrl+Enter / Cmd+Enter now submits instead of inserting a newline, wired up in the notes-history `NotesSection` so adding a note no longer requires reaching for the mouse.
- `entityEdit`'s `redirect` now accepts the same object form as `actionForm`'s (`{ screen, idFrom }`), so a child record's edit screen (a deposit movement, a protocol section) can redirect back into the parent's Akte with the parent's id instead of only a list. The id is read from the write handler's success payload first, falling back to the already-loaded record's own field when the handler reports only its own id — matching how `actionForm`'s object-form redirect already resolves.
- The ledger's `reverse-transaction` (Storno) handler now copies `subjectType`/`subjectId` from the transaction it reverses onto the reversing entry, matching `confirm-schedule-period`. A Storno of a booking without a subject stays without one. Without this, a Storno booked against a subject (a lease, a contract) dropped out of any `subjectId` filter, so an Akte's booking list showed a stale entry with no visible counter-booking.
- `MetricNavigate` gains an optional `tab`: a metric click can now jump straight into a tab of the current or a target Akte instead of only entities/screens. Set alone, it activates that section on the current record; combined with `screen`/`entity`, it also sets the `?tab=` search param at the destination. The boot-validator rejects an unknown tab id when the target is the current screen.
