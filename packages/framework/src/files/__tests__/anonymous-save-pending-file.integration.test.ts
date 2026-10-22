// Every anonymous visitor shares one user id, so a save by one visitor must never bind a pending
// upload that another visitor stored.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { createEventStoreExecutor } from "../../db/event-store-executor.ts";
import { selectMany } from "../../db/query.ts";
import { buildEntityTable } from "../../db/table-builder.ts";
import { createEntity, createFileField, defineFeature } from "../../engine/index.ts";
import { testTenantId } from "../../seeding/seed-users.ts";
import { createFileRefFromBytes } from "../create-file-ref-from-bytes.ts";
import { createFilesFeature } from "../feature.ts";
import { fileRefsTable } from "../file-ref-table.ts";
import { createInMemoryFileProvider } from "../in-memory-provider.ts";

const submissionEntity = createEntity({
  table: "anonymous_save_pending_submissions",
  fields: { attachment: createFileField() },
});
const submissionTable = buildEntityTable("submission", submissionEntity);

const openFormFeature = defineFeature("open-form", (r) => {
  r.entity({ name: "submission", ...submissionEntity });
  r.writeHandler({
    name: "stash",
    schema: z.object({}),
    access: { roles: ["anonymous"], personalData: "public-intake" },
    handler: (_event, ctx) =>
      createFileRefFromBytes(ctx, {
        fileName: "doc.pdf",
        mimeType: "application/pdf",
        data: new TextEncoder().encode("%PDF-1.4 visitor upload"),
        attachTo: { entityType: "submission", fieldName: "attachment" },
      }),
  });
  r.writeHandler({
    name: "submit",
    schema: z.object({ fileRefId: z.string() }),
    access: { roles: ["anonymous"], personalData: "public-intake" },
    handler: (event, ctx) =>
      createEventStoreExecutor(submissionTable, submissionEntity, {
        entityName: "submission",
      }).create({ attachment: event.payload.fileRefId }, event.user, ctx.db),
  });
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createFilesFeature(), openFormFeature],
    files: { storageProvider: createInMemoryFileProvider() },
    anonymousAccess: { defaultTenantId: testTenantId(1) },
  });
  await unsafeCreateEntityTable(stack.db, submissionEntity);
});

afterAll(() => stack.cleanup());

describe("a save by an anonymous visitor naming a pending upload", () => {
  test("leaves another visitor's pending upload unbound", async () => {
    const stashRes = await stack.http.raw("POST", "/api/write", {
      type: "open-form:write:stash",
      payload: {},
    });
    expect(stashRes.status).toBe(200);
    const stashed = (await stashRes.json()) as { isSuccess: boolean; data: { id: string } };
    expect(stashed.isSuccess).toBe(true);
    const fileRefId = stashed.data.id;

    const submitRes = await stack.http.raw("POST", "/api/write", {
      type: "open-form:write:submit",
      payload: { fileRefId },
    });
    expect(submitRes.status).toBe(200);
    expect(await selectMany(stack.db, submissionTable)).toHaveLength(1);

    const [fileRef] = await selectMany(stack.db, fileRefsTable, { id: fileRefId });
    expect(fileRef?.["entityId"]).toBeNull();
  });
});
