import { describe, expect, test } from "bun:test";
import { createTestRedis } from "../redis.ts";

describe("createTestRedis", () => {
  test("returns a connection that is already ready", async () => {
    const testRedis = await createTestRedis();
    try {
      expect(testRedis.redis.status).toBe("ready");
    } finally {
      await testRedis.cleanup();
    }
  });
});
