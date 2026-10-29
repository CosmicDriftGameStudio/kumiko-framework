// rebindFileRef as a record that takes over an upload uses it: the file is uploaded and bound to
// an upload record over HTTP, then a custom handler moves it onto a contact.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type RebindFileRefOutcome, rebindFileRef } from "@cosmicdrift/kumiko-framework/files";
import {
  buildMultipartBody,
  patchFileInstanceofForBunTest,
} from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { selectMany } from "../../db/query.ts";
import {
  createEntity,
  createFileField,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDeleteHandler,
  defineEntityDetailHandler,
  defineEntityUpdateHandler,
  defineFeature,
} from "../../engine/index.ts";
import { createTestUser, testTenantId } from "../../seeding/seed-users.ts";
import { createFilesFeature } from "../feature.ts";
import { fileRefsTable } from "../file-ref-table.ts";
import { createInMemoryFileProvider } from "../in-memory-provider.ts";

const openToAll = { openToAll: { reason: "test handler callable by any signed-in test user" } };
const name = () =>
  createTextField({ required: true, maxLength: 64, personal: false, reason: "test" });

const uploadEntity = createEntity({
  table: "rebind_t_uploads",
  fields: { name: name(), file: createFileField() },
});
const contactEntity = createEntity({
  table: "rebind_t_contacts",
  fields: {
    name: name(),
    doc: createFileField({ accept: ["pdf"] }),
    photo: createFileField({ accept: ["png"] }),
  },
});

const rebindPayload = z.object({
  fileRefId: z.string(),
  uploadId: z.string(),
  contactId: z.string(),
  fieldName: z.string().default("doc"),
});

function ownersOf(payload: z.infer<typeof rebindPayload>) {
  return {
    fileRefId: payload.fileRefId,
    from: { entityType: "upload", entityId: payload.uploadId, fieldName: "file" },
    to: { entityType: "contact", entityId: payload.contactId, fieldName: payload.fieldName },
  };
}

const probeFeature = defineFeature("rebind-probe", (r) => {
  r.entity({ name: "upload", ...uploadEntity });
  r.entity({ name: "contact", ...contactEntity });
  r.writeHandler(defineEntityCreateHandler("upload", uploadEntity, { access: openToAll }));
  r.queryHandler(
    defineEntityDetailHandler("upload", uploadEntity, { access: { roles: ["Clerk", "Viewer"] } }),
  );
  r.writeHandler(
    defineEntityUpdateHandler("upload", uploadEntity, { access: { roles: ["Clerk"] } }),
  );
  r.writeHandler(
    defineEntityDeleteHandler("upload", uploadEntity, { access: { roles: ["Clerk"] } }),
  );
  r.writeHandler(defineEntityCreateHandler("contact", contactEntity, { access: openToAll }));
  r.queryHandler(defineEntityDetailHandler("contact", contactEntity, { access: openToAll }));
  r.writeHandler(
    defineEntityUpdateHandler("contact", contactEntity, {
      access: { roles: ["Clerk", "ContactEditor"] },
    }),
  );
  r.writeHandler({
    name: "rebind",
    schema: rebindPayload,
    access: openToAll,
    handler: async (event, ctx) => {
      const outcome = await rebindFileRef(ctx, ownersOf(event.payload));
      return { isSuccess: true as const, data: { outcome } };
    },
  });
  r.job("rebind-as-system", { trigger: { manual: true }, retries: 0 }, async (payload, ctx) => {
    const outcome = await rebindFileRef(
      { db: ctx.db, registry: ctx.registry, user: ctx.systemUser },
      ownersOf(rebindPayload.parse(payload)),
    );
    if (outcome !== "rebound") throw new Error(`rebind outcome: ${outcome}`);
  });
});

const tenant = testTenantId(1);
const clerk = createTestUser({ id: 1, tenantId: tenant, roles: ["Clerk"] });
// Reads the upload, may not edit contacts.
const viewer = createTestUser({ id: 2, tenantId: tenant, roles: ["Viewer"] });
// Edits contacts, cannot read the upload.
const contactEditor = createTestUser({ id: 3, tenantId: tenant, roles: ["ContactEditor"] });
const foreignClerk = createTestUser({ id: 4, tenantId: testTenantId(2), roles: ["Clerk"] });

const PDF = new TextEncoder().encode("%PDF-1.4 rebind fixture");
const REBIND = "rebind-probe:write:rebind";

let stack: TestStack;

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  stack = await setupTestStack({
    features: [createFilesFeature(), probeFeature],
    files: { storageProvider: createInMemoryFileProvider() },
    jobs: { consumerLane: "worker" },
  });
});
afterAll(() => stack.cleanup());

async function uploadBoundFile(as = clerk): Promise<{ fileRefId: string; uploadId: string }> {
  const token = await stack.jwt.sign(as);
  const form = new FormData();
  form.append("entityType", "upload");
  form.append("fieldName", "file");
  form.append("file", new File([Buffer.from(PDF)], "scan.pdf", { type: "application/pdf" }));
  const { body, contentType } = await buildMultipartBody(form);
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body,
  });
  expect(res.status).toBe(201);
  const fileRefId = z.object({ id: z.string() }).parse(await res.json()).id;
  const created = await stack.http.writeOk<{ id: string }>(
    "rebind-probe:write:upload:create",
    { name: "Scan", file: fileRefId },
    as,
  );
  return { fileRefId, uploadId: created.id };
}

async function createContact(as = clerk): Promise<string> {
  const created = await stack.http.writeOk<{ id: string }>(
    "rebind-probe:write:contact:create",
    { name: "Ada" },
    as,
  );
  return created.id;
}

async function rebindAs(
  as: typeof clerk,
  payload: { fileRefId: string; uploadId: string; contactId: string; fieldName?: string },
): Promise<RebindFileRefOutcome> {
  const { outcome } = await stack.http.writeOk<{ outcome: RebindFileRefOutcome }>(
    REBIND,
    payload,
    as,
  );
  return outcome;
}

async function fileStatusFor(reader: typeof clerk, fileRefId: string): Promise<number> {
  const res = await stack.app.request(`/api/files/${fileRefId}`, {
    headers: { Authorization: `Bearer ${await stack.jwt.sign(reader)}` },
  });
  return res.status;
}

async function ownerOf(fileRefId: string) {
  const [row] = await selectMany(stack.db, fileRefsTable, { id: fileRefId });
  return {
    entityType: row?.["entityType"],
    entityId: row?.["entityId"],
    fieldName: row?.["fieldName"],
  };
}

describe("rebindFileRef", () => {
  test("moves a bound upload onto the contact's file field, and again is a no-op", async () => {
    const { fileRefId, uploadId } = await uploadBoundFile();
    const contactId = await createContact();
    expect(await ownerOf(fileRefId)).toEqual({
      entityType: "upload",
      entityId: uploadId,
      fieldName: "file",
    });

    expect(await rebindAs(clerk, { fileRefId, uploadId, contactId })).toBe("rebound");
    expect(await ownerOf(fileRefId)).toEqual({
      entityType: "contact",
      entityId: contactId,
      fieldName: "doc",
    });
    expect(await rebindAs(clerk, { fileRefId, uploadId, contactId })).toBe("rebound");
  });

  test("a system job may move the file without the caller checks", async () => {
    const { fileRefId, uploadId } = await uploadBoundFile();
    const contactId = await createContact();

    await stack.jobRunner?.dispatch("rebind-probe:job:rebind-as-system", {
      tenantId: tenant,
      fileRefId,
      uploadId,
      contactId,
    });
    await stack.drainJobs();

    expect((await ownerOf(fileRefId)).entityId).toBe(contactId);
  });

  test("the contact takes the file over: it saves the ref, its readers get the file, and the upload no longer disposes of it", async () => {
    const { fileRefId, uploadId } = await uploadBoundFile();
    const contactId = await createContact();
    expect(await fileStatusFor(contactEditor, fileRefId)).toBe(404);

    expect(await rebindAs(clerk, { fileRefId, uploadId, contactId })).toBe("rebound");
    const contact = await stack.http.queryOk<{ version: number }>(
      "rebind-probe:query:contact:detail",
      { id: contactId },
      clerk,
    );
    await stack.http.writeOk(
      "rebind-probe:write:contact:update",
      { id: contactId, version: contact.version, changes: { doc: fileRefId } },
      clerk,
    );
    expect(
      await stack.http.queryOk<{ doc: string }>(
        "rebind-probe:query:contact:detail",
        { id: contactId },
        clerk,
      ),
    ).toMatchObject({ doc: fileRefId });
    expect(await fileStatusFor(contactEditor, fileRefId)).toBe(200);

    const upload = await stack.http.queryOk<{ version: number }>(
      "rebind-probe:query:upload:detail",
      { id: uploadId },
      clerk,
    );
    const cleared = await stack.http.writeOk<{ version: number }>(
      "rebind-probe:write:upload:update",
      { id: uploadId, version: upload.version, changes: { file: null } },
      clerk,
    );
    await stack.http.writeOk(
      "rebind-probe:write:upload:delete",
      { id: uploadId, version: cleared.version },
      clerk,
    );
    expect((await ownerOf(fileRefId)).entityId).toBe(contactId);
    expect(await fileStatusFor(contactEditor, fileRefId)).toBe(200);
  });

  test("a system job cannot point the file at a record that does not exist", async () => {
    const { fileRefId, uploadId } = await uploadBoundFile();

    await stack.jobRunner?.dispatch("rebind-probe:job:rebind-as-system", {
      tenantId: tenant,
      fileRefId,
      uploadId,
      contactId: crypto.randomUUID(),
    });
    await expect(stack.drainJobs()).rejects.toThrow(/rebind-as-system/);

    expect((await ownerOf(fileRefId)).entityId).toBe(uploadId);
  });

  test("another tenant's file is not found and stays where it is", async () => {
    const { fileRefId, uploadId } = await uploadBoundFile();
    const foreignContactId = await createContact(foreignClerk);

    expect(await rebindAs(foreignClerk, { fileRefId, uploadId, contactId: foreignContactId })).toBe(
      "not-found",
    );
    expect((await ownerOf(fileRefId)).entityId).toBe(uploadId);
  });

  test("a caller who may not write the target, or not read the file, is refused", async () => {
    const { fileRefId, uploadId } = await uploadBoundFile();
    const contactId = await createContact();

    const notWritable = await stack.http.writeErr(
      REBIND,
      { fileRefId, uploadId, contactId },
      viewer,
    );
    expect(notWritable.code).toBe("access_denied");
    expect(notWritable.message).toContain("is not writable");

    const notReadable = await stack.http.writeErr(
      REBIND,
      { fileRefId, uploadId, contactId },
      contactEditor,
    );
    expect(notReadable.code).toBe("access_denied");
    expect(notReadable.message).toContain("is not readable");

    expect((await ownerOf(fileRefId)).entityId).toBe(uploadId);
  });

  test("a target field the file does not fit is refused", async () => {
    const { fileRefId, uploadId } = await uploadBoundFile();
    const contactId = await createContact();

    const refused = await stack.http.writeErr(
      REBIND,
      { fileRefId, uploadId, contactId, fieldName: "photo" },
      clerk,
    );
    expect(refused.code).toBe("unprocessable");
    expect((await ownerOf(fileRefId)).entityId).toBe(uploadId);
  });

  test("of two parallel rebinds exactly one wins and the file points at the winner", async () => {
    const { fileRefId, uploadId } = await uploadBoundFile();
    const contactIds = [await createContact(), await createContact()] as const;

    const outcomes = await Promise.all(
      contactIds.map((contactId) => rebindAs(clerk, { fileRefId, uploadId, contactId })),
    );

    expect(outcomes.filter((outcome) => outcome === "rebound")).toHaveLength(1);
    expect(outcomes.find((outcome) => outcome !== "rebound")).toMatch(/^(moved|version-conflict)$/);
    expect((await ownerOf(fileRefId)).entityId).toBe(contactIds.at(outcomes.indexOf("rebound")));
  });
});
