// Uploads into an actionForm files field: the file is pending under the screen QN until the
// form's handler binds it. Real HTTP via setupTestStack.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  buildMultipartBody,
  patchFileInstanceofForBunTest,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { selectMany } from "../../db/query.ts";
import {
  createEntity,
  createFileField,
  createFilesField,
  createTextField,
  defineFeature,
} from "../../engine/index.ts";
import { createTestUser, testTenantId } from "../../seeding/seed-users.ts";
import { bindPendingFileRef } from "../bind-pending-file-refs.ts";
import { createFilesFeature } from "../feature.ts";
import { fileRefsTable } from "../file-ref-table.ts";
import { createInMemoryFileProvider, type InMemoryFileProvider } from "../in-memory-provider.ts";

const FORM = "formprobe:screen:submit-form";
const STAFF_FORM = "formprobe:screen:staff-form";
const PLAIN_SCREEN = "formprobe:screen:plain";

const pdfOnlyEntity = createEntity({
  table: "form_probe_docs",
  fields: { copy: createFileField({ accept: ["pdf"] }) },
});

const bindPayload = z.object({ fileRefId: z.string(), entityId: z.string() });

const probeFeature = defineFeature("formprobe", (r) => {
  r.entity({ name: "doc", ...pdfOnlyEntity });
  r.writeHandler({
    name: "submit",
    schema: z.object({}),
    access: { roles: ["Admin"] },
    handler: async () => ({ isSuccess: true as const, data: {} }),
  });
  r.writeHandler({
    name: "bind-copy",
    schema: bindPayload,
    access: { roles: ["Admin"] },
    handler: async (event, ctx) => {
      const outcome = await bindPendingFileRef({
        fileRefId: event.payload.fileRefId,
        entityName: FORM,
        fieldName: "docs",
        entityId: event.payload.entityId,
        bindTo: { entityName: "doc", fieldName: "copy" },
        registry: ctx.registry,
        user: event.user,
        db: ctx.db,
      });
      return { isSuccess: true as const, data: { outcome } };
    },
  });
  r.screen({
    id: "submit-form",
    type: "actionForm",
    dormant: true,
    handler: "formprobe:write:submit",
    fields: {
      docs: createFilesField({ accept: ["pdf", "png"], maxCount: 3 }),
      big: createFilesField({ accept: ["pdf"], maxSize: "200kb" }),
      note: createTextField({ personal: false, reason: "test_fixture" }),
    },
    layout: { sections: [{ fields: ["docs", "big", "note"] }] },
  });
  r.screen({
    id: "staff-form",
    type: "actionForm",
    dormant: true,
    handler: "formprobe:write:submit",
    access: { roles: ["SystemAdmin"] },
    fields: { docs: createFilesField({ accept: ["pdf"] }) },
    layout: { sections: [{ fields: ["docs"] }] },
  });
  r.screen({
    id: "plain",
    type: "custom",
    dormant: true,
    renderer: { react: { __component: "plain" } },
  });
});

const PDF_BYTES = new TextEncoder().encode("%PDF-1.4 minimal");
const PNG_BYTES = new Uint8Array([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  ...Array(12).fill(0),
]);

let stack: TestStack;
let provider: InMemoryFileProvider;
let priorFileRefIds: ReadonlySet<string> = new Set();
const tenantUser = createTestUser({ id: 1, roles: ["Admin"] });
const noHandlerAccess = createTestUser({ id: 2, roles: ["User"] });

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  provider = createInMemoryFileProvider();
  stack = await setupTestStack({
    features: [createFilesFeature({ maxUploadSize: "1kb" }), probeFeature],
    files: { storageProvider: provider },
  });
  await unsafeCreateEntityTable(stack.db, pdfOnlyEntity, "doc");
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  // file_refs is executor-only (no typed delete), so earlier rows are remembered and ignored.
  priorFileRefIds = new Set((await selectMany(stack.db, fileRefsTable, {})).map((row) => row.id));
  for (const key of provider.keys()) await provider.delete(key);
});

type UploadFields = Record<string, string>;

async function post(
  as: typeof tenantUser,
  fields: UploadFields,
  file: { name: string; type: string; bytes: Uint8Array } = {
    name: "doc.pdf",
    type: "application/pdf",
    bytes: PDF_BYTES,
  },
): Promise<Response> {
  const token = await stack.jwt.sign(as);
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.append(key, value);
  fd.append("file", new File([Buffer.from(file.bytes)], file.name, { type: file.type }));
  const { body, contentType } = await buildMultipartBody(fd);
  return stack.app.request("/api/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body,
  });
}

async function allFileRefs() {
  return (await selectMany(stack.db, fileRefsTable, {})).filter(
    (row) => !priorFileRefIds.has(row.id),
  );
}

describe("upload with actionForm", () => {
  test("is stored pending under the screen QN, without the QN in the storage key", async () => {
    const res = await post(tenantUser, { actionForm: FORM, fieldName: "docs" });

    expect(res.status).toBe(201);
    const { id, storageKey } = (await res.json()) as { id: string; storageKey: string };
    expect(storageKey).toContain("action-form");
    expect(storageKey).not.toContain("formprobe");
    const [row] = await selectMany(stack.db, fileRefsTable, { id });
    expect(row).toMatchObject({ entityType: FORM, fieldName: "docs", entityId: null });
  });

  test("rejects a file above the field's maxSize with 400", async () => {
    const big = new Uint8Array(2048);
    big.set(PDF_BYTES);
    const res = await post(
      tenantUser,
      { actionForm: FORM, fieldName: "docs" },
      {
        name: "big.pdf",
        type: "application/pdf",
        bytes: big,
      },
    );

    expect(res.status).toBe(400);
    expect(await allFileRefs()).toEqual([]);
  });

  test("rejects a type the field does not accept and content that does not match", async () => {
    const wrongType = await post(
      tenantUser,
      { actionForm: FORM, fieldName: "big" },
      {
        name: "a.png",
        type: "image/png",
        bytes: PNG_BYTES,
      },
    );
    const wrongContent = await post(
      tenantUser,
      { actionForm: FORM, fieldName: "docs" },
      {
        name: "fake.pdf",
        type: "application/pdf",
        bytes: new TextEncoder().encode("plain text, not a pdf"),
      },
    );

    expect(wrongType.status).toBe(400);
    expect(wrongContent.status).toBe(400);
    expect(await allFileRefs()).toEqual([]);
  });

  test("a field maxSize above the default passes the body limit", async () => {
    const bytes = new Uint8Array(150 * 1024);
    bytes.set(PDF_BYTES);
    const res = await post(
      tenantUser,
      { actionForm: FORM, fieldName: "big" },
      {
        name: "scan.pdf",
        type: "application/pdf",
        bytes,
      },
    );

    expect(res.status).toBe(201);
  });

  test("answers 400 for an unknown screen, a non-actionForm screen and a non-file field", async () => {
    const results = await Promise.all([
      post(tenantUser, { actionForm: "formprobe:screen:missing", fieldName: "docs" }),
      post(tenantUser, { actionForm: PLAIN_SCREEN, fieldName: "docs" }),
      post(tenantUser, { actionForm: FORM, fieldName: "note" }),
      post(tenantUser, { actionForm: FORM, fieldName: "nope" }),
      post(tenantUser, { actionForm: FORM }),
      post(tenantUser, { actionForm: "not a qn", fieldName: "docs" }),
    ]);

    expect(results.map((res) => res.status)).toEqual([400, 400, 400, 400, 400, 400]);
    expect(await allFileRefs()).toEqual([]);
  });

  test("cannot be combined with entityType or entityId", async () => {
    const withType = await post(tenantUser, {
      actionForm: FORM,
      fieldName: "docs",
      entityType: "doc",
    });
    const withId = await post(tenantUser, {
      actionForm: FORM,
      fieldName: "docs",
      entityType: "doc",
      entityId: crypto.randomUUID(),
    });

    expect(withType.status).toBe(400);
    expect(withId.status).toBe(400);
    expect(await allFileRefs()).toEqual([]);
  });

  test("a caller without access to the form's handler gets 403 and nothing is stored", async () => {
    const res = await post(noHandlerAccess, { actionForm: FORM, fieldName: "docs" });

    expect(res.status).toBe(403);
    expect(await allFileRefs()).toEqual([]);
    expect(provider.keys()).toEqual([]);
  });

  test("a caller without access to the screen gets 403 even with handler access", async () => {
    const res = await post(tenantUser, { actionForm: STAFF_FORM, fieldName: "docs" });

    expect(res.status).toBe(403);
    expect(await allFileRefs()).toEqual([]);
    expect(provider.keys()).toEqual([]);
  });
});

describe("bindPendingFileRef bindTo", () => {
  async function uploadPending(name: string, type: string, bytes: Uint8Array): Promise<string> {
    const res = await post(
      tenantUser,
      { actionForm: FORM, fieldName: "docs" },
      { name, type, bytes },
    );
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  }

  test("re-tags the upload onto the target entity field", async () => {
    const id = await uploadPending("a.pdf", "application/pdf", PDF_BYTES);
    const entityId = crypto.randomUUID();

    const { outcome } = await stack.http.writeOk<{ outcome: string }>(
      "formprobe:write:bind-copy",
      { fileRefId: id, entityId },
      tenantUser,
    );

    expect(outcome).toBe("bound");
    const [row] = await selectMany(stack.db, fileRefsTable, { id });
    expect(row).toMatchObject({ entityType: "doc", fieldName: "copy", entityId });
  });

  test("a target that is stricter than the form field refuses the upload", async () => {
    const id = await uploadPending("b.png", "image/png", PNG_BYTES);

    const error = await stack.http.writeErr(
      "formprobe:write:bind-copy",
      { fileRefId: id, entityId: crypto.randomUUID() },
      tenantUser,
    );

    expect(error.code).toBe("unprocessable");
    const [row] = await selectMany(stack.db, fileRefsTable, { id });
    expect(row).toMatchObject({ entityType: FORM, fieldName: "docs", entityId: null });
  });
});

describe("upload with an actionForm that is open to anonymous callers", () => {
  const OPEN_FORM = "openform:screen:contact-form";
  const openFeature = defineFeature("openform", (r) => {
    r.writeHandler({
      name: "contact",
      schema: z.object({}),
      access: { roles: ["anonymous"] },
      handler: async () => ({ isSuccess: true as const, data: {} }),
    });
    r.screen({
      id: "contact-form",
      type: "actionForm",
      dormant: true,
      handler: "openform:write:contact",
      fields: { docs: createFilesField({ accept: ["pdf"] }) },
      layout: { sections: [{ fields: ["docs"] }] },
    });
  });

  const anonymousUploadTargets: Record<string, Record<string, string>> = {
    "an actionForm": { actionForm: OPEN_FORM, fieldName: "docs" },
    "no target": {},
    "an entityId": {
      entityType: "doc",
      entityId: "11111111-2222-4333-8444-555555555555",
      fieldName: "docs",
    },
  };

  test.each(Object.keys(anonymousUploadTargets))(
    "an anonymous visitor uploading with %s gets 401 unauthenticated and nothing is stored",
    async (targetName) => {
      const openProvider = createInMemoryFileProvider();
      const openStack = await setupTestStack({
        features: [createFilesFeature(), openFeature],
        files: { storageProvider: openProvider },
        anonymousAccess: { defaultTenantId: testTenantId(1) },
      });
      try {
        const fd = new FormData();
        for (const [key, value] of Object.entries(anonymousUploadTargets[targetName] ?? {})) {
          fd.append(key, value);
        }
        fd.append(
          "file",
          new File([Buffer.from(PDF_BYTES)], "doc.pdf", { type: "application/pdf" }),
        );
        const { body, contentType } = await buildMultipartBody(fd);

        const res = await openStack.app.request("/api/files", {
          method: "POST",
          headers: { "Content-Type": contentType },
          body,
        });

        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({
          error: "unauthenticated: sign in to upload files",
          code: "unauthenticated",
        });
        expect(await selectMany(openStack.db, fileRefsTable, {})).toEqual([]);
        expect(openProvider.keys()).toEqual([]);
      } finally {
        await openStack.cleanup();
      }
    },
  );
});

describe("anonymous upload into a field with anonymousUpload", () => {
  const optInFeature = defineFeature("optin", (r) => {
    r.entity({
      name: "photo",
      table: "optin_photos",
      fields: {
        open: createFileField({ anonymousUpload: true, accept: ["pdf"] }),
        closed: createFileField({ accept: ["pdf"] }),
      },
    });
    r.writeHandler({
      name: "contact",
      schema: z.object({}),
      access: { roles: ["anonymous"] },
      handler: async () => ({ isSuccess: true as const, data: {} }),
    });
    r.screen({
      id: "contact-form",
      type: "actionForm",
      dormant: true,
      handler: "optin:write:contact",
      fields: { docs: createFilesField({ accept: ["pdf"] }) },
      layout: { sections: [{ fields: ["docs"] }] },
    });
  });

  let optInStack: TestStack;
  beforeAll(async () => {
    patchFileInstanceofForBunTest();
    optInStack = await setupTestStack({
      features: [createFilesFeature(), optInFeature],
      files: { storageProvider: createInMemoryFileProvider() },
      anonymousAccess: { defaultTenantId: testTenantId(1) },
    });
  });
  afterAll(async () => {
    await optInStack.cleanup();
  });

  async function anonymousUpload(fields: Record<string, string>): Promise<Response> {
    const fd = new FormData();
    for (const [key, value] of Object.entries(fields)) fd.append(key, value);
    fd.append("file", new File([Buffer.from(PDF_BYTES)], "doc.pdf", { type: "application/pdf" }));
    const { body, contentType } = await buildMultipartBody(fd);
    return optInStack.app.request("/api/files", {
      method: "POST",
      headers: { "Content-Type": contentType },
      body,
    });
  }

  test("a pending upload without entityId is stored", async () => {
    const res = await anonymousUpload({ entityType: "photo", fieldName: "open" });
    expect(res.status).toBe(201);
    const stored = (await res.json()) as { id: string };
    const [row] = await selectMany(optInStack.db, fileRefsTable, { id: stored.id });
    expect(row).toMatchObject({ entityType: "photo", fieldName: "open", entityId: null });
  });

  test.each([
    ["a field without the opt-in", { entityType: "photo", fieldName: "closed" }],
    [
      "an entityId",
      {
        entityType: "photo",
        fieldName: "open",
        entityId: "11111111-2222-4333-8444-555555555555",
      },
    ],
    ["an actionForm", { actionForm: "optin:screen:contact-form", fieldName: "docs" }],
    ["no target", {}],
  ])("%s gets 401", async (_name, fields) => {
    const res = await anonymousUpload(fields);
    expect(res.status).toBe(401);
  });
});
