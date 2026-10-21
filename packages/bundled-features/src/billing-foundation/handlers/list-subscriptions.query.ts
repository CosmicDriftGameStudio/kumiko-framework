// list-subscriptions — sysadmin cross-tenant list query on the
// `read_subscriptions` projection. Tenant admins read their own
// subscription through the getSubscriptionForTenant helper (= ctx.db is
// tenant-scoped and automatically returns only the caller's row).
import {
  configuredPiiSubjectKms,
  decryptPiiFieldValues,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { QueryHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { SUBSCRIPTION_PII_FIELDS } from "../entities.ts";
import { subscriptionsProjectionTable } from "../projection.ts";

const listSchema = z.object({}).strict();

export const listSubscriptionsQuery: QueryHandlerDef = {
  name: "subscription:list",
  description:
    "Returns the tenant's subscription rows with provider, status, tier and current period end (provider ids decrypted); use it to answer what plan a tenant is on and until when.",
  schema: listSchema,
  access: { roles: ["SystemAdmin", "TenantAdmin"] },
  handler: async (_query, ctx) => {
    const rows = await ctx.db.selectMany(subscriptionsProjectionTable, {
      tenantId: ctx.user.tenantId,
    });
    const piiKms = configuredPiiSubjectKms();
    if (!piiKms) return { rows };
    const decryptedRows = await Promise.all(
      rows.map((row) =>
        decryptPiiFieldValues(row, SUBSCRIPTION_PII_FIELDS, piiKms, {
          requestId: `billing-foundation:list-subscriptions:${ctx.user.tenantId}`,
        }),
      ),
    );
    return { rows: decryptedRows };
  },
};
