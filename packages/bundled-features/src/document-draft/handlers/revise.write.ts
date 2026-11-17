import { type AccessRule, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import type { DocumentDraftExecutor } from "../entity.ts";
import { draftNotFound, loadScopedDraft, notInStatus } from "../lib.ts";
import { DraftBaseSchema } from "../payloads.ts";
import { DOCUMENT_DRAFT_STATUS } from "../web/constants.ts";

type ReviseData = { readonly id: string; readonly version: number; readonly revision: number };

export function createReviseHandler(access: AccessRule, documentDraftExecutor: DocumentDraftExecutor) {
  return defineWriteHandler<"revise", typeof DraftBaseSchema, ReviseData>({
    name: "revise",
    schema: DraftBaseSchema,
    access,
    agent: { risk: "mid" },
    description:
      "Reopens a finalized document draft for editing: the revision counts up and the file reference is cleared (the stored PDF stays in the files). The next finalize prints a new PDF.",
    handler: async (event, ctx) => {
      const { id, base } = event.payload;
      const user = event.user;
      const draft = await loadScopedDraft(documentDraftExecutor, ctx, user, id);
      if (draft === null) return draftNotFound(id);
      if (draft.status !== DOCUMENT_DRAFT_STATUS.Finalized) {
        return notInStatus(DOCUMENT_DRAFT_STATUS.Finalized);
      }
      const revision = Number(draft.revision) + 1;
      const updated = await documentDraftExecutor.update(
        {
          id,
          version: base,
          changes: {
            status: DOCUMENT_DRAFT_STATUS.Open,
            revision,
            fileRefId: null,
            fileName: null,
            finalizedAt: null,
          },
        },
        user,
        ctx.db,
      );
      if (!updated.isSuccess) return updated;
      return { isSuccess: true, data: { id, version: updated.data.event.version, revision } };
    },
  });
}
