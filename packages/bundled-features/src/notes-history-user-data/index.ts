// Provides the EXT_USER_DATA export/delete hooks for the notes-history
// feature's `note-entry` entity as a standalone feature — mount it alongside
// notes-history + user-data-rights when an app needs note histories in its
// GDPR export/forget pipeline. Kept separate from notes-history (which only
// requires nothing) so notes-history stays usable without the
// user-data-rights stack. Mirrors folders-user-data.

import { defineFeature, EXT_USER_DATA } from "@cosmicdrift/kumiko-framework/engine";
import { noteEntryDeleteHook, noteEntryExportHook } from "./hooks";

export const notesHistoryUserDataFeature = defineFeature("notes-history-user-data", (r) => {
  r.describe(
    "GDPR (Art. 20 export / Art. 17 erasure) coverage for the `notes-history` feature's `note-entry` entity. Mounts the EXT_USER_DATA export hook so a user's authored notes are included in the user-data export bundle; the delete hook is a deliberate no-op because `body` is annotated `userOwned` on the entity — erasure runs via crypto-shredding (destroying the author's subject key) instead of a physical delete, keeping the append-only note history intact for entities other co-authors still read. Kept separate from `notes-history` so notes consumers without the user-data-rights pipeline don't pull a hard dependency — requires `user-data-rights`, optionalRequires `notes-history`.",
  );
  // user-data-rights is the hard dependency (EXT_USER_DATA host). notes-history
  // is OPTIONAL: if it's mounted toggleable(default=false), a hard r.requires
  // would throw an "effectively disabled" boot warning even though the
  // note-entry entity exists and the hooks work fine.
  r.requires("user-data-rights");
  r.optionalRequires("notes-history");
  r.useExtension(EXT_USER_DATA, "note-entry", {
    export: noteEntryExportHook,
    delete: noteEntryDeleteHook,
  });
});
