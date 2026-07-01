import type { AccessRule, WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { tagAssignmentAggregateId } from "../aggregate-id";
import { DEFAULT_TAG_ACCESS } from "../constants";
import { tagAssignmentExecutor, tagExecutor } from "../executor";
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
// A concurrent first-time race converges: both callers fall through to
// create(), the loser's create() version_conflicts, and the handler treats
// that as success since the winner already wrote the desired end state.
//
// Referential integrity: there is no FK (event-sourced, no JOIN), so before a
// first-time create we verify the tag exists in the catalog — a malformed call
// with an unknown tagId would otherwise project a dangling assignment.
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
      if (restored.isSuccess) return { isSuccess: true as const, data: { id } };
      if (restored.error.code !== "not_found") return restored;

      const tag = await tagExecutor.detail({ id: payload.tagId }, event.user, ctx.db);
      if (!tag) return writeFailure(new NotFoundError("tag", payload.tagId));

      const created = await tagAssignmentExecutor.create(
        {
          id,
          tagId: payload.tagId,
          entityType: payload.entityType,
          entityId: payload.entityId,
        },
        event.user,
        ctx.db,
      );
      if (created.isSuccess) return created;
      // A concurrent first-time assign of the same (tag, entity) races here —
      // both callers' `existing` read above saw null, so both fall through to
      // create(). The loser's create() version_conflicts (409), but the
      // desired end state (the assignment exists) is already true — the
      // winner just wrote it. Converge instead of surfacing a spurious 409
      // for an idempotent operation.
      if (created.error.code !== "version_conflict") return created;
      return { isSuccess: true as const, data: { id } };
    },
  };
}

export const assignTagHandler: WriteHandlerDef = createAssignTagHandler();
