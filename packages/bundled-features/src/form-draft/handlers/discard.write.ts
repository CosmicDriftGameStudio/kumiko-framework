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
      //
      // Create-mode draftKey (`${screenId}:new:${draftId}`) mints its draftId
      // lazily on the first step-change — a file uploaded before that exists
      // predates the draft row, so the insertedAt filter must not apply.
      const isCreateMode = event.payload.draftKey.includes(":new:");
      const ownedRefs = await filterOwnedFileRefs(
        ctx.db.raw,
        event.user.tenantId,
        ownerId,
        candidateKeys,
        existing.insertedAt,
        isCreateMode,
      );
      // Fail-closed erase of file_refs rows FIRST (outside the best-effort
      // storage-hygiene loop). releaseDraftFileRefs swallows per-key errors
      // by design — routing forget through it would report discarded:true
      // while leaving the row behind (#1922 / review #2009).
      for (const ref of ownedRefs) {
        const forgetResult = await fileRefExecutor.forget({ id: ref.id }, event.user, ctx.db);
        if (!forgetResult.isSuccess) return forgetResult;
      }
      // Binary delete only after commit — in-tx delete would orphan pointers
      // if the surrounding write transaction rolls back after this handler.
      const keys = ownedRefs.map((ref) => ref.storageKey);
      const log = ctx.log;
      const schedule = ctx.scheduleAfterCommit;
      if (schedule) {
        schedule(async () => {
          await releaseDraftFileRefs(
            keys,
            async (key) => {
              await files.ref(key).delete();
            },
            log,
          );
        });
      } else {
        // Unit/harness paths without a commit sink — best-effort inline.
        await releaseDraftFileRefs(
          keys,
          async (key) => {
            await files.ref(key).delete();
          },
          log,
        );
      }
    }
    return { isSuccess: true as const, data: { discarded: true } };
  },
});
