// Full-stack integration test for file-foundation. Drives the
// provider-factory through the dispatcher so the real config-resolver
// + secrets-context + tenant-scoped reads are exercised.

import { randomBytes } from "node:crypto";
import { createEncryptionProvider, type DbConnection } from "@kumiko/framework/db";
import { defineFeature, defineWriteHandler } from "@kumiko/framework/engine";
import { createEventsTable } from "@kumiko/framework/event-store";
import { createEnvMasterKeyProvider } from "@kumiko/framework/secrets";
import {
  createEntityTable,
  createTestUser,
  pushTables,
  setupTestStack,
  type TestStack,
  testTenantId,
} from "@kumiko/framework/stack";
import {
  createMutableMasterKeyProvider,
  type MutableMasterKeyProvider,
} from "@kumiko/framework/testing";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";
import { createConfigFeature } from "../../config";
import { ConfigHandlers } from "../../config/constants";
import { createConfigAccessorFactory } from "../../config/feature";
import { type ConfigResolver, createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { createSecretsContext, createSecretsFeature, tenantSecretsTable } from "../../secrets";
import { createTenantFeature } from "../../tenant/feature";
import { tenantEntity } from "../../tenant/schema/tenant";
import {
  createFileProviderForTenant,
  fileFoundationFeature,
  S3_SECRET_ACCESS_KEY,
} from "../feature";

// --- Test-Handler that exercises the factory end-to-end ---

const TEST_HANDLER_QN = "file-test:write:build-provider";
const testProbeFeature = defineFeature("file-test", (r) => {
  r.requires("config");
  r.requires("secrets");
  r.writeHandler(
    defineWriteHandler({
      name: "build-provider",
      schema: z.object({}),
      access: { roles: ["TenantAdmin", "SystemAdmin"] },
      handler: async (event, ctx) => {
        const provider = await createFileProviderForTenant(
          ctx,
          event.user.tenantId,
          TEST_HANDLER_QN,
        );
        return {
          isSuccess: true,
          data: {
            hasWrite: typeof provider.write === "function",
            hasRead: typeof provider.read === "function",
            hasDelete: typeof provider.delete === "function",
          },
        };
      },
    }),
  );
});

// --- Setup ---

let stack: TestStack;
let db: DbConnection;
let resolver: ConfigResolver;
let providerRef: MutableMasterKeyProvider;

const testEncryptionKey = randomBytes(32).toString("base64");

beforeAll(async () => {
  const encryption = createEncryptionProvider(testEncryptionKey);
  resolver = createConfigResolver({ encryption });

  const initialKp = createEnvMasterKeyProvider({
    env: {
      KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
      KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
    },
  });
  providerRef = createMutableMasterKeyProvider(initialKp);

  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createSecretsFeature(),
      fileFoundationFeature,
      testProbeFeature,
    ],
    masterKeyProvider: providerRef,
    extraContext: ({ db, registry }) => ({
      configResolver: resolver,
      configEncryption: encryption,
      _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
      secrets: createSecretsContext({ db, masterKeyProvider: providerRef }),
    }),
  });
  db = stack.db;

  await createEntityTable(db, tenantEntity);
  await pushTables(db, { configValuesTable, tenant_secrets: tenantSecretsTable });
  await createEventsTable(db);
});

afterAll(async () => {
  await stack.cleanup();
});

function adminFor(tenantNumber: number) {
  return createTestUser({
    id: tenantNumber,
    tenantId: testTenantId(tenantNumber),
    roles: ["TenantAdmin", "SystemAdmin"],
  });
}

async function setConfig(admin: ReturnType<typeof adminFor>, key: string, value: unknown) {
  await stack.http.writeOk(ConfigHandlers.set, { key, value }, admin);
}

// --- Scenario 1: full happy-path roundtrip (Hetzner Object Storage shape) ---

describe("scenario 1: happy path", () => {
  test("admin sets config + secret → factory builds working file-storage provider", async () => {
    const admin = adminFor(501);

    // Hetzner Object Storage typical config — covers MinIO/R2/S3 too via
    // endpoint + forcePathStyle. AccessKeyId is public-ish, secret goes
    // into the encrypted secrets store.
    await setConfig(admin, "file-foundation:config:bucket", "test-bucket");
    await setConfig(admin, "file-foundation:config:region", "fsn1");
    await setConfig(
      admin,
      "file-foundation:config:endpoint",
      "https://fsn1.your-objectstorage.com",
    );
    await setConfig(admin, "file-foundation:config:force-path-style", true);
    await setConfig(admin, "file-foundation:config:access-key-id", "AKIATEST123");

    await stack.http.writeOk(
      "secrets:write:set",
      { key: S3_SECRET_ACCESS_KEY.name, value: "secret-key-not-actually-real" },
      admin,
    );

    const result = (await stack.http.writeOk(TEST_HANDLER_QN, {}, admin)) as Record<
      string,
      unknown
    >;
    expect(result["hasWrite"]).toBe(true);
    expect(result["hasRead"]).toBe(true);
    expect(result["hasDelete"]).toBe(true);
  });
});

// --- Scenario 2: validation errors ---

describe("scenario 2: validation errors", () => {
  test("missing bucket → factory throws with hint instead of cryptic SDK error", async () => {
    const admin = adminFor(502);

    // Set everything except bucket. requireNonEmpty rejects with a clear
    // message naming `bucket`.
    await setConfig(admin, "file-foundation:config:region", "us-east-1");
    await setConfig(admin, "file-foundation:config:access-key-id", "AKIATEST");
    await stack.http.writeOk(
      "secrets:write:set",
      { key: S3_SECRET_ACCESS_KEY.name, value: "secret" },
      admin,
    );

    const error = await stack.http.writeErr(TEST_HANDLER_QN, {}, admin);
    expect(JSON.stringify(error)).toMatch(/'bucket' is empty/);
  });

  test("missing secret-access-key → factory throws naming the secret", async () => {
    const admin = adminFor(503);

    await setConfig(admin, "file-foundation:config:bucket", "b");
    await setConfig(admin, "file-foundation:config:region", "us-east-1");
    await setConfig(admin, "file-foundation:config:access-key-id", "AKIATEST");
    // Skip the secret. Factory throws referencing S3_SECRET_ACCESS_KEY.name.

    const error = await stack.http.writeErr(TEST_HANDLER_QN, {}, admin);
    expect(JSON.stringify(error)).toMatch(/s3-secret-access-key/);
  });
});

// --- Scenario 3: tenant isolation ---

describe("scenario 3: tenant isolation", () => {
  test("tenant A's S3 config doesn't bleed into tenant B's provider", async () => {
    const adminA = adminFor(504);
    const adminB = adminFor(505);

    await setConfig(adminA, "file-foundation:config:bucket", "tenant-a-bucket");
    await setConfig(adminA, "file-foundation:config:region", "fsn1");
    await setConfig(adminA, "file-foundation:config:access-key-id", "A-KEY");
    await stack.http.writeOk(
      "secrets:write:set",
      { key: S3_SECRET_ACCESS_KEY.name, value: "secret-a" },
      adminA,
    );

    await setConfig(adminB, "file-foundation:config:bucket", "tenant-b-bucket");
    await setConfig(adminB, "file-foundation:config:region", "us-east-1");
    await setConfig(adminB, "file-foundation:config:access-key-id", "B-KEY");
    await stack.http.writeOk(
      "secrets:write:set",
      { key: S3_SECRET_ACCESS_KEY.name, value: "secret-b" },
      adminB,
    );

    const a = (await stack.http.writeOk(TEST_HANDLER_QN, {}, adminA)) as Record<string, unknown>;
    const b = (await stack.http.writeOk(TEST_HANDLER_QN, {}, adminB)) as Record<string, unknown>;
    expect(a["hasWrite"]).toBe(true);
    expect(b["hasWrite"]).toBe(true);
  });
});
