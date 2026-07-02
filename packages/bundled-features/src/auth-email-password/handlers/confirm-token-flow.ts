// Shared state-change pipeline for the confirm side of out-of-band token
// flows (password-reset, email-verification). Both follow the same shape
// once the token is verified:
//
//   1. Redis check + burn (single-use enforcement)
//   2. Load user + deleted/missing/no-version guard
//   3. Optional idempotent short-circuit (verify-email when already done)
//   4. Apply the handler-specific `changes` on the user's SYSTEM stream
//   5. Release the burn on ANY non-success path so a legit retry isn't
//      locked out by a stale marker
//
// The top-level `runConfirmTokenFlow` orchestrates and owns the
// try/finally burn-release. Every branch that should NOT release the
// burn (success, already-done) flips `committed = true`; everything
// else — including future branches a maintainer adds — releases
// automatically.
//
// The user aggregate is systemStream (#497): its event stream lives on
// SYSTEM_TENANT_ID deterministically, so the write targets exactly one
// stream. The former membership-probing (`tryWriteAcrossTenants`) existed
// for pre-#497 scattered streams; those need the one-time
// backfillUserStreamTenants migration (#762) — probing them stopped working
// the moment the executor's stream choke-point landed anyway.

import {
  createSystemUser,
  type HandlerContext,
  type SessionUser,
  SYSTEM_TENANT_ID,
  type WriteResult,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import type Redis from "ioredis";
import { UserHandlers, UserQueries } from "../../user";
import type { AuthUserRow } from "../auth-user-row";
import { parseAuthUserRow } from "../auth-user-row";
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
  // (bad state, version conflict on the stream). The route layer returns
  // 422 with a uniform code so the caller can't tell which branch fired.
  readonly invalidToken: () => ReturnType<typeof writeFailure>;
  // Handler-specific payload for user:update. Runs once per token. Can be
  // async (password-reset hashes here).
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

    const changes = await spec.buildChanges(me);
    const writeRes = await ctx.writeAs(systemUser, UserHandlers.update, {
      id: me.id,
      version: me.version,
      changes,
    });
    if (writeRes.isSuccess) {
      committed = true;
      return { isSuccess: true, data: spec.successData };
    }
    // version_conflict = concurrent modification (or an un-migrated pre-#497
    // stream, see header) → token-level failure. Anything else (DB down,
    // access denied) bubbles unchanged so ops sees the real failure class.
    if (writeRes.error.code === "version_conflict") return spec.invalidToken();
    return writeRes;
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

// Fetches the user row via the privileged findForAuth query and validates
// it's usable for a write: not deleted, has a row.version >= 1 (a row
// without any event stream — e.g. inserted straight into read_users — must
// not be confirmable: the write would otherwise seed a fresh stream with a
// bare user.updated). Return type narrows `version` to `number` so the
// write-callsite doesn't need a `?? 0` fallback — the guard lives here,
// not at every callsite.
async function loadValidatedUser(
  ctx: HandlerContext,
  systemUser: SessionUser,
  userId: string,
): Promise<(AuthUserRow & { version: number }) | null> {
  const me = parseAuthUserRow(
    await ctx.queryAs(systemUser, UserQueries.findForAuth, { id: userId }),
  );
  if (!me || me.isDeleted || me.version === undefined || me.version < 1) return null;
  return { ...me, version: me.version };
}
