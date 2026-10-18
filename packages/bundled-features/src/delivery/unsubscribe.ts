import {
  type ExtraRouteDefinition,
  ExtraRouteRejection,
  type SignatureExtraRouteDeps,
  type SignatureExtraRouteVerifyRequest,
  signatureRoute,
} from "@cosmicdrift/kumiko-framework/api";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { resolveMailLocale } from "@cosmicdrift/kumiko-framework/i18n";
import { createFallbackLogger } from "@cosmicdrift/kumiko-framework/logging";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import type { Context } from "hono";
import * as jose from "jose";
import * as z from "zod";
import type { MailChrome } from "../renderer-foundation/index.js";
import { hashUnsubscribeAddress } from "./address-opt-out.js";
import {
  DELIVERY_RESUBSCRIBE_PATH,
  DELIVERY_UNSUBSCRIBE_PATH,
  DeliveryErrors,
  DeliveryHandlers,
  DeliveryQueries,
} from "./constants.js";
import { renderUnsubscribePage, type UnsubscribePageState } from "./unsubscribe-page.js";

// The mail's locale, so the pages behind the link speak the mail's language. Optional: links
// signed before the claim existed keep verifying and fall back to English.
const localeClaimSchema = z
  .string()
  .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/)
  .optional();

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

class ExpiredUnsubscribeTokenRejection extends ExtraRouteRejection {
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

type VerifiedUnsubscribe =
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
async function signResubscribeToken(
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

function pageLocale(locale: string | undefined): string {
  return resolveMailLocale(locale ?? "en");
}

export type UnsubscribeResultPage =
  // Without a resubscribeToken the page offers no undo button.
  | { readonly kind: "unsubscribed"; readonly resubscribeToken?: string }
  | { readonly kind: "resubscribed" }
  | { readonly kind: "failed" }
  | { readonly kind: "invalid" };

/** The result page the unsubscribe routes answer with, for apps serving their own
 *  (e.g. legacy) unsubscribe links. Texts come from the mail translations of `locale`;
 *  `chrome` (the mail renderer's readMailChrome) adds the tenant's brand row and footer.
 *  Served under runProdApp's default CSP the style block and the same-origin font pass;
 *  an https logo additionally needs its origin, e.g.
 *  `securityHeaders: { csp: { extend: { "img-src": [logoOrigin] } } }`. A hand-written CSP
 *  needs `style-src 'unsafe-inline'` as well. */
export function renderUnsubscribeResultPage(
  page: UnsubscribeResultPage & {
    readonly locale?: string | undefined;
    readonly chrome?: MailChrome | null | undefined;
  },
): string {
  const { locale, chrome, ...state } = page;
  return renderUnsubscribePage({ state, locale: pageLocale(locale), chrome }).html;
}

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

const mailChromeLinkSchema = z.object({ label: z.string(), url: z.string() });
const mailChromeSchema = z
  .object({
    tenantName: z.string(),
    brandSuffix: z.string(),
    logoUrl: z.string().optional(),
    accentColor: z.string().optional(),
    siteUrl: z.string().optional(),
    footerText: z.string().optional(),
    imprint: mailChromeLinkSchema.optional(),
    privacy: mailChromeLinkSchema.optional(),
  })
  .nullable();

// Branding is decoration: an opt-out that went through must never turn into an
// error page because a footer resolver or the config read failed.
async function readPageChrome(
  deps: SignatureExtraRouteDeps,
  tenantId: TenantId,
  locale: string,
): Promise<MailChrome | null> {
  try {
    const result = await deps.dispatchSystemQuery({
      handlerQn: DeliveryQueries.unsubscribePageChrome,
      payload: { locale },
      tenantId,
    });
    const parsed = mailChromeSchema.safeParse(result);
    return parsed.success ? parsed.data : null;
  } catch (err) {
    createFallbackLogger("delivery").warn("unsubscribe page shown without tenant branding", {
      errorName: err instanceof Error ? err.name : typeof err,
    });
    return null;
  }
}

type PageScope = { readonly tenantId: TenantId | undefined; readonly locale: string | undefined };

// no-referrer on every page: the GET page carries the token in its URL, and the
// tenant logo and site link would otherwise receive it in the Referer header.
const PAGE_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
} as const;

async function pageResponse(
  // biome-ignore lint/suspicious/noExplicitAny: Hono context generics are invisible at the framework boundary
  c: Context<any, any>,
  deps: SignatureExtraRouteDeps,
  state: UnsubscribePageState,
  scope: PageScope,
  status: 200 | 400 | 409 | 500,
): Promise<Response> {
  const locale = pageLocale(scope.locale);
  const chrome =
    scope.tenantId === undefined ? null : await readPageChrome(deps, scope.tenantId, locale);
  const page = renderUnsubscribePage({ state, locale, chrome });
  return c.html(page.html, status, {
    ...PAGE_HEADERS,
    "Content-Security-Policy": page.contentSecurityPolicy,
  });
}

type RejectedForPage = { readonly kind: "rejected" } & PageScope;

function localeFromAcceptLanguage(header: string | undefined): string | undefined {
  const first = header?.split(",")[0]?.split(";")[0]?.trim();
  return first !== undefined && first !== "" && localeClaimSchema.safeParse(first).success
    ? first
    : undefined;
}

// A browser lands on a page even for a dead link; API callers keep the JSON 400 from
// verifyUnsubscribeToken. The rejected result never reaches a write.
async function verifyForPage(
  token: string | undefined,
  encodedSecret: Uint8Array,
  purpose: TokenPurpose,
  headers: SignatureExtraRouteVerifyRequest["headers"],
): Promise<VerifiedUnsubscribe | RejectedForPage> {
  try {
    return await verifyUnsubscribeToken(token, encodedSecret, purpose);
  } catch (err) {
    if (err instanceof ExpiredUnsubscribeTokenRejection) {
      return {
        kind: "rejected",
        tenantId: err.tenantId,
        locale: err.locale ?? localeFromAcceptLanguage(headers["accept-language"]),
      };
    }
    if (err instanceof ExtraRouteRejection) {
      return {
        kind: "rejected",
        tenantId: undefined,
        locale: localeFromAcceptLanguage(headers["accept-language"]),
      };
    }
    throw err;
  }
}

async function verifyPost(
  request: SignatureExtraRouteVerifyRequest,
  token: string | undefined,
  encodedSecret: Uint8Array,
  purpose: TokenPurpose,
): Promise<VerifiedUnsubscribe | RejectedForPage> {
  return isFormRequest(request.headers["content-type"])
    ? verifyForPage(token, encodedSecret, purpose, request.headers)
    : verifyUnsubscribeToken(token, encodedSecret, purpose);
}

function isFormRequest(contentType: string | undefined): boolean {
  return contentType?.includes("application/x-www-form-urlencoded") === true;
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
      const parsed: unknown = JSON.parse(request.rawBody);
      return isPlainObject(parsed) && typeof parsed["token"] === "string"
        ? parsed["token"]
        : undefined;
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

  const confirmRoute = signatureRoute<
    ({ readonly kind: "confirm"; readonly token: string } & PageScope) | RejectedForPage
  >({
    method: "GET",
    path: DELIVERY_UNSUBSCRIBE_PATH,
    entry: "signature",
    verify: async ({ query, headers }) => {
      const token = query["token"];
      const verified = await verifyForPage(token, encodedSecret, "unsubscribe", headers);
      if (verified.kind === "rejected") return verified;
      // verifyForPage only accepts a present token, the check is for the type.
      if (token === undefined) return { kind: "rejected", tenantId: undefined, locale: undefined };
      return { kind: "confirm", token, tenantId: verified.tenantId, locale: verified.locale };
    },
    handler: async (c, verified, deps) =>
      verified.kind === "rejected"
        ? pageResponse(c, deps, { kind: "invalid" }, verified, 400)
        : pageResponse(c, deps, { kind: "confirm", token: verified.token }, verified, 200),
  });

  const writeRoute = signatureRoute<VerifiedUnsubscribe | RejectedForPage>({
    method: "POST",
    path: DELIVERY_UNSUBSCRIBE_PATH,
    entry: "signature",
    verify: async (request) =>
      verifyPost(request, tokenFromPostRequest(request), encodedSecret, "unsubscribe"),
    handler: async (c, verified, deps) => {
      if (verified.kind === "rejected") {
        return pageResponse(c, deps, { kind: "invalid" }, verified, 400);
      }
      // Token-verify passed — everything below is a legitimate write. Don't
      // swallow write-errors as "invalid token", that would mask real bugs
      // (e.g. events-table missing, DB down) behind a misleading 400.
      const succeeded = await dispatchUnsubscribeWrite(verified, deps);
      if (!succeeded) {
        return pageResponse(c, deps, { kind: "failed" }, verified, 500);
      }
      return pageResponse(
        c,
        deps,
        {
          kind: "unsubscribed",
          resubscribeToken: await signResubscribeToken(verified, encodedSecret),
        },
        verified,
        200,
      );
    },
  });

  // Undo direction: token only from the JSON/form body, never the query
  // (see tokenFromRequestBody) — no GET confirmation-page variant,
  // this is a one-shot POST from the unsubscribe-page's "Undo" button.
  const resubscribeRoute = signatureRoute<VerifiedUnsubscribe | RejectedForPage>({
    method: "POST",
    path: DELIVERY_RESUBSCRIBE_PATH,
    entry: "signature",
    verify: async (request) =>
      verifyPost(request, tokenFromRequestBody(request), encodedSecret, "resubscribe"),
    handler: async (c, verified, deps) => {
      if (verified.kind === "rejected") {
        return pageResponse(c, deps, { kind: "invalid" }, verified, 400);
      }
      const outcome = await dispatchResubscribeWrite(verified, deps);
      // The undo button on the unsubscribed page posts a form; a browser should land on a page.
      if (isFormRequest(c.req.header("content-type"))) {
        return outcome === "success"
          ? pageResponse(c, deps, { kind: "resubscribed" }, verified, 200)
          : pageResponse(
              c,
              deps,
              { kind: "failed" },
              verified,
              outcome === "limit_reached" ? 409 : 500,
            );
      }
      if (outcome === "limit_reached") {
        return c.json(
          { error: { code: DeliveryErrors.resubscribeLimitReached } },
          409,
          NO_STORE_HEADERS,
        );
      }
      if (outcome === "failed") {
        return c.json({ error: { code: "resubscribe_failed" } }, 500, NO_STORE_HEADERS);
      }
      return c.json({ isSuccess: true }, 200, NO_STORE_HEADERS);
    },
  });

  return [confirmRoute, writeRoute, resubscribeRoute];
}
