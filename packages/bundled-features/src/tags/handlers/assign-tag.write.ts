import type { AccessRule, WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { tagAssignmentAggregateId } from "../aggregate-id";
import { DEFAULT_TAG_ACCESS } from "../constants";
import { tagAssignmentExecutor } from "../executor";
import { type AssignTagPayload, assignTagPayloadSchema } from "../schemas";

// assign-tag — links a tag to a host entity by (entityType, entityId). The
// assignment id is deterministic, so the row is unique per (tag, entity).
//
// Idempotency over the full lifecycle (assign → remove → assign):
//   - already active        → return success (requested end state).
//   - removed (soft-deleted) → restore() the existing stream. create() would
//     append at version 0 onto the created+deleted stream and version_conflict;
//     the deterministic id means that stream is permanent.
//   - never assigned         → create() (restore reports not_found).
// A concurrent first-time race still version_conflicts (409); acceptable, since
// assigning is a low-frequency UI action.
export function createAssignTagHandler(access: AccessRule = DEFAULT_TAG_ACCESS): WriteHandlerDef {
  return {
    name: "assign-tag",
    schema: assignTagPayloadSchema,
    access,
    handler: async (event, ctx) => {
      const payload = event.payload as AssignTagPayload; // @cast-boundary engine-payload
      const id = tagAssignmentAggregateId(
        event.user.tenantId,
        payload.tagId,
        payload.entityType,
        payload.entityId,
      );

      const existing = await tagAssignmentExecutor.detail({ id }, event.user, ctx.db);
      if (existing) {
        return { isSuccess: true as const, data: { id } };
      }

      const restored = await tagAssignmentExecutor.restore({ id }, event.user, ctx.db);
      if (restored.isSuccess) return restored;
      if (restored.error.code !== "not_found") return restored;

      return tagAssignmentExecutor.create(
        {
          id,
          tagId: payload.tagId,
          entityType: payload.entityType,
          entityId: payload.entityId,
        },
        event.user,
        ctx.db,
      );
    },
  };
}

export const assignTagHandler: WriteHandlerDef = createAssignTagHandler();
