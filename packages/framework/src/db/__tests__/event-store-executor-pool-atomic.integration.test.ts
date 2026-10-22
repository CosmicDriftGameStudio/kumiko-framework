// An executor write on a pool-bound TenantDb opens its own transaction: append, entity row and
// custom projection commit or roll back together, and concurrent writers never tear a stream.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createBarrier } from "@cosmicdrift/kumiko-testing/helpers";
import {
  resetEventStore,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import type { WriteResult } from "@cosmicdrift/kumiko-types/handlers";
import type { EntityId } from "@cosmicdrift/kumiko-types/identifiers";
import * as z from "zod";
import { createEntity, createTextField, defineFeature } from "../../engine/index.ts";
import { getStreamVersion } from "../../event-store/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import { table as pgTable, text as pgText, uuid as pgUuid } from "../dialect.ts";
import { createEventStoreExecutor } from "../event-store-executor.ts";
import { selectEventsHeadId } from "../queries/event-store.ts";
import { insertOne, selectMany } from "../query.ts";
import { buildEntityTable } from "../table-builder.ts";
import { createProjectingTenantDb } from "../tenant-db.ts";

const ledgerEntity = createEntity({
  table: "read_poolatomic_ledgers",
  fields: { title: createTextField({ personal: false, reason: "test_fixture", required: true }) },
});
const ledgerTable = buildEntityTable("ledger", ledgerEntity);
const ledgerExecutor = createEventStoreExecutor(ledgerTable, ledgerEntity, {
  entityName: "ledger",
});

const ledgerLogTable = pgTable("read_poolatomic_ledger_log", {
  ledgerId: pgUuid("ledger_id").primaryKey(),
  tenantId: pgUuid("tenant_id").notNull(),
  title: pgText("title").notNull(),
});

const EXPLODING_TITLE = "projection-explodes";

const ledgerEventPayloadSchema = z.object({
  title: z.string().optional(),
  changes: z.object({ title: z.string().optional() }).optional(),
});

async function projectLedgerEvent(
  event: { readonly aggregateId: string; readonly tenantId: string; readonly payload: unknown },
  tx: Parameters<typeof insertOne>[0],
): Promise<void> {
  const payload = ledgerEventPayloadSchema.parse(event.payload);
  const title = payload.title ?? payload.changes?.title ?? "";
  if (title === EXPLODING_TITLE) throw new Error("projection failed on purpose");
  await insertOne(tx, ledgerLogTable, {
    ledgerId: crypto.randomUUID(),
    tenantId: event.tenantId,
    title,
  });
}

const poolAtomicFeature = defineFeature("poolatomic", (r) => {
  r.entity({ name: "ledger", ...ledgerEntity });
  r.projection({
    name: "ledger-log",
    source: "ledger",
    table: ledgerLogTable,
    apply: {
      "ledger.created": projectLedgerEvent,
      "ledger.updated": projectLedgerEvent,
    },
  });
});

const admin = TestUsers.admin;
let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [poolAtomicFeature], dbPoolMax: 10 });
  await unsafeCreateEntityTable(stack.db, ledgerEntity, "ledger");
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(async () => {
  await resetEventStore(stack, ["read_poolatomic_ledgers", "read_poolatomic_ledger_log"]);
});

function poolDb() {
  return createProjectingTenantDb(stack.db, admin.tenantId, stack.registry);
}

async function createLedger(title: string): Promise<EntityId> {
  const result = await ledgerExecutor.create({ title }, admin, poolDb());
  if (!result.isSuccess) throw new Error(`seed create failed: ${result.error.code}`);
  return result.data.id;
}

describe("executor writes on a pool runner are atomic", () => {
  test("a throwing projection on create leaves no event and no row", async () => {
    const headBefore = await selectEventsHeadId(stack.db);

    await expect(
      ledgerExecutor.create({ title: EXPLODING_TITLE }, admin, poolDb()),
    ).rejects.toThrow("projection failed on purpose");

    expect(await selectEventsHeadId(stack.db)).toBe(headBefore);
    expect(await selectMany(stack.db, ledgerTable)).toHaveLength(0);
    expect(await selectMany(stack.db, ledgerLogTable)).toHaveLength(0);
  });

  test("a throwing projection on update leaves stream version and row unchanged", async () => {
    const id = await createLedger("before");

    await expect(
      ledgerExecutor.update(
        { id, version: 1, changes: { title: EXPLODING_TITLE } },
        admin,
        poolDb(),
      ),
    ).rejects.toThrow("projection failed on purpose");

    expect(await getStreamVersion(stack.db, String(id), admin.tenantId)).toBe(1);
    const rows = await selectMany(stack.db, ledgerTable);
    expect(rows.map((row) => row["title"])).toEqual(["before"]);
  });

  test("concurrent updates on the same version: one wins, the rest get version_conflict, no torn write", async () => {
    const id = await createLedger("start");
    const writers = 4;
    const barrier = createBarrier({ expected: writers });

    const results: readonly WriteResult[] = await Promise.all(
      Array.from({ length: writers }, (_, index) =>
        ledgerExecutor.update(
          { id, version: 1, changes: { title: `writer-${index}` } },
          admin,
          poolDb(),
          {
            preSave: async (changes) => {
              await barrier.arrive();
              return changes;
            },
          },
        ),
      ),
    );

    const successes = results.filter((result) => result.isSuccess);
    const failureCodes = results.flatMap((result) => (result.isSuccess ? [] : [result.error.code]));
    expect(successes).toHaveLength(1);
    expect(failureCodes).toEqual(Array.from({ length: writers - 1 }, () => "version_conflict"));

    const rows = await selectMany(stack.db, ledgerTable);
    expect(rows).toHaveLength(1);
    expect(await getStreamVersion(stack.db, String(id), admin.tenantId)).toBe(rows[0]?.["version"]);
  });
});
