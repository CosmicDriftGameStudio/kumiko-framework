// EXT_USER_DATA hooks for the notes-history feature's `note-entry` entity
// (GDPR Art. 20 export / Art. 17 erasure). Lives apart from notes-history so
// notes consumers without the user-data-rights pipeline don't pull a hard
// dependency. Mirrors job-run/delivery-attempt (user-data-rights-defaults):
// export-only, erasure via crypto-shredding.

import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { configuredPiiSubjectKms, type SubjectId } from "@cosmicdrift/kumiko-framework/crypto";
import type { DbRunner, TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type {
  Registry,
  TenantId,
  UserDataDeleteHook,
  UserDataExportHook,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  type RetentionPresetKey,
  resolveRetentionPolicyForTenant,
  resolveTenantRetentionPreset,
} from "../data-retention/index.js";
import { noteEntryTable, noteMentionTable } from "../notes-history/index.js";
import { policyToStrategy } from "../user-data-rights/index.js";

// note-entry has no per-tenant scope quirk (unlike folders) — it's genuinely
// per-user content, so the export filters by authorId directly.
export const noteEntryExportHook: UserDataExportHook = async (ctx) => {
  const rows = await ctx.db.selectMany(noteEntryTable, {
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

type NoteRow = {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly entityType: string;
  readonly entityId: string;
  readonly body: unknown;
  readonly insertedAt: unknown;
};

// What erasing a subject's key reaches: notes that @-mention the subject plus notes
// attached to it as host. Export and erasure both go through this, so Art. 15
// lists exactly what Art. 17 shreds.
async function selectNotesReachingSubject(
  db: DbRunner | TenantDb,
  subject: SubjectId,
): Promise<readonly NoteRow[]> {
  if (subject.kind === "tenant") return [];
  const subjectId = subject.kind === "user" ? subject.userId : subject.id;
  const attachedWhere =
    subject.kind === "record"
      ? { entityType: subject.entity, entityId: subjectId }
      : { entityId: subjectId };

  const mentions = await selectMany<{ noteId: string }>(db, noteMentionTable, { subjectId });
  const mentioned =
    mentions.length === 0
      ? []
      : await selectMany<NoteRow>(db, noteEntryTable, {
          id: { in: [...new Set(mentions.map((m) => m.noteId))] },
        });
  const attached = await selectMany<NoteRow>(db, noteEntryTable, attachedWhere);

  const byId = new Map<string, NoteRow>();
  for (const note of [...mentioned, ...attached]) byId.set(note.id, note);
  return [...byId.values()];
}

// `authorName` is separately annotated `personal: { of: "authorId" }`
// (entity.ts), so forgetting the AUTHOR already crypto-shreds that field on
// its own. `body` is Row-Subject (`personal: { of: "id" }`): its key is per
// note, so forgetting a subject only reaches a body when the note structurally
// @-mentions the subject (`note-mention`, fw#2787) or hangs on it as host.
// Free-text mentions are NOT detected — the documented gap in entity.ts.
//
// Per reached note the HOST entity's retention strategy (entityType, resolved
// for the note's own tenant — the manual forget-subject path runs cross-tenant)
// is consulted first: anonymize/blockDelete win over erasure, same rule the
// automated forget-cleanup applies to every other entity.
//
// Without a mounted KMS this erases nothing: record-owned fields fall back to
// plaintext framework-wide (see pii-field-encryption.ts), so apps that need
// Art. 17 coverage must mount one.
export async function eraseNoteBodiesReachingSubject(args: {
  readonly db: DbRunner | TenantDb;
  readonly registry: Registry;
  readonly subject: SubjectId;
  readonly erasedBy: string;
  readonly requestId: string;
}): Promise<void> {
  const kms = configuredPiiSubjectKms();
  // skip: no KMS adapter mounted — forget is a true no-op
  if (!kms) return;

  const notes = await selectNotesReachingSubject(args.db, args.subject);
  const dataRetentionMounted = args.registry.features.has("data-retention");
  const presetByTenant = new Map<string, RetentionPresetKey | null>();
  const strategyByTenantAndEntityType = new Map<string, ReturnType<typeof policyToStrategy>>();
  for (const note of notes) {
    const strategyKey = `${note.tenantId}:${note.entityType}`;
    let strategy = strategyByTenantAndEntityType.get(strategyKey);
    if (strategy === undefined) {
      let tenantPreset = presetByTenant.get(note.tenantId);
      if (tenantPreset === undefined) {
        tenantPreset = await resolveTenantRetentionPreset({
          db: args.db,
          registry: args.registry,
          tenantId: note.tenantId,
        });
        presetByTenant.set(note.tenantId, tenantPreset);
      }
      const hostPolicy = await resolveRetentionPolicyForTenant({
        db: args.db,
        registry: args.registry,
        tenantId: note.tenantId,
        entityName: note.entityType,
        preloadedTenantPreset: tenantPreset,
        // Without data-retention there is no override table to read.
        ...(!dataRetentionMounted && { preloadedOverride: null }),
      });
      strategy = policyToStrategy(hostPolicy.policy?.strategy ?? null);
      strategyByTenantAndEntityType.set(strategyKey, strategy);
    }
    if (strategy === "anonymize") continue;

    await kms.eraseKey(
      { kind: "record", entity: "note-entry", id: note.id },
      {
        requestId: args.requestId,
        userId: args.erasedBy,
        eraseReason: "notes-history:subject-forget",
      },
    );
  }
}

export const noteEntryDeleteHook: UserDataDeleteHook = async (ctx) => {
  await eraseNoteBodiesReachingSubject({
    db: ctx.db,
    registry: ctx.registry,
    subject: { kind: "user", userId: ctx.userId },
    erasedBy: ctx.userId,
    requestId: "notes-history-user-data:forget-reached-notes",
  });
};

// Erasure reaches every note that mentions the user or hangs on the user as host
// (see eraseNoteBodiesReachingSubject), so the Art. 15/20 export lists those too.
export const noteMentionExportHook: UserDataExportHook = async (ctx) => {
  const notes = await selectNotesReachingSubject(ctx.db, { kind: "user", userId: ctx.userId });
  if (notes.length === 0) return null;
  return {
    entity: "note-mention",
    rows: notes.map((note) => ({
      noteId: note.id,
      entityType: note.entityType,
      entityId: note.entityId,
      body: note.body,
      insertedAt: note.insertedAt,
    })),
  };
};

// note-mention rows are a plain (noteId, subjectId) pointer: forgetting the mentioned
// user's data is already handled by noteEntryDeleteHook shredding the mentioned NOTE's
// row-subject key, so this delete hook has nothing of its own to erase.
export const noteMentionDeleteHook: UserDataDeleteHook = async () => {};
