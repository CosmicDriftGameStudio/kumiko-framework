// list-subscriptions — sysadmin-cross-tenant list-query auf der
// `read_subscriptions`-projection. Tenant-Admins lesen ihre eigene
// subscription via getSubscriptionForTenant-helper (= ctx.db ist
// tenant-scoped, gibt automatisch nur die row des Callers zurück).

import type { QueryHandlerDef } from "@kumiko/framework/engine";
import { z } from "zod";
import { subscriptionsProjectionTable } from "../projection";

const listSchema = z.object({}).passthrough();

export const listSubscriptionsQuery: QueryHandlerDef = {
  name: "subscription:list",
  schema: listSchema,
  access: { roles: ["SystemAdmin", "TenantAdmin"] },
  handler: async (_query, ctx) => {
    const rows = await ctx.db.select().from(subscriptionsProjectionTable);
    return { rows };
  },
};
