---
"@cosmicdrift/kumiko-bundled-features": minor
---

NotesSection no longer wraps its own "new note" / "history" blocks in a Card (fw#3234)

As an extension section (its documented usage: `component: { react: { __component: NOTES_SECTION_EXTENSION_NAME } }`), NotesSection was already mounted inside the host's own section frame — its two internal Cards doubled the border/padding there. Both blocks now use a plain container with a `Heading variant="section"` sub-header instead.

<!-- kumiko-changes
feature: notes-history
type: breaking
title: NotesSection no longer wraps its own "new note" / "history" blocks in a Card (fw#3234)
migration: |
  A standalone `<NotesSection entityName={...} entityId={id} />` mount (outside a screen-schema extension section) now renders both blocks without their own card chrome — wrap it in a `Section`/`Card` if the standalone mount needs one.
-->
