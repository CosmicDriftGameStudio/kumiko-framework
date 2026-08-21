---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-locale-de": patch
---

Fix `<NotesSection>` (notes-history bundle) rendering each entry as one unbroken line with the raw author id and raw ISO timestamp glued to the note text. Body and meta now render as two visually separated lines and the timestamp uses the shared `formatWhen` formatter.

`note-entry` also gains an `authorName` field (`personal: { of: "authorId" }`, same crypto-shredding subject as `body`), stamped once at `add-note` write time — a self-lookup of the writer's own `read_users` row via `ctx.db.raw` (tenant-agnostic, same pattern as `user-data-rights/handlers/cancel-deletion.write.ts`), decrypting `displayName` with `decryptStoredPii`. Append-only history keeps the name as it was when the note was written, never re-resolved later against a mutable roster. A client-supplied `authorName` in the payload is ignored, same guard as `authorId`. If the self-lookup or decrypt fails, or the user has no `displayName`, `authorName` stays `null` and the write still succeeds — the note text is the point, the name is best-effort. The display already prefers `authorName` and falls back to a translated placeholder for `null` (pre-field history, shredded authors, and any lookup failure).
