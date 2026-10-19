// runRetentionCleanup is public API: an app test drives the retention run with its own `now`
// and the stack's storage provider, then checks that the file bytes, the file_refs row and the
// entity row are gone and the erasure is on the audit trail.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createDataRetentionFeature,
  runRetentionCleanup,
  tenantRetentionOverrideEntity,
} from "@cosmicdrift/kumiko-bundled-features/data-retention";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createFileContext,
  createFilesFeature,
  createInMemoryFileProvider,
  fileRefsTable,
} from "@cosmicdrift/kumiko-framework/files";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import {
  buildMultipartBody,
  patchFileInstanceofForBunTest,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { retainedDocEntity, retainedDocsFeature } from "../retained-docs";

const CREATE = "retained-docs:write:retained-doc:create";
const DETAIL = "retained-docs:query:retained-doc:detail";
const tenantId = testTenantId(61);
const admin = createTestUser({ id: 61, tenantId, roles: ["Admin"] });
const provider = createInMemoryFileProvider();

let stack: TestStack;

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  stack = await setupTestStack({
    features: [createFilesFeature(), createDataRetentionFeature(), retainedDocsFeature],
    files: { storageProvider: provider },
  });
  await unsafeCreateEntityTable(stack.db, retainedDocEntity, "retained-doc");
  await unsafeCreateEntityTable(stack.db, tenantRetentionOverrideEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

async function upload(): Promise<string> {
  const fd = new FormData();
  fd.append("entityType", "retained-doc");
  fd.append("fieldName", "attachment");
  fd.append(
    "file",
    new File([Buffer.from("%PDF-1.4 minimal")], "doc.pdf", { type: "application/pdf" }),
  );
  const { body, contentType } = await buildMultipartBody(fd);
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await stack.jwt.sign(admin)}`,
      "Content-Type": contentType,
    },
    body,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

describe("user-data-rights recipe :: retention run removes a hardDelete entity's files", () => {
  test("after keepFor + 1 day the row, its bytes and its file_refs row are gone; the erasure is audited", async () => {
    const fileRefId = await upload();
    const created = await stack.http.writeOk<{ id: string }>(
      CREATE,
      { title: "contract", attachment: fileRefId },
      admin,
    );
    const [fileRef] = await selectMany<{ storageKey: string }>(stack.db, fileRefsTable, {
      id: fileRefId,
    });
    const storageKey = String(fileRef?.storageKey);
    expect(await provider.exists(storageKey)).toBe(true);

    const result = await runRetentionCleanup({
      db: stack.db,
      registry: stack.registry,
      tenantId,
      preloadedTenantPreset: null,
      now: getTemporal()
        .Now.instant()
        .add({ hours: 31 * 24 }),
      files: createFileContext(() => Promise.resolve(provider)),
    });

    expect(result.hardDeleted).toBe(1);
    expect(result.skipped).toEqual([]);
    expect(await provider.exists(storageKey)).toBe(false);
    expect(await selectMany(stack.db, fileRefsTable, { id: fileRefId })).toHaveLength(0);
    expect(await stack.http.queryOk(DETAIL, { id: created.id }, admin)).toBeNull();

    const forgotten = await selectMany(stack.db, eventsTable, { aggregateId: created.id });
    expect(forgotten.map((e) => (e as { type: string }).type)).toContain("retained-doc.forgotten");
  });
});
