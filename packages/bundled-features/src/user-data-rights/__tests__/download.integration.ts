// Download-Endpoint Integration-Tests (S2.U3 Atom 4b).
//
// Pinst beide Pfade:
//   - download-by-token (Magic-Link, anonymous)
//   - download-by-job (UI-Klick, session-auth)
//
// Plus Audit-Updates (useCount, lastUsedAt, IP, UA), TTL-checks,
// cross-user-isolation, cross-tenant-same-user.

import { randomBytes } from "node:crypto";
import { asRawClient, selectMany, updateMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEncryptionProvider } from "@cosmicdrift/kumiko-framework/db";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
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
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
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

// Test-only file-provider OHNE getSignedUrl. Pinst dass der Code-Pfad
// signedUrlNotSupported einen UnprocessableError (422) wirft, nicht
// generic 404. Memory `feedback_no_fake_tests`: Code-Fix ohne Test
// waere theatre.
const noSignedUrlProviderFeature = defineFeature("test-no-signed-url-provider", (r) => {
  r.requires("file-foundation");
  r.useExtension("fileProvider", "no-signed-url", {
    build: async () => ({
      async write() {
        // no-op fuer dieses Test-Setup
      },
      async writeStream() {
        // no-op
      },
      async read() {
        return new Uint8Array();
      },
      readStream() {
        return {
          async *[Symbol.asyncIterator]() {
            yield new Uint8Array();
          },
        };
      },
      async delete() {
        // no-op
      },
      async exists() {
        return true;
      },
      // **kein** getSignedUrl — pinst den 422-Pfad
    }),
  });
});

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
      noSignedUrlProviderFeature,
      createUserDataRightsFeature(),
    ],
    extraContext: ({ registry }) => ({
      configResolver: resolver,
      configEncryption: encryption,
      _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
    }),
    // Anonymous-Access fuer den Magic-Link-Pfad (Atom 4b httpRoute-Wrapper).
    // tenant-context kommt von job.requestedFromTenantId nach Token-Lookup;
    // defaultTenantId hier ist nur Fallback wenn kein X-Tenant-Header da ist.
    anonymousAccess: {
      defaultTenantId: tenantA,
    },
  });
  await unsafeCreateEntityTable(stack.db, exportJobEntity);
  await unsafeCreateEntityTable(stack.db, exportDownloadTokenEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await unsafePushTables(stack.db, { configValuesTable });
  await createEventsTable(stack.db);
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
  await asRawClient(stack.db).unsafe(`DELETE FROM "${exportDownloadTokensTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${exportJobsTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM kumiko_events`);
  await asRawClient(stack.db).unsafe(`DELETE FROM read_tenant_compliance_profiles`);
  await asRawClient(stack.db).unsafe(`DELETE FROM read_tenant_memberships`);
  await asRawClient(stack.db).unsafe(`DELETE FROM $1`, [configValuesTable]);
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
    const tokenRows = (await selectMany(stack.db, exportDownloadTokensTable, { jobId })) as Array<{
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

    const [row] = (await selectMany(stack.db, exportDownloadTokensTable, { jobId })) as Array<{
      useCount: number;
    }>;
    expect(row?.useCount).toBe(2);
  });
});

describe("download-by-token :: error paths", () => {
  test("invalid Token → 404 not_found", async () => {
    await seedDoneJobWithToken();
    const res = await stack.http.query(
      "user-data-rights:query:download-by-token",
      { token: "definitely-not-a-real-token-xxxxx" },
      aliceUser,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; i18nKey: string } };
    expect(body.error.code).toBe("not_found");
    expect(body.error.i18nKey).toBe("userDataRights.errors.download.notFound");
  });

  test("expired Token → 404 download.expired", async () => {
    const { jobId, plainToken } = await seedDoneJobWithToken();
    const longAgo = getTemporal().Instant.fromEpochMilliseconds(
      Date.now() - 365 * 24 * 60 * 60 * 1000,
    );
    await updateMany(stack.db, exportDownloadTokensTable, { expiresAt: longAgo }, { jobId });

    const res = await stack.http.query(
      "user-data-rights:query:download-by-token",
      { token: plainToken },
      aliceUser,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { i18nKey: string } };
    expect(body.error.i18nKey).toBe("userDataRights.errors.download.expired");
  });

  test("failed Job → 404 download.unavailable", async () => {
    const { jobId, plainToken } = await seedDoneJobWithToken();
    await updateMany(stack.db, exportJobsTable, { status: "failed" }, { id: jobId });

    const res = await stack.http.query(
      "user-data-rights:query:download-by-token",
      { token: plainToken },
      aliceUser,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { i18nKey: string } };
    expect(body.error.i18nKey).toBe("userDataRights.errors.download.unavailable");
  });

  test("storage cleared → 404 download.expired", async () => {
    const { jobId, plainToken } = await seedDoneJobWithToken();
    await updateMany(stack.db, exportJobsTable, { downloadStorageKey: null }, { id: jobId });

    const res = await stack.http.query(
      "user-data-rights:query:download-by-token",
      { token: plainToken },
      aliceUser,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { i18nKey: string } };
    expect(body.error.i18nKey).toBe("userDataRights.errors.download.expired");
  });

  test("provider ohne getSignedUrl → 422 unprocessable signedUrlNotSupported", async () => {
    // Pinst Operator-Konfig-Bug-Pfad: provider ohne getSignedUrl-Support
    // (z.B. local-Filesystem-Provider in Production faelschlich gemountet)
    // → 422 statt 404. DPO sieht im Log "unprocessable" + spezifischen
    // i18nKey, kann den Konfig-Bug diagnostizieren.
    const { jobId, plainToken } = await seedDoneJobWithToken();
    // Switch tenant-config auf den no-signed-url-Provider
    await stack.http.writeOk(
      ConfigHandlers.set,
      { key: "file-foundation:config:provider", value: "no-signed-url" },
      tenantAdmin,
    );

    const res = await stack.http.query(
      "user-data-rights:query:download-by-token",
      { token: plainToken },
      aliceUser,
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; i18nKey: string } };
    expect(body.error.code).toBe("unprocessable");
    expect(body.error.i18nKey).toBe("userDataRights.errors.download.signedUrlNotSupported");

    // Sanity: Job-Row ist immer noch done — Operator-Bug aendert nicht den Job-State
    const [row] = (await selectMany(stack.db, exportJobsTable, { id: jobId })) as Array<{
      status: string;
    }>;
    expect(row?.status).toBe("done");
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
    const [row] = (await selectMany(stack.db, exportDownloadTokensTable, { jobId })) as Array<{
      useCount: number;
      lastUsedFromIp: string | null;
    }>;
    expect(row?.useCount).toBe(1);
    expect(row?.lastUsedFromIp).toBe("10.0.0.5");
  });

  test("failed Job (status != done) → 404 download.unavailable (job-Pfad)", async () => {
    // Symmetrisch zum token-Test: gleicher Code-Pfad muss auch im job-
    // handler 404 + unavailable raus, nicht 500.
    const { jobId } = await seedDoneJobWithToken();
    await updateMany(stack.db, exportJobsTable, { status: "failed" }, { id: jobId });

    const res = await stack.http.query(
      "user-data-rights:query:download-by-job",
      { jobId },
      aliceUser,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { i18nKey: string } };
    expect(body.error.i18nKey).toBe("userDataRights.errors.download.unavailable");
  });

  test("storage cleared (downloadStorageKey null) → 404 download.expired (job-Pfad)", async () => {
    const { jobId } = await seedDoneJobWithToken();
    await updateMany(stack.db, exportJobsTable, { downloadStorageKey: null }, { id: jobId });

    const res = await stack.http.query(
      "user-data-rights:query:download-by-job",
      { jobId },
      aliceUser,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { i18nKey: string } };
    expect(body.error.i18nKey).toBe("userDataRights.errors.download.expired");
  });
});

describe("r.httpRoute :: /user-export/by-token (Magic-Link e2e)", () => {
  test("happy: 302-Redirect mit Location-Header zur signed-URL", async () => {
    const { plainToken } = await seedDoneJobWithToken();

    const res = await stack.app.fetch(
      new Request(`http://test/user-export/by-token?token=${plainToken}`, {
        method: "GET",
        headers: {
          "user-agent": "e2e-test/1.0",
          "x-forwarded-for": "203.0.113.42",
        },
      }),
    );
    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toBeTruthy();
    expect(location).toMatch(/^memory:\/\//);
  });

  test("invalid token → 404 passthrough mit i18nKey", async () => {
    const res = await stack.app.fetch(
      new Request("http://test/user-export/by-token?token=fake-xxxxx", {
        method: "GET",
      }),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: { i18nKey?: string } };
    expect(body.error?.i18nKey).toBe("userDataRights.errors.download.notFound");
  });

  test("missing token query-param → 400", async () => {
    const res = await stack.app.fetch(
      new Request("http://test/user-export/by-token", { method: "GET" }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("missing_token");
  });

  test("Audit-Update: useCount + IP/UA aus httpRoute-Headers (nicht aus payload)", async () => {
    const { jobId, plainToken } = await seedDoneJobWithToken();
    await stack.app.fetch(
      new Request(`http://test/user-export/by-token?token=${plainToken}`, {
        method: "GET",
        headers: {
          "user-agent": "e2e-test/2.0",
          "x-forwarded-for": "198.51.100.7, 10.0.0.1",
        },
      }),
    );

    const [row] = (await selectMany(stack.db, exportDownloadTokensTable, { jobId })) as Array<{
      useCount: number;
      lastUsedFromIp: string | null;
      lastUsedUserAgent: string | null;
    }>;
    expect(row?.useCount).toBe(1);
    // X-Forwarded-For: erster Wert, comma-trimmed
    expect(row?.lastUsedFromIp).toBe("198.51.100.7");
    expect(row?.lastUsedUserAgent).toBe("e2e-test/2.0");
  });
});

describe("download-by-job :: cross-user + cross-tenant", () => {
  test("cross-user: Bob requests Alice's Job → 404 not_found (no existence leak)", async () => {
    const { jobId } = await seedDoneJobWithToken();

    const res = await stack.http.query(
      "user-data-rights:query:download-by-job",
      { jobId },
      bobUser,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; i18nKey: string } };
    expect(body.error.code).toBe("not_found");
    // Selber i18nKey wie invalid-token → keine Probing-Differenz
    expect(body.error.i18nKey).toBe("userDataRights.errors.download.notFound");
  });

  test("provider ohne getSignedUrl → 422 unprocessable signedUrlNotSupported (job-Pfad)", async () => {
    // Symmetrisch zum token-Pfad: derselbe Operator-Konfig-Bug muss auch
    // beim UI-Klick-Pfad als 422 raus, nicht 404.
    const { jobId } = await seedDoneJobWithToken();
    await stack.http.writeOk(
      ConfigHandlers.set,
      { key: "file-foundation:config:provider", value: "no-signed-url" },
      tenantAdmin,
    );

    const res = await stack.http.query(
      "user-data-rights:query:download-by-job",
      { jobId },
      aliceUser,
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; i18nKey: string } };
    expect(body.error.code).toBe("unprocessable");
    expect(body.error.i18nKey).toBe("userDataRights.errors.download.signedUrlNotSupported");
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
    await asRawClient(stack.db).unsafe(
      `
      INSERT INTO read_tenant_memberships (tenant_id, user_id)
      VALUES ($1, $2)
      ON CONFLICT (user_id, tenant_id) DO NOTHING
    `,
      [tenantB, String(aliceUser.id)],
    );

    const result = await stack.http.queryOk<{ url: string }>(
      "user-data-rights:query:download-by-job",
      { jobId },
      aliceFromTenantB,
    );
    expect(result.url).toMatch(/^memory:\/\//);
  });
});
