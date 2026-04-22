// Shared state-change pipeline for the confirm side of out-of-band token
// flows (password-reset, email-verification). Both follow the same shape
// once the token is verified:
//
//   1. Redis check + burn (single-use enforcement)
//   2. Load user + deleted/missing/no-version guard
//   3. Optional idempotent short-circuit (verify-email when already done)
//   4. Resolve memberships → tenant-order for stream-matching
//   5. Try each tenant's stream with the handler-specific `changes`
//   6. Release the burn on ANY non-success path so a legit retry isn't
//      locked out by a stale marker
//
// The top-level `runConfirmTokenFlow` orchestrates and owns the
// try/finally burn-release. Every branch that should NOT release the
// burn (success, already-done) flips `committed = true`; everything
// else — including future branches a maintainer adds — releases
// automatically.

import {
  createSystemUser,
  type HandlerContext,
  type SessionUser,
  SYSTEM_TENANT_ID,
  type TenantId,
  type WriteResult,
} from "@kumiko/framework/engine";
import { InternalError, type WriteFailure, writeFailure } from "@kumiko/framework/errors";
import type Redis from "ioredis";
import { UserHandlers, UserQueries } from "../../user";
import type { AuthUserRow } from "../auth-user-row";
import { parseAuthUserRow } from "../auth-user-row";
import { orderTenantsByPreference } from "../stream-tenant";
import { burnToken, unburnToken } from "../token-burn-store";

export type ConfirmTokenFlowSpec<TSuccessData> = {
  // Short purpose-tag used in the burn-store key. Must NOT overlap with
  // other token flows — "reset" vs "verify" keeps cross-flow replay
  // impossible at both layers (HMAC-purpose AND burn-purpose).
  readonly purpose: string;
  // Used verbatim in the 5xx body when ctx.redis is missing — the feature
  // is misconfigured, not the caller's fault.
  readonly redisRequiredMessage: string;
  // Standard failure returned for every "token can't be consumed" path
  // (bad state, missing memberships, every tenant rejected). The route
  // layer returns 422 with a uniform code so the caller can't tell which
  // branch fired.
  readonly invalidToken: () => ReturnType<typeof writeFailure>;
  // Handler-specific payload for user:update. Runs once per token — the
  // result is shared across every tenant-stream attempt. Can be async
  // (password-reset hashes here).
  readonly buildChanges: (me: AuthUserRow) => Promise<Record<string, unknown>>;
  // Returned verbatim on a successful write.
  readonly successData: TSuccessData;
  // Optional idempotent short-circuit. When `check(me)` is true, the flow
  // skips the write entirely and returns `data` — but keeps the burn
  // intact, because the token's job is done (state already matches what
  // the write would have produced). A second click sees `already-used`.
  readonly alreadyDone?: {
    readonly check: (me: AuthUserRow) => boolean;
    readonly data: TSuccessData;
  };
};

export async function runConfirmTokenFlow<TSuccessData>(
  ctx: HandlerContext,
  userId: string,
  expiresAtMs: number,
  spec: ConfirmTokenFlowSpec<TSuccessData>,
): Promise<WriteResult<TSuccessData>> {
  if (!ctx.redis) {
    return writeFailure(new InternalError({ message: spec.redisRequiredMessage }));
  }
  const redis: Redis = ctx.redis;

  const burn = await burnToken(redis, spec.purpose, userId, expiresAtMs);
  if (burn === "already-used") return spec.invalidToken();

  let committed = false;
  try {
    // Cross-tenant queries run under a SYSTEM_TENANT-scoped identity;
    // user-feature is r.systemScope so this bypasses the tenant filter.
    const systemUser = createSystemUser(SYSTEM_TENANT_ID);

    const me = await loadValidatedUser(ctx, systemUser, userId);
    if (!me) return spec.invalidToken();

    if (spec.alreadyDone?.check(me)) {
      // Token job is done — keep the burn intact. A replay from another
      // device lands cleanly on the already-used branch above.
      committed = true;
      return { isSuccess: true, data: spec.alreadyDone.data };
    }

    const tenantOrder = await resolveStreamTenants(ctx, systemUser, me);
    if (tenantOrder.length === 0) return spec.invalidToken();

    const changes = await spec.buildChanges(me);
    const writeResult = await tryWriteAcrossTenants(ctx, me, tenantOrder, changes);
    if (writeResult.isSuccess) {
      committed = true;
      return { isSuccess: true, data: spec.successData };
    }
    // `all_conflicts` = every tenant returned version_conflict → token-level
    // failure. `hard_failure` = a real write error (DB down, access
    // denied) that bubbles unchanged.
    if (writeResult.reason === "all_conflicts") return spec.invalidToken();
    return writeResult.failure;
  } finally {
    // committed===false covers EVERY failure path — including branches a
    // future maintainer adds without reading this file. The original
    // handlers had ~7 explicit unburn calls; any forgotten one would
    // have locked the token. Flag pattern is robust-by-default.
    if (!committed) {
      await unburnToken(redis, spec.purpose, userId, expiresAtMs);
    }
  }
}

// --- Private helpers ------------------------------------------------------

// Fetches the user row via the privileged findForAuth query and validates
// it's usable for a write: not deleted, has a row.version (the version
// column is a findForAuth contract field — absence is a schema bug, but
// we still handle it gracefully rather than throwing past the burn).
// Return type narrows `version` to `number` so the write-callsite doesn't
// need a `?? 0` fallback — the guard lives here, not at every callsite.
async function loadValidatedUser(
  ctx: HandlerContext,
  systemUser: SessionUser,
  userId: string,
): Promise<(AuthUserRow & { version: number }) | null> {
  const me = parseAuthUserRow(
    await ctx.queryAs(systemUser, UserQueries.findForAuth, { id: userId }),
  );
  if (!me || me.isDeleted || me.version === undefined) return null;
  return { ...me, version: me.version };
}

// Loads the user's memberships and returns a prioritised tenant list.
// Empty when the user has no memberships at all — the caller treats that
// as invalid_token (a user without memberships can't own a usable auth
// flow anyway, and a deterministic early-return is cleaner than
// discovering it at write time).
async function resolveStreamTenants(
  ctx: HandlerContext,
  systemUser: SessionUser,
  me: AuthUserRow,
): Promise<readonly TenantId[]> {
  const memberships = (await ctx.queryAs(systemUser, "tenant:query:memberships", {
    userId: me.id,
  })) as Array<{ tenantId: TenantId }>;
  return orderTenantsByPreference(memberships, me.lastActiveTenantId);
}

// Discriminated result for the write-across-tenants loop.
//   all_conflicts → every candidate rejected with version_conflict →
//                   token-level failure; caller returns invalidToken.
//   hard_failure  → a non-conflict error that should bubble unchanged
//                   (DB down, access denied, …); caller returns it as-is.
type TenantWriteResult =
  | { isSuccess: true }
  | { isSuccess: false; reason: "all_conflicts" }
  | { isSuccess: false; reason: "hard_failure"; failure: WriteFailure };

// Attempts the update against each candidate stream. memberships-query
// has no deterministic ORDER BY, so the matching stream is discovered by
// attempt: version_conflict → try the next candidate, anything else →
// bubble immediately so ops sees the real failure class.
async function tryWriteAcrossTenants(
  ctx: HandlerContext,
  me: AuthUserRow & { version: number },
  tenantOrder: readonly TenantId[],
  changes: Record<string, unknown>,
): Promise<TenantWriteResult> {
  for (const tenantId of tenantOrder) {
    const writeRes = await ctx.writeAs(createSystemUser(tenantId), UserHandlers.update, {
      id: me.id,
      version: me.version,
      changes,
    });
    if (writeRes.isSuccess) return { isSuccess: true };
    if (writeRes.error.code !== "version_conflict") {
      return { isSuccess: false, reason: "hard_failure", failure: writeRes };
    }
  }
  return { isSuccess: false, reason: "all_conflicts" };
}
