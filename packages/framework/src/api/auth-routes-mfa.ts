import {
  isWriteQualifiedName,
  type WriteContract,
  writeContract,
} from "@cosmicdrift/kumiko-types/handler-contract";
import type { Context } from "hono";
import * as z from "zod";
import { hashOpaqueTokenSync } from "../crypto/opaque-token-hash.ts";
import { createAnonymousUser } from "../engine/system-user.ts";
import type { SessionUser } from "../engine/types/index.ts";
import { SYSTEM_TENANT_ID } from "../engine/types/index.ts";
import { toClientWriteErrorInfo } from "../errors/write-error-info.ts";
import type { Dispatcher } from "../pipeline/dispatcher.ts";
import { Routes } from "./api-constants.ts";
import { inMemoryLoginRateLimiterFallback } from "./auth-rate-limiters.ts";
import type { AuthRouteContext } from "./auth-routes-context.ts";
import { readErrorReason } from "./auth-routes-shared.ts";
import { toContentfulStatus } from "./contentful-status.ts";

type MfaVerifySuccess = { readonly kind: "mfa-verify-success"; readonly session: SessionUser };
type MfaPreauthEnableStartSuccess = {
  readonly setupToken: string;
  readonly otpauthUri: string;
  readonly recoveryCodes: readonly string[];
};
type MfaPreauthConfirmSuccess = {
  readonly kind: "mfa-preauth-confirm-success";
  readonly session: SessionUser;
};

// The config carries plain strings; the contract constructor needs the write-handler shape.
function requireWriteContract<TData>(
  field: string,
  qualifiedName: string,
): WriteContract<unknown, TData> {
  if (!isWriteQualifiedName(qualifiedName)) {
    throw new Error(`createAuthRoutes: ${field} must be a write handler qualified name`);
  }
  return writeContract<unknown, TData>(qualifiedName);
}

async function runAnonymousMfaWrite<TData>(
  c: Context,
  dispatcher: Dispatcher,
  contract: WriteContract<unknown, TData>,
  body: unknown,
  statusMap: Readonly<Record<string, number>>,
): Promise<
  | { readonly ok: true; readonly data: TData }
  | { readonly ok: false; readonly response: Response }
> {
  const result = await dispatcher.write(contract, body, createAnonymousUser(SYSTEM_TENANT_ID));
  if (result.isSuccess) return { ok: true, data: result.data };
  const reason = readErrorReason(result.error.details) ?? result.error.code;
  const status = toContentfulStatus(statusMap[reason] ?? result.error.httpStatus);
  return {
    ok: false,
    response: c.json({ isSuccess: false, error: toClientWriteErrorInfo(result.error) }, status),
  };
}

// Body schema for POST /auth/mfa/verify. challengeToken is opaque to the
// framework — it's minted and verified entirely by the mfaVerifyHandler
// (auth-mfa owns the token format, TOTP/recovery-code check, and the
// brute-force cap). code covers both 6-digit TOTP and XXXX-XXXX recovery
// codes (9 chars incl. the dash).
const MfaVerifyBody = z.object({
  challengeToken: z.string().min(1),
  code: z.string().min(6).max(9),
});

// Body schema for POST /auth/mfa/preauth-enable-start. preauthSetupToken is
// opaque to the framework — minted by login.write.ts's mfaStatusChecker
// (auth-mfa) when enforcement policy blocks an unenrolled user, verified
// entirely by the mfaPreauthEnableStartHandler. accountLabel is
// client-supplied (the email the user just typed at login) for the
// otpauth:// URI, mirroring auth-mfa's own enable-start.write.ts.
const MfaPreauthEnableStartBody = z.object({
  preauthSetupToken: z.string().min(1),
  accountLabel: z.string().min(1).max(200),
});

// Body schema for POST /auth/mfa/preauth-confirm. setupToken is opaque to
// the framework — minted by the mfaPreauthEnableStartHandler, verified
// entirely by the mfaPreauthConfirmHandler. code is TOTP-only (no recovery
// codes at enrollment time), mirroring auth-mfa's own enable-confirm.write.ts.
const MfaPreauthConfirmBody = z.object({
  setupToken: z.string().min(1),
  code: z.string().length(6),
});

// Second rate-limit axis for preauth-enable-start: unlike the IP, a
// preauthSetupToken isn't freely choosable by the attacker (it's minted by
// login.write.ts), so hashing it into a bucket key still caps the replay
// even when the IP-based bucket is bypassed via header rotation.
function preauthTokenKeyOf(token: string): string {
  return `preauth-token:${hashOpaqueTokenSync(token)}`;
}

export function registerMfaVerifyRoute(ctx: AuthRouteContext): void {
  const { api, dispatcher, config, getClientIp, mintSessionAndRespond, landingPathFragment } = ctx;
  // POST /auth/mfa/verify — completes a two-step login. Mirrors /auth/login
  // structurally (public, anonymous identity dispatch, mintSessionAndRespond on
  // success) but with its OWN rate limiter (mfaVerifyRateLimit) — this route
  // never goes through a dispatcher write-handler's own rateLimit config,
  // so without this it would have NO rate limiting at all. Per-account
  // brute-force protection (capping wrong-code guesses against one
  // still-valid challenge token) is a separate mechanism the handler itself
  // owns — see AuthRoutesConfig.mfaVerifyHandler's doc comment.
  if (config.mfaVerifyHandler) {
    const mfaVerifyContract = requireWriteContract<MfaVerifySuccess>(
      "mfaVerifyHandler",
      config.mfaVerifyHandler,
    );
    const statusMap = config.mfaVerifyErrorStatusMap ?? {};
    const rateLimiter =
      config.mfaVerifyRateLimit === null
        ? null
        : (config.mfaVerifyRateLimit ?? inMemoryLoginRateLimiterFallback());

    api.post(Routes.authMfaVerify, async (c) => {
      const raw = await c.req.json().catch(() => null);
      const parsed = MfaVerifyBody.safeParse(raw);
      if (!parsed.success) {
        return c.json({ isSuccess: false, error: "invalid_body" }, 400);
      }
      const body = parsed.data;

      const clientIp = getClientIp(c);

      if (rateLimiter) {
        const allowed = await rateLimiter.check(clientIp);
        if (!allowed) {
          return c.json({ isSuccess: false, error: "rate_limited" }, 429);
        }
      }

      const outcome = await runAnonymousMfaWrite(c, dispatcher, mfaVerifyContract, body, statusMap);
      if (!outcome.ok) return outcome.response;
      const data = outcome.data;

      const token = await mintSessionAndRespond(c, data.session);
      const landingPath = landingPathFragment({
        flow: "login",
        roles: data.session.roles,
        tenantId: data.session.tenantId,
      });

      if (rateLimiter) {
        await rateLimiter.reset(clientIp);
      }

      return c.json({
        isSuccess: true,
        token,
        user: { id: data.session.id, tenantId: data.session.tenantId, roles: data.session.roles },
        ...landingPath,
      });
    });
  }
}

export function registerMfaPreauthEnableStartRoute(ctx: AuthRouteContext): void {
  const { api, dispatcher, config, getClientIp } = ctx;
  // POST /auth/mfa/preauth-enable-start — lets a user blocked at login by
  // MFA enforcement (mfa-setup-required) generate a TOTP secret + QR
  // without a session, using the preauthSetupToken login.write.ts issued.
  // No JWT is minted here (unlike /auth/login and /auth/mfa/verify) — the
  // handler's response carries a secret-bearing setupToken that a later
  // pre-auth confirm step (the same shape auth-mfa's own enable-confirm
  // consumes) verifies. Rate-limited like mfaVerifyRateLimit/
  // mfaPreauthConfirmRateLimit — a preauthSetupToken is valid and
  // not-single-use for its whole TTL, so without this cap a replay is a
  // memory-hard CPU amplifier (see AuthRoutesConfig doc comment).
  if (config.mfaPreauthEnableStartHandler) {
    const mfaPreauthEnableStartContract = requireWriteContract<MfaPreauthEnableStartSuccess>(
      "mfaPreauthEnableStartHandler",
      config.mfaPreauthEnableStartHandler,
    );
    const statusMap = config.mfaPreauthEnableStartErrorStatusMap ?? {};
    const rateLimiter =
      config.mfaPreauthEnableStartRateLimit === null
        ? null
        : (config.mfaPreauthEnableStartRateLimit ?? inMemoryLoginRateLimiterFallback());

    api.post(Routes.authMfaPreauthEnableStart, async (c) => {
      const raw = await c.req.json().catch(() => null);
      const parsed = MfaPreauthEnableStartBody.safeParse(raw);
      if (!parsed.success) {
        return c.json({ isSuccess: false, error: "invalid_body" }, 400);
      }
      const body = parsed.data;

      const clientIp = getClientIp(c);

      if (rateLimiter) {
        const allowed = await rateLimiter.check(clientIp);
        if (!allowed) {
          return c.json({ isSuccess: false, error: "rate_limited" }, 429);
        }
        // Second axis, independent of the IP-derived bucket above: the
        // preauthSetupToken is minted by login.write.ts and not freely
        // choosable, so this cap survives an attacker rotating
        // x-forwarded-for to bypass the IP bucket.
        const tokenAllowed = await rateLimiter.check(preauthTokenKeyOf(body.preauthSetupToken));
        if (!tokenAllowed) {
          return c.json({ isSuccess: false, error: "rate_limited" }, 429);
        }
      }

      const outcome = await runAnonymousMfaWrite(
        c,
        dispatcher,
        mfaPreauthEnableStartContract,
        body,
        statusMap,
      );
      if (!outcome.ok) return outcome.response;

      return c.json({ isSuccess: true, ...outcome.data });
    });
  }
}

export function registerMfaPreauthConfirmRoute(ctx: AuthRouteContext): void {
  const { api, dispatcher, config, getClientIp, mintSessionAndRespond, landingPathFragment } = ctx;
  // POST /auth/mfa/preauth-confirm — completes both the enrollment started
  // by preauth-enable-start AND the login mfa-setup-required blocked.
  // Mirrors /auth/mfa/verify structurally (public, anonymous identity dispatch,
  // mintSessionAndRespond on success) with its OWN rate limiter
  // (mfaPreauthConfirmRateLimit) — same reasoning as mfaVerifyRateLimit.
  // Per-account brute-force protection (capping wrong-code guesses against
  // one still-valid setupToken) is owned by the handler itself — see
  // AuthRoutesConfig.mfaPreauthConfirmHandler's doc comment.
  if (config.mfaPreauthConfirmHandler) {
    const mfaPreauthConfirmContract = requireWriteContract<MfaPreauthConfirmSuccess>(
      "mfaPreauthConfirmHandler",
      config.mfaPreauthConfirmHandler,
    );
    const statusMap = config.mfaPreauthConfirmErrorStatusMap ?? {};
    const rateLimiter =
      config.mfaPreauthConfirmRateLimit === null
        ? null
        : (config.mfaPreauthConfirmRateLimit ?? inMemoryLoginRateLimiterFallback());

    api.post(Routes.authMfaPreauthConfirm, async (c) => {
      const raw = await c.req.json().catch(() => null);
      const parsed = MfaPreauthConfirmBody.safeParse(raw);
      if (!parsed.success) {
        return c.json({ isSuccess: false, error: "invalid_body" }, 400);
      }
      const body = parsed.data;

      const clientIp = getClientIp(c);

      if (rateLimiter) {
        const allowed = await rateLimiter.check(clientIp);
        if (!allowed) {
          return c.json({ isSuccess: false, error: "rate_limited" }, 429);
        }
      }

      const outcome = await runAnonymousMfaWrite(
        c,
        dispatcher,
        mfaPreauthConfirmContract,
        body,
        statusMap,
      );
      if (!outcome.ok) return outcome.response;
      const data = outcome.data;

      const token = await mintSessionAndRespond(c, data.session);
      const landingPath = landingPathFragment({
        flow: "login",
        roles: data.session.roles,
        tenantId: data.session.tenantId,
      });

      if (rateLimiter) {
        await rateLimiter.reset(clientIp);
      }

      return c.json({
        isSuccess: true,
        token,
        user: { id: data.session.id, tenantId: data.session.tenantId, roles: data.session.roles },
        ...landingPath,
      });
    });
  }
}
