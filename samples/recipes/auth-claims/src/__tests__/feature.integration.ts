// Auth Claims Sample — Integration Test
//
// Drives the resolver end-to-end: features register r.claimKey() + r.authClaims(),
// the resolver runs the hooks in parallel, merges the results under auto-prefixed
// keys, and readClaim(user, handle) retrieves them with proper JS typing.

import type { AuthClaimsContext } from "@kumiko/framework/engine";
import { defineFeature, readClaim } from "@kumiko/framework/engine";
import { resolveAuthClaims } from "@kumiko/framework/pipeline";
import { setupTestStack, type TestStack, testTenantId } from "@kumiko/framework/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  type BetaFlagStore,
  fakeSession,
  makeBetaFlagsFeature,
  makeBrokenFeature,
  makeDriftFeature,
  makeTeamsFeature,
  type TeamStore,
} from "../feature";

// Stores are mutated in place across tests (cleared in beforeEach). The
// features capture them by closure at registration time.
const teamStore: TeamStore = new Map();
const betaFlagStore: BetaFlagStore = new Map();
const driftState = { value: false };

// Build the features once so we can reach the typed handles via the
// returned `exports.Claims` maps. The test suite references these handles
// when asserting — no hand-written qualified strings.
const teamsFeature = makeTeamsFeature(teamStore);
const betaFlagsFeature = makeBetaFlagsFeature(betaFlagStore);
const brokenFeature = makeBrokenFeature();
const driftFeature = makeDriftFeature(driftState);

const TeamsClaims = teamsFeature.exports.Claims;
const BetaClaims = betaFlagsFeature.exports.Claims;

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [teamsFeature, betaFlagsFeature, brokenFeature, driftFeature],
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(() => {
  teamStore.clear();
  betaFlagStore.clear();
  driftState.value = false;
});

// The resolver needs an AuthClaimsContext per hook run. This sample doesn't
// exercise ctx.db or ctx.queryAs — real features would, and that's the
// point of the fresh TenantDb the dispatcher builds. A stub is fine here.
const stubContext: AuthClaimsContext = {
  db: {} as AuthClaimsContext["db"],
  queryAs: async () => {
    throw new Error("queryAs not exercised in this sample");
  },
};

const tenantA = testTenantId(1);
const userAlice = "11111111-0000-4000-8000-000000000001";

describe("scenario 1: typed readClaim access", () => {
  test("feature hook sets the value → readClaim returns it narrowed to the handle's JS type", async () => {
    teamStore.set(userAlice, "eng");
    betaFlagStore.set(userAlice, ["dark-mode", "new-checkout"]);

    const user = fakeSession(userAlice, tenantA);
    const claims = await resolveAuthClaims({
      user,
      hooks: stack.registry.getAuthClaimsHooks(),
      contextFactory: () => stubContext,
    });
    const userWithClaims = { ...user, claims };

    // readClaim narrows to `string | undefined` for the teamId handle — no
    // manual `as string`, no magic key-string.
    const teamId = readClaim(userWithClaims, TeamsClaims.teamId);
    expect(teamId).toBe("eng");

    // readClaim narrows to `readonly string[] | undefined` for flags.
    const flags = readClaim(userWithClaims, BetaClaims.flags);
    expect(flags).toEqual(["dark-mode", "new-checkout"]);
  });

  test("feature hook returns empty → readClaim returns undefined", async () => {
    const user = fakeSession(userAlice, tenantA);
    const claims = await resolveAuthClaims({
      user,
      hooks: stack.registry.getAuthClaimsHooks(),
      contextFactory: () => stubContext,
    });
    const userWithClaims = { ...user, claims };

    expect(readClaim(userWithClaims, TeamsClaims.teamId)).toBeUndefined();
    expect(readClaim(userWithClaims, BetaClaims.flags)).toBeUndefined();
  });
});

describe("scenario 2: best-effort policy — broken hook does not fail the login", () => {
  test("broken feature throws → other features still contribute their claims", async () => {
    teamStore.set(userAlice, "eng");

    const user = fakeSession(userAlice, tenantA);
    const claims = await resolveAuthClaims({
      user,
      hooks: stack.registry.getAuthClaimsHooks(),
      contextFactory: () => stubContext,
    });
    const userWithClaims = { ...user, claims };

    expect(readClaim(userWithClaims, TeamsClaims.teamId)).toBe("eng");
    expect("broken:anything" in claims).toBe(false);
  });
});

describe("scenario 3: drift-warning when a hook returns an undeclared key", () => {
  test("declared teamId + undeclared 'rouge' → warn logged, both land in JWT (best-effort)", async () => {
    driftState.value = true;

    const warn = vi.fn();
    const log = {
      warn,
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: () => log,
    };

    const user = fakeSession(userAlice, tenantA);
    const claims = await resolveAuthClaims({
      user,
      hooks: stack.registry.getAuthClaimsHooks(),
      contextFactory: () => stubContext,
      log,
    });

    // Both claims are present — the drift-check is advisory, not strict.
    expect(claims["drift:teamId"]).toBe("declared");
    expect(claims["drift:rouge"]).toBe("undeclared");

    const driftWarns = warn.mock.calls.filter(
      (c) => (c[1] as { featureName?: string })?.featureName === "drift",
    );
    expect(driftWarns).toHaveLength(1);
    expect(driftWarns[0]?.[1]).toMatchObject({
      featureName: "drift",
      undeclaredKey: "rouge",
    });
  });
});

describe("scenario 4: auto-prefix prevents cross-feature collisions on same inner key", () => {
  test("two features returning the SAME inner key `teamId` coexist under separate prefixes", async () => {
    const billingWithTeamId = defineFeature("billing", (r) => {
      const teamId = r.claimKey("teamId", { type: "string" });
      r.authClaims(async (user) => (user.id === userAlice ? { teamId: "billing-A" } : {}));
      return { Claims: { teamId } as const };
    });

    teamStore.set(userAlice, "eng");

    const collisionStack = await setupTestStack({
      features: [makeTeamsFeature(teamStore), billingWithTeamId],
    });
    try {
      const user = fakeSession(userAlice, tenantA);
      const claims = await resolveAuthClaims({
        user,
        hooks: collisionStack.registry.getAuthClaimsHooks(),
        contextFactory: () => stubContext,
      });

      expect(claims["teams:teamId"]).toBe("eng");
      expect(claims["billing:teamId"]).toBe("billing-A");
    } finally {
      await collisionStack.cleanup();
    }
  });
});
