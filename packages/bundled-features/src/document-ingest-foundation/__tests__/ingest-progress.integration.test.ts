import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { createComplianceProfilesFeature } from "../../compliance-profiles/index.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.ts";
import { documentIngestAggregateId } from "../aggregate-id.ts";
import { createDocumentIngestFoundationFeature } from "../feature.ts";
import { reportIngestProgress } from "../report-ingest-progress.ts";
import { documentIngestProgressTable } from "../tables.ts";

const admin = TestUsers.admin;

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createComplianceProfilesFeature(),
      createTenantFeature(),
      createTenantLifecycleFeature(),
      createDocumentIngestFoundationFeature(),
    ],
  });
});

afterAll(async () => {
  await stack.cleanup();
});

function report(fileRefId: string, pagesDone: number, pagesTotal: number) {
  return reportIngestProgress(
    { db: stack.db, registry: stack.registry, tenantId: admin.tenantId, actorId: admin.id },
    { fileRefId, pagesDone, pagesTotal },
  );
}

async function progressRows() {
  return selectMany<{
    id: string;
    fileRefId: string;
    pagesDone: number;
    pagesTotal: number;
  }>(stack.db, documentIngestProgressTable, { tenantId: admin.tenantId });
}

describe("reportIngestProgress", () => {
  test("keeps one row per file with the latest page count", async () => {
    await report("file-a", 1, 3);
    await report("file-a", 2, 3);

    const rows = (await progressRows()).filter((row) => row.fileRefId === "file-a");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: documentIngestAggregateId(admin.tenantId, "file-a"),
      pagesDone: 2,
      pagesTotal: 3,
    });
  });

  test("a second file gets its own row", async () => {
    await report("file-a", 2, 3);
    await report("file-b", 1, 5);

    const rows = await progressRows();
    const byFile = new Map(rows.map((row) => [row.fileRefId, row]));
    expect(byFile.get("file-a")).toMatchObject({ pagesDone: 2, pagesTotal: 3 });
    expect(byFile.get("file-b")).toMatchObject({ pagesDone: 1, pagesTotal: 5 });
  });
});
