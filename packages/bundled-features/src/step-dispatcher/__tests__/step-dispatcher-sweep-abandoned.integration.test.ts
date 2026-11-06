// A deliver job can end terminally without an outcome (BullMQ stall, lost job). The daily sweeper
// closes such a request as failed once it is older than ABANDON_DISPATCH_AFTER_HOURS and erases
// its payload key; requests with an outcome or still inside the window stay untouched.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  KeyErasedError,
} from "@cosmicdrift/kumiko-framework/crypto";
import { asRawClient, selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  defineFeature,
  defineWriteHandler,
  STEP_DISPATCH_AGGREGATE_TYPE,
  stepsPipeline,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable, VersionConflictError } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createMultiStreamApplyContext,
  type MultiStreamApplyContext,
} from "@cosmicdrift/kumiko-framework/pipeline";
import { SYSTEM_USER_ID } from "@cosmicdrift/kumiko-types/identifiers";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import {
  createManualClock,
  resetPiiSubjectKmsForTests,
  waitFor,
} from "@cosmicdrift/kumiko-testing/helpers";
import { resetEventStore, setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { createSecretsFeature } from "../../secrets/index.ts";
import {
  ABANDON_DISPATCH_AFTER_HOURS,
  deliverJobId,
  STEP_DISPATCHER_FEATURE,
  StepDispatcherJobNames,
  StepDispatcherJobs,
} from "../constants.ts";
import { closeAbandonedDispatch } from "../deliver-dispatch-request.ts";
import {
  createStepDispatcherFeature,
  type MailDispatchResult,
  type MailSpec,
  setMailRunner,
} from "../index.ts";
import { sweepAbandonedDispatches } from "../sweep-abandoned.ts";

const DISPATCH_REQUESTED = "kumiko:system:step.dispatch-requested";
const DISPATCHED = "kumiko:system:step.dispatched";
const DISPATCH_FAILED = "kumiko:system:step.dispatch-failed";

const probeFeature = defineFeature("step-sweep-probe", (r) => {
  r.requires.step("mail.send");
  r.writeHandler(
    defineWriteHandler({
      name: "notify-mail",
      schema: z.object({ to: z.string(), subject: z.string(), body: z.string() }),
      access: { roles: ["Admin"] },
      perform: stepsPipeline<{ to: string; subject: string; body: string }, { ok: true }>(
        ({ event, r }) => [
          r.step.mail.send({
            to: () => event.payload.to,
            subject: () => event.payload.subject,
            body: () => event.payload.body,
            mode: "deferred",
          }),
          r.step.return(() => ({ isSuccess: true as const, data: { ok: true as const } })),
        ],
      ),
    }),
  );
});

const admin = createTestUser({ roles: ["Admin"] });
const mailMock = mock<(spec: MailSpec) => Promise<MailDispatchResult>>();
const clockStart = getTemporal().Now.instant();
const clock = createManualClock(clockStart);

let stack: TestStack;
let kms: InMemoryKmsAdapter;

type EventRow = { aggregateId: string; type: string; payload: Record<string, unknown> };

async function eventsOfType(type: string): Promise<EventRow[]> {
  return (await selectMany(stack.db, eventsTable, { type })) as unknown as EventRow[];
}

async function sendMail(to: string): Promise<string> {
  const before = new Set((await eventsOfType(DISPATCH_REQUESTED)).map((row) => row.aggregateId));
  await stack.http.writeOk(
    "step-sweep-probe:write:notify-mail",
    { to, subject: "Server down", body: "Disk is full" },
    admin,
  );
  const created = (await eventsOfType(DISPATCH_REQUESTED)).filter(
    (row) => !before.has(row.aggregateId),
  );
  expect(created).toHaveLength(1);
  return created[0]!.aggregateId;
}

// Moves the step-dispatcher consumer past everything stored so far, so the request never gets its
// deliver job: the lost-job case the sweeper exists for (drainJobs would otherwise deliver it).
async function loseDeliverJobs(): Promise<void> {
  await asRawClient(stack.db).unsafe(
    `UPDATE kumiko_event_consumers
        SET last_processed_event_id = (SELECT COALESCE(MAX(id), 0) FROM kumiko_events)
      WHERE name LIKE '%step-dispatcher%'`,
  );
}

async function redeliverRequests(): Promise<void> {
  await asRawClient(stack.db).unsafe(
    `UPDATE kumiko_event_consumers SET last_processed_event_id = 0 WHERE name LIKE '%step-dispatcher%'`,
  );
  await deliverPendingJobs();
}

async function deliverPendingJobs(): Promise<void> {
  await stack.eventDispatcher?.runOnce();
  await stack.drainJobs();
}

async function runSweeper(): Promise<void> {
  await stack.jobRunner?.dispatch(StepDispatcherJobs.sweepAbandoned, {});
  await stack.drainJobs();
}

async function isDeliverJobPendingOnStack(aggregateId: string): Promise<boolean> {
  const isJobPending = stack.jobRunner?.isJobPending;
  if (!isJobPending) throw new Error("test stack job runner has no isJobPending");
  return isJobPending.call(stack.jobRunner, StepDispatcherJobs.deliver, deliverJobId(aggregateId));
}

async function failedOf(aggregateId: string): Promise<EventRow[]> {
  return (await eventsOfType(DISPATCH_FAILED)).filter((row) => row.aggregateId === aggregateId);
}

async function keyIsErased(aggregateId: string): Promise<boolean> {
  try {
    await kms.getKey({ kind: "record", entity: "step-dispatch", id: aggregateId });
    return false;
  } catch (err) {
    if (err instanceof KeyErasedError) return true;
    throw err;
  }
}

beforeAll(async () => {
  setMailRunner(async (spec: MailSpec) => mailMock(spec));
  stack = await setupTestStack({
    features: [createStepDispatcherFeature(), createSecretsFeature(), probeFeature],
    systemHooks: [],
    jobs: { consumerLane: "worker" },
    extraContext: { clock },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  clock.set(clockStart);
  mailMock.mockReset();
  mailMock.mockResolvedValue({ ok: true, status: 202 });
  kms = new InMemoryKmsAdapter();
  configurePiiSubjectKms(kms);
  await resetEventStore(stack, []);
  await stack.redis.flushNamespace();
  await stack.eventDispatcher?.ensureRegistered();
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
});

test("the job name constant mirrors the literal registered name", () => {
  expect(createStepDispatcherFeature().jobs?.[StepDispatcherJobNames.sweepAbandoned]).toBeDefined();
});

describe("step-dispatcher sweep-abandoned", () => {
  test("closes an old request without an outcome once, erases its key, and leaves the others alone", async () => {
    const delivered = await sendMail("done@example.com");
    await deliverPendingJobs();
    expect(mailMock).toHaveBeenCalledTimes(1);
    expect(await eventsOfType(DISPATCHED)).toHaveLength(1);

    const abandoned = await sendMail("lost@example.com");
    await loseDeliverJobs();
    expect(await keyIsErased(abandoned)).toBe(false);

    clock.advance({ hours: ABANDON_DISPATCH_AFTER_HOURS - 1 });
    await runSweeper();
    expect(await failedOf(abandoned)).toHaveLength(0);
    expect(await keyIsErased(abandoned)).toBe(false);

    clock.advance({ hours: 2 });
    await runSweeper();

    const failed = await failedOf(abandoned);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.payload).toEqual({
      stepKind: "mail.send",
      error: "dispatch abandoned without a recorded outcome",
      attempt: 0,
    });
    expect(await keyIsErased(abandoned)).toBe(true);
    expect(await failedOf(delivered)).toHaveLength(0);
    expect(await eventsOfType(DISPATCHED)).toHaveLength(1);

    await runSweeper();
    expect(await failedOf(abandoned)).toHaveLength(1);
    expect(await eventsOfType(DISPATCH_FAILED)).toHaveLength(1);
    expect(mailMock).toHaveBeenCalledTimes(1);
  });

  test("pages past a full batch so every abandoned request is closed in one run", async () => {
    const abandoned: string[] = [];
    for (let index = 0; index < 5; index++) {
      abandoned.push(await sendMail(`lost-${index}@example.com`));
    }
    await loseDeliverJobs();

    await sweepAbandonedDispatches({
      db: stack.db,
      registry: stack.registry,
      startedBeforeIso: "2100-01-01T00:00:00Z",
      batchSize: 2,
      isDeliverJobPending: async () => false,
      onCloseFailure: (aggregateId, errorName) => {
        throw new Error(`close of ${aggregateId} failed: ${errorName}`);
      },
    });

    for (const aggregateId of abandoned) {
      expect(await failedOf(aggregateId)).toHaveLength(1);
      expect(await keyIsErased(aggregateId)).toBe(true);
    }
    expect(await eventsOfType(DISPATCH_FAILED)).toHaveLength(5);
  });

  test("skips a request whose deliver job is still running, then delivers it normally", async () => {
    let releaseMail: (result: MailDispatchResult) => void = () => {};
    mailMock.mockImplementationOnce(
      () =>
        new Promise<MailDispatchResult>((resolve) => {
          releaseMail = resolve;
        }),
    );
    const live = await sendMail("slow@example.com");
    await stack.eventDispatcher?.runOnce();
    await waitFor(async () => mailMock.mock.calls.length === 1);

    const closeFailures: string[] = [];
    await sweepAbandonedDispatches({
      db: stack.db,
      registry: stack.registry,
      startedBeforeIso: "2100-01-01T00:00:00Z",
      isDeliverJobPending: isDeliverJobPendingOnStack,
      onCloseFailure: (aggregateId) => closeFailures.push(aggregateId),
    });

    expect(closeFailures).toEqual([]);
    expect(await failedOf(live)).toHaveLength(0);
    expect(await keyIsErased(live)).toBe(false);

    releaseMail({ ok: true, status: 202 });
    await stack.drainJobs();
    expect(await eventsOfType(DISPATCHED)).toHaveLength(1);
    expect(await failedOf(live)).toHaveLength(0);
  });

  test("keeps the stream and its key when an outcome lands between load and append", async () => {
    const raced = await sendMail("raced@example.com");
    await loseDeliverJobs();
    const realContext = createMultiStreamApplyContext({
      registry: stack.registry,
      db: stack.db,
      tenantId: admin.tenantId,
      userId: SYSTEM_USER_ID,
      callerFeature: STEP_DISPATCHER_FEATURE,
    });
    const racingContext: MultiStreamApplyContext = {
      ...realContext,
      loadAggregate: async (aggregateId, options) => {
        const stream = await realContext.loadAggregate(aggregateId, options);
        await realContext.unsafeAppendEvent({
          aggregateId,
          aggregateType: STEP_DISPATCH_AGGREGATE_TYPE,
          type: DISPATCHED,
          payload: { stepKind: "mail.send", status: 202 },
        });
        return stream;
      },
    };

    await expect(closeAbandonedDispatch(racingContext, raced)).rejects.toBeInstanceOf(
      VersionConflictError,
    );

    expect(await eventsOfType(DISPATCHED)).toHaveLength(1);
    expect(await failedOf(raced)).toHaveLength(0);
    expect(await keyIsErased(raced)).toBe(false);
  });

  test("a request closed this way is not sent when its late deliver job finally runs", async () => {
    const abandoned = await sendMail("lost@example.com");
    await loseDeliverJobs();
    clock.advance({ hours: ABANDON_DISPATCH_AFTER_HOURS + 1 });
    await runSweeper();
    expect(await failedOf(abandoned)).toHaveLength(1);

    await redeliverRequests();

    expect(mailMock).not.toHaveBeenCalled();
    expect(await failedOf(abandoned)).toHaveLength(1);
    expect(await eventsOfType(DISPATCHED)).toHaveLength(0);
  });
});
