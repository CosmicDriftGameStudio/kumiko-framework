// runExportJobs Worker Integration-Test (S2.U3 Atom 3b).
//
// Pinst die Worker-Pipeline end-to-end mit dem in-memory-Storage-Provider:
//
//   1. Happy path: pending Job → Worker pickt → Bundle gebaut → ZIP an
//      Storage geschrieben → Job=done mit downloadStorageKey + expiresAt
//      + bytesWritten
//   2. ZIP wirklich entpackbar (Info-ZIP) und enthaelt das Bundle
//   3. Stale-Detection: running-Job ueber TTL → failed
//   4. Worker-Throw: failing Hook → Job=failed mit errorMessage
//   5. Storage-Cleanup: done-Job mit expiresAt+grace im Past →
//      downloadStorageKey wird genullt + storage-key geloescht
//   6. Idempotency: 2× run → kein Re-Processing von done/failed-Jobs

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createInMemoryFileProvider,
  type FileStorageProvider,
} from "@cosmicdrift/kumiko-framework/files";
import {
  createEntityTable,
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
} from "@cosmicdrift/kumiko-framework/stack";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles";
import { createDataRetentionFeature } from "../../data-retention";
import { createUserFeature } from "../../user";
import { createUserDataRightsFeature } from "../feature";
import { runExportJobs } from "../run-export-jobs";
import { EXPORT_JOB_STATUS, exportJobEntity, exportJobsTable } from "../schema/export-job";

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
      createUserDataRightsFeature(),
    ],
  });
  await createEntityTable(stack.db, exportJobEntity);
  await createEntityTable(stack.db, tenantComplianceProfileEntity);
  await createEventsTable(stack.db);
  // tenant-membership-table fuer runUserExport's Cross-Tenant-Iteration.
  // Pattern matched user-data-rights-defaults integration-test.
  await stack.db.execute(sql`
    CREATE TABLE IF NOT EXISTS read_tenant_memberships (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL,
      user_id TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 0,
      inserted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      modified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      inserted_by_id TEXT,
      modified_by_id TEXT,
      is_deleted BOOLEAN NOT NULL DEFAULT false,
      deleted_at TIMESTAMPTZ,
      deleted_by_id TEXT,
      roles TEXT NOT NULL DEFAULT '[]',
      UNIQUE(user_id, tenant_id)
    )
  `);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await stack.db.delete(exportJobsTable);
  await stack.db.execute(sql`DELETE FROM kumiko_events`);
  await stack.db.execute(sql`DELETE FROM read_tenant_compliance_profiles`);
  await stack.db.execute(sql`DELETE FROM read_tenant_memberships`);
  providerPerTenant = new Map();
});

const NOW = () => getTemporal().Now.instant();

function buildProvider(tenantId: string): Promise<FileStorageProvider> {
  let p = providerPerTenant.get(tenantId);
  if (!p) {
    p = createInMemoryFileProvider();
    providerPerTenant.set(tenantId, p);
  }
  return Promise.resolve(p);
}

// Seedet einen pending Job via realen request-export-Handler — echter
// ES-Pfad (crud.create emittiert event "export-job.created"), nicht
// direct-INSERT. Direct-INSERT wuerde stream-version=0/row-version=1
// drift erzeugen + Worker-claim mit version-conflict failen.
async function seedPendingJob(opts: { user?: typeof aliceUser } = {}): Promise<string> {
  const result = await stack.http.writeOk<{ jobId: string }>(
    "user-data-rights:write:request-export",
    {},
    opts.user ?? aliceUser,
  );
  return result.jobId;
}

describe("runExportJobs :: happy path", () => {
  test("pending Job → Worker pickt → done mit downloadStorageKey + bytesWritten", async () => {
    const jobId = await seedPendingJob();

    const result = await runExportJobs({
      db: stack.db,
      registry: stack.registry,
      buildStorageProvider: buildProvider,
      now: NOW(),
    });

    expect(result.completedJobIds).toContain(jobId);
    expect(result.errors).toEqual([]);

    // Job-Row ist done
    const [row] = (await stack.db
      .select()
      .from(exportJobsTable)
      .where(sql`id = ${jobId}`)) as Array<{
      status: string;
      downloadStorageKey: string | null;
      expiresAt: { toString(): string } | null;
      bytesWritten: number | null;
    }>;
    expect(row?.status).toBe(EXPORT_JOB_STATUS.Done);
    expect(row?.downloadStorageKey).toBe(`${tenantA}/exports/${jobId}.zip`);
    expect(row?.expiresAt).not.toBeNull();
    expect(row?.bytesWritten).toBeGreaterThan(0);

    // ZIP wirklich im Storage
    const provider = await buildProvider(tenantA);
    expect(await provider.exists(`${tenantA}/exports/${jobId}.zip`)).toBe(true);
  });

  test("ZIP ist real entpackbar via Info-ZIP + enthaelt bundle.json", async () => {
    const jobId = await seedPendingJob();

    await runExportJobs({
      db: stack.db,
      registry: stack.registry,
      buildStorageProvider: buildProvider,
      now: NOW(),
    });

    const provider = await buildProvider(tenantA);
    const zipBytes = await provider.read(`${tenantA}/exports/${jobId}.zip`);

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
  test("running-Job mit startedAt > exportStaleTimeoutMinutes → failed", async () => {
    // Seed via echten Pfad damit event-stream existiert; dann direct-
    // update auf running mit alter startedAt (Test-Exemption vom Guard).
    const jobId = await seedPendingJob();
    const T = getTemporal();
    const twoHoursAgo = T.Instant.fromEpochMilliseconds(Date.now() - 2 * 60 * 60 * 1000);
    await stack.db
      .update(exportJobsTable)
      .set({ status: EXPORT_JOB_STATUS.Running, startedAt: twoHoursAgo })
      .where(sql`id = ${jobId}`);

    const result = await runExportJobs({
      db: stack.db,
      registry: stack.registry,
      buildStorageProvider: buildProvider,
      now: NOW(),
    });

    expect(result.staleFailedJobIds).toContain(jobId);

    const [row] = (await stack.db
      .select()
      .from(exportJobsTable)
      .where(sql`id = ${jobId}`)) as Array<{
      status: string;
      errorMessage: string | null;
    }>;
    expect(row?.status).toBe(EXPORT_JOB_STATUS.Failed);
    expect(row?.errorMessage).toMatch(/stale: worker crashed/i);
  });

  test("running-Job mit startedAt UNTER stale-Cutoff bleibt running", async () => {
    const jobId = await seedPendingJob();
    const T = getTemporal();
    const justNow = T.Instant.fromEpochMilliseconds(Date.now() - 60 * 1000); // 1min ago
    await stack.db
      .update(exportJobsTable)
      .set({ status: EXPORT_JOB_STATUS.Running, startedAt: justNow })
      .where(sql`id = ${jobId}`);

    const result = await runExportJobs({
      db: stack.db,
      registry: stack.registry,
      buildStorageProvider: buildProvider,
      now: NOW(),
    });

    expect(result.staleFailedJobIds).not.toContain(jobId);
    const [row] = (await stack.db
      .select()
      .from(exportJobsTable)
      .where(sql`id = ${jobId}`)) as Array<{ status: string }>;
    expect(row?.status).toBe(EXPORT_JOB_STATUS.Running);
  });
});

describe("runExportJobs :: storage-cleanup", () => {
  test("done-Job mit expiresAt+grace in Vergangenheit → downloadStorageKey null + Datei geloescht", async () => {
    const jobId = await seedPendingJob();
    const T = getTemporal();
    const longAgo = T.Instant.fromEpochMilliseconds(
      Date.now() - 365 * 24 * 60 * 60 * 1000, // 1 Jahr ago
    );
    const storageKey = `${tenantA}/exports/${jobId}.zip`;
    const provider = await buildProvider(tenantA);
    await provider.write(storageKey, new Uint8Array([1, 2, 3]));

    await stack.db
      .update(exportJobsTable)
      .set({
        status: EXPORT_JOB_STATUS.Done,
        startedAt: longAgo,
        completedAt: longAgo,
        downloadStorageKey: storageKey,
        expiresAt: longAgo,
      })
      .where(sql`id = ${jobId}`);

    const result = await runExportJobs({
      db: stack.db,
      registry: stack.registry,
      buildStorageProvider: buildProvider,
      now: NOW(),
    });

    expect(result.cleanedJobIds).toContain(jobId);
    expect(await provider.exists(storageKey)).toBe(false);

    const [row] = (await stack.db
      .select()
      .from(exportJobsTable)
      .where(sql`id = ${jobId}`)) as Array<{
      status: string;
      downloadStorageKey: string | null;
    }>;
    expect(row?.status).toBe(EXPORT_JOB_STATUS.Done);
    expect(row?.downloadStorageKey).toBeNull();
  });

  test("done-Job mit frisch-expiresAt (innerhalb grace) bleibt — Pufferzone", async () => {
    const jobId = await seedPendingJob();
    const T = getTemporal();
    const oneHourAgo = T.Instant.fromEpochMilliseconds(Date.now() - 60 * 60 * 1000);
    const storageKey = `${tenantA}/exports/${jobId}.zip`;
    const provider = await buildProvider(tenantA);
    await provider.write(storageKey, new Uint8Array([4, 5, 6]));

    await stack.db
      .update(exportJobsTable)
      .set({
        status: EXPORT_JOB_STATUS.Done,
        startedAt: oneHourAgo,
        completedAt: oneHourAgo,
        downloadStorageKey: storageKey,
        expiresAt: oneHourAgo,
      })
      .where(sql`id = ${jobId}`);

    const result = await runExportJobs({
      db: stack.db,
      registry: stack.registry,
      buildStorageProvider: buildProvider,
      now: NOW(),
    });

    expect(result.cleanedJobIds).not.toContain(jobId);
    expect(await provider.exists(storageKey)).toBe(true);
  });
});

describe("runExportJobs :: idempotency", () => {
  test("zweiter Run nach done ist no-op fuer den selben Job", async () => {
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
    // 2nd Run findet keine pending Jobs mehr (status=done)
    expect(second.completedJobIds).toEqual([]);
    expect(second.failedJobIds).toEqual([]);
  });
});
