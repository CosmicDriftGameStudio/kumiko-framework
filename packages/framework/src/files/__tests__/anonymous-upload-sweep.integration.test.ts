// The files maintenance job soft-deletes anonymous uploads that no record bound, with no opt-in.
// Real uploads over HTTP, time injected; fileRef rows carry the database's insert time, so the
// injected clock moves the sweep's cutoff relative to rows uploaded in beforeAll.

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
import * as z from "zod";
import { createEventStoreExecutor } from "../../db/event-store-executor.ts";
import { selectMany } from "../../db/query.ts";
import { buildEntityTable } from "../../db/table-builder.ts";
import { createEntity, createFileField, defineFeature } from "../../engine/index.ts";
import { createTestUser, testTenantId } from "../../seeding/seed-users.ts";
import { createFilesFeature } from "../feature.ts";
import { fileRefsTable } from "../file-ref-table.ts";
import { createInMemoryFileProvider } from "../in-memory-provider.ts";

const SWEEP_JOB = "files:job:sweep-orphaned-uploads";
const PDF_BYTES = new TextEncoder().encode("%PDF-1.4 anonymous sweep probe");

const photoEntity = createEntity({
  table: "anonymous_sweep_photos",
  fields: { shot: createFileField({ anonymousUpload: true, accept: ["pdf"] }) },
});
const photoTable = buildEntityTable("photo", photoEntity);
const photoPayload = z.object({ shot: z.string().optional() });

const probeFeature = defineFeature("sweepprobe", (r) => {
  r.entity({ name: "photo", ...photoEntity });
  r.writeHandler({
    name: "create-photo",
    schema: photoPayload,
    access: { roles: ["anonymous", "Admin"], personalData: "public-intake" },
    handler: (event, ctx) =>
      createEventStoreExecutor(photoTable, photoEntity, { entityName: "photo" }).create(
        event.payload,
        event.user,
        ctx.db,
      ),
  });
});

const tenant = testTenantId(1);
const admin = createTestUser({ id: 1, tenantId: tenant, roles: ["Admin"] });
const clock = createManualClock(Temporal.Now.instant());

type Upload = { readonly id: string; readonly handle: string };

async function upload(stack: TestStack, user?: typeof admin): Promise<Upload> {
  const fd = new FormData();
  fd.append("entityType", "photo");
  fd.append("fieldName", "shot");
  fd.append("file", new File([Buffer.from(PDF_BYTES)], "doc.pdf", { type: "application/pdf" }));
  const { body, contentType } = await buildMultipartBody(fd);
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      ...(user && { Authorization: `Bearer ${await stack.jwt.sign(user)}` }),
    },
    body,
  });
  expect(res.status).toBe(201);
  return (await res.json()) as Upload;
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

describe("createFilesFeature without pendingUploadGraceHours", () => {
  let stack: TestStack;
  let unbound: Upload;
  let bound: Upload;
  let signedIn: Upload;
  const uploadedAt = Temporal.Now.instant();

  beforeAll(async () => {
    patchFileInstanceofForBunTest();
    clock.set(uploadedAt);
    stack = await setupTestStack({
      features: [createFilesFeature(), probeFeature],
      files: { storageProvider: createInMemoryFileProvider() },
      anonymousAccess: { defaultTenantId: tenant },
      extraContext: { clock },
      jobs: { consumerLane: "worker", getActiveTenantIds: async () => [tenant] },
    });
    await unsafeCreateEntityTable(stack.db, photoEntity, "photo");
    unbound = await upload(stack);
    bound = await upload(stack);
    signedIn = await upload(stack, admin);
    const saved = await stack.http.raw("POST", "/api/write", {
      type: "sweepprobe:write:create-photo",
      payload: { shot: bound.handle },
    });
    expect(saved.status).toBe(200);
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("an anonymous upload younger than the grace period stays", async () => {
    clock.set(uploadedAt.add({ hours: 23 }));
    await runSweep(stack);

    expect(await isDeleted(stack, unbound.id)).toBe(false);
  });

  test("past 24 hours only the anonymous upload that no record bound is soft-deleted", async () => {
    clock.set(uploadedAt.add({ hours: 25 }));
    await runSweep(stack);

    expect(await isDeleted(stack, unbound.id)).toBe(true);
    expect(await isDeleted(stack, bound.id)).toBe(false);
    expect(await isDeleted(stack, signedIn.id)).toBe(false);
  });
});

describe("anonymousUploadGraceHours validation", () => {
  test.each([0, 1.5])("%p is refused", (hours) => {
    expect(() => createFilesFeature({ anonymousUploadGraceHours: hours })).toThrow();
  });
});
