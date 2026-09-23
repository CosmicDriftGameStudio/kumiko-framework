// A throwing write handler is wrapped into InternalError{cause}; the wire body
// hides the cause (pinned by error-contract.integration.test.ts), but the
// ops-facing log line must carry it. routes.ts rebuilds the error via
// reraiseAsKumikoError, so this goes through the real HTTP write route.

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { z } from "zod";
import { defineFeature } from "../../engine";
import { setupTestStack, type TestStack, TestUsers } from "../../stack";

const boomFeature = defineFeature("causeboom", (r) => {
  r.writeHandler(
    "explode",
    z.object({}),
    async () => {
      throw new Error("disk on fire during write");
    },
    { access: { roles: ["Admin"] } },
  );
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [boomFeature] });
});
afterAll(async () => stack.cleanup());

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

describe("write 5xx logs the cause chain", () => {
  test("a throwing write handler 500s and the [api] handler failed line carries type + cause", async () => {
    const calls: unknown[][] = [];
    const spy = spyOn(console, "error").mockImplementation((...args) => {
      calls.push(args);
    });
    try {
      const res = await stack.http.write("causeboom:write:explode", {}, TestUsers.admin);
      expect(res.status).toBe(500);

      const hit = calls.find(
        (args) => typeof args[0] === "string" && args[0].includes("[api] handler failed"),
      );
      expect(hit).toBeDefined();
      const data = hit?.[1];
      expect(isRecord(data)).toBe(true);
      if (!isRecord(data)) return;
      expect(data["type"]).toBe("causeboom:write:explode");
      expect(data["cause"]).toBe("disk on fire during write");
    } finally {
      spy.mockRestore();
    }
  });
});
