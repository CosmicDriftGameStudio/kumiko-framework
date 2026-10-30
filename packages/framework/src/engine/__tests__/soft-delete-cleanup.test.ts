import { describe, expect, test } from "bun:test";
import { defineFeature } from "../define-feature.ts";
import { createRegistry } from "../registry.ts";
import {
  DEFAULT_GRACE_DAYS,
  isSystemScopedSoftDeleteTable,
  readSoftDeleteGraceDays,
  SOFT_DELETE_CLEANUP_JOB,
  SOFT_DELETE_CLEANUP_SYSTEM_JOB,
  SOFT_DELETE_GRACE_DAYS_KEY,
  softDeleteCleanupJob,
  softDeleteCleanupSystemJob,
} from "../soft-delete-cleanup.ts";
import type { JobContext } from "../types/handlers.ts";

function featureWith(softDelete: boolean | undefined) {
  return defineFeature("probe-sd", (r) => {
    r.entity({
      name: "thing",
      fields: { label: { type: "text", allowPlaintext: "test fixture value, not personal data" } },
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
    expect(job?.trigger).toEqual({ maintenance: true });
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

describe("softDeleteCleanupJob handler", () => {
  test("throws when the job context is missing db/registry", async () => {
    await expect(softDeleteCleanupJob({}, {} as JobContext)).rejects.toThrow(
      /ctx.db \+ ctx.registry/,
    );
  });
});

describe("softDeleteCleanupSystemJob handler", () => {
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

describe("readSoftDeleteGraceDays", () => {
  test("returns the tenant's configured period and falls back to the default", async () => {
    const configured = async (key: string) => (key === SOFT_DELETE_GRACE_DAYS_KEY ? 14 : undefined);
    expect(await readSoftDeleteGraceDays(configured)).toBe(14);
    expect(await readSoftDeleteGraceDays(async () => undefined)).toBe(DEFAULT_GRACE_DAYS);
    expect(await readSoftDeleteGraceDays(async () => 0)).toBe(DEFAULT_GRACE_DAYS);
    expect(await readSoftDeleteGraceDays(undefined)).toBe(DEFAULT_GRACE_DAYS);
  });
});
