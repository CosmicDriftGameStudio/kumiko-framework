// list-subscriptions — sysadmin-cross-tenant list-query auf der
// `read_subscriptions`-projection. Tenant-Admins lesen ihre eigene
// subscription via getSubscriptionForTenant-helper (= ctx.db ist
// tenant-scoped, gibt automatisch nur die row des Callers zurück).

import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { QueryHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { subscriptionsProjectionTable } from "../projection";

const listSchema = z.object({}).strict();

export const listSubscriptionsQuery: QueryHandlerDef = {
  name: "subscription:list",
  schema: listSchema,
  access: { roles: ["SystemAdmin", "TenantAdmin"] },
  handler: async (_query, ctx) => {
    const rows = await selectMany(ctx.db.raw, subscriptionsProjectionTable, {
      tenantId: ctx.user.tenantId,
    });
    return { rows };
  },
};
