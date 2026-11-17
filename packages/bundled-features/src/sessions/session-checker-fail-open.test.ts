import { describe, expect, spyOn, test } from "bun:test";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import * as bunDb from "@cosmicdrift/kumiko-framework/db";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { tenantMembershipsTable } from "../tenant/membership-table.ts";
import { USER_STATUS, userTable } from "../user/schema/user.ts";
import { userSessionTable } from "./schema/user-session.ts";
import { createSessionCallbacks } from "./session-callbacks.ts";

// Unit-only: the fail-closed-on-throw branch cannot be provoked through real
// Postgres without faking infrastructure failure. Integration tests forbid
// mocks, so this lives next to the source as a plain *.test.ts.
// resolveLiveTenantRoles reads user and membership in parallel, so every spy
// that expects an answer must serve both tables.

type FetchOne = typeof bunDb.fetchOne;

const farFutureMs = () => Temporal.Now.instant().add({ hours: 1 }).epochMilliseconds;

describe("sessionChecker fail-closed on lookup errors and missing membership", () => {
  const tenantId = "00000000-0000-4000-8000-000000tenant";

  function sessionRow(userId: string) {
    return {
      userId,
      tenantId,
      revokedAt: null,
      expiresAt: { epochMilliseconds: farFutureMs() },
    };
  }

  test("read_users THROW → rejects (not live with frozen JWT roles)", async () => {
    const cbs = createSessionCallbacks({ db: {} as DbConnection });
    const sid = "00000000-0000-4000-8000-00000000sid1";
    const userId = "00000000-0000-4000-8000-00000000user";

    const originalFetchOne = bunDb.fetchOne;
    const spy = spyOn(bunDb, "fetchOne").mockImplementation((async (_db: unknown, table: unknown) => {
      if (table === userSessionTable) return sessionRow(userId);
      if (table === userTable) throw new Error("simulated pool exhaustion");
      if (table === tenantMembershipsTable) return { roles: null };
      throw new Error("unexpected table in sessionChecker spy");
    }) as FetchOne);

    try {
      await expect(cbs.sessionChecker(sid, userId)).rejects.toThrow("simulated pool exhaustion");
    } finally {
      spy.mockRestore();
      // Sanity: restore must put the real export back (guards against spy leak).
      expect(bunDb.fetchOne).toBe(originalFetchOne);
    }
  });

  test("read_users row hard-gone (not soft-deleted) → live (unknown principal keeps JWT roles)", async () => {
    const cbs = createSessionCallbacks({ db: {} as DbConnection });
    const sid = "00000000-0000-4000-8000-00000000sid3";
    const userId = "00000000-0000-4000-8000-00000000usr3";

    const spy = spyOn(bunDb, "fetchOne").mockImplementation((async (_db: unknown, table: unknown) => {
      if (table === userSessionTable) return sessionRow(userId);
      if (table === userTable) return undefined;
      if (table === tenantMembershipsTable) return { roles: null };
      throw new Error("unexpected table in sessionChecker spy");
    }) as FetchOne);

    try {
      expect(await cbs.sessionChecker(sid, userId)).toBe("live");
    } finally {
      spy.mockRestore();
    }
  });

  test("control: Restricted user without throw → blocked (spy must hit userTable)", async () => {
    // Pins that the spy really serves the user row, so the other tests exercise
    // the paths they claim to.
    const cbs = createSessionCallbacks({ db: {} as DbConnection });
    const sid = "00000000-0000-4000-8000-00000000sid2";
    const userId = "00000000-0000-4000-8000-00000000usr2";

    const spy = spyOn(bunDb, "fetchOne").mockImplementation((async (_db: unknown, table: unknown) => {
      if (table === userSessionTable) return sessionRow(userId);
      if (table === userTable) {
        return { status: USER_STATUS.Restricted, isDeleted: false, roles: null };
      }
      if (table === tenantMembershipsTable) return { roles: null };
      throw new Error("unexpected table in sessionChecker spy");
    }) as FetchOne);

    try {
      expect(await cbs.sessionChecker(sid, userId)).toBe("blocked");
    } finally {
      spy.mockRestore();
    }
  });

  test("membership lookup THROW → rejects (not live)", async () => {
    const cbs = createSessionCallbacks({ db: {} as DbConnection });
    const sid = "00000000-0000-4000-8000-00000000sid3";
    const userId = "00000000-0000-4000-8000-00000000usr3";

    const spy = spyOn(bunDb, "fetchOne").mockImplementation((async (_db: unknown, table: unknown) => {
      if (table === userSessionTable) return sessionRow(userId);
      if (table === userTable) {
        return { status: USER_STATUS.Active, isDeleted: false, roles: null };
      }
      if (table === tenantMembershipsTable) throw new Error("simulated pool exhaustion");
      throw new Error("unexpected table in sessionChecker spy");
    }) as FetchOne);

    try {
      await expect(cbs.sessionChecker(sid, userId)).rejects.toThrow("simulated pool exhaustion");
    } finally {
      spy.mockRestore();
    }
  });

  test("active user without membership in the session's tenant → not_a_member", async () => {
    const cbs = createSessionCallbacks({ db: {} as DbConnection });
    const sid = "00000000-0000-4000-8000-00000000sid6";
    const userId = "00000000-0000-4000-8000-00000000usr6";

    const spy = spyOn(bunDb, "fetchOne").mockImplementation((async (_db: unknown, table: unknown) => {
      if (table === userSessionTable) return sessionRow(userId);
      if (table === userTable) {
        return { status: USER_STATUS.Active, isDeleted: false, roles: null };
      }
      if (table === tenantMembershipsTable) return undefined;
      throw new Error("unexpected table in sessionChecker spy");
    }) as FetchOne);

    try {
      expect(await cbs.sessionChecker(sid, userId)).toBe("not_a_member");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("sessionChecker lastSeenAt refresh stays fail-open", () => {
  test("updateMany THROW on refresh → live with roles (not 500)", async () => {
    const cbs = createSessionCallbacks({ db: {} as DbConnection });
    const sid = "00000000-0000-4000-8000-00000000sid5";
    const userId = "00000000-0000-4000-8000-00000000usr5";
    const tenantId = "00000000-0000-4000-8000-000000tenan5";

    const originalUpdateMany = bunDb.updateMany;
    const fetchSpy = spyOn(bunDb, "fetchOne").mockImplementation((async (_db: unknown, table: unknown) => {
      if (table === userSessionTable) {
        return {
          userId,
          tenantId,
          revokedAt: null,
          expiresAt: { epochMilliseconds: farFutureMs() },
          lastSeenAt: null,
        };
      }
      if (table === userTable) {
        return {
          status: USER_STATUS.Active,
          isDeleted: false,
          roles: JSON.stringify(["Support"]),
        };
      }
      if (table === tenantMembershipsTable) return { roles: JSON.stringify(["User"]) };
      throw new Error("unexpected table in sessionChecker spy");
    }) as FetchOne);
    const updateSpy = spyOn(bunDb, "updateMany").mockImplementation(async () => {
      throw new Error("simulated write failure");
    });

    try {
      const result = await cbs.sessionChecker(sid, userId);
      if (typeof result === "string") {
        throw new Error(`expected object result, got bare string "${result}"`);
      }
      expect(result.status).toBe("live");
      expect([...result.roles].sort()).toEqual(["Support", "User"]);
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

    const spy = spyOn(bunDb, "fetchOne").mockImplementation((async (_db: unknown, table: unknown) => {
      if (table === userSessionTable) {
        return {
          userId,
          tenantId,
          revokedAt: null,
          expiresAt: { epochMilliseconds: farFutureMs() },
        };
      }
      if (table === userTable) {
        return {
          status: USER_STATUS.Active,
          isDeleted: false,
          roles: JSON.stringify(["Support"]),
        };
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

  test("user and membership lookups start together after the session read", async () => {
    const cbs = createSessionCallbacks({ db: {} as DbConnection });
    const started: unknown[] = [];
    const releases = new Map<unknown, () => void>();

    const spy = spyOn(bunDb, "fetchOne").mockImplementation(((_db: unknown, table: unknown) => {
      started.push(table);
      return new Promise<Record<string, unknown> | undefined>((resolve) => {
        releases.set(table, () => resolve(lookupFor(table, "ok", "ok")));
      });
    }) as FetchOne);

    try {
      const pending = cbs.sessionChecker(sid, userId);
      expect(started).toEqual([userSessionTable]);

      releases.get(userSessionTable)?.();
      await Bun.sleep(0);
      expect(started).toHaveLength(3);
      expect(started).toContain(userTable);
      expect(started).toContain(tenantMembershipsTable);

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
      const throws = user === "throw" || membership === "throw";
      const expectation = throws
        ? "rejects"
        : user === "null"
          ? "live (unknown principal)"
          : membership === "null"
            ? "not_a_member"
            : "live with roles";
      test(`user=${user} membership=${membership} → ${expectation}`, async () => {
        const cbs = createSessionCallbacks({ db: {} as DbConnection });
        const spy = spyOn(bunDb, "fetchOne").mockImplementation((async (_db: unknown, table: unknown) =>
          lookupFor(table, user, membership)) as FetchOne);
        try {
          if (throws) {
            await expect(cbs.sessionChecker(sid, userId)).rejects.toThrow("lookup failed");
          } else if (user === "null") {
            expect(await cbs.sessionChecker(sid, userId)).toBe("live");
          } else if (membership === "null") {
            expect(await cbs.sessionChecker(sid, userId)).toBe("not_a_member");
          } else {
            const result = await cbs.sessionChecker(sid, userId);
            if (typeof result === "string") throw new Error(`expected object, got "${result}"`);
            expect([...result.roles].sort()).toEqual(["Support", "User"]);
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
    const spy = spyOn(bunDb, "fetchOne").mockImplementation((async (_db: unknown, table: unknown) => {
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
