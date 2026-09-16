// fw#2914 — TenantDataHookCtx.db / UserDataHookCtx.db are TenantDb, not a raw
// DbRunner. A hook that hasn't declared `escapeHatch: { reason }` on its
// `r.useExtension(...)` registration must not be able to reach raw SQL
// through `ctx.db` at all — these are compile-time guarantees, not runtime
// checks (the runtime denial is covered by escape-hatch-declaration
// .integration.test.ts in bundled-features/user-data-rights).

import { describe, expect, test } from "bun:test";
import type { DbRunner } from "@cosmicdrift/kumiko-types/db-connection";
import { createTenantDb } from "../../../db/tenant-db";
import { testTenantId } from "../../../stack";
import type { TenantDataHookCtx } from "../tenant-data";
import type { UserDataHookCtx } from "../user-data";

const tenantId = testTenantId(1);

function fakeRunner(): DbRunner {
  return {
    unsafe: async () => [],
    begin: async () => {
      throw new Error("begin not used in this test");
    },
  } as unknown as DbRunner;
}

describe("TenantDataHookCtx.db / UserDataHookCtx.db are TenantDb, not DbRunner", () => {
  test("compile-time: ctx.db has no raw .unsafe()/.begin() surface", () => {
    const tenantCtx: TenantDataHookCtx = {
      db: createTenantDb(fakeRunner(), tenantId),
      registry: {} as TenantDataHookCtx["registry"],
      tenantId,
    };
    const userCtx: UserDataHookCtx = {
      db: createTenantDb(fakeRunner(), tenantId),
      registry: {} as UserDataHookCtx["registry"],
      tenantId,
      userId: "user-1",
    };

    // @ts-expect-error TenantDb has no `.unsafe()` — only DbRunner does.
    expect(tenantCtx.db.unsafe).toBeUndefined();
    // @ts-expect-error TenantDb has no `.begin()` — only DbRunner does.
    expect(tenantCtx.db.begin).toBeUndefined();
    // @ts-expect-error TenantDb has no `.unsafe()` — only DbRunner does.
    expect(userCtx.db.unsafe).toBeUndefined();
    // @ts-expect-error TenantDb has no `.begin()` — only DbRunner does.
    expect(userCtx.db.begin).toBeUndefined();
  });

  test("compile-time: ctx.db does not structurally satisfy DbRunner", () => {
    const tenantCtx: TenantDataHookCtx = {
      db: createTenantDb(fakeRunner(), tenantId),
      registry: {} as TenantDataHookCtx["registry"],
      tenantId,
    };

    // @ts-expect-error TenantDb is not assignable to DbRunner — a hook can't
    // smuggle ctx.db into a helper typed to expect a raw connection.
    const asRunner: DbRunner = tenantCtx.db;
    expect(asRunner).toBeDefined();
  });

  test("declared escape hatch: ctx.db.unsafeRaw(reason) returns a real DbRunner", () => {
    const runner = fakeRunner();
    const tenantCtx: TenantDataHookCtx = {
      db: createTenantDb(runner, tenantId, "tenant", undefined, undefined, undefined, {
        unsafeRaw: { reason: "test: declared escape hatch" },
      }),
      registry: {} as TenantDataHookCtx["registry"],
      tenantId,
    };

    const raw: DbRunner = tenantCtx.db.unsafeRaw("test: declared escape hatch");
    expect(raw).toBe(runner);
  });
});
