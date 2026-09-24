// kumiko-framework#3089 — hardDelete deletes a row's file/image/files/images
// bytes (+ derivatives) and fileRef rows, not just the row itself.
//
// Verifies the negative cases where a data-loss/leak bug hides:
//   - fresh rows + other rows' files are NEVER touched
//   - a fileRef SHARED with another row of the same entity survives (bytes +
//     row) even though the row that's being purged references it too
//   - a storage-delete failure fails the row closed (row + fileRef survive,
//     skipped "file_delete_failed") and converges on the next run
//   - no file storage wired at all → row stays, skipped "missing_file_storage"
//   - softDelete/anonymize entities with file fields never touch bytes
//   - the registered cron handler forwards ctx.files, not just direct calls

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventStoreExecutor, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createFilesField,
  createImageField,
  createSystemUser,
  createTextField,
  defineFeature,
  type JobContext,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createFileContext,
  createInMemoryFileProvider,
  deriveKey,
  type FileStorageProvider,
  fileRefEntity,
  fileRefsTable,
} from "@cosmicdrift/kumiko-framework/files";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { bridgeStub } from "@cosmicdrift/kumiko-framework/testing";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { createDataRetentionFeature } from "../feature";
import { runRetentionCleanup } from "../run-retention-cleanup";

// hardDelete entity with BOTH a single (image) and a plural (files) field —
// covers the column-value path AND the file_refs-lookup path in one entity.
const docEntity = createEntity({
  table: "read_c8_doc",
  fields: {
    label: createTextField({ required: true, personal: false, reason: "test_fixture" }),
    cover: createImageField(),
    attachments: createFilesField(),
  },
  retention: { keepFor: "30d", strategy: "hardDelete" },
});

// softDelete entity with a file field — the strategy's own path (mark
// is_deleted) must never touch bytes; only hardDelete does.
const softDocEntity = createEntity({
  table: "read_c8_soft_doc",
  softDelete: true,
  fields: {
    label: createTextField({ required: true, personal: false, reason: "test_fixture" }),
    cover: createImageField(),
  },
  retention: { keepFor: "30d", strategy: "softDelete" },
});

// anonymize entity with a file field — same guarantee for the anonymize path.
const anonDocEntity = createEntity({
  table: "read_c8_anon_doc",
  fields: {
    label: {
      ...createTextField({ required: true, personal: false, reason: "test_fixture" }),
      anonymize: () => "[ANONYMIZED]",
    },
    cover: createImageField(),
  },
  retention: { keepFor: "30d", strategy: "anonymize" },
});

const c8Feature = defineFeature("c8-retention-file-fixtures", (r) => {
  r.entity("c8-doc", docEntity);
  r.entity("c8-soft-doc", softDocEntity);
  r.entity("c8-anon-doc", anonDocEntity);
});

const noopLogger: JobContext["log"] = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  child() {
    return noopLogger;
  },
};

const T1 = "33333333-3333-3333-3333-333333333333";
const T2 = "44444444-4444-4444-4444-444444444444";

let stack: TestStack;
let provider: ReturnType<typeof createInMemoryFileProvider>;
let now: ReturnType<ReturnType<typeof getTemporal>["Now"]["instant"]>;
let pastIso: string;
let withinIso: string;
let fileRefCrud: ReturnType<typeof createEventStoreExecutor>;

beforeAll(async () => {
  provider = createInMemoryFileProvider();
  stack = await setupTestStack({
    features: [createDataRetentionFeature(), c8Feature],
    files: { storageProvider: provider },
  });
  for (const e of [docEntity, softDocEntity, anonDocEntity]) {
    await unsafeCreateEntityTable(stack.db, e);
  }
  fileRefCrud = createEventStoreExecutor(fileRefsTable, fileRefEntity, { entityName: "fileRef" });
  now = getTemporal().Now.instant();
  pastIso = now.subtract({ hours: 60 * 24 }).toString();
  withinIso = now.subtract({ hours: 10 * 24 }).toString();
});

afterAll(async () => {
  await stack.cleanup();
});

function filesCtx(p: FileStorageProvider = provider) {
  return createFileContext(() => Promise.resolve(p));
}

async function seedDoc(
  table: string,
  tenantId: string,
  label: string,
  insertedAtIso: string,
): Promise<string> {
  const rows = (await asRawClient(stack.db).unsafe(
    `INSERT INTO ${table} (tenant_id, label, inserted_at) VALUES ($1, $2, $3::timestamptz) RETURNING id`,
    [tenantId, label, insertedAtIso],
  )) as { id: string | number }[];
  return String(rows[0]?.id);
}

async function setCover(table: string, rowId: string, fileRefId: string | null): Promise<void> {
  await asRawClient(stack.db).unsafe(`UPDATE ${table} SET cover = $1 WHERE id = $2`, [
    fileRefId,
    rowId,
  ]);
}

async function seedFileRef(args: {
  readonly tenantId: string;
  readonly entityName: string | null;
  readonly entityId: string | null;
  readonly fieldName: string | null;
  readonly key: string;
}): Promise<string> {
  await provider.write(args.key, new Uint8Array([1, 2, 3]), "application/octet-stream");
  const tdb = createTenantDb(stack.db, args.tenantId, "system");
  const systemUser = createSystemUser(args.tenantId);
  const id = crypto.randomUUID();
  const res = await fileRefCrud.create(
    {
      id,
      storageKey: args.key,
      fileName: "f.bin",
      mimeType: "application/octet-stream",
      size: 3,
      entityType: args.entityName,
      entityId: args.entityId,
      fieldName: args.fieldName,
    },
    systemUser,
    tdb,
  );
  expect(res.isSuccess).toBe(true);
  return id;
}

async function fileRefExists(id: string): Promise<boolean> {
  const rows = await asRawClient(stack.db).unsafe(`SELECT id FROM file_refs WHERE id = $1`, [id]);
  return (rows as unknown[]).length > 0;
}

async function labels(table: string, tenantId: string): Promise<string[]> {
  const rows = (await asRawClient(stack.db).unsafe(
    `SELECT label FROM ${table} WHERE tenant_id = $1 ORDER BY label`,
    [tenantId],
  )) as { label: string }[];
  return rows.map((r) => r.label);
}

beforeEach(async () => {
  for (const t of ["read_c8_doc", "read_c8_soft_doc", "read_c8_anon_doc"]) {
    await asRawClient(stack.db).unsafe(`DELETE FROM ${t}`);
  }
  await asRawClient(stack.db).unsafe(`DELETE FROM file_refs`);
  provider.clear();
});

describe("runRetentionCleanup :: hardDelete purges file bytes + derivatives + fileRefs", () => {
  test("expired row: bytes + derivatives + fileRefs (single + plural field) gone; fresh + other-tenant untouched", async () => {
    const expiredId = await seedDoc("read_c8_doc", T1, "expired", pastIso);
    const coverKey = "t1/expired/cover/orig.jpg";
    const coverId = await seedFileRef({
      tenantId: T1,
      entityName: "c8-doc",
      entityId: expiredId,
      fieldName: "cover",
      key: coverKey,
    });
    await setCover("read_c8_doc", expiredId, coverId);
    // Derivative-suffix grammar is "<name>-<16 hex chars>" (variantSuffix),
    // not a bare variant name — see isDerivativeKeyOf/DERIVATIVE_SUFFIX_PATTERN.
    const thumbKey = deriveKey(coverKey, "thumb-0123456789abcdef");
    await provider.write(thumbKey, new Uint8Array([9]), "image/jpeg");

    const attKey = "t1/expired/attachments/a.pdf";
    const attId = await seedFileRef({
      tenantId: T1,
      entityName: "c8-doc",
      entityId: expiredId,
      fieldName: "attachments",
      key: attKey,
    });

    const freshId = await seedDoc("read_c8_doc", T1, "fresh", withinIso);
    const freshCoverKey = "t1/fresh/cover/orig.jpg";
    const freshCoverId = await seedFileRef({
      tenantId: T1,
      entityName: "c8-doc",
      entityId: freshId,
      fieldName: "cover",
      key: freshCoverKey,
    });
    await setCover("read_c8_doc", freshId, freshCoverId);

    const otherTenantId = await seedDoc("read_c8_doc", T2, "expired-t2", pastIso);
    const otherTenantKey = "t2/expired/cover/orig.jpg";
    const otherTenantCoverId = await seedFileRef({
      tenantId: T2,
      entityName: "c8-doc",
      entityId: otherTenantId,
      fieldName: "cover",
      key: otherTenantKey,
    });
    await setCover("read_c8_doc", otherTenantId, otherTenantCoverId);

    const result = await runRetentionCleanup({
      db: stack.db,
      registry: stack.registry,
      tenantId: T1,
      tenantPreset: null,
      now,
      files: filesCtx(),
    });

    expect(result.hardDeleted).toBe(1);
    expect(await labels("read_c8_doc", T1)).toEqual(["fresh"]);

    expect(await provider.exists(coverKey)).toBe(false);
    expect(await provider.exists(thumbKey)).toBe(false);
    expect(await provider.exists(attKey)).toBe(false);
    expect(await fileRefExists(coverId)).toBe(false);
    expect(await fileRefExists(attId)).toBe(false);

    expect(await provider.exists(freshCoverKey)).toBe(true);
    expect(await fileRefExists(freshCoverId)).toBe(true);

    expect(await provider.exists(otherTenantKey)).toBe(true);
    expect(await fileRefExists(otherTenantCoverId)).toBe(true);
    expect(await labels("read_c8_doc", T2)).toEqual(["expired-t2"]);
  });

  test("shared fileRef (same entity, second row) survives even though its owning row is purged", async () => {
    const rowA = await seedDoc("read_c8_doc", T1, "expired-shared", pastIso);
    const rowB = await seedDoc("read_c8_doc", T1, "fresh-shared", withinIso);
    const sharedKey = "t1/shared/cover/orig.jpg";
    const sharedId = await seedFileRef({
      tenantId: T1,
      entityName: "c8-doc",
      entityId: rowA,
      fieldName: "cover",
      key: sharedKey,
    });
    await setCover("read_c8_doc", rowA, sharedId);
    await setCover("read_c8_doc", rowB, sharedId);

    const result = await runRetentionCleanup({
      db: stack.db,
      registry: stack.registry,
      tenantId: T1,
      tenantPreset: null,
      now,
      files: filesCtx(),
    });

    expect(result.hardDeleted).toBe(1);
    expect(await labels("read_c8_doc", T1)).toEqual(["fresh-shared"]);
    expect(await provider.exists(sharedKey)).toBe(true);
    expect(await fileRefExists(sharedId)).toBe(true);
  });

  test("storage-delete failure fails the row closed; skipped + convergence on retry", async () => {
    const rowId = await seedDoc("read_c8_doc", T1, "expired-fails", pastIso);
    const key = "t1/fails/cover/orig.jpg";
    const fileRefId = await seedFileRef({
      tenantId: T1,
      entityName: "c8-doc",
      entityId: rowId,
      fieldName: "cover",
      key,
    });
    await setCover("read_c8_doc", rowId, fileRefId);

    const failingProvider: FileStorageProvider = {
      ...provider,
      delete: async (k: string) => {
        if (k === key) throw new Error("boom");
        return provider.delete(k);
      },
    };

    const failed = await runRetentionCleanup({
      db: stack.db,
      registry: stack.registry,
      tenantId: T1,
      tenantPreset: null,
      now,
      files: filesCtx(failingProvider),
    });

    expect(failed.hardDeleted).toBe(0);
    expect(failed.skipped).toContainEqual({ entityName: "c8-doc", reason: "file_delete_failed" });
    expect(await labels("read_c8_doc", T1)).toEqual(["expired-fails"]);
    expect(await fileRefExists(fileRefId)).toBe(true);
    expect(await provider.exists(key)).toBe(true);

    const retried = await runRetentionCleanup({
      db: stack.db,
      registry: stack.registry,
      tenantId: T1,
      tenantPreset: null,
      now,
      files: filesCtx(),
    });
    expect(retried.hardDeleted).toBe(1);
    expect(await labels("read_c8_doc", T1)).toEqual([]);
    expect(await fileRefExists(fileRefId)).toBe(false);
    expect(await provider.exists(key)).toBe(false);
  });

  test("no file storage wired → row stays, skipped missing_file_storage", async () => {
    const rowId = await seedDoc("read_c8_doc", T1, "expired-no-storage", pastIso);
    const key = "t1/no-storage/cover/orig.jpg";
    const fileRefId = await seedFileRef({
      tenantId: T1,
      entityName: "c8-doc",
      entityId: rowId,
      fieldName: "cover",
      key,
    });
    await setCover("read_c8_doc", rowId, fileRefId);

    const result = await runRetentionCleanup({
      db: stack.db,
      registry: stack.registry,
      tenantId: T1,
      tenantPreset: null,
      now,
    });

    expect(result.hardDeleted).toBe(0);
    expect(result.skipped).toContainEqual({
      entityName: "c8-doc",
      reason: "missing_file_storage",
    });
    expect(await labels("read_c8_doc", T1)).toEqual(["expired-no-storage"]);
    expect(await fileRefExists(fileRefId)).toBe(true);
  });

  test("softDelete and anonymize entities with a file field never touch bytes", async () => {
    const softRowId = await seedDoc("read_c8_soft_doc", T1, "soft-expired", pastIso);
    const softKey = "t1/soft/cover/orig.jpg";
    const softFileRefId = await seedFileRef({
      tenantId: T1,
      entityName: "c8-soft-doc",
      entityId: softRowId,
      fieldName: "cover",
      key: softKey,
    });
    await setCover("read_c8_soft_doc", softRowId, softFileRefId);

    const anonRowId = await seedDoc("read_c8_anon_doc", T1, "anon-expired", pastIso);
    const anonKey = "t1/anon/cover/orig.jpg";
    const anonFileRefId = await seedFileRef({
      tenantId: T1,
      entityName: "c8-anon-doc",
      entityId: anonRowId,
      fieldName: "cover",
      key: anonKey,
    });
    await setCover("read_c8_anon_doc", anonRowId, anonFileRefId);

    const result = await runRetentionCleanup({
      db: stack.db,
      registry: stack.registry,
      tenantId: T1,
      tenantPreset: null,
      now,
      files: filesCtx(),
    });

    expect(result.softDeleted).toBe(1);
    expect(result.anonymized).toBe(1);
    expect(await provider.exists(softKey)).toBe(true);
    expect(await fileRefExists(softFileRefId)).toBe(true);
    expect(await provider.exists(anonKey)).toBe(true);
    expect(await fileRefExists(anonFileRefId)).toBe(true);
  });

  test("the registered job handler forwards ctx.files — bytes gone after the cron runs", async () => {
    const rowId = await seedDoc("read_c8_doc", T1, "expired-via-job", pastIso);
    const key = "t1/via-job/cover/orig.jpg";
    const fileRefId = await seedFileRef({
      tenantId: T1,
      entityName: "c8-doc",
      entityId: rowId,
      fieldName: "cover",
      key,
    });
    await setCover("read_c8_doc", rowId, fileRefId);

    const job = stack.registry.getJob("data-retention:job:retention-cleanup");
    expect(job).toBeDefined();
    if (!job) return;

    const ctx: JobContext = {
      db: createTenantDb(stack.db, T1, "tenant", undefined, undefined, undefined, {
        unsafeRaw: { reason: "per-tenant fan-out cleanup using raw helpers" },
      }),
      registry: stack.registry,
      systemUser: { id: "system", tenantId: T1, roles: ["all"] },
      log: noopLogger,
      triggeredBy: null,
      files: filesCtx(),
      ...bridgeStub(),
    };
    await job.handler({}, ctx);

    expect(await labels("read_c8_doc", T1)).toEqual([]);
    expect(await fileRefExists(fileRefId)).toBe(false);
    expect(await provider.exists(key)).toBe(false);
  });
});
