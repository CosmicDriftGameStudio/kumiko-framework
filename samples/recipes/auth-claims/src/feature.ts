// Auth Claims Sample
//
// Shows how features contribute identity facts into SessionUser.claims via
// `r.authClaims()`, and how handlers read those facts back with typed
// handles from `r.claimKey()` + the `readClaim(user, handle)` helper.
//
// Why the handle pattern: reading `user.claims["teams:teamId"] as string`
// hand-codes the qualified name (magic string, breaks under a rename) and
// casts without the compiler's help. A declared handle threads the qualified
// name and JS type through `readClaim<T>(user, handle)`, so a rename in
// `r.claimKey("teamId", ...)` cascades to every call site, and `readClaim`
// narrows the return type to `string | undefined` automatically.
//
// Design rules the sample bakes in:
//  1. Auto-prefix means cross-feature keys cannot collide. Feature "teams"
//     returning `{ teamId: ... }` lands at `"teams:teamId"`. Feature
//     "billing" returning the same inner key lands at `"billing:teamId"`.
//     Both coexist.
//  2. Best-effort errors: if one feature's hook throws, that feature's
//     claims are missing from the JWT, but the login still succeeds.
//     Identity-facts are convenience, not access-gates.
//  3. Hook context is trimmed (AuthClaimsContext, not HandlerContext) —
//     login is a read, so appendEvent/archive/tz aren't available. queryAs
//     + db cover the cross-feature lookups a claims-hook realistically
//     needs.
//  4. Declaring claim keys via r.claimKey also turns on a runtime drift-
//     check: if a hook returns an undeclared inner-key, the resolver logs
//     a warning (the claim still lands in the JWT — this is typo
//     protection, not strict schema).

import {
  createEntity,
  createTextField,
  defineFeature,
  type SessionUser,
  type TenantId,
} from "@kumiko/framework/engine";

export const teamMembershipEntity = createEntity({
  table: "read_sample_auth_team_memberships",
  fields: {
    userId: createTextField({ required: true }),
    teamId: createTextField({ required: true }),
  },
});

export const betaFlagsEntity = createEntity({
  table: "read_sample_auth_beta_flags",
  fields: {
    userId: createTextField({ required: true }),
    flag: createTextField({ required: true }),
  },
});

// Plain in-memory state that the hooks read from — keeps the sample focused
// on the claim mechanism, not on DB seeding. A real feature would SELECT
// from its own table via ctx.db.
export type TeamStore = Map<string, string>;
export type BetaFlagStore = Map<string, readonly string[]>;

// Feature: Teams. Declares a typed `teamId` claim and a hook that fills it.
// The setup callback returns an `exports` object carrying the handles — the
// test (or any other feature) imports them via `teamsFeature.exports.Claims`
// without knowing or re-typing the qualified name.
export function makeTeamsFeature(store: TeamStore) {
  return defineFeature("teams", (r) => {
    const teamId = r.claimKey("teamId", { type: "string" });

    r.authClaims(async (user: SessionUser) => {
      const value = store.get(user.id);
      return value ? { teamId: value } : {};
    });

    return { Claims: { teamId } as const };
  });
}

// Feature: BetaFlags. Array claim — shows the handle's type parameter
// narrowing for non-scalar values.
export function makeBetaFlagsFeature(store: BetaFlagStore) {
  return defineFeature("betaFlags", (r) => {
    const flags = r.claimKey("flags", { type: "string[]" });

    r.authClaims(async (user: SessionUser) => {
      const value = store.get(user.id);
      return value && value.length > 0 ? { flags: value } : {};
    });

    return { Claims: { flags } as const };
  });
}

// Feature: Broken. Demonstrates the best-effort policy — this hook always
// throws. The tests assert that a broken hook does not fail the login and
// the other features' claims still land in the JWT.
export function makeBrokenFeature() {
  return defineFeature("broken", (r) => {
    r.authClaims(async () => {
      throw new Error("pretend the DB just disappeared");
    });
  });
}

// Feature: Drift — declares `teamId` but its hook returns `rouge` as well.
// Exercises the drift-warning that r.claimKey unlocks: the resolver logs a
// warn for `rouge` but still merges both into the JWT (best-effort).
export function makeDriftFeature(shouldFire: { value: boolean }) {
  return defineFeature("drift", (r) => {
    r.claimKey("teamId", { type: "string" });

    r.authClaims(async () => {
      if (!shouldFire.value) return {};
      return { teamId: "declared", rouge: "undeclared" };
    });
  });
}

// Helper used by tests to build a fake session for a given user/tenant.
// The sample avoids requiring the full auth-email-password feature —
// the claim-resolver mechanism is tested directly.
export function fakeSession(userId: string, tenantId: TenantId): SessionUser {
  return { id: userId, tenantId, roles: ["User"] };
}
