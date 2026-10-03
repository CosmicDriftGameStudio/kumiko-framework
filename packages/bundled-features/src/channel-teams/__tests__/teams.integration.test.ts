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
import { createChannelTeamsFeature } from "../feature.js";

// Secret key under the channel's secretNamespace; the secrets write gate accepts it
// only because the feature declared the namespace.
const secretKeyFor = (connection: string) => `channel-teams:webhooks.${connection}`;

let harness: ChatHarness;
let stub: ProviderStub;
const webhookPath = "/api/webhooks/123/token-abc";

async function seedConnection(connection: string, urlOrPath: string) {
  await harness.setSecret(secretKeyFor(connection), urlOrPath);
}

beforeAll(async () => {
  stub = startProviderStub();
  harness = await setupChatHarness(
    createChannelTeamsFeature({ allowedHosts: ["127.0.0.1"], requireHttps: false, timeoutMs: 200 }),
  );
});

afterAll(async () => {
  stub.stop();
  await harness.cleanup();
});

captureLogsAndForbid(() => [stub.origin]);

describe("channel-teams against a local HTTP stub", () => {
  test("posts an Adaptive Card with the text in wrapping TextBlocks", async () => {
    await seedConnection("ops", `${stub.origin}${webhookPath}`);
    const row = await harness.send("teams", "ops", {
      title: "Build <b>failed</b>",
      body: "details",
    });
    expect(row.status).toBe("sent");
    expect(row.recipientAddress).toBe("ops");
    const [hit] = stub.hitsOn(webhookPath);
    expect(hit?.bodyJson).toEqual({
      type: "message",
      attachments: [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          contentUrl: null,
          content: {
            $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
            type: "AdaptiveCard",
            version: "1.4",
            body: [
              { type: "TextBlock", text: "Build <b>failed</b>", weight: "Bolder", wrap: true },
              { type: "TextBlock", text: "details", wrap: true },
            ],
          },
        },
      ],
    });
  });

  registerWebhookFailureCases(() => ({
    harness,
    stub,
    channel: "teams",
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
