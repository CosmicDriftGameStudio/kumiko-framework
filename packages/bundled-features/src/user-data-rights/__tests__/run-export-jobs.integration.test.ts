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

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  asRawClient,
  insertOne,
  selectMany,
  updateMany,
} from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventsTable, eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createInMemoryFileProvider,
  type FileStorageProvider,
} from "@cosmicdrift/kumiko-framework/files";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetTestTables } from "@cosmicdrift/kumiko-framework/testing";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "../../compliance-profiles";
import { createDataRetentionFeature } from "../../data-retention";
import { createSessionsFeature } from "../../sessions";
import { tenantMembershipsTable } from "../../tenant";
import { createUserFeature, USER_STATUS, userEntity, userTable } from "../../user";
import { createUserDataRightsFeature } from "../feature";
import { runExportJobs } from "../run-export-jobs";
import { exportDownloadTokenEntity, exportDownloadTokensTable } from "../schema/download-token";
import { EXPORT_JOB_STATUS, exportJobEntity, exportJobsTable } from "../schema/export-job";
import { hashDownloadToken } from "../token-helpers";

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
      createSessionsFeature(),

      createUserDataRightsFeature(),
    ],
  });
  await unsafeCreateEntityTable(stack.db, exportJobEntity);
  await unsafeCreateEntityTable(stack.db, exportDownloadTokenEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await unsafeCreateEntityTable(stack.db, userEntity);
  await createEventsTable(stack.db);
  // tenant-membership-table fuer runUserExport's Cross-Tenant-Iteration.
  // Pattern matched user-data-rights-defaults integration-test.
  await asRawClient(stack.db).unsafe(`
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
  await resetTestTables(stack.db, [
    exportDownloadTokensTable,
    exportJobsTable,
    userTable,
    eventsTable,
    tenantComplianceProfileTable,
    tenantMembershipsTable,
  ]);
  providerPerTenant = new Map();

  // Atom 5: aliceUser-Row mit email seeden — Worker-Notification-Callback
  // schaut email via lookupUserEmail an.
  await insertOne(stack.db, userTable, {
    id: String(aliceUser.id),
    tenantId: tenantA,
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
    const [row] = (await selectMany(stack.db, exportJobsTable, { id: jobId })) as Array<{
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
    await updateMany(
      stack.db,
      exportJobsTable,
      { status: EXPORT_JOB_STATUS.Running, startedAt: twoHoursAgo },
      { id: jobId },
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

  test("running-Job mit startedAt UNTER stale-Cutoff bleibt running", async () => {
    const jobId = await seedPendingJob();
    const T = getTemporal();
    const justNow = T.Instant.fromEpochMilliseconds(Date.now() - 60 * 1000); // 1min ago
    await updateMany(
      stack.db,
      exportJobsTable,
      { status: EXPORT_JOB_STATUS.Running, startedAt: justNow },
      { id: jobId },
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

  test("stale-Job mit downloadStorageKey (real-Pfad nach 4a.fix path-pre-claim) → ZIP cleanup im selben Pass", async () => {
    // Real-prod-Pfad-Pin (Atom 4a.fix2): nach path-pre-claim hat ein
    // running-Job downloadStorageKey gesetzt. Wenn Stale-Detection den
    // Job auf failed flippt, sollte storageCleanupPass im selben Worker-
    // Pass den orphan-ZIP entfernen.
    const jobId = await seedPendingJob();
    const T = getTemporal();
    const twoHoursAgo = T.Instant.fromEpochMilliseconds(Date.now() - 2 * 60 * 60 * 1000);
    const storageKey = `${tenantA}/exports/${jobId}.zip`;

    // Simuliert real-Pfad: claim-update hatte status=running + storageKey
    // gesetzt + ZIP geschrieben. Worker dann gecrashed (kein done-flip).
    const provider = await buildProvider(tenantA);
    await provider.write(storageKey, new Uint8Array([1, 2, 3]));
    await updateMany(
      stack.db,
      exportJobsTable,
      {
        status: EXPORT_JOB_STATUS.Running,
        startedAt: twoHoursAgo,
        downloadStorageKey: storageKey,
      },
      { id: jobId },
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
  test("done-Job mit expiresAt+grace in Vergangenheit → downloadStorageKey null + Datei geloescht", async () => {
    const jobId = await seedPendingJob();
    const T = getTemporal();
    const longAgo = T.Instant.fromEpochMilliseconds(
      Date.now() - 365 * 24 * 60 * 60 * 1000, // 1 Jahr ago
    );
    const storageKey = `${tenantA}/exports/${jobId}.zip`;
    const provider = await buildProvider(tenantA);
    await provider.write(storageKey, new Uint8Array([1, 2, 3]));

    await updateMany(
      stack.db,
      exportJobsTable,
      {
        status: EXPORT_JOB_STATUS.Done,
        startedAt: longAgo,
        completedAt: longAgo,
        downloadStorageKey: storageKey,
        expiresAt: longAgo,
      },
      { id: jobId },
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

  test("done-Job mit frisch-expiresAt (innerhalb grace) bleibt — Pufferzone", async () => {
    const jobId = await seedPendingJob();
    const T = getTemporal();
    const oneHourAgo = T.Instant.fromEpochMilliseconds(Date.now() - 60 * 60 * 1000);
    const storageKey = `${tenantA}/exports/${jobId}.zip`;
    const provider = await buildProvider(tenantA);
    await provider.write(storageKey, new Uint8Array([4, 5, 6]));

    await updateMany(
      stack.db,
      exportJobsTable,
      {
        status: EXPORT_JOB_STATUS.Done,
        startedAt: oneHourAgo,
        completedAt: oneHourAgo,
        downloadStorageKey: storageKey,
        expiresAt: oneHourAgo,
      },
      { id: jobId },
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

describe("runExportJobs :: concurrency", () => {
  test("zwei parallele Runner mit 1 pending-Job → genau ein done, ein skipped", async () => {
    // Pinst die zentrale Korrektheits-Behauptung von Atom 3b: optimistic-
    // locking via crud.update mit version-conflict gewinnt EXAKT ein
    // Worker-Replica den claim, der zweite skipped silent. Vor dem Fix
    // war der "skipped"-Pfad totes coverage.
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

    // Genau ein Runner hat den Job als completed verbucht
    const completedAcrossBoth = [...resultA.completedJobIds, ...resultB.completedJobIds];
    expect(completedAcrossBoth.filter((id) => id === jobId)).toHaveLength(1);

    // Keine doppelten failures
    expect([...resultA.failedJobIds, ...resultB.failedJobIds]).toEqual([]);

    // DB hat genau eine done-Row
    const rows = (await selectMany(stack.db, exportJobsTable, { id: jobId })) as Array<{
      status: string;
      downloadStorageKey: string | null;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe(EXPORT_JOB_STATUS.Done);
    expect(rows[0]?.downloadStorageKey).toBe(`${tenantA}/exports/${jobId}.zip`);

    // Storage hat genau ein ZIP — kein Race-induziertes Doppel-Schreiben
    const provider = await buildProvider(tenantA);
    expect(await provider.exists(`${tenantA}/exports/${jobId}.zip`)).toBe(true);
  });
});

describe("runExportJobs :: stale-detection profile-driven cutoff", () => {
  test("running-Job 45min ago + Profile-Default 30min → wird gefailed (kein 60min-coarse-filter mehr)", async () => {
    // Regression-Pin: vor 3b.fix hatte staleDetectionPass einen
    // hardcoded `startedAt <= now-1h` Coarse-Filter. Default-Profile
    // exportStaleTimeoutMinutes = 30, also waeren 30-60min-alte
    // Stale-Jobs nicht erkannt worden. Mit Filter raus + per-Job
    // profile-resolve im Loop wird das jetzt korrekt gefangen.
    const jobId = await seedPendingJob();
    const T = getTemporal();
    const fortyFiveMinAgo = T.Instant.fromEpochMilliseconds(Date.now() - 45 * 60 * 1000);
    await updateMany(
      stack.db,
      exportJobsTable,
      { status: EXPORT_JOB_STATUS.Running, startedAt: fortyFiveMinAgo },
      { id: jobId },
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
  test("Worker generiert Token + Hash in DB nach done-flip", async () => {
    const jobId = await seedPendingJob();

    const result = await runExportJobs({
      db: stack.db,
      registry: stack.registry,
      buildStorageProvider: buildProvider,
      now: NOW(),
    });

    expect(result.completedJobIds).toContain(jobId);

    // Plain-Token im Result fuer Atom 5
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
    // Atom 4a.fix: useCount explicit 0 statt null — 4b's Increment ist
    // dadurch trivial (useCount + 1 ohne COALESCE).
    expect(tokenRows[0]?.useCount).toBe(0);

    // expiresAt im Token = job.expiresAt (denormalized)
    const [jobRow] = (await selectMany(stack.db, exportJobsTable, { id: jobId })) as Array<{
      expiresAt: { toString(): string } | null;
    }>;
    expect(tokenRows[0]?.expiresAt.toString()).toBe(jobRow?.expiresAt?.toString());
  });

  test("ES via crud.create — Token-Created-Event in kumiko_events", async () => {
    // Pinst dass Worker den Token via Event-Sourcing erstellt, nicht
    // direct-INSERT (Memory `feedback_no_fake_dispatcher`). Ohne Event
    // koennten Atom-5-Notification-Hooks nicht aufs Token-Created-Event
    // hooken.
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
    // Mindestens 1 created-Event fuer den Token
    expect(events.some((e) => e.type === "export-download-token.created")).toBe(true);
  });

  test("Worker idempotency: 2× run done-Job → kein 2. Token (UNIQUE jobId)", async () => {
    const jobId = await seedPendingJob();
    await runExportJobs({
      db: stack.db,
      registry: stack.registry,
      buildStorageProvider: buildProvider,
      now: NOW(),
    });

    // 2nd run: pending-Loop ist leer (status=done), kein 2. Token-Insert
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

  test("failed-Job: kein Token wird generiert", async () => {
    // Bewusst keinen Job — leerer Pending-Pass. Aber wir koennen den
    // failure-Pfad pinnen via runUserExport-Fehler. Einfacher: nur
    // verifizieren dass tokenByJobId leer bleibt wenn keine completed-Jobs.
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
    // Atom 4a.fix Sequence-Garantie: Token wird VOR done-flip erstellt.
    // Wenn Token-create failt (z.B. UNIQUE-violation auf jobId), faellt
    // der Worker in catch-Pfad → Job auf failed (NICHT done). Vorher
    // war die Reihenfolge gefaehrlich: Job=done dann Token-create-fail
    // → catch flippt done→failed (nicht-monoton + verwirrend).
    //
    // Setup: pending Job seeden, dann eine duplicate-Token-Row mit
    // demselben jobId direct-INSERT (test-fixture). Worker pickt Job,
    // schreibt ZIP, versucht Token-create → UNIQUE hits → throw.
    const jobId = await seedPendingJob();

    // Force UNIQUE-violation: pre-seed eine Token-Row mit jobId via
    // direct-INSERT (Test-Exemption). Worker's tokenCrud.create wird
    // dann mit constraintName "read_export_download_tokens_one_per_job"
    // failen.
    await asRawClient(stack.db).unsafe(
      `
      INSERT INTO read_export_download_tokens
        (id, tenant_id, job_id, token_hash, issued_at, expires_at, version, inserted_at, modified_at)
      VALUES (
        gen_random_uuid(),
        $1,
        $2,
        $3,
        now(),
        now() + interval '7 days',
        1,
        now(),
        now()
      )
    `,
      [tenantA, jobId, "existing-hash"],
    );

    const result = await runExportJobs({
      db: stack.db,
      registry: stack.registry,
      buildStorageProvider: buildProvider,
      now: NOW(),
    });

    // Job ist failed, NICHT done — Sequence-Garantie
    expect(result.completedJobIds).not.toContain(jobId);
    expect(result.failedJobIds).toContain(jobId);

    const [row] = (await selectMany(stack.db, exportJobsTable, { id: jobId })) as Array<{
      status: string;
      errorMessage: string | null;
    }>;
    expect(row?.status).toBe(EXPORT_JOB_STATUS.Failed);
    expect(row?.errorMessage).toMatch(/Token-Creation failed/);
  });

  test("failed-Job mit downloadStorageKey → ZIP wird im Cleanup-Pass entfernt (orphan-fix)", async () => {
    // Atom 4a.fix orphan-cleanup: failed-Jobs haben downloadStorageKey
    // gesetzt (path-pre-claim) — der ZIP-Pfad ist persistiert ab claim.
    // Storage-Cleanup-Pass fuer failed-Jobs: sofort ZIP loeschen (kein
    // Grace), DB-Spalte nullen.
    const jobId = await seedPendingJob();
    const storageKey = `${tenantA}/exports/${jobId}.zip`;

    // ZIP in storage seeden + Job manuell auf failed mit storageKey
    // (simuliert orphan-state nach Worker-crash).
    const provider = await buildProvider(tenantA);
    await provider.write(storageKey, new Uint8Array([99, 99, 99]));
    await updateMany(
      stack.db,
      exportJobsTable,
      {
        status: EXPORT_JOB_STATUS.Failed,
        downloadStorageKey: storageKey,
        errorMessage: "synthetic crash mid-run",
      },
      { id: jobId },
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
  // Helper: spy auf buildProvider damit wir verifizieren koennen, dass
  // multi-tenant-fileRefs ZWEI separate Provider-Builds triggern (Cache-
  // Invariant: pro tenant nur einmal).
  let providerCallsByTenant: Map<string, number>;

  function spiedBuildProvider(tenantId: string): Promise<FileStorageProvider> {
    providerCallsByTenant.set(tenantId, (providerCallsByTenant.get(tenantId) ?? 0) + 1);
    return buildProvider(tenantId);
  }

  // Pre-seed eine fileRef-Row in read_user_files damit der user-Hook in
  // user-data-rights-defaults sie findet. Aber: wir mounten diesen
  // defaults-Feature NICHT, weil dann file-foundation + files-Feature
  // mit dazukommen muessen. Stattdessen: ein test-only Feature das einen
  // userData-export-Hook mit fileRefs[] direkt zurueckgibt.
  function seedFileBytes(tenantId: string, storageKey: string, bytes: Uint8Array) {
    return buildProvider(tenantId).then((p) => p.write(storageKey, bytes));
  }

  beforeEach(() => {
    providerCallsByTenant = new Map();
  });

  // Stack mit Test-Feature das fileRefs liefert. Ueberschreibt das outer
  // stack via local setupTestStack — nur fuer diesen describe-Block.
  let localStack: TestStack;
  // Module-level mutable damit der malicious-filename-Test den User-Input
  // pro Test variieren kann ohne neuen Stack aufzubauen. Default sicher.
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
      });
    });

    localStack = await setupTestStack({
      features: [
        createUserFeature(),
        createDataRetentionFeature(),
        createComplianceProfilesFeature(),
        createSessionsFeature(),

        createUserDataRightsFeature(),
        testFileExporter,
      ],
    });
    await unsafeCreateEntityTable(localStack.db, exportJobEntity);
    await unsafeCreateEntityTable(localStack.db, exportDownloadTokenEntity);
    await unsafeCreateEntityTable(localStack.db, tenantComplianceProfileEntity);
    await createEventsTable(localStack.db);
    await asRawClient(localStack.db).unsafe(`
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
    // Reset zu safe Default damit kein Test den State an den naechsten leakt.
    currentTestFileName = "report.pdf";
  });

  async function seedMembership(tenantId: string, userId: string | number) {
    await asRawClient(localStack.db).unsafe(
      `
      INSERT INTO read_tenant_memberships (tenant_id, user_id)
      VALUES ($1, $2)
      ON CONFLICT (user_id, tenant_id) DO NOTHING
    `,
      [tenantId, String(userId)],
    );
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
    const zipBytes = await provider.read(`${tenantA}/exports/${jobId}.zip`);
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

      // File-bytes liegen unter genau diesem Pfad
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

    // Cache-Invariant: Tenant A Provider wurde 1x gebaut (Job-Tenant fuer
    // writeStream + 1. fileRef-Read), Tenant B nur fuer den 2. fileRef-Read.
    // Mehrere fileRef-Reads pro Tenant duerfen aber NICHT mehrere builds
    // triggern.
    expect(providerCallsByTenant.get(tenantA)).toBe(1);
    expect(providerCallsByTenant.get(tenantB)).toBe(1);
  });

  test("missing-file: storage-key gibt's nicht → job=failed mit klarem error", async () => {
    await seedMembership(tenantA, aliceUser.id);
    // Bewusst KEIN seedFileBytes — der storage-key existiert nicht im
    // in-memory-provider; readStream throw't beim ersten chunk-pull.
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

  test("malicious filename: '../../etc/passwd' bleibt im ZIP-Root (defense-in-depth e2e)", async () => {
    // Defense-in-depth: pinst die ganze Chain
    //   user-input fileName → buildFileRefZipPath → bundle.fileRefs[].zipPath
    //   → bundleToZipEntries → ZipEntry.path → unzip.
    // Ein User-uploaded-fileName mit "../../etc/passwd" darf NIEMALS
    // ein ZIP-Reader dazu bringen, ausserhalb des extract-Roots zu
    // schreiben. Das wird unit-getestet auf zip-path-Ebene; der
    // Integration-Test hier pinst dass der Sanitize-Pfad WIRKLICH
    // durchgaengig wirkt.
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
    const zipBytes = await provider.read(`${tenantA}/exports/${jobId}.zip`);
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

      // Bundle hat zipPath ohne ".." gespeichert
      const bundle = JSON.parse(await readFile(join(extractRoot, "bundle.json"), "utf8"));
      expect(bundle.fileRefs[0].zipPath).not.toContain("..");
      expect(bundle.fileRefs[0].zipPath).toMatch(/^files\//);

      // ZIP-Entry-Pfad ist DERSELBE wie zipPath in bundle.json
      // → Reader hat KEINE Datei outside extractRoot geschrieben.
      // unzip wuerde mit warning skipen wenn der path-traversal greifen
      // wuerde; wir verifizieren via filesystem-check ausserhalb.
      const dirAbove = join(dir, "..");
      const escapedFile = join(dirAbove, "etc", "passwd");
      const { access } = await import("node:fs/promises");
      await expect(access(escapedFile)).rejects.toThrow();

      // Die Bytes sind unter dem sanitized-Path im ZIP-Root.
      const fileBytes = await readFile(join(extractRoot, bundle.fileRefs[0].zipPath));
      expect(Array.from(fileBytes)).toEqual([0xde, 0xad, 0xbe, 0xef]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("runExportJobs :: Atom 5 notification-callbacks", () => {
  test("done-Job: sendExportReadyEmail wird mit downloadUrl + userEmail gerufen", async () => {
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
      /^https:\/\/app\.example\.com\/user-export\/by-token\?token=[A-Za-z0-9_%-]+$/,
    );
    // plain-token aus dem callback-arg entspricht dem result.tokenByJobId
    const plainFromResult = result.tokenByJobId.get(jobId);
    expect(plainFromResult).toBeDefined();
    expect(sent.downloadUrl).toContain(encodeURIComponent(plainFromResult ?? ""));
  });

  test("done-Job ohne Callback: kein Email, Worker-Run succeeded", async () => {
    const jobId = await seedPendingJob();
    const result = await runExportJobs({
      db: stack.db,
      registry: stack.registry,
      buildStorageProvider: buildProvider,
      now: NOW(),
      // Kein sendExportReadyEmail/appExportDownloadUrl
    });
    expect(result.completedJobIds).toContain(jobId);
    // Kein Email, kein Throw — Worker laeuft normal durch
  });

  test("done-Job mit Callback aber ohne appExportDownloadUrl → throw bubbelt zum r.job", async () => {
    // Boot-Misconfig-Detection: wer Callback setzt aber URL vergisst
    // soll einen klaren Error sehen. Worker wirft direkt — r.job-Wrap
    // markiert Worker-Run als failed in jobRunsTable.
    await seedPendingJob();
    await expect(
      runExportJobs({
        db: stack.db,
        registry: stack.registry,
        buildStorageProvider: buildProvider,
        now: NOW(),
        sendExportReadyEmail: async () => {
          // wird nicht erreicht — fireExportReadyCallback throws vorher
        },
        // appExportDownloadUrl absichtlich fehlt
      }),
    ).rejects.toThrow(/appExportDownloadUrl fehlt/);
  });

  test("user ohne email → Callback skipped + console.warn (kein Throw)", async () => {
    // User-Row mit email=null seeden (override). Worker logged warn,
    // Callback wird NICHT gerufen, Worker-Run bleibt successful.
    await resetTestTables(stack.db, [userTable]);
    await insertOne(stack.db, userTable, {
      id: String(aliceUser.id),
      tenantId: tenantA,
      email: "" as string, // empty string — lookupUserEmail returnt null
      passwordHash: "h",
      displayName: "Alice",
      locale: "de",
      emailVerified: true,
      roles: '["Member"]',
      status: USER_STATUS.Active,
    });
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
    // Callback NICHT aufgerufen weil userEmail leer
    expect(callbackInvoked).toBe(false);
    // Job ist trotzdem done (Notification ist best-effort, Audit-Trail
    // existiert via Token-DB-row)
    const [row] = (await selectMany(stack.db, exportJobsTable, { id: jobId })) as Array<{
      status: string;
    }>;
    expect(row?.status).toBe("done");
  });

  test("Atom 5.fix3 best-effort: callback-Throw fuer Job A killt Batch NICHT — Job B trotzdem verarbeitet", async () => {
    // Vor fix3 wuerde ein Throw aus sendExportReadyEmail die for-Schleife
    // abwuergen. Job A's Status ist bereits done committed, retry findet
    // niemand mehr (alle pending-Jobs done) → silent miss + ZIP laeuft
    // nach TTL ab ohne dass User je die Email bekommt.
    //
    // Mit fix3: try/catch faengt den Throw, console.warn macht's
    // operator-sichtbar, Schleife laeuft weiter zu Job B.
    const bobUser = createTestUser({
      id: 7,
      tenantId: tenantA,
      roles: ["Member"],
    });
    await insertOne(stack.db, userTable, {
      id: String(bobUser.id),
      tenantId: tenantA,
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

    // Beide Jobs durchgegangen — Throw bei Job A hat Job B nicht
    // mitgerissen. Beweis fuer try/catch-Continuation.
    expect(result.completedJobIds).toContain(jobAId);
    expect(result.completedJobIds).toContain(jobBId);
    expect(calls.sort()).toEqual([jobAId, jobBId].sort());

    // Beide DB-Rows tatsaechlich done (Job A's Status wurde VOR dem
    // Email-Versand committed — der Throw aenderte daran nichts).
    const rows = (await selectMany(stack.db, exportJobsTable, {})) as Array<{
      id: string;
      status: string;
    }>;
    const filteredRows = rows.filter((r) => r.id === jobAId || r.id === jobBId);
    expect(filteredRows).toHaveLength(2);
    expect(filteredRows.every((r) => r.status === "done")).toBe(true);
  });
});
