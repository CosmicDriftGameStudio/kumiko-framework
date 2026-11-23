import { type AccessRule, defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError } from "@cosmicdrift/kumiko-framework/errors";
import {
  allowedBlocksFor,
  diffTemplateBlocks,
  documentBlocksOf,
  parseDocumentJson,
  splitTemplateBlocks,
} from "../../template-resolver/index.ts";
import type { DocumentDraftExecutor } from "../entity.ts";
import { loadScopedDraft, type SubjectAccess } from "../lib.ts";
import { DraftIdSchema } from "../payloads.ts";
import { DOCUMENT_DRAFT_ENTITY } from "../web/constants.ts";

export function createBlocksQuery(
  access: AccessRule,
  documentDraftExecutor: DocumentDraftExecutor,
  subjectAccess: SubjectAccess,
  subjectScreens: Readonly<Record<string, string>> = {},
  unfinalizedTemplates: readonly string[] = [],
) {
  return defineQueryHandler({
    name: "blocks",
    schema: DraftIdSchema,
    access,
    description:
      "Reads a document draft as a list of blocks with stable ids (b0, b1, ...) for structured editing with patch: each block has its type, its text with {{name}} placeholders and its settings. Also returns the draft's subject, template, status, revision, the frozen variables, the variable schema, the screen its subject type returns to (subjectScreen, or null), whether finalize is offered for its template (finalizable) and the settings, the deviations from the template text (blocks added, removed or changed) and the block types allowed in a PDF document. version is the base that patch, save, finalize, revise and discard expect back.",
    handler: async (query, ctx) => {
      const draft = await loadScopedDraft(
        documentDraftExecutor,
        ctx,
        query.user,
        query.payload.id,
        subjectAccess,
      );
      if (draft === null) throw new NotFoundError(DOCUMENT_DRAFT_ENTITY, query.payload.id);
      const subjectType = String(draft.subjectType);
      const body = String(draft.body);
      const templateBody = String(draft.templateBody);
      return {
        id: draft.id,
        subjectType: draft.subjectType,
        subjectId: draft.subjectId,
        templateSlug: draft.templateSlug,
        templateVariant: draft.templateVariant ?? null,
        templateTitle: draft.templateTitle ?? null,
        templateVersion: draft.templateVersion,
        locale: draft.locale,
        status: draft.status,
        revision: draft.revision,
        version: draft.version,
        fileRefId: draft.fileRefId ?? null,
        fileName: draft.fileName ?? null,
        body,
        templateBody,
        variables: draft.variables ?? {},
        variableSchema: draft.variableSchema ?? {},
        subjectScreen: Object.hasOwn(subjectScreens, subjectType)
          ? subjectScreens[subjectType]
          : null,
        finalizable: !unfinalizedTemplates.includes(String(draft.templateSlug)),
        meta: draft.meta ?? null,
        blocks: documentBlocksOf(parseDocumentJson(body)),
        deviations: diffTemplateBlocks(
          splitTemplateBlocks(templateBody, "html"),
          splitTemplateBlocks(body, "html"),
        ),
        allowedBlocks: allowedBlocksFor("document-pdf"),
      };
    },
  });
}
