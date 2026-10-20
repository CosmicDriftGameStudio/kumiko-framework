// #1057 regression: anonymous GDPR magic-link download under
// `resolverTrust: "authoritative"` WITHOUT `defaultTenantId` (publicstatus's
// real prod config — Host-Resolver-only, no single-tenant fallback).
//
// The tenantResolver derives the ambient tenant from the request Host — here
// it always resolves to `hostTenant`, DIFFERENT from the tenant the export
// job actually belongs to (`jobTenant`). Before the fix, `download-by-token`
// resolved the file-storage-provider *selection* via `ctx.config`, which is
// bound to the ambient (resolved) tenant — `hostTenant` has no provider
// configured at all here, so the download 500s even though the token/job
// themselves are perfectly valid. The fix resolves the provider explicitly
// for `jobRow.requestedFromTenantId` instead.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import {
  createInMemoryFileProvider,
  type FileStorageProvider,
} from "@cosmicdrift/kumiko-framework/files";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { createTestEnvelopeCipher } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
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
import { tenantMembershipEntity } from "../../tenant/membership-table.ts";
import { createUserFeature } from "../../user/index.ts";
import { createUserDataRightsFeature } from "../feature.ts";
import { runExportJobs } from "../run-export-jobs.ts";
import { exportDownloadTokenEntity } from "../schema/download-token.ts";
import { exportJobEntity } from "../schema/export-job.ts";

const jobTenant = testTenantId(1);
const hostTenant = testTenantId(2);
const jobTenantAdmin = createTestUser({ id: 99, tenantId: jobTenant, roles: ["TenantAdmin"] });
const aliceUser = createTestUser({ id: 42, tenantId: jobTenant, roles: ["Member"] });

const providerPerTenant = new Map<string, ReturnType<typeof createInMemoryFileProvider>>();
function buildProvider(tenantId: string): Promise<FileStorageProvider> {
  let p = providerPerTenant.get(tenantId);
  if (!p) {
    p = createInMemoryFileProvider();
    providerPerTenant.set(tenantId, p);
  }
  return Promise.resolve(p);
}

let stack: TestStack;

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
  const resolver = createConfigResolver({ cipher: encryption });

  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createFileFoundationFeature(),
      createFileProviderInMemoryFeature(),
      createAuthFoundationFeature(),
      createSessionsFeature(),
      createUserDataRightsFeature(),
    ],
    extraContext: ({ registry }) => ({
      configResolver: resolver,
      configEncryption: encryption,
      _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
    }),
    // publicstatus prod: Host-Resolver-only, NO defaultTenantId. Resolver
    // always answers `hostTenant` here — jobTenant never appears as the
    // ambient/resolved tenant, only ever as jobRow.requestedFromTenantId.
    anonymousAccess: {
      tenantResolver: () => hostTenant,
      resolverTrust: "authoritative",
      tenantExists: async (id) => id === jobTenant || id === hostTenant,
    },
  });
  await unsafeCreateEntityTable(stack.db, exportJobEntity);
  await unsafeCreateEntityTable(stack.db, exportDownloadTokenEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await unsafePushTables(stack.db, { configValuesTable });
  await unsafeCreateEntityTable(stack.db, tenantMembershipEntity);

  // Only jobTenant gets a provider configured — hostTenant deliberately has
  // NONE, so a pre-fix ambient-tenant read would hard-fail with "no provider
  // selected", not just pick the wrong one.
  await stack.http.writeOk(
    ConfigHandlers.set,
    { key: "file-foundation:config:provider", value: "inmemory" },
    jobTenantAdmin,
  );
});

afterAll(async () => {
  await stack.cleanup();
});

describe("download-by-token under resolverTrust: authoritative, no defaultTenantId", () => {
  test("magic-link download succeeds via the job's own tenant, not the Host-resolved ambient tenant", async () => {
    const requestRes = await stack.http.writeOk<{ jobId: string }>(
      "user-data-rights:write:request-export",
      {},
      aliceUser,
    );
    const jobId = requestRes.jobId;
    const provider = await buildProvider(jobTenant);
    await provider.write(`exports/${jobTenant}/${jobId}.zip`, new Uint8Array([1, 2, 3]));

    const result = await runExportJobs({
      db: stack.db,
      registry: stack.registry,
      buildStorageProvider: buildProvider,
      now: getTemporal().Now.instant(),
    });
    const plainToken = result.tokenByJobId.get(jobId);
    if (!plainToken) {
      throw new Error("token-create failed in worker run");
    }

    const res = await stack.app.fetch(
      new Request("http://test/user-export/by-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: plainToken }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data?: { url?: string } };
    expect(body.data?.url).toMatch(/^memory:\/\//);
    expect(body.data?.url).toContain(`exports/${jobTenant}/${jobId}.zip`);
  });
});
