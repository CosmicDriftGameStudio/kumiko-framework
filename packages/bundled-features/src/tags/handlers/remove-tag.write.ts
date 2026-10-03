import type { AccessRule, WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { denyUnlessJoinRowParentVisible } from "../../shared/index.js";
import { tagAssignmentAggregateId } from "../aggregate-id.js";
import { DEFAULT_TAG_ACCESS } from "../constants.js";
import { tagAssignmentExecutor } from "../executor.js";
import { type RemoveTagPayload, removeTagPayloadSchema } from "../schemas.js";

// remove-tag — unlinks a tag from a host entity. Idempotent: removing an
// assignment that doesn't exist is already the requested end state (not
// assigned), so we pre-check and return success without a delete.
//
// Host reference: entityType/entityId are client input, so the caller must be
// able to see the host row before detaching anything from it — see
// shared/parent-visibility.ts.
export function createRemoveTagHandler(
  access: AccessRule = DEFAULT_TAG_ACCESS,
  assignmentExecutor: typeof tagAssignmentExecutor = tagAssignmentExecutor,
): WriteHandlerDef {
  return {
    name: "remove-tag",
    schema: removeTagPayloadSchema,
    access,
    description:
      "Detaches one catalog tag from one host entity, reporting success when it was not attached; use it to untag a single record while the tag itself stays in the catalog.",
    handler: async (event, ctx) => {
      const payload = event.payload as RemoveTagPayload; // @cast-boundary engine-payload
      const denied = await denyUnlessJoinRowParentVisible(
        ctx.registry,
        "tag-assignment",
        payload,
        event.user,
        ctx.db,
      );
      if (denied) return denied;

      const id = tagAssignmentAggregateId(
        event.user.tenantId,
        payload.tagId,
        payload.entityType,
        payload.entityId,
      );

      const existing = await assignmentExecutor.detail({ id }, event.user, ctx.db);
      if (!existing) {
        return { isSuccess: true as const, data: { id } };
      }

      return assignmentExecutor.delete({ id }, event.user, ctx.db);
    },
  };
}

export const removeTagHandler: WriteHandlerDef = createRemoveTagHandler();
