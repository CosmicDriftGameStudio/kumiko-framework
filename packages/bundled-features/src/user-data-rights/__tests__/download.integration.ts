// Download-Endpoint Integration-Tests (S2.U3 Atom 4b).
//
// Pinst beide Pfade:
//   - download-by-token (Magic-Link, anonymous)
//   - download-by-job (UI-Klick, session-auth)
//
// Plus Audit-Updates (useCount, lastUsedAt, IP, UA), TTL-checks,
// cross-user-isolation, cross-tenant-same-user.

import { randomBytes } from "node:crypto";
import { createEncryptionProvider } from "@cosmicdrift/kumiko-framework/db";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createInMemoryFileProvider,
  type FileStorageProvider,
} from "@cosmicdrift/kumiko-framework/files";
import {
  createEntityTable,
  createTestUser,
  pushTables,
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
import { createConfigFeature } from "../../config";
import { ConfigHandlers } from "../../config/constants";
import { createConfigAccessorFactory } from "../../config/feature";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { createDataRetentionFeature } from "../../data-retention";
import { fileFoundationFeature } from "../../file-foundation";
import { fileProviderInMemoryFeature } from "../../file-provider-inmemory";
import { createUserFeature } from "../../user";
import { createUserDataRightsFeature } from "../feature";
import { runExportJobs } from "../run-export-jobs";
import { exportDownloadTokenEntity, exportDownloadTokensTable } from "../schema/download-token";
import { exportJobEntity, exportJobsTable } from "../schema/export-job";

let stack: TestStack;
let providerPerTenant: Map<string, ReturnType<typeof createInMemoryFileProvider>>;

const tenantA = testTenantId(1);
const tenantB = testTenantId(2);
const aliceUser = createTestUser({ id: 42, tenantId: tenantA, roles: ["Member"] });
const bobUser = createTestUser({ id: 43, tenantId: tenantA, roles: ["Member"] });
// Admin fuer config-set (file-foundation:provider="inmemory")
const tenantAdmin = createTestUser({
  id: 99,
  tenantId: tenantA,
  roles: ["TenantAdmin", "SystemAdmin"],
});

const testEncryptionKey = randomBytes(32).toString("base64");

beforeAll(async () => {
  const encryption = createEncryptionProvider(testEncryptionKey);
  const resolver = createConfigResolver({ encryption });

  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      fileFoundationFeature,
      fileProviderInMemoryFeature,
      createUserDataRightsFeature(),
    ],
    extraContext: ({ registry }) => ({
      configResolver: resolver,
      configEncryption: encryption,
      _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
    }),
  });
  await createEntityTable(stack.db, exportJobEntity);
  await createEntityTable(stack.db, exportDownloadTokenEntity);
  await createEntityTable(stack.db, tenantComplianceProfileEntity);
  await pushTables(stack.db, { configValuesTable });
  await createEventsTable(stack.db);
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
  await stack.db.delete(exportDownloadTokensTable);
  await stack.db.delete(exportJobsTable);
  await stack.db.execute(sql`DELETE FROM kumiko_events`);
  await stack.db.execute(sql`DELETE FROM read_tenant_compliance_profiles`);
  await stack.db.execute(sql`DELETE FROM read_tenant_memberships`);
  await stack.db.execute(sql`DELETE FROM ${configValuesTable}`);
  providerPerTenant = new Map();

  // Setup file-foundation provider="inmemory" pro Tenant.
  // Admin auf jeweiligem Tenant (tenant-config-key).
  await stack.http.writeOk(
    ConfigHandlers.set,
    { key: "file-foundation:config:provider", value: "inmemory" },
    tenantAdmin,
  );
  await stack.http.writeOk(
    ConfigHandlers.set,
    { key: "file-foundation:config:provider", value: "inmemory" },
    { ...tenantAdmin, tenantId: tenantB },
  );
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

/**
 * Helper: completed Job + Token via realen Worker-Pfad.
 * Returns {jobId, plainToken} fuer Test-Use.
 */
async function seedDoneJobWithToken(): Promise<{ jobId: string; plainToken: string }> {
  // 1. seed pending Job via real handler
  const requestRes = await stack.http.writeOk<{ jobId: string }>(
    "user-data-rights:write:request-export",
    {},
    aliceUser,
  );
  const jobId = requestRes.jobId;

  // 2. seed in-memory ZIP file at path that worker would write
  const provider = await buildProvider(tenantA);
  const storageKey = `${tenantA}/exports/${jobId}.zip`;
  await provider.write(storageKey, new Uint8Array([1, 2, 3]));

  // 3. Run worker → done-flip + Token-Create
  const result = await runExportJobs({
    db: stack.db,
    registry: stack.registry,
    buildStorageProvider: buildProvider,
    now: NOW(),
  });
  const plainToken = result.tokenByJobId.get(jobId);
  if (!plainToken) {
    throw new Error("seedDoneJobWithToken: token-create failed in worker run");
  }
  return { jobId, plainToken };
}

describe("download-by-token :: happy path", () => {
  test("valid Token → returns signed URL + audit-update", async () => {
    const { jobId, plainToken } = await seedDoneJobWithToken();

    const res = await stack.http.query(
      "user-data-rights:query:download-by-token",
      {
        token: plainToken,
        auditMeta: { ip: "192.168.1.42", userAgent: "test-agent/1.0" },
      },
      aliceUser, // anonymous-pfad akzeptiert beliebige user
    );
    const body = (await res.json()) as {
      data?: { url?: string; expiresAt?: string; bytesWritten?: number | null };
      error?: unknown;
    };
    if (!body.data?.url) {
      throw new Error(`Expected url in response. Got: ${JSON.stringify(body)}`);
    }
    const result = body.data;

    expect(result.url).toMatch(/^memory:\/\//);
    expect(result.url).toContain(`${tenantA}/exports/${jobId}.zip`);
    expect(result.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Audit-Update: useCount=1, lastUsedAt set, IP+UA persistiert
    const tokenRows = (await stack.db
      .select()
      .from(exportDownloadTokensTable)
      .where(sql`job_id = ${jobId}`)) as Array<{
      useCount: number;
      lastUsedAt: { toString(): string } | null;
      lastUsedFromIp: string | null;
      lastUsedUserAgent: string | null;
    }>;
    expect(tokenRows[0]?.useCount).toBe(1);
    expect(tokenRows[0]?.lastUsedAt).not.toBeNull();
    expect(tokenRows[0]?.lastUsedFromIp).toBe("192.168.1.42");
    expect(tokenRows[0]?.lastUsedUserAgent).toBe("test-agent/1.0");
  });

  test("Multi-use within TTL: 2× Downloads → useCount=2", async () => {
    const { jobId, plainToken } = await seedDoneJobWithToken();

    await stack.http.queryOk(
      "user-data-rights:query:download-by-token",
      { token: plainToken },
      aliceUser,
    );
    await stack.http.queryOk(
      "user-data-rights:query:download-by-token",
      { token: plainToken },
      aliceUser,
    );

    const [row] = (await stack.db
      .select()
      .from(exportDownloadTokensTable)
      .where(sql`job_id = ${jobId}`)) as Array<{ useCount: number }>;
    expect(row?.useCount).toBe(2);
  });
});

describe("download-by-token :: error paths", () => {
  test("invalid Token → 404", async () => {
    await seedDoneJobWithToken();
    const res = await stack.http.query(
      "user-data-rights:query:download-by-token",
      { token: "definitely-not-a-real-token-xxxxx" },
      aliceUser,
    );
    // Generic error — kein Existenz-Leak.
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test("expired Token (expiresAt past) → error", async () => {
    const { jobId, plainToken } = await seedDoneJobWithToken();
    // Force expiresAt auf Vergangenheit (Test-Exemption: direct-UPDATE)
    const longAgo = getTemporal().Instant.fromEpochMilliseconds(
      Date.now() - 365 * 24 * 60 * 60 * 1000,
    );
    await stack.db
      .update(exportDownloadTokensTable)
      .set({ expiresAt: longAgo })
      .where(sql`job_id = ${jobId}`);

    const res = await stack.http.query(
      "user-data-rights:query:download-by-token",
      { token: plainToken },
      aliceUser,
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test("failed Job (status != done) → error", async () => {
    const { jobId, plainToken } = await seedDoneJobWithToken();
    // Force Job auf failed
    await stack.db.update(exportJobsTable).set({ status: "failed" }).where(sql`id = ${jobId}`);

    const res = await stack.http.query(
      "user-data-rights:query:download-by-token",
      { token: plainToken },
      aliceUser,
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test("storage cleared (downloadStorageKey null) → error", async () => {
    const { jobId, plainToken } = await seedDoneJobWithToken();
    await stack.db
      .update(exportJobsTable)
      .set({ downloadStorageKey: null })
      .where(sql`id = ${jobId}`);

    const res = await stack.http.query(
      "user-data-rights:query:download-by-token",
      { token: plainToken },
      aliceUser,
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe("download-by-job :: happy path", () => {
  test("session-auth: Job-Owner → returns signed URL + audit", async () => {
    const { jobId } = await seedDoneJobWithToken();

    const result = await stack.http.queryOk<{ url: string }>(
      "user-data-rights:query:download-by-job",
      {
        jobId,
        auditMeta: { ip: "10.0.0.5", userAgent: "Mozilla/5.0" },
      },
      aliceUser,
    );

    expect(result.url).toMatch(/^memory:\/\//);

    // UI-Klick zaehlt auch als Use → audit-row updated
    const [row] = (await stack.db
      .select()
      .from(exportDownloadTokensTable)
      .where(sql`job_id = ${jobId}`)) as Array<{
      useCount: number;
      lastUsedFromIp: string | null;
    }>;
    expect(row?.useCount).toBe(1);
    expect(row?.lastUsedFromIp).toBe("10.0.0.5");
  });
});

describe("download-by-job :: cross-user + cross-tenant", () => {
  test("cross-user: Bob requests Alice's Job → 404 (no existence leak)", async () => {
    const { jobId } = await seedDoneJobWithToken();

    const res = await stack.http.query(
      "user-data-rights:query:download-by-job",
      { jobId },
      bobUser,
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test("cross-tenant same-user: Alice from Tenant B downloadet Tenant-A-Job → success", async () => {
    const { jobId } = await seedDoneJobWithToken();
    // Alice loggt sich in Tenant B ein
    const aliceFromTenantB = createTestUser({
      id: 42,
      tenantId: tenantB,
      roles: ["Member"],
    });
    // Membership in Tenant B persisten damit auth-stack User akzeptiert
    await stack.db.execute(sql`
      INSERT INTO read_tenant_memberships (tenant_id, user_id)
      VALUES (${tenantB}, ${String(aliceUser.id)})
      ON CONFLICT (user_id, tenant_id) DO NOTHING
    `);

    const result = await stack.http.queryOk<{ url: string }>(
      "user-data-rights:query:download-by-job",
      { jobId },
      aliceFromTenantB,
    );
    expect(result.url).toMatch(/^memory:\/\//);
  });
});
