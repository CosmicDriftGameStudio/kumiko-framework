// Who sees a filed document: the gate needs a readable linked record AND a readable file owner.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import {
  type DocumentPage,
  documentsOf,
  seedLease,
  seedProperty,
  setupDocumentStack,
  uploadFile,
  users,
  visibleDocuments,
} from "./fixtures.ts";

let stack: TestStack;
let propertyId: string;

beforeAll(async () => {
  stack = await setupDocumentStack();
  propertyId = await seedProperty(stack, "Main street 1");
});
afterAll(() => stack.cleanup());

const titles = (page: DocumentPage) => page.rows.map((row) => row.title);

describe("documents visibility", () => {
  test("a lease contract captured from the lease stays hidden from a property-only reader", async () => {
    const leaseId = await seedLease(stack, propertyId, { name: "L1" });

    // linked to lease AND property, but the file belongs to the lease
    expect(titles(await documentsOf(stack, users.propertyReader, "property", propertyId))).toEqual(
      [],
    );
    expect((await visibleDocuments(stack, users.propertyReader)).total).toBe(0);
    expect(
      await stack.http.queryOk("documents:query:expiry-overview", {}, users.propertyReader),
    ).toEqual({ expired: 0, expiring: 0, valid: 0, none: 0 });

    expect(titles(await documentsOf(stack, users.leaseReader, "lease", leaseId))).toEqual([
      "Lease L1",
    ]);
    expect(titles(await visibleDocuments(stack, users.leaseReader))).toEqual(["Lease L1"]);
    expect(titles(await visibleDocuments(stack, users.admin))).toContain("Lease L1");
  });

  test("a directly uploaded document is visible through its linked record only", async () => {
    const file = await uploadFile(stack, users.admin, "document", "file");
    const created = await stack.http.writeOk<{ id: string }>(
      "documents:write:document:create",
      { title: "Insurance", category: "id", file },
      users.admin,
    );

    // unlinked: admin roles only
    expect(titles(await visibleDocuments(stack, users.admin))).toContain("Insurance");
    expect(titles(await visibleDocuments(stack, users.propertyReader))).not.toContain("Insurance");

    await stack.http.writeOk(
      "documents:write:link",
      { documentId: created.id, entityType: "property", entityId: propertyId },
      users.admin,
    );
    expect(titles(await documentsOf(stack, users.propertyReader, "property", propertyId))).toEqual([
      "Insurance",
    ]);
    expect(titles(await visibleDocuments(stack, users.nobody))).toEqual([]);
    expect(titles(await documentsOf(stack, users.nobody, "property", propertyId))).toEqual([]);
  });

  test("a file in a field the viewer may not read hides the document", async () => {
    const leaseId = await seedLease(stack, propertyId, { name: "L2", secret: true });

    expect(titles(await documentsOf(stack, users.secretReader, "lease", leaseId))).toContain(
      "Secret",
    );
    expect(titles(await documentsOf(stack, users.leaseReader, "lease", leaseId))).not.toContain(
      "Secret",
    );
    expect(titles(await visibleDocuments(stack, users.admin))).toContain("Secret");
  });

  test("a file whose owner entity has no query handler stays hidden from every role", async () => {
    const file = await uploadFile(stack, users.admin, "memo", "file");
    await stack.http.writeOk(
      "doc-fixtures:write:memo:create",
      { name: "M", propertyId, file },
      users.admin,
    );

    expect(
      titles(await documentsOf(stack, users.memoAndProperty, "property", propertyId)),
    ).not.toContain("Memo");
    expect(titles(await visibleDocuments(stack, users.memoAndProperty))).not.toContain("Memo");
    expect(titles(await visibleDocuments(stack, users.admin))).not.toContain("Memo");
  });

  test("an open liveEntities query does not make a file owner readable: only its detail query counts", async () => {
    const file = await uploadFile(stack, users.admin, "vault", "file");
    await stack.http.writeOk(
      "doc-fixtures:write:vault:create",
      { name: "V", propertyId, file },
      users.admin,
    );

    expect(
      titles(await documentsOf(stack, users.propertyReader, "property", propertyId)),
    ).not.toContain("Vault");
    expect(titles(await visibleDocuments(stack, users.propertyReader))).not.toContain("Vault");
    expect(titles(await visibleDocuments(stack, users.admin))).toContain("Vault");
  });

  test("deleting the owner record removes its document from every list", async () => {
    const leaseId = await seedLease(stack, propertyId, { name: "L3" });
    expect(titles(await visibleDocuments(stack, users.leaseReader))).toContain("Lease L3");

    const lease = await stack.http.queryOk<{ version: number }>(
      "doc-fixtures:query:lease:detail",
      { id: leaseId },
      users.admin,
    );
    await stack.http.writeOk(
      "doc-fixtures:write:lease:delete",
      { id: leaseId, version: lease.version },
      users.admin,
    );

    expect(titles(await visibleDocuments(stack, users.leaseReader))).not.toContain("Lease L3");
    expect(titles(await visibleDocuments(stack, users.admin))).not.toContain("Lease L3");
  });
});
