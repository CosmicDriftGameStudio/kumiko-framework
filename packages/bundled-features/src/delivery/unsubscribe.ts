import { createTenantDb, type DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { Hono } from "hono";
import * as jose from "jose";
import * as z from "zod";
import { hashUnsubscribeAddress, upsertAddressOptOut } from "./address-opt-out";
import { upsertPreference } from "./upsert-preference";

// Shape des verified-JWT-payloads. tenantId kommt als string aus jose und
// wird NACH erfolgreichem parse() zur Branded TenantId — kein blind-cast.
//
// `kind` is explicitly typed as "absent or undefined, nothing else" here
// (not bare `.optional()`, which would also accept any other value on an
// unrelated key) so an address-token payload — which always carries
// `kind: "address"` — fails this schema instead of silently parsing with
// `addressHash` mistaken for a userId.
const unsubscribeJwtPayloadSchema = z.object({
  kind: z.undefined().optional(),
  sub: z.string().min(1),
  tenantId: z.string().min(1),
  notificationType: z.string().min(1),
  channel: z.string().min(1),
});

// Address-token payload. `sub` and `addressHash` are the same value (the
// subject claim IS the blind-index hash) — kept as two fields because the
// subject claim is jose's own mechanism while `addressHash` is what the
// route actually writes; the handler cross-checks them below.
const addressUnsubscribeJwtPayloadSchema = z.object({
  kind: z.literal("address"),
  sub: z.string().min(1),
  tenantId: z.string().min(1),
  notificationType: z.string().min(1),
  channel: z.string().min(1),
  addressHash: z.string().min(1),
});

export type UnsubscribeTokenPayload = {
  readonly userId: string;
  readonly tenantId: TenantId;
  readonly notificationType: string;
  readonly channel: string;
};

export type AddressUnsubscribeTokenPayload = {
  readonly tenantId: TenantId;
  readonly address: string;
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

/**
 * Signs an unsubscribe link for a recipient ADDRESS with no user account
 * (direct sends via `ctx.notify(type, { route: { email } })`). Throws when
 * no blind-index key is configured — fail closed, since without a key the
 * opt-out row this token later writes could never be matched against a
 * future send (the hash wouldn't be reproducible).
 */
export async function signAddressUnsubscribeToken(
  payload: AddressUnsubscribeTokenPayload,
  secret: string,
): Promise<string> {
  const addressHash = hashUnsubscribeAddress(payload.address);
  if (addressHash === undefined) {
    throw new Error(
      "signAddressUnsubscribeToken requires a configured blind-index key (configureBlindIndexKey)",
    );
  }
  const encodedSecret = new TextEncoder().encode(secret);
  return (
    new jose.SignJWT({
      tenantId: payload.tenantId,
      notificationType: payload.notificationType,
      channel: payload.channel,
      addressHash,
      kind: "address",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(addressHash)
      .setIssuer("kumiko:unsubscribe")
      .setIssuedAt()
      // No expiry, unlike the user token above: a leaked address token can
      // only opt that one address out of one notificationType/channel, and
      // an unsubscribe link mailed out today must keep working indefinitely
      // — there is no signed-in flow for a no-account address to re-subscribe
      // or request a fresh link from.
      .sign(encodedSecret)
  );
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

    let verifiedPayload: jose.JWTPayload;
    try {
      ({ payload: verifiedPayload } = await jose.jwtVerify(token, encodedSecret, {
        issuer: "kumiko:unsubscribe",
      }));
    } catch {
      return c.text("Invalid or expired token", 400);
    }

    const addressAttempt = addressUnsubscribeJwtPayloadSchema.safeParse(verifiedPayload);
    if (addressAttempt.success) {
      const parsed = addressAttempt.data;
      if (parsed.sub !== parsed.addressHash) {
        return c.text("Invalid or expired token", 400);
      }
      // @cast-boundary engine-bridge — string post-zod → branded TenantId
      const tenantId = parsed.tenantId as TenantId;
      const actor = { id: parsed.addressHash, tenantId, roles: SYSTEM_ROLES };
      const tdb = createTenantDb(db, tenantId, "system");
      await upsertAddressOptOut(tdb, actor, {
        tenantId,
        addressHash: parsed.addressHash,
        notificationType: parsed.notificationType,
        channel: parsed.channel,
      });
      return c.text("You have been unsubscribed.", 200);
    }

    const userAttempt = unsubscribeJwtPayloadSchema.safeParse(verifiedPayload);
    if (!userAttempt.success) {
      return c.text("Invalid or expired token", 400);
    }
    const parsed = userAttempt.data;
    // @cast-boundary engine-bridge — string post-zod → branded TenantId
    const tenantId = parsed.tenantId as TenantId;

    // Token-verify passed — everything below is a legitimate write. Don't
    // swallow write-errors as "invalid token", that would mask real bugs
    // (e.g. events-table missing, DB down) behind a misleading 400.
    const actor = { id: parsed.sub, tenantId, roles: SYSTEM_ROLES };
    const tdb = createTenantDb(db, tenantId, "system");
    await upsertPreference(tdb, actor, {
      tenantId,
      userId: parsed.sub,
      notificationType: parsed.notificationType,
      channel: parsed.channel,
      enabled: false,
    });
    return c.text("You have been unsubscribed.", 200);
  });

  return app;
}
