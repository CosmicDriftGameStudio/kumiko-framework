// forget-subject also removes the files bound to the forgotten subject: bytes,
// derivatives and file_refs rows behind its personal file fields. The entity row
// stays (crypto-shredding is not deletion); failures fail closed into cleanupError.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import {
  createEventStoreExecutor,
  createTenantDb,
  executeRawQuery,
  selectMany,
} from "@cosmicdrift/kumiko-framework/db";
import { variantSuffix } from "@cosmicdrift/kumiko-framework/derivatives";
import {
  createEntity,
  createFileField,
  createFilesField,
  createSystemUser,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDetailHandler,
  defineEntityUpdateHandler,
  defineFeature,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  bindPendingFileRef,
  createFilesFeature,
  createInMemoryFileProvider,
  deriveKey,
  type FileStorageProvider,
  fileRefEntity,
  fileRefsTable,
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
import * as z from "zod";
import { SUBJECT_FORGOTTEN_EVENT_NAME } from "../constants.ts";
import { createCryptoShreddingFeature } from "../feature.ts";

const FORGET = "crypto-shredding:write:forget-subject";
const CREATE_DOSSIER = "ff-probe:write:dossier:create";
const UPDATE_DOSSIER = "ff-probe:write:dossier:update";
const DETAIL_DOSSIER = "ff-probe:query:dossier:detail";
const CREATE_OWNED = "ff-probe:write:owned-doc:create";
const INTAKE_FORM = "ff-probe:screen:intake-form";
const KEEP_AS_COVER = "ff-probe:write:keep-as-cover";
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
  r.writeHandler(defineEntityUpdateHandler("dossier", dossierEntity, ROLES));
  r.queryHandler(defineEntityDetailHandler("dossier", dossierEntity, ROLES));
  r.writeHandler(defineEntityCreateHandler("owned-doc", ownedDocEntity, ROLES));
  r.screen({
    id: "intake-form",
    type: "actionForm",
    dormant: true,
    handler: "ff-probe:write:dossier:create",
    fields: { attachments: createFilesField() },
    layout: { sections: [{ fields: ["attachments"] }] },
  });
  // What an actionForm handler does with a kept upload: move it onto the entity's non-personal cover.
  r.writeHandler({
    name: "keep-as-cover",
    schema: z.object({ fileRefId: z.string(), entityId: z.string() }),
    access: { roles: ["Admin", "DataProtectionOfficer"] },
    handler: async (event, ctx) => {
      const outcome = await bindPendingFileRef({
        fileRefId: event.payload.fileRefId,
        entityName: INTAKE_FORM,
        fieldName: "attachments",
        entityId: event.payload.entityId,
        bindTo: { entityName: "dossier", fieldName: "cover" },
        registry: ctx.registry,
        user: event.user,
        db: ctx.db,
      });
      return { isSuccess: true as const, data: { outcome } };
    },
  });
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

const fileRefExecutor = createEventStoreExecutor(fileRefsTable, fileRefEntity, {
  entityName: "fileRef",
});

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
  await resetTestTables(stack.db, [
    eventsTable,
    "read_ff_dossier",
    "read_ff_owned_doc",
    fileRefsTable,
  ]);
  memory.clear();
  failDeletes = false;
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
});

type Uploader = typeof dpo;

async function upload(
  as: Uploader,
  entityType: string | undefined,
  fieldName?: string,
  actionForm?: string,
): Promise<string> {
  const token = await stack.jwt.sign(as);
  const fd = new FormData();
  if (entityType !== undefined) fd.append("entityType", entityType);
  if (actionForm !== undefined) fd.append("actionForm", actionForm);
  if (fieldName !== undefined) fd.append("fieldName", fieldName);
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
  const rows = await selectMany<{ storageKey: string }>(stack.db, fileRefsTable, { id: fileRefId });
  return String(rows[0]?.storageKey);
}

async function fileRefExists(id: string): Promise<boolean> {
  return (await selectMany(stack.db, fileRefsTable, { id })).length > 0;
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

  test("after forget the record still saves, with or without the purged file field sent back", async () => {
    const target = await seedDossier("target");
    const spec = forgetRecord(target.id);
    await stack.http.writeOk(spec.name, spec.payload, spec.as);
    expect(await fileRefExists(target.passportId)).toBe(false);

    const currentVersion = async (): Promise<number> =>
      (await stack.http.queryOk<{ version: number }>(DETAIL_DOSSIER, { id: target.id }, dpo))
        .version;
    await stack.http.writeOk(
      UPDATE_DOSSIER,
      { id: target.id, version: await currentVersion(), changes: { label: "renamed" } },
      dpo,
    );
    await stack.http.writeOk(
      UPDATE_DOSSIER,
      {
        id: target.id,
        version: await currentVersion(),
        changes: { label: "renamed again", passport: target.passportId, scans: [target.scanId] },
      },
      dpo,
    );
    const detail = await stack.http.queryOk<{ label: string }>(
      DETAIL_DOSSIER,
      { id: target.id },
      dpo,
    );
    expect(detail.label).toBe("renamed again");
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

  test("a failing owner lookup of the record row still writes the audit event with a cleanupError", async () => {
    const target = await seedDossier("target");
    // The lookup reads tenant_id; a missing column stands in for any database error there.
    await executeRawQuery(
      stack.db,
      'ALTER TABLE "read_ff_dossier" RENAME COLUMN "tenant_id" TO "tenant_id_moved"',
      [],
    );
    try {
      const spec = forgetRecord(target.id);
      const err = await stack.http.writeErr(spec.name, spec.payload, spec.as);
      expect(err.httpStatus).toBeGreaterThanOrEqual(500);
    } finally {
      await executeRawQuery(
        stack.db,
        'ALTER TABLE "read_ff_dossier" RENAME COLUMN "tenant_id_moved" TO "tenant_id"',
        [],
      );
    }

    const events = await forgottenEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.payload["subjectKey"]).toBe(`record:dossier:${target.id}`);
    expect(events[0]?.payload["cleanupError"]).toBeString();
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

  test("user subject: the user's uploads never bound to a record are removed, bound files and other users' pending uploads stay", async () => {
    const pendingId = await upload(foreignUploader, "owned-doc", "contract");
    const otherPendingId = await upload(dpo, "owned-doc", "contract");
    const boundId = await upload(foreignUploader, "owned-doc", "contract");
    await stack.http.writeOk(
      CREATE_OWNED,
      { ownerId: "dddddddd-dddd-4ddd-8ddd-0000000000ff", contract: boundId },
      foreignUploader,
    );
    const pendingKey = await storageKeyOf(pendingId);
    const otherPendingKey = await storageKeyOf(otherPendingId);
    const boundKey = await storageKeyOf(boundId);

    await stack.http.writeOk(
      FORGET,
      { subject: { kind: "user", userId: foreignUploader.id }, reason: REASON },
      dpo,
    );

    expect(await memory.exists(pendingKey)).toBe(false);
    expect(await fileRefExists(pendingId)).toBe(false);
    expect(await memory.exists(otherPendingKey)).toBe(true);
    expect(await fileRefExists(otherPendingId)).toBe(true);
    expect(await memory.exists(boundKey)).toBe(true);
    expect(await fileRefExists(boundId)).toBe(true);
  });

  test("user subject: an unbound upload without an entity field origin (config logo, server-made file) is not a pending upload and stays", async () => {
    const configOriginId = await upload(foreignUploader, undefined);
    const pendingFieldId = await upload(foreignUploader, "owned-doc", "contract");
    const configOriginKey = await storageKeyOf(configOriginId);
    const pendingFieldKey = await storageKeyOf(pendingFieldId);

    await stack.http.writeOk(
      FORGET,
      { subject: { kind: "user", userId: foreignUploader.id }, reason: REASON },
      dpo,
    );

    expect(await memory.exists(configOriginKey)).toBe(true);
    expect(await fileRefExists(configOriginId)).toBe(true);
    expect(await memory.exists(pendingFieldKey)).toBe(false);
    expect(await fileRefExists(pendingFieldId)).toBe(false);
  });

  test("user subject: an unbound ref that a record's single file column still names is in use and stays", async () => {
    const heldId = await upload(foreignUploader, "owned-doc", "contract");
    await stack.http.writeOk(
      CREATE_OWNED,
      { ownerId: "dddddddd-dddd-4ddd-8ddd-0000000000ff", contract: heldId },
      foreignUploader,
    );
    const [row] = await selectMany<{ version: number }>(stack.db, fileRefsTable, { id: heldId });
    const unbound = await fileRefExecutor.update(
      { id: heldId, version: row?.version, changes: { entityId: null } },
      createSystemUser(TENANT),
      createTenantDb({ db: stack.db, tenantId: TENANT, mode: "system" }),
    );
    expect(unbound.isSuccess).toBe(true);
    const heldKey = await storageKeyOf(heldId);

    await stack.http.writeOk(
      FORGET,
      { subject: { kind: "user", userId: foreignUploader.id }, reason: REASON },
      dpo,
    );

    expect(await memory.exists(heldKey)).toBe(true);
    expect(await fileRefExists(heldId)).toBe(true);
  });

  test("user subject: an unbound actionForm upload of the user is removed, one the handler moved to a non-personal field stays", async () => {
    const pendingId = await upload(foreignUploader, undefined, "attachments", INTAKE_FORM);
    const keptId = await upload(foreignUploader, undefined, "attachments", INTAKE_FORM);
    await stack.http.writeOk(
      KEEP_AS_COVER,
      { fileRefId: keptId, entityId: crypto.randomUUID() },
      foreignUploader,
    );
    const pendingKey = await storageKeyOf(pendingId);
    const keptKey = await storageKeyOf(keptId);

    await stack.http.writeOk(
      FORGET,
      { subject: { kind: "user", userId: foreignUploader.id }, reason: REASON },
      dpo,
    );

    expect(await memory.exists(pendingKey)).toBe(false);
    expect(await fileRefExists(pendingId)).toBe(false);
    expect(await memory.exists(keptKey)).toBe(true);
    expect(await fileRefExists(keptId)).toBe(true);
  });
});
