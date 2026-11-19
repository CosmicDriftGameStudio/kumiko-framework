import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
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
  r.writeHandler({
    name: "internal-step",
    schema: z.object({}),
    access: { roles: [HANDLER_ROLE] },
    dispatchOnly: true,
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

const RESTRICTED_WRITE = "contract:write:restricted-write";
const DISPATCH_ONLY_WRITE = "contract:write:internal-step";

let stack: TestStack;

function stackAnsweringWriteAs(
  handlerName: string,
  answeringHandlerName: string,
): Pick<TestStack, "registry" | "http"> {
  return {
    registry: stack.registry,
    http: {
      ...stack.http,
      write: (type: string, payload: unknown, user: SessionUser, requestId?: string) =>
        stack.http.write(
          type === handlerName ? answeringHandlerName : type,
          payload,
          user,
          requestId,
        ),
    },
  };
}

beforeAll(async () => {
  stack = await setupTestStack({ features: [contractFeature] });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("expectRoleRestrictedHandlersDenyForeignRole", () => {
  test("default probe is denied everywhere and openToAll handlers are not counted", async () => {
    const result = await expectRoleRestrictedHandlersDenyForeignRole(stack, {
      minimumHandlerCount: 3,
    });

    expect(result).toEqual({ checkedWriteHandlers: 2, checkedQueryHandlers: 1 });
  });

  test("throws when a dispatchOnly handler answers over HTTP", async () => {
    await expect(
      expectRoleRestrictedHandlersDenyForeignRole(
        stackAnsweringWriteAs(DISPATCH_ONLY_WRITE, RESTRICTED_WRITE),
      ),
    ).rejects.toThrow(/internal-step: HTTP 403 access_denied/);
  });

  test("throws when a regular handler answers 404 not_found", async () => {
    await expect(
      expectRoleRestrictedHandlersDenyForeignRole(
        stackAnsweringWriteAs(RESTRICTED_WRITE, DISPATCH_ONLY_WRITE),
      ),
    ).rejects.toThrow(/restricted-write: HTTP 404 not_found/);
  });

  test("throws naming every handler when the probe holds the handler role", async () => {
    const insider = createTestUser({ roles: [HANDLER_ROLE] });

    const failure = expectRoleRestrictedHandlersDenyForeignRole(stack, { probeUser: insider });

    await expect(failure).rejects.toThrow(/restricted-write/);
    await expect(failure).rejects.toThrow(/restricted-query/);
  });

  test("throws when fewer handlers were checked than the minimum", async () => {
    await expect(
      expectRoleRestrictedHandlersDenyForeignRole(stack, { minimumHandlerCount: 4 }),
    ).rejects.toThrow(/at least 4/);
  });
});
