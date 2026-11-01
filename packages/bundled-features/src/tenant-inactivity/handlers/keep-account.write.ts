import { fetchOne, updateMany } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { redeemKeepAccountToken } from "../keep-token.ts";
import { tenantInactivityStateTable } from "../state-table.ts";

const KEEP_ACCOUNT_ESCAPE_HATCH_REASON =
  "the anonymous link holder has no tenant scope; the tenant comes from the signed token and every statement filters by that tenantId";

export function createKeepAccountHandler(opts: { readonly keepAccountTokenSecret?: string }) {
  return defineWriteHandler({
    name: "keep-account",
    schema: z.object({ token: z.string().min(1) }),
    access: {
      roles: ["anonymous", "Member", "User", "TenantAdmin", "TenantOwner", "SystemAdmin"],
      anySignedIn: true,
    },
    escapeHatch: { grants: ["unsafeRaw"], reason: KEEP_ACCOUNT_ESCAPE_HATCH_REASON },
    agent: { expose: false },
    rateLimit: { per: "ip+handler", limit: 10, windowSeconds: 60 },
    description:
      "Redeems the keep-account link from an inactivity warning mail: counts as activity, resets the warning cycle and invalidates every earlier link.",
    handler: async (event, ctx) => {
      const runner = ctx.db.unsafeRaw();
      const now = ctx.tz.now();
      const redeemed = await redeemKeepAccountToken({
        token: event.payload.token,
        secret: opts.keepAccountTokenSecret,
        now,
        // The tenant id comes from the not-yet-verified token; a malformed value must end in the
        // generic 422, so the lookup error is swallowed by the grant's anchor-lookup guard.
        loadCycleId: async (tenantId) => {
          const row = await fetchOne<{ cycleId: string }>(runner, tenantInactivityStateTable, {
            tenantId,
          });
          return row?.cycleId ?? null;
        },
        commitKeep: async (tenantId, cycleId) => {
          const updated = await updateMany(
            runner,
            tenantInactivityStateTable,
            {
              lastActivityAt: now,
              warningsSent: 0,
              lastWarnedAt: null,
              postponedDueAt: null,
              cycleId: crypto.randomUUID(),
            },
            { tenantId, cycleId },
          );
          return updated.length === 1;
        },
      });
      if (!redeemed.ok) return writeFailure(new UnprocessableError("invalid_or_expired_token"));
      return { isSuccess: true as const, data: { kept: true } };
    },
  });
}
