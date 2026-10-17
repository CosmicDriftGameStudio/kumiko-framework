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
} from "./hooks.js";

export { eraseNoteBodiesReachingSubject } from "./hooks.js";

export function createNotesHistoryUserDataFeature() {
  return defineFeature(
    "notes-history-user-data",
    (r) => {
      r.describe(
        "GDPR (Art. 20 export / Art. 17 erasure) coverage for the `notes-history` feature's `note-entry` and `note-mention` entities. Mounts the export hook so a user's authored notes are included in the user-data export bundle; the note-entry delete hook crypto-shreds the row-subject key of each note that structurally @-mentions the forgotten user (`note-mention`) or hangs on the user as host entity (regardless of the host entity's retention strategy: the note text is free PII, the host's anonymize/blockDelete protects the row, not the content), keeping the append-only history intact for all other notes. The manual `crypto-shredding` forget-subject command reaches the same notes for user and record subjects through the exported `eraseNoteBodiesReachingSubject`, and the export lists them under `note-mention`. `note-mention`'s own hooks are a no-op — it is a plain FK pointer, not separately exportable content. Kept separate from `notes-history` so notes consumers without the user-data-rights pipeline don't pull a hard dependency — requires `user-data-rights`, optionalRequires `notes-history`.",
      );
      // user-data-rights is the hard dependency (EXT_USER_DATA host). notes-history
      // is OPTIONAL: if it's mounted toggleable(default=false), a hard r.requires
      // would throw an "effectively disabled" boot warning even though the
      // note-entry entity exists and the hooks work fine.
      r.requires({ features: ["user-data-rights"] });
      r.optionalRequires("notes-history");
      r.useExtension(EXT_USER_DATA, "note-entry", {
        export: noteEntryExportHook,
        delete: noteEntryDeleteHook,
      });
      r.useExtension(EXT_USER_DATA, "note-mention", {
        export: noteMentionExportHook,
        delete: noteMentionDeleteHook,
      });
    },
    { dedupeOptions: {} },
  );
}

/** @deprecated Use createNotesHistoryUserDataFeature(). Run `bun kumiko-upgrade --apply`. Removed in the first release after 2026-10-29. */
export const notesHistoryUserDataFeature = createNotesHistoryUserDataFeature();
