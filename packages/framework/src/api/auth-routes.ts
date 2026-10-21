import type { Hono } from "hono";
import type { Dispatcher } from "../pipeline/dispatcher.ts";
import { createAuthRouteContext } from "./auth-routes-context.ts";
import { registerInviteRoutes } from "./auth-routes-invite.ts";
import { registerLoginRoute } from "./auth-routes-login.ts";
import {
  registerMfaPreauthConfirmRoute,
  registerMfaPreauthEnableStartRoute,
  registerMfaVerifyRoute,
} from "./auth-routes-mfa.ts";
import { registerSessionRoutes } from "./auth-routes-session.ts";
import { registerSignupRoutes } from "./auth-routes-signup.ts";
import {
  registerAccountUnlockRoutes,
  registerEmailVerificationRoutes,
  registerPasswordResetRoutes,
} from "./auth-routes-token-flows.ts";
import type { AuthRoutesConfig } from "./auth-routes-types.ts";
import type { JwtHelper } from "./jwt.ts";

export type { AuthSessionStatus } from "./auth-middleware.ts";
export {
  createInMemoryLoginRateLimiter,
  createRedisLoginRateLimiter,
  inMemoryLoginRateLimiterFallback,
} from "./auth-rate-limiters.ts";
export type {
  AccountUnlockConfig,
  AuthRoutesConfig,
  EmailVerificationConfig,
  InviteConfig,
  LoginRateLimiter,
  PasswordResetConfig,
  SessionChecker,
  SessionCreator,
  SessionMassRevoker,
  SessionMetadata,
  SessionRevoker,
  SignupConfig,
} from "./auth-routes-types.ts";

// A sid minted by sessionCreator is only revocable when logout can revoke it
// (sessionRevoker) AND every request re-checks it (sessionChecker). Wiring the
// first without the other two would make logout look effective while the JWT
// stays valid until expiry. A checker alone stays allowed: it fails closed.
export function assertSessionCallbacksPaired(
  auth: Pick<AuthRoutesConfig, "sessionCreator" | "sessionRevoker" | "sessionChecker"> | undefined,
): void {
  const issuesSessions = auth?.sessionCreator !== undefined || auth?.sessionRevoker !== undefined;
  const missing = issuesSessions
    ? [
        ...(auth?.sessionCreator === undefined ? ["sessionCreator"] : []),
        ...(auth?.sessionRevoker === undefined ? ["sessionRevoker"] : []),
        ...(auth?.sessionChecker === undefined ? ["sessionChecker"] : []),
      ]
    : [];
  if (missing.length > 0) {
    throw new Error(
      `[kumiko:boot] auth session callbacks are wired partially — missing ${missing.join(", ")}. ` +
        "Server sessions need sessionCreator, sessionRevoker and sessionChecker together, " +
        "otherwise logout leaves the JWT valid until it expires. Wire all three (the sessions " +
        "feature's sessionStore provides them) or none for stateless JWTs.",
    );
  }
}

export function createAuthRoutes(
  dispatcher: Dispatcher,
  jwt: JwtHelper,
  config: AuthRoutesConfig,
): Hono {
  const ctx = createAuthRouteContext(dispatcher, jwt, config);
  registerLoginRoute(ctx);
  registerMfaVerifyRoute(ctx);
  registerMfaPreauthEnableStartRoute(ctx);
  registerMfaPreauthConfirmRoute(ctx);
  registerPasswordResetRoutes(ctx);
  registerEmailVerificationRoutes(ctx);
  registerAccountUnlockRoutes(ctx);
  registerSignupRoutes(ctx);
  registerInviteRoutes(ctx);
  registerSessionRoutes(ctx);
  return ctx.api;
}
