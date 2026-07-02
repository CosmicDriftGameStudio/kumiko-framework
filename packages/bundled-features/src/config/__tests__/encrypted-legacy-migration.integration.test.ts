// Pins the legacy → envelope migration story for encrypted config values:
//   1. rows written under the old CONFIG_ENCRYPTION_KEY format stay readable
//      as long as the legacy key is wired as the cipher's fallback,
//   2. reading an encrypted row WITHOUT any cipher throws (the pre-envelope
//      code silently returned the ciphertext as the value),
//   3. the reencrypt job migrates legacy rows onto the envelope format
//      through the event-store executor (event payload carries the new
//      envelope, so a projection rebuild no longer needs the legacy key),
//      and is idempotent on re-run.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { asRawClient, fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  createEncryptionProvider,
  createEventStoreExecutor,
  createTenantDb,
} from "@cosmicdrift/kumiko-framework/db";
import {
  type AppContext,
  access,
  createRegistry,
  createSystemUser,
  createTenantConfig,
  defineFeature,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createEnvelopeCipher,
  type EnvelopeCipher,
  isStoredEnvelope,
} from "@cosmicdrift/kumiko-framework/secrets";
import {
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { createTestMasterKeyProvider } from "@cosmicdrift/kumiko-framework/testing";
import { createConfigFeature } from "../feature";
import { reencryptJob } from "../handlers/reencrypt.job";
import { createConfigResolver } from "../resolver";
import { configValueEntity, configValuesTable } from "../table";

const KEY = "enc-mig:config:secret-pass";
const TENANT: TenantId = testTenantId(1);
const PLAINTEXT = "legacy-smtp-password";

const keyDef = createTenantConfig("text", {
  encrypted: true,
  read: access.all,
  write: access.all,
});

// legacy single-key provider — the pre-envelope CONFIG_ENCRYPTION_KEY world
const legacy = createEncryptionProvider(randomBytes(32).toString("base64"));
const masterKeyProvider = createTestMasterKeyProvider();
const cipherWithLegacy = createEnvelopeCipher(masterKeyProvider, { legacy });
const cipherWithoutLegacy = createEnvelopeCipher(masterKeyProvider);

const encMigFeature = defineFeature("enc-mig", (r) => {
  r.config({ keys: { "secret-pass": keyDef } });
});

const executor = createEventStoreExecutor(configValuesTable, configValueEntity, {
  entityName: "config-value",
});

let stack: TestStack;

async function seedLegacyRow(): Promise<string> {
  const legacyValue = legacy.encrypt(JSON.stringify(PLAINTEXT));
  const systemUser = createSystemUser(TENANT);
  const tdb = createTenantDb(stack.db, TENANT, "system");
  const result = await executor.create(
    { key: KEY, value: legacyValue, tenantId: TENANT, userId: null },
    systemUser,
    tdb,
  );
  if (!result.isSuccess) throw new Error(`seed failed: ${result.error.code}`);
  return (result.data as { id: string }).id;
}

async function readStoredValue(): Promise<string> {
  const row = await fetchOne<{ value: string }>(stack.db, configValuesTable, {
    key: KEY,
    tenantId: TENANT,
  });
  if (!row) throw new Error("row missing");
  return row.value;
}

type ReencryptCtx = Pick<AppContext, "db" | "masterKeyProvider" | "configEncryption" | "registry">;
function jobCtx(cipher: EnvelopeCipher): Parameters<typeof reencryptJob>[1] {
  const ctx: ReencryptCtx = {
    db: stack.db,
    masterKeyProvider,
    configEncryption: cipher,
    registry: stack.registry,
  };
  return ctx as unknown as Parameters<typeof reencryptJob>[1];
}

beforeAll(async () => {
  stack = await setupTestStack({ features: [createConfigFeature(), encMigFeature] });
  await unsafePushTables(stack.db, { configValuesTable });
  await seedLegacyRow();
});

afterAll(async () => {
  await stack.cleanup();
});

describe("legacy encrypted config rows", () => {
  test("stay readable through the cipher's legacy fallback (get + cascade path)", async () => {
    const resolver = createConfigResolver({ cipher: cipherWithLegacy });
    const value = await resolver.get(KEY, keyDef, TENANT, "u1", stack.db);
    expect(value).toBe(PLAINTEXT);

    const cascade = await resolver.getCascade(KEY, keyDef, TENANT, "u1", stack.db);
    const active = cascade.levels.find((l) => l.hasValue);
    expect(active?.value).toBe(PLAINTEXT);
  });

  test("throw without any cipher instead of leaking ciphertext as the value", async () => {
    const resolver = createConfigResolver({});
    await expect(resolver.get(KEY, keyDef, TENANT, "u1", stack.db)).rejects.toThrow(
      /encrypted but no cipher/,
    );
    await expect(resolver.getCascade(KEY, keyDef, TENANT, "u1", stack.db)).rejects.toThrow(
      /encrypted but no cipher/,
    );
  });

  test("throw with a remediation hint when the legacy key is missing", async () => {
    const resolver = createConfigResolver({ cipher: cipherWithoutLegacy });
    await expect(resolver.get(KEY, keyDef, TENANT, "u1", stack.db)).rejects.toThrow(/legacy/);
  });
});

describe("config:reencrypt job", () => {
  test("migrates the legacy row to envelope format via the executor", async () => {
    expect((await readStoredValue()).startsWith("{")).toBe(false);

    await reencryptJob({}, jobCtx(cipherWithLegacy));

    const stored = await readStoredValue();
    expect(stored.startsWith("{")).toBe(true);
    expect(isStoredEnvelope(JSON.parse(stored))).toBe(true);

    // decryptable WITHOUT the legacy key now — retiring CONFIG_ENCRYPTION_KEY
    // after a clean run is safe
    const resolver = createConfigResolver({ cipher: cipherWithoutLegacy });
    expect(await resolver.get(KEY, keyDef, TENANT, "u1", stack.db)).toBe(PLAINTEXT);
  });

  test("event payload carries the new envelope — rebuild-safe without legacy key", async () => {
    // The migration wrote a configValue.updated event whose payload holds
    // the envelope value; replaying events verbatim reproduces the
    // migrated state, so the final projection never needs the legacy key.
    const registryCheck = createRegistry([createConfigFeature(), encMigFeature]);
    expect(registryCheck.getConfigKey(KEY)?.encrypted).toBe(true);

    const events = await asRawClient(stack.db).unsafe<{
      payload: { changes?: { value?: string } };
    }>(
      `SELECT payload FROM kumiko_events WHERE aggregate_type = 'config-value' AND type LIKE '%.updated' ORDER BY created_at DESC LIMIT 1`,
    );
    const lastValue = events[0]?.payload?.changes?.value;
    expect(typeof lastValue).toBe("string");
    expect((lastValue as string).startsWith("{")).toBe(true);
  });

  test("is idempotent — a second run migrates nothing", async () => {
    const before = await readStoredValue();
    await reencryptJob({}, jobCtx(cipherWithLegacy));
    expect(await readStoredValue()).toBe(before);
  });
});
