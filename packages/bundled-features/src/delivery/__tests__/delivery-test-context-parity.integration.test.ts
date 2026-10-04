// createDeliveryTestContext must behave like the production ctx.notify binding:
// secrets for inline chat delivery, and the calling context's job dispatcher
// handed to notify() per call. Real stack, real /api/write, local HTTP stub for Slack.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  defineFeature,
  defineWriteHandler,
  type NotifyFn,
} from "@cosmicdrift/kumiko-framework/engine";
import { createEnvMasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-framework/testing";
import * as z from "zod";
import { createChannelSlackFeature } from "../../channel-slack/feature.js";
import { createConfigFeature } from "../../config/feature.js";
import { configValuesTable } from "../../config/table.js";
import { createSecretsFeature } from "../../secrets/feature.js";
import { createSecretsContext } from "../../secrets/secrets-context.js";
import { tenantSecretsTable } from "../../secrets/table.js";
import { createTenantFeature } from "../../tenant/feature.js";
import { tenantMembershipsTable } from "../../tenant/membership-table.js";
import { tenantEntity } from "../../tenant/schema/tenant.js";
import { createDeliveryFeature } from "../feature.js";
import { createDeliveryNotifyFactory } from "../notify-factory.js";
import { deliveryAttemptsTable } from "../tables.js";
import { createDeliveryTestContext } from "../testing.js";
import type { DeliveryService } from "../types.js";
import { type ProviderStub, startProviderStub } from "./chat-channel-harness.js";

const WEBHOOK_PATH = "/hooks/parity";
const admin = createTestUser({ roles: ["TenantAdmin"] });

const probeFeature = defineFeature("parity-probe", (r) => {
  r.requires("delivery");
  r.writeHandler(
    defineWriteHandler({
      name: "ping",
      schema: z.object({ notificationType: z.string(), immediate: z.boolean().optional() }),
      access: { roles: ["TenantAdmin"] },
      handler: async (event, ctx) => {
        const notify = ctx.notify as NotifyFn;
        await notify(event.payload.notificationType, {
          route: { slack: "ops" },
          data: { title: "ping" },
          ...(event.payload.immediate && { immediate: true }),
        });
        return { isSuccess: true, data: {} };
      },
    }),
  );
});

// "enqueue-only" builds a runner without a consumer, so a queued job stays in the queue
// until the test looks; a live "worker" consumer may already be sending by then.
type StackJobs = "none" | "enqueue-only" | "worker";

async function buildStack(jobs: StackJobs, stub: ProviderStub): Promise<TestStack> {
  resetPiiSubjectKmsForTests();
  const masterKeyProvider = createEnvMasterKeyProvider({
    env: {
      KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
      KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
    },
  });
  const stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createSecretsFeature(),
      createTenantFeature(),
      createDeliveryFeature(),
      createChannelSlackFeature({ allowedHosts: ["127.0.0.1"], requireHttps: false }),
      probeFeature,
    ],
    masterKeyProvider,
    ...(jobs === "enqueue-only" && { jobs: {} }),
    ...(jobs === "worker" && { jobs: { consumerLane: "worker" } }),
    extraContext: (deps) => {
      const secrets = createSecretsContext({
        db: deps.db,
        masterKeyProvider,
        registry: deps.registry,
      });
      return { secrets, ...createDeliveryTestContext(deps, { secrets }) };
    },
  });
  await unsafePushTables(stack.db, {
    configValuesTable,
    tenantMembershipsTable,
    tenant_secrets: tenantSecretsTable,
  });
  await unsafeCreateEntityTable(stack.db, tenantEntity, "tenant");
  await stack.http.writeOk(
    "secrets:write:set",
    { key: "channel-slack:webhooks.ops", value: `${stub.origin}${WEBHOOK_PATH}` },
    admin,
  );
  return stack;
}

async function attemptsFor(stack: TestStack, notificationType: string) {
  return selectMany<{ status: string }>(stack.db, deliveryAttemptsTable, { notificationType });
}

describe("createDeliveryTestContext without a job runner", () => {
  let stub: ProviderStub;
  let stack: TestStack;

  beforeAll(async () => {
    stub = startProviderStub();
    stack = await buildStack("none", stub);
  });

  afterAll(async () => {
    stub.stop();
    await stack.cleanup();
  });

  test("immediate ctx.notify delivers to the chat webhook with the given secrets", async () => {
    await stack.http.writeOk(
      "parity-probe:write:ping",
      { notificationType: "app:notify:parity-immediate", immediate: true },
      admin,
    );

    expect(stub.hitsOn(WEBHOOK_PATH)).toHaveLength(1);
    expect((await attemptsFor(stack, "app:notify:parity-immediate")).map((r) => r.status)).toEqual([
      "sent",
    ]);
  });
});

describe("createDeliveryTestContext with an enqueue-only job runner", () => {
  let stub: ProviderStub;
  let stack: TestStack;

  beforeAll(async () => {
    stub = startProviderStub();
    stack = await buildStack("enqueue-only", stub);
  });

  afterAll(async () => {
    stub.stop();
    await stack.cleanup();
  });

  test("a queued channel is queued by ctx.notify, not sent inline", async () => {
    await stack.http.writeOk(
      "parity-probe:write:ping",
      { notificationType: "app:notify:parity-queued" },
      admin,
    );

    expect((await attemptsFor(stack, "app:notify:parity-queued")).map((r) => r.status)).toEqual([
      "queued",
    ]);
    expect(stub.hitsOn(WEBHOOK_PATH)).toHaveLength(0);
  });
});

describe("createDeliveryTestContext with a job runner on the stack", () => {
  let stub: ProviderStub;
  let stack: TestStack;

  beforeAll(async () => {
    stub = startProviderStub();
    stack = await buildStack("worker", stub);
  });

  afterAll(async () => {
    stub.stop();
    await stack.cleanup();
  });

  test("a queued channel is sent once the jobs ran", async () => {
    await stack.http.writeOk(
      "parity-probe:write:ping",
      { notificationType: "app:notify:parity-queued" },
      admin,
    );

    await stack.drainJobs();

    expect((await attemptsFor(stack, "app:notify:parity-queued")).map((r) => r.status)).toEqual([
      "sent",
    ]);
    expect(stub.hitsOn(WEBHOOK_PATH)).toHaveLength(1);
  });
});

describe("createDeliveryNotifyFactory", () => {
  const user = createTestUser({ roles: ["TenantAdmin"] });

  function recordingService() {
    const dispatchersSeen: unknown[] = [];
    const service: Pick<DeliveryService, "notify"> = {
      notify: async (
        _type: string,
        _options: unknown,
        _user: unknown,
        _tenantId: unknown,
        jobDispatcher?: unknown,
      ) => {
        dispatchersSeen.push(jobDispatcher);
        return { deliveries: [] };
      },
    };
    return { service, dispatchersSeen };
  }
  const dispatcher = { dispatch: async () => "job-id" };

  test("hands the calling context's job dispatcher to notify", async () => {
    const { service, dispatchersSeen } = recordingService();
    await createDeliveryNotifyFactory(service)(user, user.tenantId, dispatcher)("x:notify:y", {});
    expect(dispatchersSeen).toEqual([dispatcher]);
  });

  test("deliverQueuedInline drops the dispatcher", async () => {
    const { service, dispatchersSeen } = recordingService();
    await createDeliveryNotifyFactory(service, { deliverQueuedInline: true })(
      user,
      user.tenantId,
      dispatcher,
    )("x:notify:y", {});
    expect(dispatchersSeen).toEqual([undefined]);
  });
});
