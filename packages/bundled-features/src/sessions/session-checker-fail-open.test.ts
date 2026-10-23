import { describe, expect, spyOn, test } from "bun:test";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import * as bunDb from "@cosmicdrift/kumiko-framework/db";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { tenantMembershipsTable } from "../tenant/membership-table.ts";
import { USER_STATUS, userTable } from "../user/schema/user.ts";
import { userSessionTable } from "./schema/user-session.ts";
import { createSessionCallbacks } from "./session-callbacks.ts";

// Unit-only: the fail-open-on-throw branch cannot be provoked through real
// Postgres without faking infrastructure failure. Integration tests forbid
// mocks, so this lives next to the source as a plain *.test.ts.

type FetchOne = typeof bunDb.fetchOne;

describe("sessionChecker fail-open on user-lookup throw", () => {
  test("read_users THROW → live (not 500 / not blocked)", async () => {
    const db = {} as DbConnection;
    const cbs = createSessionCallbacks({ db });
    const sid = "00000000-0000-4000-8000-00000000sid1";
    const userId = "00000000-0000-4000-8000-00000000user";
    const farFutureMs = Temporal.Now.instant().add({ hours: 1 }).epochMilliseconds;

    const originalFetchOne = bunDb.fetchOne;
    const spy = spyOn(bunDb, "fetchOne").mockImplementation((async (_db, table) => {
      if (table === userSessionTable) {
        return {
          userId,
          revokedAt: null,
          expiresAt: { epochMilliseconds: farFutureMs },
        };
      }
      if (table === userTable) {
        throw new Error("simulated pool exhaustion");
      }
      throw new Error("unexpected table in sessionChecker spy");
    }) as FetchOne);

    try {
      expect(await cbs.sessionChecker(sid, userId)).toBe("live");
    } finally {
      spy.mockRestore();
      // Sanity: restore must put the real export back (guards against spy leak).
      expect(bunDb.fetchOne).toBe(originalFetchOne);
    }
  });

  test("read_users row hard-gone (not soft-deleted) → live, fail-open on a miss", async () => {
    // If `if (user && ...)` ever regressed to `if (!user || ...)`, a missing
    // user row would turn this second layer into a global lockout.
    const db = {} as DbConnection;
    const cbs = createSessionCallbacks({ db });
    const sid = "00000000-0000-4000-8000-00000000sid3";
    const userId = "00000000-0000-4000-8000-00000000usr3";
    const farFutureMs = Temporal.Now.instant().add({ hours: 1 }).epochMilliseconds;

    const spy = spyOn(bunDb, "fetchOne").mockImplementation((async (_db, table) => {
      if (table === userSessionTable) {
        return {
          userId,
          revokedAt: null,
          expiresAt: { epochMilliseconds: farFutureMs },
        };
      }
      if (table === userTable) {
        return undefined;
      }
      throw new Error("unexpected table in sessionChecker spy");
    }) as FetchOne);

    try {
      expect(await cbs.sessionChecker(sid, userId)).toBe("live");
    } finally {
      spy.mockRestore();
    }
  });

  test("control: Restricted user without throw → blocked (spy must hit userTable)", async () => {
    // If the spy somehow skipped the userTable branch, Restricted would still
    // be "live" via fail-open-on-null — this control pins that the throw path
    // is what we exercise above, not an accidental miss.
    const db = {} as DbConnection;
    const cbs = createSessionCallbacks({ db });
    const sid = "00000000-0000-4000-8000-00000000sid2";
    const userId = "00000000-0000-4000-8000-00000000usr2";
    const farFutureMs = Temporal.Now.instant().add({ hours: 1 }).epochMilliseconds;

    const spy = spyOn(bunDb, "fetchOne").mockImplementation((async (_db, table) => {
      if (table === userSessionTable) {
        return {
          userId,
          revokedAt: null,
          expiresAt: { epochMilliseconds: farFutureMs },
        };
      }
      if (table === userTable) {
        return { status: USER_STATUS.Restricted };
      }
      throw new Error("unexpected table in sessionChecker spy");
    }) as FetchOne);

    try {
      expect(await cbs.sessionChecker(sid, userId)).toBe("blocked");
    } finally {
      spy.mockRestore();
    }
  });

  test("membership lookup THROW → live (not 500)", async () => {
    const db = {} as DbConnection;
    const cbs = createSessionCallbacks({ db });
    const sid = "00000000-0000-4000-8000-00000000sid3";
    const userId = "00000000-0000-4000-8000-00000000usr3";
    const tenantId = "00000000-0000-4000-8000-000000tenant";
    const farFutureMs = Temporal.Now.instant().add({ hours: 1 }).epochMilliseconds;

    const spy = spyOn(bunDb, "fetchOne").mockImplementation((async (_db, table) => {
      if (table === userSessionTable) {
        return {
          userId,
          tenantId,
          revokedAt: null,
          expiresAt: { epochMilliseconds: farFutureMs },
        };
      }
      if (table === userTable) {
        return { status: USER_STATUS.Active, roles: null };
      }
      if (table === tenantMembershipsTable) {
        throw new Error("simulated pool exhaustion");
      }
      throw new Error("unexpected table in sessionChecker spy");
    }) as FetchOne);

    try {
      expect(await cbs.sessionChecker(sid, userId)).toBe("live");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("sessionChecker fail-open on lastSeenAt refresh throw", () => {
  test("updateMany THROW on refresh → live (not 500)", async () => {
    const db = {} as DbConnection;
    const cbs = createSessionCallbacks({ db });
    const sid = "00000000-0000-4000-8000-00000000sid5";
    const userId = "00000000-0000-4000-8000-00000000usr5";
    const farFutureMs = Temporal.Now.instant().add({ hours: 1 }).epochMilliseconds;

    const originalUpdateMany = bunDb.updateMany;
    const fetchSpy = spyOn(bunDb, "fetchOne").mockImplementation((async (_db, table) => {
      if (table === userSessionTable) {
        return {
          userId,
          revokedAt: null,
          expiresAt: { epochMilliseconds: farFutureMs },
          lastSeenAt: null,
        };
      }
      if (table === userTable) {
        throw new Error("simulated pool exhaustion");
      }
      throw new Error("unexpected table in sessionChecker spy");
    }) as FetchOne);
    const updateSpy = spyOn(bunDb, "updateMany").mockImplementation(async () => {
      throw new Error("simulated write failure");
    });

    try {
      expect(await cbs.sessionChecker(sid, userId)).toBe("live");
      expect(updateSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
      updateSpy.mockRestore();
      expect(bunDb.updateMany).toBe(originalUpdateMany);
    }
  });
});

describe("sessionChecker role re-derivation", () => {
  test("live session composes global + tenant-membership roles fresh from the DB", async () => {
    const db = {} as DbConnection;
    const cbs = createSessionCallbacks({ db });
    const sid = "00000000-0000-4000-8000-00000000sid4";
    const userId = "00000000-0000-4000-8000-00000000usr4";
    const tenantId = "00000000-0000-4000-8000-000000tenan2";
    const farFutureMs = Temporal.Now.instant().add({ hours: 1 }).epochMilliseconds;

    const spy = spyOn(bunDb, "fetchOne").mockImplementation((async (_db, table) => {
      if (table === userSessionTable) {
        return {
          userId,
          tenantId,
          revokedAt: null,
          expiresAt: { epochMilliseconds: farFutureMs },
        };
      }
      if (table === userTable) {
        return { status: USER_STATUS.Active, roles: JSON.stringify(["Support"]) };
      }
      if (table === tenantMembershipsTable) {
        return { roles: JSON.stringify(["User"]) };
      }
      throw new Error("unexpected table in sessionChecker spy");
    }) as FetchOne);

    try {
      const result = await cbs.sessionChecker(sid, userId);
      if (typeof result === "string") {
        throw new Error(`expected object result, got bare string "${result}"`);
      }
      expect(result.status).toBe("live");
      expect([...result.roles].sort()).toEqual(["Support", "User"]);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("sessionChecker lookup overlap", () => {
  const sid = "00000000-0000-4000-8000-0000000sid10";
  const userId = "00000000-0000-4000-8000-0000000usr10";
  const tenantId = "00000000-0000-4000-8000-00000tenan10";

  type Outcome = "ok" | "null" | "throw";

  function sessionRow() {
    return {
      userId,
      tenantId,
      revokedAt: null,
      expiresAt: { epochMilliseconds: Temporal.Now.instant().add({ hours: 1 }).epochMilliseconds },
      lastSeenAt: { epochMilliseconds: Temporal.Now.instant().epochMilliseconds },
    };
  }

  function lookupFor(
    table: unknown,
    user: Outcome,
    membership: Outcome,
  ): Record<string, unknown> | undefined {
    if (table === userSessionTable) return sessionRow();
    if (table === userTable) {
      if (user === "throw") throw new Error("user lookup failed");
      return user === "null"
        ? undefined
        : { status: USER_STATUS.Active, isDeleted: false, roles: JSON.stringify(["Support"]) };
    }
    if (table === tenantMembershipsTable) {
      if (membership === "throw") throw new Error("membership lookup failed");
      return membership === "null" ? undefined : { roles: JSON.stringify(["User"]) };
    }
    throw new Error("unexpected table in sessionChecker spy");
  }

  test("user lookup starts before the session read resolves, membership before user resolves", async () => {
    const cbs = createSessionCallbacks({ db: {} as DbConnection });
    const started: unknown[] = [];
    const releases = new Map<unknown, () => void>();

    const spy = spyOn(bunDb, "fetchOne").mockImplementation(((_db, table) => {
      started.push(table);
      return new Promise<Record<string, unknown> | undefined>((resolve) => {
        releases.set(table, () => resolve(lookupFor(table, "ok", "ok")));
      });
    }) as FetchOne);

    try {
      const pending = cbs.sessionChecker(sid, userId);
      expect(started).toEqual([userTable, userSessionTable]);

      releases.get(userSessionTable)?.();
      await Bun.sleep(0);
      expect(started).toEqual([userTable, userSessionTable, tenantMembershipsTable]);

      releases.get(tenantMembershipsTable)?.();
      releases.get(userTable)?.();
      const result = await pending;
      if (typeof result === "string") throw new Error(`expected object, got "${result}"`);
      expect([...result.roles].sort()).toEqual(["Support", "User"]);
    } finally {
      spy.mockRestore();
    }
  });

  const outcomes: readonly Outcome[] = ["ok", "null", "throw"];
  for (const user of outcomes) {
    for (const membership of outcomes) {
      const expectsLive = user !== "ok" || membership === "throw";
      test(`user=${user} membership=${membership} → ${expectsLive ? "bare live" : "live with roles"}`, async () => {
        const cbs = createSessionCallbacks({ db: {} as DbConnection });
        const spy = spyOn(bunDb, "fetchOne").mockImplementation((async (_db, table) =>
          lookupFor(table, user, membership)) as FetchOne);
        try {
          const result = await cbs.sessionChecker(sid, userId);
          if (expectsLive) {
            expect(result).toBe("live");
          } else {
            if (typeof result === "string") throw new Error(`expected object, got "${result}"`);
            const expected = membership === "null" ? ["Support"] : ["Support", "User"];
            expect([...result.roles].sort()).toEqual(expected);
          }
        } finally {
          spy.mockRestore();
        }
      });
    }
  }

  test("session miss rejects as missing even when parallel lookups throw, without unhandled rejection", async () => {
    const cbs = createSessionCallbacks({ db: {} as DbConnection });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    const spy = spyOn(bunDb, "fetchOne").mockImplementation((async (_db, table) => {
      if (table === userSessionTable) return undefined;
      throw new Error("parallel lookup failed");
    }) as FetchOne);
    try {
      expect(await cbs.sessionChecker(sid, userId)).toBe("missing");
      await Bun.sleep(5);
      expect(unhandled).toEqual([]);
    } finally {
      spy.mockRestore();
      process.off("unhandledRejection", onUnhandled);
    }
  });

  test("session read throw propagates and leaves the user lookup handled", async () => {
    const cbs = createSessionCallbacks({ db: {} as DbConnection });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    const spy = spyOn(bunDb, "fetchOne").mockImplementation((async () => {
      throw new Error("pool down");
    }) as FetchOne);
    try {
      await expect(cbs.sessionChecker(sid, userId)).rejects.toThrow("pool down");
      await Bun.sleep(5);
      expect(unhandled).toEqual([]);
    } finally {
      spy.mockRestore();
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
