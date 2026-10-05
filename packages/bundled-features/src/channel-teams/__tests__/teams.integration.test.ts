import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  type ChatHarness,
  captureLogsAndForbid,
  type ProviderStub,
  registerWebhookFailureCases,
  serializeAttemptRows,
  setupChatHarness,
  startProviderStub,
  tenantAdmin,
} from "../../delivery/__tests__/chat-channel-harness.js";
import { collectChannels, createDeliveryService } from "../../delivery/delivery-service.js";
import { deliveryAttemptsTable } from "../../delivery/tables.js";
import { createChannelTeamsFeature } from "../feature.js";
import { classifyTeamsResponse } from "../teams-channel.js";

// Secret key under the channel's secretNamespace; the secrets write gate accepts it
// only because the feature declared the namespace.
const secretKeyFor = (connection: string) => `channel-teams:webhooks.${connection}`;

let harness: ChatHarness;
let stub: ProviderStub;
// ONE200: the stub answers 200 "1", the classic connector success answer.
const webhookPath = "/api/webhooks/123/token-abc/ONE200";

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
    expect(row.recipientAddress).toBe("***");
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

describe("channel-teams response check", () => {
  test.each([
    ["200 with body 1", "ONE200", "sent", null, undefined],
    ["202 accepted", "ACCEPTED202", "sent", null, false],
    ["200 with empty body", "EMPTY200", "failed", "unexpected_response", undefined],
  ] as const)("%s", async (_label, marker, status, error, confirmed) => {
    const connection = `resp-${marker.toLowerCase()}`;
    await seedConnection(connection, `${stub.origin}/api/webhooks/1/${marker}`);
    const { db, registry } = harness.stack;
    const service = createDeliveryService({
      db,
      registry,
      channels: collectChannels(registry),
      secrets: harness.secrets,
    });
    const notificationType = `app:notify:teams-${marker.toLowerCase()}`;

    const { deliveries } = await service.notify(
      notificationType,
      { route: { teams: connection }, data: { title: "hello" } },
      tenantAdmin,
      tenantAdmin.tenantId,
    );

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.status).toBe(status);
    expect(deliveries[0]?.error).toBe(error);
    expect(deliveries[0]?.confirmed).toBe(confirmed);
    const rows = await selectMany<{ status: string; error: string | null }>(
      db,
      deliveryAttemptsTable,
      { notificationType },
    );
    expect(rows.map((r) => [r.status, r.error])).toEqual([[status, error]]);
  });
});

describe("classifyTeamsResponse", () => {
  const responseOf = (status: number, body: string) => ({
    status,
    readBodyPrefix: async () => body,
  });

  test.each([
    [202, "", { ok: true, confirmed: false }],
    [200, "1", { ok: true, confirmed: true }],
    [200, " 1\n", { ok: true, confirmed: true }],
    [200, "", { ok: false, code: "unexpected_response" }],
    [200, "ok", { ok: false, code: "unexpected_response" }],
    [204, "", { ok: false, code: "unexpected_response" }],
  ] as const)("status %d body %j -> %j", async (status, body, expected) => {
    expect(await classifyTeamsResponse(responseOf(status, body))).toEqual(expected);
  });
});
