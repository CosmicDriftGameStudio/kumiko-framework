// notify() contract: per-channel result, secrets for inline delivery, per-call
// job dispatcher and `immediate`. Real stack + real secrets write path; a local
// HTTP stub stands in for Slack.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createChannelSlackFeature } from "../../channel-slack/feature.js";
import { DeliveryJobs } from "../constants.js";
import { collectChannels, createDeliveryService } from "../delivery-service.js";
import {
  type ChatHarness,
  type ProviderStub,
  setupChatHarness,
  startProviderStub,
  tenantAdmin,
} from "./chat-channel-harness.js";

const SLACK_SECRET_KEY = "channel-slack:webhooks.ops";
const WEBHOOK_PATH = "/hooks/ops";

let harness: ChatHarness;
let stub: ProviderStub;

beforeAll(async () => {
  stub = startProviderStub();
  harness = await setupChatHarness(
    createChannelSlackFeature({ allowedHosts: ["127.0.0.1"], requireHttps: false, timeoutMs: 500 }),
  );
});

afterAll(async () => {
  stub.stop();
  await harness.cleanup();
});

type Dispatched = { readonly name: string; readonly payload: Record<string, unknown> };

function recordingDispatcher(): {
  readonly dispatched: Dispatched[];
  dispatch(name: string, payload: Record<string, unknown>): Promise<string>;
} {
  const dispatched: Dispatched[] = [];
  return {
    dispatched,
    async dispatch(name, payload) {
      dispatched.push({ name, payload });
      return "job-id";
    },
  };
}

function serviceWith(options: {
  withSecrets: boolean;
  jobRunner?: ReturnType<typeof recordingDispatcher>;
}) {
  return createDeliveryService({
    db: harness.stack.db,
    registry: harness.stack.registry,
    channels: collectChannels(harness.stack.registry),
    ...(options.withSecrets && { secrets: harness.secrets }),
    ...(options.jobRunner && { jobRunner: options.jobRunner }),
  });
}

describe("DeliveryService.notify result and delivery paths", () => {
  test("without a job dispatcher the inline path delivers with secrets and reports sent", async () => {
    await harness.setSecret(SLACK_SECRET_KEY, `${stub.origin}${WEBHOOK_PATH}`);
    const hitsBefore = stub.hitsOn(WEBHOOK_PATH).length;

    const result = await serviceWith({ withSecrets: true }).notify(
      "app:notify:inline",
      { route: { slack: "ops" }, data: { title: "hello" } },
      tenantAdmin,
      tenantAdmin.tenantId,
    );

    expect(result.deliveries).toHaveLength(1);
    expect(result.deliveries[0]).toMatchObject({
      channel: "slack",
      recipientId: null,
      status: "sent",
      error: null,
    });
    expect(stub.hitsOn(WEBHOOK_PATH)).toHaveLength(hitsBefore + 1);
  });

  test("a per-call job dispatcher queues the attempt and hands the job over", async () => {
    const dispatcher = recordingDispatcher();
    const hitsBefore = stub.hitsOn(WEBHOOK_PATH).length;

    const result = await serviceWith({ withSecrets: true }).notify(
      "app:notify:queued",
      { route: { slack: "ops" }, data: { title: "hello" } },
      tenantAdmin,
      tenantAdmin.tenantId,
      dispatcher,
    );

    expect(result.deliveries).toHaveLength(1);
    expect(result.deliveries[0]?.status).toBe("queued");
    expect(result.deliveries[0]?.deliveryAttemptId).toBeDefined();
    expect(dispatcher.dispatched.map((d) => d.name)).toEqual([DeliveryJobs.send]);
    expect(stub.hitsOn(WEBHOOK_PATH)).toHaveLength(hitsBefore);
  });

  test("immediate ignores the dispatcher and reports failed + missing_credentials without a secret", async () => {
    const dispatcher = recordingDispatcher();

    const result = await serviceWith({ withSecrets: true, jobRunner: dispatcher }).notify(
      "app:notify:immediate",
      { route: { slack: "unconfigured" }, data: { title: "hello" }, immediate: true },
      tenantAdmin,
      tenantAdmin.tenantId,
      dispatcher,
    );

    expect(result.deliveries).toHaveLength(1);
    expect(result.deliveries[0]).toMatchObject({
      channel: "slack",
      status: "failed",
      error: "missing_credentials",
    });
    expect(dispatcher.dispatched).toHaveLength(0);
  });

  test("an inline service without secrets cannot read the credential", async () => {
    const result = await serviceWith({ withSecrets: false }).notify(
      "app:notify:no-secrets",
      { route: { slack: "ops" }, data: { title: "hello" } },
      tenantAdmin,
      tenantAdmin.tenantId,
    );

    expect(result.deliveries[0]).toMatchObject({ status: "failed", error: "missing_credentials" });
  });

  test("a route address no channel serves yields an empty result", async () => {
    const result = await serviceWith({ withSecrets: true }).notify(
      "app:notify:no-channel",
      { route: { nonexistent: "x" } },
      tenantAdmin,
      tenantAdmin.tenantId,
    );

    expect(result.deliveries).toEqual([]);
  });
});
