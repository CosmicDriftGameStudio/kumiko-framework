// POST /api/files writes fileRef.created through a TenantDb that carries the registry, so custom
// projections on the file entity run in the upload's transaction: a failing projection rolls
// the upload back and leaves no bytes behind.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  buildMultipartBody,
  patchFileInstanceofForBunTest,
} from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { table as pgTable, text as pgText, uuid as pgUuid } from "../../db/dialect.ts";
import { insertOne, selectMany } from "../../db/query.ts";
import { defineFeature } from "../../engine/index.ts";
import { createTestUser, testTenantId } from "../../seeding/seed-users.ts";
import { createFilesFeature } from "../feature.ts";
import { fileRefsTable } from "../file-ref-table.ts";
import { createInMemoryFileProvider, type InMemoryFileProvider } from "../in-memory-provider.ts";

const uploadLogTable = pgTable("read_fupload_log", {
  fileRefId: pgUuid("file_ref_id").primaryKey(),
  tenantId: pgUuid("tenant_id").notNull(),
  fileName: pgText("file_name").notNull(),
});

const FAILING_FILE_NAME = "projection-explodes.pdf";
const projectionCalls: string[] = [];

const projectionFeature = defineFeature("fupload", (r) => {
  r.projection({
    name: "upload-log",
    source: "fileRef",
    table: uploadLogTable,
    apply: {
      "fileRef.created": async (event, tx) => {
        const payload = event.payload as { fileName: string };
        projectionCalls.push(event.aggregateId);
        if (payload.fileName === FAILING_FILE_NAME) throw new Error("projection failed on purpose");
        await insertOne(tx, uploadLogTable, {
          fileRefId: event.aggregateId,
          tenantId: event.tenantId,
          fileName: payload.fileName,
        });
      },
    },
  });
});

const uploader = createTestUser({ id: 1, tenantId: testTenantId(1), roles: ["User"] });
const PDF_BYTES = new TextEncoder().encode("%PDF-1.4 minimal");

let stack: TestStack;
let provider: InMemoryFileProvider;

async function upload(fileName: string): Promise<Response> {
  const token = await stack.jwt.sign(uploader);
  const fd = new FormData();
  fd.append("file", new File([Buffer.from(PDF_BYTES)], fileName, { type: "application/pdf" }));
  const { body, contentType } = await buildMultipartBody(fd);
  return stack.app.request("/api/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body,
  });
}

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  provider = createInMemoryFileProvider();
  stack = await setupTestStack({
    features: [createFilesFeature(), projectionFeature],
    files: { storageProvider: provider },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(() => {
  projectionCalls.length = 0;
});

describe("custom projections on fileRef.created through POST /api/files", () => {
  test("the projection runs exactly once for the uploaded file", async () => {
    const res = await upload("ok.pdf");
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };

    expect(projectionCalls).toEqual([id]);
    const logged = await selectMany(stack.db, uploadLogTable, { fileRefId: id });
    expect(logged).toHaveLength(1);
  });

  test("a throwing projection answers 500 and leaves no row and no bytes", async () => {
    const rowsBefore = await selectMany(stack.db, fileRefsTable, {});
    const keysBefore = provider.keys();

    const res = await upload(FAILING_FILE_NAME);

    expect(res.status).toBe(500);
    expect(projectionCalls).toHaveLength(1);
    expect(await selectMany(stack.db, fileRefsTable, {})).toHaveLength(rowsBefore.length);
    expect(provider.keys()).toEqual(keysBefore);
  });
});
