import type { AccessRule, WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { DEFAULT_TAG_ACCESS } from "../constants";
import { tagExecutor } from "../executor";
import { type CreateTagPayload, createTagPayloadSchema } from "../schemas";

// create-tag — adds a tag to the tenant's catalog. The framework mints a fresh
// UUIDv7 id (no explicit id passed). Tag names are not unique by design: the
// catalog is a free list and dedup is a UI concern (autocomplete from existing
// tags). Editing is update-tag.write.ts; delete (with cascade) is delete-tag.write.ts.
export function createCreateTagHandler(access: AccessRule = DEFAULT_TAG_ACCESS): WriteHandlerDef {
  return {
    name: "create-tag",
    schema: createTagPayloadSchema,
    access,
    handler: async (event, ctx) => {
      const payload = event.payload as CreateTagPayload; // @cast-boundary engine-payload
      return tagExecutor.create(payload, event.user, ctx.db);
    },
  };
}

export const createTagHandler: WriteHandlerDef = createCreateTagHandler();
