import { type AccessRule, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { announceSecretChange } from "../announce-secret-change.ts";
import { JOIN_REQUEST_TRANSACTION_REASON, requireSecretsContext } from "../feature.ts";
import { resolveSecretTarget, secretScopeSchema } from "../secret-scope.ts";
import { DEFAULT_SECRETS_ACCESS, SecretsHandlers } from "../web/constants.ts";
import { checkSecretKeyWrite } from "../write-gate.ts";

export function createDeleteHandler(access: AccessRule = DEFAULT_SECRETS_ACCESS) {
  return defineWriteHandler({
    name: "delete",
    description:
      "Permanently removes the stored secret under the given key for the caller's tenant (or, with scope system and the SystemAdmin role, the platform-wide one), breaking every feature that depends on that credential.",
    agent: { risk: "high" },
    schema: z.object({
      key: z.string().min(1).max(100),
      scope: secretScopeSchema,
    }),
    access,
    escapeHatch: { grants: ["unsafeRaw"], reason: JOIN_REQUEST_TRANSACTION_REASON },
    handler: async (event, ctx) => {
      const secrets = requireSecretsContext(
        { secrets: ctx.services.secrets, user: ctx.user },
        SecretsHandlers.delete,
      ).withRunner(ctx.db.unsafeRaw());
      const target = resolveSecretTarget(event.user, event.payload.scope);
      if (!target.ok) return writeFailure(target.error);
      const gate = checkSecretKeyWrite(ctx.registry, event.user.roles, event.payload.key, {
        allowUndeclared: true,
      });
      if (!gate.ok) return gate.failure;
      const removed = await secrets.delete(target.tenantId, event.payload.key, {
        deletedBy: event.user.id,
      });
      if (!removed) return failNotFound("tenant-secret", event.payload.key);
      announceSecretChange(ctx, target.tenantId, event.payload.key);
      return { isSuccess: true, data: { key: event.payload.key } };
    },
  });
}
