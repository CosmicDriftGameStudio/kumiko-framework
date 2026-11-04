import { describe, expect, test } from "bun:test";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { Hono } from "hono";
import type { Dispatcher } from "../../pipeline/dispatcher.ts";
import { createTestUser } from "../../seeding/seed-users.ts";
import { createApiRoutes } from "../routes.ts";

const user = createTestUser({ roles: ["Admin"] });
type TestApp = Hono<{ Variables: { pipelineUser: typeof user } }>;

function mount(
  options: Parameters<typeof createApiRoutes>[1],
  query: Dispatcher["query"],
): TestApp {
  const dispatcher = { query } as unknown as Dispatcher;
  const app: TestApp = new Hono();
  app.use("/api/*", async (c, next) => {
    c.set("pipelineUser", user);
    await next();
  });
  app.route("/api", createApiRoutes(dispatcher, options));
  return app;
}

async function postQuery(app: TestApp): Promise<Response> {
  return app.request("/api/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "x:query:y", payload: {} }),
  });
}

describe("POST /api/query x-kumiko-now", () => {
  test("a fixed app clock shows up as an ISO instant on the answer", async () => {
    const clock = { now: () => Temporal.Instant.from("2031-05-06T07:08:09Z") };
    const res = await postQuery(mount({ clock }, async () => ({ rows: [] })));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-kumiko-now")).toBe("2031-05-06T07:08:09Z");
  });

  test("a failing query still carries the header", async () => {
    const clock = { now: () => Temporal.Instant.from("2031-05-06T07:08:09Z") };
    const res = await postQuery(
      mount({ clock }, async () => {
        throw new Error("boom");
      }),
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.headers.get("x-kumiko-now")).toBe("2031-05-06T07:08:09Z");
  });

  test("without a clock the header holds the system time", async () => {
    const res = await postQuery(mount({}, async () => ({})));
    const stamped = Date.parse(res.headers.get("x-kumiko-now") ?? "");
    expect(Math.abs(stamped - Date.now())).toBeLessThan(5_000);
  });
});
