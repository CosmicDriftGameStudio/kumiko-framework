import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { fileRefEntity, fileRefsTable } from "@cosmicdrift/kumiko-framework/files";
import { FORM_DRAFT_ACCESS } from "../constants";
import { filterOwnedFileRefs } from "../db/queries/owned-file-refs";
import { formDraftExecutor } from "../executor";
import { lookupDraft } from "../lookup";
import { collectDraftFileRefKeys, releaseDraftFileRefs } from "../release-file-refs";
import { discardDraftPayloadSchema } from "../schemas";

// Same construction as file-routes.ts/user-data-rights-defaults' fileRef
// hook — self-contained (table + entity), no registry needed. `.forget()`
// hard-deletes the file_refs row via a `fileRef.forgotten` event (rebuild-
// safe), unlike a raw storage-provider delete which never touches the row
// at all (see the ES-bypass this replaces below).
const fileRefExecutor = createEventStoreExecutor(fileRefsTable, fileRefEntity, {
  entityName: "fileRef",
});

// discard — the caller's own draft only. Ownership is enforced by the
// lookup predicate (tenantId + ownerId + draftKey), not by a separate
// permission check: a foreign user's discard call for someone else's
// draftKey finds no row and no-ops (isSuccess, nothing deleted) rather than
// erroring — same "own rows only, silently absent otherwise" shape as
// personal-access-tokens' revoke.
export const discardDraftWrite = defineWriteHandler({
  name: "discard",
  schema: discardDraftPayloadSchema,
  access: FORM_DRAFT_ACCESS,
  handler: async (event, ctx) => {
    const ownerId = event.user.id;
    const existing = await lookupDraft(
      ctx.db,
      event.user.tenantId,
      ownerId,
      event.payload.draftKey,
    );
    if (!existing) {
      return { isSuccess: true as const, data: { discarded: false } };
    }
    const result = await formDraftExecutor.delete({ id: existing.id }, event.user, ctx.db);
    if (!result.isSuccess) return result;
    // Release AFTER the row delete succeeds — a version-conflict/failed
    // delete leaves the draft (and its FileRefs) intact rather than
    // orphaning a photo behind a draft that's still there. Gated on
    // releaseFiles: a successful-submit discard must NOT release — the
    // domain entity the submit just wrote carries the same storageKeys
    // forward (see schemas.ts comment on discardDraftPayloadSchema).
    const files = ctx.files;
    if (files && event.payload.releaseFiles === true) {
      const candidateKeys = collectDraftFileRefKeys(existing.draft);
      // Only storageKeys with a real file_refs row owned by THIS caller are
      // releasable — `values` is free-form JSON the caller controls, so an
      // unverified key could target someone else's file (see
      // db/queries/owned-file-refs.ts).
      const ownedRefs = await filterOwnedFileRefs(
        ctx.db.raw,
        event.user.tenantId,
        ownerId,
        candidateKeys,
        existing.insertedAt,
      );
      const refsByStorageKey = new Map(ownedRefs.map((ref) => [ref.storageKey, ref]));
      await releaseDraftFileRefs(
        ownedRefs.map((ref) => ref.storageKey),
        async (key) => {
          // Hard-erase via the executor first (fileRef.forgotten — row +
          // event, rebuild-safe), then the binary. A raw provider.delete()
          // alone left the file_refs row behind forever (kumiko-framework
          // review #1922): no event, no projection update, the row just
          // pointed at a storage key that no longer existed.
          const ref = refsByStorageKey.get(key);
          if (ref !== undefined) await fileRefExecutor.forget({ id: ref.id }, event.user, ctx.db);
          await files.ref(key).delete();
        },
        ctx.log,
      );
    }
    return { isSuccess: true as const, data: { discarded: true } };
  },
});
