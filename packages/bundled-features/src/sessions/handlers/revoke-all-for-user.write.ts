import { requestContext } from "@cosmicdrift/kumiko-framework/api";
import { access, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import { revokeSessionsAndAnnounce } from "../revoke-sessions.ts";
import { SESSION_REVOKED_EVENT_QN } from "../session-revoked-event.ts";

const REVOKE_ALL_SESSIONS_REASON =
  "revokes the target user's sessions in every tenant and appends the audit event on the SYSTEM stream";

// Mass-revoke ALL live sessions for a target user — privileged-only.
// Used by user-data-rights:restrict-account for account-freeze (DSGVO
// Art. 18) and potentially other ops flows ("ban user", "compromised
// account"). Unlike revoke-all-others, the caller's own session (if any)
// is revoked too — the caller is System (cron/operator/cross-feature),
// not the end-user themselves. A caller that IS the end-user (an admin
// editing their own roles) passes `exceptSessionId` to keep that one
// session alive; the event then carries keptSessionId so the SSE streams of
// that session stay open too.
//
// Tenant-scope: the userSession schema persists tenantId per row (a user
// can have sessions in multiple tenants). Omitting `tenantId` revokes
// cross-tenant because "account restriction" is a global user-level
// statement (the forget path is global too, see the User-Entity special
// doc). Passing `tenantId` narrows the UPDATE to that tenant's rows only —
// used by tenant-membership removal, where a multi-tenant user must stay
// logged in to tenants they're still a member of.
export const revokeAllForUserWrite = defineWriteHandler({
  name: "user-session:revoke-all-for-user",
  schema: z.object({
    userId: z.string().min(1),
    tenantId: z.string().min(1).optional(),
    exceptSessionId: z.uuid().optional(),
  }),
  access: { roles: access.privileged },
  description:
    "Irreversibly signs a named user out of all their live sessions, across every tenant unless a tenantId narrows it, optionally sparing one session (exceptSessionId); use it for operator actions such as freezing or banning an account, or a role change that must not end the editor's own session.",
  agent: { risk: "high" },
  escapeHatch: {
    grants: ["unsafeRaw"],
    reason: REVOKE_ALL_SESSIONS_REASON,
  },
  handler: async (event, ctx) => {
    // Raw append() skips the registered-schema check, so eventVersion comes from the registry.
    const eventDef = ctx.registry.getEvent(SESSION_REVOKED_EVENT_QN);
    if (!eventDef) {
      return writeFailure(
        new UnprocessableError("session_revoked_event_not_registered", {
          details: { eventQn: SESSION_REVOKED_EVENT_QN },
        }),
      );
    }
    // SYSTEM stream: the caller's tenant has no relationship to the target user's session tenants.
    const runner = ctx.db.unsafeRawAllTenants();
    const reqCtx = requestContext.get();
    const revokedIds = await revokeSessionsAndAnnounce(runner, {
      where: {
        userId: event.payload.userId,
        ...(event.payload.tenantId !== undefined && { tenantId: event.payload.tenantId }),
        ...(event.payload.exceptSessionId !== undefined && {
          id: { ne: event.payload.exceptSessionId },
        }),
      },
      revokedAt: Temporal.Now.instant(),
      ...(event.payload.exceptSessionId !== undefined && {
        keptSessionId: event.payload.exceptSessionId,
      }),
      eventVersion: eventDef.version,
      metadata: {
        userId: event.user.id,
        ...(reqCtx?.requestId ? { requestId: reqCtx.requestId } : {}),
        ...(reqCtx?.correlationId ? { correlationId: reqCtx.correlationId } : {}),
        ...(reqCtx?.causationId ? { causationId: reqCtx.causationId } : {}),
      },
    });

    return {
      isSuccess: true as const,
      data: { count: revokedIds.length, userId: event.payload.userId },
    };
  },
});
