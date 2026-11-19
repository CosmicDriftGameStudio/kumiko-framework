// `documentExtract.pages` carries the full extracted text of invoices, IDs and contracts, and used
// to be `encrypted: true` — master-key ciphertext with no erasure subject, so no destroy path could
// ever make it unreadable. These tests pin the properties of record-owned encryption: ciphertext
// under the extract's own record key at rest, a plaintext round-trip through the executor, and
// shredding when that record key is erased (what the forget paths do).

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import {
  configurePiiSubjectKms,
  decryptPiiValueForSubject,
  InMemoryKmsAdapter,
  PII_ERASED_SENTINEL,
} from "@cosmicdrift/kumiko-framework/crypto";
import {
  asRawClient,
  createEventStoreExecutor,
  createTenantDb,
  selectMany,
} from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import {
  resetEventStore,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { createConfigFeature } from "../../config/index.ts";
import { documentExtractEntity, documentExtractsTable } from "../entity.ts";
import { eraseDocumentExtractKey } from "../executor.ts";
import { readIngestPages, writeIngestPages } from "../pages.ts";

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
  await resetEventStore(stack, [documentExtractsTable]);
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
    createTenantDb({ db: stack.db, tenantId }),
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

describe("documentExtract.pages — record-subject encryption", () => {
  test("stored as record-subject ciphertext, not master-key ciphertext", async () => {
    const id = await createExtract("file-1");

    const stored = await rawPages(id);
    // Pins the executor's entityName ("document-extract"), not the registry name documentExtract.
    expect(stored.startsWith(`kumiko-pii:v2:record:document-extract:${id}:`)).toBe(true);
    expect(stored).not.toContain("Erika Mustermann");
  });

  test("round-trips back to the original pages through the executor", async () => {
    const id = await createExtract("file-2");

    const row = await executor.detail({ id }, actor, createTenantDb({ db: stack.db, tenantId }));
    expect(readIngestPages(row?.["pages"])).toEqual(pages);
  });

  test("erasing the record key makes the extracted text unreadable", async () => {
    const id = await createExtract("file-3");

    await kms.eraseKey({ kind: "record", entity: "document-extract", id });

    const row = await executor.detail({ id }, actor, createTenantDb({ db: stack.db, tenantId }));
    expect(row?.["pages"]).toBe(PII_ERASED_SENTINEL);
    expect(readIngestPages(row?.["pages"])).toEqual([]);
  });

  test("forget followed by eraseDocumentExtractKey leaves the created event unreadable", async () => {
    const id = await createExtract("file-4");

    const forgotten = await executor.forget(
      { id },
      actor,
      createTenantDb({ db: stack.db, tenantId }),
    );
    if (!forgotten.isSuccess) throw new Error(`forget failed: ${forgotten.error.message}`);
    await eraseDocumentExtractKey(id, "t");

    const events = await selectMany<{ type: string; payload: Record<string, unknown> | null }>(
      stack.db,
      eventsTable,
      { aggregateId: id },
    );
    const created = events.find((event) => event.type === "document-extract.created");
    const storedPages = created?.payload?.["pages"];
    expect(
      await decryptPiiValueForSubject(kms, String(storedPages), { requestId: "t" }, "pages"),
    ).toBe(PII_ERASED_SENTINEL);
  });
});
