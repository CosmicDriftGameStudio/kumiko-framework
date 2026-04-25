// Integration test for the sessions cleanup job. Pattern mirrors
// secrets/retention.integration.ts — we hit the handler directly with a
// minimal ctx, because the full setupTestStack + jobRunner path is
// exercised by the framework's job tests. Here we pin the semantics: old
// expired/revoked rows go, live rows stay, batching + signal work.

import type { AppContext } from "@kumiko/framework/engine";
import {
  createEntityTable,
  setupTestStack,
  type TestStack,
  testTenantId,
} from "@kumiko/framework/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { cleanupJob } from "../handlers/cleanup.job";
import { createSessionsFeature } from "../sessions-feature";
import { userSessionEntity, userSessionTable } from "../user-session-entity";

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

const TENANT = testTenantId(1);

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createSessionsFeature()],
  });
  await createEntityTable(stack.db, userSessionEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await stack.db.delete(userSessionTable);
});

type JobCtx = Pick<AppContext, "db" | "registry" | "log">;
function jobCtx(): Parameters<typeof cleanupJob>[1] {
  const ctx: JobCtx = {
    db: stack.db,
    registry: stack.registry,
    log: silentLogger(),
  };
  return ctx as unknown as Parameters<typeof cleanupJob>[1];
}

// Seed a session row at a specific age. `kind` picks which lifecycle column
// to back-date: "expired" sets expiresAt in the past (session lived out its
// window), "revoked" sets revokedAt (user logged out, time passed), "live"
// leaves the row current (should never be deleted).
async function seedSession(opts: {
  id: string;
  userId: string;
  kind: "live" | "expired" | "revoked";
  ageDays: number;
}): Promise<void> {
  const now = sql`now()`;
  const pastCreated = sql`now() - ${sql.raw(`interval '${opts.ageDays + 1} days'`)}`;
  const past = sql`now() - ${sql.raw(`interval '${opts.ageDays} days'`)}`;
  const future = sql`now() + ${sql.raw(`interval '30 days'`)}`;

  await stack.db.insert(userSessionTable).values({
    id: opts.id,
    tenantId: TENANT,
    userId: opts.userId,
    createdAt: pastCreated,
    expiresAt: opts.kind === "expired" ? past : future,
    revokedAt: opts.kind === "revoked" ? past : null,
    ip: "test",
    userAgent: "test",
    modifiedAt: now,
  });
}

async function countSessions(): Promise<number> {
  const rows = await stack.db.select().from(userSessionTable);
  return rows.length;
}

describe("sessions cleanup job — purge expired/revoked rows", () => {
  test("deletes expired-past-cutoff rows but keeps live ones", async () => {
    await seedSession({
      id: "11111111-1111-1111-1111-111111111111",
      userId: "aa000000-0000-0000-0000-000000000001",
      kind: "expired",
      ageDays: 45,
    });
    await seedSession({
      id: "22222222-2222-2222-2222-222222222222",
      userId: "aa000000-0000-0000-0000-000000000002",
      kind: "live",
      ageDays: 1,
    });
    expect(await countSessions()).toBe(2);

    await cleanupJob({}, jobCtx());

    expect(await countSessions()).toBe(1);
    const [remaining] = await stack.db.select().from(userSessionTable);
    expect(remaining?.["revokedAt"]).toBeNull();
  });

  test("deletes long-revoked rows", async () => {
    await seedSession({
      id: "33333333-3333-3333-3333-333333333333",
      userId: "bb000000-0000-0000-0000-000000000001",
      kind: "revoked",
      ageDays: 60,
    });
    expect(await countSessions()).toBe(1);

    await cleanupJob({}, jobCtx());

    expect(await countSessions()).toBe(0);
  });

  test("recently-revoked rows stay around (inside retention window)", async () => {
    await seedSession({
      id: "44444444-4444-4444-4444-444444444444",
      userId: "cc000000-0000-0000-0000-000000000001",
      kind: "revoked",
      ageDays: 10,
    });

    // Default 30d window: 10d-old revoked row stays
    await cleanupJob({}, jobCtx());

    expect(await countSessions()).toBe(1);
  });

  test("olderThanDays override respects custom windows", async () => {
    await seedSession({
      id: "55555555-5555-5555-5555-555555555555",
      userId: "dd000000-0000-0000-0000-000000000001",
      kind: "revoked",
      ageDays: 5,
    });

    // Tight 3d window: the 5d row goes
    await cleanupJob({ olderThanDays: 3 }, jobCtx());

    expect(await countSessions()).toBe(0);
  });

  test("batching drains a large backlog across chunks", async () => {
    for (let i = 0; i < 7; i++) {
      await seedSession({
        id: `99999999-9999-9999-9999-${String(i).padStart(12, "0")}`,
        userId: "ee000000-0000-0000-0000-000000000001",
        kind: "expired",
        ageDays: 60,
      });
    }
    expect(await countSessions()).toBe(7);

    await cleanupJob({ olderThanDays: 30, batchSize: 2 }, jobCtx());

    expect(await countSessions()).toBe(0);
  });
});
