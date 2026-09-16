import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import {
  buildSessionRoles,
  createSystemUser,
  defineWriteHandler,
  type SessionUser,
  TENANT_MEMBERSHIPS_QUERY,
  type TenantId,
  type WriteResult,
} from "@cosmicdrift/kumiko-framework/engine";
import type { WriteFailure } from "@cosmicdrift/kumiko-framework/errors";
import { parseRoles } from "@cosmicdrift/kumiko-framework/utils";
import { z } from "zod";
import { verifyDummyPassword, verifyPassword } from "../../shared";
import { USER_STATUS, UserQueries } from "../../user";
import { type AuthUserRow, parseAuthUserRow } from "../auth-user-row";
import {
  AUTH_LOCKOUT_DEFAULT_DURATION_MINUTES,
  AUTH_LOCKOUT_DEFAULT_MAX_FAILED_ATTEMPTS,
} from "../constants";
import {
  accountLocked,
  accountRestricted,
  emailNotVerified,
  invalidCredentials,
  noMembership,
} from "../errors";
import { clearLockoutState, getLockoutState, recordFailedAttempt } from "../lockout-store";

export type LoginHandlerOptions = {
  // When true, a valid (email + password) login fails with email_not_verified
  // if the user row's emailVerified flag is false. Enumeration-leak is
  // accepted: UX benefit ("check your email") outweighs the marginal
  // signal since signup already surfaces the same fact.
  readonly strictEmailVerification?: boolean;
  // Brute-force protection: after N wrong-password attempts the account
  // locks for the configured duration. State lives in Redis (see
  // lockout-store.ts) — if ctx.redis is unset, lockout is skipped and the
  // handler falls back to classic invalid-credentials. Counter is monotonic
  // and only resets on a successful login, so a re-lock after the cooldown
  // happens on the FIRST miss, not the Nth (strict semantic — favours
  // brute-force resistance over UX).
  readonly accountLockout?: {
    readonly maxFailedAttempts?: number;
    readonly lockoutDurationMinutes?: number;
  };
  // Optional second-factor gate. auth-mfa (if mounted) wires this in at
  // app-composition time. Deliberately generic here — auth-email-password
  // must not import auth-mfa's config, only this shape. Called AFTER a
  // successful password verification (never before — the point is to add
  // a second factor to a real credential match, not to gate on identity
  // alone).
  readonly mfaStatusChecker?: (
    ctx: HandlerContext,
    userId: string,
    tenantId: TenantId,
    // Merged global+tenant roles, computed by this handler BEFORE the
    // gate runs — needed for policy values like "admins" that key off role.
    roles: readonly string[],
  ) => Promise<
    | { readonly required: false }
    | { readonly required: true; readonly challengeToken: string }
    | { readonly setupRequired: true; readonly preauthSetupToken: string }
  >;
};

const SYSTEM_USER_ID = "00000000-0000-4000-8000-000000000000";

// Two possible success shapes: a straight login mints a session; a login
// gated by MFA hands back a challenge instead — auth-routes.ts branches on
// `kind` to decide whether to mint a JWT now or wait for /auth/mfa/verify.
export type LoginResult =
  | { readonly kind: "auth-session"; readonly session: SessionUser }
  | { readonly kind: "mfa-challenge"; readonly challengeToken: string }
  | { readonly kind: "mfa-setup-required"; readonly preauthSetupToken: string };

type Membership = { readonly tenantId: TenantId; readonly roles: readonly string[] };

// result is always a WriteFailure at construction (every reject() call site
// passes one) — typing it that way, not WriteResult<LoginResult>, lets other
// handlers with a different success-data type reuse these gates unchanged.
type GateReject = { readonly ok: false; readonly result: WriteFailure };
type GateOk<T> = { readonly ok: true; readonly value: T };
type GateOutcome<T> = GateReject | GateOk<T>;

function reject(result: WriteFailure): GateReject {
  return { ok: false, result };
}

function ok<T>(value: T): GateOk<T> {
  return { ok: true, value };
}

type AuthenticatableUserRow = AuthUserRow & { readonly passwordHash: string };

/** Uniform response on any credential miss — burns argon2 cost (#774). */
export async function gateResolveAuthUser(
  found: AuthUserRow | null,
  password: string,
): Promise<GateOutcome<AuthenticatableUserRow>> {
  if (!found?.passwordHash || found.isDeleted) {
    await verifyDummyPassword(password);
    return reject(invalidCredentials());
  }
  return ok({ ...found, passwordHash: found.passwordHash });
}

/**
 * Lockout BEFORE password verify — locked accounts can't be password-probed.
 * Fail-open without Redis (IP rate-limit still covers partially).
 */
export async function gateEnforceLockout(
  ctx: HandlerContext,
  userId: string,
): Promise<GateOutcome<undefined>> {
  if (!ctx.redis) return ok(undefined);
  const state = await getLockoutState(ctx.redis, userId);
  if (state?.lockedUntil !== null && state?.lockedUntil !== undefined) {
    const now = Date.now();
    if (state.lockedUntil > now) {
      const retryAfterSeconds = Math.max(1, Math.ceil((state.lockedUntil - now) / 1000));
      return reject(accountLocked(retryAfterSeconds));
    }
  }
  return ok(undefined);
}

/** Verify password; record miss / clear lockout on hit. */
export async function gateVerifyPassword(
  ctx: HandlerContext,
  found: AuthenticatableUserRow,
  password: string,
  maxFailedAttempts: number,
  lockoutDurationMinutes: number,
): Promise<GateOutcome<undefined>> {
  const passwordOk = await verifyPassword(found.passwordHash, password);
  if (!passwordOk) {
    if (ctx.redis) {
      await recordFailedAttempt(ctx.redis, found.id, maxFailedAttempts, lockoutDurationMinutes);
    }
    return reject(invalidCredentials());
  }
  // Clear before MFA — MFA has its own attempt-cap; don't password-lock
  // users who occasionally mistype across otherwise-successful logins.
  if (ctx.redis) {
    await clearLockoutState(ctx.redis, found.id);
  }
  return ok(undefined);
}

/** Strict email verification — after password, before session. */
export function gateEnforceEmailVerified(
  found: AuthUserRow,
  strictVerification: boolean,
): GateOutcome<undefined> {
  if (strictVerification && found.emailVerified !== true) {
    return reject(emailNotVerified());
  }
  return ok(undefined);
}

/** DSGVO Art. 18 freeze + forget-path anti-enumeration. */
export function gateEnforceAccountStatus(found: AuthUserRow): GateOutcome<undefined> {
  if (found.status === USER_STATUS.Restricted) {
    return reject(accountRestricted());
  }
  if (found.status === USER_STATUS.DeletionRequested || found.status === USER_STATUS.Deleted) {
    return reject(invalidCredentials());
  }
  return ok(undefined);
}

/** Pick membership (last-active preferred); merge global + tenant roles. */
export async function gateResolveMembership(
  ctx: HandlerContext,
  found: AuthUserRow,
  memberships: ReadonlyArray<Membership>,
): Promise<GateOutcome<{ readonly chosen: Membership; readonly mergedRoles: readonly string[] }>> {
  if (memberships.length === 0) {
    return reject(noMembership());
  }

  const preferred =
    found.lastActiveTenantId !== null && found.lastActiveTenantId !== undefined
      ? memberships.find((m) => m.tenantId === found.lastActiveTenantId)
      : undefined;
  const candidates = preferred
    ? [preferred, ...memberships.filter((m) => m !== preferred)]
    : memberships;

  const globalRoles = parseRoles(found.roles ?? null);

  for (const candidate of candidates) {
    const active = await ctx.resolveActiveMembership(found.id, candidate.tenantId);
    if (active.kind === "rejected") {
      // A blocked principal is blocked for every tenant, so stop here;
      // not_a_member/tenant_teardown are per-tenant — try the next candidate.
      if (active.reason === "principal_blocked") {
        return reject(invalidCredentials());
      }
      continue;
    }
    const chosen: Membership = {
      tenantId: active.membership.tenantId,
      roles: active.membership.roles,
    };
    // buildSessionRoles calls stripForbiddenMembershipRoles to strip reserved
    // roles only (globalRoles keeps SystemAdmin) — read-time backstop against a
    // rebuild-resurrected role.
    const mergedRoles = buildSessionRoles(globalRoles, chosen.roles);
    return ok({ chosen, mergedRoles });
  }

  return reject(noMembership());
}

// MFA challenge / setup-required / proceed. Excludes "auth-session" (this
// gate never builds one) so callers with their own session shape reuse it as-is.
export async function gateEnforceMfa(
  ctx: HandlerContext,
  opts: LoginHandlerOptions,
  userId: string,
  tenantId: TenantId,
  mergedRoles: readonly string[],
): Promise<Exclude<LoginResult, { readonly kind: "auth-session" }> | undefined> {
  if (!opts.mfaStatusChecker) return undefined;
  const mfaStatus = await opts.mfaStatusChecker(ctx, userId, tenantId, mergedRoles);
  if ("challengeToken" in mfaStatus) {
    return { kind: "mfa-challenge", challengeToken: mfaStatus.challengeToken };
  }
  if ("setupRequired" in mfaStatus) {
    return { kind: "mfa-setup-required", preauthSetupToken: mfaStatus.preauthSetupToken };
  }
  return undefined;
}

/** Auth-claims hooks → session. */
export async function gateBuildSession(
  ctx: HandlerContext,
  userId: string,
  tenantId: TenantId,
  mergedRoles: readonly string[],
  timezone?: string | null,
  locale?: string | null,
): Promise<{ readonly kind: "auth-session"; readonly session: SessionUser }> {
  const baseSession: SessionUser = {
    id: userId,
    tenantId,
    roles: mergedRoles,
    ...(timezone !== null && timezone !== undefined && { timezone }),
    ...(locale !== null && locale !== undefined && { locale }),
  };
  const claims = await ctx.resolveAuthClaims(baseSession);
  const session: SessionUser =
    Object.keys(claims).length > 0 ? { ...baseSession, claims } : baseSession;
  return { kind: "auth-session", session };
}

// Login — unauthenticated entry point. The route is wired public (no JWT
// middleware), synthesising a guest SessionUser for the handler's access
// check. Everything inside the handler goes through ctx.queryAs(system, ...)
// so the user feature stays the single owner of its table.
export function createLoginHandler(opts: LoginHandlerOptions = {}) {
  const strictVerification = opts.strictEmailVerification === true;
  const maxFailedAttempts =
    opts.accountLockout?.maxFailedAttempts ?? AUTH_LOCKOUT_DEFAULT_MAX_FAILED_ATTEMPTS;
  const lockoutDurationMinutes =
    opts.accountLockout?.lockoutDurationMinutes ?? AUTH_LOCKOUT_DEFAULT_DURATION_MINUTES;

  return defineWriteHandler({
    name: "login",
    schema: z.object({
      email: z.email(),
      password: z.string().min(1),
    }),
    access: { roles: ["all"] },
    escapeHatch: {
      reason:
        "Unauthenticated login has no caller identity yet — it looks up the user row by " +
        "email via ctx.queryAs(SYSTEM, ...) and resolves tenant membership via " +
        "ctx.resolveActiveMembership before a session exists. It also reads the MFA " +
        "enrollment of the tenant named in the signed login/setup token, not the guest " +
        "dispatch tenant, via the mfaStatusChecker callback.",
    },
    description:
      "Signs a user in with email and password, running the lockout, email-verification, account-status, tenant-membership and MFA gates, and answering with a session or with an MFA challenge or setup requirement.",
    handler: async (event, ctx): Promise<WriteResult<LoginResult>> => {
      const systemUser = createSystemUser(SYSTEM_USER_ID);

      const foundRow = parseAuthUserRow(
        await ctx.queryAs(systemUser, UserQueries.findForAuth, { email: event.payload.email }),
      );
      const userGate = await gateResolveAuthUser(foundRow, event.payload.password);
      if (!userGate.ok) return userGate.result;
      const found = userGate.value;

      const lockoutGate = await gateEnforceLockout(ctx, found.id);
      if (!lockoutGate.ok) return lockoutGate.result;

      const passwordGate = await gateVerifyPassword(
        ctx,
        found,
        event.payload.password,
        maxFailedAttempts,
        lockoutDurationMinutes,
      );
      if (!passwordGate.ok) return passwordGate.result;

      const emailGate = gateEnforceEmailVerified(found, strictVerification);
      if (!emailGate.ok) return emailGate.result;

      const statusGate = gateEnforceAccountStatus(found);
      if (!statusGate.ok) return statusGate.result;

      // Still needed for candidate ORDER (preferred tenant first) — the actual
      // active/blocked/teardown decision comes from ctx.resolveActiveMembership below.
      const memberships = (await ctx.queryAs(systemUser, TENANT_MEMBERSHIPS_QUERY, {
        userId: found.id,
      })) as Array<Membership>; // @cast-boundary db-runner

      const membershipGate = await gateResolveMembership(ctx, found, memberships);
      if (!membershipGate.ok) return membershipGate.result;
      const { chosen, mergedRoles } = membershipGate.value;

      const mfaGate = await gateEnforceMfa(ctx, opts, found.id, chosen.tenantId, mergedRoles);
      if (mfaGate !== undefined) {
        return { isSuccess: true, data: mfaGate };
      }

      const session = await gateBuildSession(
        ctx,
        found.id,
        chosen.tenantId,
        mergedRoles,
        found.timezone,
        found.locale,
      );
      return { isSuccess: true, data: session };
    },
  });
}
