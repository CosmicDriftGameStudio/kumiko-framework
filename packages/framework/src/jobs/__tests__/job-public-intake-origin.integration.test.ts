// Every job here is retries:0 so a gated failure surfaces on the first attempt.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Queue } from "bullmq";
import { z } from "zod";
import type { SchemaTable } from "../../db";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { asRawClient, selectMany } from "../../db/query";
import { buildEntityTable } from "../../db/table-builder";
import { createTenantDb } from "../../db/tenant-db";
import { createEntity, createTextField, defineFeature } from "../../engine";
import { SYSTEM_ROLE } from "../../engine/system-user";
import type { TenantId } from "../../engine/types";
import { AccessDeniedError, FrameworkReasons } from "../../errors";
import { setupTestStack, type TestStack, TestUsers, unsafeCreateEntityTable } from "../../stack";
import { waitFor } from "../../testing";

// #983: ctx.jobRunner is typed as the narrow JobRunnerRef (handleEvent only);
// manual dispatch from a handler/job is a dynamic context extension, same
// cast as setup-test-stack-jobs.integration.test.ts.
type ManualDispatchRef = {
  dispatch: (name: string, payload: Record<string, unknown>) => Promise<string>;
};
function manualDispatch(ctx: { jobRunner?: unknown }): ManualDispatchRef | undefined {
  return ctx.jobRunner as ManualDispatchRef | undefined; // @cast-boundary dynamic-key
}

// Records every gated failure a PII-writing job actually raised — the only
// way a "blocked" test proves the job ran and was denied, instead of just
// observing the row count that would also be 0 before the job ever fires.
type GatedFailure = { job: string; reason: unknown; details: unknown; message: string };
const gatedFailures: GatedFailure[] = [];

function isAccessDeniedError(err: unknown): err is AccessDeniedError {
  return err instanceof AccessDeniedError;
}

function recordGatedFailure(job: string, err: unknown): never {
  if (isAccessDeniedError(err)) {
    const details = err.details;
    const reason =
      typeof details === "object" && details !== null && "reason" in details
        ? (details as { reason: unknown }).reason
        : undefined;
    gatedFailures.push({ job, reason, details, message: err.message });
  }
  throw err;
}

const TENANT_ID = "00000000-0000-4000-8000-000000000002" as TenantId;
const RATE_LIMIT = { per: "ip", limit: 1000, windowSeconds: 60 } as const;
const QUEUE_NAME_PREFIX = `kumiko-write-origin-test-${Date.now()}`;
const UNSAFE_RAW_REASON =
  "test: proves ctx.systemDb.unsafeRaw()-derived createTenantDb inherits the job's gate";

// --- Feature holding the PII entity + the job's "foreign handler" target ---

const secretEntity = createEntity({
  table: "job_origin_secrets",
  fields: {
    value: createTextField({ personal: "self", find: "none", default: "" }),
  },
});
const secretTable = buildEntityTable("secret", secretEntity);

const secretsFeature = defineFeature("secrets", (r) => {
  r.entity("secret", secretEntity);
  r.writeHandler(
    "create",
    z.object({ value: z.string() }),
    async (event, ctx) => {
      const crud = createEventStoreExecutor(secretTable, secretEntity, { entityName: "secret" });
      return crud.create({ value: event.payload.value }, event.user, ctx.db);
    },
    { access: { roles: [SYSTEM_ROLE] } },
  );
});

// --- Feature owning the jobs under test ---

const jobsFeature = defineFeature("jobsx", (r) => {
  r.defineEvent("leaked", z.object({ value: z.string() }), { piiFields: "none" });

  r.job("write-direct", { trigger: { manual: true }, retries: 0 }, async (payload, ctx) => {
    try {
      await ctx.db.insertOne(secretTable as unknown as SchemaTable, {
        // @cast-boundary test-fixture
        value: payload["value"] as string, // @cast-boundary test-fixture
      });
    } catch (err) {
      recordGatedFailure("jobsx:job:write-direct", err);
    }
  });

  r.job("write-foreign", { trigger: { manual: true }, retries: 0 }, async (payload, ctx) => {
    const result = await ctx.write("secrets:write:create", {
      value: payload["value"] as string, // @cast-boundary test-fixture
    });
    if (!result.isSuccess) {
      recordGatedFailure(
        "jobsx:job:write-foreign",
        new AccessDeniedError({ message: result.error.message, details: result.error.details }),
      );
    }
  });

  r.job("chain-dispatch", { trigger: { manual: true }, retries: 0 }, async (payload, ctx) => {
    await manualDispatch(ctx)?.dispatch("jobsx:job:write-direct", { value: payload["value"] });
  });

  r.job(
    "on-trigger-no-declare",
    { trigger: { on: "jobsx:write:trigger-source-no-declare" }, retries: 0 },
    async (payload, ctx) => {
      try {
        await ctx.db.insertOne(secretTable as unknown as SchemaTable, {
          // @cast-boundary test-fixture
          value: payload["value"] as string, // @cast-boundary test-fixture
        });
      } catch (err) {
        recordGatedFailure("jobsx:job:on-trigger-no-declare", err);
      }
    },
  );
  r.job(
    "on-trigger-declare",
    { trigger: { on: "jobsx:write:trigger-source-declare" }, retries: 0 },
    async (payload, ctx) => {
      try {
        await ctx.db.insertOne(secretTable as unknown as SchemaTable, {
          // @cast-boundary test-fixture
          value: payload["value"] as string, // @cast-boundary test-fixture
        });
      } catch (err) {
        recordGatedFailure("jobsx:job:on-trigger-declare", err);
      }
    },
  );
  r.job(
    "on-defined-event",
    { trigger: { on: "jobsx:event:leaked" }, retries: 0 },
    async (payload, ctx) => {
      try {
        await ctx.db.insertOne(secretTable as unknown as SchemaTable, {
          // @cast-boundary test-fixture
          value: payload["value"] as string, // @cast-boundary test-fixture
        });
      } catch (err) {
        recordGatedFailure("jobsx:job:on-defined-event", err);
      }
    },
  );

  r.writeHandler(
    "dispatch-no-declare",
    z.object({ value: z.string() }),
    async (event, ctx) => {
      await manualDispatch(ctx)?.dispatch("jobsx:job:write-direct", { value: event.payload.value });
      return { isSuccess: true as const, data: { ok: true as const } };
    },
    { access: { roles: ["anonymous"] }, rateLimit: RATE_LIMIT },
  );
  r.writeHandler(
    "dispatch-declare",
    z.object({ value: z.string() }),
    async (event, ctx) => {
      await manualDispatch(ctx)?.dispatch("jobsx:job:write-direct", { value: event.payload.value });
      return { isSuccess: true as const, data: { ok: true as const } };
    },
    { access: { roles: ["anonymous"], personalData: "public-intake" }, rateLimit: RATE_LIMIT },
  );

  r.writeHandler(
    "foreign-no-declare",
    z.object({ value: z.string() }),
    async (event, ctx) => {
      await manualDispatch(ctx)?.dispatch("jobsx:job:write-foreign", {
        value: event.payload.value,
      });
      return { isSuccess: true as const, data: { ok: true as const } };
    },
    { access: { roles: ["anonymous"] }, rateLimit: RATE_LIMIT },
  );
  r.writeHandler(
    "foreign-declare",
    z.object({ value: z.string() }),
    async (event, ctx) => {
      await manualDispatch(ctx)?.dispatch("jobsx:job:write-foreign", {
        value: event.payload.value,
      });
      return { isSuccess: true as const, data: { ok: true as const } };
    },
    { access: { roles: ["anonymous"], personalData: "public-intake" }, rateLimit: RATE_LIMIT },
  );

  r.writeHandler(
    "chain-no-declare",
    z.object({ value: z.string() }),
    async (event, ctx) => {
      await manualDispatch(ctx)?.dispatch("jobsx:job:chain-dispatch", {
        value: event.payload.value,
      });
      return { isSuccess: true as const, data: { ok: true as const } };
    },
    { access: { roles: ["anonymous"] }, rateLimit: RATE_LIMIT },
  );
  r.writeHandler(
    "chain-declare",
    z.object({ value: z.string() }),
    async (event, ctx) => {
      await manualDispatch(ctx)?.dispatch("jobsx:job:chain-dispatch", {
        value: event.payload.value,
      });
      return { isSuccess: true as const, data: { ok: true as const } };
    },
    { access: { roles: ["anonymous"], personalData: "public-intake" }, rateLimit: RATE_LIMIT },
  );

  r.writeHandler(
    "trigger-source-no-declare",
    z.object({ value: z.string() }),
    async (event) => ({ isSuccess: true as const, data: { value: event.payload.value } }),
    { access: { roles: ["anonymous"] }, rateLimit: RATE_LIMIT },
  );
  r.writeHandler(
    "trigger-source-declare",
    z.object({ value: z.string() }),
    async (event) => ({ isSuccess: true as const, data: { value: event.payload.value } }),
    { access: { roles: ["anonymous"], personalData: "public-intake" }, rateLimit: RATE_LIMIT },
  );

  r.writeHandler(
    "definedevent-no-declare",
    z.object({ value: z.string() }),
    async (event, ctx) => {
      await ctx.unsafeAppendEvent({
        aggregateId: crypto.randomUUID(),
        aggregateType: "jobsx-leak",
        type: "jobsx:event:leaked",
        payload: { value: event.payload.value },
      });
      return { isSuccess: true as const, data: { ok: true as const } };
    },
    { access: { roles: ["anonymous"] }, rateLimit: RATE_LIMIT },
  );
  r.writeHandler(
    "definedevent-declare",
    z.object({ value: z.string() }),
    async (event, ctx) => {
      await ctx.unsafeAppendEvent({
        aggregateId: crypto.randomUUID(),
        aggregateType: "jobsx-leak",
        type: "jobsx:event:leaked",
        payload: { value: event.payload.value },
      });
      return { isSuccess: true as const, data: { ok: true as const } };
    },
    { access: { roles: ["anonymous"], personalData: "public-intake" }, rateLimit: RATE_LIMIT },
  );

  r.queryHandler(
    "query-dispatch-no-declare",
    z.object({ value: z.string() }),
    async (event, ctx) => {
      await manualDispatch(ctx)?.dispatch("jobsx:job:write-direct", { value: event.payload.value });
      return { ok: true as const };
    },
    { access: { roles: ["anonymous"] }, rateLimit: RATE_LIMIT },
  );

  r.writeHandler(
    "authenticated-dispatch",
    z.object({ value: z.string() }),
    async (event, ctx) => {
      await manualDispatch(ctx)?.dispatch("jobsx:job:write-direct", { value: event.payload.value });
      return { isSuccess: true as const, data: { ok: true as const } };
    },
    { access: { roles: ["Admin"] } },
  );
});

// --- Feature-level r.systemScope() job: proves ctx.systemDb.unsafeRaw()'s
// createTenantDb-derived TenantDb also inherits the job's gate (tenant-db.ts's
// runnerPersonalDataGates, same mechanism pass 1 pinned for handlers). ---

const systemJobFeature = defineFeature("systemjob", (r) => {
  r.systemScope();
  r.job("write-systemdb", { trigger: { manual: true }, retries: 0 }, async (payload, ctx) => {
    const raw = ctx.systemDb?.unsafeRaw(UNSAFE_RAW_REASON);
    if (!raw) throw new Error("test setup error: ctx.systemDb missing on a systemScope() job");
    try {
      await createTenantDb(raw, ctx.systemUser.tenantId, "system").insertOne(
        secretTable as unknown as SchemaTable, // @cast-boundary test-fixture
        { value: payload["value"] as string },
      );
    } catch (err) {
      recordGatedFailure("systemjob:job:write-systemdb", err);
    }
  });
});

const dispatchSystemDbFeature = defineFeature("systemjobdispatch", (r) => {
  r.writeHandler(
    "no-declare",
    z.object({ value: z.string() }),
    async (event, ctx) => {
      await manualDispatch(ctx)?.dispatch("systemjob:job:write-systemdb", {
        value: event.payload.value,
      });
      return { isSuccess: true as const, data: { ok: true as const } };
    },
    { access: { roles: ["anonymous"] }, rateLimit: RATE_LIMIT },
  );
  r.writeHandler(
    "declare",
    z.object({ value: z.string() }),
    async (event, ctx) => {
      await manualDispatch(ctx)?.dispatch("systemjob:job:write-systemdb", {
        value: event.payload.value,
      });
      return { isSuccess: true as const, data: { ok: true as const } };
    },
    { access: { roles: ["anonymous"], personalData: "public-intake" }, rateLimit: RATE_LIMIT },
  );
});

describe("job/event write-origin inheritance", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({
      features: [secretsFeature, jobsFeature, systemJobFeature, dispatchSystemDbFeature],
      anonymousAccess: { defaultTenantId: TENANT_ID },
      jobs: { consumerLane: "worker", queueNamePrefix: QUEUE_NAME_PREFIX },
    });
    await unsafeCreateEntityTable(stack.db, secretEntity, "secret");
  });

  afterAll(() => stack.cleanup());

  beforeEach(async () => {
    await asRawClient(stack.db).unsafe(`DELETE FROM "${secretTable.tableName}"`);
    gatedFailures.length = 0;
  });

  async function rowCount(): Promise<number> {
    const rows = await selectMany(stack.db, secretTable as unknown as SchemaTable); // @cast-boundary test-fixture
    return rows.length;
  }

  async function post(type: string, value: string, endpoint = "/api/write"): Promise<void> {
    const res = await stack.http.raw("POST", endpoint, { type, payload: { value } });
    expect(res.status).toBe(200);
  }

  // Waits for the job's own gated failure, not just an unchanged row count —
  // rowCount()==0 also holds before the job has run at all, so asserting on
  // it alone would pass even if the gate never fired.
  async function expectBlocked(
    type: string,
    value: string,
    job: string,
    rootHandler: string,
    endpoint = "/api/write",
  ): Promise<void> {
    await post(type, value, endpoint);
    await waitFor(async () => {
      await stack.eventDispatcher?.runOnce();
      expect(gatedFailures.some((f) => f.job === job)).toBe(true);
    });
    const failure = gatedFailures.find((f) => f.job === job);
    expect(failure?.reason).toBe(FrameworkReasons.publicIntakeRequired);
    expect((failure?.details as { job?: string } | undefined)?.job).toBe(job);
    expect((failure?.details as { rootHandler?: string } | undefined)?.rootHandler).toBe(
      rootHandler,
    );
    expect((failure?.details as { fields?: readonly string[] } | undefined)?.fields).toContain(
      "value",
    );
    expect(failure?.message).toContain(`via job "${job}"`);
  }

  async function expectAllowed(type: string, value: string): Promise<void> {
    await post(type, value);
    await waitFor(async () => {
      await stack.eventDispatcher?.runOnce();
      expect(await rowCount()).toBe(1);
    });
  }

  test("ctx.jobRunner.dispatch from an anonymous root — blocked without declaration", async () => {
    await expectBlocked(
      "jobsx:write:dispatch-no-declare",
      "leak-dispatch",
      "jobsx:job:write-direct",
      "jobsx:write:dispatch-no-declare",
    );
    expect(await rowCount()).toBe(0);
  });

  test("ctx.jobRunner.dispatch from an anonymous root — allowed once declared", async () => {
    await expectAllowed("jobsx:write:dispatch-declare", "leak-dispatch-declared");
    expect(gatedFailures).toHaveLength(0);
  });

  test("anonymous query root dispatching a PII job — blocked", async () => {
    await expectBlocked(
      "jobsx:query:query-dispatch-no-declare",
      "leak-query-dispatch",
      "jobsx:job:write-direct",
      "jobsx:query:query-dispatch-no-declare",
      "/api/query",
    );
    expect(await rowCount()).toBe(0);
  });

  test("sync handler-QN job trigger (afterCommit) — blocked without declaration", async () => {
    await expectBlocked(
      "jobsx:write:trigger-source-no-declare",
      "leak-trigger",
      "jobsx:job:on-trigger-no-declare",
      "jobsx:write:trigger-source-no-declare",
    );
    expect(await rowCount()).toBe(0);
  });

  test("sync handler-QN job trigger (afterCommit) — allowed once declared", async () => {
    await expectAllowed("jobsx:write:trigger-source-declare", "leak-trigger-declared");
    expect(gatedFailures).toHaveLength(0);
  });

  test("job's ctx.write into a foreign handler — blocked without declaration", async () => {
    await expectBlocked(
      "jobsx:write:foreign-no-declare",
      "leak-foreign",
      "jobsx:job:write-foreign",
      "jobsx:write:foreign-no-declare",
    );
    expect(await rowCount()).toBe(0);
  });

  test("job's ctx.write into a foreign handler — allowed once declared", async () => {
    await expectAllowed("jobsx:write:foreign-declare", "leak-foreign-declared");
    expect(gatedFailures).toHaveLength(0);
  });

  test("job's ctx.systemDb.unsafeRaw()-derived createTenantDb — blocked without declaration", async () => {
    await expectBlocked(
      "systemjobdispatch:write:no-declare",
      "leak-systemdb",
      "systemjob:job:write-systemdb",
      "systemjobdispatch:write:no-declare",
    );
    expect(await rowCount()).toBe(0);
  });

  test("job's ctx.systemDb.unsafeRaw()-derived createTenantDb — allowed once declared", async () => {
    await expectAllowed("systemjobdispatch:write:declare", "leak-systemdb-declared");
    expect(gatedFailures).toHaveLength(0);
  });

  test("job chaining (A dispatches B, B writes PII) — blocked without declaration", async () => {
    await expectBlocked(
      "jobsx:write:chain-no-declare",
      "leak-chain",
      "jobsx:job:write-direct",
      "jobsx:write:chain-no-declare",
    );
    expect(await rowCount()).toBe(0);
  });

  test("job chaining (A dispatches B, B writes PII) — allowed once declared", async () => {
    await expectAllowed("jobsx:write:chain-declare", "leak-chain-declared");
    expect(gatedFailures).toHaveLength(0);
  });

  test("r.defineEvent job trigger via ctx.appendEvent — blocked without declaration", async () => {
    await expectBlocked(
      "jobsx:write:definedevent-no-declare",
      "leak-event",
      "jobsx:job:on-defined-event",
      "jobsx:write:definedevent-no-declare",
    );
    expect(await rowCount()).toBe(0);
  });

  test("r.defineEvent job trigger via ctx.appendEvent — allowed once declared", async () => {
    await expectAllowed("jobsx:write:definedevent-declare", "leak-event-declared");
    expect(gatedFailures).toHaveLength(0);
  });

  test("authenticated root dispatching the same job — unaffected", async () => {
    const token = await stack.jwt.sign(TestUsers.admin);
    const res = await stack.app.request("/api/write", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        type: "jobsx:write:authenticated-dispatch",
        payload: { value: "leak-authenticated" },
      }),
    });
    expect(res.status).toBe(200);
    await waitFor(async () => {
      expect(await rowCount()).toBe(1);
    });
  });

  test("a legacy job dispatched directly (no request context, no _writeOrigin) runs ungated", async () => {
    if (!stack.jobRunner) throw new Error("test setup error: stack.jobRunner missing");
    await stack.jobRunner.dispatch("jobsx:job:write-direct", { value: "leak-legacy" });
    await waitFor(async () => {
      expect(await rowCount()).toBe(1);
    });
  });

  test("a tampered _writeOrigin fails the job closed instead of running ungated", async () => {
    // bullmq bundles its own ioredis; a shared Redis instance's class type
    // doesn't structurally match its ConnectionOptions, but plain
    // host/port/db data does (mirrors job-runner.ts's parseRedisOpts).
    const { host, port, db } = stack.redis.redis.options;
    const queue = new Queue(`${QUEUE_NAME_PREFIX}-worker`, { connection: { host, port, db } });
    try {
      const job = await queue.add("jobsx:job:write-direct", {
        value: "leak-tampered",
        _writeOrigin: "not-an-object",
      });
      await waitFor(async () => {
        const state = await job.getState();
        expect(state).toBe("failed");
      });
      expect(await rowCount()).toBe(0);
    } finally {
      await queue.close();
    }
  });
});
