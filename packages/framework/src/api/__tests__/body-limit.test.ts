import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createEntity, createRegistry, createTextField, defineFeature } from "../../engine";
import { BODY_LIMIT_OPT_OUT_PATHS, Routes } from "../api-constants";
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

  // Security regression (2026-08-13 audit, Finding 2): /api/stream used to be
  // missing from the old BODY_LIMIT_PATHS allowlist, so it dispatched to the
  // dispatcher without ever hitting the same 1MB cap /api/write enforces.
  // Mirrors the /api/write cases above. Now covered structurally (see
  // "default coverage sweep" below), kept as its own test for the historical
  // regression it documents.
  test("rejects POST /api/stream with body larger than maxRequestBytes with 413 (mirrors /api/write)", async () => {
    const app = buildApp(1024);
    const res = await postJson(app, "/api/stream", 2048);
    expect(res.status).toBe(413);
  });

  test("accepts POST /api/stream with body within the limit (reaches auth layer, not 413)", async () => {
    const app = buildApp(10_000);
    const res = await postJson(app, "/api/stream", 100);
    expect(res.status).toBe(401); // no JWT → 401, but size is fine
  });
});

// fw#2145: BODY_LIMIT_PATHS inverted from an opt-in allowlist to an opt-out
// list — registerBodyLimit now mounts on /api/* by construction, and only
// BODY_LIMIT_OPT_OUT_PATHS (api-constants.ts) escapes it. These tests prove
// that inversion rather than re-testing individual paths.
describe("body-limit opt-out completeness", () => {
  test("every opt-out entry resolves to a real Routes constant (no stale/typo'd paths)", () => {
    for (const optOutPath of BODY_LIMIT_OPT_OUT_PATHS) {
      const matchesKnownRoute = Object.values(Routes).some(
        (route) => `/api${route}` === optOutPath,
      );
      expect(matchesKnownRoute).toBe(true);
    }
  });

  test("the opt-out list is pinned to its reviewed members — a new exception must touch this test", () => {
    expect([...BODY_LIMIT_OPT_OUT_PATHS]).toEqual([`/api${Routes.files}`]);
  });
});

describe("default coverage sweep — proves the default, not a hand-maintained list", () => {
  const OVERSIZED_BYTES = 2_000_000; // exceeds the default 1 MiB cap

  // Derived from Routes itself (minus opt-out) rather than a hand-picked
  // list — a route added to Routes tomorrow lands in this sweep
  // automatically, with no test file to remember to update. Includes routes
  // this test app never mounts (e.g. authLogin, no `auth` option passed to
  // buildServer) and routes whose GET handler is mounted outside /api/*
  // (health, healthReady, version — registerHealthRoutes/registerVersionRoute
  // mount at the bare path, not under /api). Both still 413 on an oversized
  // POST here: the /api/* body-limit middleware matches on path prefix
  // before Hono resolves a handler, so it runs whether or not a route
  // answers underneath. Verified directly: `POST /api/health` 413s even
  // though the only real handler lives at `GET /health`.
  const defaultLimitedRoutes = Object.values(Routes).filter(
    (route) => !BODY_LIMIT_OPT_OUT_PATHS.has(`/api${route}`),
  );

  for (const route of defaultLimitedRoutes) {
    test(`POST /api${route} 413s on an oversized body without needing its own list entry`, async () => {
      const app = buildApp();
      const res = await postJson(app, `/api${route}`, OVERSIZED_BYTES);
      expect(res.status).toBe(413);
    });
  }

  test("POST /api/files does not 413 on an oversized JSON body (explicit opt-out)", async () => {
    const app = buildApp();
    const res = await postJson(app, "/api/files", OVERSIZED_BYTES);
    expect(res.status).not.toBe(413);
  });

  // Regression for the DoD: "neue Route ohne Eintrag in irgendeiner Liste
  // bekommt automatisch ein Limit". Mounts a route the same way an app-owner's
  // `extraRoutes` callback would — after buildServer, with zero Routes/
  // opt-out entries — and proves it inherits the cap AND still serves a
  // small body correctly (not an accidental always-413).
  test("a route mounted after buildServer with no list entry anywhere still inherits the default limit", async () => {
    const app = buildApp();
    app.post("/api/totally-new-route-nobody-listed", async (c) => c.json({ ok: true }));

    const oversized = await postJson(app, "/api/totally-new-route-nobody-listed", OVERSIZED_BYTES);
    expect(oversized.status).toBe(413);

    // Small body passes the size cap and reaches the auth guard (401, no
    // JWT) — proves the 413 above is the size cap doing its job, not the
    // route being unreachable for some unrelated reason.
    const small = await postJson(app, "/api/totally-new-route-nobody-listed", 10);
    expect(small.status).toBe(401);
  });
});
