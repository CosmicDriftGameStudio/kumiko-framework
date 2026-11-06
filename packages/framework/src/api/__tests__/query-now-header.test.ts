import { describe, expect, test } from "bun:test";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { Hono } from "hono";
import type { BatchResult, Dispatcher, WriteResult } from "../../pipeline/dispatcher.ts";
import { createTestUser } from "../../seeding/seed-users.ts";
import { createApiRoutes } from "../routes.ts";

const user = createTestUser({ roles: ["Admin"] });
type TestApp = Hono<{ Variables: { pipelineUser: typeof user } }>;

const PINNED = "2031-05-06T07:08:09.123Z";
const clock = { now: () => Temporal.Instant.from("2031-05-06T07:08:09.123456789Z") };

function stubDispatcher(query: Dispatcher["query"]): Dispatcher {
  return {
    async write(): Promise<WriteResult> {
      return { isSuccess: true, data: {} };
    },
    query,
    async *stream() {},
    async command(): Promise<void> {},
    async batch(): Promise<BatchResult> {
      return { isSuccess: true, results: [] };
    },
    async resolveAuthClaims(): Promise<Record<string, unknown>> {
      return {};
    },
    async resolveActiveMembership() {
      return { kind: "rejected", reason: "not_a_member" };
    },
    createMemberReader() {
      return async () => {
        throw new Error("createMemberReader not available in this stub");
      };
    },
  };
}

function mount(
  options: Parameters<typeof createApiRoutes>[1],
  query: Dispatcher["query"],
): TestApp {
  const app: TestApp = new Hono();
  app.use("/api/*", async (c, next) => {
    c.set("pipelineUser", user);
    await next();
  });
  app.route("/api", createApiRoutes(stubDispatcher(query), options));
  return app;
}

async function post(app: TestApp, path: string, body: string): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

const okQuery: Dispatcher["query"] = async () => ({ rows: [] });

describe("x-kumiko-now on the dispatcher routes", () => {
  test("a query answer carries the app clock as ISO with whole milliseconds", async () => {
    const res = await post(
      mount({ clock }, okQuery),
      "/api/query",
      JSON.stringify({ type: "x:query:y", payload: {} }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-kumiko-now")).toBe(PINNED);
  });

  test("a write answer carries it too", async () => {
    const res = await post(
      mount({ clock }, okQuery),
      "/api/write",
      JSON.stringify({ type: "x:write:y", payload: {} }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-kumiko-now")).toBe(PINNED);
  });

  test("a query with an invalid JSON body still carries it", async () => {
    const res = await post(mount({ clock }, okQuery), "/api/query", "{not json");
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.headers.get("x-kumiko-now")).toBe(PINNED);
  });

  test("a failing query still carries it", async () => {
    const res = await post(
      mount({ clock }, async () => {
        throw new Error("boom");
      }),
      "/api/query",
      JSON.stringify({ type: "x:query:y", payload: {} }),
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.headers.get("x-kumiko-now")).toBe(PINNED);
  });

  test("the header is read after the handler ran, not before", async () => {
    let nowMs = Temporal.Instant.from("2031-05-06T07:08:09.000Z").epochMilliseconds;
    const advancing = { now: () => Temporal.Instant.fromEpochMilliseconds(nowMs) };
    const res = await post(
      mount({ clock: advancing }, async () => {
        nowMs += 1_500;
        return { rows: [] };
      }),
      "/api/query",
      JSON.stringify({ type: "x:query:y", payload: {} }),
    );
    expect(res.headers.get("x-kumiko-now")).toBe("2031-05-06T07:08:10.500Z");
  });

  test("without a clock the header holds the system time", async () => {
    const res = await post(
      mount({}, okQuery),
      "/api/query",
      JSON.stringify({ type: "x:query:y", payload: {} }),
    );
    expect(Math.abs(Date.parse(res.headers.get("x-kumiko-now") ?? "") - Date.now())).toBeLessThan(
      5_000,
    );
  });
});
