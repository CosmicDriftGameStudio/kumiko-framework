import { type AccessRule, defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError } from "@cosmicdrift/kumiko-framework/errors";
import { joinRowParentIsVisible } from "../../shared/index.ts";
import type { DocumentDraftExecutor } from "../entity.ts";
import { type SubjectAccess, subjectRoleAllows } from "../lib.ts";
import { BySubjectSchema } from "../payloads.ts";
import { DOCUMENT_DRAFT_ENTITY, DOCUMENT_DRAFT_STATUS } from "../web/constants.ts";

// Equals the executor's MAX_LIST_LIMIT; one object never has more live drafts.
const LIST_LIMIT = 200;

export function createBySubjectQuery(
  access: AccessRule,
  documentDraftExecutor: DocumentDraftExecutor,
  subjectAccess: SubjectAccess,
) {
  return defineQueryHandler({
    name: "by-subject",
    schema: BySubjectSchema,
    access,
    description:
      "Lists the drafts of one object (subjectType, subjectId), newest first, without their text: id, status, revision, version, template, file and creation time (insertedAt). Discarded drafts are left out.",
    handler: async (query, ctx) => {
      const { subjectType, subjectId } = query.payload;
      if (!subjectRoleAllows(subjectAccess, query.user, subjectType)) {
        throw new NotFoundError(DOCUMENT_DRAFT_ENTITY);
      }
      const subjectIsVisible = await joinRowParentIsVisible(
        ctx.registry,
        DOCUMENT_DRAFT_ENTITY,
        { subjectType, subjectId },
        query.user,
        ctx.db,
      );
      if (!subjectIsVisible) {
        throw new NotFoundError(DOCUMENT_DRAFT_ENTITY);
      }
      const found = await documentDraftExecutor.list(
        {
          filters: [
            { field: "subjectType", op: "eq", value: subjectType },
            { field: "subjectId", op: "eq", value: subjectId },
            { field: "status", op: "ne", value: DOCUMENT_DRAFT_STATUS.Discarded },
          ],
          sort: "insertedAt",
          sortDirection: "desc",
          limit: LIST_LIMIT,
        },
        query.user,
        ctx.db,
      );
      return found.rows.map((row) => ({
        id: row.id,
        status: row.status,
        revision: row.revision,
        version: row.version,
        templateSlug: row.templateSlug,
        templateVariant: row.templateVariant ?? null,
        fileRefId: row.fileRefId ?? null,
        fileName: row.fileName ?? null,
        insertedAt: row.insertedAt,
      }));
    },
  });
}
