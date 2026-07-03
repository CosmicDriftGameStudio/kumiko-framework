// #608 trap-closed regression: uploads and erasure resolve the file provider
// through ONE source (file-foundation), end-to-end through the real server.
//
// The stack mounts file-foundation + a provider plugin but does NOT inject a
// resolver (no `files:` option) — so buildServer must build the upload-route
// resolver itself from the mounted features, exactly as production does. A file
// uploaded through POST /api/files must land in the SAME store the GDPR forget
// pipeline deletes from. Before the unification the upload route wrote through a
// separately-wired provider while erasure deleted through file-foundation — so a
// regression to a static `storageProvider` makes the `provider.exists(...)`
// assertion below go red.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { type SessionUser, SYSTEM_USER_ID } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createInMemoryFileProvider,
  type FileStorageProvider,
  fileRefsTable,
  type InMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  buildMultipartBody,
  patchFileInstanceofForBunTest,
  resetTestTables,
} from "@cosmicdrift/kumiko-framework/testing";
import { createComplianceProfilesFeature } from "../../compliance-profiles";
import { createConfigFeature } from "../../config";
import { createConfigAccessorFactory } from "../../config/feature";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { createDataRetentionFeature, tenantRetentionOverrideEntity } from "../../data-retention";
import { fileFoundationFeature } from "../../file-foundation";
import { createFilesFeature } from "../../files";
import { createSessionsFeature, userSessionEntity } from "../../sessions";
import { createUserFeature, userEntity, userTable } from "../../user";
import { createUserDataRightsDefaultsFeature } from "../../user-data-rights-defaults";
import { createUserDataRightsFeature } from "../feature";
import { makeTenantStorageProviderResolver } from "../lib/storage-provider-resolver";
import { runForgetCleanup } from "../run-forget-cleanup";
import {
  createForgetSeeders,
  createTestFileProviderFeature,
  type ForgetSeeders,
  nowInstant,
  READ_TENANT_MEMBERSHIPS_DDL,
  TENANT_SYSTEM,
} from "./forget-test-helpers";

const FILE_PROVIDER_CONFIG_KEY = "file-foundation:config:provider";

let stack: TestStack;
let db: DbConnection;
let provider: InMemoryFileProvider;
let seed: ForgetSeeders;
let buildStorageProvider: (tenantId: string) => Promise<FileStorageProvider>;

function uuid(suffix: number): string {
  return `cccccccc-cccc-4ccc-8ccc-${suffix.toString(16).padStart(12, "0")}`;
}

async function uploadAs(user: SessionUser, fileName: string, bytes: Uint8Array): Promise<Response> {
  const token = await stack.jwt.sign(user);
  const fd = new FormData();
  fd.append("file", new File([Buffer.from(bytes)], fileName, { type: "application/pdf" }));
  const { body, contentType } = await buildMultipartBody(fd);
  return stack.app.request("/api/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body,
  });
}

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  provider = createInMemoryFileProvider();
  // Select the test plugin app-wide via a config app-override (no admin write).
  const appOverrides = new Map<string, string>([[FILE_PROVIDER_CONFIG_KEY, "test"]]);
  const resolver = createConfigResolver({ appOverrides });
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createFilesFeature(),
      fileFoundationFeature,
      createTestFileProviderFeature(provider, "test"),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createSessionsFeature(),
      createUserDataRightsFeature(),
      createUserDataRightsDefaultsFeature(),
    ],
    // No `files:` option on purpose — buildServer must resolve the upload
    // provider through the mounted file-foundation, like production.
    extraContext: ({ registry }) => ({
      configResolver: resolver,
      _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
    }),
  });
  db = stack.db;
  seed = createForgetSeeders(db, provider);
  buildStorageProvider = makeTenantStorageProviderResolver({
    registry: stack.registry,
    configResolver: resolver,
    secrets: undefined,
    db,
    userId: SYSTEM_USER_ID,
    handlerName: "test-608-e2e",
  });

  await unsafeCreateEntityTable(db, userEntity);
  await unsafeCreateEntityTable(db, userSessionEntity);
  await unsafeCreateEntityTable(db, tenantRetentionOverrideEntity);
  await unsafePushTables(db, { fileRefsTable, configValuesTable });
  await createEventsTable(db);
  await asRawClient(db).unsafe(READ_TENANT_MEMBERSHIPS_DDL);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  provider.clear();
  await resetTestTables(db, [userTable, "read_tenant_memberships", fileRefsTable]);
});

describe("#608 unified file-storage :: route upload + GDPR erasure hit one store", () => {
  test("a file uploaded via /api/files lands in the file-foundation store and forget erases it", async () => {
    const userId = uuid(1);
    // The uploader is also the forget subject (DeletionRequested + grace passed).
    await seed.seedForgetUser(userId);
    await seed.seedMembership(userId, TENANT_SYSTEM);
    const uploader: SessionUser = { id: userId, tenantId: TENANT_SYSTEM, roles: ["Member"] };

    const res = await uploadAs(uploader, "secret.pdf", new Uint8Array([10, 20, 30, 40]));
    expect(res.status).toBe(201);
    const { storageKey } = (await res.json()) as { storageKey: string };

    // The upload route resolved its provider through file-foundation — the bytes
    // are in `provider`. A static/separate upload provider would miss here.
    expect(await provider.exists(storageKey)).toBe(true);

    // Erasure resolves through the SAME source and deletes the very same bytes —
    // no false "done", no orphaned binary.
    const result = await runForgetCleanup({
      db,
      registry: stack.registry,
      now: nowInstant(),
      buildStorageProvider,
    });
    expect(result.processedUserIds).toContain(userId);
    expect(await provider.exists(storageKey)).toBe(false);
  });
});
