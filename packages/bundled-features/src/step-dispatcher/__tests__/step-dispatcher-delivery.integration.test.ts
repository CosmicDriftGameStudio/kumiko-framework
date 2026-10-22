// step-dispatcher delivery runs as a BullMQ job: the MSP only
// enqueues, the job retries transient failures, and the payload key survives
// until the outcome is final.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  KeyErasedError,
  PII_CIPHERTEXT_PREFIX,
} from "@cosmicdrift/kumiko-framework/crypto";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  defineFeature,
  defineWriteHandler,
  stepsPipeline,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createMultiStreamApplyContext,
  getConsumerState,
} from "@cosmicdrift/kumiko-framework/pipeline";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import { resetEventStore, setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { Queue } from "bullmq";
import * as z from "zod";
import { createSecretsFeature } from "../../secrets/index.ts";
import { DELIVER_RETRIES, STEP_DISPATCHER_FEATURE, StepDispatcherJobs } from "../constants.ts";
import { deliverDispatchRequest } from "../deliver-dispatch-request.ts";
import {
  createStepDispatcherFeature,
  type MailDispatchResult,
  type MailSpec,
  setMailRunner,
  setWebhookFetch,
  WEBHOOK_ALLOWED_PRIVATE_HOSTS_ENV_VAR,
} from "../index.ts";

const DISPATCH_REQUESTED = "kumiko:system:step.dispatch-requested";
const DISPATCHED = "kumiko:system:step.dispatched";
const DISPATCH_FAILED = "kumiko:system:step.dispatch-failed";

const probeFeature = defineFeature("step-delivery-probe", (r) => {
  r.requires.step("mail.send");
  r.requires.step("webhook.send");

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

  r.writeHandler(
    defineWriteHandler({
      name: "notify-webhook",
      schema: z.object({ url: z.string() }),
      access: { roles: ["Admin"] },
      perform: stepsPipeline<{ url: string }, { ok: true }>(({ event, r }) => [
        r.step.webhook.send({
          url: () => event.payload.url,
          headers: () => ({}),
          body: () => ({ note: "delivery-body" }),
          mode: "deferred",
        }),
        r.step.return(() => ({ isSuccess: true as const, data: { ok: true as const } })),
      ]),
    }),
  );
});

const admin = createTestUser({ roles: ["Admin"] });
const fetchMock = mock<(...args: Parameters<typeof fetch>) => Promise<Response>>();
const mailMock = mock<(spec: MailSpec) => Promise<MailDispatchResult>>();
const originalAllowedPrivateHostsEnv = process.env[WEBHOOK_ALLOWED_PRIVATE_HOSTS_ENV_VAR];
const QUEUE_NAME_PREFIX = `step-delivery-${generateId().slice(-8)}`;
const HOOK_URL = "https://hooks.example/hook";

let stack: TestStack;
let kms: InMemoryKmsAdapter;
let rawQueue: Queue;

type EventRow = { aggregateId: string; payload: Record<string, unknown> };

async function eventsOfType(type: string): Promise<EventRow[]> {
  return (await selectMany(stack.db, eventsTable, { type })) as unknown as EventRow[];
}

async function drain(): Promise<void> {
  await stack.eventDispatcher?.runOnce();
  await stack.drainJobs();
}

async function requestedAggregateId(): Promise<string> {
  const rows = await eventsOfType(DISPATCH_REQUESTED);
  expect(rows).toHaveLength(1);
  return rows[0]!.aggregateId;
}

async function expectKeyAlive(aggregateId: string): Promise<void> {
  await kms.getKey({ kind: "record", entity: "step-dispatch", id: aggregateId });
}

async function expectKeyErased(aggregateId: string): Promise<void> {
  await expect(
    kms.getKey({ kind: "record", entity: "step-dispatch", id: aggregateId }),
  ).rejects.toBeInstanceOf(KeyErasedError);
}

function countEraseCalls(): { readonly count: () => number } {
  const realEraseKey = kms.eraseKey.bind(kms);
  let calls = 0;
  kms.eraseKey = async (...args: Parameters<typeof realEraseKey>) => {
    calls += 1;
    return realEraseKey(...args);
  };
  return { count: () => calls };
}

beforeAll(async () => {
  process.env[WEBHOOK_ALLOWED_PRIVATE_HOSTS_ENV_VAR] = "hooks.example";
  setWebhookFetch(fetchMock as unknown as typeof fetch);
  setMailRunner(async (spec: MailSpec) => mailMock(spec));
  stack = await setupTestStack({
    features: [createStepDispatcherFeature(), createSecretsFeature(), probeFeature],
    systemHooks: [],
    jobs: { consumerLane: "worker", queueNamePrefix: QUEUE_NAME_PREFIX },
  });
  const redisUrl = new URL(stack.redis.redisUrl);
  rawQueue = new Queue(`${QUEUE_NAME_PREFIX}-worker`, {
    connection: { host: redisUrl.hostname, port: Number(redisUrl.port) },
  });
  rawQueue.on("error", () => {});
});

afterAll(async () => {
  if (originalAllowedPrivateHostsEnv === undefined) {
    delete process.env[WEBHOOK_ALLOWED_PRIVATE_HOSTS_ENV_VAR];
  } else {
    process.env[WEBHOOK_ALLOWED_PRIVATE_HOSTS_ENV_VAR] = originalAllowedPrivateHostsEnv;
  }
  await rawQueue.obliterate({ force: true });
  await rawQueue.close();
  await stack.cleanup();
});

beforeEach(async () => {
  fetchMock.mockReset();
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

describe("step-dispatcher job delivery", () => {
  test("the queued job carries only the stream id and the tenant, never the request payload", async () => {
    await stack.http.writeOk(
      "step-delivery-probe:write:notify-mail",
      { to: "ops@example.com", subject: "Server down", body: "Disk is full" },
      admin,
    );
    const aggregateId = await requestedAggregateId();

    await drain();

    const jobs = (await rawQueue.getJobs(["completed"])).filter(
      (job) => job.name === StepDispatcherJobs.deliver && job.data.aggregateId === aggregateId,
    );
    expect(jobs).toHaveLength(1);
    const data = jobs[0]!.data as Record<string, unknown>;
    expect(data["_tenantId"]).toBe(admin.tenantId);
    const handlerFields = Object.keys(data).filter((key) => !key.startsWith("_"));
    expect(handlerFields).toEqual(["aggregateId"]);
    const serialized = JSON.stringify(data);
    for (const piiSubstring of ["ops@example.com", "Server down", "Disk is full"]) {
      expect(serialized).not.toContain(piiSubstring);
    }
    expect(serialized).not.toContain(PII_CIPHERTEXT_PREFIX);
    expect(jobs[0]?.id).toBe(`step-dispatch-${aggregateId}`);
  });

  test("a transient 503 is retried; one step.dispatched, no failure, key erased once at the end", async () => {
    const erases = countEraseCalls();
    let aggregateId = "";
    fetchMock.mockImplementationOnce(async () => new Response(null, { status: 503 }));
    fetchMock.mockImplementationOnce(async () => {
      // The retry still needs the request payload, so the key must be alive here.
      await expectKeyAlive(aggregateId);
      expect(erases.count()).toBe(0);
      return new Response(null, { status: 200 });
    });
    await stack.http.writeOk("step-delivery-probe:write:notify-webhook", { url: HOOK_URL }, admin);
    aggregateId = await requestedAggregateId();

    await drain();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await eventsOfType(DISPATCHED)).toHaveLength(1);
    expect(await eventsOfType(DISPATCH_FAILED)).toHaveLength(0);
    expect(erases.count()).toBe(1);
    await expectKeyErased(aggregateId);
  });

  // The attempts are driven directly instead of through the job's real backoff:
  // the event dispatcher never runs here, so no job is enqueued and the worker
  // stays idle.
  describe("retry exhaustion, attempt by attempt", () => {
    function applyContextFor(userId: string) {
      return createMultiStreamApplyContext({
        registry: stack.registry,
        db: stack.db,
        tenantId: admin.tenantId,
        userId,
        callerFeature: STEP_DISPATCHER_FEATURE,
      });
    }

    function deliverAttempt(aggregateId: string, attempt: number, finalAttempt: boolean) {
      return deliverDispatchRequest({
        aggregateId,
        tenantId: admin.tenantId,
        attempt,
        finalAttempt,
        applyContextFor,
      });
    }

    test("a 503 before the final attempt throws a generic error, records nothing and keeps the key", async () => {
      const erases = countEraseCalls();
      fetchMock.mockImplementation(async () => new Response(null, { status: 503 }));
      await stack.http.writeOk(
        "step-delivery-probe:write:notify-webhook",
        { url: HOOK_URL },
        admin,
      );
      const aggregateId = await requestedAggregateId();

      const thrown = await deliverAttempt(aggregateId, 1, false).then(
        () => undefined,
        (err: unknown) => err,
      );

      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toBe("step delivery failed, retrying");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(await eventsOfType(DISPATCHED)).toHaveLength(0);
      expect(await eventsOfType(DISPATCH_FAILED)).toHaveLength(0);
      expect(erases.count()).toBe(0);
      await expectKeyAlive(aggregateId);
    });

    test("a 503 on the final attempt records one dispatch-failed with that attempt number and erases the key", async () => {
      const erases = countEraseCalls();
      fetchMock.mockImplementation(async () => new Response(null, { status: 503 }));
      await stack.http.writeOk(
        "step-delivery-probe:write:notify-webhook",
        { url: HOOK_URL },
        admin,
      );
      const aggregateId = await requestedAggregateId();

      await deliverAttempt(aggregateId, DELIVER_RETRIES + 1, true);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(await eventsOfType(DISPATCHED)).toHaveLength(0);
      const failed = await eventsOfType(DISPATCH_FAILED);
      expect(failed).toHaveLength(1);
      expect(failed[0]?.payload).toMatchObject({
        stepKind: "webhook.send",
        attempt: DELIVER_RETRIES + 1,
      });
      expect(erases.count()).toBe(1);
      await expectKeyErased(aggregateId);
    });
  });

  describe("direct delivery guards", () => {
    function applyContextFor(userId: string) {
      return createMultiStreamApplyContext({
        registry: stack.registry,
        db: stack.db,
        tenantId: admin.tenantId,
        userId,
        callerFeature: STEP_DISPATCHER_FEATURE,
      });
    }

    function deliver(aggregateId: string, attempt: number, finalAttempt: boolean) {
      return deliverDispatchRequest({
        aggregateId,
        tenantId: admin.tenantId,
        attempt,
        finalAttempt,
        applyContextFor,
      });
    }

    test("an unknown aggregateId neither appends an event nor erases a key", async () => {
      const erases = countEraseCalls();

      await deliver(generateId(), 1, true);

      expect(await eventsOfType(DISPATCHED)).toHaveLength(0);
      expect(await eventsOfType(DISPATCH_FAILED)).toHaveLength(0);
      expect(erases.count()).toBe(0);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    test("a throw while reading the payload on the final attempt ends as a generic dispatch-failed plus erase", async () => {
      await stack.http.writeOk(
        "step-delivery-probe:write:notify-mail",
        { to: "ops@example.com", subject: "Server down", body: "Disk is full" },
        admin,
      );
      const aggregateId = await requestedAggregateId();
      const realGetKey = kms.getKey.bind(kms);
      kms.getKey = async () => {
        throw new Error("kms down for ops@example.com");
      };
      const erases = countEraseCalls();

      await deliver(aggregateId, DELIVER_RETRIES + 1, true);

      kms.getKey = realGetKey;
      const failed = await eventsOfType(DISPATCH_FAILED);
      expect(failed).toHaveLength(1);
      expect(failed[0]?.payload).toMatchObject({ stepKind: "mail.send" });
      expect(JSON.stringify(failed[0]?.payload)).not.toContain("ops@example.com");
      expect(erases.count()).toBe(1);
      expect(mailMock).not.toHaveBeenCalled();
      await expectKeyErased(aggregateId);
    });

    test("the same throw before the final attempt propagates without an outcome or erase", async () => {
      await stack.http.writeOk(
        "step-delivery-probe:write:notify-mail",
        { to: "ops@example.com", subject: "Server down", body: "Disk is full" },
        admin,
      );
      const aggregateId = await requestedAggregateId();
      const realGetKey = kms.getKey.bind(kms);
      kms.getKey = async () => {
        throw new Error("kms down");
      };
      const erases = countEraseCalls();

      await expect(deliver(aggregateId, 1, false)).rejects.toThrow("kms down");

      kms.getKey = realGetKey;
      expect(await eventsOfType(DISPATCH_FAILED)).toHaveLength(0);
      expect(erases.count()).toBe(0);
      await expectKeyAlive(aggregateId);
    });
  });

  test("a permanent 4xx is recorded after the first attempt without a retry", async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 404 }));
    await stack.http.writeOk("step-delivery-probe:write:notify-webhook", { url: HOOK_URL }, admin);
    const aggregateId = await requestedAggregateId();

    await drain();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const failed = await eventsOfType(DISPATCH_FAILED);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.payload).toMatchObject({ attempt: 1 });
    await expectKeyErased(aggregateId);
  });

  describe("mail failures", () => {
    const mailPayload = { to: "ops@example.com", subject: "Server down", body: "Disk is full" };

    test("a permanent SMTP 5xx rejection is recorded after the first attempt without a retry", async () => {
      mailMock.mockResolvedValue({ ok: false, error: "550 mailbox unavailable", smtpCode: 550 });
      await stack.http.writeOk("step-delivery-probe:write:notify-mail", mailPayload, admin);
      const aggregateId = await requestedAggregateId();

      await drain();

      expect(mailMock).toHaveBeenCalledTimes(1);
      const failed = await eventsOfType(DISPATCH_FAILED);
      expect(failed).toHaveLength(1);
      expect(failed[0]?.payload).toMatchObject({ stepKind: "mail.send", attempt: 1 });
      await expectKeyErased(aggregateId);
    });

    test("an adapter that throws is not retried, so a mail the provider may have accepted is not sent twice", async () => {
      mailMock.mockRejectedValue(new Error("connection reset after DATA"));
      await stack.http.writeOk("step-delivery-probe:write:notify-mail", mailPayload, admin);
      const aggregateId = await requestedAggregateId();

      await drain();

      expect(mailMock).toHaveBeenCalledTimes(1);
      expect(await eventsOfType(DISPATCH_FAILED)).toHaveLength(1);
      await expectKeyErased(aggregateId);
    });

    test("a failure without an SMTP code or with a 4xx code is still retried", async () => {
      mailMock.mockResolvedValueOnce({ ok: false, error: "421 try later", smtpCode: 421 });
      mailMock.mockResolvedValueOnce({ ok: false, error: "transport busy" });
      await stack.http.writeOk("step-delivery-probe:write:notify-mail", mailPayload, admin);

      await drain();

      expect(mailMock).toHaveBeenCalledTimes(3);
      expect(await eventsOfType(DISPATCHED)).toHaveLength(1);
      expect(await eventsOfType(DISPATCH_FAILED)).toHaveLength(0);
    });
  });

  test("without a job runner the projection fails loudly instead of dropping the dispatch", async () => {
    const noJobsStack = await setupTestStack({
      features: [createStepDispatcherFeature(), createSecretsFeature(), probeFeature],
      systemHooks: [],
    });
    try {
      await noJobsStack.eventDispatcher?.ensureRegistered();
      await noJobsStack.http.writeOk(
        "step-delivery-probe:write:notify-webhook",
        { url: HOOK_URL },
        admin,
      );

      await noJobsStack.eventDispatcher?.runOnce();

      const consumer = noJobsStack.eventDispatcher?.consumers.find((c) =>
        c.name.includes("step-dispatcher"),
      );
      expect(consumer).toBeDefined();
      const state = await getConsumerState(noJobsStack.db, consumer?.name ?? "");
      expect(state?.lastError).toContain("step-dispatcher needs a job runner");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await noJobsStack.cleanup();
    }
  });
});
