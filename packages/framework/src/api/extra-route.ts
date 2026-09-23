// ExtraRoute — declarative replacement for the old `extraRoutes: (app, deps)
// => void` closure (kumiko-framework#3050). Every entry declares its access
// tier (`entry`) up front; buildServer wires the matching guard + deps
// instead of handing every route a raw db/redis escape hatch.

import type { Context, Hono } from "hono";
import type {
  HttpRouteMethod,
  Registry,
  SessionUser,
  TenantId,
  WriteResult,
} from "../engine/types";
import type { SecretsContext } from "../secrets";

export const ExtraRouteEntries = {
  anonymous: "anonymous",
  user: "user",
  signature: "signature",
} as const;

export type ExtraRouteEntry = (typeof ExtraRouteEntries)[keyof typeof ExtraRouteEntries];

export type AnonymousExtraRouteDeps = {
  // biome-ignore lint/suspicious/noExplicitAny: Hono's generic-Param ist im Framework-Boundary unsichtbar
  readonly app: Hono<any, any>;
  readonly registry: Registry;
  readonly systemQuery: (type: string, payload: unknown, tenantId: TenantId) => Promise<unknown>;
  /** Runs as the session the /api chain resolved for this request —
   *  anonymous when no token is sent, the authenticated user otherwise.
   *  Never more than that caller could already do via /api/write: same
   *  user, same request-resolved tenant (never overridable), only under
   *  "/api/" (the only path that populates a session user). */
  readonly write: (type: string, payload: unknown) => Promise<WriteResult>;
};

export type AnonymousExtraRoute = {
  readonly method: HttpRouteMethod;
  readonly path: string;
  readonly entry: "anonymous";
  readonly handler: (
    // biome-ignore lint/suspicious/noExplicitAny: Hono context generics are invisible at the framework boundary
    c: Context<any, any>,
    deps: AnonymousExtraRouteDeps,
  ) => Response | Promise<Response>;
};

export type UserExtraRouteDeps = {
  // biome-ignore lint/suspicious/noExplicitAny: Hono's generic-Param ist im Framework-Boundary unsichtbar
  readonly app: Hono<any, any>;
  readonly registry: Registry;
  readonly user: SessionUser;
  readonly query: (type: string, payload: unknown) => Promise<unknown>;
  readonly write: (type: string, payload: unknown) => Promise<WriteResult>;
};

export type UserExtraRoute = {
  readonly method: HttpRouteMethod;
  readonly path: string;
  readonly entry: "user";
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

export type SignatureExtraRouteDeps = {
  // biome-ignore lint/suspicious/noExplicitAny: Hono's generic-Param ist im Framework-Boundary unsichtbar
  readonly app: Hono<any, any>;
  readonly registry: Registry;
  readonly secrets?: SecretsContext;
  readonly systemQuery: (type: string, payload: unknown, tenantId: TenantId) => Promise<unknown>;
  /** Privilege scope: SystemAdmin of the target tenant, WITHOUT the route's
   *  access check — only reachable because verify() has already proven the
   *  caller's authenticity (signature, HMAC state, etc.). */
  readonly dispatchSystemWrite: (args: SystemDispatchArgs) => Promise<WriteResult>;
  readonly dispatchSystemQuery: (args: SystemDispatchArgs) => Promise<unknown>;
};

export type SignatureExtraRoute<TVerified> = {
  readonly method: HttpRouteMethod;
  readonly path: string;
  readonly entry: "signature";
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
      if (!Number.isInteger(retryAfterSeconds) || retryAfterSeconds < 0) {
        throw new RangeError(
          "ExtraRouteRejection: retryAfterSeconds must be a non-negative integer",
        );
      }
    }
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
