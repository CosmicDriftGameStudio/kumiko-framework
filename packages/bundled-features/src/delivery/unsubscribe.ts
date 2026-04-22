import type { DbConnection } from "@kumiko/framework/db";
import type { TenantId } from "@kumiko/framework/engine";
import { Hono } from "hono";
import * as jose from "jose";
import { notificationPreferencesTable } from "./tables";

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

    try {
      const { payload } = await jose.jwtVerify(token, encodedSecret, {
        issuer: "kumiko:unsubscribe",
      });

      const userId = String(payload.sub);
      const tenantId = payload["tenantId"] as string;
      const notificationType = payload["notificationType"] as string;
      const channel = payload["channel"] as string;

      // Atomic upsert — two concurrent unsubscribes on the same token raced
      // the prior SELECT+INSERT path into duplicate-key errors.
      await db
        .insert(notificationPreferencesTable)
        .values({
          tenantId,
          userId,
          notificationType,
          channel,
          enabled: false,
        })
        .onConflictDoUpdate({
          target: [
            notificationPreferencesTable.tenantId,
            notificationPreferencesTable.userId,
            notificationPreferencesTable.notificationType,
            notificationPreferencesTable.channel,
          ],
          set: { enabled: false, updatedAt: Temporal.Now.instant() },
        });

      return c.text("You have been unsubscribed.", 200);
    } catch {
      return c.text("Invalid or expired token", 400);
    }
  });

  return app;
}
