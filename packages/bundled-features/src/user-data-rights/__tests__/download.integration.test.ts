// Download-Endpoint Integration-Tests.
//
// Covers both paths:
//   - download-by-token (Magic-Link, anonymous)
//   - download-by-job (UI-click, session-auth)
//
// Plus audit updates (useCount, lastUsedAt, IP, UA), TTL checks,
// cross-user isolation, cross-tenant same-user.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createInMemoryFileProvider,
  type FileStorageProvider,
} from "@cosmicdrift/kumiko-framework/files";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import {
  createTestEnvelopeCipher,
  resetTestTables,
  seedRowViaEventStore,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "../../compliance-profiles/index.ts";
import { createConfigAccessorFactory } from "../../config/feature.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { ConfigHandlers } from "../../config/web/constants.ts";
import { createDataRetentionFeature } from "../../data-retention/index.ts";
import { createFileFoundationFeature } from "../../file-foundation/index.ts";
import { createFileProviderInMemoryFeature } from "../../file-provider-inmemory/index.ts";
import { createSessionsFeature } from "../../sessions/index.ts";
import { tenantMembershipEntity, tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { createUserFeature } from "../../user/index.ts";
import { createUserDataRightsFeature } from "../feature.ts";
import { runExportJobs } from "../run-export-jobs.ts";
import { exportDownloadTokenEntity, exportDownloadTokensTable } from "../schema/download-token.ts";
import { exportJobEntity, exportJobsTable } from "../schema/export-job.ts";
import { changeExportJob, changeExportTokenOfJob } from "./export-job-writes.ts";

let stack: TestStack;
let providerPerTenant: Map<string, ReturnType<typeof createInMemoryFileProvider>>;

const tenantA = testTenantId(1);
const tenantB = testTenantId(2);
const aliceUser = createTestUser({ id: 42, tenantId: tenantA, roles: ["Member"] });
const bobUser = createTestUser({ id: 43, tenantId: tenantA, roles: ["Member"] });
// Admin for config-set (file-foundation:provider="inmemory")
const tenantAdmin = createTestUser({
  id: 99,
  tenantId: tenantA,
  roles: ["TenantAdmin", "SystemAdmin"],
});

const testEncryptionKey = randomBytes(32).toString("base64");

// Test-only file provider without getSignedUrl. This exercises the
// signedUrlNotSupported path, which must throw UnprocessableError (422)
// rather than a generic 404.
const noSignedUrlProviderFeature = defineFeature("test-no-signed-url-provider", (r) => {
  r.requires({ features: ["file-foundation"] });
  r.useExtension("fileProvider", "no-signed-url", {
    build: async () => ({
      async write() {
        // no-op for this test setup
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
      async list() {
        return [];
      },
      // **no** getSignedUrl — exercises the 422 path
    }),
  });
});

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(testEncryptionKey);
  const resolver = createConfigResolver({ cipher: encryption });

  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createFileFoundationFeature(),
      createFileProviderInMemoryFeature(),
      noSignedUrlProviderFeature,
      createAuthFoundationFeature(),
      createSessionsFeature(),
      createUserDataRightsFeature(),
    ],
    extraContext: ({ registry }) => ({
      configResolver: resolver,
      configEncryption: encryption,
      configAccessorFactory: createConfigAccessorFactory(registry, resolver),
    }),
    // Anonymous access for the Magic-Link path (httpRoute wrapper).
    // tenant context comes from job.requestedFromTenantId after token lookup;
    // defaultTenantId is only a fallback when no X-Tenant header is present.
    anonymousAccess: {
      defaultTenantId: tenantA,
    },
    // "download-by-job" below asserts the literal ip stored by requestContext,
    // so the resolver needs a trusted hop to read x-forwarded-for at all.
    trustedProxyHops: 1,
  });
  await unsafeCreateEntityTable(stack.db, exportJobEntity);
  await unsafeCreateEntityTable(stack.db, exportDownloadTokenEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await unsafePushTables(stack.db, { configValuesTable });
  await unsafeCreateEntityTable(stack.db, tenantMembershipEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [
    exportDownloadTokensTable,
    exportJobsTable,
    eventsTable,
    tenantComplianceProfileTable,
    tenantMembershipsTable,
    configValuesTable,
  ]);
  providerPerTenant = new Map();

  // Configure file-foundation provider="inmemory" for each tenant.
  // An admin is required for each tenant's configuration key.
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
 * Creates a completed job and token through the real worker path.
 * Returns {jobId, plainToken} for use in tests.
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
  const storageKey = `exports/${tenantA}/${jobId}.zip`;
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
    expect(result.url).toContain(`exports/${tenantA}/${jobId}.zip`);
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
    await changeExportTokenOfJob(stack.db, jobId, { expiresAt: longAgo }, tenantA);

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
    await changeExportJob(stack.db, jobId, { status: "failed" }, tenantA);

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
    await changeExportJob(stack.db, jobId, { downloadStorageKey: null }, tenantA);

    const res = await stack.http.query(
      "user-data-rights:query:download-by-token",
      { token: plainToken },
      aliceUser,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { i18nKey: string } };
    expect(body.error.i18nKey).toBe("userDataRights.errors.download.expired");
  });

  test("provider without getSignedUrl → 422 unprocessable signedUrlNotSupported", async () => {
    // Exercises the operator misconfiguration path: a provider without
    // getSignedUrl support (for example, an incorrectly mounted local
    // filesystem provider) returns 422 rather than 404. The specific
    // i18nKey lets the DPO diagnose the configuration error from the log.
    const { jobId, plainToken } = await seedDoneJobWithToken();
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

    // The job remains done; an operator configuration error must not change
    // the job state.
    const [row] = (await selectMany(stack.db, exportJobsTable, { id: jobId })) as Array<{
      status: string;
    }>;
    expect(row?.status).toBe("done");
  });
});

describe("download-by-job :: happy path", () => {
  test("session-auth: Job-Owner → returns signed URL + audit (IP aus X-Forwarded-For)", async () => {
    const { jobId } = await seedDoneJobWithToken();

    // The UI click runs as a direct download-by-job query (client sends
    // X-CSRF-Token). The audit IP is server-trusted from the RequestContext
    // (X-Forwarded-For entry appended by the trusted proxy at
    // trustedProxyHops=1), never from a client-supplied field.
    const res = await stack.http.queryWithHeaders(
      "user-data-rights:query:download-by-job",
      { jobId },
      aliceUser,
      { "x-forwarded-for": "10.0.0.5, 10.0.0.1" },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { url: string } };
    expect(body.data.url).toMatch(/^memory:\/\//);

    // A UI click also counts as a use, so the audit row must be updated.
    const [row] = (await selectMany(stack.db, exportDownloadTokensTable, { jobId })) as Array<{
      useCount: number;
      lastUsedFromIp: string | null;
    }>;
    expect(row?.useCount).toBe(1);
    expect(row?.lastUsedFromIp).toBe("10.0.0.1");
  });

  test("failed Job (status != done) → 404 download.unavailable (job-Pfad)", async () => {
    // The job handler must match the token handler: return 404 + unavailable,
    // not 500.
    const { jobId } = await seedDoneJobWithToken();
    await changeExportJob(stack.db, jobId, { status: "failed" }, tenantA);

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
    await changeExportJob(stack.db, jobId, { downloadStorageKey: null }, tenantA);

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
  test("`?token=` in query is ignored — serves interstitial HTML instead of resolving it (no access-log leak)", async () => {
    const { jobId, plainToken } = await seedDoneJobWithToken();

    const res = await stack.app.fetch(
      new Request(`http://test/user-export/by-token?token=${plainToken}`, {
        method: "GET",
        headers: {
          "user-agent": "e2e-test/1.0",
          "x-forwarded-for": "203.0.113.42",
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("/user-export/by-token.js");

    const [row] = (await selectMany(stack.db, exportDownloadTokensTable, { jobId })) as Array<{
      useCount: number;
    }>;
    expect(row?.useCount).toBe(0);
  });

  test("no query token (fragment path) → serves interstitial HTML instead of 400", async () => {
    const res = await stack.app.fetch(
      new Request("http://test/user-export/by-token", { method: "GET" }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("/user-export/by-token.js");
  });

  test("by-token.js → same-origin exchange-script, application/javascript", async () => {
    const res = await stack.app.fetch(
      new Request("http://test/user-export/by-token.js", { method: "GET" }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/javascript");
    const body = await res.text();
    expect(body).toContain("location.hash");
    expect(body).toContain("/user-export/by-token");
  });

  test("POST-Exchange (Fragment-Pfad): happy-path + IP/UA-Audit aus httpRoute-Headers", async () => {
    const { jobId, plainToken } = await seedDoneJobWithToken();

    // trustedProxyHops=1 here → the resolver trusts the last XFF entry, not
    // the client-spoofable first one.
    const res = await stack.app.fetch(
      new Request("http://test/user-export/by-token", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "e2e-test/3.0",
          "x-forwarded-for": "203.0.113.9, 10.0.0.1",
        },
        body: JSON.stringify({ token: plainToken }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data?: { url?: string } };
    expect(body.data?.url).toBeTruthy();

    const [row] = (await selectMany(stack.db, exportDownloadTokensTable, { jobId })) as Array<{
      useCount: number;
      lastUsedFromIp: string | null;
      lastUsedUserAgent: string | null;
    }>;
    expect(row?.useCount).toBe(1);
    expect(row?.lastUsedFromIp).toBe("10.0.0.1");
    expect(row?.lastUsedFromIp).not.toBe("203.0.113.9");
    expect(row?.lastUsedUserAgent).toBe("e2e-test/3.0");
  });

  test("POST-Exchange: missing token → 400", async () => {
    const res = await stack.app.fetch(
      new Request("http://test/user-export/by-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("missing_token");
  });

  test("POST-Exchange: invalid token → 404 + download.notFound i18nKey", async () => {
    const res = await stack.app.fetch(
      new Request("http://test/user-export/by-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "fake-xxxxx" }),
      }),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { i18nKey: string } };
    expect(body.error.i18nKey).toBe("userDataRights.errors.download.notFound");
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
    // The same i18nKey as an invalid token prevents an existence-probing
    // distinction.
    expect(body.error.i18nKey).toBe("userDataRights.errors.download.notFound");
  });

  test("provider without getSignedUrl → 422 unprocessable signedUrlNotSupported (job path)", async () => {
    // Same as the token path: the operator misconfig must also surface as
    // 422 on the UI click path, not 404.
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
    // Sign Alice in to Tenant B.
    const aliceFromTenantB = createTestUser({
      id: 42,
      tenantId: tenantB,
      roles: ["Member"],
    });
    // Persist Tenant B membership so the auth stack accepts this user.
    await seedRowViaEventStore(stack.db, tenantMembershipsTable, {
      tenantId: tenantB,
      userId: String(aliceUser.id),
      roles: "[]",
    });

    const result = await stack.http.queryOk<{ url: string }>(
      "user-data-rights:query:download-by-job",
      { jobId },
      aliceFromTenantB,
    );
    expect(result.url).toMatch(/^memory:\/\//);
  });

  test("cross-tenant same-user: provider is resolved for the job's tenant, not the ambient session tenant", async () => {
    // Regression: createFileProviderForTenant used to read the
    // provider *selection* from the ambient session's ctx.config — here
    // Tenant B (Alice's session tenant) — instead of the job's own
    // Tenant A. Give Tenant A a provider WITHOUT getSignedUrl while
    // Tenant B keeps "inmemory" (default from beforeEach): if the bug
    // resurfaces, the wrong (Tenant B) provider is picked and the
    // request succeeds with 200 instead of 422.
    const { jobId } = await seedDoneJobWithToken();
    await stack.http.writeOk(
      ConfigHandlers.set,
      { key: "file-foundation:config:provider", value: "no-signed-url" },
      tenantAdmin, // Tenant A admin
    );
    const aliceFromTenantB = createTestUser({
      id: 42,
      tenantId: tenantB,
      roles: ["Member"],
    });
    await seedRowViaEventStore(stack.db, tenantMembershipsTable, {
      tenantId: tenantB,
      userId: String(aliceUser.id),
      roles: "[]",
    });

    const res = await stack.http.query(
      "user-data-rights:query:download-by-job",
      { jobId },
      aliceFromTenantB,
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; i18nKey: string } };
    expect(body.error.code).toBe("unprocessable");
    expect(body.error.i18nKey).toBe("userDataRights.errors.download.signedUrlNotSupported");
  });
});
