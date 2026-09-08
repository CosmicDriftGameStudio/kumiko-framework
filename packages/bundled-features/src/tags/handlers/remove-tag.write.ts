import type { AccessRule, WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { tagAssignmentAggregateId } from "../aggregate-id";
import { DEFAULT_TAG_ACCESS } from "../constants";
import { tagAssignmentExecutor } from "../executor";
import { type RemoveTagPayload, removeTagPayloadSchema } from "../schemas";

// remove-tag — unlinks a tag from a host entity. Idempotent: removing an
// assignment that doesn't exist is already the requested end state (not
// assigned), so we pre-check and return success without a delete.
export function createRemoveTagHandler(access: AccessRule = DEFAULT_TAG_ACCESS): WriteHandlerDef {
  return {
    name: "remove-tag",
    schema: removeTagPayloadSchema,
    access,
    description:
      "Detaches one catalog tag from one host entity, reporting success when it was not attached; use it to untag a single record while the tag itself stays in the catalog.",
    handler: async (event, ctx) => {
      const payload = event.payload as RemoveTagPayload; // @cast-boundary engine-payload
      const id = tagAssignmentAggregateId(
        event.user.tenantId,
        payload.tagId,
        payload.entityType,
        payload.entityId,
      );

      const existing = await tagAssignmentExecutor.detail({ id }, event.user, ctx.db);
      if (!existing) {
        return { isSuccess: true as const, data: { id } };
      }

      return tagAssignmentExecutor.delete({ id }, event.user, ctx.db);
    },
  };
}

export const removeTagHandler: WriteHandlerDef = createRemoveTagHandler();
