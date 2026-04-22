import {
  buildDrizzleTable,
  createEventStoreExecutor,
  entityEventName,
  integer,
  table as pgTable,
  uuid,
} from "@kumiko/framework/db";
import {
  createBooleanField,
  createEntity,
  createTextField,
  defineFeature,
  type FeatureDefinition,
  SYSTEM_TENANT_ID,
} from "@kumiko/framework/engine";
import {
  createEntityTable,
  createLateBoundHolder,
  createTestUser,
  pushTables,
  setupTestStack,
  type TestStack,
} from "@kumiko/framework/testing";
import { sql } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { createFeatureTogglesFeature } from "../feature-toggles-feature";
import { globalFeatureStateTable } from "../global-feature-state-table";
import { GlobalFeatureToggleRuntime } from "../toggle-runtime";

// Widget — the "tenant" under test. toggleable(default=true), owns a
// simple entity and a create-handler that writes via the event-store
// executor, so the full lifecycle pipeline (postSave hooks + event-log
// append that the tracker-MSP consumes) actually fires downstream.
const widgetEntity = createEntity({
  table: "widgets",
  fields: {
    name: createTextField({ required: true, maxLength: 100 }),
    active: createBooleanField({ default: true }),
  },
});
const widgetTable = buildDrizzleTable("widget", widgetEntity);

const widgetCrud = createEventStoreExecutor(widgetTable, widgetEntity, {
  entityName: "widget",
});

function widgetFeature(): FeatureDefinition {
  return defineFeature("widget", (r) => {
    r.systemScope();
    r.toggleable({ default: true });
    r.entity("widget", widgetEntity);

    // Use the event-store executor so the framework's lifecycle pipeline
    // (postSave hooks, incl. cross-feature ones) actually fires after the
    // write. Direct-DB writes bypass the pipeline — we'd never be able to
    // prove the hook-filter then.
    r.writeHandler(
      "widget:create",
      z.object({ name: z.string().min(1).max(100), active: z.boolean().optional() }),
      async (event, ctx) => widgetCrud.create(event.payload, event.user, ctx.db),
      { access: { roles: ["SystemAdmin"] } },
    );
  });
}

// Widget-Audit — registers a cross-feature entityHook on widget's postSave.
// When widget-audit is disabled, that hook MUST NOT fire, but widget's own
// create-handler MUST keep working. That's the "B hooks on A" test the
// user explicitly asked for.
const widgetAuditEntity = createEntity({
  table: "widget_audits",
  fields: {
    widgetName: createTextField({ required: true, maxLength: 100 }),
  },
});
const widgetAuditTable = buildDrizzleTable("widget-audit", widgetAuditEntity);

function widgetAuditFeature(): FeatureDefinition {
  return defineFeature("widget-audit", (r) => {
    r.systemScope();
    r.toggleable({ default: true });
    r.entity("widget-audit", widgetAuditEntity);

    r.entityHook("postSave", "widget", async (result, ctx) => {
      if (result.kind !== "save" || !result.isNew) return;
      if (!ctx.db) return;
      const name = (result.changes as Record<string, unknown>)["name"] as string | undefined;
      if (!name) return;
      await ctx.db.insert(widgetAuditTable).values({
        id: crypto.randomUUID(),
        widgetName: name,
        version: 1,
        tenantId: SYSTEM_TENANT_ID,
        createdAt: Temporal.Now.instant(),
        modifiedAt: Temporal.Now.instant(),
      });
    });
  });
}

// Widget-Tracker — owns a multi-stream projection that reacts to
// widget.created events and upserts a per-tenant counter. Drives the
// MSP-filter tests below: disable widget-tracker and the consumer
// must pause (cursor unchanged); re-enable and it catches up on the
// queued events without replaying them through a disabled pipeline.
const widgetTrackerTable = pgTable("widget_tracker", {
  tenantId: uuid("tenant_id").primaryKey(),
  count: integer("count").notNull().default(0),
});

function widgetTrackerFeature(): FeatureDefinition {
  return defineFeature("widget-tracker", (r) => {
    r.systemScope();
    r.toggleable({ default: true });
    // Declared dependency on widget: when widget is globally off, the
    // resolver's cascade drops widget-tracker as well (no matter its own
    // override). That's the shape the cascade test below asserts on.
    r.requires("widget");

    r.multiStreamProjection({
      name: "tracker",
      table: widgetTrackerTable,
      apply: {
        [entityEventName("widget", "created")]: async (event, tx) => {
          await tx
            .insert(widgetTrackerTable)
            .values({ tenantId: event.tenantId, count: 1 })
            .onConflictDoUpdate({
              target: widgetTrackerTable.tenantId,
              set: { count: sql`${widgetTrackerTable.count} + 1` },
            });
        },
      },
    });
  });
}

let stack: TestStack;
let runtime: GlobalFeatureToggleRuntime;

beforeAll(async () => {
  // Bootstrapping dance: setupTestStack wires the dispatcher's
  // effectiveFeatures callback AND the feature-toggles feature's
  // set-handler both need the runtime, but the runtime needs the
  // registry that setupTestStack builds. Two late-bound holders
  // break the cycle: one for the callback (held by the dispatcher),
  // one for the runtime accessor (held by the set-handler closure).
  let effective: () => ReadonlySet<string> = () => new Set();
  const runtimeHolder = createLateBoundHolder<GlobalFeatureToggleRuntime>("runtime");

  stack = await setupTestStack({
    features: [
      widgetFeature(),
      widgetAuditFeature(),
      widgetTrackerFeature(),
      createFeatureTogglesFeature({ getRuntime: () => runtimeHolder.get() }),
    ],
    effectiveFeatures: () => effective(),
    systemHooks: [],
  });

  await pushTables(stack.db.db, { globalFeatureStateTable });
  // widgetTrackerTable is auto-pushed by setupTestStack because it's the
  // projection-table of a registered r.multiStreamProjection — manually
  // pushing again would re-run the CREATE TABLE and fail duplicate.
  await createEntityTable(stack.db.db, widgetEntity);
  await createEntityTable(stack.db.db, widgetAuditEntity, "widget-audit");

  runtime = new GlobalFeatureToggleRuntime(stack.db.db, stack.registry);
  await runtime.initialize();
  effective = runtime.effectiveFeatures;
  runtimeHolder.set(runtime);
});

afterAll(async () => {
  await stack?.cleanup();
});

beforeEach(async () => {
  await stack.db.db.delete(widgetAuditTable);
  await stack.db.db.delete(widgetTable);
  await stack.db.db.delete(widgetTrackerTable);
  await stack.db.db.delete(globalFeatureStateTable);
  // Wipe the event log + reset every consumer cursor so each test starts
  // from event-id 0. Tests that drain via eventDispatcher.runOnce() need
  // this or they drain a shared backlog and see false-positive counters.
  await stack.db.db.execute(sql`DELETE FROM events`);
  await stack.db.db.execute(sql`UPDATE kumiko_event_consumers SET last_processed_event_id = 0`);
  await runtime.refresh();
});

const admin = createTestUser({
  id: "11111111-1111-1111-1111-111111111111",
  tenantId: SYSTEM_TENANT_ID,
  roles: ["SystemAdmin"],
});

async function createWidget(name: string) {
  const res = await stack.http.write("widget:write:widget:create", { name }, admin);
  const body = (await res.json()) as {
    isSuccess: boolean;
    error?: { code: string; details?: Record<string, unknown> };
    data?: Record<string, unknown>;
  };
  return { status: res.status, body };
}

async function countWidgets(): Promise<number> {
  const rows = await stack.db.db.select().from(widgetTable);
  return rows.length;
}

async function countAuditRows(): Promise<number> {
  const rows = await stack.db.db.select().from(widgetAuditTable);
  return rows.length;
}

async function trackerCount(): Promise<number> {
  const rows = await stack.db.db.select().from(widgetTrackerTable);
  return rows[0]?.count ?? 0;
}

// Raw SQL because kumiko_event_consumers isn't exported as a drizzle table
// from @kumiko/framework/db. Single cast at the system boundary with
// explicit shape — typed access everywhere else.
type ConsumerCursorRow = { last_processed_event_id: number | string };
async function trackerCursor(): Promise<number> {
  const rows = (await stack.db.db.execute(
    sql`SELECT last_processed_event_id FROM kumiko_event_consumers WHERE name LIKE '%tracker%' LIMIT 1`,
  )) as unknown as readonly ConsumerCursorRow[];
  return Number(rows[0]?.last_processed_event_id ?? 0);
}

async function setTrackerCursor(value: number): Promise<void> {
  await stack.db.db.execute(
    sql`UPDATE kumiko_event_consumers SET last_processed_event_id = ${value} WHERE name LIKE '%tracker%'`,
  );
}

describe("feature-toggles runtime cache", () => {
  test("apply() flips the in-memory snapshot instantly", () => {
    runtime.apply("widget", false);
    expect(runtime.effectiveFeatures().has("widget")).toBe(false);
    runtime.apply("widget", true);
    expect(runtime.effectiveFeatures().has("widget")).toBe(true);
  });

  test("refresh() re-reads the DB snapshot", async () => {
    await stack.db.db.insert(globalFeatureStateTable).values({
      featureName: "widget",
      enabled: false,
      version: 1,
      updatedBy: "test",
    });
    await runtime.refresh();
    expect(runtime.effectiveFeatures().has("widget")).toBe(false);
  });

  test("cascade: widget-tracker requires widget → disabling widget drops widget-tracker too", () => {
    // widget-tracker has r.requires("widget") declared. Disabling widget
    // should cascade through the resolver so widget-tracker is effectively
    // off even though nobody touched its own override row.
    runtime.apply("widget", false);
    expect(runtime.effectiveFeatures().has("widget")).toBe(false);
    expect(runtime.effectiveFeatures().has("widget-tracker")).toBe(false);

    // widget back on → tracker back on (override row never existed, so
    // the cascade flips back automatically).
    runtime.apply("widget", true);
    expect(runtime.effectiveFeatures().has("widget")).toBe(true);
    expect(runtime.effectiveFeatures().has("widget-tracker")).toBe(true);
  });
});

describe("runtime on/off/on — the user's scenario", () => {
  test("full cycle: ON → create works + hook fires, OFF → 403 + no-op, ON → works again", async () => {
    // PHASE 1: both features on (the default).
    const first = await createWidget("alpha");
    expect(first.body.isSuccess).toBe(true);
    expect(await countWidgets()).toBe(1);
    expect(await countAuditRows()).toBe(1); // widget-audit hook fired

    // PHASE 2: disable widget at runtime.
    runtime.apply("widget", false);

    const denied = await createWidget("beta");
    expect(denied.body.isSuccess).toBe(false);
    expect(denied.body.error?.code).toBe("feature_disabled");
    expect(denied.body.error?.details).toMatchObject({
      reason: "feature_disabled",
      feature: "widget",
    });
    // DB unchanged — neither widget nor audit got a new row.
    expect(await countWidgets()).toBe(1);
    expect(await countAuditRows()).toBe(1);

    // PHASE 3: re-enable widget. Handler works again, hook fires again.
    runtime.apply("widget", true);

    const again = await createWidget("gamma");
    expect(again.body.isSuccess).toBe(true);
    expect(await countWidgets()).toBe(2);
    expect(await countAuditRows()).toBe(2);
  });

  test("HTTP set-handler persists + updates snapshot + emits toggle-set event", async () => {
    // End-to-end through the dispatcher: API call → DB row → in-memory
    // snapshot flip → next widget:create gated accordingly.
    const toggleRes = await stack.http.write(
      "feature-toggles:write:set",
      { featureName: "widget", enabled: false },
      admin,
    );
    const body = (await toggleRes.json()) as {
      isSuccess: boolean;
      error?: { code: string; message?: string; details?: Record<string, unknown> };
      data?: { featureName: string; enabled: boolean; previousEnabled: boolean | null };
    };
    if (!body.isSuccess) {
      throw new Error(`set-handler failed: ${JSON.stringify(body.error)}`);
    }
    expect(body.isSuccess).toBe(true);
    expect(body.data?.enabled).toBe(false);
    expect(body.data?.previousEnabled).toBeNull();

    // Row persisted.
    const rows = await stack.db.db.select().from(globalFeatureStateTable);
    expect(rows).toHaveLength(1);

    // Snapshot updated — widget:create now 403s.
    const denied = await createWidget("iota");
    expect(denied.body.isSuccess).toBe(false);
    expect(denied.body.error?.code).toBe("feature_disabled");

    // Flip back on via the handler.
    await stack.http.write(
      "feature-toggles:write:set",
      { featureName: "widget", enabled: true },
      admin,
    );
    const ok = await createWidget("kappa");
    expect(ok.body.isSuccess).toBe(true);
  });

  test("set-handler rejects non-toggleable features", async () => {
    const res = await stack.http.write(
      "feature-toggles:write:set",
      { featureName: "feature-toggles", enabled: false },
      admin,
    );
    const body = (await res.json()) as {
      isSuccess: boolean;
      error?: { code: string; details?: Record<string, unknown> };
    };
    expect(body.isSuccess).toBe(false);
    expect(body.error?.details).toMatchObject({ reason: "feature_not_toggleable" });
  });

  test("set-handler rejects unknown features", async () => {
    const res = await stack.http.write(
      "feature-toggles:write:set",
      { featureName: "does-not-exist", enabled: true },
      admin,
    );
    const body = (await res.json()) as {
      isSuccess: boolean;
      error?: { details?: Record<string, unknown> };
    };
    expect(body.isSuccess).toBe(false);
    expect(body.error?.details).toMatchObject({ reason: "unknown_feature" });
  });

  test("cross-feature hook: disabling widget-audit skips the hook but widget keeps working", async () => {
    // Baseline — both features on.
    await createWidget("delta");
    expect(await countWidgets()).toBe(1);
    expect(await countAuditRows()).toBe(1);

    // Disable widget-audit (the hook-owner). Widget is still on, so
    // widget:create must continue succeeding — but the audit-hook owned
    // by widget-audit must be skipped.
    runtime.apply("widget-audit", false);

    const res = await createWidget("epsilon");
    expect(res.body.isSuccess).toBe(true);
    expect(await countWidgets()).toBe(2); // widget wrote a row
    expect(await countAuditRows()).toBe(1); // audit-hook did NOT fire

    // Re-enable widget-audit. Hook resumes firing.
    runtime.apply("widget-audit", true);

    await createWidget("zeta");
    expect(await countWidgets()).toBe(3);
    expect(await countAuditRows()).toBe(2);
  });
});

// --- MSP-filter: disabled features pause their consumers ---

describe("MSP consumer pauses for disabled features", () => {
  test("on → event advances cursor and increments counter", async () => {
    await createWidget("msp-alpha");
    await stack.eventDispatcher?.runOnce();

    expect(await trackerCount()).toBe(1);
  });

  test("off → new event does NOT advance cursor, no projection write", async () => {
    // baseline: run one event through to set the cursor.
    await createWidget("msp-beta");
    await stack.eventDispatcher?.runOnce();
    const cursorBefore = await trackerCursor();
    expect(await trackerCount()).toBe(1);

    // Disable the MSP's owning feature. Next event generates but the
    // consumer pauses — cursor frozen, projection unchanged.
    runtime.apply("widget-tracker", false);
    await createWidget("msp-gamma");
    await stack.eventDispatcher?.runOnce();

    expect(await trackerCount()).toBe(1); // no increment
    expect(await trackerCursor()).toBe(cursorBefore); // cursor frozen
  });

  test("on → off → on: events accumulate, resume replays from same cursor", async () => {
    await createWidget("msp-delta");
    await stack.eventDispatcher?.runOnce();
    expect(await trackerCount()).toBe(1);

    // Off. Widgets keep being created (widget feature is still on);
    // their events land in the store but the tracker consumer sits idle.
    runtime.apply("widget-tracker", false);
    await createWidget("msp-epsilon");
    await createWidget("msp-zeta");
    await stack.eventDispatcher?.runOnce();
    expect(await trackerCount()).toBe(1); // still 1 — paused

    // On again. The dispatcher picks up the queued events from the
    // frozen cursor — no data loss, no replay of already-processed ones.
    runtime.apply("widget-tracker", true);
    await stack.eventDispatcher?.runOnce();
    expect(await trackerCount()).toBe(3); // caught up (1 + 2)
  });

  test("cascade via HTTP: disabling widget freezes widget-tracker cursor too", async () => {
    // End-to-end cascade proof. Both downstream surfaces must respect the
    // cascade when *only* widget's override row is flipped:
    //   1. widget handler-gate blocks creates (covered by inline assert)
    //   2. widget-tracker MSP consumer pauses — cursor frozen, no projection
    //      write, even with a pending widget.created event in the log
    //
    // How the MSP-side is proven: process one widget event normally, then
    // rewind the tracker-consumer's cursor by one so the same event sits
    // pending again. Flip widget off via HTTP (which cascades tracker off
    // via r.requires), drain the dispatcher, and assert the cursor stayed
    // frozen. Re-enable widget and the cursor advances past the rewind.
    await createWidget("cascade-alpha");
    await stack.eventDispatcher?.runOnce();
    const cursorAfterFirstRun = await trackerCursor();
    expect(await trackerCount()).toBe(1);
    // cursor is some positive value — absolute id depends on the global
    // events-sequence (bigserial; DELETE doesn't rewind it). All further
    // assertions use this as the anchor so they stay deterministic.
    expect(cursorAfterFirstRun).toBeGreaterThan(0);

    // Rewind one event. The widget.created event is now "pending" from the
    // consumer's POV — a clean setup for the cascade-pause assertion.
    await setTrackerCursor(cursorAfterFirstRun - 1);

    // Persist "widget off" via the real set-handler (not apply() — this
    // proves the through-the-DB path works, including the cascade-refresh
    // that the set-handler triggers). This also emits event 2 (toggle-set).
    await stack.http.write(
      "feature-toggles:write:set",
      { featureName: "widget", enabled: false },
      admin,
    );

    // widget's create-handler: gate blocks.
    const denied = await createWidget("cascade-beta");
    expect(denied.body.error?.code).toBe("feature_disabled");

    // MSP-side cascade: run the dispatcher. widget-tracker is cascade-off
    // so its consumer must NOT advance the cursor even though a pending
    // event is sitting right there waiting to be drained.
    await stack.eventDispatcher?.runOnce();
    expect(await trackerCursor()).toBe(cursorAfterFirstRun - 1);

    // Re-enable widget via HTTP — emits event 3 (toggle-set). Cascade flips
    // tracker back on; consumer drains events 1..3. Only event 1 matches
    // the tracker's apply map, so count increments from 1 → 2 (replay of
    // the rewound event), and the cursor lands at 3.
    await stack.http.write(
      "feature-toggles:write:set",
      { featureName: "widget", enabled: true },
      admin,
    );
    await stack.eventDispatcher?.runOnce();
    expect(await trackerCursor()).toBe(cursorAfterFirstRun + 2);
    expect(await trackerCount()).toBe(2);
  });
});

// --- Event-audit automation + read-side queries ---

describe("feature-toggles queries + audit automation", () => {
  test("set-handler appends toggle-set event to the event store", async () => {
    await stack.http.write(
      "feature-toggles:write:set",
      { featureName: "widget", enabled: false },
      admin,
    );

    const events = (await stack.db.db.execute(
      sql`SELECT type, payload FROM events WHERE type = 'feature-toggles:event:toggle-set'`,
    )) as unknown as readonly {
      type: string;
      payload: Record<string, unknown>;
    }[];

    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      featureName: "widget",
      enabled: false,
      previousEnabled: null,
    });
  });

  test("list query returns only features with explicit override rows", async () => {
    await stack.http.write(
      "feature-toggles:write:set",
      { featureName: "widget", enabled: false },
      admin,
    );

    const data = await stack.http.queryOk<{
      items: Array<{ featureName: string; enabled: boolean; version: number }>;
    }>("feature-toggles:query:list", {}, admin);
    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toMatchObject({
      featureName: "widget",
      enabled: false,
      version: 1,
    });
  });

  test("registered query reports metadata + override + effective for every feature", async () => {
    runtime.apply("widget", false);
    const data = await stack.http.queryOk<{
      items: Array<{
        name: string;
        toggleable: boolean;
        default: boolean | null;
        override: boolean | null;
        requires: readonly string[];
        effective: boolean | null;
      }>;
    }>("feature-toggles:query:registered", {}, admin);
    const byName = new Map(data.items.map((i) => [i.name, i]));

    expect(byName.get("widget")).toMatchObject({
      toggleable: true,
      default: true,
      effective: false,
    });

    expect(byName.get("feature-toggles")).toMatchObject({
      toggleable: false,
      default: null,
      effective: true,
    });
  });
});
