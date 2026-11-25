import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createFilesFeature,
  createInMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { createOrderDeskFeature } from "../feature";

let stack: TestStack;
const support = createTestUser({ roles: ["Support"], tenantId: testTenantId(1) });

beforeAll(async () => {
  // The upload tab's file field needs a storage provider and the files feature.
  stack = await setupTestStack({
    features: [createFilesFeature(), createOrderDeskFeature()],
    files: { storageProvider: createInMemoryFileProvider() },
    systemHooks: [],
  });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("emptyState.paramsQuery over HTTP", () => {
  test("the query the reminder-due empty state names answers the params of its description", async () => {
    const params = await stack.http.queryOk<{ customer: string; due: string }>(
      "order-desk:query:order:next-reminder",
      {},
      support,
    );
    expect(params).toEqual({ customer: "Aiko Tanaka", due: "by Friday" });
  });

  test("a caller without the list's roles cannot read the params", async () => {
    const outsider = createTestUser({ roles: ["User"], tenantId: testTenantId(1) });
    const denied = await stack.http.queryErr("order-desk:query:order:next-reminder", {}, outsider);
    expect(denied.code).toBe("access_denied");
  });
});
