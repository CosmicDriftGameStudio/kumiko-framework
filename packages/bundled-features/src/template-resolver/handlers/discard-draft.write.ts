import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, ValidationError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { TemplateResolverErrors } from "../qualified-names.ts";
import { executor } from "./shared.ts";
import { loadTargetRow, type StatusTarget, writeAccessFor } from "./toggle-status.write.ts";

function createDiscardDraftHandler(name: string, target: StatusTarget, description: string) {
  return defineWriteHandler({
    name,
    schema: z.object({ id: z.string().min(1) }),
    access: writeAccessFor(target),
    ...(target === "system" ? { agent: { risk: "high" as const } } : {}),
    description,
    handler: async (event, ctx) => {
      const { db, scoped, row } = await loadTargetRow(ctx, target, event.user, event.payload.id);
      if (!row) return writeFailure(new NotFoundError("template-resource", event.payload.id));
      if (row.draft === null) {
        return writeFailure(
          new ValidationError({
            fields: [
              {
                path: "id",
                code: TemplateResolverErrors.noDraft,
                i18nKey: "templateResolver.errors.noDraft",
              },
            ],
          }),
        );
      }
      const result = await executor.update(
        { id: row.id, version: row.version, changes: { draft: null } },
        event.user,
        db,
        scoped ? { streamTenantId: scoped.streamTenantId } : undefined,
      );
      if (!result.isSuccess) return result;
      return { isSuccess: true as const, data: { id: String(row.id), discarded: true } };
    },
  });
}

export const discardDraftWrite = createDiscardDraftHandler(
  "discard-draft",
  "own",
  "Throws away the open draft of one template resource of the caller's tenant so the editor shows the active version again; the served version is untouched. Refused with no_draft when there is no draft.",
);
export const discardDraftSystemWrite = createDiscardDraftHandler(
  "discard-draft-system",
  "system",
  "Throws away the open draft of one system-default template; the served version stays. SystemAdmin only, refused with no_draft when there is no draft.",
);
