import { describe, expect, test } from "bun:test";
import { createRegistry, defineFeature, readClaim } from "../index";
import type { ClaimKeyHandle, SessionUser } from "../types";

// --- r.claimKey() registration ---

describe("r.claimKey() — registration", () => {
  test("feature without claimKey has an empty claimKeys record", () => {
    const feature = defineFeature("plain", () => {});
    expect(feature.claimKeys).toEqual({});
  });

  test("single claimKey is stored with qualified name '<feature>:<shortName>' (no kebab conversion)", () => {
    const feature = defineFeature("drivers", (r) => {
      r.claimKey("teamId", { type: "string" });
    });
    expect(feature.claimKeys["teamId"]).toBeDefined();
    // Claim keys are NOT QNs — they keep the raw camelCase shortName so the
    // authClaims resolver's `<feature>:<innerKey>` merge finds them.
    expect(feature.claimKeys["teamId"]?.qualifiedName).toBe("drivers:teamId");
    expect(feature.claimKeys["teamId"]?.type).toBe("string");
  });

  test("returns a typed ClaimKeyHandle whose `name` is the qualified key", () => {
    let handle: ClaimKeyHandle | undefined;
    defineFeature("drivers", (r) => {
      handle = r.claimKey("teamId", { type: "string" });
    });
    expect(handle?.name).toBe("drivers:teamId");
    expect(handle?.type).toBe("string");
  });

  test("duplicate short-name within one feature throws", () => {
    expect(() =>
      defineFeature("drivers", (r) => {
        r.claimKey("teamId", { type: "string" });
        r.claimKey("teamId", { type: "number" });
      }),
    ).toThrow(/Claim key "teamId" already declared/);
  });

  test("camelCase feature + shortName are preserved as-is", () => {
    const feature = defineFeature("driverOrders", (r) => {
      r.claimKey("regionId", { type: "string" });
    });
    expect(feature.claimKeys["regionId"]?.qualifiedName).toBe("driverOrders:regionId");
  });
});

// --- Registry aggregation ---

describe("Registry.getAllClaimKeys / getClaimKey", () => {
  test("aggregates keys from all features", () => {
    const drivers = defineFeature("drivers", (r) => {
      r.claimKey("teamId", { type: "string" });
      r.claimKey("regionId", { type: "number" });
    });
    const billing = defineFeature("billing", (r) => {
      r.claimKey("plan", { type: "string" });
    });
    const reg = createRegistry([drivers, billing]);

    const all = reg.getAllClaimKeys();
    expect(all.size).toBe(3);
    expect(all.has("drivers:teamId")).toBe(true);
    expect(all.has("drivers:regionId")).toBe(true);
    expect(all.has("billing:plan")).toBe(true);
  });

  test("getClaimKey returns the definition by qualified name", () => {
    const drivers = defineFeature("drivers", (r) => {
      r.claimKey("teamId", { type: "string" });
    });
    const reg = createRegistry([drivers]);

    const def = reg.getClaimKey("drivers:teamId");
    expect(def?.type).toBe("string");
    expect(def?.shortName).toBe("teamId");
  });

  test("unknown qualified name → undefined", () => {
    const reg = createRegistry([]);
    expect(reg.getClaimKey("whoever:xyz")).toBeUndefined();
  });
});

// --- readClaim() helper ---

describe("readClaim() — type-narrowed claim access", () => {
  const baseUser: SessionUser = {
    id: "11111111-0000-4000-8000-000000000001",
    tenantId: "22222222-0000-4000-8000-000000000001",
    roles: ["User"],
  };

  function userWithClaims(claims: Record<string, unknown>): SessionUser {
    return { ...baseUser, claims };
  }

  test("returns the value cast to the handle's JS type — string", () => {
    const drivers = defineFeature("drivers", (r) => {
      r.claimKey("teamId", { type: "string" });
    });
    const handle = drivers.claimKeys["teamId"];
    if (!handle) throw new Error("handle missing");
    const typedHandle: ClaimKeyHandle<"string"> = { name: handle.qualifiedName, type: "string" };

    const user = userWithClaims({ "drivers:teamId": "eng" });
    const teamId = readClaim(user, typedHandle);
    // Type-narrowing: TS treats this as `string | undefined` — we just
    // assert the runtime value came through untouched.
    expect(teamId).toBe("eng");
  });

  test("number type", () => {
    const handle: ClaimKeyHandle<"number"> = {
      name: "drivers:region-id",
      type: "number",
    };
    const user = userWithClaims({ "drivers:region-id": 7 });
    expect(readClaim(user, handle)).toBe(7);
  });

  test("boolean type", () => {
    const handle: ClaimKeyHandle<"boolean"> = {
      name: "flags:is-beta",
      type: "boolean",
    };
    const user = userWithClaims({ "flags:is-beta": true });
    expect(readClaim(user, handle)).toBe(true);
  });

  test("string[] type", () => {
    const handle: ClaimKeyHandle<"string[]"> = {
      name: "flags:enabled",
      type: "string[]",
    };
    const user = userWithClaims({ "flags:enabled": ["dark-mode", "new-checkout"] });
    expect(readClaim(user, handle)).toEqual(["dark-mode", "new-checkout"]);
  });

  test("object type", () => {
    const handle: ClaimKeyHandle<"object"> = {
      name: "drivers:metadata",
      type: "object",
    };
    const user = userWithClaims({ "drivers:metadata": { level: 5, tags: ["a"] } });
    expect(readClaim(user, handle)).toEqual({ level: 5, tags: ["a"] });
  });

  test("undefined when user has no claims at all", () => {
    const handle: ClaimKeyHandle<"string"> = {
      name: "drivers:team-id",
      type: "string",
    };
    // baseUser has no `claims` field at all.
    expect(readClaim(baseUser, handle)).toBeUndefined();
  });

  test("undefined when claims is set but the specific key is missing", () => {
    const handle: ClaimKeyHandle<"string"> = {
      name: "drivers:team-id",
      type: "string",
    };
    const user = userWithClaims({ "other:key": "x" });
    expect(readClaim(user, handle)).toBeUndefined();
  });

  test("null value is treated the same as missing — returns undefined", () => {
    // A feature that returned null instead of an actual string shouldn't
    // surface as "null" through the typed helper — the contract is
    // "present or undefined".
    const handle: ClaimKeyHandle<"string"> = {
      name: "drivers:team-id",
      type: "string",
    };
    const user = userWithClaims({ "drivers:team-id": null });
    expect(readClaim(user, handle)).toBeUndefined();
  });
});

// --- Round-trip: r.claimKey → r.authClaims return → resolver merge → readClaim ---
//
// Regression guard against the class of bugs where the three stages of a
// claim's lifecycle disagree on the key string:
//
//   1. r.claimKey creates the handle (`handle.name`)
//   2. r.authClaims hook returns `{ inner: value }` — framework prefixes
//      to `"<feature>:<inner>"` at merge time
//   3. readClaim(user, handle) looks up `user.claims[handle.name]`
//
// If any stage applies a different transform (kebab-case on one side but
// not the other, different prefix convention, ...) the round-trip silently
// breaks — readClaim returns undefined even though the hook returned a
// value. This test wires all three against a single feature definition so
// any such drift surfaces as a failing unit test, not a broken sample.

describe("round-trip: claimKey ↔ authClaims return ↔ readClaim", () => {
  test("value set by the hook is retrievable via the handle from the same feature", async () => {
    // Arrange a feature that declares a claim AND produces a value for it.
    // The hook captures a closure-scoped value so the test can assert
    // the hook's return survives merge + readClaim untouched.
    const driverData = new Map<string, string>();
    driverData.set("user-1", "team-alpha");

    const feature = defineFeature("drivers", (r) => {
      const teamId = r.claimKey("teamId", { type: "string" });
      r.authClaims(async (user) => {
        const team = driverData.get(user.id);
        return team ? { teamId: team } : {};
      });
      return { Claims: { teamId } as const };
    });

    // Run the resolver directly — same code path the Dispatcher walks.
    const { resolveAuthClaims } = await import("../../pipeline/auth-claims-resolver");
    const reg = createRegistry([feature]);
    const user: SessionUser = {
      id: "user-1",
      tenantId: "22222222-0000-4000-8000-000000000001",
      roles: ["User"],
    };

    const claims = await resolveAuthClaims({
      user,
      hooks: reg.getAuthClaimsHooks(),
      contextFactory: () => ({
        db: {} as never,
        queryAs: async () => {
          throw new Error("unused");
        },
      }),
    });

    // readClaim on the SAME handle produced at registration finds the value.
    const userWithClaims: SessionUser = { ...user, claims };
    const teamId = readClaim(userWithClaims, feature.exports.Claims.teamId);
    expect(teamId).toBe("team-alpha");
  });

  test("round-trip works for non-trivial feature names (camelCase preserved, not kebab'd)", async () => {
    // This was the exact bug the kumiko dev-loop caught in the sample —
    // early impl kebab'd the handle name but the resolver merged with the
    // raw camelCase key, so readClaim missed. Lock the camelCase path in.
    const feature = defineFeature("driverOrders", (r) => {
      const regionId = r.claimKey("regionId", { type: "number" });
      r.authClaims(async () => ({ regionId: 42 }));
      return { Claims: { regionId } as const };
    });

    const { resolveAuthClaims } = await import("../../pipeline/auth-claims-resolver");
    const reg = createRegistry([feature]);
    const user: SessionUser = {
      id: "user-1",
      tenantId: "22222222-0000-4000-8000-000000000001",
      roles: ["User"],
    };

    const claims = await resolveAuthClaims({
      user,
      hooks: reg.getAuthClaimsHooks(),
      contextFactory: () => ({
        db: {} as never,
        queryAs: async () => {
          throw new Error("unused");
        },
      }),
    });

    expect(claims["driverOrders:regionId"]).toBe(42);
    const userWithClaims: SessionUser = { ...user, claims };
    expect(readClaim(userWithClaims, feature.exports.Claims.regionId)).toBe(42);
  });
});
