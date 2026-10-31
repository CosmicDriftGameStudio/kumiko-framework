// copyPendingFileRefsToTenant as a systemScope handler uses it: a form upload is pending in the
// caller's tenant, the record lives in another tenant. Real uploads over HTTP via setupTestStack.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
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
  createFilesField,
  createSystemUser,
  createTextField,
  defineFeature,
} from "../../engine/index.ts";
import { createTestUser } from "../../seeding/seed-users.ts";
import { copyPendingFileRefsToTenant } from "../copy-pending-file-refs-to-tenant.ts";
import { createFilesFeature } from "../feature.ts";
import { createTenantFileContext } from "../file-handle.ts";
import { fileRefsTable } from "../file-ref-table.ts";
import { createInMemoryFileProvider } from "../in-memory-provider.ts";

const FORM = "copyprobe:screen:report-form";
const TARGET_TENANT_ID = "00000000-0000-4000-8000-0000000000b2";
const PDF_BYTES = new TextEncoder().encode("%PDF-1.4 copy probe");

const ticketEntity = createEntity({
  table: "copy_probe_tickets",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture" }),
    attachments: createFilesField({ accept: ["pdf"], maxCount: 3 }),
  },
});

const copyPayload = z.object({
  fileIds: z.array(z.string()),
  ticketId: z.string(),
  sameTenant: z.boolean().default(false),
});

const probeFeature = defineFeature("copyprobe", (r) => {
  r.systemScope();
  r.entity({ name: "ticket", ...ticketEntity });
  r.writeHandler({
    name: "submit",
    schema: z.object({}),
    access: { roles: ["Admin"] },
    handler: async () => ({ isSuccess: true as const, data: {} }),
  });
  r.writeHandler({
    name: "copy",
    schema: copyPayload,
    access: { roles: ["Admin"] },
    handler: async (event, ctx) => {
      const resolver = ctx.services._fileProviderResolver;
      if (!ctx.systemDb || !resolver) throw new Error("probe needs systemDb and a file resolver");
      const crossTenantDb = ctx.systemDb.acknowledgeCrossTenant("test copies across tenants");
      const targetUser = event.payload.sameTenant
        ? event.user
        : createSystemUser(TARGET_TENANT_ID as typeof event.user.tenantId);
      const copied = await copyPendingFileRefsToTenant({
        source: {
          db: crossTenantDb,
          user: event.user,
          files: ctx.services.files,
          entityType: FORM,
          fieldName: "docs",
        },
        target: {
          db: crossTenantDb,
          user: targetUser,
          registry: ctx.registry,
          files: createTenantFileContext(resolver, targetUser.tenantId),
          attachTo: {
            entityType: "ticket",
            fieldName: "attachments",
            entityId: event.payload.ticketId,
          },
        },
        fileIds: event.payload.fileIds,
      });
      if (!copied.isSuccess) return copied;
      return { isSuccess: true as const, data: { ids: copied.data } };
    },
  });
  r.screen({
    id: "report-form",
    type: "actionForm",
    dormant: true,
    handler: "copyprobe:write:submit",
    fields: { docs: createFilesField({ accept: ["pdf"], maxCount: 3 }) },
    layout: { sections: [{ fields: ["docs"] }] },
  });
});

let stack: TestStack;
const reporter = createTestUser({ id: 1, roles: ["Admin"] });
const otherUser = createTestUser({ id: 2, roles: ["Admin"] });

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  stack = await setupTestStack({
    features: [createFilesFeature(), probeFeature],
    files: { storageProvider: createInMemoryFileProvider() },
  });
  await unsafeCreateEntityTable(stack.db, ticketEntity, "ticket");
});

afterAll(async () => {
  await stack.cleanup();
});

async function upload(as: typeof reporter, name: string): Promise<string> {
  const token = await stack.jwt.sign(as);
  const fd = new FormData();
  fd.append("actionForm", FORM);
  fd.append("fieldName", "docs");
  fd.append("file", new File([Buffer.from(PDF_BYTES)], name, { type: "application/pdf" }));
  const { body, contentType } = await buildMultipartBody(fd);
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function fileRefRow(id: string) {
  const [row] = await selectMany(stack.db, fileRefsTable, { id });
  return row;
}

async function downloadAs(as: typeof reporter, id: string): Promise<Response> {
  const token = await stack.jwt.sign(as);
  return stack.app.request(`/api/files/${id}`, { headers: { Authorization: `Bearer ${token}` } });
}

describe("copyPendingFileRefsToTenant", () => {
  test("copies the upload into the target tenant and removes it from the source tenant", async () => {
    const sourceId = await upload(reporter, "report.pdf");
    const ticketId = crypto.randomUUID();

    const { ids } = await stack.http.writeOk<{ ids: string[] }>(
      "copyprobe:write:copy",
      { fileIds: [sourceId], ticketId },
      reporter,
    );

    expect(ids).toHaveLength(1);
    const [copiedId] = ids;
    if (copiedId === undefined) throw new Error("no copied id");
    expect(copiedId).not.toBe(sourceId);
    const copied = await fileRefRow(copiedId);
    expect(copied).toMatchObject({
      tenantId: TARGET_TENANT_ID,
      entityType: "ticket",
      fieldName: "attachments",
      entityId: ticketId,
      mimeType: "application/pdf",
      isDeleted: false,
    });
    expect(await fileRefRow(sourceId)).toMatchObject({ isDeleted: true });
    expect((await downloadAs(reporter, sourceId)).status).toBe(404);
  });

  test("the copy carries the original bytes and file name", async () => {
    const sourceId = await upload(reporter, "evidence.pdf");
    const { ids } = await stack.http.writeOk<{ ids: string[] }>(
      "copyprobe:write:copy",
      { fileIds: [sourceId], ticketId: crypto.randomUUID() },
      reporter,
    );
    const [copiedId] = ids;
    if (copiedId === undefined) throw new Error("no copied id");

    const targetReader = createTestUser({ id: 9, roles: ["Admin"] });
    const res = await downloadAs({ ...targetReader, tenantId: TARGET_TENANT_ID }, copiedId);

    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF_BYTES);
    expect(res.headers.get("content-disposition")).toContain("evidence.pdf");
  });

  test("refuses an upload of another user and copies nothing", async () => {
    const foreignId = await upload(otherUser, "foreign.pdf");
    const ownId = await upload(reporter, "own.pdf");
    const before = (await selectMany(stack.db, fileRefsTable, {})).length;

    const error = await stack.http.writeErr(
      "copyprobe:write:copy",
      { fileIds: [ownId, foreignId], ticketId: crypto.randomUUID() },
      reporter,
    );

    expect(error.code).toBe("unprocessable");
    expect((await selectMany(stack.db, fileRefsTable, {})).length).toBe(before);
    expect(await fileRefRow(foreignId)).toMatchObject({ isDeleted: false, entityId: null });
    expect(await fileRefRow(ownId)).toMatchObject({ isDeleted: false, entityId: null });
  });

  test("refuses an id that is no file ref at all", async () => {
    const error = await stack.http.writeErr(
      "copyprobe:write:copy",
      { fileIds: [crypto.randomUUID()], ticketId: crypto.randomUUID() },
      reporter,
    );

    expect(error.code).toBe("unprocessable");
  });

  test("binds in place when source and target tenant are the same", async () => {
    const sourceId = await upload(reporter, "inplace.pdf");
    const ticketId = crypto.randomUUID();

    const { ids } = await stack.http.writeOk<{ ids: string[] }>(
      "copyprobe:write:copy",
      { fileIds: [sourceId], ticketId, sameTenant: true },
      reporter,
    );

    expect(ids).toEqual([sourceId]);
    expect(await fileRefRow(sourceId)).toMatchObject({
      entityType: "ticket",
      fieldName: "attachments",
      entityId: ticketId,
      isDeleted: false,
    });
  });
});
