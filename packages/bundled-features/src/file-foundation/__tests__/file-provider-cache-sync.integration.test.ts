// A provider-config write on one pod, or a secret write on any pod, must drop
// the cached per-tenant file provider so the next upload rebuilds it.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { defineFeature, FILE_PROVIDER_CONFIG_KEY } from "@cosmicdrift/kumiko-framework/engine";
import {
  createInMemoryFileProvider,
  fileRefsTable,
  type InMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import { createEnvMasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import {
  createTestDb,
  createTestUser,
  setupTestStack,
  type TestDb,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  buildMultipartBody,
  patchFileInstanceofForBunTest,
  waitFor,
} from "@cosmicdrift/kumiko-framework/testing";
import { createConfigAccessorFactory, createConfigFeature } from "../../config/feature.js";
import { createConfigResolver } from "../../config/resolver.js";
import { configValuesTable } from "../../config/table.js";
import { createFilesFeature } from "../../files/index.js";
import { createDeclaredKeysFeature } from "../../secrets/__tests__/declared-keys-feature.js";
import { createSecretsFeature } from "../../secrets/feature.js";
import { createSecretsContext } from "../../secrets/secrets-context.js";
import { tenantSecretsTable } from "../../secrets/table.js";
import { fileFoundationFeature } from "../feature.js";

const admin = createTestUser({ id: 31, roles: ["TenantAdmin"] });

type CountingProvider = {
  readonly store: InMemoryFileProvider;
  readonly feature: ReturnType<typeof defineFeature>;
  builds: () => number;
};

function createCountingProvider(name: string): CountingProvider {
  const store = createInMemoryFileProvider();
  let buildCount = 0;
  const feature = defineFeature(`test-file-provider-${name}`, (r) => {
    r.requires("file-foundation");
    r.useExtension("fileProvider", name, {
      build: async () => {
        buildCount += 1;
        return store;
      },
    });
  });
  return { store, feature, builds: () => buildCount };
}

async function upload(stack: TestStack): Promise<string> {
  const token = await stack.jwt.sign(admin);
  const fd = new FormData();
  fd.append(
    "file",
    new File([Buffer.from("%PDF-1.4 minimal")], "doc.pdf", { type: "application/pdf" }),
  );
  const { body, contentType } = await buildMultipartBody(fd);
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { storageKey: string }).storageKey;
}

function masterKeys() {
  return createEnvMasterKeyProvider({
    env: {
      KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
      KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
    },
  });
}

describe("file provider cache across instances", () => {
  const providerOld = createCountingProvider("provider-old");
  const providerNew = createCountingProvider("provider-new");
  let sharedDb: TestDb;
  let podA: TestStack;
  let podB: TestStack;

  async function bootPod(sharedRedisWith?: TestStack): Promise<TestStack> {
    const resolver = createConfigResolver();
    const pod = await setupTestStack({
      features: [
        createConfigFeature(),
        createFilesFeature(),
        fileFoundationFeature,
        providerOld.feature,
        providerNew.feature,
      ],
      dbName: sharedDb.dbName,
      persistentDb: true,
      cacheSync: true,
      ...(sharedRedisWith && { sharedRedisWith }),
      extraContext: ({ registry }) => ({
        configResolver: resolver,
        _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
      }),
    });
    await unsafePushTables(pod.db, { configValuesTable, fileRefsTable });
    return pod;
  }

  beforeAll(async () => {
    patchFileInstanceofForBunTest();
    sharedDb = await createTestDb();
    podA = await bootPod();
    podB = await bootPod(podA);
  });

  afterAll(async () => {
    await podB.cleanup();
    await podA.cleanup();
    await sharedDb.cleanup();
  });

  test("a provider-config write on pod A redirects uploads on pod B", async () => {
    await podA.http.writeOk(
      "config:write:set",
      { key: FILE_PROVIDER_CONFIG_KEY, value: "provider-old" },
      admin,
    );
    const oldKey = await upload(podB);
    expect(await providerOld.store.exists(oldKey)).toBe(true);

    await podA.http.writeOk(
      "config:write:set",
      { key: FILE_PROVIDER_CONFIG_KEY, value: "provider-new" },
      admin,
    );

    await waitFor(async () => providerNew.store.exists(await upload(podB)));
  });
});

describe("file provider cache on secret writes", () => {
  const counting = createCountingProvider("provider-secret");
  const declared = createDeclaredKeysFeature();
  let stack: TestStack;

  beforeAll(async () => {
    patchFileInstanceofForBunTest();
    const resolver = createConfigResolver({
      appOverrides: new Map([[FILE_PROVIDER_CONFIG_KEY, "provider-secret"]]),
    });
    const masterKeyProvider = masterKeys();
    stack = await setupTestStack({
      features: [
        createConfigFeature(),
        createFilesFeature(),
        fileFoundationFeature,
        createSecretsFeature(),
        declared.feature,
        counting.feature,
      ],
      extraContext: ({ registry, db }) => ({
        configResolver: resolver,
        _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
        secrets: createSecretsContext({ db, masterKeyProvider }),
      }),
    });
    await unsafePushTables(stack.db, {
      configValuesTable,
      fileRefsTable,
      tenant_secrets: tenantSecretsTable,
    });
  });

  afterAll(async () => stack.cleanup());

  test("secrets:write:set drops the cached provider so the next upload rebuilds it", async () => {
    await upload(stack);
    await upload(stack);
    expect(counting.builds()).toBe(1);

    await stack.http.writeOk(
      "secrets:write:set",
      { key: declared.keys.plain.name, value: "rotated" },
      admin,
    );

    await upload(stack);
    expect(counting.builds()).toBe(2);
  });
});
