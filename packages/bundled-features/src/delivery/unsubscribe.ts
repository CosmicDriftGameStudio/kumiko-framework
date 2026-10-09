import {
  type ExtraRouteDefinition,
  ExtraRouteRejection,
  type SignatureExtraRouteDeps,
  type SignatureExtraRouteVerifyRequest,
  signatureRoute,
} from "@cosmicdrift/kumiko-framework/api";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { escapeHtmlAttr } from "@cosmicdrift/kumiko-headless";
import * as jose from "jose";
import * as z from "zod";
import { hashUnsubscribeAddress } from "./address-opt-out.js";
import {
  DELIVERY_RESUBSCRIBE_PATH,
  DELIVERY_UNSUBSCRIBE_PATH,
  DeliveryErrors,
  DeliveryHandlers,
} from "./constants.js";

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
 * [...createUnsubscribeRoutes({ secret })]` signs outgoing links with the
 * same value via `signUnsubscribeToken` / `signAddressUnsubscribeToken`.
 */
export type UnsubscribeRouteOptions = {
  readonly secret: string;
};

const UNSUBSCRIBE_EXPIRY = "7d";
const RESUBSCRIBE_EXPIRY = "1h";
const UNSUBSCRIBE_ISSUER = "kumiko:unsubscribe";
const RESUBSCRIBE_AUDIENCE = "kumiko:resubscribe";

type TokenPurpose = "unsubscribe" | "resubscribe";
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
    .setIssuer(UNSUBSCRIBE_ISSUER)
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
      .setIssuer(UNSUBSCRIBE_ISSUER)
      .setIssuedAt()
      // Only opt-out, so no expiry: a link mailed out today must keep working,
      // there's no signed-in flow for a no-account address to request a fresh one.
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

// RFC 8058 fixed value — both the List-Unsubscribe-Post header and the body a
// one-click client POSTs.
export const DELIVERY_UNSUBSCRIBE_ONE_CLICK_HEADER_VALUE = "List-Unsubscribe=One-Click" as const;

const CONFIRMATION_PAGE_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
} as const;

// Undo token, handed out only in the response of a successful unsubscribe. A
// separate audience and a short expiry keep the long-lived mailed unsubscribe
// link from being able to undo an opt-out (and vice versa).
async function signResubscribeToken(
  verified: VerifiedUnsubscribe,
  encodedSecret: Uint8Array,
): Promise<string> {
  const claims = {
    tenantId: verified.tenantId,
    notificationType: verified.notificationType,
    channel: verified.channel,
  };
  const jwt =
    verified.kind === "address"
      ? new jose.SignJWT({ ...claims, addressHash: verified.addressHash, kind: "address" }).setSubject(
          verified.addressHash,
        )
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
async function verifyUnsubscribeToken(
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
          })
        : await jose.jwtVerify(token, encodedSecret, { issuer: UNSUBSCRIBE_ISSUER });
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
}

async function dispatchUnsubscribeWrite(
  verified: VerifiedUnsubscribe,
  deps: SignatureExtraRouteDeps,
): Promise<boolean> {
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

  const dispatched = await deps.dispatchSystemWrite({
    handlerQn:
      verified.kind === "address"
        ? DeliveryHandlers.unsubscribeAddress
        : DeliveryHandlers.unsubscribeUser,
    tenantId: verified.tenantId,
    payload,
  });
  return dispatched.isSuccess;
}

// "limit_reached" is a distinct outcome, not a generic failure: it's the
// address-side generation cap (removeAddressOptOut) refusing to delete the
// opt-out row so unsubscribe always still works — the route answers 409,
// not the 500 a real write failure gets.
type ResubscribeOutcome = "success" | "limit_reached" | "failed";

function isResubscribeLimitReached(error: { readonly details?: unknown }): boolean {
  const details = error.details;
  return (
    typeof details === "object" &&
    details !== null &&
    "reason" in details &&
    details.reason === DeliveryErrors.resubscribeLimitReached
  );
}

async function dispatchResubscribeWrite(
  verified: VerifiedUnsubscribe,
  deps: SignatureExtraRouteDeps,
): Promise<ResubscribeOutcome> {
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

  const dispatched = await deps.dispatchSystemWrite({
    handlerQn:
      verified.kind === "address"
        ? DeliveryHandlers.resubscribeAddress
        : DeliveryHandlers.resubscribeUser,
    tenantId: verified.tenantId,
    payload,
  });
  if (dispatched.isSuccess) return "success";
  return isResubscribeLimitReached(dispatched.error) ? "limit_reached" : "failed";
}

function confirmationPage(token: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex">
<title>Unsubscribe</title>
</head>
<body>
<p>Unsubscribe from these emails?</p>
<form method="post" action="${DELIVERY_UNSUBSCRIBE_PATH}">
<input type="hidden" name="token" value="${escapeHtmlAttr(token)}">
<button type="submit">Unsubscribe</button>
</form>
</body>
</html>`;
}

function unsubscribedPage(resubscribeToken: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex">
<title>Unsubscribed</title>
</head>
<body>
<p>You have been unsubscribed.</p>
<form method="post" action="${DELIVERY_RESUBSCRIBE_PATH}">
<input type="hidden" name="token" value="${escapeHtmlAttr(resubscribeToken)}">
<button type="submit">Undo</button>
</form>
</body>
</html>`;
}

// One-click clients put the token in the query string; only the
// confirmation-page form submits it in the body.
function tokenFromPostRequest(request: SignatureExtraRouteVerifyRequest): string | undefined {
  return tokenFromRequestBody(request) ?? request.query["token"];
}

// Resubscribe is deliberately NOT reachable via the query string — a mail
// client's link prefetcher (or a scanner) following an unsubscribe link
// eagerly is the exact threat model unsubscribe's one-click POST body
// convention is built to avoid; resubscribe carries the same risk in
// reverse (a prefetch that undoes a real opt-out) and gets no query-param
// fallback at all.
function tokenFromRequestBody(request: SignatureExtraRouteVerifyRequest): string | undefined {
  const contentType = request.headers["content-type"];
  if (contentType?.includes("application/x-www-form-urlencoded")) {
    return new URLSearchParams(request.rawBody).get("token") || undefined;
  }
  if (contentType?.includes("application/json")) {
    try {
      const parsed = JSON.parse(request.rawBody) as { token?: unknown };
      return typeof parsed.token === "string" ? parsed.token : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

// GET renders a confirmation page without writing; POST performs the opt-out.
export function createUnsubscribeRoutes(
  options: UnsubscribeRouteOptions,
): readonly ExtraRouteDefinition[] {
  assertUnsubscribeSecret(options.secret, "createUnsubscribeRoutes");
  const encodedSecret = new TextEncoder().encode(options.secret);

  const confirmRoute = signatureRoute<{ token: string }>({
    method: "GET",
    path: DELIVERY_UNSUBSCRIBE_PATH,
    entry: "signature",
    verify: async ({ query }) => {
      const token = query["token"];
      if (!token) {
        throw new ExtraRouteRejection(
          400,
          UNSUBSCRIBE_TOKEN_INVALID_BODY,
          "missing unsubscribe token",
        );
      }
      await verifyUnsubscribeToken(token, encodedSecret, "unsubscribe");
      return { token };
    },
    handler: async (c, { token }) =>
      c.html(confirmationPage(token), 200, CONFIRMATION_PAGE_HEADERS),
  });

  const writeRoute = signatureRoute<VerifiedUnsubscribe>({
    method: "POST",
    path: DELIVERY_UNSUBSCRIBE_PATH,
    entry: "signature",
    verify: async (request) =>
      verifyUnsubscribeToken(tokenFromPostRequest(request), encodedSecret, "unsubscribe"),
    handler: async (c, verified, deps) => {
      // Token-verify passed — everything below is a legitimate write. Don't
      // swallow write-errors as "invalid token", that would mask real bugs
      // (e.g. events-table missing, DB down) behind a misleading 400.
      const succeeded = await dispatchUnsubscribeWrite(verified, deps);
      if (!succeeded) {
        return c.html("Unsubscribe failed", 500, { "Cache-Control": "no-store" });
      }
      return c.html(unsubscribedPage(await signResubscribeToken(verified, encodedSecret)), 200, {
        "Cache-Control": "no-store",
      });
    },
  });

  // Undo direction: token only from the JSON/form body, never the query
  // (see tokenFromRequestBody) — no GET confirmation-page variant,
  // this is a one-shot POST from the unsubscribe-page's "Undo" button.
  const resubscribeRoute = signatureRoute<VerifiedUnsubscribe>({
    method: "POST",
    path: DELIVERY_RESUBSCRIBE_PATH,
    entry: "signature",
    verify: async (request) =>
      verifyUnsubscribeToken(tokenFromRequestBody(request), encodedSecret, "resubscribe"),
    handler: async (c, verified, deps) => {
      const outcome = await dispatchResubscribeWrite(verified, deps);
      if (outcome === "limit_reached") {
        return c.json({ error: { code: DeliveryErrors.resubscribeLimitReached } }, 409, {
          "Cache-Control": "no-store",
        });
      }
      if (outcome === "failed") {
        return c.json({ error: { code: "resubscribe_failed" } }, 500, {
          "Cache-Control": "no-store",
        });
      }
      return c.json({ isSuccess: true }, 200, { "Cache-Control": "no-store" });
    },
  });

  return [confirmRoute, writeRoute, resubscribeRoute];
}
