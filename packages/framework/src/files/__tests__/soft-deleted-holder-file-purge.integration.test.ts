// A soft-deleted row still holds its file (a restore must find it). The per-tenant soft-delete
// cleanup removes bytes and fileRef together with the last holder, and moves the fileRef to a
// surviving holder otherwise.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  buildMultipartBody,
  patchFileInstanceofForBunTest,
  updateRowViaEventStore,
} from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { buildEntityTable } from "../../db/index.ts";
import { selectMany } from "../../db/query.ts";
import {
  createEntity,
  createFileField,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDeleteHandler,
  defineEntityDetailHandler,
  defineEntityRestoreHandler,
  defineFeature,
} from "../../engine/index.ts";
import { SOFT_DELETE_CLEANUP_JOB } from "../../engine/soft-delete-cleanup.ts";
import { runSeedWritesAt, SEED_MODE_ENV } from "../../event-store/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import { createInMemoryFileProvider } from "../in-memory-provider.ts";
import { createFilesFeature, fileRefsTable } from "../index.ts";

const docEntity = createEntity({
  name: "holder-doc",
  table: "read_holder_doc",
  softDelete: true,
  fields: {
    label: createTextField({ required: true, personal: false, reason: "test_fixture" }),
    cover: createFileField(),
  },
});

const docFeature = defineFeature("holder-probe", (r) => {
  r.entity(docEntity);
  const access = { access: { roles: ["Admin"] } };
  r.writeHandler(defineEntityCreateHandler("holder-doc", docEntity, access));
  r.writeHandler(defineEntityDeleteHandler("holder-doc", docEntity, access));
  r.writeHandler(defineEntityRestoreHandler("holder-doc", docEntity, access));
  r.queryHandler(
    defineEntityDetailHandler("holder-doc", docEntity, { access: { roles: ["Admin"] } }),
  );
});

const PDF = new TextEncoder().encode("%PDF-1.4 holder fixture");
const admin = TestUsers.admin;
const provider = createInMemoryFileProvider();
const previousSeedMode = process.env[SEED_MODE_ENV];
let stack: TestStack;

beforeAll(async () => {
  process.env[SEED_MODE_ENV] = "1";
  patchFileInstanceofForBunTest();
  stack = await setupTestStack({
    features: [createFilesFeature(), docFeature],
    files: { storageProvider: provider },
    jobs: { consumerLane: "worker", getActiveTenantIds: async () => [admin.tenantId] },
  });
});

afterAll(async () => {
  await stack.cleanup();
  if (previousSeedMode === undefined) delete process.env[SEED_MODE_ENV];
  else process.env[SEED_MODE_ENV] = previousSeedMode;
});

beforeEach(() => {
  for (const key of provider.keys()) void provider.delete(key);
});

async function uploadBoundToDoc(): Promise<string> {
  const form = new FormData();
  form.append("entityType", "holder-doc");
  form.append("fieldName", "cover");
  form.append("file", new File([Buffer.from(PDF)], "cover.pdf", { type: "application/pdf" }));
  const { body, contentType } = await buildMultipartBody(form);
  const token = await stack.jwt.sign(admin);
  const res = await atAge(520, async () =>
    stack.app.request("/api/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
      body,
    }),
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

function atAge<T>(ageDays: number, write: () => Promise<T>): Promise<T> {
  return runSeedWritesAt(Temporal.Now.instant().subtract({ hours: ageDays * 24 }), write);
}

// Seed mode needs a stream's events in ascending time, so rows are created before they are deleted.
async function createDoc(label: string, cover?: string): Promise<string> {
  const created = await atAge(500, () =>
    stack.http.writeOk<{ id: string }>(
      "holder-probe:write:holder-doc:create",
      { label, ...(cover === undefined ? {} : { cover }) },
      admin,
    ),
  );
  return created.id;
}

function softDeleteDoc(id: string, ageDays: number): Promise<unknown> {
  const deletedAt = Temporal.Now.instant().subtract({ hours: ageDays * 24 });
  return runSeedWritesAt(deletedAt, () =>
    stack.http.writeOk("holder-probe:write:holder-doc:delete", { id }, admin),
  );
}

async function runCleanup(): Promise<void> {
  const jobRunner = stack.jobRunner;
  if (!jobRunner) throw new Error("setupTestStack({ jobs }) did not wire a jobRunner");
  await jobRunner.dispatch(SOFT_DELETE_CLEANUP_JOB, {});
  await stack.drainJobs();
}

async function fileRefRow(id: string) {
  const [row] = await selectMany<Record<string, unknown>>(stack.db, fileRefsTable, { id });
  return row;
}

describe("soft-delete cleanup of a row's file", () => {
  test("an expired soft-deleted row loses its bytes and fileRef with it", async () => {
    const fileRefId = await uploadBoundToDoc();
    const docId = await createDoc("lone holder", fileRefId);
    const storageKey = (await fileRefRow(fileRefId))?.["storageKey"] as string;
    expect(provider.keys()).toContain(storageKey);
    await softDeleteDoc(docId, 400);

    await runCleanup();

    expect(await selectMany(stack.db, buildEntityTable(docEntity), { id: docId })).toEqual([]);
    expect(provider.keys()).not.toContain(storageKey);
    expect(await fileRefRow(fileRefId)).toBeUndefined();
  });

  test("a soft-deleted row inside the grace period keeps its file", async () => {
    const fileRefId = await uploadBoundToDoc();
    const docId = await createDoc("fresh", fileRefId);
    const storageKey = (await fileRefRow(fileRefId))?.["storageKey"] as string;
    await softDeleteDoc(docId, 1);

    await runCleanup();

    expect(provider.keys()).toContain(storageKey);
    expect(await fileRefRow(fileRefId)).toBeDefined();
  });

  test("the file survives an expired holder while another soft-deleted holder remains and is rebound to it", async () => {
    const fileRefId = await uploadBoundToDoc();
    const expiredId = await createDoc("expired holder", fileRefId);
    const remainingId = await createDoc("remaining holder");
    await atAge(450, () =>
      updateRowViaEventStore(
        stack.db,
        { table: buildEntityTable(docEntity), entity: docEntity, entityName: docEntity.name },
        { id: remainingId },
        { cover: fileRefId },
        { tenantId: admin.tenantId },
      ),
    );
    const storageKey = (await fileRefRow(fileRefId))?.["storageKey"] as string;
    await softDeleteDoc(expiredId, 400);
    await softDeleteDoc(remainingId, 1);

    await runCleanup();

    expect(await selectMany(stack.db, buildEntityTable(docEntity), { id: expiredId })).toEqual([]);
    expect(provider.keys()).toContain(storageKey);
    expect(await fileRefRow(fileRefId)).toMatchObject({
      entityType: "holder-doc",
      entityId: remainingId,
      fieldName: "cover",
    });
  });
});
