import { describe, expect, spyOn, test } from "bun:test";
import { z } from "zod";
import { createRegistry, defineFeature } from "../../engine";
import { TestUsers } from "../../stack";
import { ensureTemporalPolyfill } from "../../time";
import { buildServer } from "../server";

// Self-ensure Temporal rather than rely on the suite-level preload: the check
// runs `bun test` from packages/framework where the root preload path doesn't
// resolve, so buildHandlerContext would otherwise throw before our handler runs
// and the logged cause would be the polyfill error, not the thrown one.
await ensureTemporalPolyfill();

const JWT_SECRET = "test-secret-at-least-32-chars-long!!";

const boomFeature = defineFeature("boom", (r) => {
  r.queryHandler(
    "explode",
    z.object({}),
    async () => {
      throw new Error("disk on fire");
    },
    { access: { openToAll: true } },
  );
});

const { app, jwt } = buildServer({
  registry: createRegistry([boomFeature]),
  context: {},
  jwtSecret: JWT_SECRET,
});

async function auth(): Promise<Record<string, string>> {
  const token = await jwt.sign(TestUsers.admin);
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

// Find the `[api] handler failed` line our logServerFault emits (createFallback
// Logger console-falls-back to `console.error("[api] handler failed", data)`).
// Match on the namespaced message so unrelated console noise can't false-fire.
function apiFaultLog(calls: unknown[][]): string | undefined {
  const hit = calls.find(
    (args) => typeof args[0] === "string" && args[0].includes("[api] handler failed"),
  );
  return hit ? JSON.stringify(hit) : undefined;
}

describe("HTTP layer logs unexpected 5xx faults", () => {
  test("a throwing query 500s AND the cause stack reaches the log", async () => {
    const calls: unknown[][] = [];
    const spy = spyOn(console, "error").mockImplementation((...args) => {
      calls.push(args);
    });
    try {
      const res = await app.request("/api/query", {
        method: "POST",
        headers: await auth(),
        body: JSON.stringify({ type: "boom:query:explode", payload: {} }),
      });
      expect(res.status).toBe(500);
      const logged = apiFaultLog(calls);
      expect(logged).toBeDefined();
      expect(logged).toContain("boom:query:explode"); // which handler 500'd
      expect(logged).toContain("disk on fire"); // the cause — the line that was missing in prod
    } finally {
      spy.mockRestore();
    }
  });

  test("an expected 404 does NOT log a server fault (no 4xx noise)", async () => {
    const calls: unknown[][] = [];
    const spy = spyOn(console, "error").mockImplementation((...args) => {
      calls.push(args);
    });
    try {
      const res = await app.request("/api/query", {
        method: "POST",
        headers: await auth(),
        body: JSON.stringify({ type: "nope:query:nothing", payload: {} }),
      });
      expect(res.status).toBe(404);
      expect(apiFaultLog(calls)).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });
});
