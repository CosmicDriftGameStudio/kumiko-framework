// A live signal pushed from a write handler goes out after the commit: a rolled-back write sends
// no frame. Real HTTP + setupTestStack, frames recorded off the SSE broker's tenant channel.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { tenantChannel } from "../../engine/constants.ts";
import { defineFeature } from "../../engine/index.ts";
import { UnprocessableError, writeFailure } from "../../errors/index.ts";
import { createTestUser, TestUsers } from "../../seeding/seed-users.ts";

const admin = TestUsers.admin;
const addressee = createTestUser({ id: 2, roles: ["User"] });
const SIGNAL = "fixture:write:signal";
const SIGNAL_TYPE = "fixture:event:changed";

const feature = defineFeature("fixture", (r) => {
  r.writeHandler({
    name: "signal",
    schema: z.object({ fail: z.boolean() }),
    access: { roles: ["Admin"] },
    handler: async (event, ctx) => {
      await ctx.services.userLiveSignals?.push([addressee.id], { type: SIGNAL_TYPE });
      if (event.payload.fail) return writeFailure(new UnprocessableError("rolled_back"));
      return { isSuccess: true as const, data: {} };
    },
  });
});

type Frame = { readonly type: string; readonly data: unknown };

let stack: TestStack;
let frames: Frame[] = [];

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature] });
  stack.sseBroker.addClient(
    tenantChannel(admin.tenantId),
    (event) => frames.push({ type: event.type, data: event.data }),
    () => {},
  );
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(() => {
  frames = [];
});

describe("userLiveSignals in a write handler", () => {
  test("a rolled-back write sends no frame", async () => {
    const error = await stack.http.writeErr(SIGNAL, { fail: true }, admin);

    expect(error.httpStatus).toBe(422);
    expect(frames).toEqual([]);
  });

  test("a committed write sends exactly one frame to the addressee", async () => {
    await stack.http.writeOk(SIGNAL, { fail: false }, admin);

    expect(frames.map((frame) => frame.type)).toEqual([SIGNAL_TYPE]);
    expect(frames[0]?.data).toMatchObject({ userId: addressee.id });
  });
});
