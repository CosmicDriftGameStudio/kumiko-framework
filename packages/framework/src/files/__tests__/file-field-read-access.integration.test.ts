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
  from,
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
      { photos: { type: "files", access: restrictedFieldAccess }, sketches: { type: "files" } },
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

// Each check row is read by its own inspector, so the row decides who reads its photos.
const inspectionEntity = createEntity({
  name: "inspection",
  table: "field_read_inspections",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
    checks: createEmbeddedListField(
      {
        inspector: { type: "text" },
        photos: {
          type: "files",
          access: { read: { Admin: "all", Clerk: from("user:id", "inspector") } },
        },
      },
      { personal: false, reason: "is_business_data" },
    ),
  },
});

const RECORD_READERS = { access: { roles: ["Admin", "User", "Auditor", "TenantAdmin"] } } as const;
const RECORD_WRITERS = { access: { roles: ["Admin", "Clerk", "TenantAdmin"] } } as const;

const fieldReadFeature = defineFeature("field-read", (r) => {
  r.crud(dossierEntity, { write: RECORD_WRITERS, read: RECORD_READERS });
  r.crud(sealedEntity, { write: RECORD_WRITERS, read: RECORD_READERS });
  r.crud(inspectionEntity, { write: RECORD_WRITERS, read: RECORD_READERS });
});

const tenant = testTenantId(1);
const uploader = TestUsers.admin;
const auditor = createTestUser({ id: 21, tenantId: tenant, roles: ["Auditor"] });
const recordReader = createTestUser({ id: 22, tenantId: tenant, roles: ["User"] });
const tenantAdmin = createTestUser({ id: 23, tenantId: tenant, roles: ["TenantAdmin"] });
// Writes the record and its open fields, but may not read the restricted ones.
const clerk = createTestUser({ id: 24, tenantId: tenant, roles: ["User", "Clerk"] });
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
  target:
    | { entityType: string; fieldName: string; subField?: string; entityId?: string }
    | undefined,
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
  await unsafeCreateEntityTable(stack.db, inspectionEntity, "inspection");

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

// The field that holds a file decides who reads it, so naming a restricted field's file in an open
// field would hand it to every record reader. Only a writer who may read the source field may move it.
describe("a writer who may not read the source field cannot move its file into an open field", () => {
  async function restrictedDossier(): Promise<{
    recordId: string;
    scan: string;
    docs: string;
    photo: string;
  }> {
    const scan = await upload({ entityType: "dossier", fieldName: "scan" });
    const docs = await upload({ entityType: "dossier", fieldName: "docs" });
    const photo = await upload({ entityType: "dossier", fieldName: "checks", subField: "photos" });
    const created = await stack.http.writeOk<{ id: string }>(
      "field-read:write:dossier:create",
      { title: "Locked", scan, docs: [docs], checks: [{ photos: [photo] }] },
      uploader,
    );
    return { recordId: created.id, scan, docs, photo };
  }

  test.each([
    ["a file field", "scan"],
    ["a files field", "docs"],
    ["an embedded file sub-field", "photo"],
  ] as const)(
    "from %s: rejected, the file stays closed to the record reader",
    async (_, source) => {
      const dossier = await restrictedDossier();
      const fileRefId = dossier[source];

      const err = await stack.http.writeErr(
        "field-read:write:dossier:update",
        { id: dossier.recordId, version: 1, changes: { cover: fileRefId } },
        clerk,
      );

      expect(err.code).toBe("validation_error");
      expect(JSON.stringify(err.details)).toContain("invalid_element");
      const record = await stack.http.queryOk<Record<string, unknown>>(
        "field-read:query:dossier:detail",
        { id: dossier.recordId },
        recordReader,
      );
      expect(record["cover"]).toBeNull();
      expect(await downloadStatus(recordReader, fileRefId)).toBe(404);
    },
  );

  test("from a restricted embedded sub-field into an open sibling: rejected", async () => {
    const dossier = await restrictedDossier();

    const err = await stack.http.writeErr(
      "field-read:write:dossier:update",
      {
        id: dossier.recordId,
        version: 1,
        changes: { checks: [{ photos: [dossier.photo], sketches: [dossier.photo] }] },
      },
      clerk,
    );

    expect(err.code).toBe("validation_error");
    expect(JSON.stringify(err.details)).toContain("invalid_element");
    expect(await downloadStatus(recordReader, dossier.photo)).toBe(404);
  });

  // Uploaded straight onto the record for the restricted field and not saved into it yet: no field
  // holds it, so the record shows it to nobody but the uploader and privileged roles.
  test("from an upload bound to the record's restricted field that no field holds yet: rejected", async () => {
    const { recordId } = await restrictedDossier();
    const unsaved = await upload({ entityType: "dossier", fieldName: "scan", entityId: recordId });

    const err = await stack.http.writeErr(
      "field-read:write:dossier:update",
      { id: recordId, version: 1, changes: { cover: unsaved } },
      clerk,
    );

    expect(err.code).toBe("validation_error");
    expect(JSON.stringify(err.details)).toContain("invalid_element");
    expect(await downloadStatus(recordReader, unsaved)).toBe(404);
  });

  // The privileged role still downloads the file, but the move would open it to every record reader.
  test("a privileged writer without the field rule is rejected as well", async () => {
    const dossier = await restrictedDossier();
    expect(await downloadStatus(tenantAdmin, dossier.scan)).toBe(200);

    const err = await stack.http.writeErr(
      "field-read:write:dossier:update",
      { id: dossier.recordId, version: 1, changes: { cover: dossier.scan } },
      tenantAdmin,
    );

    expect(err.code).toBe("validation_error");
    expect(await downloadStatus(recordReader, dossier.scan)).toBe(404);
  });

  test("the same writer keeps saving the open field's own file", async () => {
    const cover = await upload({ entityType: "dossier", fieldName: "cover" });
    const created = await stack.http.writeOk<{ id: string }>(
      "field-read:write:dossier:create",
      { title: "Open", cover },
      uploader,
    );

    await stack.http.writeOk(
      "field-read:write:dossier:update",
      { id: created.id, version: 1, changes: { title: "Open again", cover } },
      clerk,
    );
  });
});

// A sub-field rule that reads its own row decides per row, so all rows share the sub-field but a
// row the writer may not read is a source of its own.
describe("a writer cannot move a file from a list row he may not read into one he may", () => {
  async function inspectionWithForeignPhoto(): Promise<{ recordId: string; photo: string }> {
    const photo = await upload({
      entityType: "inspection",
      fieldName: "checks",
      subField: "photos",
    });
    const created = await stack.http.writeOk<{ id: string }>(
      "field-read:write:inspection:create",
      {
        title: "Rows",
        checks: [
          { inspector: clerk.id, photos: [] },
          { inspector: "someone-else", photos: [photo] },
        ],
      },
      uploader,
    );
    return { recordId: created.id, photo };
  }

  test("copying the photo into the writer's own row is rejected", async () => {
    const { recordId, photo } = await inspectionWithForeignPhoto();
    expect(await downloadStatus(clerk, photo)).toBe(404);

    const err = await stack.http.writeErr(
      "field-read:write:inspection:update",
      {
        id: recordId,
        version: 1,
        changes: {
          checks: [
            { inspector: clerk.id, photos: [photo] },
            { inspector: "someone-else", photos: [photo] },
          ],
        },
      },
      clerk,
    );

    expect(err.code).toBe("validation_error");
    expect(JSON.stringify(err.details)).toContain("invalid_element");
    expect(await downloadStatus(clerk, photo)).toBe(404);
  });

  test("leaving the photo in its row still saves", async () => {
    const { recordId, photo } = await inspectionWithForeignPhoto();

    await stack.http.writeOk(
      "field-read:write:inspection:update",
      {
        id: recordId,
        version: 1,
        changes: {
          checks: [
            { inspector: clerk.id, photos: [] },
            { inspector: "someone-else", photos: [photo] },
          ],
        },
      },
      clerk,
    );
    expect(await downloadStatus(clerk, photo)).toBe(404);
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
