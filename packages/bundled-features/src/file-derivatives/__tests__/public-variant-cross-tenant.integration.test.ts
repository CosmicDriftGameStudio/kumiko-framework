// Proves kumiko-framework#3255: `publicTenantResolution: "fileRef"` lets a
// single shared platform host serve every tenant's public variants — the
// variant is read from the FileRef row's own tenant, not the host's, while
// resolveApexTenant still gates the host and the FileRef-tenant's own
// `isPublic` predicate remains the default-deny gate. Default ("host")
// mode is unchanged: a tenant B file requested through tenant A's host
// still 404s, identically to any other unknown FileRef.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  createEntity,
  createImageField,
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
  TestUsers,
  testTenantId,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  buildMultipartBody,
  patchFileInstanceofForBunTest,
} from "@cosmicdrift/kumiko-framework/testing";
import type { DerivativeRendererPlugin } from "@cosmicdrift/kumiko-types/derivatives-types";
import { createConfigFeature } from "../../config";
import { fileFoundationFeature } from "../../file-foundation";
import { createTenantFeature, TenantHandlers } from "../../tenant";
import { createFileDerivativesFeature } from "../feature";
import type { DerivativePublicPredicateArgs } from "../handlers/public-variant.query";
import { PUBLIC_VARIANT_BY_FILE_REF_QN } from "../handlers/public-variant-by-file-ref.query";

const VARIANT_BYTES = new Uint8Array([4, 2, 4, 2]);
const fakeRender: DerivativeRendererPlugin["render"] = async () => VARIANT_BYTES;

const TENANT_A = testTenantId(11);
const TENANT_B = testTenantId(12);
const HOST_A = "cross-tenant-a.example.com";

let receivedArgs: DerivativePublicPredicateArgs[] = [];
const gadgetEntity = createEntity({
  table: "cross_tenant_public_variant_gadgets",
  fields: {
    img: createImageField({ variants: { thumb: { maxEdge: 160, format: "webp" } } }),
  },
});

const gadgetPredicateFeature = defineFeature("crosstenantpublicvarianttest", (r) => {
  r.entity("gadget", gadgetEntity);
  r.useExtension(EXT_DERIVATIVE_PUBLIC_PREDICATE, "gadget", {
    isPublic: (args: DerivativePublicPredicateArgs) => {
      receivedArgs.push(args);
      return args.entityId === "public-1";
    },
  });
  r.useExtension(EXT_DERIVATIVE_RENDERER, "image/*", { render: fakeRender });
});

const userA = createTestUser({ id: 1, tenantId: TENANT_A, roles: ["Admin"] });
const userB = createTestUser({ id: 2, tenantId: TENANT_B, roles: ["Admin"] });

async function uploadImage(
  stack: TestStack,
  asUser: typeof userA,
  entityId: string,
): Promise<string> {
  const token = await stack.jwt.sign(asUser);
  const fd = new FormData();
  fd.append("file", new File([Buffer.from([1, 2, 3])], "img.jpg", { type: "image/jpeg" }));
  fd.append("entityType", "gadget");
  fd.append("entityId", entityId);
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

describe("file-derivatives :: publicTenantResolution 'fileRef' — cross-tenant shared host", () => {
  let stack: TestStack;

  beforeAll(async () => {
    patchFileInstanceofForBunTest();
    stack = await setupTestStack({
      features: [
        createConfigFeature(),
        createTenantFeature(),
        fileFoundationFeature,
        createFilesFeature(),
        createFileDerivativesFeature({
          resolveApexTenant: (host) => (host === HOST_A ? TENANT_A : null),
          publicTenantResolution: "fileRef",
        }),
        gadgetPredicateFeature,
      ],
      files: { storageProvider: createInMemoryFileProvider() },
    });
    await stack.http.writeOk(
      TenantHandlers.create,
      { id: TENANT_A, key: "cross-tenant-a", name: "Cross Tenant A" },
      TestUsers.systemAdmin,
    );
    await stack.http.writeOk(
      TenantHandlers.create,
      { id: TENANT_B, key: "cross-tenant-b", name: "Cross Tenant B" },
      TestUsers.systemAdmin,
    );
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  beforeEach(async () => {
    receivedArgs = [];
    await stack.redis.flushNamespace();
  });

  test("a tenant B public file is served through tenant A's shared host, isPublic runs against tenant B", async () => {
    const fileId = await uploadImage(stack, userB, "public-1");

    const res = await stack.app.request(`http://${HOST_A}/media/${fileId}/thumb`);

    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(VARIANT_BYTES);
    expect(receivedArgs).toHaveLength(1);
    expect(receivedArgs[0]?.tenantId).toBe(TENANT_B);
  });

  test("a tenant A public file is also served through tenant A's host", async () => {
    const fileId = await uploadImage(stack, userA, "public-1");

    const res = await stack.app.request(`http://${HOST_A}/media/${fileId}/thumb`);

    expect(res.status).toBe(200);
    expect(receivedArgs[0]?.tenantId).toBe(TENANT_A);
  });

  test("a non-public tenant B file, an unknown fileRefId, and an unknown host all 404 with the same body", async () => {
    const privateFileId = await uploadImage(stack, userB, "private-1");

    const privateRes = await stack.app.request(`http://${HOST_A}/media/${privateFileId}/thumb`);
    const unknownFileRefRes = await stack.app.request(
      `http://${HOST_A}/media/00000000-0000-4000-8000-000000000000/thumb`,
    );

    expect(privateRes.status).toBe(404);
    expect(unknownFileRefRes.status).toBe(404);

    const unknownFileRefBody = await unknownFileRefRes.text();
    expect(await privateRes.text()).toBe(unknownFileRefBody);
  });

  test("an unknown host 404s even for a public file, before isPublic runs", async () => {
    const publicFileId = await uploadImage(stack, userB, "public-1");
    const unknownFileRefRes = await stack.app.request(
      `http://${HOST_A}/media/00000000-0000-4000-8000-000000000000/thumb`,
    );
    receivedArgs = [];

    const unknownHostRes = await stack.app.request(
      `http://unknown-host.example.com/media/${publicFileId}/thumb`,
    );

    expect(unknownHostRes.status).toBe(404);
    expect(await unknownHostRes.text()).toBe(await unknownFileRefRes.text());
    expect(receivedArgs).toHaveLength(0);
  });

  test("PUBLIC_VARIANT_BY_FILE_REF_QN is registered on the stack in 'fileRef' mode", () => {
    expect(stack.registry.getQueryHandler(PUBLIC_VARIANT_BY_FILE_REF_QN)).toBeDefined();
  });

  // Runs last and deliberately leaves tenant B disabled — mirrors the
  // "disabled tenant" ordering convention in
  // tenant/__tests__/multi-tenant.integration.test.ts.
  describe("a disabled tenant answers like an unknown fileRef", () => {
    test("tenant B's public variant 200s before disable, then 404s identically to an unknown fileRef after disable", async () => {
      const fileId = await uploadImage(stack, userB, "public-1");
      const beforeRes = await stack.app.request(`http://${HOST_A}/media/${fileId}/thumb`);
      expect(beforeRes.status).toBe(200);

      const disableResult = await stack.http.writeOk(
        TenantHandlers.disable,
        { id: TENANT_B },
        TestUsers.systemAdmin,
      );
      expect(disableResult).toBeTruthy();

      const afterRes = await stack.app.request(`http://${HOST_A}/media/${fileId}/thumb`);
      const unknownFileRefRes = await stack.app.request(
        `http://${HOST_A}/media/00000000-0000-4000-8000-000000000000/thumb`,
      );

      expect(afterRes.status).toBe(404);
      expect(unknownFileRefRes.status).toBe(404);
      expect(await afterRes.text()).toBe(await unknownFileRefRes.text());
    });
  });
});

describe("file-derivatives :: default ('host') mode is unchanged", () => {
  let stack: TestStack;

  beforeAll(async () => {
    patchFileInstanceofForBunTest();
    stack = await setupTestStack({
      features: [
        createConfigFeature(),
        fileFoundationFeature,
        createFilesFeature(),
        createFileDerivativesFeature({
          resolveApexTenant: (host) => (host === HOST_A ? TENANT_A : null),
        }),
        gadgetPredicateFeature,
      ],
      files: { storageProvider: createInMemoryFileProvider() },
    });
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  beforeEach(async () => {
    receivedArgs = [];
    await stack.redis.flushNamespace();
  });

  test("a tenant B public file requested through tenant A's host 404s, identical body to an unknown FileRef", async () => {
    const fileId = await uploadImage(stack, userB, "public-1");

    const crossTenantRes = await stack.app.request(`http://${HOST_A}/media/${fileId}/thumb`);
    const unknownFileRefRes = await stack.app.request(
      `http://${HOST_A}/media/00000000-0000-4000-8000-000000000000/thumb`,
    );

    expect(crossTenantRes.status).toBe(404);
    expect(unknownFileRefRes.status).toBe(404);
    expect(await crossTenantRes.text()).toBe(await unknownFileRefRes.text());
  });

  test("PUBLIC_VARIANT_BY_FILE_REF_QN is not registered in default mode — not reachable via the generic /api/query dispatch", () => {
    expect(stack.registry.getQueryHandler(PUBLIC_VARIANT_BY_FILE_REF_QN)).toBeUndefined();
  });
});

describe("createFileDerivativesFeature :: publicTenantResolution requires resolveApexTenant", () => {
  test("throws when 'fileRef' is passed without resolveApexTenant", () => {
    expect(() => createFileDerivativesFeature({ publicTenantResolution: "fileRef" })).toThrow();
  });
});
