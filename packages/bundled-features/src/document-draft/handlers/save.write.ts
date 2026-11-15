import { type AccessRule, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { ValidationError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import type { SubjectScope } from "../../shared/index.ts";
import {
  documentViolationsToFieldIssues,
  sanitizeDocumentHtml,
} from "../../template-resolver/index.ts";
import { documentDraftExecutor } from "../entity.ts";
import { draftNotFound, loadScopedDraft, notInStatus } from "../lib.ts";
import { SaveDraftSchema } from "../payloads.ts";
import { DOCUMENT_DRAFT_LAST_CHANGE_SOURCE, DOCUMENT_DRAFT_STATUS } from "../web/constants.ts";

type SaveData = { readonly id: string; readonly version: number };

export function createSaveHandler(access: AccessRule, scope: SubjectScope) {
  return defineWriteHandler<"save", typeof SaveDraftSchema, SaveData>({
    name: "save",
    schema: SaveDraftSchema,
    access,
    agent: { expose: false },
    description:
      "Replaces the text of an open document draft with the HTML of the editor; the HTML is checked and cleaned like a template body, and anything it does not allow is refused with the violation codes.",
    handler: async (event, ctx) => {
      const { id, base, content } = event.payload;
      const user = event.user;
      const draft = await loadScopedDraft(ctx, user, scope, id);
      if (draft === null) return draftNotFound(id);
      if (draft.status !== DOCUMENT_DRAFT_STATUS.Open)
        return notInStatus(DOCUMENT_DRAFT_STATUS.Open);

      const sanitized = sanitizeDocumentHtml(content);
      if (!sanitized.ok) {
        return writeFailure(
          new ValidationError({ fields: documentViolationsToFieldIssues(sanitized.violations) }),
        );
      }
      const updated = await documentDraftExecutor.update(
        {
          id,
          version: base,
          changes: {
            body: sanitized.html,
            lastChange: { source: DOCUMENT_DRAFT_LAST_CHANGE_SOURCE.Editor },
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
