import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { EscapeHatchReporter } from "@cosmicdrift/kumiko-types/handlers";
import type { DbRunner } from "../../db/connection";
import { table, text, uuid } from "../../db/dialect";
import { createTenantDb, createUncheckedSystemDb, type TenantDb } from "../../db/tenant-db";
import { AccessDeniedError } from "../../errors";
import { testTenantId } from "../../stack";
import { getStep } from "../define-step";
import { buildReadFindManyStep } from "../steps/read-find-many";
import { buildReadFindOneStep } from "../steps/read-find-one";
import { SYSTEM_TENANT_ID } from "../types/identifiers";
import type { PipelineCtx } from "../types/step";

const testTable = table("test_read", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  label: text("label"),
});

// fw#2914: read-find-many/one now call selectMany(ctx.db, table, where, opts) —
// ctx.db is a TenantDb, so selectMany's tenantDbDelegate branch runs
// TenantDb.selectMany (applies the tenant filter) instead of raw SQL. Mock
// .unsafe() to feed back rows once the (tenant-filtered) query reaches it.
const unsafeMock = mock(
  async (_sqlText: string, _params: unknown[]): Promise<Record<string, unknown>[]> => [],
);
const rawDb = { unsafe: unsafeMock, begin: mock() } as DbRunner;
const ownTenantId = testTenantId(1);
const ctxDb = createTenantDb(rawDb, ownTenantId);

const mockCtx = {
  db: ctxDb,
  event: { type: "test", payload: {} },
  steps: {},
  scope: {},
} as unknown as PipelineCtx;

const reportCalls: Array<{ kind: string; reason: string }> = [];
const recordingReport: EscapeHatchReporter = (kind, reason) => {
  reportCalls.push({ kind, reason });
};
const grantedDb = createTenantDb(rawDb, ownTenantId, "tenant", undefined, undefined, undefined, {
  unsafeRaw: { reason: "fw#2914 unit test — declared cross-tenant read" },
  report: recordingReport,
});
const grantedCtx = {
  db: grantedDb,
  event: { type: "test", payload: {} },
  steps: {},
  scope: {},
} as unknown as PipelineCtx;

describe("buildReadFindOneStep", () => {
  it("returns a StepInstance with kind read.findOne", () => {
    const step = buildReadFindOneStep("myLookup", {
      table: testTable,
      where: { id: "x" },
    });
    expect(step.kind).toBe("read.findOne");
    expect((step.args as { name: string }).name).toBe("myLookup");
  });

  it("stores the result key from the name arg", () => {
    const step = buildReadFindOneStep("lookupResult", {
      table: testTable,
      where: { id: "x" },
    });
    const def = getStep("read.findOne");
    expect(def?.resultKey?.(step.args as { name: string })).toBe("lookupResult");
  });
});

describe("read.findOne run", () => {
  beforeEach(() => {
    mock.clearAllMocks();
    unsafeMock.mockResolvedValue([]);
    reportCalls.length = 0;
  });

  it("returns null when no row is found", async () => {
    const stepDef = getStep("read.findOne");
    unsafeMock.mockResolvedValueOnce([]);

    const result = await stepDef!.run(
      { name: "lookup", table: testTable, where: { id: "x" } },
      mockCtx,
    );

    expect(result).toBeNull();
  });

  it("returns the first row when found", async () => {
    const stepDef = getStep("read.findOne");
    const row = { id: "abc", tenantId: "t1", label: "hello" };
    unsafeMock.mockResolvedValueOnce([row]);

    const result = await stepDef!.run(
      { name: "lookup", table: testTable, where: { id: "abc" } },
      mockCtx,
    );

    expect(result).toEqual(row);
  });

  it("filters by the caller's own tenant + SYSTEM_TENANT_ID by default", async () => {
    const stepDef = getStep("read.findOne");
    unsafeMock.mockResolvedValueOnce([]);

    await stepDef!.run({ name: "lookup", table: testTable, where: { id: "x" } }, mockCtx);

    expect(unsafeMock).toHaveBeenCalledTimes(1);
    const [sqlText, params] = unsafeMock.mock.calls[0]!;
    expect(sqlText).toMatch(/"tenant_id" IN \(\$\d, \$\d\)/);
    expect(params).toEqual(expect.arrayContaining([ownTenantId, SYSTEM_TENANT_ID]));
  });

  it("narrows a foreign where.tenantId to the caller's own scope", async () => {
    const stepDef = getStep("read.findOne");
    const whereFn = mock(() => ({ tenantId: "dyn-tenant" }));
    unsafeMock.mockResolvedValueOnce([]);

    await stepDef!.run({ name: "lookup", table: testTable, where: whereFn }, mockCtx);

    expect(whereFn).toHaveBeenCalledWith(mockCtx);
    expect(unsafeMock).toHaveBeenCalledTimes(1);
    const [sqlText, params] = unsafeMock.mock.calls[0]!;
    expect(sqlText).toMatch(/SELECT \* FROM "test_read"/);
    expect(sqlText).toMatch(/"tenant_id" IN \(\$1, \$2\)/);
    expect(params).toEqual([ownTenantId, SYSTEM_TENANT_ID]);
  });

  it("rejects unsafeAllTenants without a grant, without ever calling unsafe()", async () => {
    const stepDef = getStep("read.findOne");

    await expect(
      stepDef!.run(
        {
          name: "lookup",
          table: testTable,
          where: { id: "x" },
          unsafeAllTenants: { reason: "fw#2914 unit test — no grant" },
        },
        mockCtx,
      ),
    ).rejects.toThrow(AccessDeniedError);

    expect(unsafeMock).not.toHaveBeenCalled();
  });

  it("unsafeAllTenants with a grant skips the tenant filter and reports unsafe-raw", async () => {
    const stepDef = getStep("read.findOne");
    unsafeMock.mockResolvedValueOnce([]);
    const reason = "fw#2914 unit test — declared cross-tenant read";

    await stepDef!.run(
      { name: "lookup", table: testTable, where: { id: "x" }, unsafeAllTenants: { reason } },
      grantedCtx,
    );

    expect(unsafeMock).toHaveBeenCalledTimes(1);
    const [sqlText] = unsafeMock.mock.calls[0]!;
    expect(sqlText).not.toMatch(/tenant_id/);
    expect(reportCalls).toEqual([{ kind: "unsafe-raw", reason }]);
  });
});

describe("buildReadFindManyStep", () => {
  it("returns a StepInstance with kind read.findMany", () => {
    const step = buildReadFindManyStep("myList", { table: testTable });
    expect(step.kind).toBe("read.findMany");
    expect((step.args as { name: string }).name).toBe("myList");
  });

  it("accepts an optional limit", () => {
    const step = buildReadFindManyStep("myList", { table: testTable, limit: 10 });
    expect((step.args as { limit: number }).limit).toBe(10);
  });

  it("stores unsafeAllTenants on step.args and rejects a boolean at the type level", () => {
    const reason = "fw#2914 unit test — unsafeAllTenants stored on step.args";
    const step = buildReadFindManyStep("x", { table: testTable, unsafeAllTenants: { reason } });
    expect(step.args).toMatchObject({ unsafeAllTenants: { reason } });

    // @ts-expect-error unsafeAllTenants requires { reason: string }, not a boolean
    const rejected = buildReadFindManyStep("x", { table: testTable, unsafeAllTenants: true });
    expect(rejected.args).toMatchObject({ unsafeAllTenants: true });
  });
});

describe("read.findMany run", () => {
  beforeEach(() => {
    mock.clearAllMocks();
    unsafeMock.mockResolvedValue([]);
    reportCalls.length = 0;
  });

  it("returns an empty array when no rows exist", async () => {
    const stepDef = getStep("read.findMany");
    unsafeMock.mockResolvedValueOnce([]);

    const result = await stepDef!.run({ name: "list", table: testTable }, mockCtx);

    expect(result).toEqual([]);
  });

  it("applies the limit when specified", async () => {
    const stepDef = getStep("read.findMany");
    const rows = [{ id: "a" }, { id: "b" }];
    unsafeMock.mockResolvedValueOnce(rows);

    await stepDef!.run({ name: "list", table: testTable, limit: 2 }, mockCtx);

    expect(unsafeMock).toHaveBeenCalledTimes(1);
    const [sqlText] = unsafeMock.mock.calls[0]!;
    expect(sqlText).toMatch(/LIMIT 2/);
  });

  it("filters by the caller's own tenant + SYSTEM_TENANT_ID by default", async () => {
    const stepDef = getStep("read.findMany");
    unsafeMock.mockResolvedValueOnce([]);

    await stepDef!.run({ name: "list", table: testTable }, mockCtx);

    expect(unsafeMock).toHaveBeenCalledTimes(1);
    const [sqlText, params] = unsafeMock.mock.calls[0]!;
    expect(sqlText).toMatch(/"tenant_id" IN \(\$1, \$2\)/);
    expect(params).toEqual([ownTenantId, SYSTEM_TENANT_ID]);
  });

  it("rejects unsafeAllTenants without a grant, without ever calling unsafe()", async () => {
    const stepDef = getStep("read.findMany");

    await expect(
      stepDef!.run(
        {
          name: "list",
          table: testTable,
          unsafeAllTenants: { reason: "fw#2914 unit test — no grant" },
        },
        mockCtx,
      ),
    ).rejects.toThrow(AccessDeniedError);

    expect(unsafeMock).not.toHaveBeenCalled();
  });

  it("unsafeAllTenants with a grant skips the tenant filter and reports unsafe-raw", async () => {
    const stepDef = getStep("read.findMany");
    unsafeMock.mockResolvedValueOnce([]);
    const reason = "fw#2914 unit test — declared cross-tenant read";

    await stepDef!.run(
      { name: "list", table: testTable, unsafeAllTenants: { reason } },
      grantedCtx,
    );

    expect(unsafeMock).toHaveBeenCalledTimes(1);
    const [sqlText] = unsafeMock.mock.calls[0]!;
    expect(sqlText).not.toMatch(/tenant_id/);
    expect(reportCalls).toEqual([{ kind: "unsafe-raw", reason }]);
  });
});

describe("read steps in a systemScope handler", () => {
  const systemScopeReportCalls: Array<{ kind: string; reason: string }> = [];
  const systemScopeReporter: EscapeHatchReporter = (kind, reason) => {
    systemScopeReportCalls.push({ kind, reason });
  };
  // Mirrors createSystemScopedDbGuard (pipeline/dispatch-shared.ts) — a
  // systemScope() handler's ctx.db is a Proxy that throws on first touch.
  const throwingDb = new Proxy({} as TenantDb, {
    get(_target, prop) {
      throw new Error(`ctx.db is unavailable in a systemScope() handler (read "${String(prop)}")`);
    },
  });
  const systemScopeCtx = {
    db: throwingDb,
    systemDb: createUncheckedSystemDb(
      createTenantDb(rawDb, testTenantId(1), "system"),
      undefined,
      systemScopeReporter,
    ),
    event: { type: "test", payload: {} },
    steps: {},
    scope: {},
  } as unknown as PipelineCtx;

  beforeEach(() => {
    mock.clearAllMocks();
    unsafeMock.mockResolvedValue([]);
    systemScopeReportCalls.length = 0;
  });

  it("findMany with unsafeAllTenants reads through ctx.systemDb, skips the tenant filter, and reports unsafe-raw", async () => {
    const stepDef = getStep("read.findMany");
    unsafeMock.mockResolvedValueOnce([]);
    const reason = "fw#2914 unit test — system-wide read step";

    await stepDef!.run(
      { name: "list", table: testTable, unsafeAllTenants: { reason } },
      systemScopeCtx,
    );

    expect(unsafeMock).toHaveBeenCalledTimes(1);
    const [sqlText] = unsafeMock.mock.calls[0]!;
    expect(sqlText).not.toMatch(/tenant_id/);
    expect(systemScopeReportCalls).toEqual([{ kind: "unsafe-raw", reason }]);
  });

  it("findMany without unsafeAllTenants falls through to the throwing ctx.db proxy", async () => {
    const stepDef = getStep("read.findMany");

    await expect(
      stepDef!.run({ name: "list", table: testTable }, systemScopeCtx),
    ).rejects.toThrow();

    expect(unsafeMock).not.toHaveBeenCalled();
  });

  it("findMany with a whitespace-only reason is rejected by systemDb.unsafeRaw before any query runs", async () => {
    const stepDef = getStep("read.findMany");

    await expect(
      stepDef!.run(
        { name: "list", table: testTable, unsafeAllTenants: { reason: "  " } },
        systemScopeCtx,
      ),
    ).rejects.toThrow("non-empty reason");

    expect(unsafeMock).not.toHaveBeenCalled();
  });
});
