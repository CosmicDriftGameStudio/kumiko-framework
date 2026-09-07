// EXT_USER_DATA hooks for the notes-history feature's `note-entry` entity
// (GDPR Art. 20 export / Art. 17 erasure). Lives apart from notes-history so
// notes consumers without the user-data-rights pipeline don't pull a hard
// dependency. Mirrors job-run/delivery-attempt (user-data-rights-defaults):
// export-only, erasure via crypto-shredding.

import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { UserDataDeleteHook, UserDataExportHook } from "@cosmicdrift/kumiko-framework/engine";
import { noteEntryTable } from "../notes-history";

// note-entry has no per-tenant scope quirk (unlike folders) — it's genuinely
// per-user content, so the export filters by authorId directly.
export const noteEntryExportHook: UserDataExportHook = async (ctx) => {
  const rows = await selectMany<Record<string, unknown>>(ctx.db, noteEntryTable, {
    authorId: ctx.userId,
  });
  if (rows.length === 0) return null;
  return {
    entity: "note-entry",
    rows: rows.map((r) => ({
      entityType: r["entityType"],
      entityId: r["entityId"],
      body: r["body"],
      authorName: r["authorName"],
      insertedAt: r["insertedAt"],
    })),
  };
};

// Deliberate no-op: only `authorName` is annotated `personal: { of: "authorId" }`
// (entity.ts) — `body` is deliberately plaintext (`personal: false`), since it
// describes the HOST entity the note is attached to, not the author. So a
// forget here crypto-shreds (mounted KMS) just `authorName`: after erasing
// the author, who wrote a note is no longer visible, but the note's content
// stays intact and readable — the note is about the host entity, and other
// readers of that entity's history still need it. No physical delete is
// needed for either outcome.
// Same tradeoff as job-run/delivery-attempt (user-data-rights-defaults).
// Precondition: this ONLY erases anything if the app mounts a KMS adapter —
// without one, userOwned fields fall back to plaintext storage framework-wide
// (see pii-field-encryption.ts) and forget is a true no-op for `authorName`
// too. That gap is a property of the framework's crypto-shredding design,
// not specific to this hook; apps that need Art.17 coverage without KMS must
// mount one.
export const noteEntryDeleteHook: UserDataDeleteHook = async () => {};
