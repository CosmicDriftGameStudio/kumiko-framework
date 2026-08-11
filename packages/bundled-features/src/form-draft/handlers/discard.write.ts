import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { FORM_DRAFT_ACCESS } from "../constants";
import { filterOwnedStorageKeys } from "../db/queries/owned-file-refs";
import { formDraftExecutor } from "../executor";
import { lookupDraft } from "../lookup";
import { collectDraftFileRefKeys, releaseDraftFileRefs } from "../release-file-refs";
import { discardDraftPayloadSchema } from "../schemas";

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
      const ownedKeys = await filterOwnedStorageKeys(
        ctx.db,
        event.user.tenantId,
        ownerId,
        candidateKeys,
      );
      await releaseDraftFileRefs(ownedKeys, (key) => files.ref(key).delete(), ctx.log);
    }
    return { isSuccess: true as const, data: { discarded: true } };
  },
});
