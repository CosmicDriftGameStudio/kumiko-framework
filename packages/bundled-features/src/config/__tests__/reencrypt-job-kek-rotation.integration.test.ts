// Regression guard for kumiko-framework#1187: proves the config
// KEK-rotation job handles a real version-N → version-N+1 rotation, not
// just legacy-format → envelope (see encrypted-legacy-migration.integration
// .test.ts for that story). Modeled directly on auth-mfa's
// reencrypt-job.integration.test.ts, which is the reference regression
// guard for this exact bug class (kumiko-framework#266 Step 8): rotation
// must go through executor.update() (a real event), not a raw UPDATE on
// the projection table — otherwise a full projection rebuild replays the
// OLD event and resurrects the pre-rotation kekVersion.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventStoreExecutor, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  createSystemConfig,
  createSystemUser,
  defineFeature,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { rebuildProjection } from "@cosmicdrift/kumiko-framework/pipeline";
import {
  createEnvelopeCipher,
  createEnvMasterKeyProvider,
} from "@cosmicdrift/kumiko-framework/secrets";
import {
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { createMutableMasterKeyProvider } from "@cosmicdrift/kumiko-framework/testing";
import { createConfigFeature } from "../feature";
import { reencryptJob } from "../handlers/reencrypt.job";
import { createConfigResolver } from "../resolver";
import { configValueEntity, configValuesTable } from "../table";

const KEY = "kek-rot:config:secret-pass";
const PLAINTEXT = "rotate-me-please";
const PROJECTION_NAME = "config:projection:config-value-entity";

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

const keyDef = createSystemConfig("text", {
  encrypted: true,
  read: access.systemAdmin,
  write: access.systemAdmin,
});

const rotFeature = defineFeature("kek-rot", (r) => {
  r.requires("config");
  r.config({ keys: { "secret-pass": keyDef } });
});

const executor = createEventStoreExecutor(configValuesTable, configValueEntity, {
  entityName: "config-value",
});

let stack: TestStack;

async function seedV1Row(): Promise<void> {
  const envelope = await cipher.encrypt(JSON.stringify(PLAINTEXT), { tenantId: SYSTEM_TENANT_ID });
  const systemUser = createSystemUser(SYSTEM_TENANT_ID);
  const tdb = createTenantDb(stack.db, SYSTEM_TENANT_ID, "system");
  const result = await executor.create(
    { key: KEY, value: envelope, tenantId: SYSTEM_TENANT_ID, userId: null },
    systemUser,
    tdb,
  );
  if (!result.isSuccess) throw new Error(`seed failed: ${result.error.code}`);
}

type RawConfigRow = { value: string };

async function readRawValue(): Promise<RawConfigRow> {
  const rows = await selectMany<RawConfigRow>(stack.db, configValuesTable, { key: KEY });
  const row = rows[0];
  if (!row) throw new Error("no config row");
  return row;
}

const noopLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => noopLog,
};

function jobCtx(): Parameters<typeof reencryptJob>[1] {
  return {
    db: stack.db,
    registry: stack.registry,
    masterKeyProvider: mutableProvider,
    configEncryption: cipher,
    log: noopLog,
  } as unknown as Parameters<typeof reencryptJob>[1]; // @cast-boundary test-seam — job only reads db/registry/masterKeyProvider/configEncryption/log
}

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createConfigFeature(), rotFeature],
    masterKeyProvider: mutableProvider,
    extraContext: { configResolver: resolver, configEncryption: cipher },
  });
  await unsafePushTables(stack.db, { configValuesTable });
  await seedV1Row();
});

afterAll(async () => {
  await stack.cleanup();
});

describe("config KEK-rotation job — version-N to version-N+1 (kumiko-framework#1187)", () => {
  test("rotation rewraps the value onto the current KEK, and a full projection rebuild still lands on it", async () => {
    const beforeRow = await readRawValue();
    expect(JSON.parse(beforeRow.value).kekVersion).toBe(1);

    // "ops added a new master key version and flipped CURRENT=2" —
    // same simulate-rotation-without-restart shape auth-mfa's test uses.
    mutableProvider.replace(
      createEnvMasterKeyProvider({
        env: {
          KUMIKO_SECRETS_MASTER_KEY_V1: v1Key,
          KUMIKO_SECRETS_MASTER_KEY_V2: v2Key,
          KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "2",
        },
      }),
    );

    await reencryptJob({}, jobCtx());

    const afterJobRow = await readRawValue();
    expect(JSON.parse(afterJobRow.value).kekVersion).toBe(2);

    // Vacuous-rebuild guard: confirm the projection name actually exists
    // before trusting a silent no-op rebuild as a pass.
    expect(stack.registry.getAllProjections().has(PROJECTION_NAME)).toBe(true);

    const rebuildResult = await rebuildProjection(PROJECTION_NAME, {
      db: stack.db,
      registry: stack.registry,
    });
    expect(rebuildResult.eventsProcessed).toBeGreaterThan(0);

    // The regression guard itself: a from-scratch rebuild replays every
    // event for this row and must land on the V2 envelope from the
    // rotation job's own .updated event — NOT a resurrected V1 wrap from
    // the original seed event. Kept alive with the V1 key still present
    // in the env on purpose: a resurrected V1 row would still decrypt
    // cleanly, so only this version-tag check (not the decrypt below)
    // catches the regression this issue describes.
    const afterRebuildRow = await readRawValue();
    expect(JSON.parse(afterRebuildRow.value).kekVersion).toBe(2);

    // Decrypt-level proof, not just the version tag: the plaintext
    // survived rotation + rebuild byte-identically.
    expect(await resolver.get(KEY, keyDef, SYSTEM_TENANT_ID, "u1", stack.db)).toBe(PLAINTEXT);
  });
});
