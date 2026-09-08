import { type AccessRule, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { DEFAULT_SECRETS_ACCESS } from "../constants";
import { requireSecretsContext } from "../feature";

export function createDeleteHandler(access: AccessRule = DEFAULT_SECRETS_ACCESS) {
  return defineWriteHandler({
    name: "delete",
    description:
      "Permanently removes the stored secret under the given key for the caller's tenant, breaking every feature that depends on that credential.",
    agent: { risk: "high" },
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
