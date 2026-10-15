// files:write:bind-referenced-files — binds the files a record references via
// its declared file fields to that record, for legacy uploads and records
// created outside the save lifecycle. Real stack, real HTTP calls.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asRawClient, selectMany } from "../../bun-db/index.js";
import { createEventStoreExecutor, createTenantDb } from "../../db/index.js";
import {
  createEntity,
  createFileField,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDetailHandler,
  defineFeature,
} from "../../engine/index.js";
import { createSystemUser } from "../../engine/system-user.js";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
} from "../../stack/index.js";
import { buildMultipartBody, patchFileInstanceofForBunTest } from "../../testing/index.js";
import { createFilesFeature } from "../feature.js";
import { fileRefsTable } from "../file-ref-table.js";
import { createLocalProvider } from "../local-provider.js";
import { findImplicitEntityTable } from "../record-write-check.js";

const dossierEntity = createEntity({
  table: "bind_ref_dossiers",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
    scan: createFileField(),
    cover: createFileField(),
  },
});

const textOnlyEntity = createEntity({
  table: "bind_ref_plain",
  fields: { title: createTextField({ personal: false, reason: "test_fixture", required: true }) },
});

const ROLES = { access: { roles: ["Admin", "User", "SystemAdmin"] } } as const;

const bindFeature = defineFeature("bind-ref", (r) => {
  r.entity("dossier", dossierEntity);
  r.entity("plain", textOnlyEntity);
  r.writeHandler(defineEntityCreateHandler("dossier", dossierEntity, ROLES));
  r.queryHandler(defineEntityDetailHandler("dossier", dossierEntity, ROLES));
});

const CREATE = "bind-ref:write:dossier:create";
const BIND = "files:write:bind-referenced-files";

let stack: TestStack;
let storagePath: string;

const tenantOne = testTenantId(1);
const uploader = createTestUser({ id: 1, tenantId: tenantOne, roles: ["Admin"] });
const reader = createTestUser({ id: 3, tenantId: tenantOne, roles: ["User"] });
const tenantAdmin = createTestUser({ id: 4, tenantId: tenantOne, roles: ["TenantAdmin"] });
const otherTenantAdmin = createTestUser({
  id: 2,
  tenantId: testTenantId(2),
  roles: ["Admin"],
});
const system = createSystemUser(tenantOne, ["SystemAdmin"]);

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  storagePath = await mkdtemp(join(tmpdir(), "kumiko-bind-referenced-"));
  stack = await setupTestStack({
    features: [createFilesFeature(), bindFeature],
    files: { storageProvider: createLocalProvider(storagePath) },
  });
  await unsafeCreateEntityTable(stack.db, dossierEntity, "dossier");
  await unsafeCreateEntityTable(stack.db, textOnlyEntity, "plain");
});

afterAll(async () => {
  await stack.cleanup();
  await rm(storagePath, { recursive: true, force: true });
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(
    `TRUNCATE bind_ref_dossiers, file_refs RESTART IDENTITY CASCADE`,
  );
});

const PDF_BYTES = new TextEncoder().encode("%PDF-1.4 minimal");

async function upload(
  as: typeof uploader,
  fields: { entityType?: string; fieldName?: string } = {},
): Promise<string> {
  const token = await stack.jwt.sign(as);
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.append(key, value);
  fd.append("file", new File([Buffer.from(PDF_BYTES)], "doc.pdf", { type: "application/pdf" }));
  const { body, contentType } = await buildMultipartBody(fd);
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function fileStatusFor(as: typeof uploader, fileRefId: string): Promise<number> {
  const token = await stack.jwt.sign(as);
  const res = await stack.app.request(`/api/files/${fileRefId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.status;
}

async function fileRefRow(id: string): Promise<Record<string, unknown> | undefined> {
  const [row] = await selectMany(stack.db, fileRefsTable, { id });
  return row;
}

// The system user skips the uploader-only bind of a pending upload, which is
// exactly how a record ends up referencing files that stay unbound.
async function createDossierAsSystem(fields: Record<string, unknown>): Promise<string> {
  const result = await stack.dispatcher.write(CREATE, { title: "Dossier", ...fields }, system);
  if (!result.isSuccess) throw new Error(`create failed: ${result.error.message}`);
  return String((result.data as { id: string }).id);
}

type BindResult = { bound: number; skipped: number; nextAfterId: string | null };

async function bindAsSystem(payload: Record<string, unknown>): Promise<BindResult> {
  const result = await stack.dispatcher.write(BIND, payload, createSystemUser(tenantOne));
  if (!result.isSuccess) throw new Error(`bind failed: ${result.error.message}`);
  return result.data as BindResult;
}

describe("files:write:bind-referenced-files", () => {
  test("binds an unbound upload of someone else so a record reader can open it", async () => {
    const fileRefId = await upload(uploader);
    const dossierId = await createDossierAsSystem({ scan: fileRefId });
    expect(await fileStatusFor(reader, fileRefId)).toBe(404);

    const result = await bindAsSystem({ entityType: "dossier", entityIds: [dossierId] });

    expect(result).toEqual({ bound: 1, skipped: 0, nextAfterId: null });
    expect(await fileRefRow(fileRefId)).toMatchObject({
      entityType: "dossier",
      entityId: dossierId,
      fieldName: "scan",
    });
    expect(await fileStatusFor(reader, fileRefId)).toBe(200);
  });

  test("binds a pending upload prepared for the same field", async () => {
    const fileRefId = await upload(uploader, { entityType: "dossier", fieldName: "scan" });
    const dossierId = await createDossierAsSystem({ scan: fileRefId });

    const result = await bindAsSystem({ entityType: "dossier", entityIds: [dossierId] });

    expect(result.bound).toBe(1);
    expect((await fileRefRow(fileRefId))?.["entityId"]).toBe(dossierId);
  });

  test("skips a pending upload prepared for another field", async () => {
    const fileRefId = await upload(uploader, { entityType: "dossier", fieldName: "cover" });
    const dossierId = await createDossierAsSystem({ scan: fileRefId });

    const result = await bindAsSystem({ entityType: "dossier", entityIds: [dossierId] });

    expect(result).toEqual({ bound: 0, skipped: 1, nextAfterId: null });
    expect((await fileRefRow(fileRefId))?.["entityId"]).toBeNull();
  });

  test("never rebinds a file that belongs to another record", async () => {
    const fileRefId = await upload(uploader, { entityType: "dossier", fieldName: "scan" });
    const first = await stack.http.writeOk<{ id: string }>(
      CREATE,
      { title: "Owner", scan: fileRefId },
      uploader,
    );
    expect((await fileRefRow(fileRefId))?.["entityId"]).toBe(first.id);
    const second = await createDossierAsSystem({ scan: fileRefId });

    const result = await bindAsSystem({ entityType: "dossier", entityIds: [second] });

    expect(result).toEqual({ bound: 0, skipped: 1, nextAfterId: null });
    expect((await fileRefRow(fileRefId))?.["entityId"]).toBe(first.id);
  });

  test("skips files of another tenant and files that do not exist", async () => {
    const foreignFileRefId = await upload(otherTenantAdmin);
    const missingFileRefId = "0198f2c0-6d1e-7a3b-9c4d-5e6f7a8b9c0d";
    const table = findImplicitEntityTable(stack.registry, "dossier");
    if (table === undefined) throw new Error("dossier projection table missing");
    // Written past the save lifecycle: its tenant check would reject both ids.
    const executor = createEventStoreExecutor(table, dossierEntity, { entityName: "dossier" });
    const created = await executor.create(
      { title: "Legacy", scan: foreignFileRefId, cover: missingFileRefId },
      system,
      createTenantDb(stack.db, tenantOne),
    );
    if (!created.isSuccess) throw new Error(`seed failed: ${created.error.message}`);

    const result = await bindAsSystem({
      entityType: "dossier",
      entityIds: [String((created.data as { id: string }).id)],
    });

    expect(result).toEqual({ bound: 0, skipped: 2, nextAfterId: null });
    expect((await fileRefRow(foreignFileRefId))?.["entityId"]).toBeNull();
  });

  test("rejects an entity without file fields and an unknown entity", async () => {
    for (const entityType of ["plain", "ghost"]) {
      const result = await stack.dispatcher.write(BIND, { entityType }, system);
      expect(result.isSuccess).toBe(false);
      if (!result.isSuccess) expect(result.error.code).toBe("validation_error");
    }
  });

  test("pages through the records with limit and nextAfterId", async () => {
    const fileRefIds: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const fileRefId = await upload(uploader);
      fileRefIds.push(fileRefId);
      await createDossierAsSystem({ scan: fileRefId });
    }

    const firstPage = await bindAsSystem({ entityType: "dossier", limit: 2 });
    expect(firstPage.bound).toBe(2);
    expect(firstPage.nextAfterId).not.toBeNull();

    const secondPage = await bindAsSystem({
      entityType: "dossier",
      limit: 2,
      afterId: firstPage.nextAfterId ?? undefined,
    });
    expect(secondPage).toEqual({ bound: 1, skipped: 0, nextAfterId: null });
    for (const fileRefId of fileRefIds) {
      expect((await fileRefRow(fileRefId))?.["entityId"]).not.toBeNull();
    }
  });

  test("is refused for ordinary users, tenant admins included", async () => {
    for (const as of [uploader, tenantAdmin, reader]) {
      const err = await stack.http.writeErr(BIND, { entityType: "dossier" }, as);
      expect(err.code).toBe("access_denied");
    }
  });
});
