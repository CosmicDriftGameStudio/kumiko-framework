import { updateMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { access, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { userSessionTable } from "../schema/user-session";

// Mass-revoke ALL live sessions for a target user — privileged-only.
// Used by user-data-rights:restrict-account zur Account-Freeze
// (DSGVO Art. 18) sowie potenziell anderen ops-flows ("ban user",
// "compromised account"). Im Gegensatz zu revoke-all-others wird
// die ggf. aufrufende Session ebenfalls revoked — Caller ist System
// (cron/operator/cross-feature), nicht der Endnutzer selbst.
//
// Tenant-scope: das userSession-Schema persistiert tenantId pro Row
// (User kann mehrere Sessions in mehreren Tenants haben). Wir
// revoken cross-tenant, weil "Account-Restriction" eine globale
// User-Aussage ist (Forget-Pfad ist auch global, sieht User-Entity-
// special-Doc). UPDATE filtert nur auf userId.
export const revokeAllForUserWrite = defineWriteHandler({
  name: "user-session:revoke-all-for-user",
  schema: z.object({
    userId: z.string().min(1),
  }),
  access: { roles: access.privileged },
  handler: async (event, ctx) => {
    const updated = await updateMany(
      ctx.db.raw,
      userSessionTable,
      { revokedAt: Temporal.Now.instant() },
      { userId: event.payload.userId, revokedAt: null },
    );

    return {
      isSuccess: true as const,
      data: { count: updated.length, userId: event.payload.userId },
    };
  },
});
