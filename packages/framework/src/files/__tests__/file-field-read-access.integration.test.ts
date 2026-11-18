// A record reader without read access on the file's field must not get the file through the
// file routes: the field is stripped from the record, so its file stays closed too. Real stack,
// real HTTP calls.

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
import { selectMany } from "../../db/query.ts";
import {
  createEmbeddedListField,
  createEntity,
  createFileField,
  createFilesField,
  createTextField,
  defineFeature,
} from "../../engine/index.ts";
import type { SessionUser } from "../../engine/types/index.ts";
import { createTestUser, TestUsers, testTenantId } from "../../seeding/seed-users.ts";
import { createFilesFeature } from "../feature.ts";
import { fileRefsTable } from "../file-ref-table.ts";
import { createInMemoryFileProvider } from "../in-memory-provider.ts";

const FIELD_READERS = ["Admin", "Auditor"];
const restrictedFieldAccess = { read: FIELD_READERS, write: ["Admin"] };

const dossierEntity = createEntity({
  name: "dossier",
  table: "field_read_dossiers",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
    scan: createFileField({ access: restrictedFieldAccess }),
    docs: createFilesField({ access: restrictedFieldAccess }),
    cover: createFileField(),
    checks: createEmbeddedListField(
      { photos: { type: "files", access: restrictedFieldAccess } },
      { personal: false, reason: "is_business_data" },
    ),
  },
});

const sealedEntity = createEntity({
  name: "sealed",
  table: "field_read_sealed",
  attachedFileAccess: "record-only",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
    scan: createFileField({ access: restrictedFieldAccess }),
  },
});

const RECORD_READERS = { access: { roles: ["Admin", "User", "Auditor", "TenantAdmin"] } } as const;
const RECORD_WRITERS = { access: { roles: ["Admin"] } } as const;

const fieldReadFeature = defineFeature("field-read", (r) => {
  r.crud(dossierEntity, { write: RECORD_WRITERS, read: RECORD_READERS });
  r.crud(sealedEntity, { write: RECORD_WRITERS, read: RECORD_READERS });
});

const tenant = testTenantId(1);
const uploader = TestUsers.admin;
const auditor = createTestUser({ id: 21, tenantId: tenant, roles: ["Auditor"] });
const recordReader = createTestUser({ id: 22, tenantId: tenant, roles: ["User"] });
const tenantAdmin = createTestUser({ id: 23, tenantId: tenant, roles: ["TenantAdmin"] });
const otherTenantAdmin = TestUsers.otherTenant;

const PDF_BYTES = "%PDF-1.4 field read";

let stack: TestStack;
let dossierId: string;
const files = {
  scan: "",
  docsA: "",
  docsB: "",
  cover: "",
  photo: "",
  sealedScan: "",
};

async function upload(
  target: { entityType: string; fieldName: string; subField?: string } | undefined,
): Promise<string> {
  const fd = new FormData();
  for (const [key, value] of Object.entries(target ?? {})) fd.append(key, value);
  fd.append("file", new File([Buffer.from(PDF_BYTES)], "doc.pdf", { type: "application/pdf" }));
  const { body, contentType } = await buildMultipartBody(fd);
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await stack.jwt.sign(uploader)}`,
      "Content-Type": contentType,
    },
    body,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function get(as: SessionUser, path: string): Promise<Response> {
  return stack.app.request(`/api/files/${path}`, {
    headers: { Authorization: `Bearer ${await stack.jwt.sign(as)}` },
  });
}

async function downloadStatus(as: SessionUser, fileRefId: string): Promise<number> {
  return (await get(as, fileRefId)).status;
}

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  stack = await setupTestStack({
    features: [createFilesFeature(), fieldReadFeature],
    files: {
      storageProvider: {
        ...createInMemoryFileProvider(),
        getSignedUrl: async (storageKey) => `https://files.example.test/${storageKey}`,
      },
    },
  });
  await unsafeCreateEntityTable(stack.db, dossierEntity, "dossier");
  await unsafeCreateEntityTable(stack.db, sealedEntity, "sealed");

  files.scan = await upload({ entityType: "dossier", fieldName: "scan" });
  files.docsA = await upload({ entityType: "dossier", fieldName: "docs" });
  files.docsB = await upload({ entityType: "dossier", fieldName: "docs" });
  files.cover = await upload({ entityType: "dossier", fieldName: "cover" });
  files.photo = await upload({ entityType: "dossier", fieldName: "checks", subField: "photos" });
  const dossier = await stack.http.writeOk<{ id: string }>(
    "field-read:write:dossier:create",
    {
      title: "Roof",
      scan: files.scan,
      docs: [files.docsA, files.docsB],
      cover: files.cover,
      checks: [{ photos: [files.photo] }],
    },
    uploader,
  );
  dossierId = dossier.id;

  files.sealedScan = await upload({ entityType: "sealed", fieldName: "scan" });
  await stack.http.writeOk(
    "field-read:write:sealed:create",
    {
      title: "Sealed",
      scan: files.sealedScan,
    },
    uploader,
  );
});

afterAll(async () => {
  await stack.cleanup();
});

describe("file download honours the read access of the file's field", () => {
  test("the record reader sees the record, but not the restricted fields", async () => {
    const record = await stack.http.queryOk<Record<string, unknown>>(
      "field-read:query:dossier:detail",
      { id: dossierId },
      recordReader,
    );
    expect(record["title"]).toBe("Roof");
    expect(record["cover"]).toBe(files.cover);
    expect(record["scan"]).toBeUndefined();
    expect(record["docs"]).toBeUndefined();
    expect(record["checks"]).toEqual([{}]);
  });

  test("a caller who may read the field gets the file", async () => {
    const res = await get(auditor, files.scan);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(PDF_BYTES);
  });

  test("a record reader without read access on the field is denied", async () => {
    expect(await downloadStatus(recordReader, files.scan)).toBe(404);
  });

  test("a files field: both files open for the field reader, closed for the record reader", async () => {
    expect(await downloadStatus(auditor, files.docsA)).toBe(200);
    expect(await downloadStatus(auditor, files.docsB)).toBe(200);
    expect(await downloadStatus(recordReader, files.docsA)).toBe(404);
    expect(await downloadStatus(recordReader, files.docsB)).toBe(404);
  });

  test("an embedded file sub-field with its own read access", async () => {
    expect(await downloadStatus(auditor, files.photo)).toBe(200);
    expect(await downloadStatus(recordReader, files.photo)).toBe(404);
  });

  test("an unrestricted file field stays open to every record reader", async () => {
    expect(await downloadStatus(recordReader, files.cover)).toBe(200);
  });

  test("the uploader keeps the file", async () => {
    expect(await downloadStatus(uploader, files.scan)).toBe(200);
  });

  test("a privileged role keeps the file", async () => {
    expect(await downloadStatus(tenantAdmin, files.scan)).toBe(200);
  });

  test("another tenant is denied", async () => {
    expect(await downloadStatus(otherTenantAdmin, files.scan)).toBe(404);
  });

  test("record-only entity: the field rule applies to the privileged role as well", async () => {
    expect(await downloadStatus(auditor, files.sealedScan)).toBe(200);
    expect(await downloadStatus(tenantAdmin, files.sealedScan)).toBe(404);
    expect(await downloadStatus(recordReader, files.sealedScan)).toBe(404);
  });
});

// The earlier probe uploaded without a target field and then saved the id into the record.
describe("an upload without a target field stays unbound after the save", () => {
  test("no record reader gets it, whatever the field rule says", async () => {
    const unbound = await upload(undefined);
    await stack.http.writeOk(
      "field-read:write:dossier:create",
      { title: "Probe", scan: unbound },
      uploader,
    );
    const [row] = await selectMany<Record<string, unknown>>(stack.db, fileRefsTable, {
      id: unbound,
    });
    expect([row?.["entityType"], row?.["entityId"], row?.["fieldName"]]).toEqual([
      null,
      null,
      null,
    ]);
    expect(await downloadStatus(auditor, unbound)).toBe(404);
    expect(await downloadStatus(recordReader, unbound)).toBe(404);
    expect(await downloadStatus(uploader, unbound)).toBe(200);
  });
});

// A save may move an id between the record's own file fields while file_refs.fieldName stays at
// the field it was uploaded for, so the decision follows the field that holds the file now.
describe("a file moved to another field of the record", () => {
  async function createAndMove(
    from: "scan" | "cover",
    to: "scan" | "cover",
  ): Promise<{ fileRefId: string; recordId: string }> {
    const fileRefId = await upload({ entityType: "dossier", fieldName: from });
    const created = await stack.http.writeOk<{ id: string }>(
      "field-read:write:dossier:create",
      { title: "Moved", [from]: fileRefId },
      uploader,
    );
    await stack.http.writeOk(
      "field-read:write:dossier:update",
      { id: created.id, version: 1, changes: { [from]: null, [to]: fileRefId } },
      uploader,
    );
    const [row] = await selectMany<Record<string, unknown>>(stack.db, fileRefsTable, {
      id: fileRefId,
    });
    expect(row?.["fieldName"]).toBe(from);
    return { fileRefId, recordId: created.id };
  }

  test("from an unrestricted into a restricted field: closed for the record reader", async () => {
    const { fileRefId, recordId } = await createAndMove("cover", "scan");
    const record = await stack.http.queryOk<Record<string, unknown>>(
      "field-read:query:dossier:detail",
      { id: recordId },
      recordReader,
    );
    expect(record["cover"]).toBeNull();
    expect(record["scan"]).toBeUndefined();
    expect(await downloadStatus(recordReader, fileRefId)).toBe(404);
    expect(await downloadStatus(auditor, fileRefId)).toBe(200);
  });

  test("from a restricted into an unrestricted field: open to every record reader", async () => {
    const { fileRefId, recordId } = await createAndMove("scan", "cover");
    const record = await stack.http.queryOk<Record<string, unknown>>(
      "field-read:query:dossier:detail",
      { id: recordId },
      recordReader,
    );
    expect(record["cover"]).toBe(fileRefId);
    expect(await downloadStatus(recordReader, fileRefId)).toBe(200);
    expect(await downloadStatus(auditor, fileRefId)).toBe(200);
  });
});

describe("the other routes that serve a file by its id apply the same rule", () => {
  test("GET /files/:id/meta", async () => {
    expect((await get(auditor, `${files.scan}/meta`)).status).toBe(200);
    expect((await get(recordReader, `${files.scan}/meta`)).status).toBe(404);
  });

  test("GET /files/meta?ids= leaves the unreadable file out", async () => {
    const res = await get(recordReader, `meta?ids=${files.scan},${files.cover}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { files: ReadonlyArray<{ id: string }> };
    expect(body.files.map((file) => file.id)).toEqual([files.cover]);
  });

  test("GET /files/:id/download-url", async () => {
    expect((await get(auditor, `${files.scan}/download-url`)).status).toBe(200);
    expect((await get(recordReader, `${files.scan}/download-url`)).status).toBe(404);
  });
});
