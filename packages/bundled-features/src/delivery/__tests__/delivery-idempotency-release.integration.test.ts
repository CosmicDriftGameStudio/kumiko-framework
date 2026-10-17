// An idempotencyKey that guarded no delivery must not turn the caller's retry into a
// skipped duplicate: inline failures free it at once, queued failures only once the
// send job is out of retries.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  defineFeature,
  defineWriteHandler,
  type NotifyDelivery,
  type NotifyFn,
  type NotifyJobDispatcher,
  type NotifyResult,
} from "@cosmicdrift/kumiko-framework/engine";
import type { Logger } from "@cosmicdrift/kumiko-framework/logging";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { createConfigFeature } from "../../config/feature.js";
import { createTenantFeature } from "../../tenant/feature.js";
import { DELIVERY_CHANNEL_EXTENSION, deliveryIdempotencyRedisKey } from "../constants.js";
import { collectChannels, createDeliveryService } from "../delivery-service.js";
import { createDeliveryFeature } from "../feature.js";
import { deliveryAttemptsTable } from "../tables.js";
import { createDeliveryTestContext } from "../testing.js";

const admin = createTestUser({ roles: ["TenantAdmin"] });

let failFlakyInline = false;
let failQueued = false;
let softFailQueued = false;
const sentTo: string[] = [];
let queuedAttempts = 0;

const idemProbeFeature = defineFeature("idem-probe", (r) => {
  r.requires({ features: ["delivery"] });
  r.useExtension(DELIVERY_CHANNEL_EXTENSION, "idem-inline-ok", {
    mode: "inline",
    send: async (address) => {
      sentTo.push(address);
      return { status: "sent" };
    },
  });
  r.useExtension(DELIVERY_CHANNEL_EXTENSION, "idem-inline-flaky", {
    mode: "inline",
    send: async (address) => {
      if (failFlakyInline) throw new Error("transport down");
      sentTo.push(address);
      return { status: "sent" };
    },
  });
  r.useExtension(DELIVERY_CHANNEL_EXTENSION, "idem-queued", {
    mode: "queued",
    send: async (address) => {
      queuedAttempts++;
      if (failQueued) throw new Error("transport down");
      sentTo.push(address);
      return { status: "sent" };
    },
  });
  r.useExtension(DELIVERY_CHANNEL_EXTENSION, "idem-queued-soft", {
    mode: "queued",
    send: async (address) => {
      if (softFailQueued) return { status: "failed", error: "send_failed" };
      sentTo.push(address);
      return { status: "sent" };
    },
  });
  r.writeHandler(
    defineWriteHandler({
      name: "ping",
      schema: z.object({
        key: z.string(),
        channels: z.array(z.string()).optional(),
        tenantBroadcast: z.boolean().optional(),
        immediate: z.boolean().optional(),
      }),
      access: { roles: ["TenantAdmin"] },
      handler: async (event, ctx) => {
        const notify = ctx.notify as NotifyFn;
        const { key, channels, tenantBroadcast, immediate } = event.payload;
        const target = tenantBroadcast
          ? { to: { tenant: event.user.tenantId } }
          : { route: Object.fromEntries((channels ?? []).map((c) => [c, "addr"])) };
        const result = await notify("app:notify:idem-release", {
          ...target,
          data: { title: "T" },
          idempotencyKey: key,
          ...(immediate && { immediate: true }),
        });
        return { isSuccess: true, data: result };
      },
    }),
  );
});

async function buildStack(withJobs: boolean): Promise<TestStack> {
  const stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createDeliveryFeature(),
      idemProbeFeature,
    ],
    ...(withJobs && { jobs: { consumerLane: "worker" } }),
    extraContext: (deps) => createDeliveryTestContext(deps, { idempotencyRedis: deps.redis }),
  });
  await unsafePushTables(stack.db, { deliveryAttemptsTable });
  return stack;
}

const throwingErrorLogger: Logger = {
  info: () => {},
  warn: () => {},
  debug: () => {},
  error: () => {
    throw new Error("log sink down");
  },
  child: () => throwingErrorLogger,
};

let keyCounter = 0;
function freshKey(): string {
  return `idem-release-${Date.now()}-${keyCounter++}`;
}

// A deferred notify reports no deliveries, so tests reading them ask for immediate.
function ping(stack: TestStack, key: string, channels: string[], immediate = false) {
  return stack.http.writeOk<NotifyResult>(
    "idem-probe:write:ping",
    { key, channels, immediate },
    admin,
  );
}

function deliveriesOf(result: NotifyResult): readonly NotifyDelivery[] {
  if (result.kind !== "dispatched") throw new Error("expected an immediate (dispatched) result");
  return result.deliveries;
}

async function keyExists(stack: TestStack, key: string): Promise<boolean> {
  return (await stack.redis.redis.exists(deliveryIdempotencyRedisKey(admin.tenantId, key))) === 1;
}

beforeEach(() => {
  failFlakyInline = false;
  failQueued = false;
  softFailQueued = false;
  queuedAttempts = 0;
  sentTo.length = 0;
});

describe("inline path (no job runner)", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await buildStack(false);
  });
  afterAll(async () => {
    await stack.cleanup();
  });

  test("a delivered notification keeps the key: the second call is a duplicate", async () => {
    const key = freshKey();
    await ping(stack, key, ["idem-inline-flaky"]);
    const second = await ping(stack, key, ["idem-inline-flaky"], true);

    expect(sentTo).toEqual(["addr"]);
    expect(deliveriesOf(second)[0]?.error).toBe("duplicate_idempotency_key");
    expect(await keyExists(stack, key)).toBe(true);
  });

  test("inline transport failure frees the key so the retry delivers", async () => {
    const key = freshKey();
    failFlakyInline = true;
    const first = await ping(stack, key, ["idem-inline-flaky"], true);
    expect(deliveriesOf(first)[0]?.status).toBe("failed");
    expect(await keyExists(stack, key)).toBe(false);

    failFlakyInline = false;
    await ping(stack, key, ["idem-inline-flaky"]);
    expect(sentTo).toEqual(["addr"]);
  });

  test("notify() throwing frees the key and propagates the error", async () => {
    const key = freshKey();
    const error = await stack.http.writeErr(
      "idem-probe:write:ping",
      { key, tenantBroadcast: true, immediate: true },
      admin,
    );

    expect(error.httpStatus).toBeGreaterThanOrEqual(500);
    expect(await keyExists(stack, key)).toBe(false);
  });

  test("a partial success across channels keeps the key", async () => {
    const key = freshKey();
    failFlakyInline = true;
    const result = await ping(stack, key, ["idem-inline-ok", "idem-inline-flaky"], true);

    expect(
      deliveriesOf(result)
        .map((d) => d.status)
        .sort(),
    ).toEqual(["failed", "sent"]);
    expect(await keyExists(stack, key)).toBe(true);
  });

  test("notify() throwing after a delivered channel keeps the key", async () => {
    const key = freshKey();
    // The failed hand-off is caught and logged; a logger that throws there is the
    // remaining way out of dispatch once a channel already delivered.
    const service = createDeliveryService({
      db: stack.db,
      registry: stack.registry,
      channels: collectChannels(stack.registry),
      idempotencyRedis: stack.redis.redis,
      log: throwingErrorLogger,
    });
    const brokenQueue: NotifyJobDispatcher = {
      dispatch: async () => {
        throw new Error("queue down");
      },
    };

    const notifying = service.notify(
      "app:notify:idem-release",
      { route: { "idem-inline-ok": "addr", "idem-queued": "addr" }, idempotencyKey: key },
      admin,
      admin.tenantId,
      brokenQueue,
    );

    await expect(notifying).rejects.toThrow("log sink down");
    expect(sentTo).toEqual(["addr"]);
    expect(await keyExists(stack, key)).toBe(true);
  });
});

describe("job path", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await buildStack(true);
  });
  afterAll(async () => {
    await stack.cleanup();
  });

  test("a delivered queued notification keeps the key: the second call neither enqueues nor sends", async () => {
    const key = freshKey();
    await ping(stack, key, ["idem-queued"]);
    await stack.drainJobs();
    expect(sentTo).toEqual(["addr"]);
    expect(await keyExists(stack, key)).toBe(true);

    const second = await ping(stack, key, ["idem-queued"], true);
    await stack.drainJobs();
    expect(deliveriesOf(second)[0]?.error).toBe("duplicate_idempotency_key");
    expect(queuedAttempts).toBe(1);
    expect(sentTo).toEqual(["addr"]);
  });

  test("a queued send that exhausts its retries frees the key for the next call", async () => {
    const key = freshKey();
    failQueued = true;
    await ping(stack, key, ["idem-queued"]);
    expect(await keyExists(stack, key)).toBe(true);

    const drainError = await stack.drainJobs().then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(drainError).toBeInstanceOf(Error);
    // delivery.send declares retries: 3 — only the fourth, final attempt releases.
    expect(queuedAttempts).toBe(4);
    expect(await keyExists(stack, key)).toBe(false);

    failQueued = false;
    await ping(stack, key, ["idem-queued"]);
    await stack.drainJobs();
    expect(sentTo).toEqual(["addr"]);
  });

  test("a queued send that reports failed without throwing frees the key at once", async () => {
    const key = freshKey();
    softFailQueued = true;
    await ping(stack, key, ["idem-queued-soft"]);
    await stack.drainJobs();
    expect(sentTo).toEqual([]);
    expect(await keyExists(stack, key)).toBe(false);

    softFailQueued = false;
    await ping(stack, key, ["idem-queued-soft"]);
    await stack.drainJobs();
    expect(sentTo).toEqual(["addr"]);
  });
});
