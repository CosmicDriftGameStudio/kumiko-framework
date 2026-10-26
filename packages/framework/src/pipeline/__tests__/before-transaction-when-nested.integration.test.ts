// beforeTransactionWhenNested: "skip" over real HTTP: top-level commands run the phase, a nested
// ctx.dispatch.write runs the handler without it (prepared undefined). Without the option a nested
// call stays rejected.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { defineFeature, defineWriteHandler } from "../../engine/index.ts";
import { createTestUser, testTenantId } from "../../seeding/seed-users.ts";

const FEATURE = "nested-skip";
const SKIPPABLE = `${FEATURE}:write:skippable`;
const STRICT = `${FEATURE}:write:strict`;
const OUTER_SKIPPABLE = `${FEATURE}:write:outer-skippable`;
const OUTER_STRICT = `${FEATURE}:write:outer-strict`;

const payload = z.object({ label: z.string() });

const seen: { readonly handler: string; readonly prepared: string | undefined }[] = [];

const feature = defineFeature(FEATURE, (r) => {
  r.writeHandler(
    defineWriteHandler({
      name: "skippable",
      schema: payload,
      access: { roles: ["Admin"] },
      beforeTransactionWhenNested: "skip",
      beforeTransaction: async (event) => ({
        isSuccess: true as const,
        data: `prepared-${event.payload.label}`,
      }),
      handler: async (event) => {
        seen.push({ handler: event.payload.label, prepared: event.prepared });
        return { isSuccess: true as const, data: {} };
      },
    }),
  );
  r.writeHandler(
    defineWriteHandler({
      name: "strict",
      schema: payload,
      access: { roles: ["Admin"] },
      beforeTransaction: async (event) => ({
        isSuccess: true as const,
        data: `prepared-${event.payload.label}`,
      }),
      handler: async (event) => {
        seen.push({ handler: event.payload.label, prepared: event.prepared });
        return { isSuccess: true as const, data: {} };
      },
    }),
  );
  r.writeHandler(
    defineWriteHandler({
      name: "outer-skippable",
      schema: payload,
      access: { roles: ["Admin"] },
      handler: async (event, ctx) => ctx.dispatch.write(SKIPPABLE, { label: event.payload.label }),
    }),
  );
  r.writeHandler(
    defineWriteHandler({
      name: "outer-strict",
      schema: payload,
      access: { roles: ["Admin"] },
      handler: async (event, ctx) => ctx.dispatch.write(STRICT, { label: event.payload.label }),
    }),
  );
});

const admin = createTestUser({ id: 1, tenantId: testTenantId(9511), roles: ["Admin"] });
let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature], jobs: {} });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("beforeTransactionWhenNested", () => {
  test("a top-level command runs the phase and the handler sees prepared", async () => {
    seen.length = 0;
    await stack.http.writeOk(SKIPPABLE, { label: "top" }, admin);

    expect(seen).toEqual([{ handler: "top", prepared: "prepared-top" }]);
  });

  test("a nested ctx.dispatch.write skips the phase: prepared is undefined", async () => {
    seen.length = 0;
    await stack.http.writeOk(OUTER_SKIPPABLE, { label: "inner" }, admin);

    expect(seen).toEqual([{ handler: "inner", prepared: undefined }]);
  });

  test("without the option a nested call to a handler with the phase stays rejected", async () => {
    seen.length = 0;
    await stack.http.writeErr(OUTER_STRICT, { label: "inner" }, admin);

    expect(seen).toEqual([]);
  });
});
