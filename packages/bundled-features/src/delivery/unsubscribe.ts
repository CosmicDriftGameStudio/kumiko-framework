import {
  type ExtraRouteDefinition,
  ExtraRouteRejection,
  type SignatureExtraRouteDeps,
  type SignatureExtraRouteVerifyRequest,
  type SystemDispatchArgs,
  signatureRoute,
} from "@cosmicdrift/kumiko-framework/api";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { resolveMailLocale } from "@cosmicdrift/kumiko-framework/i18n";
import { createFallbackLogger } from "@cosmicdrift/kumiko-framework/logging";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import type { Context } from "hono";
import * as z from "zod";
import type { MailChrome } from "../renderer-foundation/index.ts";
import {
  DELIVERY_RESUBSCRIBE_PATH,
  DELIVERY_UNSUBSCRIBE_PATH,
  DeliveryErrors,
  DeliveryHandlers,
  DeliveryQueries,
} from "./constants.ts";
import { renderUnsubscribePage, type UnsubscribePageState } from "./unsubscribe-page.ts";
import {
  assertUnsubscribeSecret,
  DELIVERY_UNSUBSCRIBE_ONE_CLICK_HEADER_VALUE,
  ExpiredUnsubscribeTokenRejection,
  localeClaimSchema,
  signResubscribeToken,
  type TokenPurpose,
  type UnsubscribeRouteOptions,
  type VerifiedUnsubscribe,
  verifyUnsubscribeToken,
} from "./unsubscribe-tokens.ts";

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
 *  `chrome` adds the tenant's brand row and footer: read it with
 *  createUnsubscribePageChromeReader for a tenant the server resolved itself (e.g. by
 *  Host), never for a tenantId taken from the query string or body.
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

type SystemQueryDispatch = {
  readonly dispatchSystemQuery: (args: SystemDispatchArgs) => Promise<unknown>;
};

// Branding is decoration: an opt-out that went through must never turn into an
// error page because a footer resolver or the config read failed.
async function readPageChrome(
  deps: SystemQueryDispatch,
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

export type UnsubscribePageChromeReader = (
  tenantId: TenantId,
  locale: string | undefined,
) => Promise<MailChrome | null>;

/** Reads the chrome for renderUnsubscribeResultPage in an app route without
 *  public access: build it once in the `wire` hook from its dispatchSystemQuery.
 *  Null without a mail renderer or when the read fails. */
export function createUnsubscribePageChromeReader(
  deps: SystemQueryDispatch,
): UnsubscribePageChromeReader {
  return (tenantId, locale) => readPageChrome(deps, tenantId, pageLocale(locale));
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
  return isFormRequest(request.headers["content-type"]) && !isOneClickPost(request)
    ? verifyForPage(token, encodedSecret, purpose, request.headers)
    : verifyUnsubscribeToken(token, encodedSecret, purpose);
}

// RFC 8058 mail-provider POSTs are form-encoded too, but nobody looks at the answer: they keep
// the JSON rejection and get no branded page.
function isOneClickPost(request: SignatureExtraRouteVerifyRequest): boolean {
  return (
    isFormRequest(request.headers["content-type"]) &&
    request.rawBody.trim() === DELIVERY_UNSUBSCRIBE_ONE_CLICK_HEADER_VALUE
  );
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

  const writeRoute = signatureRoute<
    (VerifiedUnsubscribe & { readonly oneClick: boolean }) | RejectedForPage
  >({
    method: "POST",
    path: DELIVERY_UNSUBSCRIBE_PATH,
    entry: "signature",
    verify: async (request) => {
      const verified = await verifyPost(
        request,
        tokenFromPostRequest(request),
        encodedSecret,
        "unsubscribe",
      );
      return verified.kind === "rejected"
        ? verified
        : { ...verified, oneClick: isOneClickPost(request) };
    },
    handler: async (c, verified, deps) => {
      if (verified.kind === "rejected") {
        return pageResponse(c, deps, { kind: "invalid" }, verified, 400);
      }
      // No chrome lookup for a one-click client: it never renders the page.
      const pageScope: PageScope = verified.oneClick
        ? { tenantId: undefined, locale: verified.locale }
        : verified;
      // Token-verify passed — everything below is a legitimate write. Don't
      // swallow write-errors as "invalid token", that would mask real bugs
      // (e.g. events-table missing, DB down) behind a misleading 400.
      const succeeded = await dispatchUnsubscribeWrite(verified, deps);
      if (!succeeded) {
        return pageResponse(c, deps, { kind: "failed" }, pageScope, 500);
      }
      return pageResponse(
        c,
        deps,
        {
          kind: "unsubscribed",
          resubscribeToken: await signResubscribeToken(verified, encodedSecret),
        },
        pageScope,
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
        if (outcome === "success") {
          return pageResponse(c, deps, { kind: "resubscribed" }, verified, 200);
        }
        return outcome === "limit_reached"
          ? pageResponse(c, deps, { kind: "resubscribeLimitReached" }, verified, 409)
          : pageResponse(c, deps, { kind: "failed" }, verified, 500);
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
