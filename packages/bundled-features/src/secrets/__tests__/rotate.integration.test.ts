// Integration test for the rotate-job circuit-breaker. Seeds a handful of
// rows and feeds the job a provider that always fails to unwrap, then
// asserts the job bails after maxFailures instead of spraying the log
// with every row's identical error.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { deleteMany, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { AppContext } from "@cosmicdrift/kumiko-framework/engine";
import { rebuildProjection } from "@cosmicdrift/kumiko-framework/pipeline";
import {
  createEnvMasterKeyProvider,
  decodeStoredEnvelope,
  decryptValue,
  type MasterKeyProvider,
} from "@cosmicdrift/kumiko-framework/secrets";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { createSecretsFeature } from "../feature";
import { rotateJob } from "../handlers/rotate.job";
import { createSecretsContext } from "../secrets-context";
import { type StoredEnvelope, tenantSecretsTable } from "../table";

const admin = createTestUser({
  id: "00000000-0000-4000-8000-000000000010",
  tenantId: "00000000-0000-4000-8000-000000000001",
  roles: ["TenantAdmin"],
});

// Captured so the happy-path rotation test can build a provider whose V1
// key matches the seeded rows exactly — a fresh random V1 would fail the
// GCM auth tag on every unwrap.
const SEED_V1_KEY = randomBytes(32).toString("base64");
// Shared with the happy-path test's rotator AND its verifier — the verifier
// must decrypt with ONLY this key so a rewrap that bumps kek_version but
// leaves the envelope V1-wrapped fails loud instead of silently passing.
const ROTATED_V2_KEY = randomBytes(32).toString("base64");

// A provider that encrypts happily on wrapDek but always rejects
// unwrapDek. Simulates "KEK is unreachable / corrupt" — the failure mode
// the circuit-breaker exists to contain. The returned object carries a
// `calls` counter so tests can observe how many unwrap attempts happened
// before the breaker tripped — that's how we tell maxFailures=1 apart
// from maxFailures=N+rows (both leave the rows on V1, only the call-count
// differs).
type BrokenProvider = MasterKeyProvider & { calls(): number };
function createBrokenUnwrapProvider(): BrokenProvider {
  const base = createEnvMasterKeyProvider({
    env: {
      KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
      KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "2", // current != stored version so rotation is attempted
      KUMIKO_SECRETS_MASTER_KEY_V2: randomBytes(32).toString("base64"),
    },
  });
  let callCount = 0;
  return {
    wrapDek: base.wrapDek.bind(base),
    currentVersion: base.currentVersion.bind(base),
    isAvailable: base.isAvailable.bind(base),
    unwrapDek: async () => {
      callCount++;
      throw new Error("simulated KEK failure");
    },
    calls: () => callCount,
  };
}

let stack: TestStack;

beforeAll(async () => {
  // Seeding the table uses a sane V1-only provider so writes land on V1.
  const seedProvider = createEnvMasterKeyProvider({
    env: {
      KUMIKO_SECRETS_MASTER_KEY_V1: SEED_V1_KEY,
      KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
    },
  });

  stack = await setupTestStack({
    features: [createSecretsFeature()],
    masterKeyProvider: seedProvider,
    extraContext: ({ db }) => ({
      secrets: createSecretsContext({ db, masterKeyProvider: seedProvider }),
    }),
  });
  await unsafePushTables(stack.db, {
    tenant_secrets: tenantSecretsTable,
  });

  // Seed 20 V1 rows through the real write path (executor.create) instead
  // of a raw insertOne — the rotate job's executor.update needs an actual
  // event stream to update against, which a headless projection row lacks.
  const seedSecrets = createSecretsContext({ db: stack.db, masterKeyProvider: seedProvider });
  for (let i = 0; i < 20; i++) {
    await seedSecrets.set(admin.tenantId, `test:secret:k-${i}`, `secret-${i}`);
  }
});

afterAll(async () => {
  // Clean up the seeded fixtures so downstream suites don't see them.
  await deleteMany(stack.db, tenantSecretsTable, { tenantId: admin.tenantId });
  await stack.cleanup();
});

type Log = NonNullable<AppContext["log"]>;
function silentLogger(): Log {
  const noop = () => {};
  const logger: Log = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    child: () => logger,
  };
  return logger;
}

type RotateJobCtx = Pick<AppContext, "db" | "masterKeyProvider" | "log">;
function jobCtx(provider: MasterKeyProvider): Parameters<typeof rotateJob>[1] {
  const ctx: RotateJobCtx = {
    db: stack.db,
    masterKeyProvider: provider,
    log: silentLogger(),
  };
  return ctx as unknown as Parameters<typeof rotateJob>[1];
}

async function countV1Rows(): Promise<number> {
  const rows = await selectMany(stack.db, tenantSecretsTable, { tenantId: admin.tenantId });
  return rows.filter((r: Record<string, unknown>) => r["kekVersion"] === 1).length;
}

describe("rotate-job circuit-breaker", () => {
  test("bails after maxFailures consecutive errors — doesn't loop through all rows", async () => {
    const broken = createBrokenUnwrapProvider();

    // maxFailures: 3 means the job gives up after 3 failed rows. Without
    // the breaker it would attempt all 20 and log 20 warns.
    await rotateJob({ batchSize: 10, maxFailures: 3 }, jobCtx(broken));

    // All 20 rows still at V1 — the broken provider never let any rewrap
    // succeed. Plus: the breaker tripped at ≤3 attempts, not 20.
    expect(await countV1Rows()).toBe(20);
    expect(broken.calls()).toBeLessThanOrEqual(3);
  });

  test("maxFailures=1 trips on the very first failure — single attempt then stop", async () => {
    const broken = createBrokenUnwrapProvider();

    await rotateJob({ batchSize: 10, maxFailures: 1 }, jobCtx(broken));

    // Same end-state (all rows on V1) but the internal counter proves the
    // breaker fired after exactly one failure instead of draining the batch.
    expect(await countV1Rows()).toBe(20);
    expect(broken.calls()).toBe(1);
  });

  test("maxFailures scales the call budget linearly — higher threshold → more attempts", async () => {
    // With an all-broken provider the job re-fetches the same rows each
    // batch (nothing rotated, nothing excluded), so the breaker is
    // eventually the ONLY thing that stops it. Raising maxFailures from 3
    // to 25 must raise the call-count accordingly — proves the breaker
    // honours its parameter rather than silently capping.
    const broken = createBrokenUnwrapProvider();

    await rotateJob({ batchSize: 10, maxFailures: 25 }, jobCtx(broken));

    expect(await countV1Rows()).toBe(20);
    expect(broken.calls()).toBe(25);
  });

  // Happy-path counterpart to the failure tests above: a working provider
  // that actually rewraps. Run last — it's the only test that mutates the
  // shared 20-row fixture, so the earlier "stays at 20" assertions must
  // see it before this runs. Enforced below, not just documented: a
  // precondition check fails loud (not silently-wrong) if a test inserted
  // between this and the circuit-breaker tests already touched the
  // fixture — rotateJob's batch scan has no per-row exclusion/ordering
  // to fall back on, so isolating this test onto a second tenant doesn't
  // help (rotator would just exhaust maxFailures on the other tenant's
  // still-V1 rows before ever reaching its own).
  test("successful rotation rewraps the DEK, bumps kekVersion, and preserves plaintext", async () => {
    expect(await countV1Rows()).toBe(20);

    const rotator = createEnvMasterKeyProvider({
      env: {
        KUMIKO_SECRETS_MASTER_KEY_V1: SEED_V1_KEY,
        KUMIKO_SECRETS_MASTER_KEY_V2: ROTATED_V2_KEY,
        KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "2",
      },
    });

    // Snapshot pre-rotation ciphertext — rotate.job.ts's header comment
    // claims "the ciphertext itself never changes, only the DEK wrapper".
    // Assert that invariant below instead of only checking kekVersion/
    // plaintext, which a rewrap-that-re-encrypts would also satisfy.
    const preRotation = await selectMany<{ key: string; envelope: StoredEnvelope }>(
      stack.db,
      tenantSecretsTable,
      { tenantId: admin.tenantId },
    );
    const ciphertextByKey = new Map(preRotation.map((row) => [row.key, row.envelope.ciphertext]));

    await rotateJob({ batchSize: 10, maxFailures: 5 }, jobCtx(rotator));

    expect(await countV1Rows()).toBe(0);

    // Decrypt with a V2-ONLY provider — no V1 key available. A rewrap
    // that only bumped the kek_version column but left the envelope
    // wrapped under V1 would throw "no KEK for version 1" here instead
    // of silently passing, which a decrypt via `rotator` (V1+V2) can't
    // catch since it still holds V1.
    const verifier = createEnvMasterKeyProvider({
      env: {
        KUMIKO_SECRETS_MASTER_KEY_V2: ROTATED_V2_KEY,
        KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "2",
      },
    });

    const rows = await selectMany<{ key: string; envelope: StoredEnvelope; kekVersion: number }>(
      stack.db,
      tenantSecretsTable,
      { tenantId: admin.tenantId },
    );
    expect(rows).toHaveLength(20);
    for (const row of rows) {
      expect(row.kekVersion).toBe(2);
      const expectedCiphertext = ciphertextByKey.get(row.key);
      expect(expectedCiphertext).toBeDefined();
      expect(row.envelope.ciphertext).toBe(expectedCiphertext as string);
      const expectedIndex = row.key.split("-").at(-1);
      const plaintext = await decryptValue(decodeStoredEnvelope(row.envelope), verifier);
      expect(plaintext).toBe(`secret-${expectedIndex}`);
    }

    // Regression guard (kumiko-framework#1189): rotate.job.ts's
    // executor.update() call carries no options, so it deliberately
    // never sets skipUnchanged — every rotation writes a real .updated
    // event, not a raw UPDATE. A full projection rebuild replays those
    // events; if a future refactor added skipUnchanged (or swapped the
    // event write for a raw column update) the rebuild would resurrect
    // the pre-rotation V1 envelopes instead of landing on V2, exactly
    // the #464 failure class config/auth-mfa already guard against.
    //
    // Vacuous-rebuild guard: confirm the projection name actually exists
    // and the rebuild really replayed events, so a wrong projection name
    // can't silently no-op the assertion below into a false pass.
    const projectionName = "secrets:projection:tenant-secret-entity";
    expect(stack.registry.getAllProjections().has(projectionName)).toBe(true);
    const rebuildResult = await rebuildProjection(projectionName, {
      db: stack.db,
      registry: stack.registry,
    });
    expect(rebuildResult.eventsProcessed).toBeGreaterThan(0);

    const rowsAfterRebuild = await selectMany<{ key: string; kekVersion: number }>(
      stack.db,
      tenantSecretsTable,
      { tenantId: admin.tenantId },
    );
    expect(rowsAfterRebuild).toHaveLength(20);
    for (const row of rowsAfterRebuild) {
      expect(row.kekVersion).toBe(2);
    }
  });
});
