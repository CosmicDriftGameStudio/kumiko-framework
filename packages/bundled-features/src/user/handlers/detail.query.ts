import {
  access,
  defineEntityDetailHandler,
  type HandlerContext,
} from "@cosmicdrift/kumiko-framework/engine";
import { userEntity } from "../schema/user";
import { attachTenantLabels, dbForList } from "./list.query";

// Only SystemAdmins can read arbitrary users. Tenant-level "Admin" does NOT
// grant this — the user feature is tenant-agnostic, and an Admin's scope is
// bound to their own tenant's memberships (served by the tenant feature).
const baseDetail = defineEntityDetailHandler("user", userEntity, {
  access: { roles: access.systemAdmin },
});

// Same tenants enrichment as user:list — derived field placeholder is "".
export const detailQuery = {
  ...baseDetail,
  handler: async (
    query: Parameters<NonNullable<typeof baseDetail.handler>>[0],
    ctx: HandlerContext,
  ) => {
    const result = await baseDetail.handler?.(query, ctx);
    if (result === null || typeof result !== "object") return result;
    const [enriched] = await attachTenantLabels(
      [result as Record<string, unknown>],
      dbForList(ctx),
    );
    return enriched ?? result;
  },
};
