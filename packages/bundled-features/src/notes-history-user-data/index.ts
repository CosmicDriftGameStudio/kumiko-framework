// Provides the EXT_USER_DATA export/delete hooks for the notes-history
// feature's `note-entry` entity as a standalone feature — mount it alongside
// notes-history + user-data-rights when an app needs note histories in its
// GDPR export/forget pipeline. Kept separate from notes-history (which only
// requires nothing) so notes-history stays usable without the
// user-data-rights stack. Mirrors folders-user-data.

import { defineFeature, EXT_USER_DATA } from "@cosmicdrift/kumiko-framework/engine";
import {
  noteEntryDeleteHook,
  noteEntryExportHook,
  noteMentionDeleteHook,
  noteMentionExportHook,
} from "./hooks";

export const notesHistoryUserDataFeature = defineFeature("notes-history-user-data", (r) => {
  r.describe(
    "GDPR (Art. 20 export / Art. 17 erasure) coverage for the `notes-history` feature's `note-entry` and `note-mention` entities. Mounts the export hook so a user's authored notes are included in the user-data export bundle; the note-entry delete hook looks up `note-mention` for notes that structurally @-mention the forgotten user and crypto-shreds each reached note's row-subject key (after consulting that note's host entity's retention strategy — blockDelete/anonymize win over erasure), keeping the append-only history intact for notes without such a mention. `note-mention`'s own hooks are a no-op — it is a plain FK pointer, not separately exportable content. Kept separate from `notes-history` so notes consumers without the user-data-rights pipeline don't pull a hard dependency — requires `user-data-rights`, optionalRequires `notes-history`.",
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
  r.useExtension(EXT_USER_DATA, "note-mention", {
    export: noteMentionExportHook,
    delete: noteMentionDeleteHook,
  });
});
