import { type AccessRule, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { ValidationError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import {
  applyDocumentOps,
  type DocumentOp,
  parseDocumentJson,
  serializeDocumentJson,
} from "../../template-resolver/index.ts";
import type { DocumentDraftExecutor } from "../entity.ts";
import {
  draftNotFound,
  loadScopedDraft,
  notInStatus,
  recordOrEmpty,
  type SubjectAccess,
} from "../lib.ts";
import { PatchDraftSchema } from "../payloads.ts";
import {
  DOCUMENT_DRAFT_ERROR,
  DOCUMENT_DRAFT_LAST_CHANGE_SOURCE,
  DOCUMENT_DRAFT_STATUS,
} from "../web/constants.ts";

type PatchData = { readonly id: string; readonly version: number };

// The draft keeps the variables and settings of its template: only the text changes.
const REFUSED_DRAFT_OPS: ReadonlySet<DocumentOp["op"]> = new Set([
  "setVariable",
  "setMeta",
  "setResource",
]);

export function createPatchHandler(
  access: AccessRule,
  documentDraftExecutor: DocumentDraftExecutor,
  subjectAccess: SubjectAccess,
) {
  return defineWriteHandler<"patch", typeof PatchDraftSchema, PatchData>({
    name: "patch",
    schema: PatchDraftSchema,
    access,
    agent: { risk: "low", effect: "proposal" },
    description:
      "Changes the text of an open document draft with the same structured operations as patch-draft of a template (insertBlock, replaceBody, formatBlock, replaceText, removeBlock; never raw HTML), without touching the template. setVariable, setMeta and setResource are refused with op_not_allowed. Block ids and base (the draft version) come from the blocks query and refer to the state that was read; if the draft changed since, the call fails with version_conflict and nothing is written. Placeholders may be removed. Returns the draft id and its new version.",
    handler: async (event, ctx) => {
      const { id, base, ops } = event.payload;
      const user = event.user;
      const draft = await loadScopedDraft(documentDraftExecutor, ctx, user, id, subjectAccess);
      if (draft === null) return draftNotFound(id);
      if (draft.status !== DOCUMENT_DRAFT_STATUS.Open)
        return notInStatus(DOCUMENT_DRAFT_STATUS.Open);

      const refusedIndex = ops.findIndex((op) => REFUSED_DRAFT_OPS.has(op.op));
      if (refusedIndex !== -1) {
        return writeFailure(
          new ValidationError({
            fields: [
              {
                path: `ops.${refusedIndex}`,
                code: DOCUMENT_DRAFT_ERROR.OpNotAllowed,
                i18nKey: "documentDraft.errors.opNotAllowed",
                params: { op: ops[refusedIndex]?.op },
              },
            ],
          }),
        );
      }

      const applied = applyDocumentOps({
        doc: parseDocumentJson(String(draft.body)),
        meta: recordOrEmpty(draft.meta),
        variableSchema: recordOrEmpty(draft.variableSchema),
        kind: "document-pdf",
        region: undefined,
        ops,
      });
      if (!applied.ok) return writeFailure(new ValidationError({ fields: applied.issues }));

      const updated = await documentDraftExecutor.update(
        {
          id,
          version: base,
          changes: {
            body: serializeDocumentJson(applied.doc),
            lastChange: { source: DOCUMENT_DRAFT_LAST_CHANGE_SOURCE.Ops, ops },
          },
        },
        user,
        ctx.db,
      );
      if (!updated.isSuccess) return updated;
      return { isSuccess: true, data: { id, version: updated.data.event.version } };
    },
  });
}
