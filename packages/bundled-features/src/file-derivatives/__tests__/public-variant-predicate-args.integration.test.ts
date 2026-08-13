// Proves #1989/2: DerivativePublicPredicateArgs carries `fieldName` and
// `variant` (not just entityId/tenantId) through to `isPublic`, so an app
// can opt individual variants out of public serving instead of every
// declared variant on an entityType being implicitly public once the
// entityType-level check passes.

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

const VARIANT_BYTES = new Uint8Array([9, 9, 9]);
const fakeRender: DerivativeRendererPlugin["render"] = async () => VARIANT_BYTES;

const ENTITY_ID = "gadget-1";
const HOST = "gadgets.example.com";
const TENANT = testTenantId(7);

// Deliberately gates on `variant`, not just entityId — "premium" stays
// denied even for an entityId the entityType-level check would otherwise
// allow, proving a predicate can opt a specific variant out.
let receivedArgs: DerivativePublicPredicateArgs[] = [];
const gadgetEntity = createEntity({
  table: "public_variant_predicate_gadgets",
  fields: {
    img: createImageField({
      variants: {
        thumb: { maxEdge: 160, format: "webp" },
        premium: { maxEdge: 4096, format: "webp" },
      },
    }),
  },
});

const gadgetPredicateFeature = defineFeature("publicvariantpredicateargstest", (r) => {
  r.entity("gadget", gadgetEntity);
  r.useExtension(EXT_DERIVATIVE_PUBLIC_PREDICATE, "gadget", {
    isPublic: (args: DerivativePublicPredicateArgs) => {
      receivedArgs.push(args);
      return args.variant !== "premium";
    },
  });
  r.useExtension(EXT_DERIVATIVE_RENDERER, "image/*", { render: fakeRender });
});

const user = createTestUser({ id: 1, tenantId: TENANT, roles: ["Admin"] });

let stack: TestStack;

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      fileFoundationFeature,
      createFilesFeature(),
      createFileDerivativesFeature({
        resolveApexTenant: (host) => (host === HOST ? TENANT : null),
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

async function uploadGadgetImage(): Promise<string> {
  const token = await stack.jwt.sign(user);
  const fd = new FormData();
  fd.append("file", new File([Buffer.from([1, 2, 3])], "img.jpg", { type: "image/jpeg" }));
  fd.append("entityType", "gadget");
  fd.append("entityId", ENTITY_ID);
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

describe("file-derivatives :: isPublic receives fieldName + variant", () => {
  test("isPublic is called with the FileRef's fieldName and the requested variant name", async () => {
    const fileId = await uploadGadgetImage();

    const res = await stack.app.request(`http://${HOST}/media/${fileId}/thumb`);

    expect(res.status).toBe(200);
    expect(receivedArgs).toHaveLength(1);
    expect(receivedArgs[0]).toMatchObject({
      entityId: ENTITY_ID,
      fieldName: "img",
      variant: "thumb",
    });
  });

  test("a predicate that opts a specific variant out denies exactly that variant, not the whole entity", async () => {
    const fileId = await uploadGadgetImage();

    const thumbRes = await stack.app.request(`http://${HOST}/media/${fileId}/thumb`);
    const premiumRes = await stack.app.request(`http://${HOST}/media/${fileId}/premium`);

    expect(thumbRes.status).toBe(200);
    expect(premiumRes.status).toBe(404);
    expect(receivedArgs.map((a) => a.variant)).toEqual(["thumb", "premium"]);
  });
});
