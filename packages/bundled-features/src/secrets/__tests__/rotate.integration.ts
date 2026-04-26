// Integration test for the rotate-job circuit-breaker. Seeds a handful of
// rows and feeds the job a provider that always fails to unwrap, then
// asserts the job bails after maxFailures instead of spraying the log
// with every row's identical error.

import { randomBytes } from "node:crypto";
import type { AppContext } from "@kumiko/framework/engine";
import {
  createEnvMasterKeyProvider,
  encryptValue,
  type MasterKeyProvider,
} from "@kumiko/framework/secrets";
import {
  createTestUser,
  pushTables,
  setupTestStack,
  type TestStack,
} from "@kumiko/framework/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createSecretsFeature } from "../feature";
import { rotateJob } from "../handlers/rotate.job";
import { createSecretsContext } from "../secrets-context";
import { tenantSecretsTable } from "../table";

const admin = createTestUser({
  id: "00000000-0000-4000-8000-000000000010",
  tenantId: "00000000-0000-4000-8000-000000000001",
  roles: ["TenantAdmin"],
});

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
      KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
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
  await pushTables(stack.db, {
    tenant_secrets: tenantSecretsTable,
  });

  // Seed 20 V1 rows directly — too many for any maxFailures default.
  for (let i = 0; i < 20; i++) {
    const envelope = await encryptValue(`secret-${i}`, seedProvider);
    await stack.db.insert(tenantSecretsTable).values({
      tenantId: admin.tenantId,
      key: `test:secret:k-${i}`,
      envelope: {
        ciphertext: envelope.ciphertext.toString("base64"),
        iv: envelope.iv.toString("base64"),
        authTag: envelope.authTag.toString("base64"),
        encryptedDek: envelope.encryptedDek.toString("base64"),
        kekVersion: envelope.kekVersion,
      },
      kekVersion: envelope.kekVersion,
    });
  }
});

afterAll(async () => {
  // Clean up the seeded fixtures so downstream suites don't see them.
  await stack.db.delete(tenantSecretsTable).where(eq(tenantSecretsTable.tenantId, admin.tenantId));
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
  const rows = await stack.db
    .select({ kekVersion: tenantSecretsTable.kekVersion })
    .from(tenantSecretsTable)
    .where(sql`${tenantSecretsTable.tenantId} = ${admin.tenantId}`);
  return rows.filter((r) => r.kekVersion === 1).length;
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
});
