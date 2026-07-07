// list-subscriptions — sysadmin-cross-tenant list-query auf der
// `read_subscriptions`-projection. Tenant-Admins lesen ihre eigene
// subscription via getSubscriptionForTenant-helper (= ctx.db ist
// tenant-scoped, gibt automatisch nur die row des Callers zurück).

import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  configuredPiiSubjectKms,
  decryptPiiFieldValues,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { QueryHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { SUBSCRIPTION_PII_FIELDS } from "../entities";
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
    const piiKms = configuredPiiSubjectKms();
    if (!piiKms) return { rows };
    const decryptedRows = await Promise.all(
      rows.map((row) =>
        decryptPiiFieldValues(row as Record<string, unknown>, SUBSCRIPTION_PII_FIELDS, piiKms, {
          requestId: `billing-foundation:list-subscriptions:${ctx.user.tenantId}`,
        }),
      ),
    );
    return { rows: decryptedRows };
  },
};
