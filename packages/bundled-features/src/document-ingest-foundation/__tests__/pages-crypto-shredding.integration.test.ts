// The point of #1621: `documentExtract.pages` carries the full extracted
// text of invoices, IDs and contracts, and used to be `encrypted: true` —
// master-key ciphertext with no erasure subject, so no destroy path could
// ever make it unreadable. These tests pin the three properties the swap to
// `tenantOwned` buys: tenant-subject ciphertext at rest, a plaintext
// round-trip through the executor, and actual shredding when the tenant
// subject key dies.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  PII_ERASED_SENTINEL,
} from "@cosmicdrift/kumiko-framework/crypto";
import { createEventStoreExecutor, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-framework/testing";
import { createConfigFeature } from "../../config";
import { documentExtractEntity, documentExtractsTable } from "../entity";
import { readIngestPages, writeIngestPages } from "../pages";
import { documentExtractTenantDestroyHook } from "../tenant-destroy-hook";

let stack: TestStack;
let kms: InMemoryKmsAdapter;

const tenantId = testTenantId(1);
const actor = createSystemUser(tenantId);

const executor = createEventStoreExecutor(documentExtractsTable, documentExtractEntity, {
  entityName: "document-extract",
});

const pages = [
  { pageNumber: 1, text: "Rechnung Nr. 4711, Mieterin: Erika Mustermann" },
  { pageNumber: 2, text: "IBAN DE02120300000000202051" },
];

beforeAll(async () => {
  stack = await setupTestStack({ features: [createConfigFeature()] });
  await unsafeCreateEntityTable(stack.db, documentExtractEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  kms = new InMemoryKmsAdapter();
  configurePiiSubjectKms(kms);
  await asRawClient(stack.db).unsafe(`TRUNCATE read_document_extracts`);
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
});

async function createExtract(fileRefId: string): Promise<string> {
  const result = await executor.create(
    {
      fileRefId,
      storageKey: `s3://bucket/${fileRefId}`,
      pages: writeIngestPages(pages),
      meta: { provider: "test", ms: 1, needsOcr: false, pagesParsed: 2, totalPages: 2 },
    },
    actor,
    createTenantDb(stack.db, tenantId),
  );
  if (!result.isSuccess) throw new Error(`create failed: ${result.error.message}`);
  return String(result.data.id);
}

async function rawPages(id: string): Promise<string> {
  const rows = (await asRawClient(stack.db).unsafe(
    `SELECT pages FROM read_document_extracts WHERE id = $1`,
    [id],
  )) as ReadonlyArray<{ pages: string }>;
  return String(rows[0]?.pages);
}

describe("documentExtract.pages — tenant-subject encryption (#1621)", () => {
  test("stored as tenant-subject ciphertext, not master-key ciphertext", async () => {
    const id = await createExtract("file-1");

    const stored = await rawPages(id);
    expect(stored.startsWith(`kumiko-pii:v2:tenant:${tenantId}:`)).toBe(true);
    expect(stored).not.toContain("Erika Mustermann");
  });

  test("round-trips back to the original pages through the executor", async () => {
    const id = await createExtract("file-2");

    const row = await executor.detail({ id }, actor, createTenantDb(stack.db, tenantId));
    expect(readIngestPages(row?.["pages"])).toEqual(pages);
  });

  test("erasing the tenant subject key makes the extracted text unreadable", async () => {
    const id = await createExtract("file-3");

    await kms.eraseKey({ kind: "tenant", tenantId });

    const row = await executor.detail({ id }, actor, createTenantDb(stack.db, tenantId));
    expect(row?.["pages"]).toBe(PII_ERASED_SENTINEL);
    expect(readIngestPages(row?.["pages"])).toEqual([]);
  });
});

describe("documentExtractTenantDestroyHook (#1621)", () => {
  test("drops the tenant's extract rows and leaves other tenants alone", async () => {
    const mine = await createExtract("file-mine");
    const otherTenantId = testTenantId(2);
    const otherResult = await executor.create(
      {
        fileRefId: "file-theirs",
        storageKey: "s3://bucket/file-theirs",
        pages: writeIngestPages(pages),
        meta: {},
      },
      createSystemUser(otherTenantId),
      createTenantDb(stack.db, otherTenantId),
    );
    if (!otherResult.isSuccess) throw new Error("setup create failed");

    await documentExtractTenantDestroyHook({ db: stack.db, tenantId });

    const remaining = (await asRawClient(stack.db).unsafe(
      `SELECT id FROM read_document_extracts`,
    )) as ReadonlyArray<{ id: string }>;
    expect(remaining.map((row) => row.id)).not.toContain(mine);
    expect(remaining).toHaveLength(1);
  });
});
