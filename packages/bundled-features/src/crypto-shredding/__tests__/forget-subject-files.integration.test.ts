// forget-subject also removes the files bound to the forgotten subject: bytes,
// derivatives and file_refs rows behind its personal file fields. The entity row
// stays (crypto-shredding is not deletion); failures fail closed into cleanupError.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import { asRawClient, selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createFileField,
  createFilesField,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDetailHandler,
  defineFeature,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { variantSuffix } from "@cosmicdrift/kumiko-framework/derivatives";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createFilesFeature,
  createInMemoryFileProvider,
  deriveKey,
  type FileStorageProvider,
} from "@cosmicdrift/kumiko-framework/files";
import { testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  buildMultipartBody,
  patchFileInstanceofForBunTest,
  resetPiiSubjectKmsForTests,
  resetTestTables,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { SUBJECT_FORGOTTEN_EVENT_NAME } from "../constants.ts";
import { createCryptoShreddingFeature } from "../feature.ts";

const FORGET = "crypto-shredding:write:forget-subject";
const CREATE_DOSSIER = "ff-probe:write:dossier:create";
const DETAIL_DOSSIER = "ff-probe:query:dossier:detail";
const CREATE_OWNED = "ff-probe:write:owned-doc:create";
const REASON = "authority request (Art. 17 file purge)";
const ROLES = { access: { roles: ["Admin", "DataProtectionOfficer"] } } as const;

// passport/scans hang off the row's own subject (recordOwned); cover is deliberately not personal.
const dossierEntity = createEntity({
  table: "read_ff_dossier",
  fields: {
    label: createTextField({ required: true, personal: false, reason: "test_fixture" }),
    passport: createFileField({ personal: { of: "id" } }),
    scans: createFilesField({ personal: { of: "id" } }),
    cover: createFileField(),
  },
});

// contract belongs to the user named by ownerId (userOwned); files may come from other uploaders.
const ownedDocEntity = createEntity({
  table: "read_ff_owned_doc",
  fields: {
    ownerId: createTextField({ required: true, personal: false, reason: "pseudonymous_fk" }),
    contract: createFileField({ personal: { of: "ownerId" } }),
  },
});

const probeFeature = defineFeature("ff-probe", (r) => {
  r.entity({ name: "dossier", ...dossierEntity });
  r.entity({ name: "owned-doc", ...ownedDocEntity });
  r.writeHandler(defineEntityCreateHandler("dossier", dossierEntity, ROLES));
  r.queryHandler(defineEntityDetailHandler("dossier", dossierEntity, ROLES));
  r.writeHandler(defineEntityCreateHandler("owned-doc", ownedDocEntity, ROLES));
});

const TENANT: TenantId = testTenantId(31);
const dpo = {
  id: "dddddddd-dddd-4ddd-8ddd-000000000001",
  tenantId: TENANT,
  roles: ["Admin", "DataProtectionOfficer"],
};
const foreignUploader = {
  id: "dddddddd-dddd-4ddd-8ddd-000000000002",
  tenantId: TENANT,
  roles: ["Admin"],
};
const ownerUserId = "dddddddd-dddd-4ddd-8ddd-000000000003";

const memory = createInMemoryFileProvider();
let failDeletes = false;
// Wraps the in-memory store so a test can make byte deletion (and derivative listing) fail.
const flakyProvider: FileStorageProvider = {
  ...memory,
  delete: async (key) => {
    if (failDeletes) throw new Error("AccessDenied");
    return memory.delete(key);
  },
};

let stack: TestStack;

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  stack = await setupTestStack({
    features: [createCryptoShreddingFeature(), createFilesFeature(), probeFeature],
    files: { storageProvider: flakyProvider },
  });
  await unsafeCreateEntityTable(stack.db, dossierEntity, "dossier");
  await unsafeCreateEntityTable(stack.db, ownedDocEntity, "owned-doc");
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [eventsTable]);
  await asRawClient(stack.db).unsafe(
    "TRUNCATE read_ff_dossier, read_ff_owned_doc, file_refs RESTART IDENTITY CASCADE",
  );
  memory.clear();
  failDeletes = false;
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
});

type Uploader = typeof dpo;

async function upload(as: Uploader, entityType: string, fieldName: string): Promise<string> {
  const token = await stack.jwt.sign(as);
  const fd = new FormData();
  fd.append("entityType", entityType);
  fd.append("fieldName", fieldName);
  fd.append(
    "file",
    new File([Buffer.from("%PDF-1.4 minimal")], "doc.pdf", { type: "application/pdf" }),
  );
  const { body, contentType } = await buildMultipartBody(fd);
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function storageKeyOf(fileRefId: string): Promise<string> {
  const rows = await asRawClient(stack.db).unsafe(
    "SELECT storage_key FROM file_refs WHERE id = $1",
    [fileRefId],
  );
  return String((rows as { storage_key: string }[])[0]?.storage_key);
}

async function fileRefExists(id: string): Promise<boolean> {
  const rows = await asRawClient(stack.db).unsafe("SELECT id FROM file_refs WHERE id = $1", [id]);
  return (rows as unknown[]).length > 0;
}

type SeededDossier = {
  readonly id: string;
  readonly passportId: string;
  readonly scanId: string;
  readonly coverId: string;
  readonly passportKey: string;
  readonly scanKey: string;
  readonly coverKey: string;
  readonly thumbKey: string;
};

async function seedDossier(label: string): Promise<SeededDossier> {
  const passportId = await upload(dpo, "dossier", "passport");
  const scanId = await upload(dpo, "dossier", "scans");
  const coverId = await upload(dpo, "dossier", "cover");
  const created = await stack.http.writeOk<{ id: string }>(
    CREATE_DOSSIER,
    { label, passport: passportId, scans: [scanId], cover: coverId },
    dpo,
  );
  const passportKey = await storageKeyOf(passportId);
  const thumbKey = deriveKey(passportKey, variantSuffix("thumb", { maxEdge: 256 }));
  await memory.write(thumbKey, new Uint8Array([9]), "image/jpeg");
  return {
    id: created.id,
    passportId,
    scanId,
    coverId,
    passportKey,
    scanKey: await storageKeyOf(scanId),
    coverKey: await storageKeyOf(coverId),
    thumbKey,
  };
}

function forgetRecord(id: string, as: Uploader = dpo) {
  return {
    name: FORGET,
    payload: { subject: { kind: "record", entity: "dossier", id }, reason: REASON },
    as,
  };
}

async function forgottenEvents(): Promise<Array<{ payload: Record<string, unknown> }>> {
  return (await selectMany(stack.db, eventsTable, {
    type: SUBJECT_FORGOTTEN_EVENT_NAME,
  })) as Array<{ payload: Record<string, unknown> }>;
}

describe("crypto-shredding :: forget-subject removes the subject's files", () => {
  test("record subject: personal single + multi field files, derivative and file_refs rows are gone; non-personal field and other records stay", async () => {
    const target = await seedDossier("target");
    const other = await seedDossier("other");

    const spec = forgetRecord(target.id);
    await stack.http.writeOk(spec.name, spec.payload, spec.as);

    expect(await memory.exists(target.passportKey)).toBe(false);
    expect(await memory.exists(target.thumbKey)).toBe(false);
    expect(await memory.exists(target.scanKey)).toBe(false);
    expect(await fileRefExists(target.passportId)).toBe(false);
    expect(await fileRefExists(target.scanId)).toBe(false);

    // Same row, field not tied to the subject: the files belong to the record, not its person.
    expect(await memory.exists(target.coverKey)).toBe(true);
    expect(await fileRefExists(target.coverId)).toBe(true);

    for (const key of [other.passportKey, other.thumbKey, other.scanKey, other.coverKey]) {
      expect(await memory.exists(key)).toBe(true);
    }
    expect(await fileRefExists(other.passportId)).toBe(true);
    expect(await fileRefExists(other.scanId)).toBe(true);

    const events = await forgottenEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.payload["subjectKey"]).toBe(`record:dossier:${target.id}`);
    expect(events[0]?.payload["cleanupError"]).toBeUndefined();

    // The entity row stays: record what the single-file column and a detail read give afterwards.
    const detail = await stack.http.queryOk<{ id: string; passport: unknown }>(
      DETAIL_DOSSIER,
      { id: target.id },
      dpo,
    );
    expect(detail.id).toBe(target.id);
  });

  test("a storage error fails closed (fileRef and entity row stay, cleanupError in the audit event, handler errors); a retry with working storage finishes the purge", async () => {
    const target = await seedDossier("target");
    failDeletes = true;

    const spec = forgetRecord(target.id);
    const err = await stack.http.writeErr(spec.name, spec.payload, spec.as);
    expect(err.httpStatus).toBeGreaterThanOrEqual(500);

    expect(await fileRefExists(target.passportId)).toBe(true);
    expect(await fileRefExists(target.scanId)).toBe(true);
    expect(await memory.exists(target.passportKey)).toBe(true);

    const events = await forgottenEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.payload["cleanupError"]).toBe("file_delete_failed");

    failDeletes = false;
    await stack.http.writeOk(spec.name, spec.payload, spec.as);

    expect(await memory.exists(target.passportKey)).toBe(false);
    expect(await memory.exists(target.thumbKey)).toBe(false);
    expect(await memory.exists(target.scanKey)).toBe(false);
    expect(await fileRefExists(target.passportId)).toBe(false);
    expect(await fileRefExists(target.scanId)).toBe(false);
    expect(await memory.exists(target.coverKey)).toBe(true);
  });

  test("user subject: a userOwned file uploaded by someone else is removed with the owner's forget; other users' files stay", async () => {
    const contractId = await upload(foreignUploader, "owned-doc", "contract");
    const otherContractId = await upload(foreignUploader, "owned-doc", "contract");
    await stack.http.writeOk(
      CREATE_OWNED,
      { ownerId: ownerUserId, contract: contractId },
      foreignUploader,
    );
    await stack.http.writeOk(
      CREATE_OWNED,
      { ownerId: "dddddddd-dddd-4ddd-8ddd-0000000000ff", contract: otherContractId },
      foreignUploader,
    );
    const contractKey = await storageKeyOf(contractId);
    const otherKey = await storageKeyOf(otherContractId);

    await stack.http.writeOk(
      FORGET,
      { subject: { kind: "user", userId: ownerUserId }, reason: REASON },
      dpo,
    );

    expect(await memory.exists(contractKey)).toBe(false);
    expect(await fileRefExists(contractId)).toBe(false);
    expect(await memory.exists(otherKey)).toBe(true);
    expect(await fileRefExists(otherContractId)).toBe(true);
  });
});
