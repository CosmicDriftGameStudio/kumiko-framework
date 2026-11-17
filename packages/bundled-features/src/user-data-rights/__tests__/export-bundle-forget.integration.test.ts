// An export ZIP holds the user's profile, email, name and files, so it is personal data: the
// Art. 17 forget run must delete it and fail closed like the file binaries when storage is down.
// No user-data-rights-defaults feature is mounted, proving the deletion does not depend on it.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { fetchOne, selectMany } from "@cosmicdrift/kumiko-framework/db";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createFilesFeature,
  createInMemoryFileProvider,
  fileRefsTable,
  type InMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { resetTestTables, seedRowViaEventStore } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createComplianceProfilesFeature } from "../../compliance-profiles/index.ts";
import { createConfigAccessorFactory } from "../../config/feature.ts";
import {
  configValuesTable,
  createConfigFeature,
  createConfigResolver,
} from "../../config/index.ts";
import { createDataRetentionFeature } from "../../data-retention/index.ts";
import { createFileFoundationFeature } from "../../file-foundation/index.ts";
import { createSessionsFeature } from "../../sessions/index.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { createUserFeature, USER_STATUS, userTable } from "../../user/index.ts";
import { createUserDataRightsFeature } from "../feature.ts";
import { updateUserLifecycle } from "../lib/update-user-lifecycle.ts";
import { EXPORT_JOB_ERROR_USER_ERASED, runExportJobs } from "../run-export-jobs.ts";
import { downloadAttemptsTable } from "../schema/download-attempt.ts";
import { exportDownloadTokensTable } from "../schema/download-token.ts";
import { EXPORT_JOB_STATUS, exportJobsTable } from "../schema/export-job.ts";
import {
  UserDataRightsHandlers,
  UserDataRightsJobs,
  UserDataRightsQueries,
} from "../web/constants.ts";
import { createTestFileProviderFeature, nowInstant, pastInstant } from "./forget-test-helpers.ts";

const TENANT = "00000000-0000-4000-8000-0000000009e1";
const USER_ID = "00000000-0000-4000-8000-0000000009e2";

type CleanupResult = {
  readonly processedUserIds: readonly string[];
  readonly errorCount: number;
  readonly errors: ReadonlyArray<{
    readonly userId: string;
    readonly entityName: string;
    readonly tenantId: string;
  }>;
};

type JobRow = {
  readonly status: string;
  readonly downloadStorageKey: string | null;
  readonly errorMessage: string | null;
  readonly startedAt: unknown;
};

let stack: TestStack;
let base: InMemoryFileProvider;
let failDeletes = false;
let provider: InMemoryFileProvider;
let beforeExportWrite: (() => Promise<void>) | null = null;

beforeAll(async () => {
  base = createInMemoryFileProvider();
  provider = {
    ...base,
    async writeStream(key, stream, options) {
      const hook = beforeExportWrite;
      beforeExportWrite = null;
      if (hook && key.startsWith("exports/")) await hook();
      return base.writeStream(key, stream, options);
    },
    async delete(key) {
      if (failDeletes) throw new Error("storage unavailable (test)");
      return base.delete(key);
    },
  };
  const configResolver = createConfigResolver({
    appOverrides: new Map([["file-foundation:config:provider", "test"]]),
  });
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createUserFeature(),
      createFilesFeature(),
      createFileFoundationFeature(),
      createTestFileProviderFeature(provider, "test"),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createAuthFoundationFeature(),
      createSessionsFeature(),
      createUserDataRightsFeature(),
    ],
    extraContext: ({ registry }) => ({
      configResolver,
      configAccessorFactory: createConfigAccessorFactory(registry, configResolver),
    }),
    jobs: { consumerLane: "worker" },
  });
  await unsafePushTables(stack.db, { configValuesTable, fileRefsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  failDeletes = false;
  beforeExportWrite = null;
  base.clear();
  await resetTestTables(stack.db, [
    exportJobsTable,
    exportDownloadTokensTable,
    userTable,
    tenantMembershipsTable,
    eventsTable,
  ]);
  await seedRowViaEventStore(stack.db, userTable, {
    id: USER_ID,
    email: "export-forget@example.test",
    passwordHash: "hashed",
    displayName: "Export Forget",
    locale: "en",
    emailVerified: true,
    roles: '["Member"]',
    status: USER_STATUS.Active,
  });
  await seedRowViaEventStore(stack.db, tenantMembershipsTable, {
    tenantId: TENANT,
    userId: USER_ID,
    roles: '["Member"]',
  });
});

async function readJob(jobId: string): Promise<JobRow | undefined> {
  return fetchOne<JobRow>(stack.db, exportJobsTable, { id: jobId });
}

async function exportedBundle(userId: string): Promise<{ jobId: string; key: string }> {
  const { jobId } = await stack.http.writeOk<{ jobId: string }>(
    UserDataRightsHandlers.requestExport,
    {},
    { id: userId, tenantId: TENANT, roles: ["Member"] },
  );
  await stack.drainJobs();
  const job = await readJob(jobId);
  expect(job?.status).toBe(EXPORT_JOB_STATUS.Done);
  const key = job?.downloadStorageKey;
  if (!key) throw new Error("export job finished without a download storage key");
  expect(await base.exists(key)).toBe(true);
  return { jobId, key };
}

async function dueForDeletion(userId: string): Promise<void> {
  await updateUserLifecycle(stack.db, userId, {
    status: USER_STATUS.DeletionRequested,
    gracePeriodEnd: pastInstant(),
  });
}

async function userStatus(userId: string): Promise<string | undefined> {
  return (await fetchOne<{ status: string }>(stack.db, userTable, { id: userId }))?.status;
}

describe("forget run deletes the user's export ZIP", () => {
  test("cron forget deletes the user's export ZIP and clears its download key", async () => {
    const { jobId, key } = await exportedBundle(USER_ID);
    await dueForDeletion(USER_ID);

    await stack.jobRunner?.dispatch(UserDataRightsJobs.runForgetCleanup, {});
    await stack.drainJobs();

    expect(await userStatus(USER_ID)).toBe(USER_STATUS.Deleted);
    expect(await base.exists(key)).toBe(false);
    expect(base.keys().filter((k) => k.includes("exports/"))).toEqual([]);
    expect((await readJob(jobId))?.downloadStorageKey).toBeNull();
  });

  test("failed ZIP delete keeps the user DeletionRequested and the bundle in place, the next run converges", async () => {
    const { jobId, key } = await exportedBundle(USER_ID);
    await dueForDeletion(USER_ID);

    failDeletes = true;
    const failed = await stack.http.writeOk<CleanupResult>(
      UserDataRightsHandlers.runForgetCleanup,
      {},
      TestUsers.systemAdmin,
    );
    expect(failed.processedUserIds).toEqual([]);
    expect(failed.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: USER_ID, entityName: "export-job", tenantId: TENANT }),
      ]),
    );
    expect(await userStatus(USER_ID)).toBe(USER_STATUS.DeletionRequested);
    expect(await base.exists(key)).toBe(true);
    expect((await readJob(jobId))?.downloadStorageKey).toBe(key);

    failDeletes = false;
    const retried = await stack.http.writeOk<CleanupResult>(
      UserDataRightsHandlers.runForgetCleanup,
      {},
      TestUsers.systemAdmin,
    );
    expect(retried.processedUserIds).toContain(USER_ID);
    expect(retried.errorCount).toBe(0);
    expect(await base.exists(key)).toBe(false);
    expect((await readJob(jobId))?.downloadStorageKey).toBeNull();
    expect(await userStatus(USER_ID)).toBe(USER_STATUS.Deleted);
  });
});

async function requestExport(userId: string = USER_ID): Promise<string> {
  const { jobId } = await stack.http.writeOk<{ jobId: string }>(
    UserDataRightsHandlers.requestExport,
    {},
    { id: userId, tenantId: TENANT, roles: ["Member"] },
  );
  return jobId;
}

function runWorker(now: ReturnType<typeof nowInstant> = nowInstant()) {
  return runExportJobs({
    db: stack.db,
    registry: stack.registry,
    buildStorageProvider: () => Promise.resolve(provider),
    now,
  });
}

function runForgetCleanupAsAdmin(): Promise<CleanupResult> {
  return stack.http.writeOk<CleanupResult>(
    UserDataRightsHandlers.runForgetCleanup,
    {},
    TestUsers.systemAdmin,
  );
}

async function tokenRowsOfJob(jobId: string): Promise<number> {
  const rows = await selectMany(stack.db, exportDownloadTokensTable, { jobId });
  return rows.length;
}

async function attemptRowsOfJob(jobId: string): Promise<number> {
  return (await selectMany(stack.db, downloadAttemptsTable, { jobId })).length;
}

// Runs `before` ahead of every raw statement of the wrapped connection, so a test can inject a
// competing write at an exact point of the worker without a hook in the product code.
function interceptStatements<T extends object>(
  target: T,
  before: (sqlText: string) => Promise<void>,
): T {
  return new Proxy(target, {
    get(t, prop) {
      const value: unknown = Reflect.get(t, prop, t);
      const isObjectLike =
        (typeof value === "object" || typeof value === "function") && value !== null;
      if (prop === "$client" && isObjectLike) return interceptStatements(value, before);
      if (typeof value !== "function") return value;
      if (prop === "unsafe") {
        return async (sqlText: string, params?: unknown[]) => {
          await before(sqlText);
          return Reflect.apply(value, t, [sqlText, params]);
        };
      }
      return value.bind(t);
    },
  });
}

const exportKeys = (): string[] => base.keys().filter((k) => k.startsWith("exports/"));

describe("forget run and export worker with open export jobs", () => {
  test("a pending job at forget time is failed by the forget run and never built", async () => {
    const jobId = await requestExport();
    expect((await readJob(jobId))?.status).toBe(EXPORT_JOB_STATUS.Pending);
    await dueForDeletion(USER_ID);

    await runForgetCleanupAsAdmin();

    const afterForget = await readJob(jobId);
    expect(afterForget?.status).toBe(EXPORT_JOB_STATUS.Failed);
    expect(afterForget?.errorMessage).toBe(EXPORT_JOB_ERROR_USER_ERASED);

    await stack.drainJobs();

    expect(await userStatus(USER_ID)).toBe(USER_STATUS.Deleted);
    expect(exportKeys()).toEqual([]);
    expect(await tokenRowsOfJob(jobId)).toBe(0);
  });

  test("the worker refuses a job of an already erased user at the claim", async () => {
    const jobId = await requestExport();
    await updateUserLifecycle(stack.db, USER_ID, { status: USER_STATUS.Deleted });
    let hookRan = false;
    beforeExportWrite = async () => {
      hookRan = true;
    };

    const result = await runWorker();

    const job = await readJob(jobId);
    expect(job?.status).toBe(EXPORT_JOB_STATUS.Failed);
    expect(job?.errorMessage).toBe(EXPORT_JOB_ERROR_USER_ERASED);
    expect(job?.startedAt).toBeNull();
    expect(hookRan).toBe(false);
    expect(result.completedJobIds).toEqual([]);
    expect(result.failedJobIds).toEqual([]);
    expect(exportKeys()).toEqual([]);
    await stack.drainJobs();
  });

  test("a running job whose ZIP finishes after the forget run ends failed without token", async () => {
    const jobId = await requestExport();
    await dueForDeletion(USER_ID);
    let hookRan = false;
    let jobDuringWrite: JobRow | undefined;
    beforeExportWrite = async () => {
      hookRan = true;
      await runForgetCleanupAsAdmin();
      jobDuringWrite = await readJob(jobId);
    };

    const result = await runWorker();

    expect(hookRan).toBe(true);
    expect(jobDuringWrite?.status).toBe(EXPORT_JOB_STATUS.Failed);
    expect(jobDuringWrite?.errorMessage).toBe(EXPORT_JOB_ERROR_USER_ERASED);
    expect(jobDuringWrite?.downloadStorageKey).toBe(`exports/${TENANT}/${jobId}.zip`);
    expect(await userStatus(USER_ID)).toBe(USER_STATUS.Deleted);
    const job = await readJob(jobId);
    expect(job?.status).toBe(EXPORT_JOB_STATUS.Failed);
    expect(job?.errorMessage).toBe(EXPORT_JOB_ERROR_USER_ERASED);
    expect(result.tokenByJobId.size).toBe(0);
    expect(await tokenRowsOfJob(jobId)).toBe(0);
    expect(await base.exists(`exports/${TENANT}/${jobId}.zip`)).toBe(false);
    expect(job?.downloadStorageKey).toBeNull();
    await stack.drainJobs();
  });

  test("the check after writing catches an erasure no forget run saw", async () => {
    const jobId = await requestExport();
    beforeExportWrite = async () => {
      await updateUserLifecycle(stack.db, USER_ID, { status: USER_STATUS.Deleted });
    };

    const result = await runWorker();

    const job = await readJob(jobId);
    expect(job?.status).toBe(EXPORT_JOB_STATUS.Failed);
    expect(job?.errorMessage).toBe(EXPORT_JOB_ERROR_USER_ERASED);
    expect(result.completedJobIds).toEqual([]);
    expect(exportKeys()).toEqual([]);
    expect(await tokenRowsOfJob(jobId)).toBe(0);
    await stack.drainJobs();
  });

  test("a valid token of an erased user answers like an unknown token and leaves no audit row", async () => {
    const jobId = await requestExport();
    const result = await runWorker();
    const token = result.tokenByJobId.get(jobId);
    if (!token) throw new Error("export finished without a token");
    const positive = await stack.http.queryOk<{ url: string }>(
      UserDataRightsQueries.downloadByToken,
      { token },
      TestUsers.systemAdmin,
    );
    expect(positive.url).toStartWith(`memory://exports/${TENANT}/${jobId}.zip?expires=`);

    await updateUserLifecycle(stack.db, USER_ID, { status: USER_STATUS.Deleted });
    const attemptsBefore = await attemptRowsOfJob(jobId);

    const erased = await stack.http.queryErr(
      UserDataRightsQueries.downloadByToken,
      { token },
      TestUsers.systemAdmin,
    );
    const unknown = await stack.http.queryErr(
      UserDataRightsQueries.downloadByToken,
      { token: "not-a-real-token" },
      TestUsers.systemAdmin,
    );
    expect(erased.httpStatus).toBe(404);
    expect(erased.httpStatus).toBe(unknown.httpStatus);
    expect(erased.code).toBe("not_found");
    expect(erased.i18nKey).toBe("userDataRights.errors.download.notFound");
    expect(erased.code).toBe(unknown.code);
    expect(erased.i18nKey).toBe(unknown.i18nKey);
    expect(await attemptRowsOfJob(jobId)).toBe(attemptsBefore);
    await stack.drainJobs();
  });

  test("an expired token of an erased user answers like an unknown token and leaves no audit row", async () => {
    const jobId = await requestExport();
    const longAgo = getTemporal().Instant.fromEpochMilliseconds(Date.now() - 30 * 24 * 3600_000);
    const result = await runWorker(longAgo);
    const token = result.tokenByJobId.get(jobId);
    if (!token) throw new Error("export finished without a token");

    const expired = await stack.http.queryErr(
      UserDataRightsQueries.downloadByToken,
      { token },
      TestUsers.systemAdmin,
    );
    expect(expired.i18nKey).toBe("userDataRights.errors.download.expired");

    await updateUserLifecycle(stack.db, USER_ID, { status: USER_STATUS.Deleted });
    const attemptsBefore = await attemptRowsOfJob(jobId);

    const erased = await stack.http.queryErr(
      UserDataRightsQueries.downloadByToken,
      { token },
      TestUsers.systemAdmin,
    );
    const unknown = await stack.http.queryErr(
      UserDataRightsQueries.downloadByToken,
      { token: "not-a-real-token" },
      TestUsers.systemAdmin,
    );
    expect(erased.httpStatus).toBe(unknown.httpStatus);
    expect(erased.code).toBe(unknown.code);
    expect(erased.i18nKey).toBe("userDataRights.errors.download.notFound");
    expect(await attemptRowsOfJob(jobId)).toBe(attemptsBefore);
    await stack.drainJobs();
  });

  test("the cleanup pass removes the bundle of an erased user at once, before expiresAt", async () => {
    const { jobId, key } = await exportedBundle(USER_ID);
    const job = await fetchOne<{ expiresAt: { epochMilliseconds: number } }>(
      stack.db,
      exportJobsTable,
      { id: jobId },
    );
    expect(job?.expiresAt.epochMilliseconds).toBeGreaterThan(Date.now());
    await updateUserLifecycle(stack.db, USER_ID, { status: USER_STATUS.Deleted });

    const result = await runWorker();

    expect(result.cleanedJobIds).toContain(jobId);
    expect(await base.exists(key)).toBe(false);
    expect((await readJob(jobId))?.downloadStorageKey).toBeNull();
  });

  test("a forget run landing before the done flip ends the job erased, expires the token and sends no mail", async () => {
    const jobId = await requestExport();
    await dueForDeletion(USER_ID);
    let armed = true;
    const db = interceptStatements(stack.db, async (sqlText) => {
      if (!armed || !sqlText.includes("read_export_download_tokens")) return;
      armed = false;
      await runForgetCleanupAsAdmin();
    });
    const now = nowInstant();
    const mails: string[] = [];

    const result = await runExportJobs({
      db,
      registry: stack.registry,
      buildStorageProvider: () => Promise.resolve(provider),
      now,
      appExportDownloadUrl: "https://app.example.test/export",
      sendExportReadyEmail: async (args) => {
        mails.push(`ready:${args.jobId}`);
      },
      sendExportFailedEmail: async (args) => {
        mails.push(`failed:${args.jobId}`);
      },
    });

    expect(armed).toBe(false);
    expect(await userStatus(USER_ID)).toBe(USER_STATUS.Deleted);
    const job = await readJob(jobId);
    expect(job?.status).toBe(EXPORT_JOB_STATUS.Failed);
    expect(job?.errorMessage).toBe(EXPORT_JOB_ERROR_USER_ERASED);
    expect(result.completedJobIds).toEqual([]);
    expect(result.failedJobIds).toEqual([]);
    expect(mails).toEqual([]);
    expect(exportKeys()).toEqual([]);
    expect(job?.downloadStorageKey).toBeNull();
    const tokens = await selectMany<{ expiresAt: { epochMilliseconds: number } }>(
      stack.db,
      exportDownloadTokensTable,
      { jobId },
    );
    expect(tokens).toHaveLength(1);
    for (const token of tokens) {
      expect(token.expiresAt.epochMilliseconds).toBeLessThanOrEqual(now.epochMilliseconds);
    }
    await stack.drainJobs();
  });

  test.each([USER_STATUS.Restricted, USER_STATUS.DeletionRequested])(
    "a %s user still gets the export",
    async (status) => {
      const jobId = await requestExport();
      await updateUserLifecycle(stack.db, USER_ID, { status });

      await stack.drainJobs();

      const job = await readJob(jobId);
      expect(job?.status).toBe(EXPORT_JOB_STATUS.Done);
      const key = job?.downloadStorageKey;
      if (!key) throw new Error("export job finished without a download storage key");
      expect(await base.exists(key)).toBe(true);
    },
  );
});
