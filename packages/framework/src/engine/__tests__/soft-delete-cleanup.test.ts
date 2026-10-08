import { describe, expect, test } from "bun:test";
import { KUMIKO_META_SYMBOL } from "@cosmicdrift/kumiko-types/schema-table-types";
import { defineFeature } from "../define-feature.js";
import { createRegistry } from "../registry.js";
import {
  DEFAULT_GRACE_DAYS,
  isSystemScopedSoftDeleteTable,
  SOFT_DELETE_CLEANUP_JOB,
  SOFT_DELETE_CLEANUP_SYSTEM_JOB,
  SOFT_DELETE_GRACE_DAYS_KEY,
  softDeleteCleanupJob,
  softDeleteCleanupSystemJob,
} from "../soft-delete-cleanup.js";
import type { JobContext } from "../types/handlers.js";

const globalTableMeta = {
  tableName: "glob_things",
  columns: [],
  indexes: [],
  source: "managed",
  tenancy: "global",
};

function featureWith(softDelete: boolean | undefined) {
  return defineFeature("probe-sd", (r) => {
    r.entity("thing", {
      fields: { label: { type: "text" } },
      ...(softDelete !== undefined && { softDelete }),
    });
  });
}

describe("registry soft-delete auto-wiring", () => {
  test("injects cleanup job + grace-days config when an entity opts into softDelete", () => {
    const registry = createRegistry([featureWith(true)]);
    expect(registry.getAllJobs().has(SOFT_DELETE_CLEANUP_JOB)).toBe(true);
    expect(registry.getAllConfigKeys().has(SOFT_DELETE_GRACE_DAYS_KEY)).toBe(true);
    const job = registry.getJob(SOFT_DELETE_CLEANUP_JOB);
    expect(job?.trigger).toEqual({ cron: "0 3 * * *" });
    expect(job?.perTenant).toBe(true);
    const key = registry.getConfigKey(SOFT_DELETE_GRACE_DAYS_KEY);
    expect(key?.type).toBe("number");
    expect(key?.default).toBe(DEFAULT_GRACE_DAYS);
    // 565/2: min must be 1, not 0 — graceDays: 0 means "hard-delete every
    // currently soft-deleted row on the next cron run", not "no cleanup".
    expect(key?.bounds?.min).toBe(1);
  });

  test("also injects the system-scope cleanup job (not perTenant)", () => {
    const registry = createRegistry([featureWith(true)]);
    expect(registry.getAllJobs().has(SOFT_DELETE_CLEANUP_SYSTEM_JOB)).toBe(true);
    const job = registry.getJob(SOFT_DELETE_CLEANUP_SYSTEM_JOB);
    expect(job?.perTenant).toBeUndefined();
  });

  test("does NOT inject when no entity uses softDelete", () => {
    const registry = createRegistry([featureWith(false)]);
    expect(registry.getAllJobs().has(SOFT_DELETE_CLEANUP_JOB)).toBe(false);
    expect(registry.getAllJobs().has(SOFT_DELETE_CLEANUP_SYSTEM_JOB)).toBe(false);
    expect(registry.getAllConfigKeys().has(SOFT_DELETE_GRACE_DAYS_KEY)).toBe(false);
  });
});

type DeleteCall = { table: unknown; where: Record<string, unknown> };

function makeCtx(opts: {
  graceDays?: number;
  calls: DeleteCall[];
  globalCalls?: DeleteCall[];
}): JobContext {
  // Shaped to satisfy bun-db's tenantDbDelegate() probe so deleteMany() routes
  // to this recorder instead of trying to extract real table metadata.
  const fakeDb = {
    tenantId: "t1",
    selectMany: async () => [],
    fetchOne: async () => undefined,
    insertOne: async () => undefined,
    updateMany: async () => [],
    deleteMany: async (table: unknown, where: Record<string, unknown>) => {
      opts.calls.push({ table, where });
    },
    unsafeRaw: () => ({
      tenantId: "t1",
      selectMany: async () => [],
      fetchOne: async () => undefined,
      insertOne: async () => undefined,
      updateMany: async () => [],
      deleteMany: async (table: unknown, where: Record<string, unknown>) => {
        opts.globalCalls?.push({ table, where });
      },
    }),
  };
  const projections = new Map<string, unknown>([
    // softDelete entity WITH a tenantId column → tenant-scoped delete
    ["thing~impl", { isImplicit: true, source: "thing", table: { tenantId: {}, isDeleted: {} } }],
    // softDelete entity WITHOUT a tenantId column → system-global delete
    ["sys~impl", { isImplicit: true, source: "sysThing", table: { isDeleted: {} } }],
    // tenancy "global" entity that still carries a tenantId column (e.g. user)
    [
      "glob~impl",
      {
        isImplicit: true,
        source: "globThing",
        table: { tenantId: {}, isDeleted: {}, [KUMIKO_META_SYMBOL]: globalTableMeta },
      },
    ],
    // softDelete:false entity → skipped
    [
      "audit~impl",
      { isImplicit: true, source: "auditEntry", table: { tenantId: {}, isDeleted: {} } },
    ],
    // explicit (non-implicit) projection → skipped
    ["custom", { isImplicit: false, source: "thing", table: { isDeleted: {} } }],
  ]);
  const registry = {
    getAllProjections: () => projections,
    getEntity: (name: string) =>
      ({
        thing: { softDelete: true },
        sysThing: { softDelete: true },
        globThing: { softDelete: true, tenancy: "global" },
        auditEntry: { softDelete: false },
      })[name],
  };
  return {
    db: fakeDb,
    registry,
    systemUser: { tenantId: "t1" },
    ...(opts.graceDays !== undefined && {
      configResolver: { get: async () => opts.graceDays },
    }),
  } as unknown as JobContext;
}

describe("softDeleteCleanupJob handler", () => {
  test("hard-deletes only tenant-scoped softDelete implicit projections; system-global entities are skipped", async () => {
    // Regression (565/1): sysThing (no tenantId column) must NOT be touched
    // here — this handler is perTenant-fanned-out, so sweeping a system-
    // global entity with THIS tenant's grace value would purge it using
    // whichever tenant has the shortest grace period, for every tenant.
    // softDeleteCleanupSystemJob (below) owns sysThing instead.
    const calls: DeleteCall[] = [];
    await softDeleteCleanupJob({}, makeCtx({ calls }));

    // thing deleted; globThing (tenancy global), sysThing (no tenantId), auditEntry (softDelete:false)
    // and custom (explicit) all skipped.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.where["tenantId"]).toBe("t1");
    expect(calls[0]?.where["isDeleted"]).toBe(true);
    expect(calls[0]?.where["deletedAt"]).toBeDefined();
  });

  test("cutoff defaults to DEFAULT_GRACE_DAYS when no config resolver", async () => {
    const calls: DeleteCall[] = [];
    await softDeleteCleanupJob({}, makeCtx({ calls }));
    const cutoff = (calls[0]!.where["deletedAt"] as { lt: Temporal.Instant }).lt;
    const expected = Temporal.Now.instant().subtract({ hours: DEFAULT_GRACE_DAYS * 24 });
    expect(Math.abs(cutoff.epochMilliseconds - expected.epochMilliseconds)).toBeLessThan(10_000);
  });

  test("honours a per-tenant grace-days value from the config resolver", async () => {
    const calls: DeleteCall[] = [];
    await softDeleteCleanupJob({}, makeCtx({ calls, graceDays: 7 }));
    const cutoff = (calls[0]!.where["deletedAt"] as { lt: Temporal.Instant }).lt;
    const expected = Temporal.Now.instant().subtract({ hours: 7 * 24 });
    expect(Math.abs(cutoff.epochMilliseconds - expected.epochMilliseconds)).toBeLessThan(10_000);
  });

  test("throws when the job context is missing db/registry", async () => {
    await expect(softDeleteCleanupJob({}, {} as JobContext)).rejects.toThrow(
      /ctx.db \+ ctx.registry/,
    );
  });
});

describe("softDeleteCleanupSystemJob handler", () => {
  test("sweeps tenancy-global tables via db.unsafeRaw() and column-less tables via deleteMany", async () => {
    const calls: DeleteCall[] = [];
    const globalCalls: DeleteCall[] = [];
    await softDeleteCleanupSystemJob({}, makeCtx({ calls, globalCalls }));

    expect(globalCalls).toHaveLength(1);
    expect(globalCalls[0]?.where["tenantId"]).toBeUndefined();
    expect(globalCalls[0]?.where["isDeleted"]).toBe(true);
    expect(calls).toHaveLength(1);
  });

  test("hard-deletes only system-global (no tenantId) softDelete implicit projections", async () => {
    const calls: DeleteCall[] = [];
    await softDeleteCleanupSystemJob({}, makeCtx({ calls }));

    // sysThing deleted; thing (has tenantId), auditEntry (softDelete:false)
    // and custom (explicit) all skipped.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.where["tenantId"]).toBeUndefined();
    expect(calls[0]?.where["isDeleted"]).toBe(true);
  });

  test("cutoff is DEFAULT_GRACE_DAYS — no per-tenant config to read", async () => {
    const calls: DeleteCall[] = [];
    await softDeleteCleanupSystemJob({}, makeCtx({ calls }));
    const cutoff = (calls[0]!.where["deletedAt"] as { lt: Temporal.Instant }).lt;
    const expected = Temporal.Now.instant().subtract({ hours: DEFAULT_GRACE_DAYS * 24 });
    expect(Math.abs(cutoff.epochMilliseconds - expected.epochMilliseconds)).toBeLessThan(10_000);
  });

  test("throws when the job context is missing db/registry", async () => {
    await expect(softDeleteCleanupSystemJob({}, {} as JobContext)).rejects.toThrow(
      /ctx.db \+ ctx.registry/,
    );
  });
});

describe("isSystemScopedSoftDeleteTable", () => {
  test("true for tenancy global, even with a tenantId column", () => {
    expect(isSystemScopedSoftDeleteTable({ tenantId: {} }, { tenancy: "global" })).toBe(true);
  });
  test("true for a table without a tenantId column", () => {
    expect(isSystemScopedSoftDeleteTable({ isDeleted: {} }, {})).toBe(true);
  });
  test("false for a tenant-scoped table with a tenantId column", () => {
    expect(isSystemScopedSoftDeleteTable({ tenantId: {} }, {})).toBe(false);
  });
});
