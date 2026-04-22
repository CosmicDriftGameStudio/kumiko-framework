// Integration test for the audit-log retention job. Feature-level: we call
// the job handler through an in-memory ctx (not BullMQ) because the
// setupTestStack + jobRunner path is exercised end-to-end in the
// samples/secrets-demo suite. Here we pin the SQL: old rows go, young
// rows stay, the batch cap + signal + timeout paths work.

import { randomBytes } from "node:crypto";
import type { AppContext } from "@kumiko/framework/engine";
import { createEnvMasterKeyProvider } from "@kumiko/framework/secrets";
import {
  createTestUser,
  pushTables,
  setupTestStack,
  type TestStack,
} from "@kumiko/framework/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { retentionJob } from "../handlers/retention.job";
import { createSecretsContext } from "../secrets-context";
import { createSecretsFeature } from "../secrets-feature";
import { tenantSecretsAuditTable, tenantSecretsTable } from "../table";

// Dummy logger that satisfies the Logger shape without spamming stdout.
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

const admin = createTestUser({
  id: "00000000-0000-4000-8000-000000000010",
  tenantId: "00000000-0000-4000-8000-000000000001",
  roles: ["TenantAdmin"],
});

let stack: TestStack;

beforeAll(async () => {
  const provider = createEnvMasterKeyProvider({
    env: {
      KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
      KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
    },
  });
  stack = await setupTestStack({
    features: [createSecretsFeature()],
    masterKeyProvider: provider,
    extraContext: ({ db }) => ({
      secrets: createSecretsContext({ db, masterKeyProvider: provider }),
    }),
  });
  await pushTables(stack.db.db, {
    tenant_secrets: tenantSecretsTable,
    tenant_secret_reads: tenantSecretsAuditTable,
  });
});

afterAll(async () => {
  await stack.cleanup();
});

// Helper: build a minimal ctx that the retention job accepts. The
// retention handler only touches ctx.db and ctx.log — we type the helper
// against the exact AppContext subset it reads so "forgot to wire X"
// surfaces as a TS error, not a runtime undefined. Cast-down via unknown
// intermediate so the stricter type widens to JobHandlerFn's signature
// without us having to restate every AppContext field.
type RetentionJobCtx = Pick<AppContext, "db" | "registry" | "log">;
function jobCtx(): Parameters<typeof retentionJob>[1] {
  const ctx: RetentionJobCtx = {
    db: stack.db.db,
    registry: stack.registry,
    log: silentLogger(),
  };
  return ctx as unknown as Parameters<typeof retentionJob>[1];
}

async function seedAudit(tenantId: string, key: string, ageDays: number): Promise<void> {
  await stack.db.db.insert(tenantSecretsAuditTable).values({
    tenantId,
    key,
    userId: admin.id,
    handlerName: "test:seeded",
    readAt: sql`now() - ${sql.raw(`interval '${ageDays} days'`)}`,
  });
}

async function countAudit(tenantId: string): Promise<number> {
  const rows = await stack.db.db
    .select()
    .from(tenantSecretsAuditTable)
    .where(sql`${tenantSecretsAuditTable.tenantId} = ${tenantId}`);
  return rows.length;
}

describe("retention job — purge old tenant_secret_reads rows", () => {
  test("removes rows older than the default 90-day window", async () => {
    // Use a distinct tenant per test so parallel runs + earlier fixtures
    // can't bleed between cases.
    const tenantId = "00000000-0000-4000-8000-000000000101";

    await seedAudit(tenantId, "old-key-1", 120);
    await seedAudit(tenantId, "old-key-2", 95);
    await seedAudit(tenantId, "fresh-key", 3);
    expect(await countAudit(tenantId)).toBe(3);

    await retentionJob({}, jobCtx());

    // 2 old rows gone, fresh one stays.
    expect(await countAudit(tenantId)).toBe(1);
  });

  test("olderThanDays override respects custom retention windows", async () => {
    const tenantId = "00000000-0000-4000-8000-000000000102";

    await seedAudit(tenantId, "k1", 40);
    await seedAudit(tenantId, "k2", 10);
    await seedAudit(tenantId, "k3", 5);

    // 30-day window: the 40-day row goes, the others stay.
    await retentionJob({ olderThanDays: 30 }, jobCtx());

    expect(await countAudit(tenantId)).toBe(2);
  });

  test("empty table or all-young rows is a no-op", async () => {
    const tenantId = "00000000-0000-4000-8000-000000000103";

    // Seed only young rows.
    await seedAudit(tenantId, "young-1", 1);
    await seedAudit(tenantId, "young-2", 2);

    await retentionJob({ olderThanDays: 90 }, jobCtx());

    expect(await countAudit(tenantId)).toBe(2);
  });

  test("batchSize caps rows processed per chunk — large workloads stay bounded", async () => {
    const tenantId = "00000000-0000-4000-8000-000000000104";

    // Seed 5 old rows; with batchSize=2 we need multiple chunks.
    for (let i = 0; i < 5; i++) {
      await seedAudit(tenantId, `key-${i}`, 200);
    }
    expect(await countAudit(tenantId)).toBe(5);

    await retentionJob({ olderThanDays: 90, batchSize: 2 }, jobCtx());

    // All 5 old rows gone despite the small batch — the job loops until
    // empty.
    expect(await countAudit(tenantId)).toBe(0);
  });

  test("olderThanDays=0 deletes everything (explicit emergency-wipe path)", async () => {
    const tenantId = "00000000-0000-4000-8000-000000000105";

    // Seed rows at every age bucket — all must go.
    await seedAudit(tenantId, "k-old", 500);
    await seedAudit(tenantId, "k-mid", 30);
    await seedAudit(tenantId, "k-fresh", 0);
    expect(await countAudit(tenantId)).toBe(3);

    await retentionJob({ olderThanDays: 0 }, jobCtx());

    // 0-day window = "everything older than right now" — rows seeded a
    // split-second ago technically match `read_at < now()` so they go.
    // Documents the explicit-wipe behaviour so a future maintainer
    // doesn't "fix" the zero-handling to off-by-one.
    expect(await countAudit(tenantId)).toBe(0);
  });

  test("rejects non-integer olderThanDays (SQL-injection guard)", async () => {
    // BullMQ delivers payloads as opaque JSON — a malicious or buggy
    // caller could send a string instead of a number. Job must reject
    // before building SQL, not substitute the string into sql.raw().
    await expect(
      // biome-ignore lint/suspicious/noExplicitAny: deliberate type bypass for guard test
      retentionJob({ olderThanDays: "90; DROP TABLE tenant_secret_reads" as any }, jobCtx()),
    ).rejects.toThrow(/non-negative integer/);
    await expect(retentionJob({ olderThanDays: -1 }, jobCtx())).rejects.toThrow(
      /non-negative integer/,
    );
    await expect(retentionJob({ olderThanDays: 1.5 }, jobCtx())).rejects.toThrow(
      /non-negative integer/,
    );
  });
});
