import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  createEventStoreExecutor,
  createTenantDb,
  fetchOne,
  selectMany,
} from "@cosmicdrift/kumiko-framework/db";
import { type SessionUser, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { fileRefsTable } from "@cosmicdrift/kumiko-framework/files";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import {
  patchFileInstanceofForBunTest,
  resetPiiSubjectKmsForTests,
  resetTestTables,
} from "@cosmicdrift/kumiko-testing/helpers";
import { runRetentionCleanup } from "../../data-retention/run-retention-cleanup.ts";
import { fileContextFromResolver } from "../../file-foundation/index.ts";
import { clearStorage, listKeys } from "../../file-provider-inmemory/feature.ts";
import { USER_STATUS, userEntity, userTable } from "../../user/index.ts";
import { runForgetCleanup } from "../../user-data-rights/run-forget-cleanup.ts";
import { runUserExport } from "../../user-data-rights/run-user-export.ts";
import { HelpdeskHandlers, HelpdeskQueries, HelpdeskScreens } from "../web/constants.ts";
import {
  downloadFile,
  loadRequests,
  seedAdmin,
  seedReporter,
  uploadFormFile,
} from "./helpdesk-helpers.ts";
import {
  createHelpdeskTestStack,
  type HelpdeskTestStack,
  resetHelpdeskTestState,
} from "./helpdesk-test-stack.ts";

const userExecutor = createEventStoreExecutor(userTable, userEntity, { entityName: "user" });
const PDF_BYTES = new TextEncoder().encode("%PDF-1.4 erasure");

let ctx: HelpdeskTestStack;
let admin: SessionUser;
let reporter: SessionUser;

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  resetPiiSubjectKmsForTests();
  ctx = await createHelpdeskTestStack();
});

afterAll(async () => {
  ctx.telegram.stop();
  await ctx.stack.cleanup();
});

beforeEach(async () => {
  await resetHelpdeskTestState(ctx);
  clearStorage(SYSTEM_TENANT_ID);
  await resetTestTables(ctx.stack.db, [fileRefsTable]);
  admin = await seedAdmin(ctx.stack, "admin1@example.com");
  await ctx.stack.http.writeOk(
    "config:write:set",
    { key: "file-foundation:config:provider", value: "inmemory", scope: "system" },
    admin,
  );
  reporter = await seedReporter(ctx.stack, "gone@example.com");
});

async function reportWithFile(): Promise<string> {
  const uploadId = await uploadFormFile(ctx.stack, reporter, HelpdeskScreens.report, {
    name: "log.pdf",
    type: "application/pdf",
    bytes: PDF_BYTES,
  });
  await ctx.stack.http.writeOk(
    HelpdeskHandlers.report,
    { kind: "bug", subject: "Crash", message: "See the log.", fileIds: [uploadId] },
    reporter,
  );
  const [row] = await loadRequests(ctx.stack);
  const detail = await ctx.stack.http.queryOk<{ fileIds: string[] }>(
    HelpdeskQueries.requestDetail,
    { id: String(row?.["id"]) },
    admin,
  );
  const [stored] = detail.fileIds;
  if (stored === undefined) throw new Error("request holds no file");
  return stored;
}

async function requestDeletion(userId: string): Promise<void> {
  const row = await fetchOne(ctx.stack.db, userTable, { id: userId });
  if (!row) throw new Error("user missing");
  const marked = await userExecutor.update(
    {
      id: userId,
      version: Number(row["version"]),
      changes: {
        status: USER_STATUS.DeletionRequested,
        gracePeriodEnd: Temporal.Now.instant().subtract({ minutes: 1 }),
      },
    },
    TestUsers.systemAdmin,
    createTenantDb({
      db: ctx.stack.db,
      tenantId: SYSTEM_TENANT_ID,
      mode: "system",
      reason: "test reads system-tenant helpdesk rows",
    }),
  );
  expect(marked.isSuccess).toBe(true);
}

describe("helpdesk attachments are erased with their request", () => {
  test("export names the attachment; forget removes the file ref and its bytes", async () => {
    const storedId = await reportWithFile();
    expect((await downloadFile(ctx.stack, admin, storedId)).status).toBe(200);
    expect(listKeys(SYSTEM_TENANT_ID).length).toBeGreaterThan(0);

    const bundle = await runUserExport({
      db: ctx.stack.db,
      registry: ctx.stack.registry,
      userId: reporter.id,
      now: Temporal.Now.instant(),
    });
    const snippet = bundle.tenants
      .flatMap((section) => section.entities)
      .find((entity) => entity.entity === "helpdesk-request");
    expect(JSON.stringify(snippet?.rows[0])).toContain("log.pdf");

    await requestDeletion(reporter.id);

    const result = await runForgetCleanup({
      db: ctx.stack.db,
      registry: ctx.stack.registry,
      now: Temporal.Now.instant(),
      buildStorageProvider: ctx.buildStorageProvider,
    });
    expect(result.errors).toHaveLength(0);
    expect(await loadRequests(ctx.stack)).toHaveLength(0);
    expect((await downloadFile(ctx.stack, admin, storedId)).status).toBe(404);
    expect(listKeys(SYSTEM_TENANT_ID)).toHaveLength(0);
  });

  test("forget also removes a file an admin attached to a reply", async () => {
    await ctx.stack.http.writeOk(
      HelpdeskHandlers.report,
      { kind: "bug", subject: "Crash", message: "No file." },
      reporter,
    );
    const [request] = await loadRequests(ctx.stack);
    const uploadId = await uploadFormFile(ctx.stack, admin, HelpdeskScreens.reply, {
      name: "answer.pdf",
      type: "application/pdf",
      bytes: PDF_BYTES,
    });
    await ctx.stack.http.writeOk(
      HelpdeskHandlers.reply,
      { requestId: String(request?.["id"]), message: "See attached.", fileIds: [uploadId] },
      admin,
    );
    expect(listKeys(SYSTEM_TENANT_ID).length).toBeGreaterThan(0);

    await requestDeletion(reporter.id);
    const result = await runForgetCleanup({
      db: ctx.stack.db,
      registry: ctx.stack.registry,
      now: Temporal.Now.instant(),
      buildStorageProvider: ctx.buildStorageProvider,
    });
    expect(result.errors).toHaveLength(0);
    expect(listKeys(SYSTEM_TENANT_ID)).toHaveLength(0);
  });

  test("the retention sweep removes the attachment of an expired request", async () => {
    const storedId = await reportWithFile();
    const result = await runRetentionCleanup({
      db: ctx.stack.db,
      registry: ctx.stack.registry,
      tenantId: SYSTEM_TENANT_ID,
      preloadedTenantPreset: null,
      files: fileContextFromResolver(ctx.buildStorageProvider, SYSTEM_TENANT_ID),
      now: Temporal.Now.instant().add({ hours: 24 * 400 }),
    });
    expect(result.hardDeleted).toBeGreaterThanOrEqual(1);
    expect(await loadRequests(ctx.stack)).toHaveLength(0);
    expect((await downloadFile(ctx.stack, admin, storedId)).status).toBe(404);
    expect(listKeys(SYSTEM_TENANT_ID)).toHaveLength(0);
    expect(
      await selectMany(ctx.stack.db, fileRefsTable, { tenantId: SYSTEM_TENANT_ID }),
    ).toHaveLength(0);
  });
});
