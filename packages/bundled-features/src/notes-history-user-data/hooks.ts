// EXT_USER_DATA hooks for the notes-history feature's `note-entry` entity
// (GDPR Art. 20 export / Art. 17 erasure). Lives apart from notes-history so
// notes consumers without the user-data-rights pipeline don't pull a hard
// dependency. Mirrors job-run/delivery-attempt (user-data-rights-defaults):
// export-only, erasure via crypto-shredding.

import { fetchOne, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { configuredPiiSubjectKms } from "@cosmicdrift/kumiko-framework/crypto";
import type { UserDataDeleteHook, UserDataExportHook } from "@cosmicdrift/kumiko-framework/engine";
import { resolveRetentionPolicyForTenant } from "../data-retention";
import { noteEntryTable, noteMentionTable } from "../notes-history";
import { policyToStrategy } from "../user-data-rights";

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

// `authorName` is separately annotated `personal: { of: "authorId" }`
// (entity.ts), so forgetting the AUTHOR already crypto-shreds that field on
// its own — unrelated to this hook. `body` is Row-Subject (`personal: { of:
// "id" }`): its key is per-note, not per-user, so forgetting a user only
// reaches a note's body when that note structurally @-mentions the user via
// a `note-mention` row (fw#2787). Free-text mentions are NOT detected —
// that's the documented gap in entity.ts, not a bug here.
//
// Per reached note: consult the HOST entity's (entityType, not note-entry's
// own) retention strategy first — blockDelete/anonymize must win over
// erasure, same rule the automated forget-cleanup pipeline applies to every
// other entity. The `strategy` this hook itself is called with is resolved
// for note-entry, not the host, so it is deliberately unused here.
//
// Precondition: this ONLY erases anything if the app mounts a KMS adapter —
// without one, record-owned fields fall back to plaintext storage
// framework-wide (see pii-field-encryption.ts) and forget is a true no-op.
// That gap is a property of the framework's crypto-shredding design, not
// specific to this hook; apps that need Art.17 coverage without KMS must
// mount one.
export const noteEntryDeleteHook: UserDataDeleteHook = async (ctx) => {
  const kms = configuredPiiSubjectKms();
  if (!kms) return;

  const mentions = await selectMany<{ noteId: string }>(ctx.db, noteMentionTable, {
    subjectId: ctx.userId,
  });
  if (mentions.length === 0) return;

  const noteIds = new Set(mentions.map((m) => m.noteId));
  for (const noteId of noteIds) {
    const note = await fetchOne<{ entityType: string }>(ctx.db, noteEntryTable, { id: noteId });
    // Defensive: append-only rows are never hard-deleted, so this shouldn't
    // happen — but a missing host means no retention policy to consult.
    if (!note) continue;

    const hostPolicy = await resolveRetentionPolicyForTenant({
      db: ctx.db,
      registry: ctx.registry,
      tenantId: ctx.tenantId,
      entityName: note.entityType,
    });
    if (policyToStrategy(hostPolicy.policy?.strategy ?? null) === "anonymize") continue;

    await kms.eraseKey(
      { kind: "record", entity: "note-entry", id: noteId },
      {
        requestId: "notes-history-user-data:forget-mentioned-notes",
        userId: ctx.userId,
        eraseReason: "notes-history:mention-forget",
      },
    );
  }
};

// note-mention rows are a plain (noteId, subjectId) pointer — like authorId
// on note-entry, `subjectId`'s `personal: "ref"` annotation exists for the
// GDPR-hook-coverage boot guard, not because the row itself holds separately
// exportable content or needs its own physical erasure: forgetting the
// mentioned user's data is already handled by noteEntryDeleteHook shredding
// the mentioned NOTE's row-subject key above. Registered here only so the V3
// boot guard (validateGdprPiiHookCoverage) sees a hook for "note-mention".
export const noteMentionExportHook: UserDataExportHook = async () => null;
export const noteMentionDeleteHook: UserDataDeleteHook = async () => {};
