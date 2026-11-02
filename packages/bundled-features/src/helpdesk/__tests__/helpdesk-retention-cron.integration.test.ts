// The system tenant has no tenant row, so the perTenant fan-out never reaches it on its own. These
// tests run the real maintenance jobs through the job runner and the default active-tenant source,
// the way production does, and check that helpdesk data and its files are still cleaned up.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { type SessionUser, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import {
  createTenantFileContext,
  fileRefsTable,
  fileUploadLedgerTable,
  withUploadLedger,
} from "@cosmicdrift/kumiko-framework/files";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import {
  createManualClock,
  patchFileInstanceofForBunTest,
  resetPiiSubjectKmsForTests,
  resetTestTables,
} from "@cosmicdrift/kumiko-testing/helpers";
import { clearStorage, listKeys } from "../../file-provider-inmemory/feature.ts";
import { TenantHandlers } from "../../tenant/web/constants.ts";
import { HelpdeskHandlers, HelpdeskScreens } from "../web/constants.ts";
import {
  loadReplies,
  loadRequests,
  postSubmit,
  seedAdmin,
  seedReporter,
  submitBody,
  uploadFormFile,
} from "./helpdesk-helpers.ts";
import {
  createHelpdeskTestStack,
  type HelpdeskTestStack,
  resetHelpdeskTestState,
} from "./helpdesk-test-stack.ts";

const RETENTION_JOB = "data-retention:job:retention-cleanup";
const SWEEP_UPLOADS_JOB = "files:job:sweep-orphaned-uploads";
const SOFT_DELETE_CLEANUP_JOB = "soft-delete:job:cleanup";
const SOFT_DELETE_GRACE_DAYS = 30;
const PDF_BYTES = new TextEncoder().encode("%PDF-1.4 retention cron");
const DAY_HOURS = 24;

const clockStart = getTemporal().Now.instant();
const clock = createManualClock(clockStart);

let ctx: HelpdeskTestStack;
let admin: SessionUser;

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  resetPiiSubjectKmsForTests();
  ctx = await createHelpdeskTestStack({}, { clock, jobConsumer: true });
});

afterAll(async () => {
  ctx.telegram.stop();
  await ctx.stack.cleanup();
});

beforeEach(async () => {
  clock.set(clockStart);
  await resetHelpdeskTestState(ctx);
  clearStorage(SYSTEM_TENANT_ID);
  await resetTestTables(ctx.stack.db, [fileRefsTable, fileUploadLedgerTable]);
  admin = await seedAdmin(ctx.stack, "admin1@example.com");
  await ctx.stack.http.writeOk(
    "config:write:set",
    { key: "file-foundation:config:provider", value: "inmemory", scope: "system" },
    admin,
  );
});

async function dispatchJob(job: string): Promise<void> {
  await ctx.stack.jobRunner?.dispatch(job, {});
  await ctx.stack.drainJobs();
}

async function systemFileRefCount(): Promise<number> {
  return (await selectMany(ctx.stack.db, fileRefsTable, { tenantId: SYSTEM_TENANT_ID })).length;
}

// An ordinary tenant keeps the fan-out non-empty, so a fix that only works for an empty tenant list
// cannot pass.
async function seedOrdinaryTenant(): Promise<void> {
  await ctx.stack.http.writeOk(
    TenantHandlers.create,
    { id: crypto.randomUUID(), key: "acme", name: "ACME Corp" },
    admin,
  );
}

// One anonymous website request answered with a file, one in-app report carrying a file.
async function seedHelpdeskDataWithFiles(): Promise<void> {
  const res = await postSubmit(
    ctx.stack,
    await submitBody(ctx.stack, { email: "ada@example.com" }),
  );
  expect(res.status).toBe(200);
  const [anonymous] = await loadRequests(ctx.stack);
  const replyUpload = await uploadFormFile(ctx.stack, admin, HelpdeskScreens.replyMail, {
    name: "answer.pdf",
    type: "application/pdf",
    bytes: PDF_BYTES,
  });
  await ctx.stack.http.writeOk(
    HelpdeskHandlers.reply,
    { requestId: String(anonymous?.["id"]), message: "See attached.", fileIds: [replyUpload] },
    admin,
  );

  const reporter = await seedReporter(ctx.stack, "rita@example.com");
  const reportUpload = await uploadFormFile(ctx.stack, reporter, HelpdeskScreens.report, {
    name: "log.pdf",
    type: "application/pdf",
    bytes: PDF_BYTES,
  });
  await ctx.stack.http.writeOk(
    HelpdeskHandlers.report,
    { kind: "bug", subject: "Crash", message: "See the log.", fileIds: [reportUpload] },
    reporter,
  );
}

describe("helpdesk retention through the real maintenance cron", () => {
  test("requests inside the retention period survive the nightly cleanup", async () => {
    await seedOrdinaryTenant();
    await seedHelpdeskDataWithFiles();
    expect(await loadRequests(ctx.stack)).toHaveLength(2);

    clock.advance({ hours: 30 * DAY_HOURS });
    await dispatchJob(RETENTION_JOB);

    expect(await loadRequests(ctx.stack)).toHaveLength(2);
    expect(await loadReplies(ctx.stack)).toHaveLength(1);
    expect(listKeys(SYSTEM_TENANT_ID).length).toBeGreaterThan(0);
  });

  test("the nightly cleanup deletes expired requests, replies and their files in the system tenant", async () => {
    await seedOrdinaryTenant();
    await seedHelpdeskDataWithFiles();
    expect(await loadRequests(ctx.stack)).toHaveLength(2);
    expect(await loadReplies(ctx.stack)).toHaveLength(1);
    expect(await systemFileRefCount()).toBe(2);
    expect(listKeys(SYSTEM_TENANT_ID)).toHaveLength(2);

    clock.advance({ hours: 400 * DAY_HOURS });
    await dispatchJob(RETENTION_JOB);

    expect(await loadRequests(ctx.stack)).toHaveLength(0);
    expect(await loadReplies(ctx.stack)).toHaveLength(0);
    expect(await systemFileRefCount()).toBe(0);
    expect(listKeys(SYSTEM_TENANT_ID)).toHaveLength(0);
  });
});

describe("upload sweep in the system tenant through the real maintenance cron", () => {
  test("bytes that never got a file ref are swept after the grace period", async () => {
    await seedOrdinaryTenant();
    const files = createTenantFileContext(
      withUploadLedger(ctx.buildStorageProvider, ctx.stack.db, () => clock.now()),
      SYSTEM_TENANT_ID,
    );
    const orphanKey = `${SYSTEM_TENANT_ID}/helpdesk/orphan.pdf`;
    await files.writeUploadBytes(orphanKey, PDF_BYTES, "application/pdf");
    expect(listKeys(SYSTEM_TENANT_ID)).toEqual([orphanKey]);

    clock.advance({ hours: 2 });
    await dispatchJob(SWEEP_UPLOADS_JOB);
    expect(listKeys(SYSTEM_TENANT_ID)).toEqual([orphanKey]);

    clock.advance({ hours: 30 });
    await dispatchJob(SWEEP_UPLOADS_JOB);
    expect(listKeys(SYSTEM_TENANT_ID)).toHaveLength(0);
    expect(
      await selectMany(ctx.stack.db, fileUploadLedgerTable, { tenantId: SYSTEM_TENANT_ID }),
    ).toHaveLength(0);
  });
});

describe("soft-delete cleanup in the system tenant through the real maintenance cron", () => {
  test("a system-tenant file ref soft-deleted beyond the grace period is purged with its bytes", async () => {
    await seedOrdinaryTenant();
    const fileRefId = await uploadFormFile(ctx.stack, admin, HelpdeskScreens.replyMail, {
      name: "old.pdf",
      type: "application/pdf",
      bytes: PDF_BYTES,
    });
    expect(listKeys(SYSTEM_TENANT_ID)).toHaveLength(1);

    const token = await ctx.stack.jwt.sign(admin);
    const deleted = await ctx.stack.app.request(`/api/files/${fileRefId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(deleted.status).toBeLessThan(300);
    expect(await systemFileRefCount()).toBe(1);

    clock.advance({ hours: (SOFT_DELETE_GRACE_DAYS + 10) * DAY_HOURS });
    await dispatchJob(SOFT_DELETE_CLEANUP_JOB);

    expect(await systemFileRefCount()).toBe(0);
    expect(listKeys(SYSTEM_TENANT_ID)).toHaveLength(0);
  });
});
