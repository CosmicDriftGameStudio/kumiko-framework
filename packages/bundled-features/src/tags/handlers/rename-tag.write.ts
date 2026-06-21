import type { AccessRule, WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { DEFAULT_TAG_ACCESS } from "../constants";
import { tagExecutor } from "../executor";
import { type RenameTagPayload, renameTagPayloadSchema } from "../schemas";

// rename-tag — renames a tag in the tenant's catalog. Optimistic-locked: the
// client sends the `version` it read (mirrors tenant:update). The executor
// merges shallowly so only `name` changes — `color` is preserved. A stale
// version returns version_conflict; the UI refetches and retries.
export function createRenameTagHandler(access: AccessRule = DEFAULT_TAG_ACCESS): WriteHandlerDef {
  return {
    name: "rename-tag",
    schema: renameTagPayloadSchema,
    access,
    handler: async (event, ctx) => {
      const payload = event.payload as RenameTagPayload; // @cast-boundary engine-payload
      return tagExecutor.update(
        { id: payload.id, version: payload.version, changes: { name: payload.name } },
        event.user,
        ctx.db,
      );
    },
  };
}

export const renameTagHandler: WriteHandlerDef = createRenameTagHandler();
