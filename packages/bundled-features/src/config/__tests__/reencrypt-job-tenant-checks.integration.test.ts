// Regression guard for kumiko-framework#2072: the KEK-rotation job's
// systemScope() fail-closed checks — createUncheckedSystemDb().
// acknowledgeCrossTenant() gating the initial cross-tenant scan,
// assertRowsTenant() re-verifying each per-tenant slice before it's served
// to the write loop — must not block legitimate multi-tenant rotation. A
// systemDb accidentally bound to the wrong tenant (e.g. always
// SYSTEM_TENANT_ID instead of the scanned row's own tenant) would make
// every non-system-tenant row fail closed via assertRowsTenant, landing in
// `failed` (not thrown — chunked-entity-migration.ts routes migrateRow
// throws through onRowError) rather than `migrated`.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventStoreExecutor, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  createSystemUser,
  createTenantConfig,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createEnvelopeCipher,
  createEnvMasterKeyProvider,
} from "@cosmicdrift/kumiko-framework/secrets";
import {
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { createMutableMasterKeyProvider } from "@cosmicdrift/kumiko-framework/testing";
import { createConfigFeature } from "../feature";
import { reencryptJob } from "../handlers/reencrypt.job";
import { createConfigResolver } from "../resolver";
import { configValueEntity, configValuesTable } from "../table";

const KEY = "tenant-check-rot:config:secret-pass";
const TENANT_A = testTenantId(201);
const TENANT_B = testTenantId(202);

const v1Key = randomBytes(32).toString("base64");
const v2Key = randomBytes(32).toString("base64");
const mutableProvider = createMutableMasterKeyProvider(
  createEnvMasterKeyProvider({
    env: {
      KUMIKO_SECRETS_MASTER_KEY_V1: v1Key,
      KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
    },
  }),
);
const cipher = createEnvelopeCipher(mutableProvider, {});
const resolver = createConfigResolver({ cipher });

const keyDef = createTenantConfig("text", {
  encrypted: true,
  read: access.admin,
  write: access.admin,
});

const tenantCheckFeature = defineFeature("tenant-check-rot", (r) => {
  r.requires("config");
  r.config({ keys: { "secret-pass": keyDef } });
});

const executor = createEventStoreExecutor(configValuesTable, configValueEntity, {
  entityName: "config-value",
});

let stack: TestStack;

async function seedRow(tenantId: string, plaintext: string): Promise<void> {
  const envelope = await cipher.encrypt(JSON.stringify(plaintext), { tenantId });
  const systemUser = createSystemUser(tenantId);
  const tdb = createTenantDb(stack.db, tenantId, "system");
  const result = await executor.create(
    { key: KEY, value: envelope, tenantId, userId: null },
    systemUser,
    tdb,
  );
  if (!result.isSuccess) throw new Error(`seed failed: ${result.error.code}`);
}

type RawConfigRow = { value: string; tenantId: string };

async function readRawValues(): Promise<readonly RawConfigRow[]> {
  return await selectMany<RawConfigRow>(stack.db, configValuesTable, { key: KEY });
}

type CapturedLog = { info: string[]; warn: string[] };

type TestJobLog = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: () => void;
  debug: () => void;
  child: () => TestJobLog;
};

function capturingLog(captured: CapturedLog): TestJobLog {
  const log: TestJobLog = {
    info: (msg) => captured.info.push(msg),
    warn: (msg) => captured.warn.push(msg),
    error: () => {},
    debug: () => {},
    child: () => log,
  };
  return log;
}

function jobCtx(captured: CapturedLog): Parameters<typeof reencryptJob>[1] {
  return {
    db: stack.db,
    registry: stack.registry,
    masterKeyProvider: mutableProvider,
    configEncryption: cipher,
    log: capturingLog(captured),
  } as unknown as Parameters<typeof reencryptJob>[1]; // @cast-boundary test-seam — job only reads db/registry/masterKeyProvider/configEncryption/log
}

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createConfigFeature(), tenantCheckFeature],
    masterKeyProvider: mutableProvider,
    extraContext: { configResolver: resolver, configEncryption: cipher },
  });
  await unsafePushTables(stack.db, { configValuesTable });
  await seedRow(TENANT_A, "tenant-a-secret");
  await seedRow(TENANT_B, "tenant-b-secret");
});

afterAll(async () => {
  await stack.cleanup();
});

describe("config KEK-rotation job — multi-tenant scan + write checks (kumiko-framework#2072)", () => {
  test("acknowledgeCrossTenant scan + per-tenant assertRowsTenant checks still rotate every tenant's row", async () => {
    const beforeRows = await readRawValues();
    expect(beforeRows).toHaveLength(2);
    for (const row of beforeRows) {
      expect(JSON.parse(row.value).kekVersion).toBe(1);
    }

    // "ops added a new master key version and flipped CURRENT=2".
    mutableProvider.replace(
      createEnvMasterKeyProvider({
        env: {
          KUMIKO_SECRETS_MASTER_KEY_V1: v1Key,
          KUMIKO_SECRETS_MASTER_KEY_V2: v2Key,
          KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "2",
        },
      }),
    );

    const captured: CapturedLog = { info: [], warn: [] };
    await reencryptJob({}, jobCtx(captured));

    // No warn output — an over-restrictive systemDb binding would reject a
    // row via assertRowsTenant, landing it in `failed` with a warn log
    // instead of `migrated`.
    expect(captured.warn).toEqual([]);

    const completeLine = captured.info.find((line) =>
      line.includes("[config:reencrypt] complete:"),
    );
    if (!completeLine) throw new Error("job did not log a completion summary");
    const result = JSON.parse(completeLine.slice(completeLine.indexOf("{"))) as {
      migrated: number;
      failed: number;
      alreadyCurrent: number;
    };
    expect(result.migrated).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.alreadyCurrent).toBe(0);

    const afterRows = await readRawValues();
    expect(afterRows).toHaveLength(2);
    for (const row of afterRows) {
      expect(JSON.parse(row.value).kekVersion).toBe(2);
    }

    expect(await resolver.get(KEY, keyDef, TENANT_A, "u1", stack.db)).toBe("tenant-a-secret");
    expect(await resolver.get(KEY, keyDef, TENANT_B, "u1", stack.db)).toBe("tenant-b-secret");
  });
});
