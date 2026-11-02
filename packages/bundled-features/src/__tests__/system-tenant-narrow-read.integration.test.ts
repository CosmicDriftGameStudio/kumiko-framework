import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  asRawClient,
  createTenantDb,
  defineUnmanagedTable,
} from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import {
  createInMemoryFileProvider,
  createTenantFileContext,
  fileRefsTable,
} from "@cosmicdrift/kumiko-framework/files";
import { systemTenantReadDb } from "@cosmicdrift/kumiko-framework/internal/row-level-security";
import { testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { readFileRefContent } from "../file-foundation/read-file-ref-content.ts";
import { createFilesFeature } from "../files/index.ts";

const tenantA = testTenantId(1);
const tenantB = testTenantId(2);
const SYSTEM_FILE_ID = "00000000-0000-4000-8000-0000000000a1";
const TENANT_A_FILE_ID = "00000000-0000-4000-8000-0000000000a2";
const TENANT_B_FILE_ID = "00000000-0000-4000-8000-0000000000a3";
const SYSTEM_BYTES = new TextEncoder().encode("system template file");

const writeProbeTable = defineUnmanagedTable({
  tableName: "store_system_read_write_probe",
  columns: [
    {
      name: "id",
      pgType: "uuid",
      notNull: true,
      primaryKey: true,
      defaultSql: "gen_random_uuid()",
    },
    { name: "tenant_id", pgType: "uuid", notNull: true },
    { name: "label", pgType: "text", notNull: true },
  ],
});

const provider = createInMemoryFileProvider();
let stack: TestStack;

async function seedFileRef(id: string, tenantId: string): Promise<void> {
  await provider.write(`storage/${id}`, SYSTEM_BYTES, "application/pdf");
  await asRawClient(stack.db).unsafe(
    `INSERT INTO file_refs (id, tenant_id, storage_key, file_name, mime_type, size, inserted_by_id)
     VALUES ($1, $2, $3, $4, 'application/pdf', $5, $6)`,
    [id, tenantId, `storage/${id}`, `${id}.pdf`, SYSTEM_BYTES.length, tenantA],
  );
}

function tenantSession(tenantId: string) {
  return createTenantDb({ db: stack.unscopedDb, tenantId: tenantId as typeof tenantA });
}

function filesForTenant(tenantId: string) {
  return createTenantFileContext(async () => provider, tenantId as typeof tenantA);
}

beforeAll(async () => {
  stack = await setupTestStack({ features: [createFilesFeature()] });
  await unsafePushTables(stack.db, { fileRefsTable });
  await seedFileRef(SYSTEM_FILE_ID, SYSTEM_TENANT_ID);
  await seedFileRef(TENANT_A_FILE_ID, tenantA);
  await seedFileRef(TENANT_B_FILE_ID, tenantB);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("readFileRefContent on file_refs (no system read policy)", () => {
  test("a tenant session reads a system file when the system tenant is allowed", async () => {
    const content = await readFileRefContent({
      db: tenantSession(tenantA),
      filesForTenant,
      fileRefId: SYSTEM_FILE_ID,
      allowedTenantIds: [tenantA, SYSTEM_TENANT_ID],
    });
    expect(content?.tenantId).toBe(SYSTEM_TENANT_ID);
    expect(content?.content).toEqual(SYSTEM_BYTES);
  });

  test("a system file is not readable unless the system tenant is allowed", async () => {
    const content = await readFileRefContent({
      db: tenantSession(tenantA),
      filesForTenant,
      fileRefId: SYSTEM_FILE_ID,
      allowedTenantIds: [tenantA],
    });
    expect(content).toBeNull();
  });

  test("another tenant's file stays unreadable, even with the system tenant allowed", async () => {
    const content = await readFileRefContent({
      db: tenantSession(tenantA),
      filesForTenant,
      fileRefId: TENANT_B_FILE_ID,
      allowedTenantIds: [tenantA, SYSTEM_TENANT_ID],
    });
    expect(content).toBeNull();
  });

  test("the caller's own file is still found first", async () => {
    const content = await readFileRefContent({
      db: tenantSession(tenantA),
      filesForTenant,
      fileRefId: TENANT_A_FILE_ID,
      allowedTenantIds: [tenantA, SYSTEM_TENANT_ID],
    });
    expect(content?.tenantId).toBe(tenantA);
  });
});

describe("systemTenantReadDb", () => {
  test("reads only the system tenant's rows of an unmarked table", async () => {
    const rows = await systemTenantReadDb(tenantSession(tenantA)).selectMany<{ id: string }>(
      fileRefsTable,
      {},
    );
    expect(rows.map((row) => row.id)).toEqual([SYSTEM_FILE_ID]);
  });

  test("works on a raw runner as well", async () => {
    const rows = await systemTenantReadDb(stack.unscopedDb).selectMany<{ id: string }>(
      fileRefsTable,
      {},
    );
    expect(rows.map((row) => row.id)).toEqual([SYSTEM_FILE_ID]);
  });

  test("refuses writes", async () => {
    const readDb = systemTenantReadDb(tenantSession(tenantA));
    await expect(readDb.insertOne(writeProbeTable, { label: "x" })).rejects.toThrow(
      /writes are not available/,
    );
  });
});
