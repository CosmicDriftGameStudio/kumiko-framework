import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { FORM_DRAFT_ACCESS } from "../constants";
import { listDraftsByScreen } from "../lookup";
import { listDraftsPayloadSchema } from "../schemas";

export type ListDraftsResult = {
  readonly drafts: readonly {
    readonly id: string;
    readonly draftKey: string;
    readonly stepIndex: number;
    readonly savedAt: string;
  }[];
};

// list — the fallback path for resuming a draft whose draftId the client
// lost (new tab, cleared storage, another device): returns just enough to
// pick one (id, draftKey, stepIndex, savedAt), never the blob's `values`.
// Newest first, so the most likely-relevant draft leads.
export const listDraftsQuery = defineQueryHandler({
  name: "list",
  schema: listDraftsPayloadSchema,
  access: FORM_DRAFT_ACCESS,
  handler: async (query, ctx): Promise<ListDraftsResult> => {
    const rows = await listDraftsByScreen(
      ctx.db,
      query.user.tenantId,
      query.user.id,
      query.payload.screenId,
    );
    const drafts = rows
      .map((row) => ({
        id: row.id,
        draftKey: row.draftKey,
        stepIndex: row.draft.stepIndex,
        savedAt: row.draft.savedAt,
      }))
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    return { drafts };
  },
});
