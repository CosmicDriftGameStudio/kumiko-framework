// createFilesFeature({ pendingUploadGraceHours }): the hourly sweep soft-deletes uploads for a
// form field that never got their record. Real uploads over HTTP, time injected.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  buildMultipartBody,
  createManualClock,
  patchFileInstanceofForBunTest,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { selectMany } from "../../db/query.ts";
import {
  createEntity,
  createFileField,
  createTextField,
  defineFeature,
} from "../../engine/index.ts";
import { createTestUser, testTenantId } from "../../seeding/seed-users.ts";
import { createFilesFeature } from "../feature.ts";
import { fileRefsTable } from "../file-ref-table.ts";
import { createInMemoryFileProvider } from "../in-memory-provider.ts";

const GRACE_HOURS = 6;
const SWEEP_JOB = "files:job:sweep-orphaned-uploads";
const PDF_BYTES = new TextEncoder().encode("%PDF-1.4 pending");

const dossierEntity = createEntity({
  table: "pending_sweep_dossiers",
  fields: {
    title: createTextField({ required: true, personal: false, reason: "test_fixture" }),
    scan: createFileField(),
  },
});

const dossierFeature = defineFeature("pending-sweep", (r) => {
  r.crud("dossier", dossierEntity, {
    write: { access: { roles: ["Admin"] } },
    read: { access: { roles: ["Admin"] } },
  });
});

const tenant = testTenantId(1);
const admin = createTestUser({ id: 1, tenantId: tenant, roles: ["Admin"] });
const clock = createManualClock(Temporal.Now.instant());

async function bootStack(pendingUploadGraceHours: number | undefined): Promise<TestStack> {
  const stack = await setupTestStack({
    features: [
      createFilesFeature(pendingUploadGraceHours === undefined ? {} : { pendingUploadGraceHours }),
      dossierFeature,
    ],
    files: { storageProvider: createInMemoryFileProvider() },
    extraContext: { clock },
    jobs: { consumerLane: "worker", getActiveTenantIds: async () => [tenant] },
  });
  await unsafeCreateEntityTable(stack.db, dossierEntity, "dossier");
  return stack;
}

async function upload(stack: TestStack, fields: Record<string, string>): Promise<string> {
  const token = await stack.jwt.sign(admin);
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.append(key, value);
  fd.append("file", new File([Buffer.from(PDF_BYTES)], "scan.pdf", { type: "application/pdf" }));
  const { body, contentType } = await buildMultipartBody(fd);
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function runSweep(stack: TestStack): Promise<void> {
  if (!stack.jobRunner) throw new Error("setupTestStack({ jobs }) did not wire a jobRunner");
  await stack.jobRunner.dispatch(SWEEP_JOB, {});
  await stack.drainJobs();
}

async function isDeleted(stack: TestStack, id: string): Promise<unknown> {
  const [row] = await selectMany(stack.db, fileRefsTable, { id });
  return row?.["isDeleted"];
}

// fileRef rows carry the database's insert time, so the injected clock moves the sweep's cutoff
// across rows uploaded together instead of aging single rows.
describe("pendingUploadGraceHours set", () => {
  let stack: TestStack;
  let pending: string;
  let bound: string;
  let unclaimed: string;
  const uploadedAt = Temporal.Now.instant();

  beforeAll(async () => {
    patchFileInstanceofForBunTest();
    clock.set(uploadedAt);
    stack = await bootStack(GRACE_HOURS);
    pending = await upload(stack, { entityType: "dossier", fieldName: "scan" });
    bound = await upload(stack, { entityType: "dossier", fieldName: "scan" });
    await stack.http.writeOk(
      "pending-sweep:write:dossier:create",
      { title: "D", scan: bound },
      admin,
    );
    unclaimed = await upload(stack, {});
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("a pending upload younger than the grace period stays", async () => {
    clock.set(uploadedAt.add({ hours: GRACE_HOURS - 1 }));
    await runSweep(stack);

    expect(await isDeleted(stack, pending)).toBe(false);
  });

  test("past the grace period only the upload for a form field without its record is soft-deleted", async () => {
    clock.set(uploadedAt.add({ hours: GRACE_HOURS + 1 }));
    await runSweep(stack);

    expect(await isDeleted(stack, pending)).toBe(true);
    expect(await isDeleted(stack, bound)).toBe(false);
    expect(await isDeleted(stack, unclaimed)).toBe(false);
  });
});

describe("pendingUploadGraceHours not set", () => {
  test("the sweep keeps every pending upload", async () => {
    clock.set(Temporal.Now.instant());
    const stack = await bootStack(undefined);
    try {
      const pending = await upload(stack, { entityType: "dossier", fieldName: "scan" });
      clock.advance({ hours: 24 * 30 });
      await runSweep(stack);
      expect(await isDeleted(stack, pending)).toBe(false);
    } finally {
      await stack.cleanup();
    }
  });
});
