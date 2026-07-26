import { requestContext } from "@cosmicdrift/kumiko-framework/api";
import { updateMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { access, defineWriteHandler, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { append } from "@cosmicdrift/kumiko-framework/event-store";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { userSessionTable } from "../schema/user-session";
import {
  SESSION_REVOKED_AGGREGATE_TYPE,
  SESSION_REVOKED_EVENT_QN,
  sessionRevokedSchema,
} from "../session-revoked-event";

// Mass-revoke ALL live sessions for a target user — privileged-only.
// Used by user-data-rights:restrict-account for account-freeze (DSGVO
// Art. 18) and potentially other ops flows ("ban user", "compromised
// account"). Unlike revoke-all-others, the caller's own session (if any)
// is revoked too — the caller is System (cron/operator/cross-feature),
// not the end-user themselves.
//
// Tenant-scope: the userSession schema persists tenantId per row (a user
// can have sessions in multiple tenants). We revoke cross-tenant because
// "account restriction" is a global user-level statement (the forget path
// is global too, see the User-Entity special doc). The UPDATE filters
// only on userId.
export const revokeAllForUserWrite = defineWriteHandler({
  name: "user-session:revoke-all-for-user",
  schema: z.object({
    userId: z.string().min(1),
  }),
  access: { roles: access.privileged },
  handler: async (event, ctx) => {
    const updated = await updateMany<{ id: string }>(
      ctx.db.raw,
      userSessionTable,
      { revokedAt: Temporal.Now.instant() },
      { userId: event.payload.userId, revokedAt: null },
    );

    // Lightweight append alongside the direct-write above (#1559) — see
    // revoke.write.ts for why this isn't a lifecycle event on
    // store_user_sessions. Uses the low-level append() (not
    // ctx.unsafeAppendEvent) because this handler is deliberately
    // cross-tenant: the privileged caller's own tenantId (what
    // ctx.unsafeAppendEvent would bind to) has no relationship to the
    // target user's session tenant(s). Anchored on SYSTEM_TENANT_ID
    // instead, same as the jobs feature's cross-tenant run-lifecycle
    // events (job-run-logger.ts) — a fresh aggregate per call, so no
    // predecessor/version_conflict concerns.
    //
    // append() itself does NOT validate against the r.defineEvent-
    // registered schema (that guarantee only comes from going through
    // ctx.unsafeAppendEvent's dispatcher path). Mirrors job-run-logger.ts:
    // parse explicitly before the raw append so a shape drift fails loudly
    // here instead of landing unvalidated on the events table.
    if (updated.length > 0) {
      const payload = sessionRevokedSchema.parse({
        userId: event.payload.userId,
        sessionIds: updated.map((row) => row.id),
      });
      const reqCtx = requestContext.get();
      await append(ctx.db.raw, {
        aggregateId: generateId(),
        aggregateType: SESSION_REVOKED_AGGREGATE_TYPE,
        tenantId: SYSTEM_TENANT_ID,
        expectedVersion: 0,
        type: SESSION_REVOKED_EVENT_QN,
        eventVersion: ctx.registry.getEvent(SESSION_REVOKED_EVENT_QN)?.version ?? 1,
        payload,
        metadata: {
          userId: event.user.id,
          ...(reqCtx?.requestId ? { requestId: reqCtx.requestId } : {}),
          ...(reqCtx?.correlationId ? { correlationId: reqCtx.correlationId } : {}),
          ...(reqCtx?.causationId ? { causationId: reqCtx.causationId } : {}),
        },
      });
    }

    return {
      isSuccess: true as const,
      data: { count: updated.length, userId: event.payload.userId },
    };
  },
});
