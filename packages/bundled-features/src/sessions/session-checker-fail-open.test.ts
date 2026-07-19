import { describe, expect, spyOn, test } from "bun:test";
import * as bunDb from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { Temporal } from "temporal-polyfill";
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
});
