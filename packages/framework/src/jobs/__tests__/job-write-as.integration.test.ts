// framework#2585 — JobContext.writeAs.
//
// `hasAccess` has no system bypass, so before writeAs existed a job could
// only write as its own systemUser (roles: ["system"]) and every write
// handler gated on concrete roles was unreachable from a job: the dispatch
// came back access_denied and the only signal was a failed job. These tests
// pin both halves — ctx.write against a role-gated handler is still denied,
// and ctx.writeAs(actor) reaches the same handler and attributes the event
// to the actor rather than to SYSTEM.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as z from "zod";
import { ROLES } from "../../auth/roles.js";
import { type BunTestDb, createTestDb } from "../../bun-db/__tests__/bun-test-db.js";
import { asRawClient } from "../../db/query.js";
import {
  createRegistry,
  createSystemUser,
  defineFeature,
  type EscapeHatchUseEvent,
  type JobHandlerFn,
  type SessionUser,
  type WriteResult,
} from "../../engine/index.js";
import { createWorkerEntrypoint } from "../../entrypoint/index.js";
import { createArchivedStreamsTable } from "../../event-store/index.js";
import { flushEscapeHatchAudits } from "../../observability/index.js";
import { createEventConsumerStateTable } from "../../pipeline/index.js";
import { createTestRedis, type TestRedis } from "../../stack/index.js";
import { waitFor } from "../../testing/index.js";
import { createJobRunner } from "../job-runner.js";

const ADMIN_USER_ID = "11111111-1111-4111-8111-111111111111";

type ProbeOutcome = { readonly isSuccess: boolean; readonly errorCode: string | undefined };

const writeOutcomes: ProbeOutcome[] = [];
const writeAsOutcomes: ProbeOutcome[] = [];
const writeAsFailures: string[] = [];
const jobQueryAsSystemResults: Array<{ readonly roles: readonly string[] }> = [];

function recordOutcome(sink: ProbeOutcome[], result: WriteResult): void {
  sink.push({
    isSuccess: result.isSuccess,
    errorCode: result.isSuccess ? undefined : result.error.code,
  });
}

const writeAsProbeFeature = defineFeature("writeAsProbe", (r) => {
  const noted = r.defineEvent("adminNoted", z.object({ note: z.string() }), {
    piiFields: "none",
    version: 1,
  });

  r.writeHandler(
    "adminNote",
    z.object({ note: z.string() }),
    async (event, ctx) => {
      await ctx.unsafeAppendEvent({
        aggregateId: crypto.randomUUID(),
        aggregateType: "write-as-probe-note",
        type: noted.name,
        payload: { note: event.payload.note },
      });
      return { isSuccess: true as const, data: { note: event.payload.note } };
    },
    { access: { roles: [ROLES.TenantAdmin] } },
  );

  r.queryHandler("whoami", z.object({}), async (query) => ({ roles: query.user.roles }), {
    access: { roles: ["system"] },
  });

  r.job("writeAsSystem", { trigger: { manual: true }, retries: 0 }, async (payload, ctx) => {
    const result = await ctx.write("write-as-probe:write:admin-note", {
      note: payload["note"] as string, // @cast-boundary dynamic-key
    });
    recordOutcome(writeOutcomes, result);
  });

  // fw#2859 — JobContext.queryAs stays UNgated by the SYSTEM identity-switch gate.
  r.job("queryAsSystemWhoami", { trigger: { manual: true }, retries: 0 }, async (_payload, ctx) => {
    const result = (await ctx.queryAs(
      createSystemUser(ctx.systemUser.tenantId),
      "write-as-probe:query:whoami",
      {},
    )) as { roles: readonly string[] }; // @cast-boundary engine-payload
    jobQueryAsSystemResults.push(result);
  });

  const writeAsActorJob: JobHandlerFn = async (payload, ctx) => {
    const actor: SessionUser = {
      id: payload["actorId"] as string, // @cast-boundary dynamic-key
      tenantId: ctx.systemUser.tenantId,
      roles: [ROLES.TenantAdmin],
    };
    try {
      const result = await ctx.writeAs(actor, "write-as-probe:write:admin-note", {
        note: payload["note"] as string, // @cast-boundary dynamic-key
      });
      recordOutcome(writeAsOutcomes, result);
    } catch (error) {
      writeAsFailures.push(error instanceof Error ? error.message : String(error));
      throw error;
    }
  };

  r.job(
    "writeAsActor",
    {
      trigger: { manual: true },
      retries: 0,
      escapeHatch: { reason: "test job acts as a tenant admin to reach a role-gated handler" },
    },
    writeAsActorJob,
  );
  r.job("writeAsActorNoGrant", { trigger: { manual: true }, retries: 0 }, writeAsActorJob);
});

const JWT = "job-write-as-test-secret-must-be-32-chars!";

let testDb: BunTestDb;
let testRedis: TestRedis;

beforeAll(async () => {
  [testDb, testRedis] = await Promise.all([createTestDb(), createTestRedis()]);
  await createArchivedStreamsTable(testDb.db);
  await createEventConsumerStateTable(testDb.db);
});

afterAll(async () => {
  await Promise.all([testDb.cleanup(), testRedis.cleanup()]);
});

function redisUrl(): string {
  return `redis://${testRedis.redis.options.host}:${testRedis.redis.options.port}/${testRedis.redis.options.db}`;
}

function uniquePrefix(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function notesFor(note: string): Promise<Array<{ created_by: string }>> {
  const rows = await asRawClient(testDb.db).unsafe<{ created_by: string }>(
    `SELECT created_by FROM kumiko_events
      WHERE type = 'write-as-probe:event:admin-noted' AND payload->>'note' = $1`,
    [note],
  );
  return [...rows];
}

describe("JobContext.writeAs reaches a role-gated write handler (framework#2585)", () => {
  test("ctx.write is denied — the job's systemUser carries no TenantAdmin role", async () => {
    writeOutcomes.length = 0;
    const worker = createWorkerEntrypoint({
      registry: createRegistry([writeAsProbeFeature]),
      context: { db: testDb.db, redis: testRedis.redis },
      jwtSecret: JWT,
      redisUrl: redisUrl(),
      queueNamePrefix: uniquePrefix("job-write-as-denied"),
    });

    await worker.start();
    try {
      await worker.jobRunner.dispatch("write-as-probe:job:write-as-system", {
        note: "system attempt",
      });

      await waitFor(() => {
        expect(writeOutcomes.length).toBe(1);
      });
      expect(writeOutcomes[0]?.isSuccess).toBe(false);
      expect(writeOutcomes[0]?.errorCode).toBe("access_denied");
      expect(await notesFor("system attempt")).toHaveLength(0);
    } finally {
      await worker.stop();
    }
  });

  test("ctx.writeAs(actor) commits and attributes the event to the actor", async () => {
    writeAsOutcomes.length = 0;
    const worker = createWorkerEntrypoint({
      registry: createRegistry([writeAsProbeFeature]),
      context: { db: testDb.db, redis: testRedis.redis },
      jwtSecret: JWT,
      redisUrl: redisUrl(),
      queueNamePrefix: uniquePrefix("job-write-as-allowed"),
    });

    await worker.start();
    try {
      await worker.jobRunner.dispatch("write-as-probe:job:write-as-actor", {
        note: "actor attempt",
        actorId: ADMIN_USER_ID,
      });

      await waitFor(() => {
        expect(writeAsOutcomes.length).toBe(1);
      });
      expect(writeAsOutcomes[0]?.isSuccess).toBe(true);

      const rows = await notesFor("actor attempt");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.created_by).toBe(ADMIN_USER_ID);
    } finally {
      await worker.stop();
    }
  });
});

describe("JobContext.writeAs is gated by the job's identity-switch grant (#3607)", () => {
  test("without a grant the switch is refused and nothing is written", async () => {
    writeAsFailures.length = 0;
    const worker = createWorkerEntrypoint({
      registry: createRegistry([writeAsProbeFeature]),
      context: { db: testDb.db, redis: testRedis.redis },
      jwtSecret: JWT,
      redisUrl: redisUrl(),
      queueNamePrefix: uniquePrefix("job-write-as-no-grant"),
    });

    await worker.start();
    try {
      await worker.jobRunner.dispatch("write-as-probe:job:write-as-actor-no-grant", {
        note: "ungranted attempt",
        actorId: ADMIN_USER_ID,
      });

      await waitFor(() => {
        expect(writeAsFailures.length).toBe(1);
      });
      expect(await notesFor("ungranted attempt")).toHaveLength(0);
    } finally {
      await worker.stop();
    }
  });

  test("with a grant the switch is audited and the event carries the initiating caller", async () => {
    writeAsOutcomes.length = 0;
    const auditEvents: EscapeHatchUseEvent[] = [];
    const initiator = "22222222-2222-4222-8222-222222222222";
    const worker = createWorkerEntrypoint({
      registry: createRegistry([writeAsProbeFeature]),
      context: {
        db: testDb.db,
        redis: testRedis.redis,
        _escapeHatchAuditSink: async (event) => {
          auditEvents.push(event);
        },
      },
      jwtSecret: JWT,
      redisUrl: redisUrl(),
      queueNamePrefix: uniquePrefix("job-write-as-audit"),
    });

    await worker.start();
    try {
      await worker.jobRunner.dispatch(
        "write-as-probe:job:write-as-actor",
        { note: "audited attempt", actorId: ADMIN_USER_ID },
        { triggeredById: initiator },
      );

      await waitFor(() => {
        expect(writeAsOutcomes.length).toBe(1);
      });
      expect(writeAsOutcomes[0]?.isSuccess).toBe(true);
      await flushEscapeHatchAudits();
      const switchEvents = auditEvents.filter((event) => event.kind === "identity-switch");
      expect(switchEvents).toHaveLength(1);
      expect(switchEvents[0]?.caller).toBe(initiator);
      expect(switchEvents[0]?.target?.id).toBe(ADMIN_USER_ID);
    } finally {
      await worker.stop();
    }
  });
});

describe("JobContext.writeAs before attachDispatcher()", () => {
  test("throws the same not-attached stub ctx.write does", async () => {
    writeAsFailures.length = 0;
    const runner = createJobRunner({
      registry: createRegistry([writeAsProbeFeature]),
      context: { db: testDb.db, redis: testRedis.redis },
      redisUrl: redisUrl(),
      consumerLane: "worker",
      queueNamePrefix: uniquePrefix("job-write-as-bare"),
    });

    await runner.start();
    try {
      await runner.dispatch("write-as-probe:job:write-as-actor", {
        note: "should never land",
        actorId: ADMIN_USER_ID,
      });

      await waitFor(() => {
        expect(writeAsFailures.length).toBe(1);
      });
      expect(writeAsFailures[0]).toContain(
        "JobContext.writeAs called before dispatcher attached — call attachDispatcher() first",
      );
      expect(await notesFor("should never land")).toHaveLength(0);
    } finally {
      await runner.stop();
    }
  });
});

describe("JobContext.queryAs stays ungated by the SYSTEM identity-switch gate (framework#2859)", () => {
  test("ctx.queryAs(createSystemUser(...), whoami) succeeds from inside a job", async () => {
    jobQueryAsSystemResults.length = 0;
    const worker = createWorkerEntrypoint({
      registry: createRegistry([writeAsProbeFeature]),
      context: { db: testDb.db, redis: testRedis.redis },
      jwtSecret: JWT,
      redisUrl: redisUrl(),
      queueNamePrefix: uniquePrefix("job-query-as-system"),
    });

    await worker.start();
    try {
      await worker.jobRunner.dispatch("write-as-probe:job:query-as-system-whoami", {});

      await waitFor(() => {
        expect(jobQueryAsSystemResults.length).toBe(1);
      });
      expect(jobQueryAsSystemResults[0]?.roles).toContain("system");
    } finally {
      await worker.stop();
    }
  });
});
