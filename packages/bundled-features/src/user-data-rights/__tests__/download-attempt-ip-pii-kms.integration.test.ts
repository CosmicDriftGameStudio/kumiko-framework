// download-attempt.ip is personal data: encrypted under the requesting user's key on the job
// path and under the tenant key on the anonymous token path, while list-download-attempts can
// still filter by IP through the blind index.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import { authFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import {
  configureBlindIndexKey,
  configuredPiiSubjectKms,
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  isPiiCiphertext,
  PII_ERASED_SENTINEL,
} from "@cosmicdrift/kumiko-framework/crypto";
import { asRawClient, selectMany } from "@cosmicdrift/kumiko-framework/db";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createInMemoryFileProvider,
  type FileStorageProvider,
  fileRefsTable,
} from "@cosmicdrift/kumiko-framework/files";
import {
  createProjectionStateTable,
  rebuildProjection,
} from "@cosmicdrift/kumiko-framework/pipeline";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import {
  createTestEnvelopeCipher,
  resetBlindIndexKeyForTests,
  resetPiiSubjectKmsForTests,
  resetTestTables,
  seedRow,
  updateRows,
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
} from "../../compliance-profiles/index.js";
import { ConfigHandlers } from "../../config/constants.js";
import { createConfigAccessorFactory } from "../../config/feature.js";
import { createConfigFeature } from "../../config/index.js";
import { createConfigResolver } from "../../config/resolver.js";
import { configValuesTable } from "../../config/table.js";
import {
  createDataRetentionFeature,
  tenantRetentionOverrideEntity,
} from "../../data-retention/index.js";
import { fileFoundationFeature } from "../../file-foundation/index.js";
import { fileProviderInMemoryFeature } from "../../file-provider-inmemory/index.js";
import { createFilesFeature } from "../../files/index.js";
import { createSessionsFeature } from "../../sessions/index.js";
import { tenantMembershipEntity, tenantMembershipsTable } from "../../tenant/membership-table.js";
import { createUserFeature, userEntity, userTable } from "../../user/index.js";
import { createUserDataRightsDefaultsFeature } from "../../user-data-rights-defaults/feature.js";
import { createUserDataRightsFeature } from "../feature.js";
import { runExportJobs } from "../run-export-jobs.js";
import { runForgetCleanup } from "../run-forget-cleanup.js";
import { runUserExport } from "../run-user-export.js";
import { downloadAttemptEntity, downloadAttemptsTable } from "../schema/download-attempt.js";
import { exportDownloadTokenEntity, exportDownloadTokensTable } from "../schema/download-token.js";
import { exportJobEntity, exportJobsTable } from "../schema/export-job.js";
import { createForgetSeeders, nowInstant } from "./forget-test-helpers.js";

const DOWNLOAD_BY_JOB = "user-data-rights:query:download-by-job";
const LIST_ATTEMPTS = "user-data-rights:query:list-download-attempts";
const ENTITY_LIST_ATTEMPTS = "user-data-rights:query:download-attempt:list";
const CLIENT_IP = "198.51.100.77";
// trustedProxyHops=1 trusts the last entry, so the first one is ignored spoof input.
const USER_AGENT = "kumiko-attempt-probe/9.9.9";
const FORWARDED_FOR = {
  "x-forwarded-for": `203.0.113.9, ${CLIENT_IP}`,
  "user-agent": USER_AGENT,
};
const BLIND_INDEX_KEY = Buffer.alloc(32, 7).toString("base64");

const tenantA = testTenantId(1);
const aliceUser = createTestUser({ id: 42, tenantId: tenantA, roles: ["Member"] });
const systemAdminUser = createTestUser({ id: 98, tenantId: tenantA, roles: ["SystemAdmin"] });
const adminUser = createTestUser({ id: 99, tenantId: tenantA, roles: ["Admin", "TenantAdmin"] });

type AttemptRow = {
  ip: string | null;
  ip_bidx: string | null;
  user_agent: string | null;
  via: string;
};

let stack: TestStack;
let provider: FileStorageProvider;

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
  const resolver = createConfigResolver({ cipher: encryption });
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createFilesFeature(),
      createUserFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      fileFoundationFeature,
      fileProviderInMemoryFeature,
      authFoundationFeature,
      createSessionsFeature(),
      createUserDataRightsFeature(),
      createUserDataRightsDefaultsFeature(),
    ],
    extraContext: ({ registry }) => ({
      configResolver: resolver,
      configEncryption: encryption,
      _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
    }),
    anonymousAccess: { defaultTenantId: tenantA },
    trustedProxyHops: 1,
  });
  await unsafeCreateEntityTable(stack.db, exportJobEntity);
  await unsafeCreateEntityTable(stack.db, exportDownloadTokenEntity);
  await unsafeCreateEntityTable(stack.db, downloadAttemptEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantRetentionOverrideEntity);
  await createProjectionStateTable(stack.db);
  await unsafePushTables(stack.db, { configValuesTable, fileRefsTable });
  await unsafeCreateEntityTable(stack.db, tenantMembershipEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [
    downloadAttemptsTable,
    exportDownloadTokensTable,
    exportJobsTable,
    eventsTable,
    tenantComplianceProfileTable,
    tenantMembershipsTable,
    configValuesTable,
    userTable,
  ]);
  configurePiiSubjectKms(new InMemoryKmsAdapter());
  configureBlindIndexKey(BLIND_INDEX_KEY);
  provider = createInMemoryFileProvider();
  await stack.http.writeOk(
    ConfigHandlers.set,
    { key: "file-foundation:config:provider", value: "inmemory" },
    { ...adminUser, roles: ["TenantAdmin", "SystemAdmin"] },
  );
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
  resetBlindIndexKeyForTests();
});

async function seedExpiredTokenForAlice(): Promise<string> {
  const { jobId } = await stack.http.writeOk<{ jobId: string }>(
    "user-data-rights:write:request-export",
    {},
    aliceUser,
  );
  await provider.write(`exports/${tenantA}/${jobId}.zip`, new Uint8Array([1, 2, 3]));
  const result = await runExportJobs({
    db: stack.db,
    registry: stack.registry,
    buildStorageProvider: async () => provider,
    now: getTemporal().Now.instant(),
  });
  const plainToken = result.tokenByJobId.get(jobId);
  if (!plainToken) throw new Error("worker run did not create a download token");
  const longAgo = getTemporal().Instant.fromEpochMilliseconds(Date.now() - 365 * 86_400_000);
  await updateRows(stack.db, exportDownloadTokensTable, { expiresAt: longAgo }, { jobId });
  return plainToken;
}

// Anonymous token path (no owner, tenant key) and logged-in job path (user key), same client IP.
async function recordOneAttemptPerPath(): Promise<void> {
  const plainToken = await seedExpiredTokenForAlice();
  const tokenRes = await stack.app.fetch(
    new Request("http://test/user-export/by-token", {
      method: "POST",
      headers: { "content-type": "application/json", ...FORWARDED_FOR },
      body: JSON.stringify({ token: plainToken }),
    }),
  );
  expect(tokenRes.status).toBe(404);

  const jobRes = await stack.http.queryWithHeaders(
    DOWNLOAD_BY_JOB,
    { jobId: randomUUID() },
    aliceUser,
    FORWARDED_FOR,
  );
  expect(jobRes.status).toBe(404);
}

async function storedAttempts(): Promise<readonly AttemptRow[]> {
  return await asRawClient(stack.db).unsafe<AttemptRow>(
    `SELECT ip, ip_bidx, user_agent, via FROM "${downloadAttemptsTable.tableName}"`,
  );
}

type ListedAttempt = { ip: string | null; userAgent: string | null; via: string };

describe("download-attempt ip with active KMS", () => {
  test("stores ip as ciphertext with a blind index on both paths and keeps it out of the events", async () => {
    await recordOneAttemptPerPath();

    const rows = await storedAttempts();
    expect(rows.map((r) => r.via).sort()).toEqual(["job", "token"]);
    for (const row of rows) {
      expect(isPiiCiphertext(row.ip)).toBe(true);
      expect(row.ip).not.toContain(CLIENT_IP);
      expect(row.ip_bidx).toStartWith("kumiko-bidx:v1:");
      expect(isPiiCiphertext(row.user_agent)).toBe(true);
      expect(row.user_agent).not.toContain(USER_AGENT);
    }

    const attemptEvents = (await selectMany(stack.db, eventsTable, {})).filter((e) =>
      String(e["type"]).startsWith("download-attempt"),
    );
    expect(attemptEvents).toHaveLength(2);
    for (const event of attemptEvents) {
      expect(JSON.stringify(event["payload"])).not.toContain(CLIENT_IP);
      expect(JSON.stringify(event["payload"])).not.toContain(USER_AGENT);
    }
  });

  test("list-download-attempts filters by ip and returns plaintext for both paths", async () => {
    await recordOneAttemptPerPath();

    const hit = await stack.http.queryOk<{ rows: ListedAttempt[] }>(
      LIST_ATTEMPTS,
      { ip: CLIENT_IP },
      adminUser,
    );
    expect(hit.rows.map((r) => r.via).sort()).toEqual(["job", "token"]);
    expect(hit.rows.map((r) => r.ip)).toEqual([CLIENT_IP, CLIENT_IP]);
    expect(hit.rows.map((r) => r.userAgent)).toEqual([USER_AGENT, USER_AGENT]);

    const miss = await stack.http.queryOk<{ rows: ListedAttempt[] }>(
      LIST_ATTEMPTS,
      { ip: "192.0.2.1" },
      adminUser,
    );
    expect(miss.rows).toEqual([]);
  });

  test("after the user's key is erased the job row is unreadable, the token row keeps plaintext", async () => {
    await recordOneAttemptPerPath();

    await configuredPiiSubjectKms()?.eraseKey(
      { kind: "user", userId: aliceUser.id },
      { requestId: "download-attempt-ip-pii-kms", userId: aliceUser.id, eraseReason: "test" },
    );

    const listed = await stack.http.queryOk<{ rows: ListedAttempt[] }>(
      LIST_ATTEMPTS,
      {},
      adminUser,
    );
    const byPath = new Map(listed.rows.map((r) => [r.via, r]));
    expect(byPath.get("job")).toMatchObject({
      ip: PII_ERASED_SENTINEL,
      userAgent: PII_ERASED_SENTINEL,
    });
    expect(byPath.get("token")).toMatchObject({ ip: CLIENT_IP, userAgent: USER_AGENT });
  });
});

describe("download-attempt ip readers with active KMS", () => {
  test("download-attempt:list (SystemAdmin entity list) returns plaintext ips", async () => {
    await recordOneAttemptPerPath();

    const listed = await stack.http.queryOk<{ rows: ListedAttempt[] }>(
      ENTITY_LIST_ATTEMPTS,
      {},
      systemAdminUser,
    );
    expect(listed.rows.map((r) => r.ip)).toEqual([CLIENT_IP, CLIENT_IP]);
    expect(listed.rows.map((r) => r.userAgent)).toEqual([USER_AGENT, USER_AGENT]);
  });

  test("the user export carries the job-path attempt with its plaintext ip", async () => {
    await recordOneAttemptPerPath();
    await seedRow(stack.db, tenantMembershipsTable, {
      tenantId: tenantA,
      userId: aliceUser.id,
      roles: "[]",
    });

    const bundle = await runUserExport({
      db: stack.db,
      registry: stack.registry,
      userId: aliceUser.id,
      now: getTemporal().Now.instant(),
    });
    const snippet = bundle.tenants
      .flatMap((t) => t.entities)
      .find((e) => e.entity === "download-attempt");
    expect(snippet?.rows).toHaveLength(1);
    expect(snippet?.rows[0]).toMatchObject({ via: "job", ip: CLIENT_IP, userAgent: USER_AGENT });
  });
});

describe("download-attempt forget", () => {
  test("forgetting the user purges their job-path row with its blind index for good and keeps the owner-less token row", async () => {
    await recordOneAttemptPerPath();
    const seed = createForgetSeeders(stack.db, { write: async () => {} });
    await seed.seedForgetUser(aliceUser.id);
    await seed.seedMembership(aliceUser.id, tenantA);

    const result = await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: nowInstant(),
    });
    expect(result.errors).toEqual([]);
    expect(result.processedUserIds).toContain(aliceUser.id);

    const remaining = await storedAttempts();
    expect(remaining.map((r) => r.via)).toEqual(["token"]);

    await rebuildProjection("user-data-rights:projection:download-attempt-entity", {
      db: stack.db,
      registry: stack.registry,
    });
    expect((await storedAttempts()).map((r) => r.via)).toEqual(["token"]);
  });
});
