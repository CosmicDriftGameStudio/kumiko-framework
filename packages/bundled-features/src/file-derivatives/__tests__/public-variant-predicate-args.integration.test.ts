// Proves that DerivativePublicPredicateArgs carries `fieldName` and
// `variant` (not just entityId/tenantId) through to `isPublic`, so an app
// can opt individual variants out of public serving instead of every
// declared variant on an entityType being implicitly public once the
// entityType-level check passes.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  createEntity,
  createImageField,
  defineEntityCreateHandler,
  defineEntityDetailHandler,
  defineEntityUpdateHandler,
  defineFeature,
  EXT_DERIVATIVE_PUBLIC_PREDICATE,
  EXT_DERIVATIVE_RENDERER,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createFilesFeature,
  createInMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  buildMultipartBody,
  patchFileInstanceofForBunTest,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import type { DerivativeRendererPlugin } from "@cosmicdrift/kumiko-types/derivatives-types";
import { createConfigFeature } from "../../config/index.ts";
import { createFileFoundationFeature } from "../../file-foundation/index.ts";
import { createFileDerivativesFeature } from "../feature.ts";
import type { DerivativePublicPredicateArgs } from "../handlers/public-variant.query.ts";

const VARIANT_BYTES = new Uint8Array([9, 9, 9]);
const fakeRender: DerivativeRendererPlugin["render"] = async () => VARIANT_BYTES;

let entityId = "";
const HOST = "gadgets.example.com";
const TENANT = testTenantId(7);

// Deliberately gates on `variant`, not just entityId — "premium" stays
// denied even for an entityId the entityType-level check would otherwise
// allow, proving a predicate can opt a specific variant out.
let receivedArgs: DerivativePublicPredicateArgs[] = [];
let spoofedFileRefId: string | null = null;
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
  r.entity({ name: "gadget", ...gadgetEntity });
  const adminOnly = { access: { roles: ["Admin"] } } as const;
  r.writeHandler(defineEntityCreateHandler("gadget", gadgetEntity, adminOnly));
  r.writeHandler(defineEntityUpdateHandler("gadget", gadgetEntity, adminOnly));
  r.queryHandler(defineEntityDetailHandler("gadget", gadgetEntity, adminOnly));
  r.useExtension(EXT_DERIVATIVE_PUBLIC_PREDICATE, "gadget", {
    isPublic: (args: DerivativePublicPredicateArgs) => {
      receivedArgs.push(args);
      if (args.fileRefId === spoofedFileRefId) return false;
      return args.variant !== "premium";
    },
  });
  r.useExtension(EXT_DERIVATIVE_RENDERER, "image/*", { render: fakeRender });
});

const user = createTestUser({ id: 1, tenantId: TENANT, roles: ["Admin"] });

const provider = createInMemoryFileProvider();
const readerWithoutUpdate = createTestUser({ id: 2, tenantId: TENANT, roles: ["User"] });
const foreignTenantAdmin = createTestUser({ id: 3, tenantId: testTenantId(8), roles: ["Admin"] });

let stack: TestStack;

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createFileFoundationFeature(),
      createFilesFeature(),
      createFileDerivativesFeature({
        resolveApexTenant: (host) => (host === HOST ? TENANT : null),
      }),
      gadgetPredicateFeature,
    ],
    files: { storageProvider: provider },
  });
  await unsafeCreateEntityTable(stack.db, gadgetEntity, "gadget");
  const created = await stack.http.writeOk<{ id: string }>(
    "publicvariantpredicateargstest:write:gadget:create",
    {},
    user,
  );
  entityId = created.id;
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  receivedArgs = [];
  spoofedFileRefId = null;
  await stack.redis.flushNamespace();
});

async function postGadgetImage(uploader: typeof user): Promise<Response> {
  const token = await stack.jwt.sign(uploader);
  const fd = new FormData();
  const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array(10).fill(0)]);
  fd.append("file", new File([Buffer.from(jpegBytes)], "img.jpg", { type: "image/jpeg" }));
  fd.append("entityType", "gadget");
  fd.append("entityId", entityId);
  fd.append("fieldName", "img");
  const { body, contentType } = await buildMultipartBody(fd);
  return await stack.app.request("/api/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body,
  });
}

async function uploadGadgetImage(): Promise<string> {
  const res = await postGadgetImage(user);
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
      fileRefId: fileId,
      entityId,
      fieldName: "img",
      variant: "thumb",
    });
  });

  test("a predicate can reject a client-spoofed FileRef that claims the same entityId/fieldName", async () => {
    const legitFileId = await uploadGadgetImage();
    const spoofedId = await uploadGadgetImage();
    spoofedFileRefId = spoofedId;

    const legitRes = await stack.app.request(`http://${HOST}/media/${legitFileId}/thumb`);
    const spoofedRes = await stack.app.request(`http://${HOST}/media/${spoofedId}/thumb`);

    expect(legitRes.status).toBe(200);
    expect(spoofedRes.status).toBe(404);
  });

  test("a user without update rights or from another tenant cannot attach a file to the record", async () => {
    const keysBefore = provider.keys().length;

    const withoutUpdate = await postGadgetImage(readerWithoutUpdate);
    const foreignTenant = await postGadgetImage(foreignTenantAdmin);

    expect(withoutUpdate.status).toBe(404);
    expect(foreignTenant.status).toBe(404);
    expect(provider.keys()).toHaveLength(keysBefore);
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
