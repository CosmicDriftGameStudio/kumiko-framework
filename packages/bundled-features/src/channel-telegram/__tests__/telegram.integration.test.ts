import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  type ChatHarness,
  captureLogsAndForbid,
  type ProviderStub,
  serializeAttemptRows,
  setupChatHarness,
  startProviderStub,
} from "../../delivery/__tests__/chat-channel-harness.js";
import { createChannelTelegramFeature } from "../feature.js";

const BOT_TOKEN_KEY = "channel-telegram:secret:bot-token";
const BOT_TOKEN = "123456:TESTtokenABCDEF_xyz-0123";

let harness: ChatHarness;
let stub: ProviderStub;

// The stub path embeds the token (like the real API), so a hit on the right path
// also proves the token was spliced into the URL.
const sendMessagePath = `/bot${BOT_TOKEN}/sendMessage`;

beforeAll(async () => {
  stub = startProviderStub();
  harness = await setupChatHarness(
    createChannelTelegramFeature({
      apiBaseUrl: stub.origin,
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

captureLogsAndForbid(() => [BOT_TOKEN]);

describe("channel-telegram against a local HTTP stub", () => {
  test("no bot token stored -> failed missing_credentials", async () => {
    const row = await harness.send("telegram", "-1001234567890", { title: "t" });
    expect(row.status).toBe("failed");
    expect(row.error).toBe("missing_credentials");
    expect(stub.requests).toHaveLength(0);
  });

  test("sends sendMessage with chat_id + plain text (no parse_mode), cut to 4096", async () => {
    await harness.setSecret(BOT_TOKEN_KEY, BOT_TOKEN);
    const row = await harness.send("telegram", "-1001234567890", {
      title: "<b>Alert</b> *x* _y_",
      body: "z".repeat(5000),
    });
    expect(row.status).toBe("sent");
    expect(row.error).toBeNull();
    expect(row.recipientAddress).toBe("***7890");
    const [hit] = stub.hitsOn(sendMessagePath);
    const body = hit?.bodyJson as { chat_id: string; text: string; parse_mode?: string }; // @cast-boundary test-seam — stub request body
    expect(body.chat_id).toBe("-1001234567890");
    expect(body.parse_mode).toBeUndefined();
    expect(body.text).toHaveLength(4096);
    expect(body.text.startsWith("<b>Alert</b> *x* _y_\n")).toBe(true);
  });

  test("a public @channel name is a valid address", async () => {
    const row = await harness.send("telegram", "@ops_channel", { title: "hi" });
    expect(row.status).toBe("sent");
    expect(row.recipientAddress).toBe("***nnel");
  });

  test("malformed chat id -> failed invalid_address, no request", async () => {
    const before = stub.requests.length;
    const row = await harness.send("telegram", "12/../34", { title: "hi" });
    expect(row.status).toBe("failed");
    expect(row.error).toBe("invalid_address");
    expect(stub.requests).toHaveLength(before);
  });

  test.each([
    ["FAIL500", "http_500"],
    ["REDIRECT302", "redirect_blocked"],
    ["HANG", "timeout"],
  ])("API behaviour %s -> failed %s", async (marker, expectedCode) => {
    await harness.setSecret(BOT_TOKEN_KEY, `123456:${marker}tokenABCDEF_xyz`);
    const row = await harness.send("telegram", "1", { title: "hi" });
    expect(row.status).toBe("failed");
    expect(row.error).toBe(expectedCode);
    expect(stub.hitsOn("/never-hit")).toHaveLength(0);
  });

  test("attempt rows never contain the bot token or the API URL", () => {
    const serialized = serializeAttemptRows(harness.attemptRows);
    expect(harness.attemptRows.map((row) => row.error)).toContain("http_500");
    expect(harness.attemptRows.map((row) => row.recipientAddress)).toContain("***7890");
    for (const secret of [BOT_TOKEN, "tokenABCDEF_xyz", stub.origin, "/sendMessage"]) {
      expect(serialized).not.toContain(secret);
    }
  });
});
