import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { buildEntityTable, selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createTextField,
  defineEntityCreateHandler,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { ConsumerLagError } from "@cosmicdrift/kumiko-framework/pipeline";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { createDataRetentionFeature } from "../feature.ts";
import { runStreamRetention } from "../run-stream-retention.ts";

const CREATE_PREVIEW = "sr-fixtures:write:sr-preview:create";
const CREATE_KEPT = "sr-fixtures:write:sr-kept:create";
const THIRTY_ONE_DAYS_HOURS = 31 * 24;

const previewEntity = createEntity({
  name: "sr-preview",
  table: "read_sr_preview",
  fields: {
    title: createTextField({ personal: false, reason: "is_business_data", required: true }),
  },
  streamRetention: { keepFor: "30d" },
});
const keptEntity = createEntity({
  name: "sr-kept",
  table: "read_sr_kept",
  fields: {
    title: createTextField({ personal: false, reason: "is_business_data", required: true }),
  },
});

const srFeature = defineFeature("sr-fixtures", (r) => {
  r.entity(previewEntity);
  r.entity(keptEntity);
  r.writeHandler(
    defineEntityCreateHandler("sr-preview", previewEntity, { access: { roles: ["Admin"] } }),
  );
  r.writeHandler(defineEntityCreateHandler("sr-kept", keptEntity, { access: { roles: ["Admin"] } }));
});

const previewTable = buildEntityTable(previewEntity);
const keptTable = buildEntityTable(keptEntity);
const admin = TestUsers.admin;

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [createDataRetentionFeature(), srFeature] });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [eventsTable, previewTable, keptTable]);
});

async function counts(
  aggregateType: string,
  table: typeof previewTable,
): Promise<{ events: number; rows: number }> {
  const events = await selectMany(stack.db, eventsTable, { aggregateType });
  const rows = await selectMany(stack.db, table, {});
  return { events: events.length, rows: rows.length };
}

async function createBoth(): Promise<void> {
  await stack.http.writeOk(CREATE_PREVIEW, { title: "draft" }, admin);
  await stack.http.writeOk(CREATE_KEPT, { title: "kept" }, admin);
}

function afterKeepFor() {
  return getTemporal().Now.instant().add({ hours: THIRTY_ONE_DAYS_HOURS });
}

describe("runStreamRetention", () => {
  test("keeps streams younger than keepFor", async () => {
    await createBoth();
    await stack.eventDispatcher?.runOnce();

    const result = await runStreamRetention({
      db: stack.db,
      registry: stack.registry,
      now: getTemporal().Now.instant(),
    });

    expect(result).toEqual({ deletedEvents: 0, deletedRows: 0 });
    expect(await counts("sr-preview", previewTable)).toEqual({ events: 1, rows: 1 });
  });

  test("prunes the stream and the row of an entity with streamRetention once keepFor has passed, and leaves other entities alone", async () => {
    await createBoth();
    await stack.eventDispatcher?.runOnce();

    const result = await runStreamRetention({
      db: stack.db,
      registry: stack.registry,
      now: afterKeepFor(),
    });

    expect(result.deletedRows).toBe(1);
    expect(await counts("sr-preview", previewTable)).toEqual({ events: 0, rows: 0 });
    expect(await counts("sr-kept", keptTable)).toEqual({ events: 1, rows: 1 });
  });

  test("refuses to prune while an event consumer lags and deletes nothing", async () => {
    await stack.http.writeOk(CREATE_PREVIEW, { title: "draft" }, admin);

    await expect(
      runStreamRetention({ db: stack.db, registry: stack.registry, now: afterKeepFor() }),
    ).rejects.toThrow(ConsumerLagError);

    expect(await counts("sr-preview", previewTable)).toEqual({ events: 1, rows: 1 });
  });
});
