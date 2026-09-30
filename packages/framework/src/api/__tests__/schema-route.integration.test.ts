// kumiko-framework#3314: GET /api/schema is the only way a client gets the
// AppSchema now — HTML never carries it. anonymousAccess is deliberately
// wired here (like http-route-entry.integration.test.ts): without it, a
// wrongly-mounted route (jwtGuard skipping instead of rejecting) would
// still 401 on a missing token and mask the "anonymous user reaches the
// schema" bug the anonymous-401 test exists to catch.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createEntity, defineFeature } from "../../engine/index.js";
import type { TenantId } from "../../engine/types/identifiers.js";
import { setupTestStack, type TestStack, TestUsers } from "../../stack/index.js";
import { Routes } from "../api-constants.js";
import { AUTH_COOKIE_NAME } from "../auth-middleware.js";

const TENANT_ID = "00000000-0000-4000-8000-000000000001" as TenantId;
const SCHEMA_PATH = `/api${Routes.schema}`;

const schemaRouteFeature = defineFeature("schema-route-fixture", (r) => {
  r.entity("widget", createEntity({ fields: {} }));
  r.screen({
    id: "widget-list",
    type: "entityList",
    entity: "widget",
    columns: ["id"],
  });
  r.screen({
    id: "admin-only",
    type: "entityList",
    entity: "widget",
    columns: ["id"],
    access: { roles: ["Admin"] },
  });
  r.nav({ id: "widget-list", label: "Widgets", screen: "widget-list" });
  r.nav({ id: "admin-only", label: "Admin Only", screen: "admin-only" });
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [schemaRouteFeature],
    anonymousAccess: { defaultTenantId: TENANT_ID },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("GET /api/schema", () => {
  test("anonymous → 401, no schema leaked", async () => {
    const res = await stack.app.request(SCHEMA_PATH);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unauthenticated");
  });

  test("signed-in user via Bearer token → 200 with the registry's schema, strong ETag, private/no-cache", async () => {
    const token = await stack.jwt.sign(TestUsers.user);
    const res = await stack.app.request(SCHEMA_PATH, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const cacheControl = res.headers.get("cache-control") ?? "";
    expect(cacheControl).toContain("private");
    expect(cacheControl).toContain("no-cache");
    expect(cacheControl).not.toContain("public");
    expect(cacheControl).not.toContain("no-store");
    const etag = res.headers.get("etag");
    expect(etag).toMatch(/^"/);
    expect(etag).not.toMatch(/^W\//);
    const body = (await res.json()) as { features: Array<{ featureName: string }> };
    expect(body.features.length).toBeGreaterThan(0);
    expect(body.features.some((f) => f.featureName === "schema-route-fixture")).toBe(true);
  });

  test("signed-in user via kumiko_auth cookie → 200", async () => {
    const token = await stack.jwt.sign(TestUsers.user);
    const res = await stack.app.request(SCHEMA_PATH, {
      headers: { Cookie: `${AUTH_COOKIE_NAME}=${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { features: Array<{ featureName: string }> };
    expect(body.features.length).toBeGreaterThan(0);
  });

  test("matching If-None-Match → 304 with no body, ETag kept", async () => {
    const token = await stack.jwt.sign(TestUsers.user);
    const first = await stack.app.request(SCHEMA_PATH, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();

    const second = await stack.app.request(SCHEMA_PATH, {
      headers: { Authorization: `Bearer ${token}`, "If-None-Match": etag ?? "" },
    });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
    expect(second.headers.get("etag")).toBe(etag);
  });

  test("anonymous with a valid If-None-Match → still 401, not 304", async () => {
    const token = await stack.jwt.sign(TestUsers.user);
    const authed = await stack.app.request(SCHEMA_PATH, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const etag = authed.headers.get("etag");
    expect(etag).toBeTruthy();

    const res = await stack.app.request(SCHEMA_PATH, {
      headers: { "If-None-Match": etag ?? "" },
    });
    expect(res.status).toBe(401);
  });

  test("role projection: Admin sees the role-gated screen, User does not", async () => {
    const adminToken = await stack.jwt.sign(TestUsers.admin);
    const adminRes = await stack.app.request(SCHEMA_PATH, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const adminBody = (await adminRes.json()) as {
      features: Array<{ featureName: string; screens: Array<{ id: string }> }>;
    };
    const adminFixture = adminBody.features.find((f) => f.featureName === "schema-route-fixture");
    expect(adminFixture?.screens.map((s) => s.id).sort()).toEqual(["admin-only", "widget-list"]);

    const userToken = await stack.jwt.sign(TestUsers.user);
    const userRes = await stack.app.request(SCHEMA_PATH, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    const userBody = (await userRes.json()) as {
      features: Array<{ featureName: string; screens: Array<{ id: string }> }>;
    };
    const userFixture = userBody.features.find((f) => f.featureName === "schema-route-fixture");
    expect(userFixture?.screens.map((s) => s.id)).toEqual(["widget-list"]);

    // Different bodies must carry different (strong) ETags.
    expect(adminRes.headers.get("etag")).not.toBe(userRes.headers.get("etag"));
  });

  test("role projection: one role's ETag sent by a different role never 304s", async () => {
    const adminToken = await stack.jwt.sign(TestUsers.admin);
    const adminRes = await stack.app.request(SCHEMA_PATH, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const adminEtag = adminRes.headers.get("etag");
    expect(adminEtag).toBeTruthy();

    const userToken = await stack.jwt.sign(TestUsers.user);
    const userRes = await stack.app.request(SCHEMA_PATH, {
      headers: { Authorization: `Bearer ${userToken}`, "If-None-Match": adminEtag ?? "" },
    });
    expect(userRes.status).toBe(200);
  });
});
