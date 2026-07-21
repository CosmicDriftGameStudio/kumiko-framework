// Regression guard for kumiko-framework#1188: proves a write interleaved
// with a running rotation survives — the event-store executor's optimistic
// concurrency check rejects the rotation job's stale-version update, so the
// version_conflict branch in reencrypt.job.ts's migrateRow (currently just
// "a concurrent config:set beat us; the row now holds a fresh envelope —
// already fine.") is verified, not just an unverified comment. Modeled on
// reencrypt-job-kek-rotation.integration.test.ts (kumiko-framework#1187)
// for the stack/rotation setup.
//
// The race is simulated deterministically: the job context's
// configEncryption.encrypt is wrapped so the FIRST call (which migrateRow
// makes right before its own executor.update) performs a second, unrelated
// write to the same row first. That write lands on the row version the job
// captured at batch-read time, so the job's own update — issued a moment
// later with that now-stale version — is guaranteed to hit version_conflict.

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
  type EnvelopeCipher,
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

const KEY = "kek-rot-race:config:race-pass";
const ORIGINAL_PLAINTEXT = "pre-race-value";
const CONCURRENT_PLAINTEXT = "concurrent-write-value";
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

const rotFeature = defineFeature("kek-rot-race", (r) => {
  r.requires("config");
  r.config({ keys: { "race-pass": keyDef } });
});

const executor = createEventStoreExecutor(configValuesTable, configValueEntity, {
  entityName: "config-value",
});

let stack: TestStack;

type ConfigRow = {
  id: string;
  key: string;
  value: string | null;
  tenantId: string;
  version: number;
};

async function readRow(): Promise<ConfigRow> {
  const rows = await selectMany<ConfigRow>(stack.db, configValuesTable, { key: KEY });
  const row = rows[0];
  if (!row) throw new Error("no config row");
  return row;
}

async function seedV1Row(): Promise<void> {
  const envelope = await cipher.encrypt(JSON.stringify(ORIGINAL_PLAINTEXT), {
    tenantId: SYSTEM_TENANT_ID,
  });
  const systemUser = createSystemUser(SYSTEM_TENANT_ID);
  const tdb = createTenantDb(stack.db, SYSTEM_TENANT_ID, "system");
  const result = await executor.create(
    { key: KEY, value: envelope, tenantId: SYSTEM_TENANT_ID, userId: null },
    systemUser,
    tdb,
  );
  if (!result.isSuccess) throw new Error(`seed failed: ${result.error.code}`);
}

// Writes CONCURRENT_PLAINTEXT to the row using the version the rotation job
// itself captured at batch-read time — the same version-N -> N+1 bump a
// real interleaved handler write would cause.
async function writeConcurrently(atVersion: number): Promise<void> {
  const envelope = await cipher.encrypt(JSON.stringify(CONCURRENT_PLAINTEXT), {
    tenantId: SYSTEM_TENANT_ID,
  });
  const systemUser = createSystemUser(SYSTEM_TENANT_ID);
  const tdb = createTenantDb(stack.db, SYSTEM_TENANT_ID, "system");
  const row = await readRow();
  const result = await executor.update(
    { id: row.id, version: atVersion, changes: { value: envelope } },
    systemUser,
    tdb,
  );
  if (!result.isSuccess) throw new Error(`concurrent write setup failed: ${result.error.code}`);
}

const noopLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => noopLog,
};

// Fires the concurrent write on the first encrypt() call the job makes —
// that's the point in migrateRow right after decrypt, right before its own
// executor.update, so the job's captured row.version is guaranteed stale by
// the time it issues that update.
function racyJobCtx(
  rowVersionAtBatchRead: number,
  log: typeof noopLog = noopLog,
): Parameters<typeof reencryptJob>[1] {
  let fired = false;
  const racyCipher: EnvelopeCipher = {
    decrypt: (stored, scope) => cipher.decrypt(stored, scope),
    encrypt: async (plaintext, scope) => {
      if (!fired) {
        fired = true;
        await writeConcurrently(rowVersionAtBatchRead);
      }
      return cipher.encrypt(plaintext, scope);
    },
  };
  return {
    db: stack.db,
    registry: stack.registry,
    masterKeyProvider: mutableProvider,
    configEncryption: racyCipher,
    log,
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

describe("config KEK-rotation job — concurrent write race (kumiko-framework#1188)", () => {
  test("a write interleaved with a running rotation wins — rotation's stale update is rejected, not silently applied", async () => {
    const seeded = await readRow();
    expect(JSON.parse(seeded.value as string).kekVersion).toBe(1);

    // "ops flips CURRENT=2 mid-flight" — same rotation trigger as #1187's test.
    mutableProvider.replace(
      createEnvMasterKeyProvider({
        env: {
          KUMIKO_SECRETS_MASTER_KEY_V1: v1Key,
          KUMIKO_SECRETS_MASTER_KEY_V2: v2Key,
          KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "2",
        },
      }),
    );

    // Distinguishes "skipped" (version_conflict, row already fine) from
    // "failed" (any other rejection) — both leave the row's end-state
    // identical (reencrypt.job.ts:159-166), so a regression that silently
    // turns this branch into "failed" would pass every assertion below it.
    // The warn log at reencrypt.job.ts:171 is the only observable signature
    // that fires on "failed" but not on "skipped" — assert it stayed silent.
    const warnCalls: unknown[][] = [];
    const spyLog = {
      ...noopLog,
      warn: (...args: unknown[]) => {
        warnCalls.push(args);
      },
    };
    await reencryptJob({}, racyJobCtx(seeded.version, spyLog));
    expect(warnCalls).toEqual([]);

    // The concurrent write already lands under the current key — its
    // envelope must survive untouched; the rotation job's own update lost
    // the version_conflict race and must not have overwritten it.
    const afterJobRow = await readRow();
    expect(JSON.parse(afterJobRow.value as string).kekVersion).toBe(2);
    expect(await resolver.get(KEY, keyDef, SYSTEM_TENANT_ID, "u1", stack.db)).toBe(
      CONCURRENT_PLAINTEXT,
    );

    // Rebuild guard: a from-scratch replay must land on the concurrent
    // write's event, not resurrect the rotation job's rejected update (it
    // never became an event) nor the original pre-race value.
    expect(stack.registry.getAllProjections().has(PROJECTION_NAME)).toBe(true);
    const rebuildResult = await rebuildProjection(PROJECTION_NAME, {
      db: stack.db,
      registry: stack.registry,
    });
    expect(rebuildResult.eventsProcessed).toBeGreaterThan(0);

    const afterRebuildRow = await readRow();
    expect(JSON.parse(afterRebuildRow.value as string).kekVersion).toBe(2);
    expect(await resolver.get(KEY, keyDef, SYSTEM_TENANT_ID, "u1", stack.db)).toBe(
      CONCURRENT_PLAINTEXT,
    );
  });
});
