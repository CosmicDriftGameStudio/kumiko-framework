// ExtraRoute — declarative replacement for the old `extraRoutes: (app, deps)
// => void` closure. Every entry declares its access
// tier (`entry`) up front; buildServer wires the matching guard + deps
// instead of handing every route a raw db/redis escape hatch.

import type { ContractQuery, ContractWrite } from "@cosmicdrift/kumiko-types/handler-contract";
import type { WriteResult } from "@cosmicdrift/kumiko-types/handlers";
import type { HttpRouteMethod, HttpRouteRateLimit } from "@cosmicdrift/kumiko-types/http-route";
import type { RateLimitDecision } from "@cosmicdrift/kumiko-types/rate-limit-types";
import type { Context, Hono } from "hono";
import type { Registry, SessionUser, TenantId } from "../engine/types/index.ts";

import type { SecretsContext } from "../secrets/index.ts";

export const ExtraRouteEntries = {
  anonymous: "anonymous",
  user: "user",
  signature: "signature",
} as const;

export type ExtraRouteEntry = (typeof ExtraRouteEntries)[keyof typeof ExtraRouteEntries];

export type AnonymousExtraRouteDeps = {
  // biome-ignore lint/suspicious/noExplicitAny: Hono's generic parameter is invisible at the framework boundary
  readonly app: Hono<any, any>;
  readonly registry: Registry;
  readonly systemQuery: ContractQuery<[tenantId: TenantId]>;
  /** Runs as the session the /api chain resolved for this request —
   *  anonymous when no token is sent, the authenticated user otherwise.
   *  Never more than that caller could already do via /api/write: same
   *  user, same request-resolved tenant (never overridable), only under
   *  "/api/" (the only path that populates a session user). */
  readonly write: ContractWrite;
  /** Same caller and tenant contract as `write`: runs as the session the /api chain
   *  resolved for this request, so it can read exactly what that caller could read via
   *  /api/query, nothing more. Only under "/api/". */
  readonly query: ContractQuery;
  /** Resolved by the server's single trustedProxyHops-aware resolver —
   *  never read X-Forwarded-For yourself. */
  readonly clientIp: string;
};

export type AnonymousExtraRoute = {
  readonly method: HttpRouteMethod;
  readonly path: string;
  readonly entry: "anonymous";
  /** Same option and buckets as r.httpRoute's rateLimit, enforced through the server's shared
   *  rate-limit store before the body limit, verify() and the handler. Fail-open; skipped
   *  when the server has no Redis. */
  readonly rateLimit?: HttpRouteRateLimit;
  readonly handler: (
    // biome-ignore lint/suspicious/noExplicitAny: Hono context generics are invisible at the framework boundary
    c: Context<any, any>,
    deps: AnonymousExtraRouteDeps,
  ) => Response | Promise<Response>;
};

export type UserExtraRouteDeps = {
  // biome-ignore lint/suspicious/noExplicitAny: Hono's generic parameter is invisible at the framework boundary
  readonly app: Hono<any, any>;
  readonly registry: Registry;
  readonly user: SessionUser;
  readonly query: ContractQuery;
  readonly write: ContractWrite;
};

export type UserExtraRoute = {
  readonly method: HttpRouteMethod;
  readonly path: string;
  readonly entry: "user";
  /** Same option and buckets as r.httpRoute's rateLimit, enforced through the server's shared
   *  rate-limit store before the body limit, verify() and the handler. Fail-open; skipped
   *  when the server has no Redis. */
  readonly rateLimit?: HttpRouteRateLimit;
  readonly handler: (
    // biome-ignore lint/suspicious/noExplicitAny: Hono context generics are invisible at the framework boundary
    c: Context<any, any>,
    deps: UserExtraRouteDeps,
  ) => Response | Promise<Response>;
};

export type SignatureExtraRouteVerifyRequest = {
  readonly rawBody: string;
  /** Lowercase header names — Hono/undici normalize incoming headers to
   *  lowercase, verify() must not have to re-normalize per provider. */
  readonly headers: Readonly<Record<string, string>>;
  readonly params: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
};

export type SignatureExtraRouteVerifyDeps = {
  readonly registry: Registry;
  readonly secrets?: SecretsContext;
};

export type SystemDispatchArgs = {
  readonly handlerQn: string;
  readonly payload: unknown;
  readonly tenantId: TenantId;
};

export type RoleDispatchArgs = SystemDispatchArgs & {
  readonly roles: readonly string[];
};

export type SignatureExtraRouteDeps = {
  // biome-ignore lint/suspicious/noExplicitAny: Hono's generic parameter is invisible at the framework boundary
  readonly app: Hono<any, any>;
  readonly registry: Registry;
  readonly secrets?: SecretsContext;
  readonly systemQuery: ContractQuery<[tenantId: TenantId]>;
  /** Privilege scope: SystemAdmin of the target tenant, WITHOUT the route's
   *  access check — only reachable because verify() has already proven the
   *  caller's authenticity (signature, HMAC state, etc.). */
  readonly dispatchSystemWrite: (args: SystemDispatchArgs) => Promise<WriteResult>;
  readonly dispatchSystemQuery: (args: SystemDispatchArgs) => Promise<unknown>;
  /** Same trust as dispatchSystemWrite, but runs as the tenant's system user
   *  with the "system" role plus exactly `roles` (no SystemAdmin), so the write
   *  passes app-role access checks. */
  readonly dispatchWriteAs: (args: RoleDispatchArgs) => Promise<WriteResult>;
};

export type VerifiedRouteRateLimit<TVerified> = {
  /** Bucket key from what verify() proved (app id, tenant, account); one bucket per route and key. */
  readonly key: (verified: TVerified) => string;
  readonly limit: number;
  readonly windowSeconds: number;
  /** JSON body of the 429 (Retry-After and X-RateLimit headers are always set); default is the framework's rate_limited error. */
  readonly rejectionBody?: (decision: RateLimitDecision) => unknown;
};

export type SignatureExtraRoute<TVerified> = {
  readonly method: HttpRouteMethod;
  readonly path: string;
  readonly entry: "signature";
  /** Same option and buckets as r.httpRoute's rateLimit, enforced through the server's shared
   *  rate-limit store before the body limit, verify() and the handler. Fail-open; skipped
   *  when the server has no Redis. */
  readonly rateLimit?: HttpRouteRateLimit;
  /** Limit keyed by the verified caller, checked after verify() and before the handler through the server's shared rate-limit store. Fail-open; skipped when the server has no Redis. */
  readonly verifiedRateLimit?: VerifiedRouteRateLimit<TVerified>;
  readonly verify: (
    request: SignatureExtraRouteVerifyRequest,
    deps: SignatureExtraRouteVerifyDeps,
  ) => Promise<TVerified>;
  readonly handler: (
    // biome-ignore lint/suspicious/noExplicitAny: Hono context generics are invisible at the framework boundary
    c: Context<any, any>,
    verified: TVerified,
    deps: SignatureExtraRouteDeps,
  ) => Response | Promise<Response>;
};

export type ExtraRouteDefinition =
  | AnonymousExtraRoute
  | UserExtraRoute
  | SignatureExtraRoute<unknown>;

/** Narrows a `SignatureExtraRoute<T>` into the storable `ExtraRouteDefinition`
 *  union. The single point where the verify/handler generic `T` is erased —
 *  callers keep full type-safety between their own verify() and handler(). */
export function signatureRoute<T>(def: SignatureExtraRoute<T>): ExtraRouteDefinition {
  // @cast-boundary generic erasure at the public ExtraRouteDefinition boundary;
  // verify() and handler() above stay paired through T at the call site.
  return def as unknown as SignatureExtraRoute<unknown>;
}

export type ExtraRouteRejectionStatus = 400 | 401 | 403 | 404 | 500 | 503;

export type ExtraRouteRejectionOptions = { readonly retryAfterSeconds?: number };

/** Thrown by `verify()` to reject a signature route with a specific status +
 *  JSON body. Any other throw from `verify()` is mapped to 401
 *  `extra_route_signature_invalid` by the buildServer wrapper.
 *
 *  503 signals "temporarily not ready" (e.g. a dependency the verify step
 *  needs is down) — webhook providers like Stripe retry on 503.
 *  `options.retryAfterSeconds` renders as the `Retry-After` header. */
export class ExtraRouteRejection extends Error {
  readonly status: ExtraRouteRejectionStatus;
  readonly body: unknown;
  readonly retryAfterSeconds: number | undefined;

  constructor(
    status: ExtraRouteRejectionStatus,
    body: unknown,
    message?: string,
    options?: ExtraRouteRejectionOptions,
  ) {
    super(message ?? `extra route rejected with status ${status}`);
    this.name = "ExtraRouteRejection";
    this.status = status;
    this.body = body;
    const retryAfterSeconds = options?.retryAfterSeconds;
    if (retryAfterSeconds !== undefined) {
      // Retry-After is only meaningful for 503 in this union (RFC 9110) and
      // is rendered as a delta-seconds header — reject anything that could
      // not survive that round-trip.
      if (status !== 503) {
        throw new RangeError(
          "ExtraRouteRejection: retryAfterSeconds is only valid with status 503",
        );
      }
      // isSafeInteger, not isInteger: String(1e21) is "1e+21", not 1*DIGIT.
      if (!Number.isSafeInteger(retryAfterSeconds) || retryAfterSeconds < 0) {
        throw new RangeError(
          "ExtraRouteRejection: retryAfterSeconds must be a non-negative safe integer",
        );
      }
    }
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
