import type { AccessRule, WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { parentRowIsVisible } from "../../shared";
import { tagAssignmentAggregateId } from "../aggregate-id";
import { DEFAULT_TAG_ACCESS } from "../constants";
import { tagAssignmentExecutor } from "../executor";
import { type RemoveTagPayload, removeTagPayloadSchema } from "../schemas";

// remove-tag — unlinks a tag from a host entity. Idempotent: removing an
// assignment that doesn't exist is already the requested end state (not
// assigned), so we pre-check and return success without a delete.
//
// Host reference: entityType/entityId are client input, so the caller must be
// able to see the host row before detaching anything from it — see
// shared/parent-visibility.ts.
export function createRemoveTagHandler(access: AccessRule = DEFAULT_TAG_ACCESS): WriteHandlerDef {
  return {
    name: "remove-tag",
    schema: removeTagPayloadSchema,
    access,
    description:
      "Detaches one catalog tag from one host entity, reporting success when it was not attached; use it to untag a single record while the tag itself stays in the catalog.",
    handler: async (event, ctx) => {
      const payload = event.payload as RemoveTagPayload; // @cast-boundary engine-payload
      // entityType/entityId are client input: the caller must be able to see
      // the host row through that entity's own read path (tenant scope plus its
      // `access.read` ownership) before its assignment row may be written.
      // Checked FIRST, ahead of every lookup below, so a denied caller can't tell
      // an invisible parent apart from a missing assignment or an unknown tag —
      // every path answers with the same NotFoundError.
      if (
        !(await parentRowIsVisible(
          ctx.registry,
          payload.entityType,
          payload.entityId,
          event.user,
          ctx.db,
        ))
      ) {
        return writeFailure(new NotFoundError(payload.entityType, payload.entityId));
      }

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
