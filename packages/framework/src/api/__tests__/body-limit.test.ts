import { describe, expect, test } from "vitest";
import { z } from "zod";
import { createEntity, createRegistry, createTextField, defineFeature } from "../../engine";
import { buildServer } from "../server";

const JWT_SECRET = "test-secret-at-least-32-chars-long!!";

const testFeature = defineFeature("blob", (r) => {
  r.entity("note", createEntity({ table: "Notes", fields: { body: createTextField() } }));
  r.writeHandler(
    "note:create",
    z.object({ body: z.string() }),
    async (event) => ({ isSuccess: true, data: { body: event.payload.body } }),
    { access: { openToAll: true } },
  );
});

function buildApp(maxRequestBytes?: number) {
  const registry = createRegistry([testFeature]);
  return buildServer({
    registry,
    context: {},
    jwtSecret: JWT_SECRET,
    maxRequestBytes,
  }).app;
}

function postJson(app: ReturnType<typeof buildApp>, path: string, bytes: number) {
  const body = JSON.stringify({ body: "x".repeat(bytes) });
  return app.request(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": String(body.length),
    },
    body,
  });
}

describe("request body limit", () => {
  test("rejects POST with body larger than maxRequestBytes with 413", async () => {
    const app = buildApp(1024);
    const res = await postJson(app, "/api/write", 2048);
    expect(res.status).toBe(413);
  });

  test("accepts POST with body within the limit (reaches auth layer)", async () => {
    const app = buildApp(10_000);
    const res = await postJson(app, "/api/write", 100);
    // No JWT → 401. Point is: NOT 413.
    expect(res.status).toBe(401);
  });

  test("default limit rejects absurdly large payloads", async () => {
    const app = buildApp(); // default 1 MB
    const res = await postJson(app, "/api/write", 2_000_000); // 2 MB
    expect(res.status).toBe(413);
  });

  test("default limit accepts small payloads", async () => {
    const app = buildApp();
    const res = await postJson(app, "/api/write", 500);
    expect(res.status).toBe(401); // auth required, but size is fine
  });

  test("limit is not applied to /api/files (uploads have their own cap)", async () => {
    // /api/files isn't mounted on this test app (no storageProvider), so a POST
    // results in 404 — the point is: NOT 413. A payload that exceeds the JSON
    // cap must still reach the route layer for the files router to decide.
    const app = buildApp(1024);
    const body = JSON.stringify({ body: "x".repeat(4096) });
    const res = await app.request("/api/files", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(body.length),
      },
      body,
    });
    expect(res.status).not.toBe(413);
  });

  test("maxRequestBytes=0 disables the cap entirely", async () => {
    const app = buildApp(0);
    const res = await postJson(app, "/api/write", 50_000);
    expect(res.status).toBe(401); // passes body-limit, reaches auth
  });
});
