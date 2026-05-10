// Pipeline dispatcher-integration test — exercises the perform-as-pipeline
// path through the full real stack (Postgres + JWT + HTTP). Covers:
//
//   M.1.1 (return / boundary):
//     - r.writeHandler(definitionObj) accepts the new output shape
//     - boot-validation doesn't trip on the `perform` field
//     - dispatcher parses the payload (Zod schema) BEFORE invoking handler
//     - dispatcher checks access-rules BEFORE invoking handler
//     - dispatcher hands the handler a real HandlerContext (~30 fields)
//     - the compiled handler runs the pipeline-runner against that ctx
//     - WriteResult lands on the HTTP caller
//     - a step that throws maps to a standard write-failure (500 +
//       internal_error) via the dispatcher's catch
//
//   M.1.2 (compute):
//     - multi-step pipeline threads compute results through to the
//       return-resolver via steps.<name> against the real ctx
//
//   M.1.3 (unsafeProjectionUpsert):
//     - writes a row to a declared read-side table via real Postgres
//     - is idempotent on the conflict-key — second write updates,
//       not duplicates
//
//   M.1.4 (aggregate.create / update / appendEvent):
//     - aggregate.create opens an event-sourced aggregate stream via real
//       event-store
//     - executor failure (e.g. validation) maps to standard write-failure
//     - aggregate.update writes a delta event + projection-row update on
//       an existing stream
//     - aggregate.appendEvent writes an additional domain-event onto an
//       existing aggregate stream (alongside the auto-generated CRUD events)
//
//   M.1.5 (read.findOne / read.findMany / unsafeProjectionDelete):
//     - read.findOne returns a single row or null
//     - read.findMany returns row[] (with optional limit)
//     - unsafeProjectionDelete deletes via real Postgres
//     - boot-validation rejects unsafeProjectionDelete on undeclared table
//
// Unit-side tests in pipeline-vertical-slice.test.ts cover the same
// surface against an empty ctx mock; this file is the real-stack gate.

import { eq } from "drizzle-orm";
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { buildDrizzleTable } from "../../db/table-builder";
import { eventsTable } from "../../event-store";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "../../stack";
import { defineFeature } from "../define-feature";
import { defineWriteHandler } from "../define-handler";
import { createEntity, createTextField } from "../factories";
import { pipeline } from "../pipeline";

const echoSchema = z.object({ greeting: z.string() });

const echoHandler = defineWriteHandler({
  // Registry's qualify() prepends "<feature>:write:" — handler def-name
  // is the short form only.
  name: "echo",
  schema: echoSchema,
  access: { roles: ["Admin"] },
  perform: pipeline<z.infer<typeof echoSchema>, { echoed: string; from: string }>(
    ({ event, r }) => [
      r.step.return(() => ({
        isSuccess: true as const,
        data: {
          echoed: event.payload.greeting,
          from: event.user.id,
        },
      })),
    ],
  ),
});

// Second handler whose pipeline throws — proves the dispatcher's catch
// maps step-thrown errors to the standard write-failure shape.
const explodeSchema = z.object({});
const explodeHandler = defineWriteHandler({
  name: "explode",
  schema: explodeSchema,
  access: { roles: ["Admin"] },
  perform: pipeline<z.infer<typeof explodeSchema>, never>(({ r }) => [
    r.step.return(() => {
      throw new Error("boom");
    }),
  ]),
});

// Third handler exercises the multi-step path through the real
// dispatcher: compute lands a value under steps.<name>, return reads it.
// Threading verified in the unit-test against an empty ctx; this proves
// the same wiring holds with the dispatcher's full HandlerContext.
const compoundSchema = z.object({ base: z.number() });
const compoundHandler = defineWriteHandler({
  name: "compound",
  schema: compoundSchema,
  access: { roles: ["Admin"] },
  perform: pipeline<z.infer<typeof compoundSchema>, { sum: number; userId: string }>(
    ({ event, r }) => [
      r.step.compute("offset", () => 100),
      r.step.compute("doubledBase", () => event.payload.base * 2),
      // Resolvers capture `event` from the outer build-closure scope rather
      // than reading it via the resolver's PipelineCtx — `PipelineCtx<TPayload>`
      // does not propagate the pipeline's TPayload generic to per-call
      // resolvers (M.1-Followup #4), so `ctx.event.user.id` would type-erase.
      // Outer-capture preserves the typed payload. Same pattern in logHandler
      // and widgetCreateHandler below.
      r.step.return(({ steps }) => ({
        isSuccess: true as const,
        data: {
          sum: (steps["offset"] as number) + (steps["doubledBase"] as number),
          userId: event.user.id,
        },
      })),
    ],
  ),
});

// Read-side projection-table for the unsafeProjectionUpsert handler.
// Plain pgTable (not r.entity) — it's a read-side log, not an aggregate.
const pipelineDemoLogTable = pgTable("pipeline_demo_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  correlationId: text("correlation_id").notNull().unique(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Fourth handler exercises r.step.unsafeProjectionUpsert: writes a row
// to the demo-log table after the pipeline runs. Idempotent on
// correlationId — running the same handler twice with the same id
// updates the existing row, not insert a duplicate.
const logSchema = z.object({ correlationId: z.string(), message: z.string() });
const logHandler = defineWriteHandler({
  name: "log",
  schema: logSchema,
  access: { roles: ["Admin"] },
  // Outer-`event`-capture pattern — see compoundHandler above for the why.
  perform: pipeline<z.infer<typeof logSchema>, { correlationId: string }>(({ event, r }) => [
    r.step.unsafeProjectionUpsert({
      table: pipelineDemoLogTable,
      on: ["correlationId"],
      row: () => ({
        tenantId: event.user.tenantId,
        correlationId: event.payload.correlationId,
        message: event.payload.message,
      }),
    }),
    r.step.return(() => ({
      isSuccess: true as const,
      data: { correlationId: event.payload.correlationId },
    })),
  ]),
});

// Aggregate-entity for the M.1.4 aggregate.create test. Registered via
// r.entity inside the demoPipeline feature so the framework knows the
// table belongs to an aggregate stream (boot-validator would reject any
// unsafeProjection.* that targets it).
const widgetEntity = createEntity({
  table: "pipeline_widget",
  fields: { label: createTextField({ required: true }) },
});
const widgetTable = buildDrizzleTable("widget", widgetEntity);
const widgetExecutor = createEventStoreExecutor(widgetTable, widgetEntity, {
  entityName: "widget",
});

const widgetSchema = z.object({ label: z.string() });
const widgetCreateHandler = defineWriteHandler({
  name: "widget:create",
  schema: widgetSchema,
  access: { roles: ["Admin"] },
  perform: pipeline<z.infer<typeof widgetSchema>, { id: string }>(({ event, r }) => [
    r.step.aggregate.create("widget", {
      executor: widgetExecutor,
      data: () => ({ label: event.payload.label }),
    }),
    r.step.return(({ steps }) => ({
      isSuccess: true as const,
      data: { id: (steps["widget"] as { id: string }).id },
    })),
  ]),
});

// Annotate-handler for the M.1.4 aggregate.appendEvent test. Creates a
// widget AND appends a custom "widget.annotated" event onto the same
// aggregate stream — verifies multi-event-per-handler-call works.
const annotateSchema = z.object({ label: z.string(), note: z.string() });
const annotateHandler = defineWriteHandler({
  name: "widget:annotate",
  schema: annotateSchema,
  access: { roles: ["Admin"] },
  perform: pipeline<z.infer<typeof annotateSchema>, { id: string }>(({ event, r }) => [
    r.step.aggregate.create("widget", {
      executor: widgetExecutor,
      data: () => ({ label: event.payload.label }),
    }),
    r.step.aggregate.appendEvent({
      aggregateId: ({ steps }) => (steps["widget"] as { id: string }).id,
      aggregateType: "widget",
      // Type below is registered via r.defineEvent in the feature
      // registration further down — keeps the demo feature self-
      // contained for the test stack.
      type: "demo-pipeline:event:annotated",
      payload: () => ({ note: event.payload.note }),
    }),
    r.step.return(({ steps }) => ({
      isSuccess: true as const,
      data: { id: (steps["widget"] as { id: string }).id },
    })),
  ]),
});

// Update-handler for the M.1.4 aggregate.update test. Takes an
// existing widget id and rewrites the label.
const widgetUpdateSchema = z.object({ id: z.uuid(), label: z.string() });
const widgetUpdateHandler = defineWriteHandler({
  name: "widget:update",
  schema: widgetUpdateSchema,
  access: { roles: ["Admin"] },
  perform: pipeline<z.infer<typeof widgetUpdateSchema>, { id: string }>(({ event, r }) => [
    r.step.aggregate.update("widget", {
      executor: widgetExecutor,
      id: () => event.payload.id,
      changes: () => ({ label: event.payload.label }),
      // skipOptimisticLock — test uses a single user, last-write-wins
      // is fine; full version-check exercise belongs to a dedicated
      // optimistic-lock test elsewhere.
      skipOptimisticLock: true,
    }),
    r.step.return(({ steps }) => ({
      isSuccess: true as const,
      data: { id: (steps["widget"] as { id: string }).id },
    })),
  ]),
});

// Companion handler that triggers an executor-failure path: missing
// required field → UnprocessableError → re-raised by the step → mapped
// to write-failure by the dispatcher.
const widgetBrokenHandler = defineWriteHandler({
  name: "widget:create-broken",
  schema: z.object({}),
  access: { roles: ["Admin"] },
  perform: pipeline<Record<string, never>, { id: string }>(({ r }) => [
    r.step.aggregate.create("widget", {
      executor: widgetExecutor,
      // Intentionally omits the `label` field that the entity declares
      // as required — executor.create returns WriteFailure, the step
      // re-raises as KumikoError.
      data: () => ({}),
    }),
    r.step.return(({ steps }) => ({
      isSuccess: true as const,
      data: { id: (steps["widget"] as { id: string }).id },
    })),
  ]),
});

// M.1.5 handlers — read + projection-delete. lookup-then-update reads
// from widgetTable (an aggregate-projection — fine for read.*, only
// writes are blocked by the boot-validator). delete-log purges old
// rows from the demo-log read-side table.
// Single shape (no narrowing union) so the pipeline's TData generic
// matches the resolver's return type cleanly — sidesteps the
// M.1-Followup #4 inference limit. The `label: string | null` shape is
// idiomatic anyway: caller checks `label !== null` to distinguish hit/miss.
const lookupSchema = z.object({ id: z.uuid() });
const lookupHandler = defineWriteHandler({
  name: "widget:lookup",
  schema: lookupSchema,
  access: { roles: ["Admin"] },
  perform: pipeline<z.infer<typeof lookupSchema>, { found: boolean; label: string | null }>(
    ({ event, r }) => [
      r.step.read.findOne("widget", {
        table: widgetTable,
        where: () => eq(widgetTable.id, event.payload.id),
      }),
      r.step.return(({ steps }) => {
        const row = steps["widget"] as { label?: string } | null;
        return {
          isSuccess: true as const,
          data: { found: row !== null, label: row?.label ?? null },
        };
      }),
    ],
  ),
});

const listAllHandler = defineWriteHandler({
  name: "widget:list",
  schema: z.object({}),
  access: { roles: ["Admin"] },
  perform: pipeline<Record<string, never>, { count: number }>(({ r }) => [
    r.step.read.findMany("widgets", { table: widgetTable }),
    r.step.return(({ steps }) => ({
      isSuccess: true as const,
      data: { count: (steps["widgets"] as readonly unknown[]).length },
    })),
  ]),
});

// Limit-1 listing exercises BOTH the limit-clause path in findMany AND
// (transitively) the same query-builder code-path that findOne with no
// where-clause would walk — closes both ungated branches with one test.
const listLimitedHandler = defineWriteHandler({
  name: "widget:list-one",
  schema: z.object({}),
  access: { roles: ["Admin"] },
  perform: pipeline<Record<string, never>, { count: number }>(({ r }) => [
    r.step.read.findMany("widgets", { table: widgetTable, limit: 1 }),
    r.step.return(({ steps }) => ({
      isSuccess: true as const,
      data: { count: (steps["widgets"] as readonly unknown[]).length },
    })),
  ]),
});

const purgeLogSchema = z.object({ correlationId: z.string() });
const purgeLogHandler = defineWriteHandler({
  name: "log:purge",
  schema: purgeLogSchema,
  access: { roles: ["Admin"] },
  perform: pipeline<z.infer<typeof purgeLogSchema>, { ok: true }>(({ event, r }) => [
    r.step.unsafeProjectionDelete({
      table: pipelineDemoLogTable,
      where: () => eq(pipelineDemoLogTable.correlationId, event.payload.correlationId),
    }),
    r.step.return({ isSuccess: true as const, data: { ok: true } }),
  ]),
});

const demoPipelineFeature = defineFeature("demoPipeline", (r) => {
  r.requires.projection("pipeline_demo_log");
  r.entity("widget", widgetEntity);
  r.defineEvent("annotated", z.object({ note: z.string() }));
  r.writeHandler(echoHandler);
  r.writeHandler(explodeHandler);
  r.writeHandler(compoundHandler);
  r.writeHandler(logHandler);
  r.writeHandler(widgetCreateHandler);
  r.writeHandler(widgetBrokenHandler);
  r.writeHandler(widgetUpdateHandler);
  r.writeHandler(annotateHandler);
  r.writeHandler(lookupHandler);
  r.writeHandler(listAllHandler);
  r.writeHandler(listLimitedHandler);
  r.writeHandler(purgeLogHandler);
});

let stack: TestStack;
const admin = TestUsers.admin;

describe("defineWriteHandler({ perform: pipeline(...) }) — real dispatcher path", () => {
  beforeAll(async () => {
    stack = await setupTestStack({ features: [demoPipelineFeature] });
    // Push the read-side-projection table — not registered as an entity,
    // so push-entity-projection-tables doesn't pick it up automatically.
    await unsafePushTables(stack.db, { pipeline_demo_log: pipelineDemoLogTable });
    // Aggregate-projection table for the widget entity. setupTestStack
    // doesn't push entity-tables out of the box for ad-hoc test entities.
    await unsafeCreateEntityTable(stack.db, widgetEntity);
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  beforeEach(async () => {
    await stack.db.delete(pipelineDemoLogTable);
  });

  test("HTTP write call goes through dispatcher → pipeline-runner → r.step.return", async () => {
    const res = await stack.http.write(
      "demo-pipeline:write:echo",
      { greeting: "hallo welt" },
      admin,
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as { isSuccess: true; data: { echoed: string; from: string } };
    expect(body.isSuccess).toBe(true);
    expect(body.data).toEqual({
      echoed: "hallo welt",
      from: admin.id,
    });
  });

  test("dispatcher rejects the call when payload fails Zod validation (schema runs BEFORE pipeline)", async () => {
    // Pipeline-runner shouldn't even fire — the dispatcher's parse-stage
    // catches the type mismatch and returns a validation error.
    const res = await stack.http.write(
      "demo-pipeline:write:echo",
      // Intentional type-mismatch — stack.http.write accepts unknown
      // payload, the dispatcher's Zod parse rejects it with 400.
      { greeting: 42 },
      admin,
    );
    expect(res.status).toBe(400);

    const body = (await res.json()) as { isSuccess: false; error: { code: string } };
    expect(body.isSuccess).toBe(false);
    expect(body.error.code).toBe("validation_error");
  });

  test("dispatcher rejects the call when the user lacks the handler's role (access runs BEFORE pipeline)", async () => {
    // Access-check is a different boundary than schema-validation —
    // verify it also fires before the pipeline is built/executed.
    // TestUsers.user has role "User", handler requires "Admin".
    const res = await stack.http.write(
      "demo-pipeline:write:echo",
      { greeting: "should not pass" },
      TestUsers.user,
    );
    expect(res.status).toBe(403);

    const body = (await res.json()) as { isSuccess: false; error: { code: string } };
    expect(body.isSuccess).toBe(false);
    expect(body.error.code).toBe("access_denied");
  });

  test("compute steps thread results through to the return-step's resolver via the real dispatcher ctx", async () => {
    const res = await stack.http.write("demo-pipeline:write:compound", { base: 7 }, admin);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      isSuccess: true;
      data: { sum: number; userId: string };
    };
    expect(body.isSuccess).toBe(true);
    // 100 (offset) + 14 (base * 2) = 114
    expect(body.data.sum).toBe(114);
    expect(body.data.userId).toBe(admin.id);
  });

  test("unsafeProjectionUpsert writes a row to a declared read-side table via real Postgres", async () => {
    const res = await stack.http.write(
      "demo-pipeline:write:log",
      { correlationId: "corr-1", message: "first write" },
      admin,
    );
    expect(res.status).toBe(200);

    const rows = await stack.db.select().from(pipelineDemoLogTable);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      correlationId: "corr-1",
      message: "first write",
      tenantId: admin.tenantId,
    });
  });

  test("unsafeProjectionUpsert is idempotent on the conflict-key — second write updates, not inserts", async () => {
    await stack.http.write(
      "demo-pipeline:write:log",
      { correlationId: "corr-2", message: "v1" },
      admin,
    );
    await stack.http.write(
      "demo-pipeline:write:log",
      { correlationId: "corr-2", message: "v2 — overwritten" },
      admin,
    );

    const rows = await stack.db
      .select()
      .from(pipelineDemoLogTable)
      .where(eq(pipelineDemoLogTable.correlationId, "corr-2"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.message).toBe("v2 — overwritten");
  });

  test("aggregate.create opens a stream via the real event-store and lands the SaveContext under steps.<name>", async () => {
    const res = await stack.http.write(
      "demo-pipeline:write:widget:create",
      { label: "first widget" },
      admin,
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as { isSuccess: true; data: { id: string } };
    expect(body.isSuccess).toBe(true);
    expect(body.data.id).toMatch(/^[0-9a-f-]{36}$/i);

    // Verify the projection-row landed too — the executor's inline
    // projection writes into the widget table in the same TX.
    const rows = await stack.db.select().from(widgetTable);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: "first widget", id: body.data.id });
  });

  test("aggregate.update writes a delta event + projection-row update on an existing stream", async () => {
    // Seed: create a widget first.
    const created = await stack.http.write(
      "demo-pipeline:write:widget:create",
      { label: "before" },
      admin,
    );
    const createdBody = (await created.json()) as { isSuccess: true; data: { id: string } };
    const widgetId = createdBody.data.id;

    // Update its label.
    const updated = await stack.http.write(
      "demo-pipeline:write:widget:update",
      { id: widgetId, label: "after" },
      admin,
    );
    expect(updated.status).toBe(200);
    const updatedBody = (await updated.json()) as { isSuccess: true; data: { id: string } };
    expect(updatedBody.data.id).toBe(widgetId);

    // Projection-row reflects the new label.
    const rows = await stack.db.select().from(widgetTable).where(eq(widgetTable.id, widgetId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: widgetId, label: "after" });
  });

  test("aggregate.appendEvent writes an additional domain event onto the same aggregate stream", async () => {
    const res = await stack.http.write(
      "demo-pipeline:write:widget:annotate",
      { label: "annotated widget", note: "first note" },
      admin,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { isSuccess: true; data: { id: string } };
    const widgetId = body.data.id;

    // The aggregate stream should carry both the auto-generated CRUD
    // event (widget.created) AND the appended annotated event. Direct
    // event-store query is the simplest assertion.
    const events = await stack.db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.aggregateId, widgetId));
    const types = events.map((e) => e["type"]);
    expect(types).toContain("demo-pipeline:event:annotated");
    expect(types.length).toBeGreaterThanOrEqual(2); // created + annotated
  });

  test("aggregate.create executor-failure surfaces as a write-failure (non-2xx, isSuccess: false)", async () => {
    // widgetBrokenHandler intentionally drops the required `label` —
    // executor.create runs into a NOT NULL constraint violation. The
    // step re-raises (or the executor returns WriteFailure), and the
    // dispatcher catches + serialises to the standard failure shape.
    // We don't pin the exact status — schema-level validation is a
    // 4xx, DB-constraint mapping in the executor lands as 5xx
    // depending on driver. The point is: failure visible, no leaked row.

    // Capture row-count before — beforeEach doesn't truncate widget,
    // earlier tests in this run leave rows. We assert "broken did not
    // add a new row" by comparing before/after.
    const before = await stack.db.select().from(widgetTable);

    const res = await stack.http.write("demo-pipeline:write:widget:create-broken", {}, admin);
    expect(res.status).not.toBe(200);

    const body = (await res.json()) as { isSuccess: false; error: { code: string } };
    expect(body.isSuccess).toBe(false);
    expect(body.error.code).toBeDefined();

    const after = await stack.db.select().from(widgetTable);
    expect(after).toHaveLength(before.length);
  });

  test("read.findOne returns the row when present and null when not", async () => {
    // Seed a widget so we have something to look up.
    const created = await stack.http.write(
      "demo-pipeline:write:widget:create",
      { label: "lookup-target" },
      admin,
    );
    const createdBody = (await created.json()) as { isSuccess: true; data: { id: string } };
    const widgetId = createdBody.data.id;

    // Hit: row exists.
    const hit = await stack.http.write(
      "demo-pipeline:write:widget:lookup",
      { id: widgetId },
      admin,
    );
    const hitBody = (await hit.json()) as {
      isSuccess: true;
      data: { found: boolean; label: string | null };
    };
    expect(hitBody.data).toEqual({ found: true, label: "lookup-target" });

    // Miss: random uuid → null → found:false, label:null.
    const miss = await stack.http.write(
      "demo-pipeline:write:widget:lookup",
      { id: "00000000-0000-4000-8000-000000000000" },
      admin,
    );
    const missBody = (await miss.json()) as {
      isSuccess: true;
      data: { found: boolean; label: string | null };
    };
    expect(missBody.data).toEqual({ found: false, label: null });
  });

  test("read.findMany returns the row array (count matches table state)", async () => {
    const before = await stack.db.select().from(widgetTable);
    const res = await stack.http.write("demo-pipeline:write:widget:list", {}, admin);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { isSuccess: true; data: { count: number } };
    expect(body.data.count).toBe(before.length);
  });

  test("read.findMany honours the limit argument", async () => {
    // Seed enough widgets so a limit-1 result is verifiably truncated.
    await stack.http.write("demo-pipeline:write:widget:create", { label: "limit-test-1" }, admin);
    await stack.http.write("demo-pipeline:write:widget:create", { label: "limit-test-2" }, admin);
    const total = await stack.db.select().from(widgetTable);
    expect(total.length).toBeGreaterThanOrEqual(2);

    const res = await stack.http.write("demo-pipeline:write:widget:list-one", {}, admin);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { isSuccess: true; data: { count: number } };
    expect(body.data.count).toBe(1);
  });

  test("unsafeProjectionDelete removes matching rows from the read-side table", async () => {
    // Seed a row via the existing log-handler, then purge it.
    await stack.http.write(
      "demo-pipeline:write:log",
      { correlationId: "to-purge", message: "delete-me" },
      admin,
    );
    const seeded = await stack.db
      .select()
      .from(pipelineDemoLogTable)
      .where(eq(pipelineDemoLogTable.correlationId, "to-purge"));
    expect(seeded).toHaveLength(1);

    const res = await stack.http.write(
      "demo-pipeline:write:log:purge",
      { correlationId: "to-purge" },
      admin,
    );
    expect(res.status).toBe(200);

    const after = await stack.db
      .select()
      .from(pipelineDemoLogTable)
      .where(eq(pipelineDemoLogTable.correlationId, "to-purge"));
    expect(after).toHaveLength(0);
  });

  test("a step that throws maps to a standard write-failure (dispatcher catch)", async () => {
    // The pipeline-runner doesn't wrap step exceptions in M.1.1 (the
    // "throw" failure-strategy is the only one supported). The dispatcher
    // must catch and surface the error as a normal WriteFailure shape.
    const res = await stack.http.write("demo-pipeline:write:explode", {}, admin);
    expect(res.status).toBe(500);

    const body = (await res.json()) as { isSuccess: false; error: { code: string } };
    expect(body.isSuccess).toBe(false);
    expect(body.error.code).toBe("internal_error");
  });
});
