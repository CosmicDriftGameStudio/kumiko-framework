// linkReadMode "allLinks": a document on a team's lease and on a shared property stays with
// readers of the lease, even though everyone can read the property.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import {
  createFixtureDocumentsFeature,
  type DocumentPage,
  documentsOf,
  seedLease,
  seedProperty,
  setupDocumentStack,
  tenant,
  uploadFile,
  users,
  visibleDocuments,
} from "./fixtures.ts";

const leaseAndPropertyReader = createTestUser({
  id: 9,
  tenantId: tenant,
  roles: ["PropertyReader", "LeaseReader"],
});

let stack: TestStack;
let propertyId: string;
let leaseId: string;

const titles = (page: DocumentPage) => page.rows.map((row) => row.title);

beforeAll(async () => {
  stack = await setupDocumentStack(createFixtureDocumentsFeature({ linkReadMode: "allLinks" }));
  propertyId = await seedProperty(stack, "Shared street 1");
  leaseId = await seedLease(stack, propertyId, { name: "Team A" });
  const file = await uploadFile(stack, users.admin, "filed-document", "file");
  const created = await stack.http.writeOk<{ id: string }>(
    "documents:write:filed-document:create",
    { title: "Handover", category: "contract", file },
    users.admin,
  );
  for (const [entityType, entityId] of [
    ["lease", leaseId],
    ["property", propertyId],
  ] as const) {
    await stack.http.writeOk(
      "documents:write:link",
      { documentId: created.id, entityType, entityId },
      users.admin,
    );
  }
});
afterAll(() => stack.cleanup());

describe("documents linkReadMode allLinks", () => {
  test("a reader of only the shared record does not see the document through it", async () => {
    expect(titles(await documentsOf(stack, users.propertyReader, "property", propertyId))).toEqual(
      [],
    );
    expect(titles(await visibleDocuments(stack, users.propertyReader))).not.toContain("Handover");
    expect(titles(await visibleDocuments(stack, users.leaseReader))).not.toContain("Handover");
  });

  test("a reader of every linked record sees it", async () => {
    expect(
      titles(await documentsOf(stack, leaseAndPropertyReader, "property", propertyId)),
    ).toContain("Handover");
    expect(titles(await visibleDocuments(stack, leaseAndPropertyReader))).toContain("Handover");
    expect(titles(await visibleDocuments(stack, users.admin))).toContain("Handover");
  });
});
