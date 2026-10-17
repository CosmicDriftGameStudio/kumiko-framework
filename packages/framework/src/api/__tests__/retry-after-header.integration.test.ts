import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { defineFeature } from "../../engine/index.js";
import { RateLimitError } from "../../errors/index.js";
import { TestUsers } from "../../seeding/seed-users.js";

const RETRY_AFTER_SECONDS = 42;

function throwRateLimited(): never {
  throw new RateLimitError({
    bucket: "probe",
    limit: 1,
    windowSeconds: 60,
    remaining: 0,
    retryAfterSeconds: RETRY_AFTER_SECONDS,
    resetAt: "2030-01-01T00:00:00.000Z",
  });
}

const probeFeature = defineFeature("retryprobe", (r) => {
  r.writeHandler({
    name: "limited",
    schema: z.object({}),
    handler: async () => throwRateLimited(),
    access: { roles: ["Admin"] },
  });
  r.queryHandler({
    name: "limited",
    schema: z.object({}),
    handler: async () => throwRateLimited(),
    access: { roles: ["Admin"] },
  });
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [probeFeature] });
});

afterAll(async () => {
  await stack.cleanup();
});

async function post(path: string, type: string) {
  const token = await stack.jwt.sign(TestUsers.admin);
  return stack.app.request(
    new Request(`http://test.local${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ type, payload: {} }),
    }),
  );
}

describe("Retry-After on handler-thrown errors", () => {
  test("/api/write answers 429 with Retry-After from the error", async () => {
    const res = await post("/api/write", "retryprobe:write:limited");
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe(String(RETRY_AFTER_SECONDS));
  });

  test("/api/query answers 429 with Retry-After from the error", async () => {
    const res = await post("/api/query", "retryprobe:query:limited");
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe(String(RETRY_AFTER_SECONDS));
  });
});
