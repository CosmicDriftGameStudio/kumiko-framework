import { defineWriteHandler } from "@kumiko/framework/engine";
import { failNotFound } from "@kumiko/framework/errors";
import { z } from "zod";
import { requireSecretsContext } from "../secrets-feature";

export const deleteWrite = defineWriteHandler({
  name: "delete",
  schema: z.object({
    key: z.string().min(1).max(100),
  }),
  access: { roles: ["TenantAdmin"] },
  handler: async (event, ctx) => {
    const secrets = requireSecretsContext(ctx, "secrets:write:delete");
    const removed = await secrets.delete(event.user.tenantId, event.payload.key, {
      deletedBy: event.user.id,
    });
    if (!removed) return failNotFound("tenant-secret", event.payload.key);
    return { isSuccess: true, data: { key: event.payload.key } };
  },
});
