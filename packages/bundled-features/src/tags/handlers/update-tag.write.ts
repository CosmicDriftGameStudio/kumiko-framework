import type { AccessRule, WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { DEFAULT_TAG_ACCESS } from "../constants";
import { tagExecutor } from "../executor";
import { type UpdateTagPayload, updateTagPayloadSchema } from "../schemas";

// update-tag — edits a catalog tag (rename / recolor / re-scope). Optimistic-
// locked: the client sends the `version` it read (mirrors tenant:update). Only
// the fields present in the payload go into `changes`, and the executor merges
// shallowly, so any omitted field is preserved (color/scope accept "" to clear).
// A stale version returns version_conflict; the UI refetches and retries.
export function createUpdateTagHandler(access: AccessRule = DEFAULT_TAG_ACCESS): WriteHandlerDef {
  return {
    name: "update-tag",
    schema: updateTagPayloadSchema,
    access,
    handler: async (event, ctx) => {
      const payload = event.payload as UpdateTagPayload; // @cast-boundary engine-payload
      const changes: Record<string, unknown> = {};
      if (payload.name !== undefined) changes["name"] = payload.name;
      if (payload.color !== undefined) changes["color"] = payload.color;
      if (payload.scope !== undefined) changes["scope"] = payload.scope;
      return tagExecutor.update(
        { id: payload.id, version: payload.version, changes },
        event.user,
        ctx.db,
      );
    },
  };
}

export const updateTagHandler: WriteHandlerDef = createUpdateTagHandler();
