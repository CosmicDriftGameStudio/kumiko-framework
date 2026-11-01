import { createTenantDb, type TenantDb } from "@cosmicdrift/kumiko-framework/db";
import { defineQueryHandler, parseTenantId } from "@cosmicdrift/kumiko-framework/engine";
import { AccessDeniedError, UnprocessableError } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { TENANT_KEEP_ACCOUNT_ROLES } from "../constants.ts";
import { describeOutlook, foldActivity } from "../inactivity-plan.ts";
import { resolveInactivityRule, type TenantInactivityOptions } from "../options.ts";
import { loadInactivityState, loadNewestSessionActivity } from "../state-store.ts";

const STATE_QUERY_ESCAPE_HATCH_REASON =
  "a SystemAdmin reads the inactivity state of any tenant through a database handle pinned to that tenant";

// Folds the sessions' newest activity in like the daily job does, so a login shows up before
// the next job run.
export function createInactivityStateQuery<TTier extends string>(
  options: TenantInactivityOptions<TTier>,
) {
  return defineQueryHandler({
    name: "state",
    schema: z.object({ tenantIdOverride: z.string().min(1).max(36).optional() }),
    access: { roles: [...TENANT_KEEP_ACCOUNT_ROLES, "SystemAdmin"] },
    escapeHatch: { grants: ["unsafeRaw"], reason: STATE_QUERY_ESCAPE_HATCH_REASON },
    description:
      "Returns whether the tenant is exempt from inactivity deletion, its last activity, the warnings already sent and the next step with its date; owners and admins see their own tenant, a SystemAdmin any tenant.",
    handler: async (query, ctx) => {
      const requested = query.payload.tenantIdOverride;
      const isOtherTenant = requested !== undefined && requested !== query.user.tenantId;
      let db: TenantDb = ctx.db;
      if (isOtherTenant) {
        if (!query.user.roles.includes("SystemAdmin")) throw new AccessDeniedError();
        const tenantId = parseTenantId(requested);
        if (tenantId === null) throw new UnprocessableError("invalid_tenant_id");
        db = createTenantDb({ db: ctx.db.unsafeRaw(), tenantId });
      }
      const rule = await resolveInactivityRule(options, db);
      const stored = await loadInactivityState(db);
      const folded = stored
        ? foldActivity(stored, await loadNewestSessionActivity(db)).state
        : null;
      const outlook = describeOutlook(folded, rule);
      return {
        exempt: outlook.exempt,
        lastActivityAt: outlook.lastActivityAt?.toString() ?? null,
        warningsSent: outlook.warningsSent,
        nextStep: outlook.nextStep,
        nextStepAt: outlook.nextStepAt?.toString() ?? null,
      };
    },
  });
}
