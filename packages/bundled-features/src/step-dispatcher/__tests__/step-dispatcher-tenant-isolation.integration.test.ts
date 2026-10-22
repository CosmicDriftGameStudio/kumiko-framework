// A tenant whose receiver holds requests open must not delay other tenants'
// webhooks: deliveries are jobs with a per-tenant concurrency cap, so the
// held requests cannot occupy every worker slot.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  defineFeature,
  defineWriteHandler,
  stepsPipeline,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { createSecretsFeature } from "../../secrets/index.ts";
import { DELIVER_MAX_PER_TENANT } from "../constants.ts";
import {
  createStepDispatcherFeature,
  setWebhookFetch,
  WEBHOOK_ALLOWED_PRIVATE_HOSTS_ENV_VAR,
} from "../index.ts";

const DISPATCH_REQUESTED = "kumiko:system:step.dispatch-requested";
const DISPATCHED = "kumiko:system:step.dispatched";
const SLOW_TENANT_WEBHOOKS = 6;

const probeFeature = defineFeature("step-isolation-probe", (r) => {
  r.requires.step("webhook.send");
  r.writeHandler(
    defineWriteHandler({
      name: "notify-webhook",
      schema: z.object({ url: z.string() }),
      access: { roles: ["Admin"] },
      perform: stepsPipeline<{ url: string }, { ok: true }>(({ event, r }) => [
        r.step.webhook.send({
          url: () => event.payload.url,
          headers: () => ({}),
          body: () => ({ note: "isolation" }),
          mode: "deferred",
        }),
        r.step.return(() => ({ isSuccess: true as const, data: { ok: true as const } })),
      ]),
    }),
  );
});

const slowTenantAdmin = createTestUser({ id: 201, tenantId: testTenantId(201), roles: ["Admin"] });
const fastTenantAdmin = createTestUser({ id: 202, tenantId: testTenantId(202), roles: ["Admin"] });
const originalAllowedPrivateHostsEnv = process.env[WEBHOOK_ALLOWED_PRIVATE_HOSTS_ENV_VAR];

let stack: TestStack;
let receiver: ReturnType<typeof Bun.serve>;
let slowRequestsArrived = 0;
let slowRequestsHeld = 0;
let peakSlowRequestsHeld = 0;
let releaseSlowRequests!: () => void;
const slowRequestsReleased = new Promise<void>((resolve) => {
  releaseSlowRequests = resolve;
});
let notifyCapReached!: () => void;
const capReached = new Promise<void>((resolve) => {
  notifyCapReached = resolve;
});

type EventRow = { aggregateId: string; tenantId: string; payload: Record<string, unknown> };

async function eventsOfType(type: string): Promise<EventRow[]> {
  return (await selectMany(stack.db, eventsTable, { type })) as unknown as EventRow[];
}

beforeAll(async () => {
  process.env[WEBHOOK_ALLOWED_PRIVATE_HOSTS_ENV_VAR] = "127.0.0.1";
  setWebhookFetch(globalThis.fetch.bind(globalThis));
  receiver = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      if (new URL(req.url).pathname.startsWith("/slow/")) {
        slowRequestsArrived += 1;
        slowRequestsHeld += 1;
        peakSlowRequestsHeld = Math.max(peakSlowRequestsHeld, slowRequestsHeld);
        if (slowRequestsHeld >= DELIVER_MAX_PER_TENANT) notifyCapReached();
        await slowRequestsReleased;
        slowRequestsHeld -= 1;
      }
      return new Response("ok");
    },
  });
  stack = await setupTestStack({
    features: [createStepDispatcherFeature(), createSecretsFeature(), probeFeature],
    systemHooks: [],
    jobs: { consumerLane: "worker" },
  });
  await stack.eventDispatcher?.ensureRegistered();
});

afterAll(async () => {
  releaseSlowRequests();
  await receiver.stop(true);
  if (originalAllowedPrivateHostsEnv === undefined) {
    delete process.env[WEBHOOK_ALLOWED_PRIVATE_HOSTS_ENV_VAR];
  } else {
    process.env[WEBHOOK_ALLOWED_PRIVATE_HOSTS_ENV_VAR] = originalAllowedPrivateHostsEnv;
  }
  await stack.cleanup();
});

describe("step-dispatcher tenant isolation", () => {
  test("a tenant with held webhook requests does not delay another tenant's webhook", async () => {
    const baseUrl = `http://127.0.0.1:${receiver.port}`;
    for (let index = 0; index < SLOW_TENANT_WEBHOOKS; index++) {
      await stack.http.writeOk(
        "step-isolation-probe:write:notify-webhook",
        { url: `${baseUrl}/slow/${index}` },
        slowTenantAdmin,
      );
    }
    await stack.http.writeOk(
      "step-isolation-probe:write:notify-webhook",
      { url: `${baseUrl}/fast` },
      fastTenantAdmin,
    );

    await stack.eventDispatcher?.runOnce();

    await capReached;
    await waitFor(async () => {
      const dispatched = await eventsOfType(DISPATCHED);
      expect(dispatched.map((row) => row.tenantId)).toEqual([fastTenantAdmin.tenantId]);
    });
    expect(slowRequestsHeld).toBe(DELIVER_MAX_PER_TENANT);

    releaseSlowRequests();
    await stack.drainJobs();

    const requested = await eventsOfType(DISPATCH_REQUESTED);
    const dispatched = await eventsOfType(DISPATCHED);
    expect(requested).toHaveLength(SLOW_TENANT_WEBHOOKS + 1);
    expect(dispatched.map((row) => row.aggregateId).sort()).toEqual(
      requested.map((row) => row.aggregateId).sort(),
    );
    expect(slowRequestsArrived).toBe(SLOW_TENANT_WEBHOOKS);
    expect(peakSlowRequestsHeld).toBeLessThanOrEqual(DELIVER_MAX_PER_TENANT);
  });
});
