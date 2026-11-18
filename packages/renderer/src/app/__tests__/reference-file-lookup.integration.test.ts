// A reference column links the target's file only from the lookup rows, so the lookup
// query itself must withhold the file from a caller without field read access and from
// another tenant. Real stack, real HTTP calls.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createEntity,
  createFileField,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createFilesFeature,
  createInMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { referencedFileFieldOf } from "@cosmicdrift/kumiko-framework/ui-types";
import {
  buildMultipartBody,
  patchFileInstanceofForBunTest,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { REFERENCE_LIST_LOOKUP_LIMIT } from "../../hooks/reference-limits.ts";
import {
  referenceFileIdsOf,
  referenceLookupSource,
  referenceRowsByIdsPayload,
} from "../../hooks/use-reference-lookup.ts";

type SessionUser = (typeof TestUsers)[keyof typeof TestUsers];

const receiptEntity = createEntity({
  name: "receipt",
  table: "read_ref_file_receipts",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
    scan: createFileField({
      personal: false,
      reason: "test_fixture",
      access: { read: ["Admin"], write: ["Admin"] },
    }),
  },
});

const receiptFeature = defineFeature("ref-file", (r) => {
  const access = { access: { roles: ["Admin", "User"] } } as const;
  r.crud(receiptEntity, { write: access, read: access });
});

const { queryQn: receiptListQn, labelKey } = referenceLookupSource("ref-file", "receipt", "title");
const fileField = referencedFileFieldOf(receiptEntity);

let stack: TestStack;
let receiptId: string;
let scanFileId: string;

async function uploadPdf(as: SessionUser): Promise<string> {
  const formData = new FormData();
  formData.append(
    "file",
    new File([Buffer.from("%PDF-1.4 minimal")], "receipt.pdf", { type: "application/pdf" }),
  );
  const { body, contentType } = await buildMultipartBody(formData);
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${await stack.jwt.sign(as)}`, "Content-Type": contentType },
    body,
  });
  expect(res.status).toBe(201);
  const uploaded: { id: string } = await res.json();
  return uploaded.id;
}

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  stack = await setupTestStack({
    features: [createFilesFeature(), receiptFeature],
    files: { storageProvider: createInMemoryFileProvider() },
  });
  await unsafeCreateEntityTable(stack.db, receiptEntity, "receipt");
  scanFileId = await uploadPdf(TestUsers.admin);
  const created = await stack.http.writeOk<{ id: string }>(
    "ref-file:write:receipt:create",
    { title: "Roof offer", scan: scanFileId },
    TestUsers.admin,
  );
  receiptId = created.id;
});

afterAll(async () => {
  await stack.cleanup();
});

async function lookupAs(as: SessionUser) {
  const result = await stack.http.queryOk<{ rows: ReadonlyArray<Record<string, unknown>> }>(
    receiptListQn,
    referenceRowsByIdsPayload([receiptId], REFERENCE_LIST_LOOKUP_LIMIT),
    as,
  );
  if (fileField === undefined) throw new Error("the receipt entity has one file field");
  return { rows: result.rows, fileIds: referenceFileIdsOf(result.rows, fileField) };
}

describe("reference file lookup over /api/query", () => {
  test("a caller who may read the file field gets the referenced file", async () => {
    const { rows, fileIds } = await lookupAs(TestUsers.admin);
    expect(rows.map((row) => row[labelKey])).toEqual(["Roof offer"]);
    expect(fileIds.get(receiptId)).toBe(scanFileId);
  });

  test("a caller without read access on the file field gets the label but no file", async () => {
    const { rows, fileIds } = await lookupAs(TestUsers.user);
    expect(rows.map((row) => row[labelKey])).toEqual(["Roof offer"]);
    expect(rows[0]?.["scan"]).toBeUndefined();
    expect(fileIds.size).toBe(0);
  });

  test("another tenant gets neither the row nor the file", async () => {
    const { rows, fileIds } = await lookupAs(TestUsers.otherTenant);
    expect(rows).toEqual([]);
    expect(fileIds.size).toBe(0);
  });
});
