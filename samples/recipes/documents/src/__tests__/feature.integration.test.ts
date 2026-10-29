import { afterAll, beforeAll, describe, expect, test } from "bun:test";
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
