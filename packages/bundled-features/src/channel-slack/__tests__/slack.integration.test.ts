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
import { createChannelSlackFeature } from "../feature.js";

// Secret key under the channel's secretNamespace; the secrets write gate accepts it
// only because the feature declared the namespace.
const secretKeyFor = (connection: string) => `channel-slack:webhooks.${connection}`;

let harness: ChatHarness;
let stub: ProviderStub;
const webhookPath = "/api/webhooks/123/token-abc";

async function seedConnection(connection: string, urlOrPath: string) {
  await harness.setSecret(secretKeyFor(connection), urlOrPath);
}

beforeAll(async () => {
  stub = startProviderStub();
  harness = await setupChatHarness(
    createChannelSlackFeature({ allowedHosts: ["127.0.0.1"], requireHttps: false, timeoutMs: 200 }),
  );
});

afterAll(async () => {
  stub.stop();
  await harness.cleanup();
});

captureLogsAndForbid(() => [stub.origin]);

describe("channel-slack against a local HTTP stub", () => {
  test("posts { text } with & < > escaped; success row records the connection name", async () => {
    await seedConnection("ops", `${stub.origin}${webhookPath}`);
    const row = await harness.send("slack", "ops", {
      title: "Deploy <!channel> & done",
      body: "see <http://evil.example|link>",
    });
    expect(row.status).toBe("sent");
    expect(row.error).toBeNull();
    expect(row.recipientAddress).toBe("***");
    const [hit] = stub.hitsOn(webhookPath);
    expect(hit?.headers.get("content-type")).toContain("application/json");
    expect(hit?.bodyJson).toEqual({
      text: "Deploy &lt;!channel&gt; &amp; done\nsee &lt;http://evil.example|link&gt;",
    });
  });

  registerWebhookFailureCases(() => ({
    harness,
    stub,
    channel: "slack",
    seedConnection,
    seedConnectionUnvalidated: (connection, urlOrPath) =>
      harness.setSecretUnvalidated(secretKeyFor(connection), urlOrPath),
    urlFor: (path) => `${stub.origin}${path}`,
  }));

  test("attempt rows never contain the webhook URL", () => {
    const serialized = serializeAttemptRows(harness.attemptRows);
    expect(harness.attemptRows.length).toBeGreaterThan(0);
    expect(harness.attemptRows.map((row) => row.error)).toContain("http_500");
    expect(harness.attemptRows.map((row) => row.recipientAddress)).toContain("***");
    expect(serialized).not.toContain(stub.origin);
    expect(serialized).not.toContain(webhookPath);
  });
});
