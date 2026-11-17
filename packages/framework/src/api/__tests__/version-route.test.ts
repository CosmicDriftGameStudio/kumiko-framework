import { expect, test } from "bun:test";
import { Hono } from "hono";
import { registerVersionRoute } from "../route-registrars.ts";

test("GET /version exposes only version and buildTime", async () => {
  const app = new Hono();
  registerVersionRoute(app);
  const res = await app.request("/version");
  expect(res.status).toBe(200);
  expect(Object.keys((await res.json()) as Record<string, unknown>).sort()).toEqual([
    "buildTime",
    "version",
  ]);
});
