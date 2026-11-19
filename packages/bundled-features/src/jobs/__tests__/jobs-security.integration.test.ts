// Security integration tests for jobs operator HTTP surface.
// Real HTTP via setupTestStack — no mocks.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "@cosmicdrift/kumiko-framework/db";
import {
  defineFeature,
  type SessionUser,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser, TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { rolesOf, seedRow } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { createConfigFeature } from "../../config/feature.ts";
import { createJobsFeature } from "../feature.ts";
import { jobRunLogsTable, jobRunsTable } from "../job-run-table.ts";
import {
  JOB_RUN_DETAIL_SCREEN_ID,
  JOB_RUNS_SCREEN_ID,
  JobHandlers,
  JobQueries,
} from "../web/constants.ts";

const SYSTEM_ADMIN_ROLES = ["SystemAdmin"] as const;

const noopJobFeature = defineFeature("jobs-sec-app", (r) => {
  r.job({ name: "ping", trigger: { manual: true }, handler: async () => {} });
});

let stack: TestStack;

const systemAdmin = TestUsers.systemAdmin;
const tenantAdmin: SessionUser = createTestUser({ id: 3, roles: ["TenantAdmin"] });
const regularUser: SessionUser = createTestUser({ id: 4, roles: ["User"] });

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createConfigFeature(), noopJobFeature, createJobsFeature()],
  });
  await unsafePushTables(stack.db, { jobRunsTable, jobRunLogsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("access matrix: jobs operator surface is SystemAdmin-only", () => {
  test("list, detail, catalog, trigger, retry handlers share SystemAdmin", () => {
    const roles = [...SYSTEM_ADMIN_ROLES];
    expect(rolesOf(stack.registry.getQueryHandler(JobQueries.list)?.access)).toEqual(roles);
    expect(rolesOf(stack.registry.getQueryHandler(JobQueries.details)?.access)).toEqual(roles);
    expect(rolesOf(stack.registry.getQueryHandler(JobQueries.catalog)?.access)).toEqual(roles);
    expect(rolesOf(stack.registry.getWriteHandler(JobHandlers.trigger)?.access)).toEqual(roles);
    expect(rolesOf(stack.registry.getWriteHandler(JobHandlers.retry)?.access)).toEqual(roles);
  });

  test("job screens match SystemAdmin handler access", () => {
    const jobs = createJobsFeature();
    for (const id of [JOB_RUNS_SCREEN_ID, JOB_RUN_DETAIL_SCREEN_ID] as const) {
      const screen = jobs.screens[id];
      if (screen && "access" in screen && screen.access && "roles" in screen.access) {
        expect(screen.access.roles).toEqual(SYSTEM_ADMIN_ROLES);
      }
    }
  });
});

describe("non-SystemAdmin denied jobs HTTP surface", () => {
  test("TenantAdmin 403 on list, detail, catalog, trigger", async () => {
    for (const fn of [
      () => stack.http.query(JobQueries.list, {}, tenantAdmin),
      () =>
        stack.http.query(
          JobQueries.details,
          { runId: "00000000-0000-4000-8000-000000000099" },
          tenantAdmin,
        ),
      () => stack.http.query(JobQueries.catalog, {}, tenantAdmin),
      () =>
        stack.http.write(JobHandlers.trigger, { jobName: "jobs-sec-app:job:ping" }, tenantAdmin),
    ] as const) {
      const res = await fn();
      expect(res.status).toBe(403);
    }
  });

  test("regular User 403 on list and trigger", async () => {
    expect((await stack.http.query(JobQueries.list, {}, regularUser)).status).toBe(403);
    expect(
      (
        await stack.http.write(
          JobHandlers.trigger,
          { jobName: "jobs-sec-app:job:ping" },
          regularUser,
        )
      ).status,
    ).toBe(403);
  });
});

describe("SystemAdmin can use jobs queries", () => {
  test("empty list is OK", async () => {
    const res = await stack.http.queryOk<{ rows: readonly unknown[] }>(
      JobQueries.list,
      {},
      systemAdmin,
    );
    expect(Array.isArray(res.rows)).toBe(true);
  });
});

describe("jobs:query:list totalCount", () => {
  test("without totalCount the shape carries no total field", async () => {
    const res = await stack.http.queryOk<{ rows: readonly unknown[]; total?: number }>(
      JobQueries.list,
      { jobName: "jobs-sec-app:job:total-count-shape" },
      systemAdmin,
    );
    expect(res.total).toBeUndefined();
  });

  test("total reflects the full match count, not capped by limit", async () => {
    const jobName = "jobs-sec-app:job:total-count-probe";
    for (let i = 0; i < 6; i++) {
      await seedRow(stack.db, jobRunsTable, {
        id: crypto.randomUUID(),
        tenantId: SYSTEM_TENANT_ID,
        jobName,
        bullJobId: `total-count-${i}`,
        status: "completed",
        attempt: 1,
        startedAt: sql`now()`,
      });
    }

    const res = await stack.http.queryOk<{ rows: readonly unknown[]; total?: number }>(
      JobQueries.list,
      { jobName, limit: 2, totalCount: true },
      systemAdmin,
    );
    expect(res.rows.length).toBe(2);
    expect(res.total).toBe(6);
  });
});

describe("jobs:query:list keyset paging", () => {
  const jobName = "jobs-sec-app:job:keyset-probe";
  type RunPage = {
    rows: readonly { id: string; jobName: string; status: string }[];
    nextCursor: string | null;
  };

  beforeAll(async () => {
    const runs = [
      { status: "running", startedAt: "2026-01-01T00:01:00Z", duration: null },
      { status: "completed", startedAt: "2026-01-01T00:02:00Z", duration: 10 },
      { status: "completed", startedAt: "2026-01-01T00:02:00Z", duration: 10 },
      { status: "failed", startedAt: "2026-01-01T00:03:00Z", duration: 30 },
      { status: "queued", startedAt: "2026-01-01T00:04:00Z", duration: null },
    ];
    for (const [i, run] of runs.entries()) {
      await seedRow(stack.db, jobRunsTable, {
        id: crypto.randomUUID(),
        tenantId: SYSTEM_TENANT_ID,
        jobName,
        bullJobId: `keyset-${i}`,
        attempt: 1,
        status: run.status,
        startedAt: Temporal.Instant.from(run.startedAt),
        duration: run.duration,
      });
    }
  });

  async function pageIds(extra: Record<string, unknown>): Promise<string[]> {
    const ids: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const res = await stack.http.queryOk<RunPage>(
        JobQueries.list,
        { jobName, limit: 2, ...(cursor !== undefined && { cursor }), ...extra },
        systemAdmin,
      );
      ids.push(...res.rows.map((row) => row.id));
      if (res.nextCursor === null) return ids;
      cursor = res.nextCursor;
    }
    return ids;
  }

  async function allRows(extra: Record<string, unknown>): Promise<RunPage["rows"]> {
    const res = await stack.http.queryOk<RunPage>(
      JobQueries.list,
      { jobName, limit: 200, ...extra },
      systemAdmin,
    );
    return res.rows;
  }

  const cases: readonly {
    title: string;
    extra: Record<string, unknown>;
    expectedLength: number;
  }[] = [
    {
      title: "startedAt desc",
      extra: { sort: "startedAt", sortDirection: "desc" },
      expectedLength: 5,
    },
    { title: "duration asc", extra: { sort: "duration", sortDirection: "asc" }, expectedLength: 5 },
    {
      title: "duration desc",
      extra: { sort: "duration", sortDirection: "desc" },
      expectedLength: 5,
    },
    { title: "jobName asc", extra: { sort: "jobName", sortDirection: "asc" }, expectedLength: 5 },
    {
      title: "status asc with a status filter",
      extra: {
        sort: "status",
        sortDirection: "asc",
        filters: [{ field: "status", op: "in", value: ["completed", "failed"] }],
      },
      expectedLength: 3,
    },
  ];

  for (const { title, extra, expectedLength } of cases) {
    test(`${title}: paged ids equal the unpaged list without duplicates`, async () => {
      const all = await allRows(extra);
      const paged = await pageIds(extra);
      expect(all).toHaveLength(expectedLength);
      expect(paged).toEqual(all.map((row) => row.id));
      expect(new Set(paged).size).toBe(paged.length);
      expect(all.every((row) => row.jobName === jobName)).toBe(true);
      if (extra["filters"] !== undefined) {
        expect(all.every((row) => ["completed", "failed"].includes(row.status))).toBe(true);
      }
    });
  }
});
