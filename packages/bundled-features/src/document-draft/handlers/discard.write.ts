import { type AccessRule, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import type { SubjectScope } from "../../shared/index.ts";
import { documentDraftExecutor } from "../entity.ts";
import { draftNotFound, loadScopedDraft, notInStatus } from "../lib.ts";
import { DraftBaseSchema } from "../payloads.ts";
import { DOCUMENT_DRAFT_STATUS } from "../web/constants.ts";

export function createDiscardHandler(access: AccessRule, scope: SubjectScope) {
  return defineWriteHandler<"discard", typeof DraftBaseSchema, { readonly id: string }>({
    name: "discard",
    schema: DraftBaseSchema,
    access,
    agent: { risk: "mid" },
    description:
      "Discards an open document draft: it no longer shows up for its object. A finalized draft cannot be discarded.",
    handler: async (event, ctx) => {
      const { id, base } = event.payload;
      const user = event.user;
      const draft = await loadScopedDraft(ctx, user, scope, id);
      if (draft === null) return draftNotFound(id);
      if (draft.status !== DOCUMENT_DRAFT_STATUS.Open)
        return notInStatus(DOCUMENT_DRAFT_STATUS.Open);
      const updated = await documentDraftExecutor.update(
        { id, version: base, changes: { status: DOCUMENT_DRAFT_STATUS.Discarded } },
        user,
        ctx.db,
      );
      if (!updated.isSuccess) return updated;
      return { isSuccess: true, data: { id } };
    },
  });
}
