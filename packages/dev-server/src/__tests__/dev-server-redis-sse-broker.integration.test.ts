import { afterEach, describe, expect, test } from "bun:test";
import { createRedisSseBroker, type RedisSseBroker } from "@cosmicdrift/kumiko-framework/api";
import { tenantChannel } from "@cosmicdrift/kumiko-framework/engine";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { readSseFrames, type SseFrame, waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import { createKumikoServer, type KumikoServerHandle } from "../create-kumiko-server.ts";
import { probeFeature } from "./create-kumiko-server-probe.ts";

const WORKER_EVENT_TYPE = "dev-server-probe:event:worker-signal";
const FOREIGN_EVENT_TYPE = "dev-server-probe:event:foreign-signal";

type SseOutcome = { frames: SseFrame[] } | { error: unknown } | undefined;

let handle: KumikoServerHandle | undefined;
const brokers: RedisSseBroker[] = [];

afterEach(async () => {
  await Promise.all(brokers.splice(0).map((broker) => broker.close()));
  await handle?.stop();
  handle = undefined;
});

function brokerWithPrefix(redisUrl: string, channelPrefix: string): RedisSseBroker {
  const broker = createRedisSseBroker({ redisUrl, channelPrefix });
  brokers.push(broker);
  return broker;
}

function pushSignal(broker: RedisSseBroker, type: string): Promise<void> | void {
  return broker.pushToChannel(tenantChannel(TestUsers.user.tenantId), {
    type,
    data: { userId: TestUsers.user.id },
  });
}

async function bootAndOpenSse(): Promise<{
  readonly redisUrl: string;
  readonly channelPrefix: string;
  readonly arrival: () => SseOutcome;
}> {
  handle = await createKumikoServer({
    features: [probeFeature],
    port: 0,
    installSignalHandlers: false,
  });
  const token = await handle.stack.jwt.sign(TestUsers.user);
  const response = await handle.fetch(
    new Request("http://localhost/api/sse", { headers: { Authorization: `Bearer ${token}` } }),
  );
  expect(response.status).toBe(200);

  let outcome: SseOutcome;
  void readSseFrames(response, { until: (frame) => frame.event === WORKER_EVENT_TYPE }).then(
    (frames) => {
      outcome = { frames };
    },
    (error: unknown) => {
      outcome = { error };
    },
  );
  return {
    redisUrl: handle.stack.redis.redisUrl,
    channelPrefix: `${handle.sseChannelPrefix}:`,
    arrival: () => outcome,
  };
}

describe("createKumikoServer SSE broker", () => {
  test("a live signal published to Redis by a separate worker process reaches an SSE client on the dev server", async () => {
    const { redisUrl, channelPrefix, arrival } = await bootAndOpenSse();
    const worker = brokerWithPrefix(redisUrl, channelPrefix);

    // Pub/Sub does not buffer for a subscriber whose psubscribe ack has not landed yet.
    await waitFor(async () => {
      await pushSignal(worker, WORKER_EVENT_TYPE);
      return arrival() !== undefined;
    });

    expect(arrival()).toHaveProperty("frames");
  });

  test("signals from a worker with another or no channel prefix never reach the client", async () => {
    const { redisUrl, channelPrefix, arrival } = await bootAndOpenSse();
    const matching = brokerWithPrefix(redisUrl, channelPrefix);
    const otherBoot = brokerWithPrefix(redisUrl, "another-dev-server:");
    const unprefixed = brokerWithPrefix(redisUrl, "");

    // The foreign publishes are confirmed before the matching one is sent, so a
    // foreign signal that could be delivered would arrive ahead of the matching frame.
    await pushSignal(otherBoot, FOREIGN_EVENT_TYPE);
    await pushSignal(unprefixed, FOREIGN_EVENT_TYPE);
    await waitFor(async () => {
      await pushSignal(matching, WORKER_EVENT_TYPE);
      return arrival() !== undefined;
    });

    const result = arrival();
    if (result === undefined || !("frames" in result)) throw new Error("matching signal missing");
    expect(result.frames.map((frame) => frame.event)).toEqual([WORKER_EVENT_TYPE]);
  });
});
