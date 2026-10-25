// runExportJobs worker integration test.
//
// Exercises the worker pipeline end to end with the in-memory storage provider:
//
//   1. Happy path: pending job → worker claims → bundle built → ZIP written to
//      storage → job=done with downloadStorageKey, expiresAt, and bytesWritten
//   2. ZIP is extractable with Info-ZIP and contains the bundle
//   3. Stale detection: running job past its TTL → failed
//   4. Worker throw: failing hook → job=failed with errorMessage
//   5. Storage cleanup: done job past expiresAt+grace → downloadStorageKey is
//      nulled and the storage key is deleted
//   6. Idempotency: two runs do not reprocess done/failed jobs

import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { asRawClient, selectMany } from "@cosmicdrift/kumiko-framework/db";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createInMemoryFileProvider,
  type FileStorageProvider,
} from "@cosmicdrift/kumiko-framework/files";
import type { MetricsHandle } from "@cosmicdrift/kumiko-framework/observability";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import {
  resetTestTables,
  seedRowViaEventStore,
  updateRowViaEventStore,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "../../compliance-profiles/index.ts";
import { createDataRetentionFeature } from "../../data-retention/index.ts";
import { createSessionsFeature, userSessionEntity } from "../../sessions/index.ts";
import { tenantMembershipEntity, tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { createUserFeature, USER_STATUS, userEntity, userTable } from "../../user/index.ts";
import { createUserDataRightsFeature } from "../feature.ts";
import {
  EXPORT_CLEANUP_BACKLOG_AGE_METRIC,
  EXPORT_CLEANUP_LAST_RUN_TIMESTAMP_METRIC,
  runExportJobs,
} from "../run-export-jobs.ts";
import { exportDownloadTokenEntity, exportDownloadTokensTable } from "../schema/download-token.ts";
import { EXPORT_JOB_STATUS, exportJobEntity, exportJobsTable } from "../schema/export-job.ts";
import { hashDownloadToken } from "../token-helpers.ts";
import { changeExportJob } from "./export-job-writes.ts";

let stack: TestStack;
let providerPerTenant: Map<string, ReturnType<typeof createInMemoryFileProvider>>;

const tenantA = testTenantId(1);
const aliceUser = createTestUser({ id: 42, tenantId: tenantA, roles: ["Member"] });

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createUserFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createAuthFoundationFeature(),
      createSessionsFeature(),
      createUserDataRightsFeature(),
    ],
  });
  await unsafeCreateEntityTable(stack.db, exportJobEntity);
  await unsafeCreateEntityTable(stack.db, exportDownloadTokenEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, userSessionEntity);
  // runUserExport iterates the user's memberships across tenants.
  await unsafeCreateEntityTable(stack.db, tenantMembershipEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [
    exportDownloadTokensTable,
    exportJobsTable,
    userTable,
    eventsTable,
    tenantComplianceProfileTable,
    tenantMembershipsTable,
  ]);
  providerPerTenant = new Map();

  // Seed the aliceUser row with an email because the worker notification
  // callback retrieves it through lookupUserEmail.
  await seedRowViaEventStore(stack.db, userTable, {
    id: String(aliceUser.id),
    email: "alice@example.com",
    passwordHash: "hashed",
    displayName: "Alice",
    locale: "de",
    emailVerified: true,
    roles: '["Member"]',
    status: USER_STATUS.Active,
  });
});

const NOW = () => getTemporal().Now.instant();

// An empty email makes lookupUserEmail return null.
async function clearAliceEmail(): Promise<void> {
  await updateRowViaEventStore(
    stack.db,
    { table: userTable, entity: userEntity, entityName: "user" },
    { id: String(aliceUser.id) },
    { email: "" },
  );
}

function buildProvider(tenantId: string): Promise<FileStorageProvider> {
  let p = providerPerTenant.get(tenantId);
  if (!p) {
    p = createInMemoryFileProvider();
    providerPerTenant.set(tenantId, p);
  }
  return Promise.resolve(p);
}

// Typed fake standing in for the ctx.meter-backed MetricsHandle feature.ts
// builds for the real cron — records `set()` calls without a Meter/registry.
function createRecordingMetricsHandle(): MetricsHandle & { readonly values: Map<string, number> } {
  const values = new Map<string, number>();
  return {
    values,
    inc: () => {},
    observe: () => {},
    set: (name, value) => {
      values.set(name, value);
    },
  };
}

// Seed a pending job through the real request-export handler so the event
// stream exists. A direct INSERT would create stream-version=0/row-version=1
// drift and make the worker claim fail with a version conflict.
async function seedPendingJob(opts: { user?: typeof aliceUser } = {}): Promise<string> {
  const result = await stack.http.writeOk<{ jobId: string }>(
    "user-data-rights:write:request-export",
    {},
    opts.user ?? aliceUser,
  );
  return result.jobId;
}

// Force a UNIQUE-violation on read_export_download_tokens.job_id (test-fixture,
// direct-INSERT is a test-only exemption) — the worker's tokenCrud.create then
// fails with constraintName "read_export_download_tokens_one_per_job",
// deterministically flipping the job to failed for the tests below.
async function seedConflictingDownloadToken(jobId: string): Promise<void> {
  await asRawClient(stack.db).unsafe(
    `
      INSERT INTO read_export_download_tokens
        (id, tenant_id, job_id, token_hash, issued_at, expires_at, version, inserted_at, modified_at)
      VALUES (gen_random_uuid(), $1, $2, $3, now(), now() + interval '7 days', 1, now(), now())
    `,
    [tenantA, jobId, "existing-hash"],
  );
}

describe("runExportJobs :: happy path", () => {
  test("pending job → worker claims → done with downloadStorageKey + bytesWritten", async () => {
    const jobId = await seedPendingJob();

    const result = await runExportJobs({
      db: stack.db,
      registry: stack.registry,
      buildStorageProvider: buildProvider,
      now: NOW(),
    });

    expect(result.completedJobIds).toContain(jobId);
    expect(result.errors).toEqual([]);

    const [row] = (await selectMany(stack.db, exportJobsTable, { id: jobId })) as Array<{
      status: string;
      downloadStorageKey: string | null;
      expiresAt: { toString(): string } | null;
      bytesWritten: number | null;
    }>;
    expect(row?.status).toBe(EXPORT_JOB_STATUS.Done);
    expect(row?.downloadStorageKey).toBe(`exports/${tenantA}/${jobId}.zip`);
    expect(row?.expiresAt).not.toBeNull();
    expect(row?.bytesWritten).toBeGreaterThan(0);

    // ZIP wirklich im Storage
    const provider = await buildProvider(tenantA);
    expect(await provider.exists(`exports/${tenantA}/${jobId}.zip`)).toBe(true);
  });

  test("ZIP is actually extractable via Info-ZIP + contains bundle.json", async () => {
    const jobId = await seedPendingJob();

    await runExportJobs({
      db: stack.db,
      registry: stack.registry,
      buildStorageProvider: buildProvider,
      now: NOW(),
    });

    const provider = await buildProvider(tenantA);
    const zipBytes = await provider.read(`exports/${tenantA}/${jobId}.zip`);

    // Real-Decoder-Roundtrip via Info-ZIP unzip
    const dir = await mkdtemp(join(tmpdir(), "kumiko-worker-test-"));
    try {
      const zipPath = join(dir, "out.zip");
      await writeFile(zipPath, zipBytes);
      await new Promise<void>((resolve, reject) => {
        const proc = spawn("unzip", ["-d", join(dir, "out"), zipPath]);
        proc.on("close", (code) =>
          code === 0 ? resolve() : reject(new Error(`unzip exit ${code}`)),
        );
        proc.on("error", reject);
      });
      const bundleJson = await readFile(join(dir, "out", "bundle.json"), "utf8");
      const bundle = JSON.parse(bundleJson);
      expect(bundle.userId).toBe(aliceUser.id);
      expect(bundle.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("runExportJobs :: stale-detection", () => {
  test("running job with startedAt > exportStaleTimeoutMinutes → failed", async () => {
    // Seed through the real path so the event stream exists, then directly update
    // startedAt and status for this test fixture.
    const jobId = await seedPendingJob();
    const T = getTemporal();
    const twoHoursAgo = T.Instant.fromEpochMilliseconds(Date.now() - 2 * 60 * 60 * 1000);
    await changeExportJob(
      stack.db,
      jobId,
      { status: EXPORT_JOB_STATUS.Running, startedAt: twoHoursAgo },
      tenantA,
    );

    const result = await runExportJobs({
      db: stack.db,
      registry: stack.registry,
      buildStorageProvider: buildProvider,
      now: NOW(),
    });

    expect(result.staleFailedJobIds).toContain(jobId);

    const [row] = (await selectMany(stack.db, exportJobsTable, { id: jobId })) as Array<{
      status: string;
      errorMessage: string | null;
    }>;
    expect(row?.status).toBe(EXPORT_JOB_STATUS.Failed);
    expect(row?.errorMessage).toMatch(/stale: worker crashed/i);
  });

  test("running job with startedAt BELOW stale cutoff remains running", async () => {
    const jobId = await seedPendingJob();
    const T = getTemporal();
    const justNow = T.Instant.fromEpochMilliseconds(Date.now() - 60 * 1000); // 1min ago
    await changeExportJob(
      stack.db,
      jobId,
      { status: EXPORT_JOB_STATUS.Running, startedAt: justNow },
      tenantA,
    );

    const result = await runExportJobs({
      db: stack.db,
      registry: stack.registry,
      buildStorageProvider: buildProvider,
      now: NOW(),
    });

    expect(result.staleFailedJobIds).not.toContain(jobId);
    const [row] = (await selectMany(stack.db, exportJobsTable, { id: jobId })) as Array<{
      status: string;
    }>;
    expect(row?.status).toBe(EXPORT_JOB_STATUS.Running);
  });

  test("stale job with downloadStorageKey (real path after 4a.fix path-pre-claim) → ZIP cleanup in same pass", async () => {
    // A claimed running job already has downloadStorageKey persisted. If stale
    // detection marks it failed, the same worker pass must remove the orphan ZIP.
    const jobId = await seedPendingJob();
    const T = getTemporal();
    const twoHoursAgo = T.Instant.fromEpochMilliseconds(Date.now() - 2 * 60 * 60 * 1000);
    const storageKey = `exports/${tenantA}/${jobId}.zip`;

    // Simulate the production path: the claim set status=running and storageKey,
    // and the ZIP was written before the worker crashed without marking the job done.
    const provider = await buildProvider(tenantA);
    await provider.write(storageKey, new Uint8Array([1, 2, 3]));
    await changeExportJob(
      stack.db,
      jobId,
      {
        status: EXPORT_JOB_STATUS.Running,
        startedAt: twoHoursAgo,
        downloadStorageKey: storageKey,
      },
      tenantA,
    );

    const result = await runExportJobs({
      db: stack.db,
      registry: stack.registry,
      buildStorageProvider: buildProvider,
      now: NOW(),
    });

    expect(result.staleFailedJobIds).toContain(jobId);
    expect(result.cleanedJobIds).toContain(jobId);
    expect(await provider.exists(storageKey)).toBe(false);

    const [row] = (await selectMany(stack.db, exportJobsTable, { id: jobId })) as Array<{
      status: string;
      downloadStorageKey: string | null;
    }>;
    expect(row?.status).toBe(EXPORT_JOB_STATUS.Failed);
    expect(row?.downloadStorageKey).toBeNull();
  });
});

describe("runExportJobs :: storage-cleanup", () => {
  test("done job with expiresAt+grace in the past → downloadStorageKey null + file deleted", async () => {
    const jobId = await seedPendingJob();
    const T = getTemporal();
    const longAgo = T.Instant.fromEpochMilliseconds(
      Date.now() - 365 * 24 * 60 * 60 * 1000, // 1 Jahr ago
    );
    const storageKey = `exports/${tenantA}/${jobId}.zip`;
    const provider = await buildProvider(tenantA);
    await provider.write(storageKey, new Uint8Array([1, 2, 3]));

    await changeExportJob(
      stack.db,
      jobId,
      {
        status: EXPORT_JOB_STATUS.Done,
        startedAt: longAgo,
        completedAt: longAgo,
        downloadStorageKey: storageKey,
        expiresAt: longAgo,
      },
      tenantA,
    );

    const result = await runExportJobs({
      db: stack.db,
      registry: stack.registry,
      buildStorageProvider: buildProvider,
      now: NOW(),
    });

    expect(result.cleanedJobIds).toContain(jobId);
    expect(await provider.exists(storageKey)).toBe(false);

    const [row] = (await selectMany(stack.db, exportJobsTable, { id: jobId })) as Array<{
      status: string;
      downloadStorageKey: string | null;
    }>;
    expect(row?.status).toBe(EXPORT_JOB_STATUS.Done);
    expect(row?.downloadStorageKey).toBeNull();
  });

  test("done job with fresh expiresAt (within grace) remains — buffer zone", async () => {
    const jobId = await seedPendingJob();
    const T = getTemporal();
    const oneHourAgo = T.Instant.fromEpochMilliseconds(Date.now() - 60 * 60 * 1000);
    const storageKey = `exports/${tenantA}/${jobId}.zip`;
    const provider = await buildProvider(tenantA);
    await provider.write(storageKey, new Uint8Array([4, 5, 6]));

    await changeExportJob(
      stack.db,
      jobId,
      {
        status: EXPORT_JOB_STATUS.Done,
        startedAt: oneHourAgo,
        completedAt: oneHourAgo,
        downloadStorageKey: storageKey,
        expiresAt: oneHourAgo,
      },
      tenantA,
    );

    const result = await runExportJobs({
      db: stack.db,
      registry: stack.registry,
      buildStorageProvider: buildProvider,
      now: NOW(),
    });

    expect(result.cleanedJobIds).not.toContain(jobId);
    expect(await provider.exists(storageKey)).toBe(true);
  });

  test("storage-delete throw → job remains uncleaned (retry next pass)", async () => {
    const jobId = await seedPendingJob();
    const T = getTemporal();
    const longAgo = T.Instant.fromEpochMilliseconds(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const storageKey = `exports/${tenantA}/${jobId}.zip`;
    const provider = await buildProvider(tenantA);
    await provider.write(storageKey, new Uint8Array([7, 8, 9]));

    await changeExportJob(
      stack.db,
      jobId,
      {
        status: EXPORT_JOB_STATUS.Done,
        startedAt: longAgo,
        completedAt: longAgo,
        downloadStorageKey: storageKey,
        expiresAt: longAgo,
      },
      tenantA,
    );

    const result = await runExportJobs({
      db: stack.db,
      registry: stack.registry,
      buildStorageProvider: async () => ({
        ...provider,
        delete: async () => {
          throw new Error("synthetic storage delete failure");
        },
      }),
      now: NOW(),
    });

    expect(result.cleanedJobIds).not.toContain(jobId);
    expect(await provider.exists(storageKey)).toBe(true);
    const [row] = (await selectMany(stack.db, exportJobsTable, { id: jobId })) as Array<{
      downloadStorageKey: string | null;
    }>;
    expect(row?.downloadStorageKey).toBe(storageKey);
  });
});

describe("runExportJobs :: export-cleanup backlog metric", () => {
  test("done job with expired TTL + downloadStorageKey still set → metric > 0", async () => {
    const jobId = await seedPendingJob();
    const T = getTemporal();
    const longAgo = T.Instant.fromEpochMilliseconds(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const storageKey = `exports/${tenantA}/${jobId}.zip`;
    const provider = await buildProvider(tenantA);
    await provider.write(storageKey, new Uint8Array([7, 8, 9]));

    await changeExportJob(
      stack.db,
      jobId,
      {
        status: EXPORT_JOB_STATUS.Done,
        startedAt: longAgo,
        completedAt: longAgo,
        downloadStorageKey: storageKey,
        expiresAt: longAgo,
      },
      tenantA,
    );

    const metrics = createRecordingMetricsHandle();
    await runExportJobs({
      db: stack.db,
      registry: stack.registry,
      buildStorageProvider: async () => ({
        ...provider,
        delete: async () => {
          throw new Error("synthetic storage delete failure");
        },
      }),
      now: NOW(),
      metrics,
    });

    expect(metrics.values.get(EXPORT_CLEANUP_BACKLOG_AGE_METRIC)).toBeGreaterThan(0);
  });

  test("failed job with orphan ZIP and failing delete → metric > 0", async () => {
    const jobId = await seedPendingJob();
    const T = getTemporal();
    const longAgo = T.Instant.fromEpochMilliseconds(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const storageKey = `exports/${tenantA}/${jobId}.zip`;
    const provider = await buildProvider(tenantA);
    await provider.write(storageKey, new Uint8Array([4, 5, 6]));

    await changeExportJob(
      stack.db,
      jobId,
      {
        status: EXPORT_JOB_STATUS.Failed,
        startedAt: longAgo,
        completedAt: longAgo,
        downloadStorageKey: storageKey,
      },
      tenantA,
    );

    const metrics = createRecordingMetricsHandle();
    await runExportJobs({
      db: stack.db,
      registry: stack.registry,
      buildStorageProvider: async () => ({
        ...provider,
        delete: async () => {
          throw new Error("synthetic storage delete failure");
        },
      }),
      now: NOW(),
      metrics,
    });

    expect(metrics.values.get(EXPORT_CLEANUP_BACKLOG_AGE_METRIC)).toBeGreaterThan(0);
  });

  test("done job successfully cleaned → metric is 0", async () => {
    const jobId = await seedPendingJob();
    const T = getTemporal();
    const longAgo = T.Instant.fromEpochMilliseconds(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const storageKey = `exports/${tenantA}/${jobId}.zip`;
    const provider = await buildProvider(tenantA);
    await provider.write(storageKey, new Uint8Array([1, 2, 3]));

    await changeExportJob(
      stack.db,
      jobId,
      {
        status: EXPORT_JOB_STATUS.Done,
        startedAt: longAgo,
        completedAt: longAgo,
        downloadStorageKey: storageKey,
        expiresAt: longAgo,
      },
      tenantA,
    );

    const passTime = NOW();
    const metrics = createRecordingMetricsHandle();
    const result = await runExportJobs({
      db: stack.db,
      registry: stack.registry,
      buildStorageProvider: buildProvider,
      now: passTime,
      metrics,
    });

    expect(result.cleanedJobIds).toContain(jobId);
    expect(metrics.values.get(EXPORT_CLEANUP_BACKLOG_AGE_METRIC)).toBe(0);
    expect(metrics.values.get(EXPORT_CLEANUP_LAST_RUN_TIMESTAMP_METRIC)).toBe(
      passTime.epochMilliseconds / 1000,
    );
  });
});

describe("runExportJobs :: idempotency", () => {
  test("second run after done is a no-op for the same job", async () => {
    const jobId = await seedPendingJob();

    const first = await runExportJobs({
      db: stack.db,
      registry: stack.registry,
      buildStorageProvider: buildProvider,
      now: NOW(),
    });
    expect(first.completedJobIds).toContain(jobId);

    const second = await runExportJobs({
      db: stack.db,
      registry: stack.registry,
      buildStorageProvider: buildProvider,
      now: NOW(),
    });
    expect(second.completedJobIds).toEqual([]);
    expect(second.failedJobIds).toEqual([]);
  });
});

describe("runExportJobs :: concurrency", () => {
  test("two parallel runners with 1 pending job → exactly one done, one skipped", async () => {
    // Verifies the concurrency invariant: optimistic locking allows exactly one
    // worker replica to claim the job; the other silently skips it.
    const jobId = await seedPendingJob();

    const [resultA, resultB] = await Promise.all([
      runExportJobs({
        db: stack.db,
        registry: stack.registry,
        buildStorageProvider: buildProvider,
        now: NOW(),
      }),
      runExportJobs({
        db: stack.db,
        registry: stack.registry,
        buildStorageProvider: buildProvider,
        now: NOW(),
      }),
    ]);

    const completedAcrossBoth = [...resultA.completedJobIds, ...resultB.completedJobIds];
    expect(completedAcrossBoth.filter((id) => id === jobId)).toHaveLength(1);

    // Keine doppelten failures
    expect([...resultA.failedJobIds, ...resultB.failedJobIds]).toEqual([]);

    const rows = (await selectMany(stack.db, exportJobsTable, { id: jobId })) as Array<{
      status: string;
      downloadStorageKey: string | null;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe(EXPORT_JOB_STATUS.Done);
    expect(rows[0]?.downloadStorageKey).toBe(`exports/${tenantA}/${jobId}.zip`);

    // Exactly one ZIP in storage: the race must not write it twice.
    const provider = await buildProvider(tenantA);
    expect(await provider.exists(`exports/${tenantA}/${jobId}.zip`)).toBe(true);
  });
});

describe("runExportJobs :: stale-detection profile-driven cutoff", () => {
  test("running job 45min ago + profile default 30min → is failed (no 60min coarse filter anymore)", async () => {
    // The per-job profile timeout must be applied without a coarse one-hour
    // filter; otherwise jobs 30–60 minutes old would escape the default
    // exportStaleTimeoutMinutes = 30 cutoff.
    const jobId = await seedPendingJob();
    const T = getTemporal();
    const fortyFiveMinAgo = T.Instant.fromEpochMilliseconds(Date.now() - 45 * 60 * 1000);
    await changeExportJob(
      stack.db,
      jobId,
      { status: EXPORT_JOB_STATUS.Running, startedAt: fortyFiveMinAgo },
      tenantA,
    );

    const result = await runExportJobs({
      db: stack.db,
      registry: stack.registry,
      buildStorageProvider: buildProvider,
      now: NOW(),
    });

    expect(result.staleFailedJobIds).toContain(jobId);
    const [row] = (await selectMany(stack.db, exportJobsTable, { id: jobId })) as Array<{
      status: string;
    }>;
    expect(row?.status).toBe(EXPORT_JOB_STATUS.Failed);
  });
});

describe("runExportJobs :: Atom 4a download-tokens", () => {
  test("Worker generates token + hash in DB after done-flip", async () => {
    const jobId = await seedPendingJob();

    const result = await runExportJobs({
      db: stack.db,
      registry: stack.registry,
      buildStorageProvider: buildProvider,
      now: NOW(),
    });

    expect(result.completedJobIds).toContain(jobId);

    const plainToken = result.tokenByJobId.get(jobId);
    expect(plainToken).toBeDefined();
    expect(plainToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // Hash in DB matched plain via hashDownloadToken roundtrip
    const tokenRows = (await selectMany(stack.db, exportDownloadTokensTable, { jobId })) as Array<{
      jobId: string;
      tokenHash: string;
      issuedAt: { toString(): string };
      expiresAt: { toString(): string };
      lastUsedAt: { toString(): string } | null;
      useCount: number | null;
    }>;
    expect(tokenRows).toHaveLength(1);
    expect(tokenRows[0]?.tokenHash).toBe(await hashDownloadToken(plainToken as string));
    expect(tokenRows[0]?.lastUsedAt).toBeNull();
    // useCount is explicitly initialized to 0 so incrementing it requires no
    // COALESCE.
    expect(tokenRows[0]?.useCount).toBe(0);

    // expiresAt im Token = job.expiresAt (denormalized)
    const [jobRow] = (await selectMany(stack.db, exportJobsTable, { id: jobId })) as Array<{
      expiresAt: { toString(): string } | null;
    }>;
    expect(tokenRows[0]?.expiresAt.toString()).toBe(jobRow?.expiresAt?.toString());
  });

  test("ES via crud.create — Token-Created-Event in kumiko_events", async () => {
    // The token must be created through event sourcing rather than a direct INSERT
    // so notification hooks can observe the token-created event.
    await seedPendingJob();
    await runExportJobs({
      db: stack.db,
      registry: stack.registry,
      buildStorageProvider: buildProvider,
      now: NOW(),
    });

    const events = (await asRawClient(stack.db).unsafe(
      `SELECT type FROM kumiko_events WHERE type LIKE 'export-download-token.%'`,
    )) as unknown as Array<{ type: string }>;
    expect(events.some((e) => e.type === "export-download-token.created")).toBe(true);
  });

  test("Worker idempotency: 2× run done job → no second token (UNIQUE jobId)", async () => {
    const jobId = await seedPendingJob();
    await runExportJobs({
      db: stack.db,
      registry: stack.registry,
      buildStorageProvider: buildProvider,
      now: NOW(),
    });

    const second = await runExportJobs({
      db: stack.db,
      registry: stack.registry,
      buildStorageProvider: buildProvider,
      now: NOW(),
    });
    expect(second.completedJobIds).toEqual([]);
    expect(second.tokenByJobId.size).toBe(0);

    const tokenRows = (await selectMany(stack.db, exportDownloadTokensTable, {
      jobId,
    })) as Array<unknown>;
    expect(tokenRows).toHaveLength(1);
  });

  test("Re-Run: job returned to pending → token rotated in place, no second created event", async () => {
    const jobId = await seedPendingJob();
    const first = await runExportJobs({
      db: stack.db,
      registry: stack.registry,
      buildStorageProvider: buildProvider,
      now: NOW(),
    });
    const firstPlain = first.tokenByJobId.get(jobId);
    expect(firstPlain).toBeDefined();

    const [tokenBefore] = (await selectMany(stack.db, exportDownloadTokensTable, {
      jobId,
    })) as Array<{ id: string }>;

    // Operator recovery after an email failure flips only the job back to pending;
    // the existing token row remains. Creating a second aggregate for the same
    // jobId would make projection rebuilds collide with the one_per_job index.
    await changeExportJob(stack.db, jobId, { status: EXPORT_JOB_STATUS.Pending }, tenantA);

    const second = await runExportJobs({
      db: stack.db,
      registry: stack.registry,
      buildStorageProvider: buildProvider,
      now: NOW(),
    });
    expect(second.completedJobIds).toContain(jobId);
    const secondPlain = second.tokenByJobId.get(jobId);
    expect(secondPlain).toBeDefined();
    expect(secondPlain).not.toBe(firstPlain);

    // Exactly one row, the same aggregate, a fresh hash, and reset audit fields.
    const tokenRows = (await selectMany(stack.db, exportDownloadTokensTable, {
      jobId,
    })) as Array<{
      id: string;
      tokenHash: string;
      useCount: number | null;
      lastUsedAt: unknown;
    }>;
    expect(tokenRows).toHaveLength(1);
    expect(tokenRows[0]?.id).toBe(tokenBefore?.id as string);
    expect(tokenRows[0]?.tokenHash).toBe(await hashDownloadToken(secondPlain as string));
    expect(tokenRows[0]?.useCount).toBe(0);
    expect(tokenRows[0]?.lastUsedAt).toBeNull();

    // Rebuild invariant: exactly one created event prevents the one_per_job index
    // from colliding during replay.
    const events = (await asRawClient(stack.db).unsafe(
      `SELECT type FROM kumiko_events WHERE aggregate_type = 'export-download-token'`,
    )) as unknown as Array<{ type: string }>;
    expect(events.filter((e) => e.type === "export-download-token.created")).toHaveLength(1);
    expect(events.some((e) => e.type === "export-download-token.updated")).toBe(true);
  });

  test("failed job: no token is generated", async () => {
    // No pending job is available, so verify that no token is generated when there
    // are no completed jobs.
    const result = await runExportJobs({
      db: stack.db,
      registry: stack.registry,
      buildStorageProvider: buildProvider,
      now: NOW(),
    });
    expect(result.completedJobIds).toEqual([]);
    expect(result.tokenByJobId.size).toBe(0);

    const allTokens = (await selectMany(stack.db, exportDownloadTokensTable)) as Array<unknown>;
    expect(allTokens).toHaveLength(0);
  });

  test("Token-create UNIQUE-violation → Job=failed (NICHT done) — Sequencing-Pin", async () => {
    // The token is created before the job is marked done. If token creation fails,
    // the worker marks the job failed rather than first committing done and then
    // reverting it.
    //
    // Seed a pending job and a duplicate token row for the same jobId, then let
    // the worker write the ZIP and fail on the token's UNIQUE constraint.
    const jobId = await seedPendingJob();

    await seedConflictingDownloadToken(jobId);

    const result = await runExportJobs({
      db: stack.db,
      registry: stack.registry,
      buildStorageProvider: buildProvider,
      now: NOW(),
    });

    expect(result.completedJobIds).not.toContain(jobId);
    expect(result.failedJobIds).toContain(jobId);

    const [row] = (await selectMany(stack.db, exportJobsTable, { id: jobId })) as Array<{
      status: string;
      errorMessage: string | null;
    }>;
    expect(row?.status).toBe(EXPORT_JOB_STATUS.Failed);
    expect(row?.errorMessage).toMatch(/Token-Creation failed/);
  });

  test("failed job: sendExportFailedEmail is called with errorMessage + userEmail", async () => {
    const jobId = await seedPendingJob();

    await seedConflictingDownloadToken(jobId);

    type SentArgs = {
      userId: string;
      userEmail: string;
      jobId: string;
      errorMessage: string;
      tenantId: string;
    };
    const sentEmails: SentArgs[] = [];

    const result = await runExportJobs({
      db: stack.db,
      registry: stack.registry,
      buildStorageProvider: buildProvider,
      now: NOW(),
      sendExportFailedEmail: async (args) => {
        sentEmails.push(args);
      },
    });

    expect(result.failedJobIds).toContain(jobId);
    expect(sentEmails).toHaveLength(1);
    const sent = sentEmails[0];
    if (!sent) throw new Error("expected 1 sent email");
    expect(sent.userId).toBe(String(aliceUser.id));
    expect(sent.userEmail).toBe("alice@example.com");
    expect(sent.jobId).toBe(jobId);
    expect(sent.errorMessage).toMatch(/Token-Creation failed/);
  });

  test("failed job without callback: no email, worker run succeeded", async () => {
    const jobId = await seedPendingJob();
    await seedConflictingDownloadToken(jobId);

    const result = await runExportJobs({
      db: stack.db,
      registry: stack.registry,
      buildStorageProvider: buildProvider,
      now: NOW(),
      // No sendExportFailedEmail.
    });
    expect(result.failedJobIds).toContain(jobId);
    // No email and no throw: the worker run completes normally.
  });

  test("failed job, sendExportFailedEmail throw is caught (best-effort, no batch abort)", async () => {
    // Two jobs, both forced to fail via the same token-collision mechanism
    // as the tests above — the callback throws for job A only, proving the
    // throw doesn't kill the batch loop before job B's callback fires.
    const bobUser = createTestUser({ id: 8, tenantId: tenantA, roles: ["Member"] });
    await seedRowViaEventStore(stack.db, userTable, {
      id: String(bobUser.id),
      email: "bob-failed@example.com",
      passwordHash: "h",
      displayName: "Bob",
      locale: "de",
      emailVerified: true,
      roles: '["Member"]',
      status: USER_STATUS.Active,
    });

    const jobAId = await seedPendingJob();
    const jobBId = await seedPendingJob({ user: bobUser });
    for (const jobId of [jobAId, jobBId]) {
      await seedConflictingDownloadToken(jobId);
    }

    const calls: string[] = [];
    // Should not throw despite job A's callback throwing — the try/catch
    // around fireExportFailedCallback swallows it (operator-visibility
    // via console.warn only) and the loop continues to job B. A regress to
    // a fully silent swallow (no log call at all) would still pass every
    // assertion below unless the warn itself is pinned.
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    const result = await runExportJobs({
      db: stack.db,
      registry: stack.registry,
      buildStorageProvider: buildProvider,
      now: NOW(),
      sendExportFailedEmail: async (args) => {
        calls.push(args.jobId);
        if (args.jobId === jobAId) {
          throw new Error("synthetic email transport failure for job A");
        }
      },
    });
    expect(result.failedJobIds).toEqual(expect.arrayContaining([jobAId, jobBId]));
    expect(calls.sort()).toEqual([jobAId, jobBId].sort());
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test("failed job, user without email → sendExportFailedEmail skipped (no throw)", async () => {
    await clearAliceEmail();
    const jobId = await seedPendingJob();
    await seedConflictingDownloadToken(jobId);

    let callbackInvoked = false;
    const result = await runExportJobs({
      db: stack.db,
      registry: stack.registry,
      buildStorageProvider: buildProvider,
      now: NOW(),
      sendExportFailedEmail: async () => {
        callbackInvoked = true;
      },
    });
    expect(result.failedJobIds).toContain(jobId);
    expect(callbackInvoked).toBe(false);
  });

  test("failed job with downloadStorageKey → ZIP is removed during the cleanup pass (orphan fix)", async () => {
    // Failed jobs can retain a downloadStorageKey because it is set during the
    // claim. Their cleanup pass deletes the ZIP immediately, without a grace
    // period, and clears the database column.
    const jobId = await seedPendingJob();
    const storageKey = `exports/${tenantA}/${jobId}.zip`;

    // Seed a ZIP and mark the job failed with its storage key to simulate an
    // orphaned file left by a worker crash.
    const provider = await buildProvider(tenantA);
    await provider.write(storageKey, new Uint8Array([99, 99, 99]));
    await changeExportJob(
      stack.db,
      jobId,
      {
        status: EXPORT_JOB_STATUS.Failed,
        downloadStorageKey: storageKey,
        errorMessage: "synthetic crash mid-run",
      },
      tenantA,
    );

    const result = await runExportJobs({
      db: stack.db,
      registry: stack.registry,
      buildStorageProvider: buildProvider,
      now: NOW(),
    });

    expect(result.cleanedJobIds).toContain(jobId);
    expect(await provider.exists(storageKey)).toBe(false);

    const [row] = (await selectMany(stack.db, exportJobsTable, { id: jobId })) as Array<{
      downloadStorageKey: string | null;
    }>;
    expect(row?.downloadStorageKey).toBeNull();
  });
});

describe("runExportJobs :: Atom 3c file-binaries", () => {
  // Spy on buildProvider to verify the per-tenant cache invariant: each tenant
  // requires only one provider build.
  let providerCallsByTenant: Map<string, number>;

  function spiedBuildProvider(tenantId: string): Promise<FileStorageProvider> {
    providerCallsByTenant.set(tenantId, (providerCallsByTenant.get(tenantId) ?? 0) + 1);
    return buildProvider(tenantId);
  }

  // This fixture returns fileRefs directly from a user-data export hook, avoiding
  // the defaults feature and its file-foundation/files dependencies.
  function seedFileBytes(tenantId: string, storageKey: string, bytes: Uint8Array) {
    return buildProvider(tenantId).then((p) => p.write(storageKey, bytes));
  }

  beforeEach(() => {
    providerCallsByTenant = new Map();
  });

  // Use a separate local stack for this describe block so the fixture can provide
  // fileRefs.
  let localStack: TestStack;
  // Mutable test input lets the malicious-filename test vary the user-provided
  // name without rebuilding the stack.
  let currentTestFileName = "report.pdf";
  beforeAll(async () => {
    const { defineFeature, EXT_USER_DATA } = await import("@cosmicdrift/kumiko-framework/engine");
    const testFileExporter = defineFeature("test-file-exporter", (r) => {
      r.useExtension(EXT_USER_DATA, "test-file", {
        export: async (ctx: { tenantId: string; userId: string }) => ({
          entity: "test-file",
          rows: [{ id: "f1", name: currentTestFileName }],
          fileRefs: [
            {
              fileRefId: "f1",
              storageKey: `${ctx.tenantId}/test-file/f1.pdf`,
              fileName: currentTestFileName,
            },
          ],
        }),
        // no-op: this fixture exercises only the export/file path; the erase
        // side is covered by forget-*.integration.test.ts. Required so the
        // V2 boot gate (export-without-erase) does not reject the stack.
        delete: async () => {},
      });
    });

    localStack = await setupTestStack({
      features: [
        createUserFeature(),
        createDataRetentionFeature(),
        createComplianceProfilesFeature(),
        createAuthFoundationFeature(),
        createSessionsFeature(),
        createUserDataRightsFeature(),
        testFileExporter,
      ],
    });
    await unsafeCreateEntityTable(localStack.db, exportJobEntity);
    await unsafeCreateEntityTable(localStack.db, exportDownloadTokenEntity);
    await unsafeCreateEntityTable(localStack.db, tenantComplianceProfileEntity);
    await unsafeCreateEntityTable(localStack.db, tenantMembershipEntity);
  });

  afterAll(async () => {
    if (localStack) await localStack.cleanup();
  });

  beforeEach(async () => {
    if (!localStack) return;
    await resetTestTables(localStack.db, [
      exportDownloadTokensTable,
      exportJobsTable,
      eventsTable,
      tenantComplianceProfileTable,
      tenantMembershipsTable,
    ]);
    // Reset the default so test state cannot leak into the next test.
    currentTestFileName = "report.pdf";
  });

  async function seedMembership(tenantId: string, userId: string | number) {
    await seedRowViaEventStore(localStack.db, tenantMembershipsTable, {
      tenantId: tenantId,
      userId: String(userId),
      roles: "[]",
    });
  }

  async function seedPendingJobLocal(user: typeof aliceUser): Promise<string> {
    const result = await localStack.http.writeOk<{ jobId: string }>(
      "user-data-rights:write:request-export",
      {},
      user,
    );
    return result.jobId;
  }

  test("happy: 1 fileRef in 1 Tenant → ZIP enthaelt file-bytes unter zipPath", async () => {
    await seedMembership(tenantA, aliceUser.id);
    await seedFileBytes(tenantA, `${tenantA}/test-file/f1.pdf`, new Uint8Array([1, 2, 3, 4, 5]));

    const jobId = await seedPendingJobLocal(aliceUser);

    const result = await runExportJobs({
      db: localStack.db,
      registry: localStack.registry,
      buildStorageProvider: spiedBuildProvider,
      now: NOW(),
    });

    expect(result.completedJobIds).toContain(jobId);
    expect(result.errors).toEqual([]);

    // ZIP entpacken + file-bytes verifizieren
    const provider = await buildProvider(tenantA);
    const zipBytes = await provider.read(`exports/${tenantA}/${jobId}.zip`);
    const dir = await mkdtemp(join(tmpdir(), "kumiko-3c-test-"));
    try {
      const zipPath = join(dir, "out.zip");
      await writeFile(zipPath, zipBytes);
      await new Promise<void>((resolve, reject) => {
        const proc = spawn("unzip", ["-d", join(dir, "out"), zipPath]);
        proc.on("close", (code) =>
          code === 0 ? resolve() : reject(new Error(`unzip exit ${code}`)),
        );
        proc.on("error", reject);
      });

      // bundle.json existiert + hat zipPath
      const bundle = JSON.parse(await readFile(join(dir, "out", "bundle.json"), "utf8"));
      expect(bundle.fileRefs).toHaveLength(1);
      const expectedZipPath = `files/${tenantA}/f1-report.pdf`;
      expect(bundle.fileRefs[0].zipPath).toBe(expectedZipPath);

      // The file bytes are stored at exactly this path.
      const fileBytes = await readFile(join(dir, "out", expectedZipPath));
      expect(Array.from(fileBytes)).toEqual([1, 2, 3, 4, 5]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("multi-tenant: fileRefs aus 2 Tenants → 2 separate Provider-Builds (cache-invariant)", async () => {
    const tenantB = testTenantId(2);
    await seedMembership(tenantA, aliceUser.id);
    await seedMembership(tenantB, aliceUser.id);
    await seedFileBytes(tenantA, `${tenantA}/test-file/f1.pdf`, new Uint8Array([10]));
    await seedFileBytes(tenantB, `${tenantB}/test-file/f1.pdf`, new Uint8Array([20]));

    const jobId = await seedPendingJobLocal(aliceUser);

    const result = await runExportJobs({
      db: localStack.db,
      registry: localStack.registry,
      buildStorageProvider: spiedBuildProvider,
      now: NOW(),
    });

    expect(result.completedJobIds).toContain(jobId);

    // The job tenant's provider serves both the output write and its fileRef read;
    // the second tenant requires one provider for its fileRef read. Additional
    // reads for either tenant must reuse the cached provider.
    expect(providerCallsByTenant.get(tenantA)).toBe(1);
    expect(providerCallsByTenant.get(tenantB)).toBe(1);
  });

  test("missing file: storage key does not exist → job=failed with clear error", async () => {
    await seedMembership(tenantA, aliceUser.id);
    // Deliberately omit seedFileBytes so the missing storage key causes readStream
    // to throw on the first chunk pull.
    const jobId = await seedPendingJobLocal(aliceUser);

    const result = await runExportJobs({
      db: localStack.db,
      registry: localStack.registry,
      buildStorageProvider: spiedBuildProvider,
      now: NOW(),
    });

    expect(result.completedJobIds).not.toContain(jobId);
    expect(result.failedJobIds).toContain(jobId);
    expect(result.errors[0]?.message).toMatch(/in-memory file not found/);

    const [row] = (await selectMany(localStack.db, exportJobsTable, { id: jobId })) as Array<{
      status: string;
      errorMessage: string | null;
    }>;
    expect(row?.status).toBe(EXPORT_JOB_STATUS.Failed);
    expect(row?.errorMessage).toMatch(/in-memory file not found/);
  });

  test("malicious filename: '../../etc/passwd' remains in the ZIP root (defense-in-depth e2e)", async () => {
    // Defense in depth: exercise the full chain
    //   user-input fileName → buildFileRefZipPath → bundle.fileRefs[].zipPath
    //   → bundleToZipEntries → ZipEntry.path → unzip.
    // A user-provided "../../etc/passwd" must never make a ZIP reader write
    // outside the extraction root. The unit test covers path construction; this
    // integration test verifies that sanitization survives the complete pipeline.
    currentTestFileName = "../../etc/passwd";
    await seedMembership(tenantA, aliceUser.id);
    await seedFileBytes(
      tenantA,
      `${tenantA}/test-file/f1.pdf`,
      new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
    );

    const jobId = await seedPendingJobLocal(aliceUser);
    const result = await runExportJobs({
      db: localStack.db,
      registry: localStack.registry,
      buildStorageProvider: spiedBuildProvider,
      now: NOW(),
    });
    expect(result.completedJobIds).toContain(jobId);

    const provider = await buildProvider(tenantA);
    const zipBytes = await provider.read(`exports/${tenantA}/${jobId}.zip`);
    const dir = await mkdtemp(join(tmpdir(), "kumiko-3c-malicious-"));
    try {
      const zipPath = join(dir, "out.zip");
      const extractRoot = join(dir, "out");
      await writeFile(zipPath, zipBytes);
      await new Promise<void>((resolve, reject) => {
        const proc = spawn("unzip", ["-d", extractRoot, zipPath]);
        proc.on("close", (code) =>
          code === 0 ? resolve() : reject(new Error(`unzip exit ${code}`)),
        );
        proc.on("error", reject);
      });

      const bundle = JSON.parse(await readFile(join(extractRoot, "bundle.json"), "utf8"));
      expect(bundle.fileRefs[0].zipPath).not.toContain("..");
      expect(bundle.fileRefs[0].zipPath).toMatch(/^files\//);

      // The ZIP entry path must match bundle.json's zipPath, so extraction cannot
      // write a file outside extractRoot. unzip would only skip a traversing entry
      // with a warning, so check the filesystem outside extractRoot directly.
      const dirAbove = join(dir, "..");
      const escapedFile = join(dirAbove, "etc", "passwd");
      const { access } = await import("node:fs/promises");
      await expect(access(escapedFile)).rejects.toThrow();

      // The bytes sit under the sanitized path in the ZIP root.
      const fileBytes = await readFile(join(extractRoot, bundle.fileRefs[0].zipPath));
      expect(Array.from(fileBytes)).toEqual([0xde, 0xad, 0xbe, 0xef]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("runExportJobs :: Atom 5 notification-callbacks", () => {
  test("done job: sendExportReadyEmail is called with downloadUrl + userEmail", async () => {
    const jobId = await seedPendingJob();
    type SentArgs = {
      userId: string;
      userEmail: string;
      jobId: string;
      downloadUrl: string;
      expiresAt: string;
      bytesWritten: number | null;
      tenantId: string;
    };
    const sentEmails: SentArgs[] = [];
    const exportReadyMock = async (args: SentArgs) => {
      sentEmails.push(args);
    };

    const result = await runExportJobs({
      db: stack.db,
      registry: stack.registry,
      buildStorageProvider: buildProvider,
      now: NOW(),
      sendExportReadyEmail: exportReadyMock,
      appExportDownloadUrl: "https://app.example.com/user-export/by-token",
    });

    expect(result.completedJobIds).toContain(jobId);
    expect(sentEmails).toHaveLength(1);
    const sent = sentEmails[0];
    if (!sent) throw new Error("expected 1 sent email");
    expect(sent.userId).toBe(String(aliceUser.id));
    expect(sent.userEmail).toBe("alice@example.com");
    expect(sent.jobId).toBe(jobId);
    expect(sent.downloadUrl).toMatch(
      /^https:\/\/app\.example\.com\/user-export\/by-token#token=[A-Za-z0-9_%-]+$/,
    );
    const plainFromResult = result.tokenByJobId.get(jobId);
    expect(plainFromResult).toBeDefined();
    expect(sent.downloadUrl).toContain(encodeURIComponent(plainFromResult ?? ""));
  });

  test("done job without callback: no email, worker run succeeded", async () => {
    const jobId = await seedPendingJob();
    const result = await runExportJobs({
      db: stack.db,
      registry: stack.registry,
      buildStorageProvider: buildProvider,
      now: NOW(),
      // Kein sendExportReadyEmail/appExportDownloadUrl
    });
    expect(result.completedJobIds).toContain(jobId);
  });

  test("done job with callback but without appExportDownloadUrl → throw bubbles to r.job", async () => {
    // Reject this configuration clearly when a callback is supplied without its
    // required URL; the worker error is wrapped by r.job in jobRunsTable.
    await seedPendingJob();
    await expect(
      runExportJobs({
        db: stack.db,
        registry: stack.registry,
        buildStorageProvider: buildProvider,
        now: NOW(),
        sendExportReadyEmail: async () => {
          // unreachable — fireExportReadyCallback throws first
        },
        // appExportDownloadUrl is intentionally omitted
      }),
    ).rejects.toThrow(/appExportDownloadUrl fehlt/);
  });

  test("user without email → callback skipped + console.warn (no throw)", async () => {
    // The worker logs a warning, skips the callback, and the worker run remains successful.
    await clearAliceEmail();
    const jobId = await seedPendingJob();
    let callbackInvoked = false;
    await runExportJobs({
      db: stack.db,
      registry: stack.registry,
      buildStorageProvider: buildProvider,
      now: NOW(),
      sendExportReadyEmail: async () => {
        callbackInvoked = true;
      },
      appExportDownloadUrl: "https://app/user-export/by-token",
    });
    // The callback is not invoked because userEmail is empty
    expect(callbackInvoked).toBe(false);
    // The job is still done because notification is best-effort; the token DB row
    // provides the audit trail.
    const [row] = (await selectMany(stack.db, exportJobsTable, { id: jobId })) as Array<{
      status: string;
    }>;
    expect(row?.status).toBe("done");
  });

  test("Atom 5.fix3 best-effort: callback-Throw fuer Job A killt Batch NICHT — Job B trotzdem verarbeitet", async () => {
    // If sendExportReadyEmail throws, the batch must continue. Job A's status is
    // already committed as done, so a retry finds no pending jobs; without
    // continuation, the failure would be silent and the ZIP would expire
    // without the user receiving the email.
    //
    // The try/catch logs the error with console.warn and continues to Job B.
    const bobUser = createTestUser({
      id: 7,
      tenantId: tenantA,
      roles: ["Member"],
    });
    await seedRowViaEventStore(stack.db, userTable, {
      id: String(bobUser.id),
      email: "bob@example.com",
      passwordHash: "h",
      displayName: "Bob",
      locale: "de",
      emailVerified: true,
      roles: '["Member"]',
      status: USER_STATUS.Active,
    });

    const jobAId = await seedPendingJob();
    const jobBId = await seedPendingJob({ user: bobUser });

    const calls: string[] = [];
    const result = await runExportJobs({
      db: stack.db,
      registry: stack.registry,
      buildStorageProvider: buildProvider,
      now: NOW(),
      sendExportReadyEmail: async (sentArgs) => {
        calls.push(sentArgs.jobId);
        if (sentArgs.jobId === jobAId) {
          throw new Error("synthetic email transport failure for job A");
        }
      },
      appExportDownloadUrl: "https://app.example.com/user-export/by-token",
    });

    // Both jobs are processed; Job A's throw does not stop Job B. This verifies
    // continuation after the try/catch.
    expect(result.completedJobIds).toContain(jobAId);
    expect(result.completedJobIds).toContain(jobBId);
    expect(calls.sort()).toEqual([jobAId, jobBId].sort());

    // Both database rows are actually done because Job A's status was committed
    // before the email was sent; the throw cannot change it.
    const rows = (await selectMany(stack.db, exportJobsTable, {})) as Array<{
      id: string;
      status: string;
    }>;
    const filteredRows = rows.filter((r) => r.id === jobAId || r.id === jobBId);
    expect(filteredRows).toHaveLength(2);
    expect(filteredRows.every((r) => r.status === "done")).toBe(true);
  });
});
