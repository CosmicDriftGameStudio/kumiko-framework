// M.1.1 dispatcher-integration test — proves the perform-as-pipeline path
// goes through the full real stack:
//   - r.writeHandler(definitionObj) accepts the new output shape
//   - boot-validation doesn't trip on the `perform` field
//   - dispatcher parses the payload (Zod schema) BEFORE invoking handler
//   - dispatcher checks access-rules BEFORE invoking handler
//   - dispatcher hands the handler a real HandlerContext (~30 fields)
//   - the compiled handler (defineWriteHandler-generated) runs the
//     pipeline-runner against that ctx
//   - r.step.return resolver receives the live event
//   - WriteResult lands on the HTTP caller
//   - a step that throws maps to a standard write-failure (500 +
//     internal_error) via the dispatcher's catch
//
// Compare to pipeline-vertical-slice.test.ts which uses an empty ctx
// mock — this test is the gate advisor flagged: real Postgres, real
// JWT, real HTTP.

import { eq } from "drizzle-orm";
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { defineFeature } from "../define-feature";
import { defineWriteHandler } from "../define-handler";
import { pipeline } from "../pipeline";
import { setupTestStack, type TestStack, TestUsers, unsafePushTables } from "../../stack";

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
      r.step.return(({ steps, event: e }) => ({
        isSuccess: true as const,
        data: {
          sum: (steps["offset"] as number) + (steps["doubledBase"] as number),
          userId: e.user.id,
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
  perform: pipeline<z.infer<typeof logSchema>, { correlationId: string }>(({ event, r }) => [
    r.step.unsafeProjectionUpsert({
      table: pipelineDemoLogTable,
      on: ["correlationId"],
      row: ({ event: e }) => ({
        tenantId: e.user.tenantId,
        correlationId: e.payload.correlationId,
        message: e.payload.message,
      }),
    }),
    r.step.return(({ event: e }) => ({
      isSuccess: true as const,
      data: { correlationId: e.payload.correlationId },
    })),
  ]),
});

const demoPipelineFeature = defineFeature("demoPipeline", (r) => {
  r.requires.projection("pipeline_demo_log");
  r.writeHandler(echoHandler);
  r.writeHandler(explodeHandler);
  r.writeHandler(compoundHandler);
  r.writeHandler(logHandler);
});

let stack: TestStack;
const admin = TestUsers.admin;

describe("defineWriteHandler({ perform: pipeline(...) }) — real dispatcher path", () => {
  beforeAll(async () => {
    stack = await setupTestStack({ features: [demoPipelineFeature] });
    // Push the read-side-projection table — not registered as an entity,
    // so push-entity-projection-tables doesn't pick it up automatically.
    await unsafePushTables(stack.db, [pipelineDemoLogTable]);
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
    const res = await stack.http.write(
      "demo-pipeline:write:compound",
      { base: 7 },
      admin,
    );
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
