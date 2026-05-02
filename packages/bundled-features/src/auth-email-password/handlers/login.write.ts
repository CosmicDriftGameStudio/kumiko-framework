import {
  createSystemUser,
  defineWriteHandler,
  type SessionUser,
  type TenantId,
} from "@kumiko/framework/engine";
import { UnprocessableError, writeFailure } from "@kumiko/framework/errors";
import { parseRoles } from "@kumiko/framework/utils";
import { z } from "zod";
import { UserQueries } from "../../user";
import { parseAuthUserRow } from "../auth-user-row";
import {
  AUTH_LOCKOUT_DEFAULT_DURATION_MINUTES,
  AUTH_LOCKOUT_DEFAULT_MAX_FAILED_ATTEMPTS,
  AuthErrors,
} from "../constants";
import { clearLockoutState, getLockoutState, recordFailedAttempt } from "../lockout-store";
import { verifyPassword } from "../password-hashing";

function invalidCredentials() {
  return writeFailure(
    new UnprocessableError(AuthErrors.invalidCredentials, {
      i18nKey: "auth.errors.invalidCredentials",
    }),
  );
}

function noMembership() {
  return writeFailure(
    new UnprocessableError(AuthErrors.noMembership, {
      i18nKey: "auth.errors.noMembership",
    }),
  );
}

function emailNotVerified() {
  return writeFailure(
    new UnprocessableError(AuthErrors.emailNotVerified, {
      i18nKey: "auth.errors.emailNotVerified",
    }),
  );
}

function accountLocked(retryAfterSeconds: number) {
  return writeFailure(
    new UnprocessableError(AuthErrors.accountLocked, {
      i18nKey: "auth.errors.accountLocked",
      // Seconds until auto-unlock — UI renders a countdown, clients can
      // schedule a retry. Rounded up so the UI never shows 0 while the
      // lock is still active.
      details: { retryAfterSeconds },
    }),
  );
}

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
};

const SYSTEM_USER_ID = "00000000-0000-4000-8000-000000000000";

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
    handler: async (event, ctx) => {
      const systemUser = createSystemUser(SYSTEM_USER_ID);

      const found = parseAuthUserRow(
        await ctx.queryAs(systemUser, UserQueries.findForAuth, {
          email: event.payload.email,
        }),
      );

      // Uniform response on any credential mismatch (no user, wrong password,
      // soft-deleted user) — prevents email enumeration.
      if (!found?.passwordHash || found.isDeleted) {
        return invalidCredentials();
      }

      // Lockout gate — runs BEFORE password verification so a locked account
      // can't be bruteforce-probed for passwords (and also can't be probed
      // for a timing-oracle on the bcrypt verify). If Redis isn't wired,
      // lockout is silently skipped — login still works, brute-force
      // protection just degrades to the IP-rate-limiter at the edge.
      if (ctx.redis) {
        const state = await getLockoutState(ctx.redis, found.id);
        if (state?.lockedUntil !== null && state?.lockedUntil !== undefined) {
          const now = Date.now();
          if (state.lockedUntil > now) {
            const retryAfterSeconds = Math.max(1, Math.ceil((state.lockedUntil - now) / 1000));
            return accountLocked(retryAfterSeconds);
          }
          // lockedUntil in the past — shouldn't normally happen because the
          // Redis TTL on the until-key expires the key at the same moment
          // as the value. Clock skew / replication lag could surface this;
          // fall through to password verification. The counter is NOT
          // reset — next miss re-locks immediately (strict-semantic, see
          // lockout-store.ts).
        }
      }

      const passwordOk = await verifyPassword(found.passwordHash, event.payload.password);
      if (!passwordOk) {
        if (ctx.redis) {
          await recordFailedAttempt(ctx.redis, found.id, maxFailedAttempts, lockoutDurationMinutes);
        }
        return invalidCredentials();
      }

      // Strict verification gate — runs AFTER password check so an attacker
      // probing "email_not_verified" needs valid credentials first. The
      // remaining enumeration surface is "valid-cred + unverified" → accepted
      // leak because the signup flow already told the user "check your email".
      if (strictVerification && found.emailVerified !== true) {
        return emailNotVerified();
      }

      // Resolve tenant + roles via the tenant feature's memberships query.
      // Returns [] if the user has no memberships — MVP: no login without an
      // invitation, so we refuse with a dedicated error.
      const memberships = (await ctx.queryAs(systemUser, "tenant:query:memberships", {
        userId: found.id,
      })) as Array<{ tenantId: TenantId; roles: readonly string[] }>;

      if (memberships.length === 0) {
        return noMembership();
      }

      const preferred =
        found.lastActiveTenantId !== null && found.lastActiveTenantId !== undefined
          ? memberships.find((m) => m.tenantId === found.lastActiveTenantId)
          : undefined;
      const chosen = preferred ?? memberships[0];
      if (!chosen) {
        return noMembership();
      }

      // Clear the lockout state on success. DEL is idempotent, so no need
      // to gate on "was there a counter?" — skipping the Redis round-trip
      // entirely for users who never failed a login would optimise the hot
      // path, but the call is microseconds and the branch isn't free either.
      if (ctx.redis) {
        await clearLockoutState(ctx.redis, found.id);
      }

      // Globale Rollen aus user.roles + tenant-membership-roles mergen.
      // Globale Rollen (SystemAdmin etc.) bleiben so über alle tenants
      // gleich; tenant-spezifische Rollen (Admin, User) kommen aus der
      // membership. Dedupe via Set damit eine Rolle die in beiden Quellen
      // steht nicht doppelt im Session-Roles landet.
      const globalRoles = parseRoles(found.roles ?? null);
      const mergedRoles = Array.from(new Set([...globalRoles, ...chosen.roles]));
      const baseSession: SessionUser = {
        id: found.id,
        tenantId: chosen.tenantId,
        roles: mergedRoles,
      };

      // Features can contribute identity facts (team IDs, feature flags, ...)
      // via r.authClaims(). ctx.resolveAuthClaims is a thin pass-through to
      // dispatcher.resolveAuthClaims — same impl also used by the switch-tenant
      // route, so login + tenant-switch stay in sync.
      //
      // Best-effort: if no feature registered a hook, we get an empty record
      // back and simply omit the `claims` field from the session (keeps the
      // shape clean for the JWT layer, which already spreads claims
      // conditionally based on presence).
      const claims = await ctx.resolveAuthClaims(baseSession);
      const session: SessionUser =
        Object.keys(claims).length > 0 ? { ...baseSession, claims } : baseSession;

      return {
        isSuccess: true,
        data: { kind: "auth-session", session },
      };
    },
  });
}
