import { describe, expect, spyOn, test } from "bun:test";
import * as bunDb from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { Temporal } from "temporal-polyfill";
import { tenantMembershipsTable } from "../tenant/membership-table";
import { USER_STATUS, userTable } from "../user/schema/user";
import { userSessionTable } from "./schema/user-session";
import { createSessionCallbacks } from "./session-callbacks";

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
