// Writing side of documents: link rights, capture, import, deletion and the expiry counts.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import {
  documentsOf,
  IMPORT_JOB,
  seedLease,
  seedProperty,
  setupDocumentStack,
  tenant,
  uploadFile,
  users,
  visibleDocuments,
} from "./fixtures.ts";

const LINKS = "documents:query:filed-document-link:list";
const FIRST_VERSION = 1;

let stack: TestStack;
let propertyId: string;

beforeAll(async () => {
  stack = await setupDocumentStack();
  propertyId = await seedProperty(stack, "Main street 1");
});
afterAll(() => stack.cleanup());

async function runImport(payload: Record<string, unknown>): Promise<void> {
  await stack.jobRunner?.dispatch(IMPORT_JOB, { tenantId: tenant, propertyId, ...payload });
  await stack.drainJobs();
}

async function fileDirectlyUploadedDocument(
  title: string,
): Promise<{ id: string; version: number }> {
  const file = await uploadFile(stack, users.admin, "filed-document", "file");
  return stack.http.writeOk(
    "documents:write:filed-document:create",
    { title, category: "id", file },
    users.admin,
  );
}

async function linkRows(documentId: string) {
  const page = await stack.http.queryOk<{ rows: readonly unknown[] }>(
    LINKS,
    { limit: 50, filters: [{ field: "documentId", op: "eq", value: documentId }] },
    users.admin,
  );
  return page.rows;
}

describe("update and delete", () => {
  test("need write access to a linked host; admin roles may also change unlinked documents", async () => {
    const doc = await fileDirectlyUploadedDocument("Warranty");
    await stack.http.writeOk(
      "documents:write:link",
      { documentId: doc.id, entityType: "property", entityId: propertyId },
      users.admin,
    );
    const changes = { id: doc.id, version: FIRST_VERSION, changes: { title: "Warranty 2" } };

    // reads the host, cannot edit it
    // a throwing preSave hook surfaces as 422, a throwing preDelete hook as the error itself
    const refusedUpdate = await stack.http.writeErr(
      "documents:write:filed-document:update",
      changes,
      users.propertyReader,
    );
    expect(refusedUpdate.httpStatus).toBe(422);
    const refusedDelete = await stack.http.writeErr(
      "documents:write:filed-document:delete",
      { id: doc.id, version: FIRST_VERSION },
      users.propertyReader,
    );
    expect(refusedDelete.httpStatus).toBe(404);
    expect(
      (await documentsOf(stack, users.propertyReader, "property", propertyId)).rows.map(
        (row) => row.title,
      ),
    ).toContain("Warranty");

    await stack.http.writeOk("documents:write:filed-document:update", changes, users.editor);
    await stack.http.writeOk(
      "documents:write:filed-document:delete",
      { id: doc.id, version: FIRST_VERSION + 1 },
      users.editor,
    );

    const unlinked = await fileDirectlyUploadedDocument("Unlinked");
    await stack.http.writeOk(
      "documents:write:filed-document:update",
      { id: unlinked.id, version: FIRST_VERSION, changes: { title: "Unlinked 2" } },
      users.admin,
    );
  });
});

describe("link and unlink", () => {
  test("need write access to the target; a foreign file id cannot be set", async () => {
    const doc = await fileDirectlyUploadedDocument("Permit");
    const link = { documentId: doc.id, entityType: "property", entityId: propertyId };
    await stack.http.writeOk("documents:write:link", link, users.admin);
    expect(
      (await documentsOf(stack, users.propertyReader, "property", propertyId)).rows.map(
        (r) => r.title,
      ),
    ).toContain("Permit");

    // the reader may see the document but not edit the property
    expect(
      (await stack.http.writeErr("documents:write:unlink", link, users.propertyReader)).httpStatus,
    ).toBe(404);
    expect(
      (
        await stack.http.writeErr(
          "documents:write:link",
          { ...link, entityType: "lease" },
          users.propertyReader,
        )
      ).httpStatus,
    ).toBe(404);

    await stack.http.writeOk("documents:write:unlink", link, users.editor);
    expect((await documentsOf(stack, users.propertyReader, "property", propertyId)).rows).toEqual(
      [],
    );

    // a file already owned by a lease must not be claimed by a document through the normal path
    const leaseId = await seedLease(stack, propertyId, { name: "Claimed" });
    const lease = await stack.http.queryOk<{ file: string }>(
      "doc-fixtures:query:lease:detail",
      { id: leaseId },
      users.admin,
    );
    const before = (await visibleDocuments(stack, users.admin)).total;
    const err = await stack.http.writeErr(
      "documents:write:filed-document:create",
      { title: "Stolen", category: "id", file: lease.file },
      users.admin,
    );
    expect(err.httpStatus).toBeGreaterThanOrEqual(400);
    expect((await visibleDocuments(stack, users.admin)).total).toBe(before);
  });
});

describe("a colleague's pending upload", () => {
  test("cannot be filed as a document, so the uploader's own save and capture still work", async () => {
    const pending = await uploadFile(stack, users.admin, "lease", "file");
    const before = (await visibleDocuments(stack, users.admin)).total;
    const err = await stack.http.writeErr(
      "documents:write:filed-document:create",
      { title: "Squatted", category: "id", file: pending },
      users.propertyReader,
    );
    expect(err.httpStatus).toBe(422);
    expect((await visibleDocuments(stack, users.admin)).total).toBe(before);

    await stack.http.writeOk(
      "doc-fixtures:write:lease:create",
      { name: "Mine", propertyId, file: pending },
      users.admin,
    );
    const captured = await visibleDocuments(stack, users.admin, {
      filters: [{ field: "title", op: "eq", value: "Lease Mine" }],
    });
    expect(captured.rows).toHaveLength(1);

    const own = await uploadFile(stack, users.admin, "filed-document", "file");
    await stack.http.writeOk(
      "documents:write:filed-document:create",
      { title: "Own", category: "id", file: own },
      users.admin,
    );
  });
});

describe("capture", () => {
  test("a save-uploaded file yields one document with its links; saving again changes nothing", async () => {
    const leaseId = await seedLease(stack, propertyId, { name: "Cap" });
    const first = await visibleDocuments(stack, users.admin, {
      filters: [{ field: "title", op: "eq", value: "Lease Cap" }],
    });
    expect(first.rows).toHaveLength(1);
    const documentId = first.rows[0]?.id ?? "";
    expect(await linkRows(documentId)).toHaveLength(2); // the lease itself and the property

    const lease = await stack.http.queryOk<{ version: number }>(
      "doc-fixtures:query:lease:detail",
      { id: leaseId },
      users.admin,
    );
    await stack.http.writeOk(
      "doc-fixtures:write:lease:update",
      { id: leaseId, version: lease.version, changes: { name: "Cap" } },
      users.admin,
    );
    expect(
      (
        await visibleDocuments(stack, users.admin, {
          filters: [{ field: "title", op: "eq", value: "Lease Cap" }],
        })
      ).rows,
    ).toHaveLength(1);
    expect(await linkRows(documentId)).toHaveLength(2);
  });

  test("a file a job generated and bound to the lease arrives as a document", async () => {
    const created = await stack.http.writeOk<{ id: string }>(
      "doc-fixtures:write:lease:create",
      { name: "Rendered", propertyId },
      users.admin,
    );
    const lease = await stack.http.queryOk<{ version: number }>(
      "doc-fixtures:query:lease:detail",
      { id: created.id },
      users.admin,
    );
    await stack.jobRunner?.dispatch("doc-fixtures:job:render-lease-pdf", {
      tenantId: tenant,
      leaseId: created.id,
      version: lease.version,
    });
    await stack.drainJobs();

    expect(
      (await documentsOf(stack, users.leaseReader, "lease", created.id)).rows.map((r) => r.title),
    ).toEqual(["Lease Rendered"]);
  });
});

describe("a generated file bound without a save", () => {
  test("arrives as a document through the import", async () => {
    const created = await stack.http.writeOk<{ id: string }>(
      "doc-fixtures:write:lease:create",
      { name: "Bound", propertyId },
      users.admin,
    );
    await stack.jobRunner?.dispatch("doc-fixtures:job:bind-and-import", {
      tenantId: tenant,
      leaseId: created.id,
    });
    await stack.drainJobs();

    expect(
      (await documentsOf(stack, users.leaseReader, "lease", created.id)).rows.map((r) => r.title),
    ).toEqual(["Bound"]);
  });
});

describe("import", () => {
  test("is reserved for the system user, keeps the id, is idempotent and can import deleted", async () => {
    const link = { entityType: "property", entityId: propertyId };
    const denied = await stack.http.writeErr(
      "documents:write:import",
      {
        id: crypto.randomUUID(),
        title: "x",
        category: "id",
        fileRefId: crypto.randomUUID(),
        links: [link],
      },
      users.admin,
    );
    expect(denied.httpStatus).toBe(403);

    const id = "5a000000-0000-4000-8000-000000000001";
    await runImport({ id });
    await runImport({ id });
    const page = await visibleDocuments(stack, users.propertyReader, {
      filters: [{ field: "title", op: "eq", value: "Imported" }],
    });
    expect(page.rows.map((row) => row.id)).toEqual([id]);
    expect(await linkRows(id)).toHaveLength(1);

    const goneId = "5a000000-0000-4000-8000-000000000002";
    await runImport({ id: goneId, deleted: true });
    expect((await visibleDocuments(stack, users.admin)).rows.map((row) => row.id)).not.toContain(
      goneId,
    );
    const trash = await visibleDocuments(stack, users.admin, { includeDeleted: true });
    expect(trash.rows.map((row) => row.id)).toContain(goneId);
    await runImport({ id: goneId, deleted: true });
    expect(await linkRows(goneId)).toHaveLength(1);
  });

  test("refuses an id that belongs to another record and links nothing", async () => {
    const foreignId = await seedProperty(stack, "Taken street 2");
    await expect(runImport({ id: foreignId })).rejects.toThrow("belongs to another record");

    expect(await linkRows(foreignId)).toEqual([]);
    const trash = await visibleDocuments(stack, users.admin, { includeDeleted: true });
    expect(trash.rows.map((row) => row.id)).not.toContain(foreignId);
  });
});

describe("deleting a document", () => {
  test("keeps the file with the record it came from", async () => {
    const leaseId = await seedLease(stack, propertyId, { name: "Keep" });
    const doc = (
      await visibleDocuments(stack, users.admin, {
        filters: [{ field: "title", op: "eq", value: "Lease Keep" }],
      })
    ).rows[0];
    expect(doc).toBeDefined();
    const detail = await stack.http.queryOk<{ version: number }>(
      "documents:query:filed-document:detail",
      { id: doc?.id },
      users.admin,
    );
    await stack.http.writeOk(
      "documents:write:filed-document:delete",
      { id: doc?.id, version: detail.version },
      users.admin,
    );

    expect(
      (
        await visibleDocuments(stack, users.admin, {
          filters: [{ field: "title", op: "eq", value: "Lease Keep" }],
        })
      ).rows,
    ).toEqual([]);
    const lease = await stack.http.queryOk<{ file: string }>(
      "doc-fixtures:query:lease:detail",
      { id: leaseId },
      users.admin,
    );
    const token = await stack.jwt.sign(users.admin);
    const download = await stack.app.request(`/api/files/${lease.file}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(download.status).toBe(200);
  });
});

describe("expiry overview (clock fixed at 2026-06-15)", () => {
  test("buckets documents by validity and follows the viewer's gate", async () => {
    const dates = ["2026-06-14", "2026-06-15", "2026-07-15", "2026-07-16", undefined];
    for (const [index, validUntil] of dates.entries()) {
      await runImport({ id: `5b000000-0000-4000-8000-00000000000${index}`, validUntil });
    }
    const importedTitle = "Imported";

    const overview = (as: typeof users.admin) =>
      stack.http.queryOk<Record<string, number>>(
        "documents:query:expiry-overview",
        { entityType: "property", entityId: propertyId },
        as,
      );
    // the earlier import has no expiry date and counts as "none"
    expect(await overview(users.propertyReader)).toEqual({
      expired: 1,
      expiring: 2,
      valid: 1,
      none: 2,
    });
    expect(await overview(users.nobody)).toEqual({ expired: 0, expiring: 0, valid: 0, none: 0 });

    const expired = await visibleDocuments(stack, users.propertyReader, {
      filters: [
        { field: "title", op: "eq", value: importedTitle },
        { field: "validUntil", op: "lt", value: "2026-06-15" },
      ],
    });
    expect(expired.total).toBe(1);
  });
});
