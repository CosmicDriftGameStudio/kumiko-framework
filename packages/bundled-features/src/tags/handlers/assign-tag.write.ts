import type { AccessRule, WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { denyUnlessJoinRowParentVisible } from "../../shared/index.ts";
import { tagAssignmentAggregateId } from "../aggregate-id.ts";
import { tagAssignmentExecutor, tagExecutor } from "../executor.ts";
import { type AssignTagPayload, assignTagPayloadSchema } from "../schemas.ts";
import { DEFAULT_TAG_ACCESS, TAG_LOCK_NAMESPACE } from "../web/constants.ts";

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
// Referential integrity: there is no FK (event-sourced, no JOIN), so we verify
// the tag exists in the catalog before any restore/create — otherwise a call
// racing delete-tag would resurrect or project an assignment for a gone tag.
//
// Host reference: entityType/entityId are never trusted client input either —
// the aggregate-id is tenant-scoped, so this is not a cross-tenant hole, but
// without the check any dispatch-eligible tenant user could tag an object they
// are not allowed to read. See shared/parent-visibility.ts.
export function createAssignTagHandler(
  access: AccessRule = DEFAULT_TAG_ACCESS,
  assignmentExecutor: typeof tagAssignmentExecutor = tagAssignmentExecutor,
): WriteHandlerDef {
  return {
    name: "assign-tag",
    schema: assignTagPayloadSchema,
    access,
    description:
      "Attaches an existing catalog tag to one host entity addressed by its type and id, reporting success when the tag was already attached; use it to tag a record, not to create the tag.",
    handler: async (event, ctx) => {
      const payload = event.payload as AssignTagPayload; // @cast-boundary engine-payload
      const denied = await denyUnlessJoinRowParentVisible(
        ctx.registry,
        "tag-assignment",
        payload,
        event.user,
        ctx.db,
      );
      if (denied) return denied;

      // Same lock as delete-tag: the existence check below and the assignment
      // write must not interleave with a delete-tag cascade, or the cascade
      // misses the new assignment and leaves an orphan.
      await ctx.db.advisoryXactLock(TAG_LOCK_NAMESPACE, payload.tagId);
      const tag = await tagExecutor.detail({ id: payload.tagId }, event.user, ctx.db);
      if (!tag) return writeFailure(new NotFoundError("tag", payload.tagId));

      const id = tagAssignmentAggregateId(
        event.user.tenantId,
        payload.tagId,
        payload.entityType,
        payload.entityId,
      );

      const existing = await assignmentExecutor.detail({ id }, event.user, ctx.db);
      if (existing) {
        return { isSuccess: true as const, data: { id } };
      }

      const restored = await assignmentExecutor.restore({ id }, event.user, ctx.db);
      if (restored.isSuccess) return { isSuccess: true as const, data: { id } };
      // A concurrent first-time assign can also land here: the other caller's
      // create() already wrote an active row between our `existing` read
      // above and this restore() call, so restore() correctly refuses with
      // "not_deleted" — but the desired end state is already true. Converge
      // like the create() race below instead of surfacing a spurious error.
      if (
        isPlainObject(restored.error.details) &&
        restored.error.details["reason"] === "not_deleted"
      ) {
        return { isSuccess: true as const, data: { id } };
      }
      if (restored.error.code !== "not_found") return restored;

      const created = await assignmentExecutor.create(
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
