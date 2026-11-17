import { ExtraRouteRejection } from "@cosmicdrift/kumiko-framework/api";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import * as jose from "jose";
import * as z from "zod";
import { hashUnsubscribeAddress } from "./address-opt-out.ts";

// The mail's locale, so the pages behind the link speak the mail's language. Optional: links
// signed before the claim existed keep verifying and fall back to English.
export const localeClaimSchema = z
  .string()
  .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/)
  .optional();

// Shape of verified JWT payloads. `tenantId` arrives from jose as a string and
// becomes a branded `TenantId` only after successful `parse()`—never via a blind cast.
//
// `kind` is explicitly typed as "absent or undefined, nothing else" here
// (not bare `.optional()`, which would also accept any other value on an
// unrelated key) so an address-token payload—which always carries
// `kind: "address"`—fails this schema instead of silently parsing with
// `addressHash` mistaken for a userId.
const unsubscribeJwtPayloadSchema = z.object({
  kind: z.undefined().optional(),
  sub: z.string().min(1),
  tenantId: z.string().min(1),
  notificationType: z.string().min(1),
  channel: z.string().min(1),
  locale: localeClaimSchema,
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
  locale: localeClaimSchema,
});

export type UnsubscribeTokenPayload = {
  readonly userId: string;
  readonly tenantId: TenantId;
  readonly notificationType: string;
  readonly channel: string;
  readonly locale?: string | undefined;
};

export type AddressUnsubscribeTokenPayload = {
  readonly tenantId: TenantId;
  readonly address: string;
  readonly notificationType: string;
  readonly channel: string;
  readonly locale?: string | undefined;
};

/**
 * `secret` must be a value dedicated to unsubscribe-token signing — do NOT
 * reuse the app's session `JWT_SECRET`. The app mounting `extraRoutes:
 * [...createUnsubscribeRoutes({ secret })]` signs outgoing links with the
 * same value via `signUnsubscribeToken` / `signAddressUnsubscribeToken`.
 */
export type UnsubscribeRouteOptions = {
  readonly secret: string;
};

const RESUBSCRIBE_EXPIRY = "1h";
const UNSUBSCRIBE_ISSUER = "kumiko:unsubscribe";
const RESUBSCRIBE_AUDIENCE = "kumiko:resubscribe";

export type TokenPurpose = "unsubscribe" | "resubscribe";
const MIN_UNSUBSCRIBE_SECRET_LENGTH = 32;

export function assertUnsubscribeSecret(secret: string, caller: string): void {
  if (secret.length < MIN_UNSUBSCRIBE_SECRET_LENGTH) {
    throw new Error(
      `${caller}: secret must be ≥${MIN_UNSUBSCRIBE_SECRET_LENGTH} chars (HMAC-SHA256 token signing)`,
    );
  }
}

// An unusable locale is left out instead of failing the send; the pages then fall back to English.
function localeClaim(locale: string | undefined): { locale?: string } {
  return locale !== undefined && localeClaimSchema.safeParse(locale).success ? { locale } : {};
}

const UNSUBSCRIBE_TOKEN_INVALID_BODY = {
  error: { code: "unsubscribe_token_invalid", message: "Invalid or expired token" },
} as const;

// jose checks the signature and the issuer before the expiry, so the claims of an
// expired token are authentic: enough to dress the "link expired" page in the
// tenant's look and language, never enough to write.
const expiredTokenScopeSchema = z.object({
  iss: z.literal(UNSUBSCRIBE_ISSUER),
  tenantId: z.string().min(1),
  locale: localeClaimSchema,
});

export class ExpiredUnsubscribeTokenRejection extends ExtraRouteRejection {
  constructor(
    readonly tenantId: TenantId,
    readonly locale: string | undefined,
  ) {
    super(400, UNSUBSCRIBE_TOKEN_INVALID_BODY, "unsubscribe token expired");
  }
}

function expiredTokenRejection(err: unknown): ExpiredUnsubscribeTokenRejection | null {
  if (!(err instanceof jose.errors.JWTExpired)) return null;
  const scope = expiredTokenScopeSchema.safeParse(err.payload);
  if (!scope.success) return null;
  // @cast-boundary engine-bridge — string post-zod → branded TenantId
  return new ExpiredUnsubscribeTokenRejection(scope.data.tenantId as TenantId, scope.data.locale);
}

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
    ...localeClaim(payload.locale),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(payload.userId))
    .setIssuer(UNSUBSCRIBE_ISSUER)
    .setIssuedAt()
    // Only opt-out, so no expiry: List-Unsubscribe links in older mails must keep working.
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
      ...localeClaim(payload.locale),
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(addressHash)
      .setIssuer(UNSUBSCRIBE_ISSUER)
      .setIssuedAt()
      // Only opt-out, so no expiry: a link mailed out today must keep working,
      // there's no signed-in flow for a no-account address to request a fresh one.
      .sign(encodedSecret)
  );
}

export type VerifiedUnsubscribe =
  | {
      readonly kind: "address";
      readonly tenantId: TenantId;
      readonly addressHash: string;
      readonly notificationType: string;
      readonly channel: string;
      readonly locale: string | undefined;
    }
  | {
      readonly kind: "user";
      readonly tenantId: TenantId;
      readonly userId: string;
      readonly notificationType: string;
      readonly channel: string;
      readonly locale: string | undefined;
    };

// RFC 8058 fixed value — both the List-Unsubscribe-Post header and the body a
// one-click client POSTs.
export const DELIVERY_UNSUBSCRIBE_ONE_CLICK_HEADER_VALUE = "List-Unsubscribe=One-Click" as const;

// Undo token, handed out only in the response of a successful unsubscribe. A
// separate audience and a short expiry keep the long-lived mailed unsubscribe
// link from being able to undo an opt-out (and vice versa).
export async function signResubscribeToken(
  verified: VerifiedUnsubscribe,
  encodedSecret: Uint8Array,
): Promise<string> {
  const claims = {
    tenantId: verified.tenantId,
    notificationType: verified.notificationType,
    channel: verified.channel,
    ...localeClaim(verified.locale),
  };
  const jwt =
    verified.kind === "address"
      ? new jose.SignJWT({
          ...claims,
          addressHash: verified.addressHash,
          kind: "address",
        }).setSubject(verified.addressHash)
      : new jose.SignJWT(claims).setSubject(verified.userId);
  return jwt
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(UNSUBSCRIBE_ISSUER)
    .setAudience(RESUBSCRIBE_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(RESUBSCRIBE_EXPIRY)
    .sign(encodedSecret);
}

// Every throw here must become the same ExtraRouteRejection(400,
// unsubscribe_token_invalid) — anything else falls through to the
// framework's generic 401 extra_route_signature_invalid mapping, which
// would leak jose's internal error text into the response body.
export async function verifyUnsubscribeToken(
  token: string | undefined,
  encodedSecret: Uint8Array,
  purpose: TokenPurpose,
): Promise<VerifiedUnsubscribe> {
  try {
    if (!token) {
      throw new ExtraRouteRejection(
        400,
        UNSUBSCRIBE_TOKEN_INVALID_BODY,
        "missing unsubscribe token",
      );
    }

    const { payload: verifiedPayload } =
      purpose === "resubscribe"
        ? await jose.jwtVerify(token, encodedSecret, {
            issuer: UNSUBSCRIBE_ISSUER,
            audience: RESUBSCRIBE_AUDIENCE,
            requiredClaims: ["exp"],
            algorithms: ["HS256"],
          })
        : await jose.jwtVerify(token, encodedSecret, {
            issuer: UNSUBSCRIBE_ISSUER,
            algorithms: ["HS256"],
          });
    // jose only checks `aud` when asked to, so an unsubscribe route would accept an undo token.
    if (purpose === "unsubscribe" && verifiedPayload.aud !== undefined) {
      throw new ExtraRouteRejection(
        400,
        UNSUBSCRIBE_TOKEN_INVALID_BODY,
        "resubscribe token used as unsubscribe token",
      );
    }

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
        locale: parsed.locale,
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
      locale: parsed.locale,
    };
  } catch (err) {
    if (err instanceof ExtraRouteRejection) throw err;
    throw (
      expiredTokenRejection(err) ??
      new ExtraRouteRejection(
        400,
        UNSUBSCRIBE_TOKEN_INVALID_BODY,
        "unsubscribe token verification failed",
      )
    );
  }
}
