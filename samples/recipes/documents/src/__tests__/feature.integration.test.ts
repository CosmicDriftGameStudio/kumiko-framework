import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { documentIdForFile } from "@cosmicdrift/kumiko-bundled-features/documents";
import {
  createFilesFeature,
  createInMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  buildMultipartBody,
  patchFileInstanceofForBunTest,
} from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { documents, propertyManagement } from "../feature.ts";

const tenant = testTenantId(1);
const admin = createTestUser({ id: 1, tenantId: tenant, roles: ["TenantAdmin"] });
const propertyReader = createTestUser({ id: 2, tenantId: tenant, roles: ["PropertyReader"] });
const contractReader = createTestUser({ id: 3, tenantId: tenant, roles: ["ContractReader"] });

type Page = { rows: readonly { title: string }[] };

let stack: TestStack;

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  stack = await setupTestStack({
    features: [createFilesFeature(), propertyManagement, documents],
    files: { storageProvider: createInMemoryFileProvider() },
  });
});
afterAll(() => stack.cleanup());

async function uploadContractFile(): Promise<string> {
  const form = new FormData();
  form.append("entityType", "contract");
  form.append("fieldName", "file");
  form.append(
    "file",
    new File([Buffer.from("%PDF-1.4 lease")], "lease.pdf", { type: "application/pdf" }),
  );
  const { body, contentType } = await buildMultipartBody(form);
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await stack.jwt.sign(admin)}`,
      "Content-Type": contentType,
    },
    body,
  });
  return z.object({ id: z.string() }).parse(await res.json()).id;
}

describe("documents recipe", () => {
  test("a contract file becomes a document that only contract readers see", async () => {
    const property = await stack.http.writeOk<{ id: string }>(
      "property-management:write:property:create",
      { name: "Main street 1" },
      admin,
    );
    const contract = await stack.http.writeOk<{ id: string }>(
      "property-management:write:contract:create",
      { name: "C-1", propertyId: property.id, file: await uploadContractFile() },
      admin,
    );

    const forRecord = (as: typeof admin, entityType: string, entityId: string) =>
      stack.http.queryOk<Page>("documents:query:for-record", { entityType, entityId }, as);

    expect(
      (await forRecord(contractReader, "contract", contract.id)).rows.map((r) => r.title),
    ).toEqual(["Contract C-1"]);
    expect((await forRecord(admin, "property", property.id)).rows.map((r) => r.title)).toEqual([
      "Contract C-1",
    ]);
    // the property reader may open the property but not the contract that owns the file
    expect((await forRecord(propertyReader, "property", property.id)).rows).toEqual([]);
  });
});

describe("offer list: reference to a filed document", () => {
  // The query a list's reference column loads its labels from; the cell links `file`
  // from the same rows, since filed-document has exactly one file field.
  const lookupReceipt = (as: typeof admin, documentId: string) =>
    stack.http.queryOk<{ rows: readonly Record<string, unknown>[] }>(
      "documents:query:filed-document:list",
      { filters: [{ field: "id", op: "in", value: [documentId] }] },
      as,
    );

  test("the receipt lookup carries the title and the file for a reader of the document", async () => {
    const fileId = await uploadContractFile();
    const property = await stack.http.writeOk<{ id: string }>(
      "property-management:write:property:create",
      { name: "Harbour road 7" },
      admin,
    );
    await stack.http.writeOk(
      "property-management:write:contract:create",
      { name: "C-2", propertyId: property.id, file: fileId },
      admin,
    );
    const documentId = documentIdForFile(tenant, fileId);
    await stack.http.writeOk(
      "property-management:write:offer:create",
      { name: "Roof repair", receipt: documentId },
      admin,
    );

    const forContractReader = await lookupReceipt(contractReader, documentId);
    expect(forContractReader.rows.map((row) => [row["title"], row["file"]])).toEqual([
      ["Contract C-2", fileId],
    ]);
    // the property reader may not read the contract that owns the file: no label, no file
    expect((await lookupReceipt(propertyReader, documentId)).rows).toEqual([]);
  });
});

describe("contract copy: an actionForm success fact of type file", () => {
  const otherTenantAdmin = createTestUser({
    id: 4,
    tenantId: testTenantId(2),
    roles: ["TenantAdmin"],
  });
  const filesMeta = async (as: typeof admin, ids: readonly string[]) => {
    const res = await stack.app.request(`/api/files/meta?ids=${ids.join(",")}`, {
      headers: { Authorization: `Bearer ${await stack.jwt.sign(as)}` },
    });
    expect(res.status).toBe(200);
    return z
      .object({ files: z.array(z.object({ id: z.string(), fileName: z.string() })) })
      .parse(await res.json()).files;
  };

  test("the result carries the FileRef id, which resolves for its tenant only", async () => {
    const fileId = await uploadContractFile();
    const property = await stack.http.writeOk<{ id: string }>(
      "property-management:write:property:create",
      { name: "Park lane 3" },
      admin,
    );
    const contract = await stack.http.writeOk<{ id: string }>(
      "property-management:write:contract:create",
      { name: "C-3", propertyId: property.id, file: fileId },
      admin,
    );

    const copy = await stack.http.writeOk<{ contractFile: string }>(
      "property-management:write:contract:send-copy",
      { contractId: contract.id },
      admin,
    );
    expect(copy.contractFile).toBe(fileId);
    expect(await filesMeta(admin, [copy.contractFile])).toEqual([
      expect.objectContaining({ id: fileId, fileName: "lease.pdf" }),
    ]);
    expect(await filesMeta(otherTenantAdmin, [copy.contractFile])).toEqual([]);
  });
});
