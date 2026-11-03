// A perCommand write handler is the home of long external calls that still need to book
// metering/provenance (what ai-foundation does through ctx.db.outsideTransaction): it holds no
// transaction while the call runs, and outsideTransaction writes still work.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { asRawClient, type DbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  defineFeature,
  type HandlerContext,
  type WriteHandlerDef,
} from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { bookCapUsage } from "../book-cap-usage.ts";
import { capCounterEntity } from "../entity.ts";
import { createCapCounterFeature } from "../feature.ts";
import { fetchCounterRow } from "./read-counter.ts";

const CAP_NAME = "per-command-metering-cap";
const PERIOD = "2026-08-01T00:00:00Z";

let stack: TestStack;
let db: DbConnection;
const openTransactionsDuringExternalCall: number[] = [];

// Stands in for a minutes-long provider call: the point is what the handler holds while it runs.
async function countIdleInTransactionBackends(): Promise<number> {
  const rows = await asRawClient(db).unsafe<{ count: number }>(
    `SELECT count(*)::int AS count FROM pg_stat_activity
     WHERE datname = current_database() AND state = 'idle in transaction' AND pid <> pg_backend_pid()`,
  );
  return rows[0]?.count ?? 0;
}

async function externalCallThenBook(ctx: HandlerContext) {
  openTransactionsDuringExternalCall.push(await countIdleInTransactionBackends());
  return bookCapUsage(ctx, {
    capName: CAP_NAME,
    periodStartIso: PERIOD,
    outsideTransaction: ctx.db.outsideTransaction !== undefined,
  });
}

const perCommandHandler: WriteHandlerDef = {
  name: "external-call-per-command",
  schema: z.object({}),
  access: { roles: ["TenantAdmin"] },
  transaction: "perCommand",
  handler: (_event, ctx) => externalCallThenBook(ctx),
};

const inTransactionHandler: WriteHandlerDef = {
  name: "external-call-in-transaction",
  schema: z.object({}),
  access: { roles: ["TenantAdmin"] },
  handler: (_event, ctx) => externalCallThenBook(ctx),
};

const probeFeature = defineFeature("percommandprobe", (r) => {
  r.writeHandler(perCommandHandler);
  r.writeHandler(inTransactionHandler);
});

beforeAll(async () => {
  stack = await setupTestStack({ features: [createCapCounterFeature(), probeFeature] });
  db = stack.db;
  await unsafeCreateEntityTable(db, capCounterEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

function adminFor(tenantNumber: number) {
  return createTestUser({
    id: tenantNumber,
    tenantId: testTenantId(tenantNumber),
    roles: ["TenantAdmin"],
  });
}

describe("perCommand handler with outsideTransaction writes", () => {
  test("holds no open transaction during the external call and still books outside it", async () => {
    openTransactionsDuringExternalCall.length = 0;
    const user = adminFor(7101);

    await stack.http.writeOk("percommandprobe:write:external-call-per-command", {}, user);

    expect(openTransactionsDuringExternalCall).toEqual([0]);
    const row = await fetchCounterRow(stack, user, CAP_NAME, PERIOD);
    expect(row?.["value"]).toBe(1);
  });

  test("control: a regular handler holds its transaction during the same call", async () => {
    openTransactionsDuringExternalCall.length = 0;
    const user = adminFor(7102);

    await stack.http.writeOk("percommandprobe:write:external-call-in-transaction", {}, user);

    expect(openTransactionsDuringExternalCall[0]).toBeGreaterThanOrEqual(1);
  });
});
