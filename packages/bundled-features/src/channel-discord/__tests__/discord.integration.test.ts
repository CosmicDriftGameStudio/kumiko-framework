import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  type ChatHarness,
  captureLogsAndForbid,
  type ProviderStub,
  registerWebhookFailureCases,
  serializeAttemptRows,
  setupChatHarness,
  startProviderStub,
} from "../../delivery/__tests__/chat-channel-harness.js";
import { createChannelDiscordFeature } from "../feature.js";

// Secret key under the channel's secretNamespace; the secrets write gate accepts it
// only because the feature declared the namespace.
const secretKeyFor = (connection: string) => `channel-discord:webhooks.${connection}`;

let harness: ChatHarness;
let stub: ProviderStub;
const webhookPath = "/api/webhooks/123/token-abc";

async function seedConnection(connection: string, urlOrPath: string) {
  await harness.setSecret(secretKeyFor(connection), urlOrPath);
}

beforeAll(async () => {
  stub = startProviderStub();
  harness = await setupChatHarness(
    createChannelDiscordFeature({
      allowedHosts: ["127.0.0.1"],
      requireHttps: false,
      timeoutMs: 200,
    }),
  );
});

afterAll(async () => {
  stub.stop();
  await harness.cleanup();
});

captureLogsAndForbid(() => [stub.origin]);

describe("channel-discord against a local HTTP stub", () => {
  test("posts { content, allowed_mentions: { parse: [] } } cut to 2000 chars", async () => {
    await seedConnection("ops", `${stub.origin}${webhookPath}`);
    const row = await harness.send("discord", "ops", {
      title: "@everyone <@123> alert",
      body: "x".repeat(3000),
    });
    expect(row.status).toBe("sent");
    expect(row.recipientAddress).toBe("ops");
    const [hit] = stub.hitsOn(webhookPath);
    const body = hit?.bodyJson as { content: string; allowed_mentions: unknown }; // @cast-boundary test-seam — stub request body
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(body.content).toHaveLength(2000);
    expect(body.content.startsWith("@everyone <@123> alert\n")).toBe(true);
  });

  registerWebhookFailureCases(() => ({
    harness,
    stub,
    channel: "discord",
    seedConnection,
    urlFor: (path) => `${stub.origin}${path}`,
  }));

  test("attempt rows never contain the webhook URL", () => {
    const serialized = serializeAttemptRows(harness.attemptRows);
    expect(harness.attemptRows.length).toBeGreaterThan(0);
    expect(harness.attemptRows.map((row) => row.error)).toContain("http_500");
    expect(harness.attemptRows.map((row) => row.recipientAddress)).toContain("failing");
    expect(serialized).not.toContain(stub.origin);
    expect(serialized).not.toContain(webhookPath);
  });
});
