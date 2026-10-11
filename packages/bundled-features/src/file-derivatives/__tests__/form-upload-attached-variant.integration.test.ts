// Form uploads must end up attached to their record, otherwise a qr-overlay
// variant has nothing to resolve the QR payload against. An update form sends
// the record id with the upload; a create form uploads before the record
// exists and the create binds the caller's pending uploads. Attached files are
// readable by everyone who may read the record. Upload bodies are built from
// the real edit view model's hints and the real renderer-web form-data builder.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import {
  createEntity,
  createImageField,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDetailHandler,
  defineFeature,
  EXT_DERIVATIVE_OVERLAY_RESOLVER,
  EXT_DERIVATIVE_RENDERER,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import {
  createFilesFeature,
  createInMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  buildMultipartBody,
  patchFileInstanceofForBunTest,
} from "@cosmicdrift/kumiko-framework/testing";
import type { EntityEditScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import {
  computeEditViewModel,
  type EditFieldViewModel,
  type EditViewModel,
} from "@cosmicdrift/kumiko-headless";
import { buildFileUploadFormData } from "@cosmicdrift/kumiko-renderer-web";
import type { DerivativeRendererPlugin } from "@cosmicdrift/kumiko-types/derivatives-types";
import * as z from "zod";
import { createConfigFeature } from "../../config/index.js";
import { fileFoundationFeature } from "../../file-foundation/index.js";
import { createFileDerivativesFeature } from "../feature.js";

const tenantId = testTenantId(1);
const user = createTestUser({ id: 1, tenantId, roles: ["Admin"] });
const otherAdmin = createTestUser({ id: 2, tenantId, roles: ["Admin"] });
const technician = createTestUser({ id: 3, tenantId, roles: ["Technician"] });
const guest = createTestUser({ id: 4, tenantId, roles: ["Guest"] });

const QR_LAYER = {
  kind: "qr",
  dataToken: "public-url",
  widthPct: 0.2,
  gravity: "center",
} as const;
const CARD_VARIANT = { maxEdge: 400, format: "webp", overlays: [QR_LAYER] } as const;

const gadgetEntity = createEntity({
  table: "form_upload_gadgets",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
    photo: createImageField({ variants: { card: CARD_VARIANT } }),
  },
});

type ResolverArgs = {
  readonly entityId: string;
  readonly tenantId: string;
  readonly fieldName: string;
  readonly dataToken: string;
};
let resolverCalls: ResolverArgs[] = [];
let renderedSpecs: unknown[] = [];

const stubRenderer: DerivativeRendererPlugin = {
  render: async (_input, spec) => {
    renderedSpecs.push(spec);
    return new Uint8Array([1, 2, 3]);
  },
};

const gadgetFeature = defineFeature("form-upload-gadget", (r) => {
  r.requires("file-derivatives");
  r.entity("gadget", gadgetEntity);
  r.writeHandler(
    defineEntityCreateHandler("gadget", gadgetEntity, { access: { roles: ["Admin"] } }),
  );
  r.queryHandler(
    defineEntityDetailHandler("gadget", gadgetEntity, {
      access: { roles: ["Admin", "Technician"] },
    }),
  );
  r.useExtension(EXT_DERIVATIVE_RENDERER, "image/*", stubRenderer);
  r.useExtension(EXT_DERIVATIVE_OVERLAY_RESOLVER, "gadget", {
    resolve: async (args: ResolverArgs) => {
      resolverCalls.push(args);
      return `https://example.com/gadget/${args.entityId}`;
    },
  });
  r.writeHandler(
    "render-card",
    z.object({ fileRefId: z.uuid() }),
    async (event, ctx) => {
      if (!ctx.derivatives) {
        return writeFailure(new InternalError({ message: "ctx.derivatives missing" }));
      }
      try {
        await ctx.derivatives.variant(event.payload.fileRefId, CARD_VARIANT, "card");
        return {
          isSuccess: true as const,
          data: { rendered: true, failedWithInternalError: false },
        };
      } catch (error) {
        if (!(error instanceof InternalError)) throw error;
        return {
          isSuccess: true as const,
          data: { rendered: false, failedWithInternalError: true },
        };
      }
    },
    { access: { openToAll: { reason: "test fixture: any signed-in user may render" } } },
  );
});

const editScreen: EntityEditScreenDefinition = {
  id: "form-upload-gadget:screen:gadget-edit",
  type: "entityEdit",
  entity: "gadget",
  layout: { sections: [{ fields: ["title", "photo"] }] },
};

function photoHints(mode: "create" | "update", entityId?: string): EditFieldViewModel {
  const viewModel: EditViewModel = computeEditViewModel({
    screen: editScreen,
    entity: gadgetEntity,
    values: {},
    translate: (key) => key,
    featureName: "form-upload-gadget",
    mode,
    ...(entityId !== undefined && { entityId }),
  });
  const section = viewModel.sections[0];
  if (section?.kind !== "fields") throw new Error("expected a fields section");
  const photo = section.fields.find((f) => f.field === "photo");
  if (photo === undefined) throw new Error("photo field missing from the view model");
  return photo;
}

let stack: TestStack;

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      fileFoundationFeature,
      createFilesFeature(),
      createFileDerivativesFeature(),
      gadgetFeature,
    ],
    files: { storageProvider: createInMemoryFileProvider() },
  });
  await unsafeCreateEntityTable(stack.db, gadgetEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(() => {
  resolverCalls = [];
  renderedSpecs = [];
});

async function uploadLikeTheForm(
  hints: EditFieldViewModel,
  uploader: SessionUser = user,
): Promise<string> {
  const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array(10).fill(0)]);
  const formData = buildFileUploadFormData({
    file: new File([Buffer.from(jpegBytes)], "photo.jpg", { type: "image/jpeg" }),
    entityType: hints.entityType,
    entityId: hints.entityId,
    fieldName: hints.fieldName,
  });
  const { body, contentType } = await buildMultipartBody(formData);
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: { Authorization: await bearer(uploader), "Content-Type": contentType },
    body,
  });
  expect(res.status).toBe(201);
  const json = (await res.json()) as { id: string };
  return json.id;
}

async function bearer(sessionUser: SessionUser): Promise<string> {
  return `Bearer ${await stack.jwt.sign(sessionUser)}`;
}

async function createGadget(photo?: string): Promise<string> {
  const created = await stack.http.writeOk<{ id: string }>(
    "form-upload-gadget:write:gadget:create",
    { title: "Gadget", ...(photo !== undefined && { photo }) },
    user,
  );
  return created.id;
}

async function renderCard(
  fileRefId: string,
): Promise<{ rendered: boolean; failedWithInternalError: boolean }> {
  return await stack.http.writeOk("form-upload-gadget:write:render-card", { fileRefId }, user);
}

function expectQrResolvedAgainst(gadgetId: string): void {
  expect(resolverCalls).toEqual([
    { entityId: gadgetId, tenantId, fieldName: "photo", dataToken: "public-url" },
  ]);
  expect(renderedSpecs).toHaveLength(1);
  expect(renderedSpecs[0]).toMatchObject({
    resolvedOverlays: [
      {
        kind: "qr",
        data: `https://example.com/gadget/${gadgetId}`,
        widthPct: 0.2,
        gravity: "center",
      },
    ],
  });
}

describe("form uploads attached to their record, then a qr-overlay variant", () => {
  test("update-mode hints carry the record id, so the variant renders with the QR resolved against that record", async () => {
    const gadgetId = await createGadget();
    const hints = photoHints("update", gadgetId);
    expect(hints.entityId).toBe(gadgetId);

    const fileRefId = await uploadLikeTheForm(hints);
    const result = await renderCard(fileRefId);

    expect(result.rendered).toBe(true);
    expectQrResolvedAgainst(gadgetId);
  });

  test("a create-form upload is bound to the record by the create, so the variant renders", async () => {
    const hints = photoHints("create");
    expect(hints.entityId).toBeUndefined();
    const fileRefId = await uploadLikeTheForm(hints);

    const gadgetId = await createGadget(fileRefId);
    const result = await renderCard(fileRefId);

    expect(result).toEqual({ rendered: true, failedWithInternalError: false });
    expectQrResolvedAgainst(gadgetId);
  });

  test("a create naming another user's pending upload leaves that upload unbound", async () => {
    const foreignFileRefId = await uploadLikeTheForm(photoHints("create"), otherAdmin);

    await createGadget(foreignFileRefId);
    const result = await renderCard(foreignFileRefId);

    expect(result).toEqual({ rendered: false, failedWithInternalError: true });
    expect(resolverCalls).toEqual([]);
  });
});

describe("read access to files attached to a record", () => {
  test("whoever may read the record reads its files; others and deletes stay denied", async () => {
    const gadgetId = await createGadget();
    const fileRefId = await uploadLikeTheForm(photoHints("update", gadgetId));

    const asTechnician = await stack.app.request(`/api/files/${fileRefId}`, {
      headers: { Authorization: await bearer(technician) },
    });
    expect(asTechnician.status).toBe(200);

    const asGuest = await stack.app.request(`/api/files/${fileRefId}`, {
      headers: { Authorization: await bearer(guest) },
    });
    expect(asGuest.status).toBe(404);

    const deleteAsTechnician = await stack.app.request(`/api/files/${fileRefId}`, {
      method: "DELETE",
      headers: { Authorization: await bearer(technician) },
    });
    expect(deleteAsTechnician.status).toBe(404);
  });
});
