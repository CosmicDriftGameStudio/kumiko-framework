// Full-stack integration test for file-foundation. Drives the
// provider-factory through the dispatcher so the real config-resolver
// + secrets-context + tenant-scoped reads are exercised.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { createEncryptionProvider, type DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { defineFeature, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createEnvMasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  createMutableMasterKeyProvider,
  type MutableMasterKeyProvider,
} from "@cosmicdrift/kumiko-framework/testing";
import { z } from "zod";
import { createConfigFeature } from "../../config";
import { ConfigHandlers } from "../../config/constants";
import { createConfigAccessorFactory } from "../../config/feature";
import { type ConfigResolver, createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { fileProviderS3Feature, S3_SECRET_ACCESS_KEY } from "../../file-provider-s3";
import { fileProviderS3EnvFeature } from "../../file-provider-s3-env";
import { createSecretsContext, createSecretsFeature, tenantSecretsTable } from "../../secrets";
import { createTenantFeature } from "../../tenant/feature";
import { tenantEntity } from "../../tenant/schema/tenant";
import { createFileProviderForTenant, fileFoundationFeature } from "../feature";

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
      fileProviderS3Feature,
      fileProviderS3EnvFeature,
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

  await unsafeCreateEntityTable(db, tenantEntity);
  await unsafePushTables(db, { configValuesTable, tenant_secrets: tenantSecretsTable });
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

/** Set the file-foundation provider-selector to "s3". */
async function selectS3Provider(admin: ReturnType<typeof adminFor>) {
  await setConfig(admin, "file-foundation:config:provider", "s3");
}

// --- Scenario 1: full happy-path roundtrip (Hetzner Object Storage shape) ---

describe("scenario 1: happy path", () => {
  test("admin sets config + secret → factory builds working file-storage provider", async () => {
    const admin = adminFor(501);

    await selectS3Provider(admin);
    // Hetzner Object Storage typical config — covers MinIO/R2/S3 too via
    // endpoint + forcePathStyle. AccessKeyId is public-ish, secret goes
    // into the encrypted secrets store.
    await setConfig(admin, "file-provider-s3:config:bucket", "test-bucket");
    await setConfig(admin, "file-provider-s3:config:region", "fsn1");
    await setConfig(
      admin,
      "file-provider-s3:config:endpoint",
      "https://fsn1.your-objectstorage.com",
    );
    await setConfig(admin, "file-provider-s3:config:force-path-style", true);
    await setConfig(admin, "file-provider-s3:config:access-key-id", "AKIATEST123");

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
  test("missing bucket → 422 unconfigured naming the key, not a cryptic SDK error", async () => {
    const admin = adminFor(502);

    await selectS3Provider(admin);
    // Set everything except bucket. requireNonEmpty rejects with a clear
    // message naming `bucket`.
    await setConfig(admin, "file-provider-s3:config:region", "us-east-1");
    await setConfig(admin, "file-provider-s3:config:access-key-id", "AKIATEST");
    await stack.http.writeOk(
      "secrets:write:set",
      { key: S3_SECRET_ACCESS_KEY.name, value: "secret" },
      admin,
    );

    const error = await stack.http.writeErr(TEST_HANDLER_QN, {}, admin);
    expect(JSON.stringify(error)).toMatch(/'bucket' is empty/);
    expect(error.httpStatus).toBe(422);
    expect(error.code).toBe("unconfigured");
    expect(error.i18nKey).toBe("errors.unconfigured");
    expect(error.details).toMatchObject({ feature: "file-provider-s3", key: "bucket" });
  });

  test("missing secret-access-key → 422 unconfigured naming the secret", async () => {
    const admin = adminFor(503);

    await selectS3Provider(admin);
    await setConfig(admin, "file-provider-s3:config:bucket", "b");
    await setConfig(admin, "file-provider-s3:config:region", "us-east-1");
    await setConfig(admin, "file-provider-s3:config:access-key-id", "AKIATEST");
    // Skip the secret. Factory throws referencing S3_SECRET_ACCESS_KEY.name.

    const error = await stack.http.writeErr(TEST_HANDLER_QN, {}, admin);
    expect(JSON.stringify(error)).toMatch(/s3-secret-access-key/);
    expect(error.httpStatus).toBe(422);
    expect(error.code).toBe("unconfigured");
    expect(error.details).toMatchObject({
      feature: "file-provider-s3",
      key: S3_SECRET_ACCESS_KEY.name,
    });
  });
});

// --- Scenario 3: tenant isolation ---

describe("scenario 3: tenant isolation", () => {
  test("tenant A's S3 config doesn't bleed into tenant B's provider", async () => {
    const adminA = adminFor(504);
    const adminB = adminFor(505);

    await selectS3Provider(adminA);
    await selectS3Provider(adminB);

    await setConfig(adminA, "file-provider-s3:config:bucket", "tenant-a-bucket");
    await setConfig(adminA, "file-provider-s3:config:region", "fsn1");
    await setConfig(adminA, "file-provider-s3:config:access-key-id", "A-KEY");
    await stack.http.writeOk(
      "secrets:write:set",
      { key: S3_SECRET_ACCESS_KEY.name, value: "secret-a" },
      adminA,
    );

    await setConfig(adminB, "file-provider-s3:config:bucket", "tenant-b-bucket");
    await setConfig(adminB, "file-provider-s3:config:region", "us-east-1");
    await setConfig(adminB, "file-provider-s3:config:access-key-id", "B-KEY");
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

// --- Scenario 4: s3-env provider builds from env, NO per-tenant secret ---
//
// The "wire-into-any-app" proof for file-provider-s3-env: select the
// "s3-env" provider, set the S3_* env vars, and the factory builds a working
// provider WITHOUT any secrets:write:set call. This is the single-bucket /
// Hetzner deploy path — no admin seeding, no secrets store.

const S3_ENV_KEYS = ["S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY", "S3_SECRET_KEY"] as const;

describe("scenario 4: s3-env provider (app-wide env, no secrets)", () => {
  test("env vars set + provider=s3-env → factory builds provider without a per-tenant secret", async () => {
    const admin = adminFor(504);
    const saved = S3_ENV_KEYS.map((k) => [k, process.env[k]] as const);
    Object.assign(process.env, {
      S3_BUCKET: "shared-bucket",
      S3_REGION: "fsn1",
      S3_ACCESS_KEY: "AKIAENV",
      S3_SECRET_KEY: "env-secret-not-real",
    });
    try {
      await setConfig(admin, "file-foundation:config:provider", "s3-env");
      const result = (await stack.http.writeOk(TEST_HANDLER_QN, {}, admin)) as Record<
        string,
        unknown
      >;
      expect(result["hasWrite"]).toBe(true);
      expect(result["hasRead"]).toBe(true);
      expect(result["hasDelete"]).toBe(true);
    } finally {
      for (const [k, v] of saved) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});
