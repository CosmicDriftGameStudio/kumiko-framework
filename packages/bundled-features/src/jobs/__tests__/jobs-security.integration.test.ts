// Security integration tests for jobs operator HTTP surface.
// Real HTTP via setupTestStack — no mocks.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defineFeature, type SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { rolesOf } from "@cosmicdrift/kumiko-framework/testing";
import { createConfigFeature } from "../../config/feature";
import {
  JOB_RUN_DETAIL_SCREEN_ID,
  JOB_RUNS_SCREEN_ID,
  JobHandlers,
  JobQueries,
} from "../constants";
import { createJobsFeature } from "../feature";
import { jobRunLogsTable, jobRunsTable } from "../job-run-table";

const SYSTEM_ADMIN_ROLES = ["SystemAdmin"] as const;

const noopJobFeature = defineFeature("jobs-sec-app", (r) => {
  r.job("ping", { trigger: { manual: true } }, async () => {});
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
  test("list, detail, trigger, retry handlers share SystemAdmin", () => {
    const roles = [...SYSTEM_ADMIN_ROLES];
    expect(rolesOf(stack.registry.getQueryHandler(JobQueries.list)?.access)).toEqual(roles);
    expect(rolesOf(stack.registry.getQueryHandler(JobQueries.details)?.access)).toEqual(roles);
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
  test("TenantAdmin 403 on list, detail, trigger", async () => {
    for (const fn of [
      () => stack.http.query(JobQueries.list, {}, tenantAdmin),
      () =>
        stack.http.query(
          JobQueries.details,
          { runId: "00000000-0000-4000-8000-000000000099" },
          tenantAdmin,
        ),
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
