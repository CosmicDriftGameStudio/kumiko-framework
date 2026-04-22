import { ConfigScopes, defineWriteHandler } from "@kumiko/framework/engine";
import { z } from "zod";
import { CONFIG_CHANGED_EVENT_NAME, requireConfigResolver } from "../config-feature";
import { prepareConfigWrite } from "./set.write";

const scopeEnum = z.enum([ConfigScopes.system, ConfigScopes.tenant, ConfigScopes.user]);

export const resetWrite = defineWriteHandler({
  name: "reset",
  schema: z.object({
    key: z.string(),
    scope: scopeEnum.optional(),
  }),
  // Per-key access enforcement lives inside the handler via checkWriteAccess.
  access: { openToAll: true },
  handler: async (event, ctx) => {
    const db = ctx.db;
    const resolver = requireConfigResolver(ctx, "config:write:reset");

    const prep = prepareConfigWrite({
      registry: ctx.registry,
      user: event.user,
      key: event.payload.key,
      scope: event.payload.scope,
    });
    if (!prep.ok) return prep.failure;
    const { scope, tenantId, userId } = prep;
    await resolver.reset(event.payload.key, tenantId, userId, db);

    // Emit the change event — same stream as `set`, action="reset", no value
    // (the resolver fell back to keyDef.default; subscribers can re-read if
    // they need the new effective value). aggregateId = tenantId for the
    // same UUID-compatibility reason as set.write.
    await ctx.appendEvent({
      aggregateId: event.user.tenantId,
      aggregateType: "configChanges",
      type: CONFIG_CHANGED_EVENT_NAME,
      payload: {
        key: event.payload.key,
        scope,
        action: "reset",
      },
    });

    return { isSuccess: true, data: { key: event.payload.key, scope } };
  },
});
