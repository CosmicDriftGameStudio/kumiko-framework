import {
  type ExtraRouteDefinition,
  ExtraRouteRejection,
  signatureRoute,
} from "@cosmicdrift/kumiko-framework/api";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import * as jose from "jose";
import * as z from "zod";
import { hashUnsubscribeAddress } from "./address-opt-out";
import { DELIVERY_UNSUBSCRIBE_PATH, DeliveryHandlers } from "./constants";

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

/**
 * `secret` must be a value dedicated to unsubscribe-token signing — do NOT
 * reuse the app's session `JWT_SECRET`. The app mounting `extraRoutes:
 * [createUnsubscribeRoute({ secret })]` signs outgoing links with the same
 * value via `signUnsubscribeToken` / `signAddressUnsubscribeToken`.
 */
export type UnsubscribeRouteOptions = {
  readonly secret: string;
};

const UNSUBSCRIBE_EXPIRY = "7d";
const MIN_UNSUBSCRIBE_SECRET_LENGTH = 32;

function assertUnsubscribeSecret(secret: string, caller: string): void {
  if (secret.length < MIN_UNSUBSCRIBE_SECRET_LENGTH) {
    throw new Error(
      `${caller}: secret must be ≥${MIN_UNSUBSCRIBE_SECRET_LENGTH} chars (HMAC-SHA256 token signing)`,
    );
  }
}

const UNSUBSCRIBE_TOKEN_INVALID_BODY = {
  error: { code: "unsubscribe_token_invalid", message: "Invalid or expired token" },
} as const;

export async function signUnsubscribeToken(
  payload: UnsubscribeTokenPayload,
  secret: string,
): Promise<string> {
  assertUnsubscribeSecret(secret, "signUnsubscribeToken");
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
  assertUnsubscribeSecret(secret, "signAddressUnsubscribeToken");
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

type VerifiedUnsubscribe =
  | {
      readonly kind: "address";
      readonly tenantId: TenantId;
      readonly addressHash: string;
      readonly notificationType: string;
      readonly channel: string;
    }
  | {
      readonly kind: "user";
      readonly tenantId: TenantId;
      readonly userId: string;
      readonly notificationType: string;
      readonly channel: string;
    };

export function createUnsubscribeRoute(options: UnsubscribeRouteOptions): ExtraRouteDefinition {
  assertUnsubscribeSecret(options.secret, "createUnsubscribeRoute");
  const encodedSecret = new TextEncoder().encode(options.secret);

  return signatureRoute<VerifiedUnsubscribe>({
    method: "GET",
    path: DELIVERY_UNSUBSCRIBE_PATH,
    entry: "signature",
    // Every throw here must become the same ExtraRouteRejection(400,
    // unsubscribe_token_invalid) — anything else falls through to the
    // framework's generic 401 extra_route_signature_invalid mapping, which
    // would leak jose's internal error text into the response body.
    verify: async ({ query }) => {
      try {
        const token = query["token"];
        if (!token) {
          throw new ExtraRouteRejection(
            400,
            UNSUBSCRIBE_TOKEN_INVALID_BODY,
            "missing unsubscribe token",
          );
        }

        const { payload: verifiedPayload } = await jose.jwtVerify(token, encodedSecret, {
          issuer: "kumiko:unsubscribe",
        });

        const addressAttempt = addressUnsubscribeJwtPayloadSchema.safeParse(verifiedPayload);
        if (addressAttempt.success) {
          const parsed = addressAttempt.data;
          if (parsed.sub !== parsed.addressHash) {
            throw new ExtraRouteRejection(
              400,
              UNSUBSCRIBE_TOKEN_INVALID_BODY,
              "address token subject mismatch",
            );
          }
          // @cast-boundary engine-bridge — string post-zod → branded TenantId
          const tenantId = parsed.tenantId as TenantId;
          return {
            kind: "address",
            tenantId,
            addressHash: parsed.addressHash,
            notificationType: parsed.notificationType,
            channel: parsed.channel,
          };
        }

        const userAttempt = unsubscribeJwtPayloadSchema.safeParse(verifiedPayload);
        if (!userAttempt.success) {
          throw new ExtraRouteRejection(
            400,
            UNSUBSCRIBE_TOKEN_INVALID_BODY,
            "unsubscribe token payload matched neither schema",
          );
        }
        const parsed = userAttempt.data;
        // @cast-boundary engine-bridge — string post-zod → branded TenantId
        const tenantId = parsed.tenantId as TenantId;
        return {
          kind: "user",
          tenantId,
          userId: parsed.sub,
          notificationType: parsed.notificationType,
          channel: parsed.channel,
        };
      } catch (err) {
        if (err instanceof ExtraRouteRejection) throw err;
        throw new ExtraRouteRejection(
          400,
          UNSUBSCRIBE_TOKEN_INVALID_BODY,
          "unsubscribe token verification failed",
        );
      }
    },
    handler: async (c, verified, deps) => {
      const payload =
        verified.kind === "address"
          ? {
              addressHash: verified.addressHash,
              notificationType: verified.notificationType,
              channel: verified.channel,
            }
          : {
              userId: verified.userId,
              notificationType: verified.notificationType,
              channel: verified.channel,
            };

      // Token-verify passed — everything below is a legitimate write. Don't
      // swallow write-errors as "invalid token", that would mask real bugs
      // (e.g. events-table missing, DB down) behind a misleading 400.
      const dispatched = await deps.dispatchSystemWrite({
        handlerQn:
          verified.kind === "address"
            ? DeliveryHandlers.unsubscribeAddress
            : DeliveryHandlers.unsubscribeUser,
        tenantId: verified.tenantId,
        payload,
      });
      if (!dispatched.isSuccess) {
        return c.text("Unsubscribe failed", 500);
      }
      return c.text("You have been unsubscribed.", 200);
    },
  });
}
