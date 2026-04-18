import { describe, expect, test, vi } from "vitest";
import type { AuthClaimsContext, AuthClaimsHookDef, SessionUser } from "../../engine/types";
import type { Logger } from "../../logging/types";
import { resolveAuthClaims } from "../auth-claims-resolver";

type TestLogger = {
  readonly log: Logger;
  readonly warn: ReturnType<typeof vi.fn>;
};

function makeTestLogger(): TestLogger {
  const warn = vi.fn();
  const info = vi.fn();
  const error = vi.fn();
  const debug = vi.fn();
  const logger: Logger = {
    warn,
    info,
    error,
    debug,
    child: () => logger,
  };
  return { log: logger, warn };
}

const testUser: SessionUser = {
  id: "11111111-0000-4000-8000-000000000001",
  tenantId: "22222222-0000-4000-8000-000000000001",
  roles: ["User"],
};

// The resolver doesn't actually USE the AuthClaimsContext — it passes it
// through to each hook. For unit tests we only need the shape; we don't
// construct a real TenantDb.
const stubContext: AuthClaimsContext = {
  db: {} as AuthClaimsContext["db"],
  queryAs: async () => {
    throw new Error("queryAs not implemented in stub");
  },
};

function hooks(...entries: AuthClaimsHookDef[]): readonly AuthClaimsHookDef[] {
  return entries;
}

describe("resolveAuthClaims — empty", () => {
  test("zero hooks registered → empty record, contextFactory not called", async () => {
    const factory = vi.fn();
    const result = await resolveAuthClaims({
      user: testUser,
      hooks: [],
      contextFactory: factory,
    });
    expect(result).toEqual({});
    expect(factory).not.toHaveBeenCalled();
  });
});

describe("resolveAuthClaims — single hook", () => {
  test("feature's keys get prefixed with <featureName>:", async () => {
    const result = await resolveAuthClaims({
      user: testUser,
      hooks: hooks({
        featureName: "drivers",
        fn: async () => ({ teamId: "t-1", regionId: "r-7" }),
      }),
      contextFactory: () => stubContext,
    });
    expect(result).toEqual({
      "drivers:teamId": "t-1",
      "drivers:regionId": "r-7",
    });
  });

  test("receives the user and context handed in", async () => {
    const fn = vi.fn(async () => ({}));
    const factory = vi.fn(() => stubContext);
    await resolveAuthClaims({
      user: testUser,
      hooks: hooks({ featureName: "any", fn }),
      contextFactory: factory,
    });
    expect(fn).toHaveBeenCalledWith(testUser, stubContext);
    expect(factory).toHaveBeenCalledWith(testUser);
    expect(factory).toHaveBeenCalledTimes(1);
  });
});

describe("resolveAuthClaims — multiple hooks", () => {
  test("two features run in parallel and both contribute claims", async () => {
    const ordering: string[] = [];
    const result = await resolveAuthClaims({
      user: testUser,
      hooks: hooks(
        {
          featureName: "drivers",
          fn: async () => {
            ordering.push("drivers");
            return { teamId: "t-1" };
          },
        },
        {
          featureName: "billing",
          fn: async () => {
            ordering.push("billing");
            return { plan: "pro" };
          },
        },
      ),
      contextFactory: () => stubContext,
    });
    expect(result).toEqual({
      "drivers:teamId": "t-1",
      "billing:plan": "pro",
    });
    // Promise.allSettled fires both; order of push() can vary but both must run.
    expect(ordering.sort()).toEqual(["billing", "drivers"]);
  });

  test("auto-prefix eliminates cross-feature collisions on the SAME inner key", async () => {
    const result = await resolveAuthClaims({
      user: testUser,
      hooks: hooks(
        { featureName: "drivers", fn: async () => ({ teamId: "t-drivers" }) },
        { featureName: "billing", fn: async () => ({ teamId: "t-billing" }) },
      ),
      contextFactory: () => stubContext,
    });
    expect(result).toEqual({
      "drivers:teamId": "t-drivers",
      "billing:teamId": "t-billing",
    });
  });
});

describe("resolveAuthClaims — same-feature duplicate hooks", () => {
  test("last-wins within one feature", async () => {
    // Two r.authClaims() calls in the same feature both return `plan`.
    // The second registration wins (matches the JWT-layer spread semantics).
    const result = await resolveAuthClaims({
      user: testUser,
      hooks: hooks(
        { featureName: "billing", fn: async () => ({ plan: "free" }) },
        { featureName: "billing", fn: async () => ({ plan: "enterprise" }) },
      ),
      contextFactory: () => stubContext,
    });
    expect(result["billing:plan"]).toBe("enterprise");
  });
});

describe("resolveAuthClaims — error policy (best-effort)", () => {
  test("one hook throws → its feature contributes nothing, others unaffected", async () => {
    const { log, warn } = makeTestLogger();
    const result = await resolveAuthClaims({
      user: testUser,
      hooks: hooks(
        {
          featureName: "broken",
          fn: async () => {
            throw new Error("db blew up");
          },
        },
        {
          featureName: "healthy",
          fn: async () => ({ teamId: "t-1" }),
        },
      ),
      contextFactory: () => stubContext,
      log,
    });
    // healthy feature's claims make it into the record; broken feature's do not.
    expect(result).toEqual({ "healthy:teamId": "t-1" });
    // The warn should mention the feature name so ops can pinpoint the hook.
    expect(warn).toHaveBeenCalledTimes(1);
    const [warnMsg, warnData] = warn.mock.calls[0] ?? [];
    expect(String(warnMsg)).toContain("authClaims");
    expect(warnData).toMatchObject({ featureName: "broken" });
  });

  test("every hook throws → result is still an object (login does not fail)", async () => {
    const { log } = makeTestLogger();
    const result = await resolveAuthClaims({
      user: testUser,
      hooks: hooks(
        {
          featureName: "a",
          fn: async () => {
            throw new Error("x");
          },
        },
        {
          featureName: "b",
          fn: async () => {
            throw new Error("y");
          },
        },
      ),
      contextFactory: () => stubContext,
      log,
    });
    expect(result).toEqual({});
  });
});

describe("resolveAuthClaims — reserved separator guard", () => {
  test("a key containing ':' is dropped with a warning (keeps prefix owned by framework)", async () => {
    const { log, warn } = makeTestLogger();
    const result = await resolveAuthClaims({
      user: testUser,
      hooks: hooks({
        featureName: "smart",
        // A feature that tries to sneak in its own prefix would bypass
        // auto-prefix intent — so we reject such keys rather than double-prefix.
        fn: async () => ({ "evil:teamId": "nope", okKey: "yes" }),
      }),
      contextFactory: () => stubContext,
      log,
    });
    expect(result).toEqual({ "smart:okKey": "yes" });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("resolveAuthClaims — declaredKeys drift warning", () => {
  test("hook returns a key NOT in declaredKeys → warn, but claim still lands in JWT", async () => {
    const { log, warn } = makeTestLogger();
    const result = await resolveAuthClaims({
      user: testUser,
      hooks: hooks({
        featureName: "drivers",
        // Feature declared `teamId` but the hook also returns `rouge` — the
        // resolver flags it (typo/rename protection) but still merges it in,
        // honoring best-effort.
        declaredKeys: new Set(["teamId"]),
        fn: async () => ({ teamId: "t-1", rouge: "x" }),
      }),
      contextFactory: () => stubContext,
      log,
    });
    expect(result).toEqual({
      "drivers:teamId": "t-1",
      "drivers:rouge": "x",
    });
    expect(warn).toHaveBeenCalledTimes(1);
    const [, data] = warn.mock.calls[0] ?? [];
    expect(data).toMatchObject({ featureName: "drivers", undeclaredKey: "rouge" });
  });

  test("declaredKeys undefined → never warn, backwards-compat for ad-hoc hooks", async () => {
    const { log, warn } = makeTestLogger();
    await resolveAuthClaims({
      user: testUser,
      hooks: hooks({
        featureName: "legacy",
        // No declaredKeys on this hook — legacy hooks don't opt in.
        fn: async () => ({ anything: 1, else: 2 }),
      }),
      contextFactory: () => stubContext,
      log,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  test("all returned keys declared → silent", async () => {
    const { log, warn } = makeTestLogger();
    await resolveAuthClaims({
      user: testUser,
      hooks: hooks({
        featureName: "drivers",
        declaredKeys: new Set(["teamId", "regionId"]),
        fn: async () => ({ teamId: "t-1", regionId: 7 }),
      }),
      contextFactory: () => stubContext,
      log,
    });
    expect(warn).not.toHaveBeenCalled();
  });
});
