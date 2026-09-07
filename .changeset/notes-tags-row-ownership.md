---
"@cosmicdrift/kumiko-bundled-features": minor
---

`createNotesHistoryFeature` and `createTagsFeature` gain an `ownership`
option for row-level READ access on `note-entry` / `tag-assignment` rows.
Previously neither entity declared `access`, so `buildOwnershipClause`
always passed and any dispatch-eligible tenant user could list every note
or tag-assignment in the tenant — including rows on host entities they
can't otherwise see. `access`/`roles` remain a dispatch gate only (can the
caller call create/list at all); `ownership` is orthogonal and controls
which rows a caller sees. Both feature factories reject a `where`-rule in
`ownership.write` at construction time, since the write path
(`userCanCreateFieldRow`/`userCanWriteFieldRow`) can't evaluate where-rules:
create throws at runtime, update/delete/forget/restore silently deny. Use a
`from()` rule for `ownership.write`, or leave it unset.

Also fixes `note-entry.body`, which was annotated `personal: { of: "authorId" }`
— erasing the author's data-rights key would crypto-shred every note's
content, not just their name. A note's content is about the host entity, not
the author, so `body` is now `personal: false`; `authorName` keeps
`personal: { of: "authorId" }` correctly. No production database has rows in
`read_note_entries` today, so no migration is needed.
