import {
  type AccessRule,
  defineWriteHandler,
  type KumikoEventTypeMap,
} from "@cosmicdrift/kumiko-framework/engine";
import { VersionConflictError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import type { SubjectScope } from "../../shared/index.ts";
import { documentDraftExecutor } from "../entity.ts";
import { draftNotFound, loadScopedDraft, notInStatus, pdfMetaOf, recordOrEmpty } from "../lib.ts";
import type { DocumentDraftPdf } from "../options.ts";
import { DraftBaseSchema } from "../payloads.ts";
import { DOCUMENT_DRAFT_STATUS } from "../web/constants.ts";

type FinalizeData = {
  readonly id: string;
  readonly fileRefId: string;
  readonly fileName: string;
  readonly revision: number;
};

export const FINALIZE_RATE_LIMIT = { per: "user+handler", limit: 10, windowSeconds: 60 } as const;

// Printing takes seconds, so it runs before the transaction opens. The subject authorization needs
// the full handler context and therefore runs in the transaction, before anything is stored; a
// caller who may not see the subject gets NotFound there and the uploaded PDF is never stored.
export function createFinalizeHandler<TUpload>(
  access: AccessRule,
  scope: SubjectScope,
  pdf: DocumentDraftPdf<TUpload>,
) {
  return defineWriteHandler<
    "finalize",
    typeof DraftBaseSchema,
    FinalizeData,
    KumikoEventTypeMap,
    { readonly upload: TUpload }
  >({
    name: "finalize",
    schema: DraftBaseSchema,
    access,
    rateLimit: FINALIZE_RATE_LIMIT,
    agent: { risk: "mid" },
    description:
      "Prints an open document draft to a PDF with the values frozen at creation and stores it: the draft becomes finalized and carries the file (fileRefId, fileName). base is the draft version from the blocks query. Further edits need revise first. Returns the draft id, the file and the revision.",
    beforeTransaction: async (event, ctx) => {
      const { id, base } = event.payload;
      const draft = await documentDraftExecutor.detail({ id }, event.user, ctx.db);
      if (draft === null) return draftNotFound(id);
      if (draft.status !== DOCUMENT_DRAFT_STATUS.Open)
        return notInStatus(DOCUMENT_DRAFT_STATUS.Open);
      if (draft.version !== base) {
        return writeFailure(
          new VersionConflictError({
            entityId: id,
            expectedVersion: base,
            currentVersion: Number(draft.version),
          }),
        );
      }
      const rendered = await pdf.render(ctx, {
        slug: String(draft.templateSlug),
        ...(typeof draft.templateVariant === "string" && { variant: draft.templateVariant }),
        locale: String(draft.locale),
        variables: recordOrEmpty(draft.variables),
        draft: {
          content: String(draft.body),
          meta: pdfMetaOf(draft.meta),
          variableSchema: recordOrEmpty(draft.variableSchema),
        },
      });
      return rendered.isSuccess ? { ...rendered, data: { upload: rendered.data } } : rendered;
    },
    handler: async (event, ctx) => {
      const { id, base } = event.payload;
      const user = event.user;
      const draft = await loadScopedDraft(ctx, user, scope, id);
      if (draft === null) return draftNotFound(id);
      const stored = await pdf.store(ctx, event.prepared.upload);
      if (!stored.isSuccess) return stored;
      const updated = await documentDraftExecutor.update(
        {
          id,
          version: base,
          changes: {
            status: DOCUMENT_DRAFT_STATUS.Finalized,
            fileRefId: stored.data.fileRefId,
            fileName: stored.data.fileName,
            finalizedAt: ctx.tz.now(),
          },
        },
        user,
        ctx.db,
      );
      if (!updated.isSuccess) return updated;
      return {
        isSuccess: true,
        data: {
          id,
          fileRefId: stored.data.fileRefId,
          fileName: stored.data.fileName,
          revision: Number(draft.revision),
        },
      };
    },
  });
}
