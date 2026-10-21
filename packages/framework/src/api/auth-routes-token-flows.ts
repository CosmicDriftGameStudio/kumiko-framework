import type { Hono } from "hono";
import * as z from "zod";
import { createAnonymousUser } from "../engine/system-user.ts";
import { SYSTEM_TENANT_ID } from "../engine/types/index.ts";
import type { Dispatcher } from "../pipeline/dispatcher.ts";
import { Routes } from "./api-constants.ts";
import type { AuthRouteContext } from "./auth-routes-context.ts";
import type { PublicAuthErrorStatus } from "./auth-routes-shared.ts";
import { registerTokenRequestRoute } from "./auth-routes-shared.ts";

const ResetPasswordBody = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});

const VerifyEmailBody = z.object({
  token: z.string().min(1),
});

function registerTokenConfirmRoute(opts: {
  api: Hono;
  dispatcher: Dispatcher;
  path: string;
  confirmHandler: string;
  // Endpoint-specific body shape (reset has `newPassword`, verify doesn't).
  schema: typeof ResetPasswordBody | typeof VerifyEmailBody;
}): void {
  opts.api.post(opts.path, async (c) => {
    const raw = await c.req.json().catch(() => null);
    const parsed = opts.schema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ isSuccess: false, error: "invalid_body" }, 400);
    }
    const result = await opts.dispatcher.write(
      opts.confirmHandler,
      parsed.data,
      createAnonymousUser(SYSTEM_TENANT_ID),
    );
    if (!result.isSuccess) {
      const status = result.error.httpStatus as PublicAuthErrorStatus; // @cast-boundary engine-payload
      return c.json({ isSuccess: false, error: result.error }, status);
    }
    return c.json({ isSuccess: true });
  });
}

export function registerPasswordResetRoutes(ctx: AuthRouteContext): void {
  const { api, dispatcher, config } = ctx;
  // POST /auth/request-password-reset + /auth/reset-password — public.
  // Silent-success on request (no enumeration), typed failure on confirm.
  // Rate-limit covered via config.rateLimit.auth (Sprint G.5 L2, /auth/*).
  if (config.passwordReset) {
    const pr = config.passwordReset;
    registerTokenRequestRoute({
      api,
      dispatcher,
      path: Routes.authRequestPasswordReset,
      requestHandler: pr.requestHandler,
    });
    registerTokenConfirmRoute({
      api,
      dispatcher,
      path: Routes.authResetPassword,
      confirmHandler: pr.confirmHandler,
      schema: ResetPasswordBody,
    });
  }
}

export function registerEmailVerificationRoutes(ctx: AuthRouteContext): void {
  const { api, dispatcher, config } = ctx;
  // Email-verification mirrors password-reset.
  if (config.emailVerification) {
    const ev = config.emailVerification;
    registerTokenRequestRoute({
      api,
      dispatcher,
      path: Routes.authRequestEmailVerification,
      requestHandler: ev.requestHandler,
    });
    registerTokenConfirmRoute({
      api,
      dispatcher,
      path: Routes.authVerifyEmail,
      confirmHandler: ev.confirmHandler,
      schema: VerifyEmailBody,
    });
  }
}

export function registerAccountUnlockRoutes(ctx: AuthRouteContext): void {
  const { api, dispatcher, config } = ctx;
  // Account-unlock mirrors email-verification (token-only confirm body) —
  // clears the Redis lockout state instead of an entity field, see
  // confirm-account-unlock.write.ts.
  if (config.accountUnlock) {
    const au = config.accountUnlock;
    registerTokenRequestRoute({
      api,
      dispatcher,
      path: Routes.authRequestAccountUnlock,
      requestHandler: au.requestHandler,
    });
    registerTokenConfirmRoute({
      api,
      dispatcher,
      path: Routes.authConfirmAccountUnlock,
      confirmHandler: au.confirmHandler,
      schema: VerifyEmailBody,
    });
  }
}
