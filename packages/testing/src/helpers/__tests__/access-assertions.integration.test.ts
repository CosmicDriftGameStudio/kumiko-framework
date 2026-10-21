import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import * as z from "zod";
import { setupTestStack, type TestStack } from "../../stack/test-stack.ts";
import { expectRoleRestrictedHandlersDenyForeignRole } from "../access-assertions.ts";

const HANDLER_ROLE = "contract-role";

const contractFeature = defineFeature("contract", (r) => {
  r.writeHandler({
    name: "restricted-write",
    schema: z.object({}),
    access: { roles: [HANDLER_ROLE] },
    handler: async () => ({ isSuccess: true as const, data: {} }),
  });
  r.queryHandler({
    name: "restricted-query",
    schema: z.object({}),
    access: { roles: [HANDLER_ROLE] },
    handler: async () => [],
  });
  r.queryHandler({
    name: "open-query",
    schema: z.object({}),
    access: { openToAll: { reason: "fixture: must be skipped by the contract helper" } },
    handler: async () => [],
  });
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [contractFeature] });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("expectRoleRestrictedHandlersDenyForeignRole", () => {
  test("default probe is denied everywhere and openToAll handlers are not counted", async () => {
    const result = await expectRoleRestrictedHandlersDenyForeignRole(stack, {
      minimumHandlerCount: 2,
    });

    expect(result).toEqual({ checkedWriteHandlers: 1, checkedQueryHandlers: 1 });
  });

  test("throws naming every handler when the probe holds the handler role", async () => {
    const insider = createTestUser({ roles: [HANDLER_ROLE] });

    const failure = expectRoleRestrictedHandlersDenyForeignRole(stack, { probeUser: insider });

    await expect(failure).rejects.toThrow(/restricted-write/);
    await expect(failure).rejects.toThrow(/restricted-query/);
  });

  test("throws when fewer handlers were checked than the minimum", async () => {
    await expect(
      expectRoleRestrictedHandlersDenyForeignRole(stack, { minimumHandlerCount: 3 }),
    ).rejects.toThrow(/at least 3/);
  });
});
