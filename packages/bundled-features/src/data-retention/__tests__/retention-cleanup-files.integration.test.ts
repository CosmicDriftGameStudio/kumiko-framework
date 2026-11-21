// hardDelete deletes a row's file/image/files/images
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
//   - the registered cron handler forwards ctx.services.files, not just direct calls

import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";

import {
  asRawClient,
  buildEntityTable,
  createEventStoreExecutor,
  selectMany,
} from "@cosmicdrift/kumiko-framework/db";
import {
  bridgeStub,
  createEntity,
  createFilesField,
  createImageField,
  createSystemUser,
  createTextField,
  defineFeature,
  type JobContext,
} from "@cosmicdrift/kumiko-framework/engine";
import { runSeedWritesAt, SEED_MODE_ENV } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createFileContext,
  createInMemoryFileProvider,
  deriveKey,
  type FileStorageProvider,
  fileRefEntity,
  fileRefsTable,
} from "@cosmicdrift/kumiko-framework/files";
import { createTenantDb } from "@cosmicdrift/kumiko-framework/internal/row-level-security";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import {
  deleteRowViaEventStore,
  seedRowViaEventStore,
  updateRowViaEventStore,
  withEnv,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  resetEventStore,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { createDataRetentionFeature } from "../feature.ts";
import { runRetentionCleanup } from "../run-retention-cleanup.ts";

// hardDelete entity with BOTH a single (image) and a plural (files) field —
// covers the column-value path AND the file_refs-lookup path in one entity.
const docEntity = createEntity({
  name: "c8-doc",
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
  name: "c8-soft-doc",
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
  name: "c8-anon-doc",
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

// No retention policy: only holds an image field, so a fileRef can be shared
// across entity types.
const otherDocEntity = createEntity({
  name: "c8-other-doc",
  table: "read_c8_other_doc",
  fields: {
    label: createTextField({ required: true, personal: false, reason: "test_fixture" }),
    cover: createImageField(),
  },
});

// Live holder whose field rejects the test file (.jpg key), so rebinding onto it throws.
const strictDocEntity = createEntity({
  name: "c8-strict-doc",
  table: "read_c8_strict_doc",
  fields: {
    label: createTextField({ required: true, personal: false, reason: "test_fixture" }),
    cover: createImageField({ accept: ["png"] }),
  },
});

const c8Feature = defineFeature("c8-retention-file-fixtures", (r) => {
  r.entity(otherDocEntity);
  r.entity(strictDocEntity);
  r.entity(docEntity);
  r.entity(softDocEntity);
  r.entity(anonDocEntity);
});

const noopLogger: JobContext["obs"]["log"] = {
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
  for (const e of [docEntity, softDocEntity, anonDocEntity, otherDocEntity, strictDocEntity]) {
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

type DocEntity = Parameters<typeof buildEntityTable>[0];

// Back-dated create events give the row its inserted_at, the column the retention policy reads.
async function seedDoc(
  entity: DocEntity,
  tenantId: string,
  label: string,
  insertedAtIso: string,
): Promise<string> {
  const id = crypto.randomUUID();
  await withEnv({ [SEED_MODE_ENV]: "1" }, () =>
    runSeedWritesAt(getTemporal().Instant.from(insertedAtIso), () =>
      seedRowViaEventStore(stack.db, buildEntityTable(entity), { id, tenantId, label }),
    ),
  );
  return id;
}

async function setCover(
  entity: DocEntity,
  rowId: string,
  fileRefId: string,
  tenantId: string = T1,
): Promise<void> {
  await updateRowViaEventStore(
    stack.db,
    { table: buildEntityTable(entity), entity, entityName: entity.name },
    { id: rowId },
    { cover: fileRefId },
    { tenantId },
  );
}

async function seedFileRef(args: {
  readonly tenantId: string;
  readonly entityName: string | null;
  readonly entityId: string | null;
  readonly fieldName: string | null;
  readonly key: string;
}): Promise<string> {
  await provider.write(args.key, new Uint8Array([1, 2, 3]), "application/octet-stream");
  const tdb = createTenantDb({
    db: stack.db,
    tenantId: args.tenantId,
    mode: "system",
    reason: "test inspects file rows across tenants after the retention sweep",
  });
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
  await resetEventStore(stack, [
    "read_c8_doc",
    "read_c8_soft_doc",
    "read_c8_anon_doc",
    "read_c8_other_doc",
    "read_c8_strict_doc",
    fileRefsTable,
  ]);
  provider.clear();
});

describe("runRetentionCleanup :: hardDelete purges file bytes + derivatives + fileRefs", () => {
  test("expired row: bytes + derivatives + fileRefs (single + plural field) gone; fresh + other-tenant untouched", async () => {
    const expiredId = await seedDoc(docEntity, T1, "expired", pastIso);
    const coverKey = "t1/expired/cover/orig.jpg";
    const coverId = await seedFileRef({
      tenantId: T1,
      entityName: "c8-doc",
      entityId: expiredId,
      fieldName: "cover",
      key: coverKey,
    });
    await setCover(docEntity, expiredId, coverId);
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

    const freshId = await seedDoc(docEntity, T1, "fresh", withinIso);
    const freshCoverKey = "t1/fresh/cover/orig.jpg";
    const freshCoverId = await seedFileRef({
      tenantId: T1,
      entityName: "c8-doc",
      entityId: freshId,
      fieldName: "cover",
      key: freshCoverKey,
    });
    await setCover(docEntity, freshId, freshCoverId);

    const otherTenantId = await seedDoc(docEntity, T2, "expired-t2", pastIso);
    const otherTenantKey = "t2/expired/cover/orig.jpg";
    const otherTenantCoverId = await seedFileRef({
      tenantId: T2,
      entityName: "c8-doc",
      entityId: otherTenantId,
      fieldName: "cover",
      key: otherTenantKey,
    });
    await setCover(docEntity, otherTenantId, otherTenantCoverId, T2);

    const result = await runRetentionCleanup({
      db: stack.db,
      registry: stack.registry,
      tenantId: T1,
      preloadedTenantPreset: null,
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
    const rowA = await seedDoc(docEntity, T1, "expired-shared", pastIso);
    const rowB = await seedDoc(docEntity, T1, "fresh-shared", withinIso);
    const sharedKey = "t1/shared/cover/orig.jpg";
    const sharedId = await seedFileRef({
      tenantId: T1,
      entityName: "c8-doc",
      entityId: rowA,
      fieldName: "cover",
      key: sharedKey,
    });
    await setCover(docEntity, rowA, sharedId);
    await setCover(docEntity, rowB, sharedId);

    const result = await runRetentionCleanup({
      db: stack.db,
      registry: stack.registry,
      tenantId: T1,
      preloadedTenantPreset: null,
      now,
      files: filesCtx(),
    });

    expect(result.hardDeleted).toBe(1);
    expect(await labels("read_c8_doc", T1)).toEqual(["fresh-shared"]);
    expect(await provider.exists(sharedKey)).toBe(true);
    expect(await fileRefExists(sharedId)).toBe(true);
  });

  test("a fileRef bound to the purged row but held by another entity's live row is rebound to that holder", async () => {
    const rowA = await seedDoc(docEntity, T1, "expired-owner", pastIso);
    const rowB = await seedDoc(otherDocEntity, T1, "live-holder", withinIso);
    const sharedId = await seedFileRef({
      tenantId: T1,
      entityName: "c8-doc",
      entityId: rowA,
      fieldName: "cover",
      key: "t1/rebind/cover/orig.jpg",
    });
    await setCover(docEntity, rowA, sharedId);
    await setCover(otherDocEntity, rowB, sharedId);

    await runRetentionCleanup({
      db: stack.db,
      registry: stack.registry,
      tenantId: T1,
      preloadedTenantPreset: null,
      now,
      files: filesCtx(),
    });

    expect(await labels("read_c8_doc", T1)).toEqual([]);
    expect(await provider.exists("t1/rebind/cover/orig.jpg")).toBe(true);
    const [ref] = await selectMany<Record<string, unknown>>(stack.db, fileRefsTable, {
      id: sharedId,
    });
    expect(ref).toMatchObject({
      entityType: "c8-other-doc",
      entityId: rowB,
      fieldName: "cover",
    });
  });

  test("unbound fileRef shared with another entity type's live row survives", async () => {
    const rowA = await seedDoc(docEntity, T1, "expired-xshared", pastIso);
    const rowB = await seedDoc(otherDocEntity, T1, "live-other", withinIso);
    const key = "t1/xshared/cover/orig.jpg";
    const sharedId = await seedFileRef({
      tenantId: T1,
      entityName: null,
      entityId: null,
      fieldName: null,
      key,
    });
    await setCover(docEntity, rowA, sharedId);
    await setCover(otherDocEntity, rowB, sharedId);

    const result = await runRetentionCleanup({
      db: stack.db,
      registry: stack.registry,
      tenantId: T1,
      preloadedTenantPreset: null,
      now,
      files: filesCtx(),
    });

    expect(result.hardDeleted).toBe(1);
    expect(await labels("read_c8_doc", T1)).toEqual([]);
    expect(await labels("read_c8_other_doc", T1)).toEqual(["live-other"]);
    expect(await provider.exists(key)).toBe(true);
    expect(await fileRefExists(sharedId)).toBe(true);
  });

  test("a soft-deleted holder does not count: the file is purged with the expired row", async () => {
    const rowA = await seedDoc(docEntity, T1, "expired-owner-softheld", pastIso);
    const rowB = await seedDoc(softDocEntity, T1, "soft-deleted-holder", withinIso);
    const key = "t1/soft-holder/cover/orig.jpg";
    const sharedId = await seedFileRef({
      tenantId: T1,
      entityName: "c8-doc",
      entityId: rowA,
      fieldName: "cover",
      key,
    });
    await setCover(docEntity, rowA, sharedId);
    await setCover(softDocEntity, rowB, sharedId);
    await deleteRowViaEventStore(
      stack.db,
      {
        table: buildEntityTable(softDocEntity),
        entity: softDocEntity,
        entityName: softDocEntity.name,
      },
      { id: rowB },
      { tenantId: T1 },
    );

    const result = await runRetentionCleanup({
      db: stack.db,
      registry: stack.registry,
      tenantId: T1,
      preloadedTenantPreset: null,
      now,
      files: filesCtx(),
    });

    expect(result.hardDeleted).toBe(1);
    expect(await labels("read_c8_doc", T1)).toEqual([]);
    expect(await provider.exists(key)).toBe(false);
    expect(await fileRefExists(sharedId)).toBe(false);
  });

  test("a throwing rebind skips the row (file_delete_failed) without aborting the tenant run", async () => {
    const failingRow = await seedDoc(docEntity, T1, "expired-rebind-throws", pastIso);
    const holderRow = await seedDoc(strictDocEntity, T1, "live-strict-holder", withinIso);
    const key = "t1/rebind-throws/cover/orig.jpg";
    const sharedId = await seedFileRef({
      tenantId: T1,
      entityName: "c8-doc",
      entityId: failingRow,
      fieldName: "cover",
      key,
    });
    await setCover(docEntity, failingRow, sharedId);
    await setCover(strictDocEntity, holderRow, sharedId);
    await seedDoc(docEntity, T1, "expired-plain", pastIso);

    const result = await runRetentionCleanup({
      db: stack.db,
      registry: stack.registry,
      tenantId: T1,
      preloadedTenantPreset: null,
      now,
      files: filesCtx(),
    });

    expect(result.skipped).toContainEqual({ entityName: "c8-doc", reason: "file_delete_failed" });
    expect(await labels("read_c8_doc", T1)).toEqual(["expired-rebind-throws"]);
    expect(await fileRefExists(sharedId)).toBe(true);
    expect(await provider.exists(key)).toBe(true);
  });

  test("a storage failure logs the error class and a count, never the storage key or the adapter text", async () => {
    const failingRow = await seedDoc(docEntity, T1, "expired-pii-key", pastIso);
    const key = "t1/Max-Mustermann/cover/orig.jpg";
    const fileRefId = await seedFileRef({
      tenantId: T1,
      entityName: "c8-doc",
      entityId: failingRow,
      fieldName: "cover",
      key,
    });
    await setCover(docEntity, failingRow, fileRefId);
    const piiProvider: FileStorageProvider = {
      ...provider,
      list: async () => {
        throw new Error("Max Mustermann +49 170 1234567");
      },
    };
    const warnings: string[] = [];
    const warn = spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    });

    try {
      await runRetentionCleanup({
        db: stack.db,
        registry: stack.registry,
        tenantId: T1,
        preloadedTenantPreset: null,
        now,
        files: filesCtx(piiProvider),
      });
    } finally {
      warn.mockRestore();
    }

    const logged = warnings.join("\n");
    expect(logged).toContain("storage cleanup threw: Error");
    expect(logged).toContain("storage delete failed for 1 file(s)");
    expect(logged).not.toContain("Mustermann");
    expect(logged).not.toContain("1234567");
  });

  test("a throwing storage list() skips the row (file_delete_failed) without aborting the tenant run", async () => {
    const failingRow = await seedDoc(docEntity, T1, "expired-list-throws", pastIso);
    const key = "t1/list-throws/cover/orig.jpg";
    const fileRefId = await seedFileRef({
      tenantId: T1,
      entityName: "c8-doc",
      entityId: failingRow,
      fieldName: "cover",
      key,
    });
    await setCover(docEntity, failingRow, fileRefId);
    await seedDoc(docEntity, T1, "expired-plain", pastIso);

    const noListProvider: FileStorageProvider = {
      ...provider,
      list: async () => {
        throw new Error("AccessDenied");
      },
    };

    const result = await runRetentionCleanup({
      db: stack.db,
      registry: stack.registry,
      tenantId: T1,
      preloadedTenantPreset: null,
      now,
      files: filesCtx(noListProvider),
    });

    expect(result.skipped).toContainEqual({ entityName: "c8-doc", reason: "file_delete_failed" });
    expect(await labels("read_c8_doc", T1)).toEqual(["expired-list-throws"]);
    expect(await fileRefExists(fileRefId)).toBe(true);
    expect(await provider.exists(key)).toBe(true);
  });

  test("storage-delete failure fails the row closed; skipped + convergence on retry", async () => {
    const rowId = await seedDoc(docEntity, T1, "expired-fails", pastIso);
    const key = "t1/fails/cover/orig.jpg";
    const fileRefId = await seedFileRef({
      tenantId: T1,
      entityName: "c8-doc",
      entityId: rowId,
      fieldName: "cover",
      key,
    });
    await setCover(docEntity, rowId, fileRefId);

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
      preloadedTenantPreset: null,
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
      preloadedTenantPreset: null,
      now,
      files: filesCtx(),
    });
    expect(retried.hardDeleted).toBe(1);
    expect(await labels("read_c8_doc", T1)).toEqual([]);
    expect(await fileRefExists(fileRefId)).toBe(false);
    expect(await provider.exists(key)).toBe(false);
  });

  test("rows stuck on storage failure do not starve rows behind them (batchLimit=2)", async () => {
    const stuckKeys = new Set<string>();
    for (const n of ["a", "b"]) {
      const rowId = await seedDoc(docEntity, T1, `stuck-${n}`, pastIso);
      const key = `t1/stuck-${n}/cover/orig.jpg`;
      stuckKeys.add(key);
      const fileRefId = await seedFileRef({
        tenantId: T1,
        entityName: "c8-doc",
        entityId: rowId,
        fieldName: "cover",
        key,
      });
      await setCover(docEntity, rowId, fileRefId);
    }
    await seedDoc(docEntity, T1, "no-files", pastIso);

    const failingProvider: FileStorageProvider = {
      ...provider,
      delete: async (k: string) => {
        if (stuckKeys.has(k)) throw new Error("boom");
        return provider.delete(k);
      },
    };

    const result = await runRetentionCleanup({
      db: stack.db,
      registry: stack.registry,
      tenantId: T1,
      preloadedTenantPreset: null,
      now,
      files: filesCtx(failingProvider),
      batchLimit: 2,
    });

    expect(result.hardDeleted).toBe(1);
    expect(await labels("read_c8_doc", T1)).toEqual(["stuck-a", "stuck-b"]);
  });

  test("no file storage wired → row stays, skipped missing_file_storage", async () => {
    const rowId = await seedDoc(docEntity, T1, "expired-no-storage", pastIso);
    const key = "t1/no-storage/cover/orig.jpg";
    const fileRefId = await seedFileRef({
      tenantId: T1,
      entityName: "c8-doc",
      entityId: rowId,
      fieldName: "cover",
      key,
    });
    await setCover(docEntity, rowId, fileRefId);

    const result = await runRetentionCleanup({
      db: stack.db,
      registry: stack.registry,
      tenantId: T1,
      preloadedTenantPreset: null,
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
    const softRowId = await seedDoc(softDocEntity, T1, "soft-expired", pastIso);
    const softKey = "t1/soft/cover/orig.jpg";
    const softFileRefId = await seedFileRef({
      tenantId: T1,
      entityName: "c8-soft-doc",
      entityId: softRowId,
      fieldName: "cover",
      key: softKey,
    });
    await setCover(softDocEntity, softRowId, softFileRefId);

    const anonRowId = await seedDoc(anonDocEntity, T1, "anon-expired", pastIso);
    const anonKey = "t1/anon/cover/orig.jpg";
    const anonFileRefId = await seedFileRef({
      tenantId: T1,
      entityName: "c8-anon-doc",
      entityId: anonRowId,
      fieldName: "cover",
      key: anonKey,
    });
    await setCover(anonDocEntity, anonRowId, anonFileRefId);

    const result = await runRetentionCleanup({
      db: stack.db,
      registry: stack.registry,
      tenantId: T1,
      preloadedTenantPreset: null,
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
    const rowId = await seedDoc(docEntity, T1, "expired-via-job", pastIso);
    const key = "t1/via-job/cover/orig.jpg";
    const fileRefId = await seedFileRef({
      tenantId: T1,
      entityName: "c8-doc",
      entityId: rowId,
      fieldName: "cover",
      key,
    });
    await setCover(docEntity, rowId, fileRefId);

    const job = stack.registry.getJob("data-retention:job:retention-cleanup");
    expect(job).toBeDefined();
    if (!job) return;

    const ctx: JobContext = {
      db: createTenantDb({
        db: stack.db,
        tenantId: T1,
        mode: "tenant",
        grants: {
          unsafeRaw: {
            reason: "per-tenant fan-out cleanup using raw helpers",
            grants: ["unsafeRaw"],
          },
        },
      }),
      registry: stack.registry,
      systemUser: { id: "system", tenantId: T1, roles: ["all"] },
      triggeredBy: null,
      attempt: 1,
      finalAttempt: true,
      defer: (delayMs) => ({ kind: "job-deferral", delayMs }),
      canDefer: false,
      ...bridgeStub({ services: { files: filesCtx() }, log: noopLogger }),
    };
    await job.handler({}, ctx);

    expect(await labels("read_c8_doc", T1)).toEqual([]);
    expect(await fileRefExists(fileRefId)).toBe(false);
    expect(await provider.exists(key)).toBe(false);
  });
});
