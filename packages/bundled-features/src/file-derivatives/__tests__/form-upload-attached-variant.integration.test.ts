// Form uploads must end up attached to their record, otherwise a qr-overlay
// variant has nothing to resolve the QR payload against. An update form sends
// the record id with the upload; a create form (or a server handler) uploads
// before the record names the file and the create or update binds the caller's
// pending uploads. Attached files are readable by everyone who may read the
// record; a pending upload only by its uploader and privileged roles. Upload
// bodies are built from the real edit view model's hints and the real
// renderer-web form-data builder.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import {
  createEntity,
  createImageField,
  createImagesField,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDetailHandler,
  defineEntityUpdateHandler,
  defineFeature,
  EXT_DERIVATIVE_OVERLAY_RESOLVER,
  EXT_DERIVATIVE_RENDERER,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import {
  createFileRefFromBytes,
  createFilesFeature,
  createInMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import type { EntityEditScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import {
  computeEditViewModel,
  type EditFieldViewModel,
  type EditViewModel,
} from "@cosmicdrift/kumiko-headless";
import { buildFileUploadFormData } from "@cosmicdrift/kumiko-renderer-web";
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
import * as z from "zod";
import { createConfigFeature } from "../../config/index.js";
import { createFileFoundationFeature } from "../../file-foundation/index.js";
import { createFileDerivativesFeature } from "../feature.js";

const tenantId = testTenantId(1);
const user = createTestUser({ id: 1, tenantId, roles: ["Admin"] });
const otherAdmin = createTestUser({ id: 2, tenantId, roles: ["Admin"] });
const technician = createTestUser({ id: 3, tenantId, roles: ["Technician"] });
const otherTechnician = createTestUser({ id: 5, tenantId, roles: ["Technician"] });
const editor = createTestUser({ id: 6, tenantId, roles: ["Editor"] });
const guest = createTestUser({ id: 4, tenantId, roles: ["Guest"] });

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array(10).fill(0)]);

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
    gallery: createImagesField({ maxCount: 4 }),
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
  r.requires({ features: ["file-derivatives"] });
  r.entity({ name: "fieldGadget", ...gadgetEntity });
  r.writeHandler(
    defineEntityCreateHandler("fieldGadget", gadgetEntity, { access: { roles: ["Admin"] } }),
  );
  r.writeHandler(
    defineEntityUpdateHandler("fieldGadget", gadgetEntity, {
      access: { roles: ["Admin", "Editor"] },
    }),
  );
  r.queryHandler(
    defineEntityDetailHandler("fieldGadget", gadgetEntity, {
      access: { roles: ["Admin", "Technician"] },
    }),
  );
  r.useExtension(EXT_DERIVATIVE_RENDERER, "image/*", stubRenderer);
  r.useExtension(EXT_DERIVATIVE_OVERLAY_RESOLVER, "fieldGadget", {
    resolve: async (args: ResolverArgs) => {
      resolverCalls.push(args);
      return `https://example.com/gadget/${args.entityId}`;
    },
  });
  r.writeHandler({
    name: "attach-generated-photo",
    schema: z.object({ gadgetId: z.uuid(), version: z.number() }),
    handler: async (event, ctx) => {
      const stored = await createFileRefFromBytes(ctx, {
        fileName: "generated.jpg",
        mimeType: "image/jpeg",
        data: JPEG_BYTES,
        attachTo: { entityType: "fieldGadget", fieldName: "photo" },
      });
      if (!stored.isSuccess) return stored;
      const updated = await ctx.write("form-upload-gadget:write:field-gadget:update", {
        id: event.payload.gadgetId,
        version: event.payload.version,
        changes: { photo: stored.data.id },
      });
      if (!updated.isSuccess) return updated;
      return { isSuccess: true as const, data: { fileRefId: stored.data.id } };
    },
    access: { roles: ["Admin"] },
  });
  r.writeHandler({
    name: "render-card",
    schema: z.object({ fileRefId: z.uuid() }),
    handler: async (event, ctx) => {
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
    access: { openToAll: { reason: "test fixture: any signed-in user may render" } },
  });
});

const editScreen: EntityEditScreenDefinition = {
  id: "form-upload-gadget:screen:gadget-edit",
  type: "entityEdit",
  entity: "fieldGadget",
  layout: { sections: [{ fields: ["title", "photo", "gallery"] }] },
};

function photoHints(mode: "create" | "update", entityId?: string): EditFieldViewModel {
  return fieldHints("photo", mode, entityId);
}

function fieldHints(
  fieldName: "photo" | "gallery",
  mode: "create" | "update",
  entityId?: string,
): EditFieldViewModel {
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
  const field = section.fields.find((f) => f.field === fieldName);
  if (field === undefined) throw new Error(`${fieldName} field missing from the view model`);
  return field;
}

let stack: TestStack;

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createFileFoundationFeature(),
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
  const formData = buildFileUploadFormData({
    file: new File([Buffer.from(JPEG_BYTES)], "photo.jpg", { type: "image/jpeg" }),
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

async function createGadget(
  files: { readonly photo?: string; readonly gallery?: readonly string[] } = {},
): Promise<string> {
  const created = await stack.http.writeOk<{ id: string }>(
    "form-upload-gadget:write:field-gadget:create",
    { title: "Gadget", ...files },
    user,
  );
  return created.id;
}

async function readFileAs(fileRefId: string, reader: SessionUser): Promise<number> {
  return await requestFileRoute(fileRefId, reader, "");
}

async function requestFileRoute(
  fileRefId: string,
  reader: SessionUser,
  suffix: "" | "/meta" | "/download-url" | "/variant/card",
): Promise<number> {
  const res = await stack.app.request(`/api/files/${fileRefId}${suffix}`, {
    headers: { Authorization: await bearer(reader) },
  });
  return res.status;
}

async function updateGadgetPhoto(gadgetId: string, photo: string): Promise<void> {
  await stack.http.writeOk(
    "form-upload-gadget:write:field-gadget:update",
    { id: gadgetId, version: 1, changes: { photo } },
    user,
  );
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

    const gadgetId = await createGadget({ photo: fileRefId });
    const result = await renderCard(fileRefId);

    expect(result).toEqual({ rendered: true, failedWithInternalError: false });
    expectQrResolvedAgainst(gadgetId);
  });

  test("a create naming another user's pending upload leaves that upload unbound", async () => {
    const foreignFileRefId = await uploadLikeTheForm(photoHints("create"), otherAdmin);

    await createGadget({ photo: foreignFileRefId });
    const result = await renderCard(foreignFileRefId);

    expect(result).toEqual({ rendered: false, failedWithInternalError: true });
    expect(resolverCalls).toEqual([]);
  });
});

describe("read access to files attached to a record", () => {
  test("every pending upload of a plural images field is bound by the create", async () => {
    const galleryHints = fieldHints("gallery", "create");
    const first = await uploadLikeTheForm(galleryHints);
    const second = await uploadLikeTheForm(galleryHints);
    expect(await readFileAs(first, technician)).toBe(404);

    await createGadget({ gallery: [first, second] });

    for (const fileRefId of [first, second]) {
      expect(await readFileAs(fileRefId, technician)).toBe(200);
      expect(await readFileAs(fileRefId, guest)).toBe(404);
    }
  });

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

describe("pending uploads are private to their uploader until bound", () => {
  test("another user in the tenant gets 404 on every read route; uploader and admin read it", async () => {
    const pendingId = await uploadLikeTheForm(photoHints("create"), technician);

    for (const suffix of ["", "/meta", "/download-url", "/variant/card"] as const) {
      expect(await requestFileRoute(pendingId, otherTechnician, suffix)).toBe(404);
    }
    expect(await requestFileRoute(pendingId, technician, "")).toBe(200);
    expect(await requestFileRoute(pendingId, technician, "/meta")).toBe(200);
    expect(await requestFileRoute(pendingId, user, "")).toBe(200);
    expect(await requestFileRoute(pendingId, user, "/meta")).toBe(200);
  });

  test("an upload without an entityType is private to its uploader and admins", async () => {
    const hints = { ...photoHints("create"), entityType: undefined, fieldName: undefined };
    const formData = buildFileUploadFormData({
      file: new File([Buffer.from(JPEG_BYTES)], "loose.jpg", { type: "image/jpeg" }),
      entityType: hints.entityType,
      entityId: undefined,
      fieldName: hints.fieldName,
    });
    const { body, contentType } = await buildMultipartBody(formData);
    const res = await stack.app.request("/api/files", {
      method: "POST",
      headers: { Authorization: await bearer(technician), "Content-Type": contentType },
      body,
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };

    expect(await readFileAs(id, otherTechnician)).toBe(404);
    expect(await requestFileRoute(id, otherTechnician, "/meta")).toBe(404);
    expect(await readFileAs(id, technician)).toBe(200);
    expect(await readFileAs(id, user)).toBe(200);
  });

  test("an update that names the caller's pending upload binds it, so record readers can read it", async () => {
    const gadgetId = await createGadget();
    const pendingId = await uploadLikeTheForm(photoHints("create"));
    expect(await readFileAs(pendingId, technician)).toBe(404);

    await updateGadgetPhoto(gadgetId, pendingId);

    expect(await readFileAs(pendingId, technician)).toBe(200);
    expect(await readFileAs(pendingId, guest)).toBe(404);
    const result = await renderCard(pendingId);
    expect(result.rendered).toBe(true);
    expectQrResolvedAgainst(gadgetId);
  });

  test("an update naming another user's pending upload leaves it unbound", async () => {
    const gadgetId = await createGadget();
    const foreignId = await uploadLikeTheForm(photoHints("create"), otherAdmin);

    await updateGadgetPhoto(gadgetId, foreignId);

    expect(await readFileAs(foreignId, technician)).toBe(404);
  });

  test("a server handler that stores bytes for a field and then updates the record binds the file", async () => {
    const gadgetId = await createGadget();

    const { fileRefId } = await stack.http.writeOk<{ fileRefId: string }>(
      "form-upload-gadget:write:attach-generated-photo",
      { gadgetId, version: 1 },
      user,
    );

    expect(await readFileAs(fileRefId, technician)).toBe(200);
    expect(await readFileAs(fileRefId, guest)).toBe(404);
  });

  test("a plural update binds only the ids it names, in the stored order", async () => {
    const gadgetId = await createGadget();
    const galleryHints = fieldHints("gallery", "create");
    const first = await uploadLikeTheForm(galleryHints);
    const second = await uploadLikeTheForm(galleryHints);

    await stack.http.writeOk(
      "form-upload-gadget:write:field-gadget:update",
      { id: gadgetId, version: 1, changes: { gallery: [second, first] } },
      user,
    );

    const detail = await stack.http.queryOk<{ gallery: string[] }>(
      "form-upload-gadget:query:field-gadget:detail",
      { id: gadgetId },
      user,
    );
    expect(detail.gallery).toEqual([second, first]);
    expect(await readFileAs(first, technician)).toBe(200);
    expect(await readFileAs(second, technician)).toBe(200);
  });
});

describe("files removed from a record are disposed", () => {
  async function updateGadget(
    gadgetId: string,
    version: number,
    changes: Record<string, unknown>,
    actor: SessionUser = user,
  ): Promise<void> {
    await stack.http.writeOk(
      "form-upload-gadget:write:field-gadget:update",
      { id: gadgetId, version, changes },
      actor,
    );
  }

  test("an update that drops one image of a plural field leaves 404 for it and 200 for the kept one", async () => {
    const galleryHints = fieldHints("gallery", "create");
    const kept = await uploadLikeTheForm(galleryHints);
    const dropped = await uploadLikeTheForm(galleryHints);
    const gadgetId = await createGadget({ gallery: [kept, dropped] });
    expect(await readFileAs(dropped, technician)).toBe(200);

    await updateGadget(gadgetId, 1, { gallery: [kept] });

    expect(await readFileAs(kept, technician)).toBe(200);
    expect(await readFileAs(dropped, technician)).toBe(404);
    expect(await readFileAs(dropped, user)).toBe(404);
  });

  test("another user with write access can remove a photo the first user uploaded and attached", async () => {
    const uploaded = await uploadLikeTheForm(photoHints("create"), otherAdmin);
    const created = await stack.http.writeOk<{ id: string }>(
      "form-upload-gadget:write:field-gadget:create",
      { title: "Gadget", photo: uploaded },
      otherAdmin,
    );
    expect(await readFileAs(uploaded, technician)).toBe(200);

    await updateGadget(created.id, 1, { photo: null }, user);

    expect(await readFileAs(uploaded, technician)).toBe(404);
    expect(await readFileAs(uploaded, otherAdmin)).toBe(404);
  });

  test("an updater who is neither admin nor the uploader can remove the file through the record write right", async () => {
    const uploaded = await uploadLikeTheForm(photoHints("create"), otherAdmin);
    const created = await stack.http.writeOk<{ id: string }>(
      "form-upload-gadget:write:field-gadget:create",
      { title: "Gadget", photo: uploaded },
      otherAdmin,
    );
    expect(await readFileAs(uploaded, technician)).toBe(200);

    await updateGadget(created.id, 1, { photo: null }, editor);

    expect(await readFileAs(uploaded, technician)).toBe(404);
  });

  test("replacing a single file makes the old file 404 and keeps the new one readable", async () => {
    const oldFile = await uploadLikeTheForm(photoHints("create"));
    const gadgetId = await createGadget({ photo: oldFile });
    const replacement = await uploadLikeTheForm(photoHints("update", gadgetId));

    await updateGadget(gadgetId, 1, { photo: replacement });

    expect(await readFileAs(oldFile, technician)).toBe(404);
    expect(await readFileAs(replacement, technician)).toBe(200);
  });

  test("an id moved from one file field to another in the same update stays readable", async () => {
    const file = await uploadLikeTheForm(photoHints("create"));
    const gadgetId = await createGadget({ photo: file });

    await updateGadget(gadgetId, 1, { photo: null, gallery: [file] });

    expect(await readFileAs(file, technician)).toBe(200);
  });

  test("a file bound to another record is not disposed when this record drops its id", async () => {
    const shared = await uploadLikeTheForm(photoHints("create"));
    const owner = await createGadget({ photo: shared });
    const other = await createGadget();
    await updateGadget(other, 1, { photo: shared });
    expect(await readFileAs(shared, technician)).toBe(200);

    await updateGadget(other, 2, { photo: null });

    expect(await readFileAs(shared, technician)).toBe(200);
    expect(owner).not.toBe(other);
  });
});
