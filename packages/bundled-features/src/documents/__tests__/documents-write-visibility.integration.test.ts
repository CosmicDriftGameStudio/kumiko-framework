// A caller who may edit a host but cannot read a document must not write it either: update,
// delete, link and unlink answer 404 like a missing document, and nothing changes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import type { WhereRule } from "@cosmicdrift/kumiko-types/ownership";
import { documentIdForFile } from "../aggregate-id.ts";
import {
  createFixtureDocumentsFeature,
  seedLease,
  seedProperty,
  setupDocumentStack,
  tenant,
  users,
} from "./fixtures.ts";

const DETAIL = "documents:query:filed-document:detail";
const LINKS = "documents:query:filed-document-link:list";

type DocumentDetail = { id: string; title: string; version: number };

const hidesContract: WhereRule = {
  kind: "where",
  where: (_user, ctx) => ({
    sqlText: `${ctx.tableName}.category <> $${ctx.paramStart}`,
    params: ["contract"],
  }),
};

async function capturedDocumentId(stack: TestStack, leaseId: string): Promise<string> {
  const lease = await stack.http.queryOk<{ file: string }>(
    "doc-fixtures:query:lease:detail",
    { id: leaseId },
    users.admin,
  );
  return documentIdForFile(tenant, lease.file);
}

async function expectWritesRefusedAndNothingChanged(
  stack: TestStack,
  documentId: string,
  freeHostId: string,
  linkedHostId: string,
): Promise<void> {
  const before = await stack.http.queryOk<DocumentDetail>(DETAIL, { id: documentId }, users.admin);
  const linksBefore = await stack.http.queryOk<{ rows: readonly unknown[] }>(
    LINKS,
    { limit: 50, filters: [{ field: "documentId", op: "eq", value: documentId }] },
    users.admin,
  );
  const as = users.editor;
  // the caller may edit both properties, so only the document's own visibility can refuse
  const refused = [
    await stack.http.writeErr(
      "documents:write:filed-document:update",
      { id: documentId, version: before.version, changes: { title: "Taken over" } },
      as,
    ),
    await stack.http.writeErr(
      "documents:write:filed-document:delete",
      { id: documentId, version: before.version },
      as,
    ),
    await stack.http.writeErr(
      "documents:write:link",
      { documentId, entityType: "property", entityId: freeHostId },
      as,
    ),
    await stack.http.writeErr(
      "documents:write:unlink",
      { documentId, entityType: "property", entityId: linkedHostId },
      as,
    ),
  ];
  expect(refused.map((err) => err.httpStatus)).toEqual([404, 404, 404, 404]);

  expect(await stack.http.queryOk<DocumentDetail>(DETAIL, { id: documentId }, users.admin)).toEqual(
    before,
  );
  const linksAfter = await stack.http.queryOk<{ rows: readonly unknown[] }>(
    LINKS,
    { limit: 50, filters: [{ field: "documentId", op: "eq", value: documentId }] },
    users.admin,
  );
  expect(linksAfter.rows).toEqual(linksBefore.rows);
}

describe("a document hidden by readAccess", () => {
  let stack: TestStack;
  beforeAll(async () => {
    stack = await setupDocumentStack(
      createFixtureDocumentsFeature({
        readAccessOverride: { PropertyReader: hidesContract, PropertyEditor: hidesContract },
      }),
    );
  });
  afterAll(() => stack.cleanup());

  test("cannot be updated, deleted, linked or unlinked", async () => {
    const propertyId = await seedProperty(stack, "Hidden street 1");
    const freeId = await seedProperty(stack, "Free street 2");
    const documentId = await capturedDocumentId(
      stack,
      await seedLease(stack, propertyId, { name: "Hidden" }),
    );
    await expectWritesRefusedAndNothingChanged(stack, documentId, freeId, propertyId);
  });
});

describe("a document hidden by allLinks", () => {
  let stack: TestStack;
  beforeAll(async () => {
    stack = await setupDocumentStack(createFixtureDocumentsFeature({ linkReadMode: "allLinks" }));
  });
  afterAll(() => stack.cleanup());

  test("cannot be updated, deleted, linked or unlinked", async () => {
    const propertyId = await seedProperty(stack, "Shared street 1");
    const freeId = await seedProperty(stack, "Free street 2");
    const leaseId = await seedLease(stack, propertyId, { name: "Other team" });
    const documentId = await capturedDocumentId(stack, leaseId);
    // the editor reads the property but not the lease, so allLinks hides the document
    await stack.http.writeOk(
      "documents:write:link",
      { documentId, entityType: "lease", entityId: leaseId },
      users.admin,
    );
    await expectWritesRefusedAndNothingChanged(stack, documentId, freeId, propertyId);
  });
});
