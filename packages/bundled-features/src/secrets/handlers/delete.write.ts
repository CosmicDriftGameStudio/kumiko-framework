import { type AccessRule, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { DEFAULT_SECRETS_ACCESS } from "../constants";
import { requireSecretsContext } from "../feature";

export function createDeleteHandler(access: AccessRule = DEFAULT_SECRETS_ACCESS) {
  return defineWriteHandler({
    name: "delete",
    schema: z.object({
      key: z.string().min(1).max(100),
    }),
    access,
    handler: async (event, ctx) => {
      const secrets = requireSecretsContext(ctx, "secrets:write:delete");
      const removed = await secrets.delete(event.user.tenantId, event.payload.key, {
        deletedBy: event.user.id,
      });
      if (!removed) return failNotFound("tenant-secret", event.payload.key);
      return { isSuccess: true, data: { key: event.payload.key } };
    },
  });
}

// Backwards-compat: existing imports of `deleteWrite` keep working —
// identical to createDeleteHandler() with the default access.
export const deleteWrite = createDeleteHandler();
