import { createTenantDb, type DbConnection } from "@kumiko/framework/db";
import type { TenantId } from "@kumiko/framework/engine";
import { Hono } from "hono";
import * as jose from "jose";
import { upsertPreference } from "./upsert-preference";

export type UnsubscribeTokenPayload = {
  readonly userId: string;
  readonly tenantId: TenantId;
  readonly notificationType: string;
  readonly channel: string;
};

export type UnsubscribeRouteOptions = {
  readonly db: DbConnection;
  readonly jwtSecret: string;
};

const UNSUBSCRIBE_EXPIRY = "7d";
// The route runs outside the dispatcher — no SessionUser, no JWT middleware.
// Bill the event against the token-subject (the user owns their preference)
// and attribute it as a system-role action. This mirrors the way jobs and
// seeds attribute their out-of-band writes.
const SYSTEM_ROLES = ["system"] as const;

export async function signUnsubscribeToken(
  payload: UnsubscribeTokenPayload,
  secret: string,
): Promise<string> {
  const encodedSecret = new TextEncoder().encode(secret);
  return new jose.SignJWT({
    tenantId: payload.tenantId,
    notificationType: payload.notificationType,
    channel: payload.channel,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(payload.userId))
    .setIssuer("kumiko:unsubscribe")
    .setIssuedAt()
    .setExpirationTime(UNSUBSCRIBE_EXPIRY)
    .sign(encodedSecret);
}

export function createUnsubscribeRoute(options: UnsubscribeRouteOptions): Hono {
  const { db, jwtSecret } = options;
  const encodedSecret = new TextEncoder().encode(jwtSecret);
  const app = new Hono();

  app.get("/unsubscribe", async (c) => {
    const token = c.req.query("token");
    if (!token) {
      return c.text("Missing token", 400);
    }

    let userId: string;
    let tenantId: TenantId;
    let notificationType: string;
    let channel: string;
    try {
      const { payload } = await jose.jwtVerify(token, encodedSecret, {
        issuer: "kumiko:unsubscribe",
      });
      userId = String(payload.sub);
      tenantId = payload["tenantId"] as TenantId;
      notificationType = payload["notificationType"] as string;
      channel = payload["channel"] as string;
    } catch {
      return c.text("Invalid or expired token", 400);
    }

    // Token-verify passed — everything below is a legitimate write. Don't
    // swallow write-errors as "invalid token", that would mask real bugs
    // (e.g. events-table missing, DB down) behind a misleading 400.
    const actor = { id: userId, tenantId, roles: SYSTEM_ROLES };
    const tdb = createTenantDb(db, tenantId, "system");
    await upsertPreference(tdb, actor, {
      tenantId,
      userId,
      notificationType,
      channel,
      enabled: false,
    });
    return c.text("You have been unsubscribed.", 200);
  });

  return app;
}
