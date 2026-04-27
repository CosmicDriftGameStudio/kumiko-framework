import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { buildDrizzleTable } from "../../db/table-builder";
import { createRegistry, defineFeature } from "../../engine";
import type { AppContext, SaveContext } from "../../engine/types";
import { createJobRunner } from "../../jobs";
import { createLogger } from "../../logging/pino-logger";
import {
  createEntityTable,
  createTestRedis,
  setupTestStack,
  type TestRedis,
  type TestStack,
} from "../../stack";
import { createRecordingProvider, type RecordingProvider, waitFor } from "../../testing";

// End-to-end observability integration: wires a full Kumiko stack with a
// RecordingProvider so we can assert on the span tree and metric events.
// Covers every layer boundary instrumented in v1 (http → dispatcher →
// pipeline hooks) plus the feature-level r.metric() path.

const productFeature = defineFeature("product", (r) => {
  r.metric("tracked_total", {
    type: "counter",
    labels: ["kind"],
  });

  r.writeHandler(
    "track",
    z.object({ kind: z.string() }),
    async (event, ctx) => {
      ctx.metrics.inc("tracked_total", { kind: event.payload.kind });
      return { isSuccess: true, data: { ok: true } };
    },
    { access: { openToAll: true } },
  );
});

const errorFeature = defineFeature("err", (r) => {
  r.writeHandler(
    "boom",
    z.object({}),
    async () => {
      throw new Error("boom from handler");
    },
    { access: { openToAll: true } },
  );
});

// Feature with a real DB-backed entity + custom handler + postSave hook.
// Exercises the full Dispatcher → DB write → Lifecycle hook chain so we can
// verify the db.query and kumiko.pipeline.hook spans land in the right place.
//
// Entity + Drizzle table are co-located inside the feature closure so the
// writeHandler can reference the table without a module-level side-effect.
// id, tenantId, version live in buildBaseColumns — don't redeclare them here.
// Declaring `tenantId: { type: "number" }` used to overwrite the base UUID
// column with an integer one; the insert then got a UUID-string and Postgres
// failed the cast, surfacing as internal_error.
const todoEntity = {
  fields: {
    title: { type: "text" as const, required: true },
  },
};

let postSaveInvocations = 0;
const todoFeature = defineFeature("todo", (r) => {
  const todoTable = buildDrizzleTable("todo", todoEntity);
  r.entity("todo", todoEntity);

  r.writeHandler(
    "create",
    z.object({ title: z.string() }),
    async (event, ctx) => {
      const rows = await ctx.db
        .insert(todoTable)
        .values({ title: event.payload.title })
        .returning();
      const row = rows[0] as { id: number; title: string };
      return {
        isSuccess: true,
        data: {
          kind: "save" as const,
          id: row.id,
          data: row,
          changes: { title: event.payload.title },
          previous: {},
          isNew: true,
          entityName: "todo",
        },
      };
    },
    { access: { openToAll: true } },
  );

  r.hook("postSave", "create", async (_save: SaveContext) => {
    postSaveInvocations++;
  });
});

const adminUser = {
  id: "11111111-0000-4000-8000-000000000001",
  tenantId: "00000000-0000-4000-8000-000000000001",
  roles: ["admin"] as const,
};

describe("Observability (integration)", () => {
  let stack: TestStack;
  let provider: RecordingProvider;

  beforeEach(async () => {
    provider = createRecordingProvider();
    stack = await setupTestStack({
      features: [productFeature],
      observability: provider,
    });
  });

  afterEach(async () => {
    await stack.cleanup();
  });

  it("emits a root http.request span with request-id attribute", async () => {
    await stack.http.command("product:write:track", { kind: "a" }, adminUser);

    const httpSpans = provider.spansByName("http.request");
    expect(httpSpans.length).toBeGreaterThanOrEqual(1);
    const httpSpan = httpSpans[0]!;
    expect(httpSpan.parentSpanId).toBeUndefined();
    expect(httpSpan.attributes["http.method"]).toBe("POST");
    expect(typeof httpSpan.attributes["kumiko.request_id"]).toBe("string");
  });

  it("nests dispatcher.handler under http.request using the same traceId", async () => {
    await stack.http.command("product:write:track", { kind: "a" }, adminUser);

    const httpSpan = provider.spansByName("http.request")[0]!;
    const dispatcherSpans = provider.spansByName("kumiko.dispatcher.handler");
    expect(dispatcherSpans.length).toBeGreaterThanOrEqual(1);
    const dispatcherSpan = dispatcherSpans[0]!;
    expect(dispatcherSpan.traceId).toBe(httpSpan.traceId);
    expect(dispatcherSpan.parentSpanId).toBe(httpSpan.spanId);
    expect(dispatcherSpan.attributes["kumiko.handler"]).toBe("product:write:track");
    expect(dispatcherSpan.attributes["kumiko.feature"]).toBe("product");
  });

  it("feature metric ctx.metrics.inc emits counter.inc with feature prefix", async () => {
    await stack.http.command("product:write:track", { kind: "premium" }, adminUser);

    const counterEvents = provider.metricEvents.filter(
      (e) => e.type === "counter.inc" && e.name === "kumiko_product_tracked_total",
    );
    expect(counterEvents).toHaveLength(1);
    expect(counterEvents[0]?.labels).toEqual({ kind: "premium" });
  });

  it("emits standard http + dispatcher metrics for the request", async () => {
    await stack.http.command("product:write:track", { kind: "a" }, adminUser);

    const httpRequestsTotal = provider.metricEvents.find(
      (e) => e.type === "counter.inc" && e.name === "kumiko_http_requests_total",
    );
    expect(httpRequestsTotal).toBeDefined();
    expect(httpRequestsTotal?.labels?.["method"]).toBe("POST");

    const handlerDuration = provider.metricEvents.find(
      (e) =>
        e.type === "histogram.observe" && e.name === "kumiko_dispatcher_handler_duration_seconds",
    );
    expect(handlerDuration).toBeDefined();
  });

  it("sensitive Authorization header does not leak into any span", async () => {
    await stack.http.command("product:write:track", { kind: "a" }, adminUser);

    const allAttributeValues = provider.spans
      .flatMap((s) => Object.values(s.attributes))
      .map((v) => String(v));
    for (const v of allAttributeValues) {
      expect(v).not.toMatch(/^Bearer /i);
    }
  });
});

describe("Observability (integration) — DB + pipeline hook spans", () => {
  let stack: TestStack;
  let provider: RecordingProvider;

  beforeEach(async () => {
    postSaveInvocations = 0;
    provider = createRecordingProvider();
    stack = await setupTestStack({
      features: [todoFeature],
      observability: provider,
      systemHooks: [],
    });
    await createEntityTable(stack.db, todoEntity, "todo");
  });

  afterEach(async () => {
    await stack.cleanup();
  });

  it("emits db.query spans under the dispatcher span with operation + table attrs", async () => {
    await stack.http.writeOk("todo:write:create", { title: "buy milk" }, adminUser);

    const httpSpan = provider.spansByName("http.request")[0]!;
    const dispatcherSpan = provider.spansByName("kumiko.dispatcher.handler")[0]!;
    const dbSpans = provider.spansByName("db.query");

    expect(dbSpans.length).toBeGreaterThanOrEqual(1);
    // At least one db.query should be a descendant of the dispatcher span.
    const insertSpan = dbSpans.find((s) => s.attributes["db.operation"] === "insert");
    expect(insertSpan).toBeDefined();
    expect(insertSpan?.traceId).toBe(httpSpan.traceId);
    expect(insertSpan?.attributes["db.table"]).toBe("read_todos");
    expect(insertSpan?.attributes["db.system"]).toBe("postgresql");
    // parent chain: insert → ... → dispatcher
    const dispatcherId = dispatcherSpan.spanId;
    const allInTrace = provider.spansByTraceId(httpSpan.traceId);
    const idToSpan = new Map(allInTrace.map((s) => [s.spanId, s]));
    let cursor: string | undefined = insertSpan?.parentSpanId;
    let foundDispatcher = false;
    while (cursor) {
      if (cursor === dispatcherId) {
        foundDispatcher = true;
        break;
      }
      cursor = idToSpan.get(cursor)?.parentSpanId;
    }
    expect(foundDispatcher).toBe(true);
  });

  it("emits db.query metric with operation + table labels", async () => {
    await stack.http.writeOk("todo:write:create", { title: "ship it" }, adminUser);

    const dbMetric = provider.metricEvents.find(
      (e) =>
        e.type === "histogram.observe" &&
        e.name === "kumiko_db_query_duration_seconds" &&
        e.labels?.["operation"] === "insert" &&
        e.labels?.["table"] === "read_todos",
    );
    expect(dbMetric).toBeDefined();
  });

  it("emits kumiko.pipeline.hook span under the dispatcher for the postSave hook", async () => {
    await stack.http.writeOk("todo:write:create", { title: "test hook span" }, adminUser);
    expect(postSaveInvocations).toBeGreaterThanOrEqual(1);

    const httpSpan = provider.spansByName("http.request")[0]!;
    const hookSpans = provider.spansByName("kumiko.pipeline.hook");
    expect(hookSpans.length).toBeGreaterThanOrEqual(1);

    // Every hook span should belong to the same trace and carry the standard
    // attributes so dashboards can filter by handler / phase / source.
    for (const hookSpan of hookSpans) {
      expect(hookSpan.traceId).toBe(httpSpan.traceId);
      expect(hookSpan.attributes["kumiko.handler"]).toBe("todo:write:create");
      expect(typeof hookSpan.attributes["kumiko.hook_type"]).toBe("string");
      expect(typeof hookSpan.attributes["kumiko.hook_phase"]).toBe("string");
    }

    // At least one handler-sourced hook should exist (the postSave we declared).
    const handlerHook = hookSpans.find((s) => s.attributes["kumiko.hook_source"] === "handler");
    expect(handlerHook).toBeDefined();
  });
});

// outbox cross-process trace propagation lived here once — removed in D.5 when
// the outbox was replaced by the async event-dispatcher. Cross-consumer trace
// continuation for the new pipeline is tested in event-dispatcher.integration.

// Redis-wrapper instrumentation: any command issued through the Redis client
// that arrives in the AppContext emits a `redis.cmd` span with command name
// and a key pattern (never the raw key).
describe("Observability (integration) — Redis wrapper", () => {
  let stack: TestStack;
  let provider: RecordingProvider;

  const redisFeature = defineFeature("redis-cmds", (r) => {
    r.writeHandler(
      "ping",
      z.object({}),
      async (_event, ctx) => {
        if (!ctx.redis) throw new Error("ctx.redis unavailable");
        await ctx.redis.set("session:abc123:token", "value");
        await ctx.redis.get("session:abc123:token");
        return { isSuccess: true, data: { ok: true } };
      },
      { access: { openToAll: true } },
    );
  });

  beforeEach(async () => {
    provider = createRecordingProvider();
    stack = await setupTestStack({
      features: [redisFeature],
      observability: provider,
      systemHooks: [],
    });
  });

  afterEach(async () => {
    await stack.cleanup();
  });

  it("emits redis.cmd spans for set + get, redacts raw keys to a pattern", async () => {
    await stack.http.writeOk("redis-cmds:write:ping", {}, adminUser);

    const redisSpans = provider.spansByName("redis.cmd");
    // Exactly the two commands the handler issued.
    const commands = redisSpans
      .map((s) => s.attributes["redis.command"])
      .filter((c): c is string => typeof c === "string");
    expect(commands).toContain("set");
    expect(commands).toContain("get");

    // Key pattern is the safe `namespace:second-segment:*` form, never the
    // full session token.
    for (const s of redisSpans) {
      const pattern = s.attributes["redis.key_pattern"];
      if (pattern !== undefined) {
        expect(String(pattern)).toBe("session:abc123:*");
        expect(String(pattern)).not.toContain("token");
      }
    }

    // Same trace as the http.request span.
    const httpSpan = provider.spansByName("http.request")[0]!;
    for (const s of redisSpans) {
      expect(s.traceId).toBe(httpSpan.traceId);
    }
  });
});

// Pino bridge: ctx.log entries emitted through the real createLogger()
// automatically carry the active trace context (traceId + spanId). Genuine
// end-to-end means: give createLogger a custom destination stream, inject
// it via extraContext, fire an HTTP request that calls ctx.log inside a
// handler, then parse the captured NDJSON and verify trace fields landed.
describe("Observability (integration) — Pino trace bridge", () => {
  let stack: TestStack;
  let provider: RecordingProvider;
  let capturedLines: string[];

  const logFeature = defineFeature("pino-bridge", (r) => {
    r.writeHandler(
      "say",
      z.object({ msg: z.string() }),
      async (event, ctx) => {
        ctx.log?.info(event.payload.msg, { custom: "field" });
        return { isSuccess: true, data: { ok: true } };
      },
      { access: { openToAll: true } },
    );
  });

  beforeEach(async () => {
    capturedLines = [];
    provider = createRecordingProvider();
    // Pino writes NDJSON; one call = one line. Keep the raw chunks so we can
    // both assert on the bytes AND parse them back to objects.
    const destination = {
      write: (chunk: string) => {
        capturedLines.push(chunk);
      },
    };
    const realLogger = createLogger({ level: "info", destination });
    stack = await setupTestStack({
      features: [logFeature],
      observability: provider,
      systemHooks: [],
      extraContext: { log: realLogger },
    });
  });

  afterEach(async () => {
    await stack.cleanup();
  });

  it("real createLogger emits NDJSON with traceId/spanId matching the active span", async () => {
    await stack.http.writeOk("pino-bridge:write:say", { msg: "hello" }, adminUser);

    // Find the NDJSON line pino wrote for our handler log.
    const parsed = capturedLines
      .flatMap((c) => c.split("\n"))
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const entry = parsed.find((p) => p["msg"] === "hello");
    expect(entry).toBeDefined();
    expect(entry?.["custom"]).toBe("field");
    expect(typeof entry?.["traceId"]).toBe("string");
    expect(typeof entry?.["spanId"]).toBe("string");

    const httpSpan = provider.spansByName("http.request")[0]!;
    expect(entry?.["traceId"]).toBe(httpSpan.traceId);

    // spanId should match one of the spans in the same trace (most specific
    // active span when ctx.log is called — typically the dispatcher span).
    const idsInTrace = provider.spansByTraceId(httpSpan.traceId).map((s) => s.spanId);
    expect(idsInTrace).toContain(entry?.["spanId"]);
  });

  it("logs outside any active span have no trace fields", () => {
    const lines: string[] = [];
    const destination = {
      write: (chunk: string) => {
        lines.push(chunk);
      },
    };
    const logger = createLogger({ level: "info", destination });
    logger.info("standalone");

    const parsed = lines
      .flatMap((c) => c.split("\n"))
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const entry = parsed.find((p) => p["msg"] === "standalone");
    expect(entry).toBeDefined();
    expect(entry?.["traceId"]).toBeUndefined();
    expect(entry?.["spanId"]).toBeUndefined();
  });
});

// Jobs cross-process trace: a handler (or any caller) dispatches a job while
// inside an active span. The job payload carries a serialized trace context;
// when the worker picks up the job, the `job.execute` span must land in the
// SAME trace as the dispatcher's parent span.
describe("Observability (integration) — Jobs cross-process trace", () => {
  let testRedis: TestRedis;
  let redisUrl: string;

  // Track which job runs so we can await completion before asserting spans.
  let jobRanWith: Record<string, unknown> | undefined;

  const jobFeature = defineFeature("jobs-trace", (r) => {
    r.job("record", { trigger: { manual: true } }, async (payload) => {
      jobRanWith = payload;
    });
  });

  beforeAll(async () => {
    testRedis = await createTestRedis();
    const { host, port, db } = testRedis.redis.options;
    redisUrl = `redis://${host}:${port}/${db ?? 0}`;
  });

  afterAll(async () => {
    await testRedis.cleanup();
  });

  beforeEach(() => {
    jobRanWith = undefined;
  });

  it("job.execute span shares the caller's traceId and parents on the caller's span", async () => {
    const provider = createRecordingProvider();
    const registry = createRegistry([jobFeature]);
    const context: AppContext = { tracer: provider.tracer, meter: provider.meter };
    const runner = createJobRunner({
      registry,
      context,
      redisUrl,
      consumerLane: "worker",
      queueNamePrefix: `kumiko-obs-${Date.now()}`,
    });

    try {
      await runner.start();

      // Dispatch the job from inside an active span — this is the caller that
      // the worker must link back to via the serialized trace context.
      const dispatched = await provider.tracer.withSpan("caller.request", {}, async () => {
        await runner.dispatch("jobs-trace:job:record", { note: "hi" });
        return provider.tracer.getActiveSpan()!;
      });

      await waitFor(() => {
        if (jobRanWith === undefined) throw new Error("job didn't run yet");
      });

      // The caller span — recorded when withSpan ends — is the parent target.
      const callerSpan = provider.spansByName("caller.request")[0]!;
      const jobSpan = provider.spansByName("job.execute")[0]!;

      expect(jobSpan).toBeDefined();
      expect(jobSpan.traceId).toBe(callerSpan.traceId);
      expect(jobSpan.parentSpanId).toBe(dispatched.spanId);
      expect(jobSpan.attributes["job.name"]).toBe("jobs-trace:job:record");
      // Welle 2.6: lane-routing attributes. run_in is the job's declared
      // lane (default "worker" here, no explicit runIn on the feature);
      // consumer_lane is the runner that actually picked it.
      expect(jobSpan.attributes["kumiko.job.run_in"]).toBe("worker");
      expect(jobSpan.attributes["kumiko.job.consumer_lane"]).toBe("worker");
    } finally {
      await runner.stop();
    }
  });

  it("job.execute is a root span when dispatched without an active caller span", async () => {
    const provider = createRecordingProvider();
    const registry = createRegistry([jobFeature]);
    const context: AppContext = { tracer: provider.tracer, meter: provider.meter };
    const runner = createJobRunner({
      registry,
      context,
      redisUrl,
      consumerLane: "worker",
      queueNamePrefix: `kumiko-obs-${Date.now()}`,
    });

    try {
      await runner.start();
      await runner.dispatch("jobs-trace:job:record", { note: "root" });
      await waitFor(() => {
        if (jobRanWith === undefined) throw new Error("job didn't run yet");
      });

      const jobSpan = provider.spansByName("job.execute")[0]!;
      expect(jobSpan).toBeDefined();
      // No caller span was active — the worker starts a fresh trace.
      expect(jobSpan.parentSpanId).toBeUndefined();
    } finally {
      await runner.stop();
    }
  });
});

describe("Observability (integration) — error path", () => {
  let stack: TestStack;
  let provider: RecordingProvider;

  beforeEach(async () => {
    provider = createRecordingProvider();
    stack = await setupTestStack({
      features: [errorFeature],
      observability: provider,
    });
  });

  afterEach(async () => {
    await stack.cleanup();
  });

  it("records error status on dispatcher span + emits error counter", async () => {
    const res = await stack.http.command("err:write:boom", {}, adminUser);
    expect(res.status).toBeGreaterThanOrEqual(400);

    const dispatcherSpan = provider.spansByName("kumiko.dispatcher.handler")[0];
    expect(dispatcherSpan?.status).toBe("error");

    const errorCounter = provider.metricEvents.find(
      (e) => e.type === "counter.inc" && e.name === "kumiko_dispatcher_handler_errors_total",
    );
    expect(errorCounter).toBeDefined();
    expect(errorCounter?.labels?.["handler"]).toBe("err:write:boom");
  });
});
