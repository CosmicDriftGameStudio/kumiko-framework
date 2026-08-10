import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { FORM_DRAFT_ACCESS } from "../constants";
import { formDraftExecutor } from "../executor";
import { lookupDraft } from "../lookup";
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
    return { isSuccess: true as const, data: { discarded: true } };
  },
});
