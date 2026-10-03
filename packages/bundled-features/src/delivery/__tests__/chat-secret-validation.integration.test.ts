import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createChannelDiscordFeature, DISCORD_SECRET_KEYS } from "../../channel-discord/index.js";
import { createChannelSlackFeature, SLACK_SECRET_KEYS } from "../../channel-slack/index.js";
import { createChannelTeamsFeature, TEAMS_SECRET_KEYS } from "../../channel-teams/index.js";
import {
  createChannelTelegramFeature,
  TELEGRAM_SECRET_KEYS,
} from "../../channel-telegram/index.js";
import { type ChatHarness, setupChatHarness, tenantAdmin } from "./chat-channel-harness.js";

let harness: ChatHarness;

beforeAll(async () => {
  harness = await setupChatHarness(
    createChannelSlackFeature(),
    createChannelDiscordFeature(),
    createChannelTeamsFeature(),
    createChannelTelegramFeature(),
  );
});

afterAll(async () => {
  await harness.cleanup();
});

async function setViaHttp(key: string, value: string): Promise<{ status: number; body: string }> {
  const res = await harness.stack.http.write("secrets:write:set", { key, value }, tenantAdmin);
  return { status: res.status, body: await res.text() };
}

async function expectRejected(key: string, value: string): Promise<void> {
  const { status, body } = await setViaHttp(key, value);
  expect(status).toBe(400);
  expect(body).toContain("secrets.errors.invalidValue");
  expect(body).toContain('"path":"value"');
  expect(body).not.toContain(value);
}

describe("exported secret keys match the registered keys", () => {
  test.each([
    ["slack", SLACK_SECRET_KEYS],
    ["discord", DISCORD_SECRET_KEYS],
    ["teams", TEAMS_SECRET_KEYS],
  ])("%s webhook namespace", (_name, keys) => {
    const namespace = harness.stack.registry.findSecretNamespace(keys.webhookKeyFor("ops"));
    expect(namespace?.qualifiedPrefix).toBe(keys.webhookPrefix);
  });

  test("telegram bot token", () => {
    expect(harness.stack.registry.getSecretKey(TELEGRAM_SECRET_KEYS.botToken)).toBeDefined();
  });
});

describe("secrets:write:set validates chat secret values", () => {
  test("slack: foreign host rejected, provider url stored", async () => {
    const key = SLACK_SECRET_KEYS.webhookKeyFor("ops");
    await expectRejected(key, "https://example.com/x");
    await expectRejected(key, "https://hooks.slack.com@evil.com/services/T/B/x");
    const ok = await setViaHttp(key, "https://hooks.slack.com/services/T/B/x");
    expect(ok.status).toBe(200);
  });

  test("discord: url without /api/webhooks/ rejected, webhook url stored", async () => {
    const key = DISCORD_SECRET_KEYS.webhookKeyFor("ops");
    await expectRejected(key, "https://discord.com/channels/1/2");
    expect((await setViaHttp(key, "https://discord.com/api/webhooks/1/abc")).status).toBe(200);
  });

  test("teams: foreign host rejected, tenant subdomain stored", async () => {
    const key = TEAMS_SECRET_KEYS.webhookKeyFor("ops");
    await expectRejected(key, "https://hooks.slack.com/services/T/B/x");
    expect((await setViaHttp(key, "https://acme.webhook.office.com/webhookb2/x")).status).toBe(200);
  });

  test("telegram: token without <id>:<secret> rejected, valid token stored", async () => {
    const key = TELEGRAM_SECRET_KEYS.botToken;
    await expectRejected(key, "just-a-long-looking-token-without-colon");
    expect((await setViaHttp(key, "123456:ABCdef_ghi-JKLmno")).status).toBe(200);
  });
});
