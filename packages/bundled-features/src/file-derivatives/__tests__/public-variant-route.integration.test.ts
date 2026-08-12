// Proves GET {basePath}/:fileRefId/:variant end-to-end: anonymous, no
// Authorization header, tenant resolved ONLY from Host (never the payload),
// default-deny when no `derivativePublicPredicate` is registered for the
// FileRef's entityType (or it returns false), the fixed preset-name
// pre-check running BEFORE any DB/systemQuery work, and the Step-1
// requestContext fix that makes `rateLimit: {per: "ip"}` actually gate an
// r.httpRoute handler invoked via systemQuery (#1951).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  defineFeature,
  EXT_DERIVATIVE_PUBLIC_PREDICATE,
  EXT_DERIVATIVE_RENDERER,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createFilesFeature,
  createInMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  buildMultipartBody,
  patchFileInstanceofForBunTest,
} from "@cosmicdrift/kumiko-framework/testing";
import type { DerivativeRendererPlugin } from "@cosmicdrift/kumiko-types/derivatives-types";
import { createConfigFeature } from "../../config";
import { fileFoundationFeature } from "../../file-foundation";
import { createFileDerivativesFeature } from "../feature";
import type { DerivativePublicPredicateArgs } from "../handlers/public-variant.query";

const VARIANT_BYTES = new Uint8Array([7, 7, 7]);

let renderCalls = 0;
const fakeRender: DerivativeRendererPlugin["render"] = async () => {
  renderCalls++;
  return VARIANT_BYTES;
};

const PUBLIC_WIDGET_ID = "widget-public";
const OTHER_WIDGET_ID = "widget-other";

let predicateCalls = 0;
const widgetPredicateFeature = defineFeature("publicvariantroutetest", (r) => {
  r.useExtension(EXT_DERIVATIVE_PUBLIC_PREDICATE, "widget", {
    isPublic: (args: DerivativePublicPredicateArgs) => {
      predicateCalls++;
      return args.entityId === PUBLIC_WIDGET_ID;
    },
  });
  // EXT_DERIVATIVE_RENDERER itself is already declared by
  // createFileDerivativesFeature — only register a plugin under it here.
  r.useExtension(EXT_DERIVATIVE_RENDERER, "image/*", { render: fakeRender });
});

const TENANT_A = testTenantId(1);
const TENANT_B = testTenantId(2);
const HOST_A = "tenant-a.example.com";
const HOST_B = "tenant-b.example.com";

const userA = createTestUser({ id: 1, tenantId: TENANT_A, roles: ["Admin"] });

let stack: TestStack;

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      fileFoundationFeature,
      createFilesFeature(),
      createFileDerivativesFeature({
        resolveApexTenant: (host) => {
          if (host === HOST_A) return TENANT_A;
          if (host === HOST_B) return TENANT_B;
          return null;
        },
      }),
      widgetPredicateFeature,
    ],
    files: { storageProvider: createInMemoryFileProvider() },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  renderCalls = 0;
  predicateCalls = 0;
  // Fresh rate-limit bucket per test — no carry-over.
  await stack.redis.flushNamespace();
});

async function uploadFile(
  asUser: typeof userA,
  attach: { entityType: string; entityId: string },
): Promise<string> {
  const token = await stack.jwt.sign(asUser);
  const fd = new FormData();
  fd.append("file", new File([Buffer.from([1, 2, 3])], "img.jpg", { type: "image/jpeg" }));
  fd.append("entityType", attach.entityType);
  fd.append("entityId", attach.entityId);
  fd.append("fieldName", "img");
  const { body, contentType } = await buildMultipartBody(fd);
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body,
  });
  expect(res.status).toBe(201);
  const json = (await res.json()) as { id: string };
  return json.id;
}

describe("GET /media/:fileRefId/:variant (anonymous, default-deny)", () => {
  test("no predicate registered for the FileRef's entityType → 404", async () => {
    const fileId = await uploadFile(userA, { entityType: "unregistered-type", entityId: "x" });

    const res = await stack.app.request(`http://${HOST_A}/media/${fileId}/thumb`);

    expect(res.status).toBe(404);
    expect(renderCalls).toBe(0);
  });

  test("predicate registered but returns false → 404", async () => {
    const fileId = await uploadFile(userA, { entityType: "widget", entityId: OTHER_WIDGET_ID });

    const res = await stack.app.request(`http://${HOST_A}/media/${fileId}/thumb`);

    expect(res.status).toBe(404);
    expect(predicateCalls).toBeGreaterThan(0);
    expect(renderCalls).toBe(0);
  });

  test("predicate returns true → 200 with rendered bytes, mimeType, Vary: Host", async () => {
    const fileId = await uploadFile(userA, { entityType: "widget", entityId: PUBLIC_WIDGET_ID });

    const res = await stack.app.request(`http://${HOST_A}/media/${fileId}/thumb`);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/webp");
    expect(res.headers.get("Vary")).toBe("Host");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(VARIANT_BYTES);
  });

  test("a second call on the same (fileRefId, variant) hits the cache — renderer runs once", async () => {
    const fileId = await uploadFile(userA, { entityType: "widget", entityId: PUBLIC_WIDGET_ID });

    const first = await stack.app.request(`http://${HOST_A}/media/${fileId}/thumb`);
    const second = await stack.app.request(`http://${HOST_A}/media/${fileId}/thumb`);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(renderCalls).toBe(1);
  });

  test("If-None-Match with a matching ETag → 304, no body", async () => {
    const fileId = await uploadFile(userA, { entityType: "widget", entityId: PUBLIC_WIDGET_ID });

    const first = await stack.app.request(`http://${HOST_A}/media/${fileId}/thumb`);
    const etag = first.headers.get("ETag");
    expect(etag).toBeTruthy();

    const revalidate = await stack.app.request(`http://${HOST_A}/media/${fileId}/thumb`, {
      headers: { "if-none-match": etag ?? "" },
    });

    expect(revalidate.status).toBe(304);
    expect(await revalidate.arrayBuffer()).toEqual(new ArrayBuffer(0));
  });

  test("invalid variant name → 404, pre-check runs before any DB/systemQuery work", async () => {
    const fileId = await uploadFile(userA, { entityType: "widget", entityId: PUBLIC_WIDGET_ID });

    const res = await stack.app.request(`http://${HOST_A}/media/${fileId}/not-a-preset`);

    expect(res.status).toBe(404);
    expect(predicateCalls).toBe(0);
    expect(renderCalls).toBe(0);
  });

  test("unknown fileRefId → 404", async () => {
    // Valid UUID shape (the id column's type) but no matching row.
    const res = await stack.app.request(
      `http://${HOST_A}/media/00000000-0000-4000-8000-000000000000/thumb`,
    );

    expect(res.status).toBe(404);
  });

  test("malformed fileRefId → 404, pre-check runs before any DB/systemQuery work", async () => {
    // Unlike #1950 (auth-gated), this route is anonymous — a non-UUID id
    // reaching fetchOne() would throw Postgres 22P02 on an unauthenticated
    // request, an unauth DoS primitive. Must 404 at the httpRoute pre-check.
    const res = await stack.app.request(`http://${HOST_A}/media/not-a-uuid/thumb`);

    expect(res.status).toBe(404);
    expect(predicateCalls).toBe(0);
    expect(renderCalls).toBe(0);
  });

  test("cross-tenant: FileRef under tenant A, request resolves to tenant B → 404", async () => {
    const fileId = await uploadFile(userA, { entityType: "widget", entityId: PUBLIC_WIDGET_ID });

    const res = await stack.app.request(`http://${HOST_B}/media/${fileId}/thumb`);

    expect(res.status).toBe(404);
  });

  test("resolveApexTenant returns null for an unknown host → 404", async () => {
    const fileId = await uploadFile(userA, { entityType: "widget", entityId: PUBLIC_WIDGET_ID });

    const res = await stack.app.request(`http://unknown.example.com/media/${fileId}/thumb`);

    expect(res.status).toBe(404);
  });

  test("more than `limit` requests from the same IP within the window → 429 (Step-1 regression)", async () => {
    const fileId = await uploadFile(userA, { entityType: "widget", entityId: PUBLIC_WIDGET_ID });
    const xff = "203.0.113.9";

    // publicVariantQuery's rateLimit is {per: "ip", limit: 60, windowSeconds: 60}
    // — 60 calls must succeed, the 61st must be blocked. Without the Step-1
    // fix (requestContext.run wrapping systemQuery in server.ts) `ip` is
    // never populated for an r.httpRoute-invoked handler, enforceRateLimit's
    // bucket resolves to "skip", and this test would fail — every call
    // would return 200.
    for (let i = 0; i < 60; i++) {
      const res = await stack.app.request(`http://${HOST_A}/media/${fileId}/thumb`, {
        headers: { "x-forwarded-for": xff },
      });
      expect(res.status).toBe(200);
    }

    const blocked = await stack.app.request(`http://${HOST_A}/media/${fileId}/thumb`, {
      headers: { "x-forwarded-for": xff },
    });
    expect(blocked.status).toBe(429);
  }, 20000);
});
