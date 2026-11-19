import { describe, expect, test } from "bun:test";
import { liveMeiliConnection, meiliAvailable } from "../helpers/meili-availability";
import { withEnv } from "../helpers/with-env";

const UNREACHABLE_URL = "http://127.0.0.1:9";

describe("meiliAvailable", () => {
  test("is true when /health answers 200 and the connection uses MEILI_URL", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: (request) =>
        new URL(request.url).pathname === "/health"
          ? new Response("ok", { status: 200 })
          : new Response("not found", { status: 404 }),
    });
    try {
      const url = `http://localhost:${server.port}`;
      await withEnv({ MEILI_URL: url, REQUIRE_MEILI: undefined }, async () => {
        expect(liveMeiliConnection().url).toBe(url);
        expect(await meiliAvailable()).toBe(true);
      });
    } finally {
      await server.stop(true);
    }
  });

  test("is false when Meilisearch is down and REQUIRE_MEILI is unset", async () => {
    await withEnv({ MEILI_URL: UNREACHABLE_URL, REQUIRE_MEILI: undefined }, async () => {
      expect(await meiliAvailable()).toBe(false);
    });
  });

  test("throws when Meilisearch is down and REQUIRE_MEILI=1", async () => {
    await withEnv({ MEILI_URL: UNREACHABLE_URL, REQUIRE_MEILI: "1" }, async () => {
      await expect(meiliAvailable()).rejects.toThrow("REQUIRE_MEILI=1");
    });
  });
});
